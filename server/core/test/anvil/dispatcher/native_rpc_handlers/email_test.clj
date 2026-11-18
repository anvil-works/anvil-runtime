(ns anvil.dispatcher.native-rpc-handlers.email-test
  (:require [clojure.test :refer [deftest is testing]]
            [clj-commons.slingshot :refer [try+]]
            [anvil.dispatcher.native-rpc-handlers.email :as email]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.quota :as quota])
  (:import (anvil.dispatcher.types BlobMedia)
           (javax.mail MessagingException)))

(defn- send-email
  "Sends an email, with SMTP and quota stubbed. Returns send!'s result or error, what was captured, and which of
   quota and SMTP the send used."
  [capture? kwargs]
  (let [captured (atom [])
        used (atom [])]
    (with-redefs [email/capture-email? (constantly capture?)
                  email/capture-email! (fn [_environment email] (swap! captured conj email))
                  email/get-props (constantly {})
                  quota/decrement-if-possible! (fn [& _] (swap! used conj :quota) true)
                  app-data/get-app-info-insecure (constantly {:name "Email test"})
                  app-data/get-default-hostnames (constantly ["example.com"])
                  email/get-smtp-connection (fn [& _]
                                              (swap! used conj :smtp)
                                              (throw (MessagingException. "SMTP stub")))]
      (binding [rpc-util/*app-id* "EMAIL-TEST"]
        {:result   (try+ (email/send! kwargs) (catch map? e e))
         :captured @captured
         :used     @used}))))

(defn- blob [content-type ^String content name]
  (BlobMedia. content-type (.getBytes content) name))

(deftest captured-emails-are-recorded-not-sent
  (let [{:keys [result captured used]}
        (send-email true {:to                 ["Alice <alice@example.com>" "bob@example.com"]
                          :cc                 "carol@example.com"
                          :from_address       "noreply"
                          :subject            "Hi"
                          :text               "Body"
                          :attachments        [(blob "text/plain" "report" "report.txt") nil]
                          :inline_attachments {:logo (blob "image/png" "png" "logo.png")}})
        [email] captured]
    (is (= [] used))
    (is (= 1 (count captured)))
    (is (= {:to           ["Alice <alice@example.com>" "bob@example.com"]
            :cc           "carol@example.com"
            ;; What the code asked for, not the address a real send would resolve it to
            :from_address "noreply"
            :subject      "Hi"
            :text         "Body"}
           (select-keys email [:to :cc :bcc :from_address :subject :text])))
    (is (= [["report.txt" "report"]]
           (map (fn [^BlobMedia m] [(.getName m) (String. ^bytes (.getBytes m))]) (:attachments email))))
    (is (= ["logo"] (keys (:inline_attachments email))))
    (is (= "anvil.email.SendReport" (:type result)))
    (is (= (:message_id email) (get-in result [:value :message_id])))))

(deftest captured-addresses-are-kept-as-passed
  (doseq [to ["a@example.com, J. Smith <j@example.com>"
              ["J. Smith <j@example.com>" "  bob@example.com"]]]
    (let [{[email] :captured} (send-email true {:to to})]
      (is (= to (:to email)))
      (is (not (contains? email :cc))))))

(deftest captured-emails-are-validated-like-sent-emails
  (doseq [kwargs [{:to "not <<an address"}
                  {:to ["a@example.com, b@example.com"]}
                  {:to "a@example.com" :subject 42}
                  {:to "a@example.com" :inline_attachments {:logo "not media"}}]]
    (let [{:keys [result captured]} (send-email true kwargs)]
      (is (string? (:anvil/server-error result)) (pr-str kwargs))
      (is (= [] captured) (pr-str kwargs)))))

(deftest other-emails-are-sent
  (let [{:keys [result captured used]} (send-email false {:to "a@example.com" :text "Hi"})]
    (is (= [] captured))
    (is (= [:quota :smtp] used))
    (is (= "anvil.email.SendFailure" (:type result)))))

(deftest sent-emails-get-addresses-as-a-string
  (let [sent (atom nil)]
    (with-redefs [email/get-props (constantly {:custom_smtp true})
                  app-data/get-app-info-insecure (constantly {:name "Email test"})
                  app-data/get-default-hostnames (constantly ["example.com"])
                  email/get-smtp-connection (constantly nil)
                  email/smtp-send (fn [_connection message]
                                    (reset! sent message)
                                    (throw (MessagingException. "SMTP stub")))]
      (binding [rpc-util/*app-id* "EMAIL-TEST"]
        (try+ (email/send! {:to ["Alice <alice@example.com>" "bob@example.com"] :cc "carol@example.com"})
              (catch map? _e))))
    (is (= {:to "Alice <alice@example.com>,bob@example.com"
            :cc "carol@example.com"
            :bcc nil}
           (select-keys @sent [:to :cc :bcc])))))
