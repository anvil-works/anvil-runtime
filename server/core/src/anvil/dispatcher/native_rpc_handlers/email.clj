(ns anvil.dispatcher.native-rpc-handlers.email
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [slingshot.slingshot])
  (:require [clojure.tools.logging :as log]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.runtime.conf :as conf]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.quota :as quota]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.util :as util]
            [crypto.random :as random]
            [anvil.core.worker-pool :as worker-pool])
  (:import (javax.mail.internet MimeBodyPart InternetAddress AddressException MimeMessage MimeMultipart)
           (javax.mail.util ByteArrayDataSource)
           (javax.activation DataHandler)
           (anvil.dispatcher.types Media MediaDescriptor SerializedPythonObject)
           (java.io InputStream)
           (javax.mail MessagingException Session Message$RecipientType)
           (java.util Properties)))

(clj-logging-config.log4j/set-logger! :level :info)

(defonce get-reroute-address (fn [session-state app-id] (throw (UnsupportedOperationException.))))
(defonce get-smtp-connection (fn [email-service-config environment] (throw (UnsupportedOperationException.))))

(def set-email-hooks! (util/hook-setter [get-reroute-address get-smtp-connection]))

(defn email-send-error [& msg]
  {:anvil/server-error (apply str msg), :type "anvil.email.SendFailure"})

(defn reroute-warning-text [test-mode to app-info]
  (str "This email would have been sent to '" to "' by Anvil app '" (:name app-info) "', but " (if test-mode "the email service is in test mode. All outgoing emails are being rerouted to you, the app owner." "its email quota has been exceeded.")))

(def ^:dynamic *use-quota* true)
(def ^:dynamic *require-service-config* true)

(def default-props {:custom_smtp false
                    :test_mode false})

(defn smtp-send [{:keys [session transport] :as _smtp-connection}
                 {:keys [from-address from-name to cc bcc subject text html attachments inline-attachments in-reply-to references app-id] :as _message}]

  (let [main-body (let [mp (MimeMultipart. "alternative")]
                    (when text
                      (.addBodyPart mp (doto (MimeBodyPart.)
                                         (.setText text "utf-8"))))
                    (when html
                      (.addBodyPart mp (doto (MimeBodyPart.)
                                         (.setContent html "text/html; charset=utf-8"))))

                    (when-not (or text html)
                      (.addBodyPart mp (doto (MimeBodyPart.)
                                         (.setText "" "utf-8"))))

                    mp)

        main-body-with-inline-attachments (if (and inline-attachments
                                                   (not-empty inline-attachments))
                                            (let [mp (MimeMultipart. "related")]
                                              (.addBodyPart mp (doto (MimeBodyPart.)
                                                                 (.setContent main-body)))
                                              (doseq [att inline-attachments]
                                                (.addBodyPart mp att))
                                              mp)
                                            main-body)

        full-content (let [mp (MimeMultipart.)]
                       (.addBodyPart mp (doto (MimeBodyPart.)
                                          (.setContent main-body-with-inline-attachments)))
                       (doseq [att attachments]
                         (.addBodyPart mp att))
                       mp)

        msg (doto (proxy [MimeMessage] [session]
                    (updateMessageID []
                      (when (nil? (.getMessageID this))
                        (.setHeader this "Message-ID" (str "<" (System/currentTimeMillis) "-" (random/hex 4) "-" (or app-id "internal") "@anvil>")))))
              (.setFrom (InternetAddress. ^String from-address ^String from-name))
              (.setSubject subject)
              (.setContent full-content))]

    (when to
      (.setRecipients msg Message$RecipientType/TO (InternetAddress/parse to)))
    (when cc
      (.setRecipients msg Message$RecipientType/CC (InternetAddress/parse cc)))
    (when bcc
      (.setRecipients msg Message$RecipientType/BCC (InternetAddress/parse bcc)))

    (when in-reply-to
      (.setHeader msg "In-Reply-To" in-reply-to))

    (when references
      (.setHeader msg "References" references))

    (log/trace "Sending message using transport" transport)
    (.sendMessage transport msg (.getAllRecipients msg))

    msg))

(defn map->props [props]
  (let [properties (Properties.)]
    (doseq [[k v] props]
      (.put properties k v))
    properties))

(defn open-smtp-connection [{:keys [host port user pass encryption] :as _smtp-config}]
  (let [session (Session/getInstance (map->props (merge {"mail.smtp.starttls.enable" (if (contains? #{"ssl" "starttls"} encryption) "true" "false")}
                                                        (when (= encryption "starttls")
                                                          {"mail.smtp.starttls.required" "true"}))))
        proto (if (= encryption "ssl") "smtps" "smtp")
        transport (.getTransport session proto)]

    (.connect transport host port user pass)
    (log/trace "Created SMTP transport" transport ":" host)
    (Thread/sleep 2000)

    {:session session
     :transport transport}))

(defn get-props
  ([] (merge (get-props rpc-util/*app*)
             (get-in @rpc-util/*session-state* [:email :test-config-override!])))
  ([app]
   (if-let [props (first (filter #(= (:source %) "/runtime/services/anvil/email.yml") (:services app)))]
     (merge (:client_config props) (:server_config props))
     (if *require-service-config*
       (throw+ {:anvil/server-error "Add the Email service to your app before calling this function"
                :type               "anvil.server.ServiceNotAdded"
                :docId              "email"
                :docLinkTitle       "You need to add the Email service to your app. Learn more"})
       default-props))))

(defn- list-of-addresses->str [lst]
  (cond (and (coll? lst)
             (every? string? lst))
        (->> (for [address lst] (try
                                  (str (InternetAddress. ^String address))
                                  (catch AddressException _e
                                    (throw+ (email-send-error "Invalid email address: " address)))))
             (interpose ",")
             (apply str))


        (string? lst)
        (try

          (->> (InternetAddress/parse ^String lst)
               (map str)
               (interpose ",")
               (apply str))

          (catch AddressException _e
            (throw+ (email-send-error "Not a valid sequence of addresses: " lst))))))


(defn send! [{:keys [to from_address from_name cc bcc subject html text inline_attachments attachments in_reply_to references] :as _kwargs}]

  (let [optional-kwarg (fn [val name pred type-name]
                        (when val
                          (when-not (pred val)
                            (throw+ (email-send-error (str "Keyword argument '" name "' must be a " type-name "."))))))

        to (list-of-addresses->str to)
        cc (list-of-addresses->str cc)
        bcc (list-of-addresses->str bcc)]

    (optional-kwarg to "to" string? "string, or list of strings")
    (optional-kwarg cc "cc" string? "string, or list of strings")
    (optional-kwarg bcc "bcc" string? "string, or list of strings")

    (optional-kwarg subject "subject" string? "string")
    (optional-kwarg text "text" string? "string")
    (optional-kwarg html "html" string? "string")

    (optional-kwarg attachments "attachments" (fn [as] (or (instance? MediaDescriptor as)
                                                           (nil? as)
                                                           (and (coll? as)
                                                                (every? (fn [a] (or (instance? MediaDescriptor a)
                                                                                    (nil? a))) as))))
                    "list of Media objects")

    (let [{:keys [custom_smtp test_mode] :as email-service-config} (get-props)

          app-info (app-data/get-app-info-insecure rpc-util/*app-id*)

          default-from-domains (app-data/get-default-hostnames rpc-util/*environment*)

          default-domain (first default-from-domains)

          ;; The from_address could be anything, from a full address with name and email
          ;; to a bare username like 'noreply', or nothing at all.
          ;; Pull it apart, fill in missing domains (or force the domain to one we're allowed)
          ;; then put it back together again
          parsed-from-address (if (and from_address (not= "" from_address))
                                (try (InternetAddress. from_address)
                                     (catch AddressException _e
                                       (throw+ (email-send-error "Invalid 'from' address: " from_address))))
                                (try (InternetAddress. (str "no-reply@" default-domain))
                                     (catch AddressException _e
                                       (throw+ (email-send-error "Invalid 'from' address: " (str "no-reply@" default-domain))))))

          from_name (or from_name (.getPersonal parsed-from-address))

          [_ from-prefix from-domain] (re-matches #"(.*?)@(.*)" (.getAddress parsed-from-address))

          from-domain (if (and from-domain (or custom_smtp (not conf/restrict-email-domains?)
                                               (some #{from-domain} default-from-domains)))
                        from-domain
                        default-domain)

          from-domain (.toLowerCase from-domain)

          from-prefix (or from-prefix (.getAddress parsed-from-address))

          from_address (str from-prefix "@" from-domain)


          quota-available (or custom_smtp (not *use-quota*)
                              (quota/decrement-if-possible! rpc-util/*session-state* rpc-util/*environment* nil :email 1))

          reroute-to-owner? (or (not quota-available) test_mode)

          reroute-address (delay (get-reroute-address rpc-util/*session-state* rpc-util/*app-id*))

          possibly-rerouted-to (if (or (empty? to) reroute-to-owner?) @reroute-address to)
          cc (and (not reroute-to-owner?) cc)
          bcc (and (not reroute-to-owner?) bcc)
          html (when html (if-not reroute-to-owner? html (str (reroute-warning-text test_mode (or to @reroute-address) app-info) "<hr/>" html)))
          text (when text (if-not reroute-to-owner? text (str (reroute-warning-text test_mode (or to @reroute-address) app-info) "\n\n---\n\n" text)))
          
          attachments (if (or (instance? MediaDescriptor attachments)
                              (nil? attachments))
                        [attachments]
                        attachments)]

      (log/trace "Sending email from" (str (InternetAddress. ^String from_address ^String from_name)) "to" [to cc bcc])

      (when-not quota-available
        (rpc-util/*rpc-println* (str "Email quota exceeded. Rerouting email to app owner instead of '" (or to @reroute-address) "'.")))

      (try
        (let [msg ^MimeMessage (smtp-send
                                 (get-smtp-connection email-service-config rpc-util/*environment*)
                                 {:from-address       from_address
                                  :from-name          from_name
                                  :to                 possibly-rerouted-to
                                  :subject            (or subject "")
                                  :cc                 cc
                                  :bcc                bcc
                                  :text               text
                                  :html               html
                                  :attachments        (for [[idx ^Media media] (map-indexed vector attachments)
                                                            :when media]
                                                        (doto (MimeBodyPart.)
                                                          (.setDataHandler (DataHandler. (ByteArrayDataSource. ^InputStream (blocking-hacks/?->InputStream rpc-util/*req* media) ^String (anvil.util/or-str (.getContentType ^MediaDescriptor media) "application/octet-stream"))))
                                                          (.setFileName (or (.getName ^MediaDescriptor media) (str "Attachment " (inc idx))))
                                                          (.setDisposition "attachment")))

                                  :inline-attachments (for [[idx [content-id ^Media media]] (map-indexed vector inline_attachments)
                                                            :when (and content-id media)]
                                                        (doto (MimeBodyPart.)
                                                          (.setDataHandler (DataHandler. (ByteArrayDataSource. ^InputStream (blocking-hacks/?->InputStream rpc-util/*req* media) ^String (anvil.util/or-str (.getContentType ^MediaDescriptor media) "application/octet-stream"))))
                                                          (.setFileName (or (.getName ^MediaDescriptor media) (str "Attachment " (inc idx))))
                                                          (.setDisposition "inline")
                                                          (.setContentID (str "<" (name content-id) ">"))))
                                  :in-reply-to        in_reply_to
                                  :references         references
                                  :app-id             rpc-util/*app-id*})]

          (SerializedPythonObject. "anvil.email.SendReport" {:message_id (.getMessageID msg)}))
        (catch MessagingException e
          (throw+ (email-send-error (str (.getMessage e) " (" (.getSimpleName (.getClass e)) ")" (when custom_smtp (str ". You have enabled Custom SMTP for email sending - did you configure it correctly? You may need to provide a valid from_address."))))))))))

(defn wrapped-send [allow-return?]
  (wrap-native-fn (fn [kwargs]
                    (when *client-request?*
                      (throw+ {:anvil/server-error "Permission denied. Cannot send email from client code. Call anvil.email.send() from a server module instead!"}))

                    (worker-pool/with-expanding-threadpool-when-slow
                      (let [report (send! kwargs)]
                        (when allow-return?
                          report))))))

(def handlers {"anvil.private.email.send"    (wrapped-send false) ; This one doesn't return anything, for backwards compatibility with old Uplinks that can't accept ValueTypes. Remove when all uplinks are >= v7
               "anvil.private.email.send.v2" (wrapped-send true)})

(swap! dispatcher/native-rpc-handlers merge handlers)
