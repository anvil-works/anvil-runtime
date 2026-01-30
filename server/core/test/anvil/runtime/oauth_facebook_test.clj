(ns anvil.runtime.oauth-facebook-test
  (:require [anvil.core.sso.facebook :as facebook-sso]
            [anvil.runtime.conf :as conf]
            [anvil.runtime.oauth :as oauth]
            [anvil.runtime.secrets :as secrets]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [clojure.walk :as walk]
            [ring.util.codec :as ring-codec]
            [org.senatehouse.expect-call :refer [expect-call]]
            [clj-commons.slingshot.test :refer [thrown+?]]))

(deftest test-facebook-oauth-redirect
  (with-redefs [conf/runtime-common-url "https://anvil.example.com"
                conf/facebook-client-config {:app-id "12345"}]
    (let [app {}
          scope ""
          callback-path "/_/facebook_auth_callback"]

      (testing "Basic redirect"
        (let [result (oauth/facebook-redirect app scope callback-path)]

          (is (= 120 (count (:csrf-token result))))

          (is (str/starts-with? (:facebook-url result) "https://www.facebook.com/v3.2/dialog/oauth?"))
          (let [params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:facebook-url result) #"\?"))))]
            (is (= {:client_id     "12345"
                    :redirect_uri  "https://anvil.example.com/_/facebook_auth_callback"
                    :scope         "email"
                    :state         (:csrf-token result)
                    :display       "popup"}
                   params)))))

      (testing "Config from app"
        (let [app {:content {:services [{:source        "/runtime/services/facebook.yml"
                                         :server_config {:app_id "98765"}}]}}
              scope "custom-scope"
              result (oauth/facebook-redirect app scope callback-path)

              params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:facebook-url result) #"\?"))))]
          (is (= "98765" (:client_id params)))
          (is (= "email,custom-scope" (:scope params)))))

      (testing "Empty app ID in app config is ignored"
        (let [app {:content {:services [{:source        "/runtime/services/facebook.yml"
                                         :server_config {:app_id ""}}]}}
              result (oauth/facebook-redirect app scope callback-path)

              params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:facebook-url result) #"\?"))))]
          (is (= "12345" (:client_id params)))))

      (testing "Custom main config allows any scope"
        (with-redefs [conf/facebook-client-config {:app-id "98765"
                                                   :custom? true}]
          (let [scope "custom-scope"
                result (oauth/facebook-redirect app scope callback-path)

                params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:facebook-url result) #"\?"))))]
            (is (= "email,custom-scope" (:scope params))))))

      (testing "Can't request custom scope without a custom client ID"
        (let [scope "custom-scope"]

          (is (thrown+? [::oauth/no-client-id true]
                        (oauth/facebook-redirect app scope callback-path)))))

      )))

(deftest test-facebook-oauth-callback
  (with-redefs [conf/facebook-client-config {:app-id "12345"
                                             :app-secret "main-config-secret"}]
    (let [app {}
          code "auth-code"
          state "csrf-from-state"
          csrf-token "csrf-token"
          redirect-uri "redirect-uri"]

      (testing "Basic callback"
        (expect-call (facebook-sso/process-callback [code state csrf-token client-id client-secret redirect-uri]
                       (is (= "auth-code" code))
                       (is (= "csrf-from-state" state))
                       (is (= "csrf-token" csrf-token))
                       (is (= "12345" client-id))
                       (is (= "main-config-secret" client-secret))
                       (is (= "redirect-uri" redirect-uri))
                       "tokens")

          (let [tokens (oauth/facebook-callback app code state csrf-token redirect-uri)]
            (is (= "tokens" tokens)))))

      (testing "Config from app with unencrypted secret"
        (let [app {:content {:services [{:source        "/runtime/services/facebook.yml"
                                         :server_config {:app_id     "98765"
                                                         :app_secret "app-config-secret"}}]}}]

          (expect-call (facebook-sso/process-callback [_ _ _ client-id client-secret _]
                         (is (= "98765" client-id))
                         (is (= "app-config-secret" client-secret)))

            (oauth/facebook-callback app code state csrf-token redirect-uri))))

      (testing "Config from app with encrypted secret"
        (let [app {:content {:services [{:source        "/runtime/services/facebook.yml"
                                         :server_config {:app_id         "98765"
                                                         :app_secret_enc "app-config-secret-enc"}}]}}]

          (expect-call (secrets/get-global-app-secret-value [_ _ encrypted-secret]
                         (is (= "app-config-secret-enc" encrypted-secret))
                         {:value "app-config-secret"})

            (expect-call (facebook-sso/process-callback [_ _ _ client-id client-secret _]
                           (is (= "98765" client-id))
                           (is (= "app-config-secret" client-secret)))

              (oauth/facebook-callback app code state csrf-token redirect-uri)))))

      (testing "Empty client ID in app config is ignored"
        (let [app {:content {:services [{:source        "/runtime/services/facebook.yml"
                                         :server_config {:client_id ""}}]}}]

          (expect-call (facebook-sso/process-callback [_ _ _ client-id client-secret _]
                         (is (= "12345" client-id))
                         (is (= "main-config-secret" client-secret)))

            (oauth/facebook-callback app code state csrf-token redirect-uri))))

      )))