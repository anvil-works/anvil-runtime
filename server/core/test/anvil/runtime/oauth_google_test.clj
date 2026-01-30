(ns anvil.runtime.oauth-google-test
  (:require [anvil.core.sso.google :as google-sso]
            [anvil.runtime.conf :as conf]
            [anvil.runtime.oauth :as oauth]
            [anvil.runtime.secrets :as secrets]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [clojure.walk :as walk]
            [ring.util.codec :as ring-codec]
            [org.senatehouse.expect-call :refer [expect-call]]
            [clj-commons.slingshot.test :refer [thrown+?]]))

(deftest test-google-oauth-redirect
  (with-redefs [conf/runtime-common-url "https://anvil.example.com"
                conf/google-client-config {:client-id "12345"}]
    (let [app {}
          app-origin "https://app.example.com"
          allow-app-origin-redirect? false
          scope "custom-scope"
          req-server-name "anvil.example.com"
          callback-path "/_/client_auth_callback"]

      (testing "Basic redirect"
        (let [result (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)]

          (is (= "https://anvil.example.com/_/client_auth_callback" (:redirect-uri result)))
          (is (= 120 (count (:csrf-token result))))

          (is (str/starts-with? (:google-url result) "https://accounts.google.com/o/oauth2/auth?"))
          (let [params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:google-url result) #"\?"))))]
            (is (= {:access_type   "online"
                    :client_id     "12345"
                    :prompt        ""
                    :redirect_uri  "https://anvil.example.com/_/client_auth_callback"
                    :response_type "code"
                    ;; Don't allow a custom scope request, use the email-only scope
                    :scope         "https://www.googleapis.com/auth/userinfo.email"
                    :state         (:csrf-token result)}
                   params)))))

      (testing "Config from app"
        (let [app {:content {:services [{:source        "/runtime/services/google.yml"
                                         :server_config {:client_id "98765"}}]}}
              result (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)]

          (is (= "https://anvil.example.com/_/client_auth_callback" (:redirect-uri result)))

          (let [params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:google-url result) #"\?"))))]
            (is (= "offline" (:access_type params)))
            (is (= "98765" (:client_id params)))
            (is (= "consent select_account" (:prompt params)))
            (is (= "custom-scope" (:scope params))))))

      (testing "Config from app with app-origin redirect should restart at the app origin"
        (let [app {:content {:services [{:source        "/runtime/services/google.yml"
                                         :server_config {:client_id           "98765"
                                                         :app_origin_redirect true}}]}}
              allow-app-origin-redirect? true]

          (is (thrown+? [::oauth/restart-oauth-from-origin true, :origin "https://app.example.com"]
                        (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)))

          (let [req-server-name "app.example.com"
                result (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)]

            (is (= "https://app.example.com/_/client_auth_callback" (:redirect-uri result))))))

      (testing "Config from app with unpermitted app-origin should use redirect runtime origin"
        ;; This covers the case where the user has enabled :app_origin_redirect, but is running from an environment
        ;; that isn't a custom domain. In this case we shouldn't perform OAuth in the app-origin
        (let [app {:content {:services [{:source        "/runtime/services/google.yml"
                                         :server_config {:client_id           "98765"
                                                         :app_origin_redirect true}}]}}
              allow-app-origin-redirect? false

              result (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)]

          (is (= "https://anvil.example.com/_/client_auth_callback" (:redirect-uri result)))))

      (testing "Redirect from an invalid origin"
        (let [req-server-name "invalid.example.com"]

          (is (thrown+? [::oauth/invalid-oauth-origin true, :origin "https://anvil.example.com"]
                        (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)))))

      (testing "Custom main config allows any scope"
        (with-redefs [conf/google-client-config {:client-id "98765"
                                                 :custom?   true}]
          (let [result (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)

                params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:google-url result) #"\?"))))]
            (is (= "custom-scope" (:scope params))))))

      (testing "Empty client ID in app config is ignored"
        (let [app {:content {:services [{:source        "/runtime/services/google.yml"
                                         :server_config {:client_id ""}}]}}
              result (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)]

          (is (= "https://anvil.example.com/_/client_auth_callback" (:redirect-uri result)))

          (let [params (walk/keywordize-keys (ring-codec/form-decode (second (str/split (:google-url result) #"\?"))))]
            (is (= "online" (:access_type params)))
            (is (= "12345" (:client_id params)))
            (is (= "" (:prompt params)))
            (is (= "https://www.googleapis.com/auth/userinfo.email" (:scope params))))))

      (testing "Missing client ID in main config"
        (with-redefs [conf/google-client-config {}]

          (is (thrown+? [::oauth/no-client-id true]
                        (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path)))))

      (testing "Empty client ID in main config"
        (with-redefs [conf/google-client-config {:client-id ""}]

          (is (thrown+? [::oauth/no-client-id true]
                        (oauth/google-redirect app app-origin allow-app-origin-redirect? scope req-server-name callback-path))))))))

(deftest test-google-oauth-callback
  (with-redefs [conf/google-client-config {:client-id "12345"
                                           :client-secret "main-config-secret"}]
    (let [app {}
          code "auth-code"
          state "csrf-from-state"
          csrf-token "csrf-token"
          redirect-uri "redirect-uri"]

      (testing "Basic callback"
        (expect-call (google-sso/process-callback [code state csrf-token scopes client-id client-secret redirect-uri]
                       (is (= "auth-code" code))
                       (is (= "csrf-from-state" state))
                       (is (= "csrf-token" csrf-token))
                       (is (nil? scopes))  ; Don't require all scopes to be granted - that's for the app developer to decide.
                       (is (= "12345" client-id))
                       (is (= "main-config-secret" client-secret))
                       (is (= "redirect-uri" redirect-uri))
                       "tokens")

          (let [tokens (oauth/google-callback app code state csrf-token redirect-uri)]
            (is (= "tokens" tokens)))))

      (testing "Config from app with unencrypted secret"
        (let [app {:content {:services [{:source        "/runtime/services/google.yml"
                                         :server_config {:client_id     "98765"
                                                         :client_secret "app-config-secret"}}]}}]

          (expect-call (google-sso/process-callback [_ _ _ _ client-id client-secret _]
                         (is (= "98765" client-id))
                         (is (= "app-config-secret" client-secret)))

            (oauth/google-callback app code state csrf-token redirect-uri))))

      (testing "Config from app with encrypted secret"
        (let [app {:content {:services [{:source        "/runtime/services/google.yml"
                                         :server_config {:client_id         "98765"
                                                         :client_secret_enc "app-config-secret-enc"}}]}}]

          (expect-call (secrets/get-global-app-secret-value [_ _ encrypted-secret]
                         (is (= "app-config-secret-enc" encrypted-secret))
                         {:value "app-config-secret"})

            (expect-call (google-sso/process-callback [_ _ _ _ client-id client-secret _]
                           (is (= "98765" client-id))
                           (is (= "app-config-secret" client-secret)))

              (oauth/google-callback app code state csrf-token redirect-uri)))))

      (testing "Empty client ID in app config is ignored"
        (let [app {:content {:services [{:source        "/runtime/services/google.yml"
                                         :server_config {:client_id ""}}]}}]

          (expect-call (google-sso/process-callback [_ _ _ _ client-id client-secret _]
                         (is (= "12345" client-id))
                         (is (= "main-config-secret" client-secret)))

            (oauth/google-callback app code state csrf-token redirect-uri))))
      )))