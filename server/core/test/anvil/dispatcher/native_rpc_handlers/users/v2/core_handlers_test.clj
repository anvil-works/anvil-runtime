(ns anvil.dispatcher.native-rpc-handlers.users.v2.core-handlers-test
  (:require [anvil.dispatcher.native-rpc-handlers.cookies :as cookies]
            [anvil.dispatcher.native-rpc-handlers.users.v2.core :as users-v2]
            [anvil.dispatcher.native-rpc-handlers.users.v2.util :as user-util]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.util :as anvil-util]
            [anvil.runtime.conf :as runtime-conf]
            [anvil.runtime.secrets :as secrets]
            [anvil.runtime.tables.v2.rpc :as table-rpc]
            [clojure.test :refer :all]
            [slingshot.slingshot :refer [throw+ try+]]))


(def provider-login-handlers
  [{:handler users-v2/login-with-google :permission :use_google :prop :use_google}
   {:handler users-v2/login-with-facebook :permission :use_facebook :prop :use_facebook}
   {:handler users-v2/login-with-microsoft :permission :use_microsoft :prop :use_microsoft}
   {:handler users-v2/login-with-saml :permission :use_saml :prop :use_saml}])


(def provider-signup-handlers
  [{:handler users-v2/signup-with-google :permission :use_google}
   {:handler users-v2/signup-with-facebook :permission :use_facebook}
   {:handler users-v2/signup-with-microsoft :permission :use_microsoft}
   {:handler users-v2/signup-with-saml :permission :use_saml}])

;; Covers successful provider login handler wiring through permission checks and login!.
;; This matters because each provider entry must dispatch identically, and it's better covered
;; in Clojure because Python tests hit end-to-end auth flows rather than this shared internal wiring.
(deftest social-login-handlers-success-path
  (doseq [{:keys [handler permission prop]} provider-login-handlers]
    (let [seen (atom [])]
      (with-redefs [user-util/get-user-props (fn [] {prop true :table_id "users-table" :allow_signup false})
                    users-v2/get-and-check-current-user-email-from-required-permission
                    (fn [required-permission]
                      (swap! seen conj [:required-permission required-permission])
                      "provider@login.test")
                    table-rpc/validate-fetch-request identity
                    user-util/table-get-from-email-check-enabled-and-validate
                    (fn [table-id email fetch]
                      (swap! seen conj [:table-get table-id email fetch])
                      :user-row)
                    users-v2/login!
                    (fn [user-row remember?]
                      (swap! seen conj [:login! user-row remember?])
                      {:logged-in true})]
        (is (= {:logged-in true} (handler {:remember true :fetch {:email true}})))
        (is (some #(= [:required-permission permission] %) @seen))
        (is (some #(= [:login! :user-row true] %) @seen))))))

;; Covers successful provider signup handler wiring through permission checks and signup-common-from-email.
;; This matters because the shared signup dispatch must stay aligned across providers, and it's better
;; covered in Clojure because Python tests exercise outcomes, not these internal handler mappings and args.
(deftest social-signup-handlers-success-path
  (doseq [{:keys [handler permission]} provider-signup-handlers]
    (let [seen (atom [])]
      (with-redefs [users-v2/get-and-check-current-user-email-from-required-permission
                    (fn [required-permission]
                      (swap! seen conj [:required-permission required-permission])
                      "provider@signup.test")
                    user-util/get-user-props (fn [] {permission true :table_id "users-table"})
                    users-v2/signup-common-from-email
                    (fn [required-permission email user-props kws]
                      (swap! seen conj [:signup required-permission email user-props kws])
                      {:signed-up true})]
        (is (= {:signed-up true} (handler {:remember false})))
        (is (some #(= [:required-permission permission] %) @seen))
        (is (some #(= [:signup permission "provider@signup.test" {permission true :table_id "users-table"} {:remember false}] %) @seen))))))

;; Covers token construction shape plus the encrypt failure path for email-link generation.
;; This matters because downstream login/reset routes depend on the exact token payload, and it's
;; better covered in Clojure because Python tests don't stub encryption or inspect raw token contents here.
(deftest generate-email-link-token-success-and-failure
  (binding [rpc-util/*app-id* "app-123"]
    (with-redefs [secrets/encrypt-str-with-global-key (fn [_ token] token)]
      (let [token (users-v2/generate-email-link-token nil "token@test.com" "login")
            [email app-id _time kind] (.split token "#")]
        (is (= "token@test.com" email))
        (is (= "app-123" app-id))
        (is (= "login" kind)))))
  (with-redefs [secrets/encrypt-str-with-global-key (fn [& _] (throw (RuntimeException. "boom")))]
    (is (thrown? RuntimeException
                 (users-v2/generate-email-link-token nil "token@test.com" "login")))))

;; Covers reading the remembered login email cookie and swallowing cookie-layer failures.
;; This matters because login form prefill should degrade safely, and it's better covered in Clojure
;; because Python tests don't isolate this helper or force cookie-layer exceptions at this boundary.
(deftest get-last-login-email-success-and-cookie-error
  (with-redefs [user-util/get-user-props (fn [] {:table_id "users-table" :share_login_status false})
                cookies/get-cookie-val (fn [_ cookie-key]
                                         (is (= :user-table-users-table-last-email cookie-key))
                                         "cookie@test.com")]
    (is (= "cookie@test.com" (users-v2/get-last-login-email nil))))

  (with-redefs [user-util/get-user-props (fn [] {:table_id "users-table" :share_login_status false})
                cookies/get-cookie-val (fn [& _] (throw+ {:anvil/cookie-error true}))]
    (is (nil? (users-v2/get-last-login-email nil)))))

;; Covers logout cleanup with and without a remember-me token present.
;; This matters because logout must clear the right local state in both cases, and it's better
;; covered in Clojure because Python tests don't assert this helper-call sequence or no-token branch.
(deftest logout-handles-token-and-no-token
  (let [calls (atom [])]
    (with-redefs [user-util/get-user-props (fn [] {:table_id "users-table" :share_login_status false})
                  users-v2/remove-login-session-data (fn [] (swap! calls conj :remove-login-session-data))
                  users-v2/get-remember-me-token-hash-from-cookie (fn [_] "token-hash")
                  users-v2/remove-remember-me-cookie (fn [_] (swap! calls conj :remove-remember-me-cookie))
                  users-v2/remove-remember-me-token-hash (fn [_ token-hash] (swap! calls conj [:remove-remember-me-token-hash token-hash]))
                  rpc-util/invalidate-client-objects! (fn [] (swap! calls conj :invalidate-client-objects!))]
      (is (nil? (users-v2/logout {:invalidate_client_objects true})))
      (is (= [:invalidate-client-objects!
              :remove-login-session-data
              :remove-remember-me-cookie
              [:remove-remember-me-token-hash "token-hash"]]
             @calls))))

  (let [calls (atom [])]
    (with-redefs [user-util/get-user-props (fn [] {:table_id "users-table" :share_login_status false})
                  users-v2/remove-login-session-data (fn [] (swap! calls conj :remove-login-session-data))
                  users-v2/get-remember-me-token-hash-from-cookie (fn [_] nil)
                  users-v2/remove-remember-me-cookie (fn [_] (swap! calls conj :remove-remember-me-cookie))
                  users-v2/remove-remember-me-token-hash (fn [_ _] (swap! calls conj :remove-remember-me-token-hash))
                  rpc-util/invalidate-client-objects! (fn [] (swap! calls conj :invalidate-client-objects!))]
      (is (nil? (users-v2/logout {})))
      (is (= [:remove-login-session-data] @calls)))))

;; Covers the runtime-config-driven MFA type list with and without Twilio configured.
;; This matters because signup and MFA management depend on the advertised types, and it's better
;; covered in Clojure because Python tests don't expose this helper's exact config-dependent return values.
(deftest get-enabled-mfa-types-with-and-without-twilio
  (with-redefs [runtime-conf/twilio-config nil]
    (is (= ["totp" "fido"] (vec (users-v2/get-enabled-mfa-types nil)))))
  (with-redefs [runtime-conf/twilio-config {:verify-service-id "service"}]
    (is (= ["totp" "fido" "twilio-verify"] (vec (users-v2/get-enabled-mfa-types nil))))))


(deftest get-current-user-uses-remember-me-path-when-allowed
  (with-redefs [user-util/get-user-props (fn [] {:table_id "users-table" :allow_remember_me true :require_mfa false :use_email false})
                table-rpc/validate-fetch-request identity
                users-v2/get-user-from-session (fn [_ _] nil)
                users-v2/check-whether-mfa-required (fn [_] nil)
                users-v2/get-user-from-remember-me (fn [_ _] :remembered-user)]
    (is (= :remembered-user (users-v2/get-current-user {:allow_remembered true :fetch {:email true}})))))

;; Covers the expiry check on token login without going through live encrypted-token plumbing.
;; This matters because Python tests cover broader token-login behavior, but this exact stale-token
;; branch is easier to force and assert in Clojure without depending on wall-clock-sensitive setup.
(deftest do-login-with-token-rejects-expired-token
  (let [session-state (atom {})
        old-ms (- (System/currentTimeMillis) (* 11 60 1000))]
    (with-redefs [users-v2/get-decrypted-token (fn [_token]
                                                 {:email "good@user.com"
                                                  :token-app-id "app-123"
                                                  :token-time (str old-ms)
                                                  :token-type "login"})
                  user-util/get-user-props (fn [] {:table_id "users-table" :use_token true})
                  user-util/table-get-from-email-check-enabled-and-validate (fn [_table-id _email _fetch] :user-row)]
      (is (nil? (users-v2/do-login-with-token {:id "app-123" :content {}}
                                              :dev
                                              session-state
                                              "token"
                                              nil)))
      (is (nil? (get-in @session-state [:users :logged-in-id]))))))

;; Covers the expiry check for password-reset tokens specifically.
;; This matters because Python password-reset tests exercise the public flow, but Clojure is the
;; better place to pin this internal token branch and resulting session-state no-op directly.
(deftest do-login-with-token-rejects-expired-password-reset-token
  (let [session-state (atom {})
        old-ms (- (System/currentTimeMillis) (* 11 60 1000))]
    (with-redefs [users-v2/get-decrypted-token (fn [_token]
                                                 {:email "good@user.com"
                                                  :token-app-id "app-123"
                                                  :token-time (str old-ms)
                                                  :token-type "pw-reset"})
                  user-util/get-user-props (fn [] {:table_id "users-table" :use_token true})
                  user-util/table-get-from-email-check-enabled-and-validate (fn [_table-id _email _fetch] :user-row)]
      (is (nil? (users-v2/do-login-with-token {:id "app-123" :content {}}
                                              :dev
                                              session-state
                                              "token"
                                              nil)))
      (is (nil? (get-in @session-state [:users :password-reset-user-id]))))))

;; Covers unknown token kinds returning no successful login/reset state.
;; This matters because Python tests cover wrong-token failures, but this internal fallthrough case
;; is better asserted in Clojure where we can inject the parsed token contents directly.
(deftest do-login-with-token-rejects-unknown-token-type
  (let [session-state (atom {})]
    (with-redefs [users-v2/get-decrypted-token (fn [_token]
                                                 {:email "good@user.com"
                                                  :token-app-id "app-123"
                                                  :token-time (str (System/currentTimeMillis))
                                                  :token-type "unknown-kind"})
                  user-util/get-user-props (fn [] {:table_id "users-table" :use_token true})
                  user-util/table-get-from-email-check-enabled-and-validate (fn [_table-id _email _fetch] :user-row)]
      (is (nil? (users-v2/do-login-with-token {:id "app-123" :content {}}
                                              :dev
                                              session-state
                                              "token"
                                              nil)))
      (is (nil? (get-in @session-state [:users :logged-in-id])))
      (is (nil? (get-in @session-state [:users :mfa-reset-user-id])))
      (is (nil? (get-in @session-state [:users :password-reset-user-id]))))))

;; Covers rejecting unsupported MFA method types before any row update happens.
;; This matters because Python covers add-mfa behavior at the public API level, but Clojure is the
;; better place to verify this guard clause and the "no write" branch deterministically.
(deftest add-mfa-method-rejects-unsupported-type
  (binding [rpc-util/*session-state* (atom {:users {:logged-in-id "[users-table,1]"}})]
    (with-redefs [user-util/get-user-props (fn [] {:table_id "users-table"})
                  user-util/table-get-row-by-id (fn [_ _] :user-row)
                  users-v2/check-password-hash (fn [_ _] true)
                  user-util/get-in-user-row (fn [_ k & [_default]]
                                              (case k
                                                :mfa []
                                                nil))
                  user-util/update-user-row-creating-cols-as-necessary (fn [& _] (is false "Should not update row"))]
      (try+
        (users-v2/add-mfa-method nil "password" {:type "unsupported" :id "bad" :serial 1} false)
        (is false "Expected unsupported MFA type rejection")
        (catch #(= "anvil.users.AuthenticationFailed" (:type %)) e
          (is (= "MFA method not supported" (:anvil/server-error e))))))))

;; Covers rejecting duplicate MFA method IDs before persisting a conflicting method.
;; This matters because Python exercises successful MFA management, but Clojure is the better
;; place to pin this exact duplicate-detection branch and confirm it does not update the row.
(deftest add-mfa-method-rejects-duplicate-id
  (binding [rpc-util/*session-state* (atom {:users {:logged-in-id "[users-table,1]"}})]
    (with-redefs [user-util/get-user-props (fn [] {:table_id "users-table"})
                  user-util/table-get-row-by-id (fn [_ _] :user-row)
                  users-v2/check-password-hash (fn [_ _] true)
                  user-util/get-in-user-row (fn [_ k & [_default]]
                                              (case k
                                                :mfa [{:type "totp" :id "dup" :serial 1}]
                                                nil))
                  user-util/update-user-row-creating-cols-as-necessary (fn [& _] (is false "Should not update row"))]
      (try+
        (users-v2/add-mfa-method nil "password" {:type "totp" :id "dup" :serial 2} false)
        (is false "Expected duplicate MFA id rejection")
        (catch #(= "anvil.users.AuthenticationFailed" (:type %)) e
          (is (= "MFA method already exists" (:anvil/server-error e))))))))

;; Covers dispatch from MFA type to the corresponding validator helper.
;; This matters because Python tests see only end-to-end MFA behavior, while Clojure is the better
;; place to verify this internal dispatch table stays aligned for every supported MFA type.
(deftest check-mfa-methods-dispatches-by-type
  (let [called (atom [])]
    (with-redefs [users-v2/check-mfa-totp (fn [_ _ _] (swap! called conj :totp))
                  users-v2/check-mfa-fido (fn [_ _ _] (swap! called conj :fido))
                  users-v2/check-mfa-twilio-verify (fn [_ _ _] (swap! called conj :twilio))]
      (#'users-v2/check-mfa-methods {} :user-row {:mfa-type "totp" :matching-mfa-methods [{}]})
      (#'users-v2/check-mfa-methods {} :user-row {:mfa-type "fido" :matching-mfa-methods [{}]})
      (#'users-v2/check-mfa-methods {} :user-row {:mfa-type "twilio-verify" :matching-mfa-methods [{}]})
      (is (= [:totp :fido :twilio] @called)))))

;; Covers storing partial-login session state when MFA is required after password validation.
;; This matters because Python tests cover user-visible MFA flows, but Clojure is the better place
;; to assert this internal session mutation precisely at the exception boundary.
(deftest login-with-email-sets-partial-logged-in-id-on-mfa-required
  (binding [rpc-util/*session-state* (atom {:users {}})]
    (with-redefs [user-util/get-user-props (fn [] {:table_id "users-table" :use_email true :require_mfa true})
                  table-rpc/validate-fetch-request identity
                  user-util/table-get-from-email-check-enabled-and-validate (fn [_ _ _] :user-row)
                  user-util/get-in-user-row (fn [_ k & [_default]]
                                              (case k
                                                :confirmed_email true
                                                :password_hash "pw-hash"
                                                :n_password_failures 0
                                                :mfa []
                                                nil))
                  anvil.util/bcrypt-checkpw (fn [_ _] true)
                  user-util/user-row->v1-id-str (fn [_] "[users-table,1]")
                  users-v2/login! (fn [& _] :unexpected-login!)]
      (try+
        (users-v2/login-with-email {:remember false :fetch {:email true}} "user@test.com" "password")
        (is false "Expected MFARequired")
        (catch #(= "anvil.users.MFARequired" (:type %)) _
          (is (= "[users-table,1]" (get-in @rpc-util/*session-state* [:users :partial-logged-in-id]))))))))

;; Covers provider-login failure before any table lookup when the provider session has no email.
;; This matters because Python already covers the public provider-session failure, but Clojure is
;; the better place to verify the shared handler short-circuits before downstream table access.
(deftest social-login-rejects-missing-provider-email
  (doseq [{:keys [handler permission prop]} provider-login-handlers]
    (let [lookups (atom 0)]
      (with-redefs [user-util/get-user-props (fn [] {prop true :table_id "users-table" :allow_signup false})
                    users-v2/get-and-check-current-user-email-from-required-permission
                    (fn [_required-permission]
                      (throw+ {:anvil/server-error "User is not logged in with provider"}))
                    user-util/table-get-from-email-check-enabled-and-validate
                    (fn [_table-id _email _fetch]
                      (swap! lookups inc)
                      :unexpected-user-row)]
        (try+
          (handler {:remember false})
          (is false (str "Expected provider-email failure for permission " permission))
          (catch :anvil/server-error e
            (is (= "User is not logged in with provider" (:anvil/server-error e))))
          (catch Object e
            (is false (str "Unexpected exception: " e))))
        (is (zero? @lookups) "Provider-email failure should happen before any table lookup")))))

;; Covers provider-login auto-signup routing when signup is enabled and no user row exists yet.
;; This matters because Python covers provider auth outcomes, but Clojure is the better place to
;; verify the shared handler wiring and arguments for the auto-signup branch across all providers.
(deftest social-login-handlers-auto-signup-when-allowed
  (doseq [{:keys [handler permission prop]} provider-login-handlers]
    (let [seen (atom [])]
      (with-redefs [user-util/get-user-props (fn [] {prop true :table_id "users-table" :allow_signup true})
                    users-v2/get-and-check-current-user-email-from-required-permission
                    (fn [required-permission]
                      (swap! seen conj [:required-permission required-permission])
                      "provider@signup-login.test")
                    table-rpc/validate-fetch-request identity
                    user-util/table-get-from-email-check-enabled-and-validate (fn [_ _ _] nil)
                    users-v2/signup-common-from-email
                    (fn [required-permission email user-props kws]
                      (swap! seen conj [:signup required-permission email user-props kws])
                      {:signed-up true})]
        (is (= {:signed-up true} (handler {:remember false :fetch {:email true}})))
        (is (some #(= [:required-permission permission] %) @seen))
        (is (some #(= [:signup permission "provider@signup-login.test" {prop true :table_id "users-table" :allow_signup true} {:remember false :fetch {:email true}}] %) @seen))))))

;; Covers signup handler collisions propagating UserExists across all provider variants.
;; This matters because Python covers email-signup collisions, but Clojure is the better place to
;; pin the shared provider-signup collision branch and its internal delegation consistently.
(deftest social-signup-account-link-collision
  (doseq [{:keys [handler permission]} provider-signup-handlers]
    (let [calls (atom 0)]
      (with-redefs [users-v2/get-and-check-current-user-email-from-required-permission
                    (fn [_required-permission] "provider@collision.test")
                    user-util/get-user-props (fn [] {permission true :table_id "users-table" :allow_signup true})
                    users-v2/signup-common-from-email
                    (fn [_required-permission _email _user-props _kws]
                      (swap! calls inc)
                      (throw+ {:anvil/server-error "This user already exists" :type "anvil.users.UserExists"}))]
        (try+
          (handler {:remember false})
          (is false (str "Expected UserExists collision for permission " permission))
          (catch #(= "anvil.users.UserExists" (:type %)) e
            (is (= "anvil.users.UserExists" (:type e))))
          (catch Object e
            (is false (str "Unexpected exception: " e))))
        (is (= 1 @calls))))))

;; Covers token generation with empty trailing fields, matching Java split semantics.
;; This matters because Python tests cover normal token flows, but Clojure is the better place to
;; assert this narrow serialization edge case without relying on public handler round-trips.
(deftest generate-email-link-token-allows-empty-email-and-kind
  (binding [rpc-util/*app-id* "app-123"]
    (with-redefs [secrets/encrypt-str-with-global-key (fn [_ token] token)]
      (let [token (users-v2/generate-email-link-token nil "" "")
            [email app-id _time kind] (.split token "#")]
        (is (= "" email))
        (is (= "app-123" app-id))
        ;; Java split drops trailing empty segments when limit is omitted.
        (is (nil? kind))))))
