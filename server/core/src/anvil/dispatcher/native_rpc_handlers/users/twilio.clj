(ns anvil.dispatcher.native-rpc-handlers.users.twilio
  (:require [slingshot.slingshot :refer :all]
            [org.httpkit.client :as http]
            [anvil.runtime.conf :as runtime-conf]
            [anvil.util :as util]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.native-rpc-handlers.users.util :as users-util :refer [row-to-map get-user-row-by-id]]
            [anvil.dispatcher.native-rpc-handlers.util :as native-util]
            [anvil.dispatcher.core :as dispatcher]
            [clojure.data.json :as json]
            [anvil.runtime.secrets :as secrets]
            [crypto.random :as random]))

(clj-logging-config.log4j/set-logger! :level :info)

(defn get-mfa-method-for-current-user []
  (binding [native-util/*client-request?* false]
    (let [{:keys [user_table]} (users-util/get-props-with-named-user-table)
          v1-row-id-str (or (get-in @native-util/*session-state* [:users :partial-logged-in-id]) (get-in @native-util/*session-state* [:users :mfa-reset-user-id]))
          user-row (get-user-row-by-id user_table v1-row-id-str)]
      (->> (get (row-to-map user-row) "mfa")
           (some #(and (= (:type %) "twilio-verify") %))))))

(defn generate-mfa-method [_kwargs phone]
  {:type  "twilio-verify"
   :id    (random/base32 5)
   :serial 1
   :phone (secrets/encrypt-str-with-global-key ::phone phone)})

(defn send-verification-token [_kwargs mfa-method channel]
  ;; mfa-method might be nil, in which case send to the current half-logged-in user
  (if-let [{:keys [verify-service-id account-sid auth-token]} runtime-conf/twilio-config]
    (let [{:keys [phone]} (or mfa-method
                              (get-mfa-method-for-current-user))
          {:keys [body status] :as verification} @(http/post (str "https://verify.twilio.com/v2/Services/" verify-service-id "/Verifications")
                                   {:headers     {"Authorization" (util/basic-auth-header account-sid auth-token)}
                                    :form-params {"To"      (secrets/decrypt-str-with-global-key ::phone phone)
                                                  "Channel" channel}})]
      (log/trace "Twilio verification sent:" verification)
      (when-not (and (>= status 200) (< status 300))
        (throw+ {:anvil/server-error (try
                                       (-> (json/read-str body)
                                           (get "message"))
                                       (catch Exception e body))
                 :type               "anvil.users.MFAException"})))
    (throw+ {:anvil/server-error "Twilio not configured"})))

(defn check-verification-token [_kwargs mfa-method token]
  (if-let [{:keys [verify-service-id account-sid auth-token]} runtime-conf/twilio-config]
    (let [{:keys [phone]} (or mfa-method
                              (get-mfa-method-for-current-user))
          check @(http/post (str "https://verify.twilio.com/v2/Services/" verify-service-id "/VerificationCheck")
                            {:headers     {"Authorization" (util/basic-auth-header account-sid auth-token)}
                             :form-params {"To"   (secrets/decrypt-str-with-global-key ::phone phone)
                                           "Code" token}})
          body (json/read-str (:body check) :key-fn keyword)]
      (log/trace "Twilio verification checked:" check)
      (= "approved" (:status body)))
    (throw+ {:anvil/server-error "Twilio not configured"})))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.users.twilio.generate_mfa_method"      (native-util/wrap-native-fn generate-mfa-method)
        "anvil.private.users.twilio.send_verification_token"  (native-util/wrap-native-fn send-verification-token)
        "anvil.private.users.twilio.check_verification_token" (native-util/wrap-native-fn check-verification-token)})