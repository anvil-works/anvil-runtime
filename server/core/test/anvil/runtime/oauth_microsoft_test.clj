(ns anvil.runtime.oauth-microsoft-test
  (:require [anvil.core.sso.azure :as azure-sso]
            [anvil.runtime.conf :as conf]
            [anvil.runtime.oauth :as oauth]
            [anvil.runtime.secrets :as secrets]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [clojure.walk :as walk]
            [ring.util.codec :as ring-codec]
            [org.senatehouse.expect-call :refer [expect-call]]
            [clj-commons.slingshot.test :refer [thrown+?]]))

(deftest test-microsoft-oauth-redirect
  (with-redefs [conf/runtime-common-url "https://anvil.example.com"
                conf/microsoft-client-config {:application-id "12345"
                                              :tenant-id "main-tenant-id"}]
    (let [app {}
          scope ""
          callback-path "/_/microsoft_auth_callback"]

      (testing "Basic redirect"
        (let [result (oauth/microsoft-redirect app scope callback-path)]

          (is (= 120 (count (:csrf-token result))))
          (is (= 120 (count (:nonce result))))

          (is (str/starts-with? (:microsoft-url result) "https://login.microsoftonline.com/main-tenant-id/oauth2/v2.0/authorize?"))
          (let [params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:microsoft-url result) #"\?"))))]
            (is (= {:client_id     "12345"
                    :redirect_uri  "https://anvil.example.com/_/microsoft_auth_callback"
                    :scope         "openid email profile"
                    :state         (:csrf-token result)
                    :nonce         (:nonce result)
                    :response_mode "form_post"
                    :response_type "id_token"}
                   params)))))

      (testing "Config from app"
        (let [app {:content {:services [{:source        "/runtime/services/anvil/microsoft.yml"
                                         :server_config {:application_id "98765"
                                                         :application_secret "app-config-secret"
                                                         :tenant_id "app-tenant-id"
                                                         :additional_oauth_scopes "additional-scope"}}]}}
              scope "custom-scope"
              result (oauth/microsoft-redirect app scope callback-path)]

          (is (str/starts-with? (:microsoft-url result) "https://login.microsoftonline.com/app-tenant-id/oauth2/v2.0/authorize?"))
          (let [params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:microsoft-url result) #"\?"))))]
            (is (= "98765" (:client_id params)))
            (is (= "openid email profile offline_access custom-scope additional-scope" (:scope params)))
            (is (= "code" (:response_type params))))))

      (testing "Empty app ID in app config is ignored"
        (let [app {:content {:services [{:source        "/runtime/services/anvil/microsoft.yml"
                                         :server_config {:application_id ""}}]}}
              result (oauth/microsoft-redirect app scope callback-path)]

          (is (str/starts-with? (:microsoft-url result) "https://login.microsoftonline.com/main-tenant-id/oauth2/v2.0/authorize?"))
          (let [params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:microsoft-url result) #"\?"))))]
            (is (= "12345" (:client_id params)))
            (is (= "id_token" (:response_type params))))))

      (testing "Missing tenant ID in main config uses common URL"
        (with-redefs [conf/microsoft-client-config {:application-id "98765"}]
          (let [result (oauth/microsoft-redirect app scope callback-path)]

            (is (str/starts-with? (:microsoft-url result) "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?")))))

      (testing "Empty tenant ID in app config uses common URL"
        (let [app {:content {:services [{:source        "/runtime/services/anvil/microsoft.yml"
                                         :server_config {:application_id "98765"
                                                         :application_secret "app-config-secret"
                                                         :tenant_id ""}}]}}
              result (oauth/microsoft-redirect app scope callback-path)]

          (is (str/starts-with? (:microsoft-url result) "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"))))

      (testing "Custom main config allows any scope"
        (with-redefs [conf/microsoft-client-config {:application-id "98765"
                                                    :application-secret "main-config-secret"
                                                    :custom? true}]
          (let [scope "custom-scope"
                result (oauth/microsoft-redirect app scope callback-path)

                params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:microsoft-url result) #"\?"))))]
            (is (= "openid email profile offline_access custom-scope" (:scope params))))))

      (testing "Can't request custom scope without a custom client ID"
        (let [scope "custom-scope"]

          (is (thrown+? [::oauth/no-client-id true]
                        (oauth/microsoft-redirect app scope callback-path)))))

      (testing "Can't request additional scope without a custom client ID"
        (let [app {:content {:services [{:source        "/runtime/services/anvil/microsoft.yml"
                                         :server_config {:application_id ""
                                                         :additional_oauth_scopes "additional-scope"}}]}}]
          (is (thrown+? [::oauth/no-client-id true]
                        (oauth/microsoft-redirect app scope callback-path)))))
      )))

(deftest test-microsoft-oauth-callback
  (with-redefs [conf/microsoft-client-config {:application-id "12345"
                                              :application-secret "main-config-secret"
                                              :tenant-id "main-tenant-id"}]
    (let [app {}
          code "auth-code"
          state "csrf-from-state"
          csrf-token "csrf-token"
          nonce "nonce"
          redirect-uri "redirect-uri"]

      (testing "OpenID callback"
        (expect-call (azure-sso/process-callback [code state id-token csrf-token nonce tenant-id application-id application-secret redirect-uri]
                       (is (= "auth-code" code))
                       (is (= "csrf-from-state" state))
                       (is (= "id-token" id-token))
                       (is (= "csrf-token" csrf-token))
                       (is (= "nonce" nonce))
                       (is (= "redirect-uri" redirect-uri))
                       "tokens")

          (let [id-token "id-token"
                tokens (oauth/microsoft-callback app code state id-token csrf-token nonce redirect-uri)]
            (is (= "tokens" tokens)))))

      (testing "OAuth config from app with unencrypted secret"
        (let [app {:content {:services [{:source        "/runtime/services/anvil/microsoft.yml"
                                         :server_config {:application_id     "98765"
                                                         :application_secret "app-config-secret"
                                                         :tenant_id          "app-tenant-id"}}]}}
              id-token nil]

          (expect-call (azure-sso/process-callback [_ _ _ _ _ tenant-id application-id application-secret _]
                         (is (= "app-tenant-id" tenant-id))
                         (is (= "98765" application-id))
                         (is (= "app-config-secret" application-secret)))

            (oauth/microsoft-callback app code state id-token csrf-token nonce redirect-uri))))

      (testing "OAuth config from app with encrypted secret"
        (let [app {:content {:services [{:source        "/runtime/services/anvil/microsoft.yml"
                                         :server_config {:application_id         "98765"
                                                         :application_secret_enc "app-config-secret-enc"
                                                         :tenant_id              "app-tenant-id"}}]}}
              id-token nil]

          (expect-call (secrets/get-global-app-secret-value [_ _ encrypted-secret]
                         (is (= "app-config-secret-enc" encrypted-secret))
                         {:value "app-config-secret"})

            (expect-call (azure-sso/process-callback [_ _ _ _ _ tenant-id application-id application-secret _]
                           (is (= "app-tenant-id" tenant-id))
                           (is (= "98765" application-id))
                           (is (= "app-config-secret" application-secret)))

              (oauth/microsoft-callback app code state id-token csrf-token nonce redirect-uri))))

      (testing "Custom OAuth config in main config"
        (with-redefs [conf/microsoft-client-config {:application-id     "12345"
                                                    :application-secret "main-config-secret"
                                                    :tenant-id          "main-tenant-id"
                                                    :custom?            true}]
          (let [id-token nil]

            (expect-call (azure-sso/process-callback [_ _ _ _ _ tenant-id application-id application-secret _]
                           (is (= "main-tenant-id" tenant-id))
                           (is (= "12345" application-id))
                           (is (= "main-config-secret" application-secret)))

              (oauth/microsoft-callback app code state id-token csrf-token nonce redirect-uri)))))

      (testing "Empty app ID in app config is ignored"
        (with-redefs [conf/microsoft-client-config {:application-id     "12345"
                                                    :application-secret "main-config-secret"
                                                    :tenant-id          "main-tenant-id"
                                                    :custom?            true}]
          (let [app {:content {:services [{:source        "/runtime/services/anvil/microsoft.yml"
                                           :server_config {:application_id ""}}]}}
                id-token nil]

            (expect-call (azure-sso/process-callback [_ _ _ _ _ tenant-id application-id application-secret _]
                           (is (= "main-tenant-id" tenant-id))
                           (is (= "12345" application-id))
                           (is (= "main-config-secret" application-secret)))

              (oauth/microsoft-callback app code state id-token csrf-token nonce redirect-uri)))))))))