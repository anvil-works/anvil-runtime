(ns anvil.dispatcher.native-rpc-handlers.users.twilio-compat-test
  (:require [anvil.dispatcher.native-rpc-handlers.users.twilio :as users-twilio]
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

(deftest twilio-phone-ciphertext-retains-historical-key
  (let [to-calls (atom [])
        ok-response (delay {:status 200 :body "{\"status\":\"approved\"}"})
        stored-method {:phone (fake-encrypt :anvil.dispatcher.native-rpc-handlers.users.twilio/phone
                                            "+12025550123")}]
    (with-redefs [secrets/encrypt-str-with-global-key fake-encrypt
                  secrets/decrypt-str-with-global-key fake-decrypt
                  runtime-conf/twilio-config {:verify-service-id "svc" :account-sid "sid" :auth-token "token"}
                  http/post (fn [_url {:keys [form-params]}]
                              (swap! to-calls conj (get form-params "To"))
                              ok-response)]
      (is (= (:phone stored-method)
             (:phone (users-twilio/generate-mfa-method nil "+12025550123"))))
      (is (nil? (users-twilio/send-verification-token nil stored-method "sms")))
      (is (true? (users-twilio/check-verification-token nil stored-method "123456")))
      (is (= ["+12025550123" "+12025550123"] @to-calls)))))
