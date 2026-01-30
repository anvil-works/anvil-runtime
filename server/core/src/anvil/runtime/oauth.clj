(ns anvil.runtime.oauth
  (:require [anvil.core.sso.azure :as azure-sso]
            [anvil.core.sso.facebook :as facebook-sso]
            [anvil.core.sso.google :as google-sso]
            [anvil.runtime.conf :as conf]
            [anvil.runtime.secrets :as secrets]
            [anvil.util :as util]
            [clojure.string :as str]
            [hiccup.core :as hiccup]
            [ring.util.response :as resp]
            [clj-commons.slingshot :refer [throw+]])
  (:import (java.net URI)))

(defn google-redirect [app app-origin allow-app-origin-redirect? requested-scope req-server-name callback-path]
  (let [google-service (first (filter #(= (:source %) "/runtime/services/google.yml") (get-in app [:content :services])))
        custom-client-id (not-empty (or (get-in google-service [:server_config :client_id])
                                        (and (:custom? conf/google-client-config) (:client-id conf/google-client-config))))

        scope (if custom-client-id
                requested-scope
                "https://www.googleapis.com/auth/userinfo.email")
        offline-access? (some? custom-client-id)

        client-id (or custom-client-id
                      (:client-id conf/google-client-config))

        redirect-origin (if (and custom-client-id
                                 allow-app-origin-redirect?
                                 (get-in google-service [:server_config :app_origin_redirect]))
                          app-origin
                          conf/runtime-common-url)
        redirect-uri (str redirect-origin callback-path)]

    ;; The user can configure :app_origin_redirect to perform OAuth on the App Origin.
    ;; Restart OAuth on the app origin if necessary, so we can do the OAuth flow without crossing origins.
    (if-not (str/starts-with? (.getAuthority (URI. redirect-origin)) req-server-name)
      (if (= redirect-origin app-origin)
        (throw+ {::restart-oauth-from-origin true, :origin redirect-origin})
        (throw+ {::invalid-oauth-origin true, :origin redirect-origin}))

      (if (empty? client-id)
        (throw+ {::no-client-id true})

        (let [[url csrf-token] (google-sso/get-login-url client-id redirect-uri scope offline-access?)]
          {:google-url   url
           :csrf-token   csrf-token
           :redirect-uri redirect-uri})))))

(defn google-callback [app code state csrf-token redirect-uri]
  (let [google-service (first (filter #(= (:source %) "/runtime/services/google.yml") (get-in app [:content :services])))
        client-id-from-app (not-empty (get-in google-service [:server_config :client_id]))

        client-id (or client-id-from-app
                      (:client-id conf/google-client-config))

        client-secret (if client-id-from-app
                        (or (when-let [encrypted-client-secret (get-in google-service [:server_config :client_secret_enc])]
                              (:value (secrets/get-global-app-secret-value (:info app) "google-service/client-secret" encrypted-client-secret)))
                            (get-in google-service [:server_config :client_secret]))
                        (:client-secret conf/google-client-config))]

    (google-sso/process-callback code
                                 state
                                 csrf-token
                                 nil  ; Don't require all scopes to be granted - that's for the app developer to decide.
                                 client-id
                                 client-secret
                                 redirect-uri)))

(defn facebook-redirect [app requested-scope callback-path]
  (let [facebook-service (first (filter #(= (:source %) "/runtime/services/facebook.yml") (get-in app [:content :services])))
        custom-client-id (not-empty (or (get-in facebook-service [:server_config :app_id])
                                        (and (:custom? conf/facebook-client-config) (:app-id conf/facebook-client-config))))

        scope (if custom-client-id
                (str "email," requested-scope)
                "email")

        client-id (or custom-client-id
                      (:app-id conf/facebook-client-config))

        redirect-uri (str conf/runtime-common-url callback-path)]

    (if (and (not-empty requested-scope)
             (not custom-client-id))
      (throw+ {::no-client-id true})

      (let [[url csrf-token] (facebook-sso/get-login-url client-id redirect-uri scope)]
        {:facebook-url url :csrf-token csrf-token}))))

(defn facebook-callback [app code state csrf-token redirect-uri]
  (let [facebook-service (first (filter #(= (:source %) "/runtime/services/facebook.yml") (get-in app [:content :services])))
        client-id-from-app (not-empty (get-in facebook-service [:server_config :app_id]))

        client-id (or client-id-from-app
                      (:app-id conf/facebook-client-config))

        client-secret (if client-id-from-app
                        (or (when-let [encrypted-app-secret (get-in facebook-service [:server_config :app_secret_enc])]
                              (:value (secrets/get-global-app-secret-value (:info app) "facebook-service/app-secret" encrypted-app-secret)))
                            (get-in facebook-service [:server_config :app_secret]))
                        (:app-secret conf/facebook-client-config))]

    (facebook-sso/process-callback code
                                   state
                                   csrf-token
                                   client-id
                                   client-secret
                                   redirect-uri)))

(defn microsoft-redirect [app requested-scope callback-path]
  ;; We implement OpenID Connect here: https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-v2-protocols-oidc
  ;; To register an app, visit https://apps.dev.microsoft.com/#/appList
  ;; Set redirect_url to https://anvil.works/apps/_/microsoft_auth_callback
  ;; No need for an Application Secret if just using login.
  (let [microsoft-service (first (filter #(= (:source %) "/runtime/services/anvil/microsoft.yml") (get-in app [:content :services])))
        custom-app-id (not-empty (or (get-in microsoft-service [:server_config :application_id])
                                     (and (:custom? conf/microsoft-client-config) (:application-id conf/microsoft-client-config))))

        additional-scope (get-in microsoft-service [:server_config :additional_oauth_scopes])
        custom-scope (.trim (str requested-scope " " additional-scope))
        scope (if custom-app-id
                (str "openid email profile offline_access " custom-scope)
                "openid email profile")

        app-id (or custom-app-id
                   (:application-id conf/microsoft-client-config))

        tenant-id (if custom-app-id
                    (or (get-in microsoft-service [:server_config :tenant_id])
                        (and (:custom? conf/microsoft-client-config) (:tenant-id conf/microsoft-client-config)))
                    (:tenant-id conf/microsoft-client-config))

        redirect-uri (str conf/runtime-common-url callback-path)]

    (if (and (not-empty custom-scope)
             (not custom-app-id))
      (throw+ {::no-client-id true})

      (let [[url csrf-token nonce] (azure-sso/get-login-url tenant-id
                                                            app-id
                                                            (if custom-app-id "code" "id_token")
                                                            scope
                                                            redirect-uri)]
        {:microsoft-url url :csrf-token csrf-token :nonce nonce}))))

(defn microsoft-callback [app code state id-token csrf-token nonce redirect-uri]
  ;; Tokens reference: https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-v2-tokens
  ;; There are two possible flows:
  ;;  - If id-token is provided, use OpenID and ignore app configurstion
  ;;  - Otherwise use OAuth with a custom app configuration
  (let [microsoft-service (first (filter #(= (:source %) "/runtime/services/anvil/microsoft.yml") (get-in app [:content :services])))
        app-id-from-app (not-empty (get-in microsoft-service [:server_config :application_id]))

        app-id (or app-id-from-app
                   (and (:custom? conf/microsoft-client-config) (:application-id conf/microsoft-client-config)))

        app-secret (if app-id-from-app
                     (or (when-let [encrypted-app-secret (get-in microsoft-service [:server_config :application_secret_enc])]
                           (:value (secrets/get-global-app-secret-value (:info app) "microsoft-service/application-secret" encrypted-app-secret)))
                         (get-in microsoft-service [:server_config :application_secret]))
                     (and (:custom? conf/microsoft-client-config) (:application-secret conf/microsoft-client-config)))

        tenant-id (if app-id-from-app
                    (get-in microsoft-service [:server_config :tenant_id])
                    (and (:custom? conf/microsoft-client-config) (:tenant-id conf/microsoft-client-config)))]

    (azure-sso/process-callback code state id-token csrf-token nonce tenant-id app-id app-secret redirect-uri)))


(def success-callbacks {:facebook  "facebookAuthSuccessCallback"
                        :github    nil
                        :google    "googleAuthSuccessCallback"
                        :microsoft "microsoftAuthSuccessCallback"
                        :saml      "samlAuthSuccessCallback"
                        :stripe    nil})

(def error-callbacks {:facebook  "facebookAuthErrorCallback"
                      :github    nil
                      :google    "googleAuthErrorCallback"
                      :microsoft "microsoftAuthErrorCallback"
                      :saml      "samlAuthErrorCallback"
                      :stripe    nil})

(defn respond-with-auth-success
  "This intentionally takes no parameters, to avoid the temptation to send tokens unsafely."
  ([service] (respond-with-auth-success service nil))
  ([service target-origin]
   (let [callback (get success-callbacks service)
         target-origin (if target-origin (util/write-json-str target-origin) "null")
         script (if callback
                  (str "window.opener.postMessage({ fn: " (util/write-json-str callback) " }, " target-origin ");
                        window.close();")
                  (str "window.authCompleted = true;
                        window.close();"))]
     (-> (resp/response (hiccup/html [:head [:script script]]))
         (resp/content-type "text/html")))))

(defn respond-with-auth-tokens [service encrypted-tokens target-origin]
  (when (str/includes? target-origin "*")
    (throw (Exception. "Sending auth tokens to a wildcard origin is not allowed")))

  (let [callback (get success-callbacks service)
        script (str "window.opener.postMessage({ fn: " (util/write-json-str callback) ",
                                                 args: { encrypted_tokens: '" encrypted-tokens "' } },
                                               " (util/write-json-str target-origin) ");
                     window.close();")]
    (-> (resp/response (hiccup/html [:head [:script script]]))
        (resp/content-type "text/html"))))

(defn respond-with-auth-error
  "WARNING: error-message may be visible to whoever triggered the OAuth flow.
            Be very careful not to accidentally leak secrets in the error message."
  ([service error-message] (respond-with-auth-error service error-message nil))
  ([service error-message target-origin]
   (let [callback (get error-callbacks service)
         target-origin (if target-origin (util/write-json-str target-origin) "null")
         script (if callback
                  (str "window.opener.postMessage({ fn: " (util/write-json-str callback) ",
                                                    args: { message: " (util/write-json-str error-message) " } },
                                                  " target-origin ");
                        window.close();")
                  (str "window.errorMessage = " (util/write-json-str error-message) ";
                        window.close();"))]
     (-> (resp/response (hiccup/html [:head [:script script]]))
         (resp/content-type "text/html")))))
