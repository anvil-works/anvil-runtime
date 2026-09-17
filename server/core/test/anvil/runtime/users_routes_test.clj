(ns anvil.runtime.users-routes-test
  (:require [anvil.dispatcher.native-rpc-handlers.users.util :as users-util]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.runtime.secrets :as secrets]
            [anvil.runtime.server :as server]
            [anvil.runtime.sessions :as sessions]
            [anvil.runtime.tables.v2.util :as tables-util]
            [anvil.runtime.tables.util :as table-mapping]
            [anvil.runtime.util :as runtime-util]
            [clojure.test :refer [deftest is testing]]))

;; Keep HTTP dispatch and Users handlers real; replace storage and rendering.
(deftest token-links-use-request-session
  (doseq [[path token-type state-key] [["login" "login" :logged-in-id]
                                      ["reset_password" "pw-reset" :password-reset-user-id]
                                      ["login" "mfa-reset" :mfa-reset-user-id]]
          valid? [true false]]
    (testing (str path " " token-type " valid=" valid?)
      (let [session (atom {})
            persisted (atom [])
            request {:request-method :get :uri (str "/_/" path "/token")
                     :app-origin "https://app.example" :environment :dev :app-session session}]
        (with-redefs [server/get-app-from-request (fn [_] {:id "app" :content {}})
                      secrets/decrypt-str-with-global-key
                      (fn [key token]
                        (is (= [:ut "token"] [key token]))
                        (if valid?
                          (str "user@example.com#app#" (System/currentTimeMillis) "#" token-type)
                          (throw (ex-info "Invalid ciphertext" {}))))
                      users-util/get-user-props
                      (fn []
                        (is (identical? session rpc-util/*session-state*))
                        (is (= :dev rpc-util/*environment*))
                        {:table_id 42 :use_token true})
                      users-util/table-get-from-email-check-enabled-and-validate
                      (fn [table-id email fetch]
                        (is (= [42 "user@example.com" nil] [table-id email fetch]))
                        [:view 42 7 {}])
                      sessions/persist! #(swap! persisted conj %)
                      sessions/url-token (constantly "session-token")]
          (let [response (server/app-routes request)]
            (if valid?
              (do
                (is (= 302 (:status response)))
                (is (= "https://app.example?_anvil_session=session-token"
                       (get-in response [:headers "Location"])))
                (is (= {:users {state-key "[42,7]"}} @session))
                (is (= [session] @persisted)))
              (do
                (is (nil? response))
                (is (= {} @session))
                (is (empty? @persisted))))))))))

(deftest confirmation-links-update-only-with-correct-key
  (doseq [key ["correct" "wrong"]]
    (let [updates (atom [])]
      (with-redefs [server/get-app-from-request (fn [_] {:id "app" :content {}})
                    users-util/get-user-props (constantly {:table_id 42 :use_email true
                                                         :allow_signup true :confirm_email true})
                    users-util/table-get-row-from-query (fn [_ _] :user-row)
                    users-util/get-in-user-row (fn [_ _] "correct")
                    users-util/update-user-row-creating-cols-as-necessary
                    (fn [row attrs] (swap! updates conj [row attrs]))
                    runtime-util/runtime-client-resource (fn [_ path] path)
                    runtime-util/serve-templated-html (fn [& _] {:status 200})]
        (let [response (server/app-routes {:request-method :get
                                          :uri (str "/_/email-confirm/user@example.com/" key)
                                          :environment :dev :app-origin "https://app.example"})]
          (if (= key "correct")
            (do
              (is (= 200 (:status response)))
              (is (= [[:user-row {:confirmed_email true :email_confirmation_key nil}]] @updates)))
            (do
              (is (= "https://app.example" (get-in response [:headers "Location"])))
              (is (empty? @updates)))))))))

(deftest password-reset-links-use-promoted-users-handler
  (doseq [key ["correct" "wrong"]]
    (let [updates (atom [])]
      (with-redefs [server/get-app-from-request
                    (fn [_] {:id "app"
                             :content {:services [{:source "/runtime/services/anvil/users.yml"
                                                   :client_config {:use_email true :confirm_email true}
                                                   :server_config {:user_table 42}}]}})
                    table-mapping/table-mapping-for-environment (fn [_ _] :mapping)
                    tables-util/get-tables
                    (fn [_]
                      (is (= "app" rpc-util/*app-id*))
                      (is (= :dev rpc-util/*environment*))
                      (is (some? rpc-util/*session-state*))
                      {42 {:python_name "users"}})
                    users-util/table-get-row-from-query (fn [_ _] :user-row)
                    users-util/get-in-user-row (fn [_ _] "correct")
                    users-util/update-user-row-creating-cols-as-necessary
                    (fn [row attrs] (swap! updates conj [row attrs]))
                    runtime-util/runtime-client-resource (fn [_ path] path)
                    runtime-util/serve-templated-html (fn [& _] {:status 200})]
        (let [request {:uri (str "/_/email-pw-reset/user@example.com/" key) :environment :dev}
              get-response (server/app-routes (assoc request :request-method :get))
              post-response (server/app-routes (assoc request :request-method :post
                                                      :params {:password "new-password"}))]
          (if (= key "correct")
            (do
              (is (= [200 200] (mapv :status [get-response post-response])))
              (is (= 1 (count @updates)))
              (let [[row attrs] (first @updates)]
                (is (= :user-row row))
                (is (= {:email_confirmation_key nil :confirmed_email true}
                       (dissoc attrs :password_hash)))
                (is (org.mindrot.jbcrypt.BCrypt/checkpw "new-password" (:password_hash attrs)))))
            (do
              (is (nil? get-response))
              (is (nil? post-response))
              (is (empty? @updates)))))))))
