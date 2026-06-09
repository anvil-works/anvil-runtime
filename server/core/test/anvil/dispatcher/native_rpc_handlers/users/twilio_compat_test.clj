(ns anvil.dispatcher.native-rpc-handlers.users.twilio-compat-test
  (:require [anvil.dispatcher.native-rpc-handlers.users.twilio :as users-v1-twilio]
            [anvil.dispatcher.native-rpc-handlers.users.v2.twilio :as users-v2-twilio]
            [anvil.runtime.conf :as runtime-conf]
            [anvil.runtime.secrets :as secrets]
            [clojure.string :as str]
            [clojure.test :refer :all]
            [org.httpkit.client :as http]))

(defn- fake-encrypt [key-specialisation plaintext]
  (str (namespace key-specialisation) "/" (name key-specialisation) "|" plaintext))

(defn- fake-decrypt [key-specialisation ciphertext]
  (let [[prefix payload] (str/split ciphertext #"\|" 2)
        expected-prefix (str (namespace key-specialisation) "/" (name key-specialisation))]
    (if (= expected-prefix prefix)
      payload
      (throw (ex-info "this encrypted value cannot be used"
                      {:type "anvil.secrets.SecretError"})))))

(deftest twilio-phone-ciphertext-is-compatible-between-v1-and-v2
  (let [to-calls (atom [])
        ok-response (delay {:status 200 :body "{}"})]
    (with-redefs [secrets/encrypt-str-with-global-key fake-encrypt
                  secrets/decrypt-str-with-global-key fake-decrypt
                  runtime-conf/twilio-config {:verify-service-id "svc" :account-sid "sid" :auth-token "token"}
                  http/post (fn [_url {:keys [form-params]}]
                              (swap! to-calls conj (get form-params "To"))
                              ok-response)]
      (let [v1-method (users-v1-twilio/generate-mfa-method nil "+12025550123")
            v2-method (users-v2-twilio/generate-mfa-method nil "+447700900123")]
        ;; This should keep working when users v1 and v2 paths share MFA data.
        (is (nil? (users-v2-twilio/send-verification-token nil v1-method "sms")))
        (is (nil? (users-v1-twilio/send-verification-token nil v2-method "sms")))
        (is (= ["+12025550123" "+447700900123"] @to-calls))))))
