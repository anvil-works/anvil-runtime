(ns anvil.runtime.email-server
  (:use [slingshot.slingshot :only [throw+ try+]])
  (:require [anvil.runtime.conf :as conf]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.app-log :as app-log]
            [anvil.dispatcher.core :as dispatcher]
            [crypto.random :as random]
            [clojure.tools.logging :as log]
            [anvil.util :as util])
  (:import (org.subethamail.smtp.helper SimpleMessageListener SimpleMessageListenerAdapter)
           (javax.mail Session Header Part Multipart)
           (java.util Properties Timer TimerTask)
           (javax.mail.internet MimeMessage InternetAddress AddressException MimePart)
           anvil.dispatcher.types.InputStreamMedia
           (org.subethamail.smtp RejectException)
           (org.apache.james.jdkim.api Headers)
           (org.apache.james.jdkim DKIMVerifier)
           (org.apache.james.jdkim.mailets HeaderSkippingOutputStream CRLFOutputStream)
           (org.apache.james.jdkim.exceptions FailException)))

(def jm-session (Session/getInstance (Properties.)))

(defn- parse-address-or-reject [addr]
  (try (InternetAddress. addr) (catch AddressException _e (throw (RejectException. (str "Not a valid address: " addr))))))

(defn get-app-environment [recipient-address]
  (let [ia ^InternetAddress (parse-address-or-reject recipient-address)
        [_ domain] (re-matches #".*@(.*)" (.getAddress ia))]
    (when domain
      (app-data/get-app-environment-by-email-hostname domain))))

(defn accept-mail? [from recipient]
  (boolean (get-app-environment recipient)))

(defonce failsafe-timeout (atom nil))

(defn setup-failsafe-timer! []
  (reset! failsafe-timeout (Timer. true)))

(def check-dkim)

(defn deliver-mail! [from recipient data-stream]
  ;; TODO handle errors correctly,
  ;; and log them to the app log
  (let [{app-id :app_id, :as environment} (or (get-app-environment recipient)
                                              (throw (RejectException. (str "No app registered for address: " recipient))))

        app-info (app-data/get-app-info-insecure app-id)
        app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment) false)

        environment (assoc environment :commit-id (:version app))

        app-session (atom {:app-origin (app-data/get-default-app-origin environment)
                           :client     {:type :email}})
        log-ctx {:app-session app-session, :app-id (:id app-info), :environment (assoc environment :commit-id (:version app))}
        _ (app-log/record! log-ctx :new-session {:type "email" :from_addr from :to_addr recipient})


        responded? (atom false)
        response-promise (promise)
        simple-smtp-result! (fn [r]
                              (when-not @responded?
                                (reset! responded? true)
                                (deliver response-promise r)
                                true))

        timer-task (util/timer-task "timing out SMTP response"
                     (simple-smtp-result! {:error {:type "unknown", :message "Server code timed out"}}))

        smtp-result! (fn [r]
                       (when (simple-smtp-result! r)
                         (try (.cancel timer-task) (catch Exception e))))

        return-path {:update!
                     (fn [{:keys [output]}]
                       (when (string? output)
                         (app-log/record! log-ctx "print" [{:t (System/currentTimeMillis) :s output}])))

                     :respond!
                     (fn [{:keys [error]}]
                       (cond
                         @responded?
                         nil

                         (= (:type error) "RateLimitExceeded")
                         (smtp-result! {:error "Rate limit exceeded"})

                         error
                         (let [cant-handle-email? (and (= (:type error) "anvil.server.NoServerFunctionError")
                                                       (re-find #"email:handle_message" (:message error)))
                               msg-for-smtp (cond
                                              (#{"anvil.email.DeliveryFailure" "DeliveryFailure"} (:type error))
                                              (:message error)

                                              cant-handle-email?
                                              "This application cannot handle incoming email"

                                              :else
                                              "An internal error has occurred. Check the app logs for details.")

                               error (if cant-handle-email?
                                       (assoc error :message "No server function has been decorated @anvil.email.handle_message, so incoming email message could not be delivered")
                                       error)]
                           (app-log/record! log-ctx "err" error)
                           (smtp-result! {:error msg-for-smtp}))

                         :else
                         (smtp-result! {:ok true})))}

        message (MimeMessage. jm-session data-stream)
        headers (enumeration-seq (.getAllHeaders message))
        dkim-status (check-dkim message)
        transformed-email {:envelope    {:from      from
                                         :recipient recipient}
                           :addressees  (apply merge-with concat
                                               (for [^Header h headers
                                                     :let [name (keyword (.toLowerCase (.getName h)))]
                                                     :when (contains? #{:from :to :cc} name)]
                                                 {name (for [a (InternetAddress/parseHeader (.getValue h) false)]
                                                         {:address (.getAddress a)
                                                          :name    (.getPersonal a)
                                                          :raw     (.toUnicodeString a)})}))
                           :headers     (for [^Header h headers] [(.getName h) (.getValue h)])
                           :subject     (.getSubject message)
                           :text        nil
                           :html        nil
                           :attachments []
                           :inline_attachments {}
                           :dkim        (if (nil? dkim-status)
                                          {:valid false, :valid_from_sender false, :domains []}
                                          (when-let [acceptable-signatures
                                                     (filter #(and (= -1 (.getBodyHashLimit %)))
                                                             dkim-status)]
                                            {:valid             (if (seq acceptable-signatures)
                                                                  true
                                                                  nil)
                                             :valid_from_sender (boolean (some #(.endsWith from (str "@" (.getDToken %)))
                                                                               dkim-status))
                                             :domains           (map #(.getDToken %) acceptable-signatures)}))}

        transform-message (fn transform-message [transformed-email, ^MimePart m]
                            (if (= (.getDisposition m) Part/ATTACHMENT)
                              (update-in transformed-email [:attachments] conj
                                         (InputStreamMedia. (.getContentType m) (.getInputStream m) (.getFileName m) (.getSize m)))

                              ;; Sometimes content-type headers have newlines in them, hence the (?s). Grr.
                              (condp re-matches (.getContentType m)
                                #"(?s)text/plain.*"
                                (update-in transformed-email [:text] (fn [t] (str t (.getContent m))))
                                #"(?s)text/html.*"
                                (update-in transformed-email [:html] (fn [h] (str (.getContent m))))
                                #"(?s)multipart/.*"
                                (let [^Multipart mp (.getContent m)
                                      n-parts (.getCount mp)]
                                  (reduce transform-message transformed-email (for [i (range n-parts)] (.getBodyPart mp i))))

                                (if (= (.getDisposition m) Part/INLINE)
                                  (update-in transformed-email [:inline_attachments] assoc
                                             (-> (or (.getContentID m) "")
                                                 (.replace "<" "")
                                                 (.replace ">" ""))
                                             (InputStreamMedia. (.getContentType m) (.getInputStream m) (.getFileName m) (.getSize m)))
                                  transformed-email))))

        transformed-email (transform-message transformed-email message)]

    ;; TODO is this sensible? We need *something* to free up the server thread, or one
    ;; malfunctioning downlink will kill the email handler entirely.
    (.schedule @failsafe-timeout timer-task 45000)

    (if (util/app-locked? app-id)
      (throw (RejectException. "App down for maintenance."))
      (try+
        (dispatcher/dispatch! {:call          {:func (str "email:handle_message"),
                                               :args [transformed-email] :kwargs {}}
                               :app           (:content app)
                               :app-id        app-id
                               :app-origin    (:app-origin @app-session)
                               :session-state app-session
                               :environment   environment
                               :origin        :email
                               :thread-id     (str "email-" (:id app-info) "-" (random/hex 16))
                               :use-quota?    true}
                              return-path)

        (when-let [error (:error @response-promise)]
          (throw (RejectException. ^String error)))


        (catch :anvil/server-error e
          (dispatcher/respond! return-path {:error e})
          (throw (RejectException. (:error @response-promise))))
        (catch RejectException e
          (throw e))
        (catch Exception e
          (let [error-id (random/hex 6)]
            (log/error e "Error in app API:" error-id)
            (throw (RejectException. (str "Internal server error: " error-id)))))))))


(def smtp-listener-factory (SimpleMessageListenerAdapter. (reify SimpleMessageListener
                                                            (accept [_this from to]
                                                              (accept-mail? from to))
                                                            (deliver [_this from recipient data-stream]
                                                              (deliver-mail! from recipient data-stream)))))


(defn- jdkim-headers [^MimeMessage message]
  (let [header-lines (enumeration-seq (.getAllHeaderLines message))
        headers (for [l header-lines
                      :let [[line name] (re-matches #"(?s)\s*(.*?)\s*:.*" l)]
                      :when line]
                  [(.toLowerCase name) line])]
    (reify Headers
      (getFields [_this]
        (vec (for [[name _line] headers] name)))
      (getFields [_this header-name]
        (vec (for [[name line] headers :when (= name (.toLowerCase header-name))] line))))))


(defn check-dkim [^MimeMessage message]
  (try
    (let [verifier (DKIMVerifier.)
          headers (jdkim-headers message)
          body-hasher (.newBodyHasher verifier headers)]

      ;; body-hasher will be nil iff there's no DKIM header in the message.
      (if body-hasher
        (let [os (.getOutputStream body-hasher)
              os (HeaderSkippingOutputStream. os)
              os (CRLFOutputStream. os)
              _ (.writeTo message os)
              _ (.close (.getOutputStream body-hasher))
              signature-records (.verify verifier body-hasher)]
          (vec signature-records))
        nil))
    (catch FailException e
      (log/info e "DKIM verification for incoming message failed")
      nil)))
