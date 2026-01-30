(ns anvil.runtime.server
  (:use org.httpkit.server
        compojure.core
        clojure.pprint
        [clj-commons.slingshot :only [throw+ try+]]
        anvil.runtime.util)
  (:require [anvil.runtime.conf :as conf]
            [anvil.util :as util]
            [anvil.runtime.browser-ws :as browser-ws]
            [anvil.runtime.browser-http :as browser-http]
            [anvil.runtime.oauth :as oauth]
            [anvil.runtime.secrets :as secrets]
            [clojure.string :as str]
            [digest]
            [ring.util.response :as resp]
            [ring.util.mime-type :as mime-type]
            [anvil.core.sso.saml :as saml-sso]
            [hiccup.util :as hiccup-util]
            [anvil.runtime.app-data :as app-data]
            [crypto.random :as random]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [anvil.dispatcher.native-rpc-handlers.users.core :as user-service]
            [anvil.dispatcher.native-rpc-handlers.saml :as saml]
            [anvil.dispatcher.user-lazy-media]
            [ring.util.codec :as codec]
            [ring.middleware.cookies]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.runtime.sessions :as sessions]
            [anvil.runtime.util :as runtime-util]
            [anvil.runtime.serve-app :as serve-app])
  (:import (java.io ByteArrayInputStream)
           (anvil.dispatcher.types Media MediaDescriptor)
           (org.apache.commons.codec.binary Base64)
           (com.onelogin.saml2.settings Saml2Settings)))

(clj-logging-config.log4j/set-logger! :level :info)
;;(clj-logging-config.log4j/set-logger! "com.onelogin.saml2" :level :debug)




(defn app-404
  ([req] (app-404 req false))
  ([{:keys [app-id app-origin] :as req} app-exists-but-no-key?]
   (log/debug "Couldn't load app" app-id)
   (-> (resp/response (-> (slurp (if app-exists-but-no-key? (runtime-client-resource req "/404-app-no-key.html")
                                                            (runtime-client-resource req "/404-app.html")))
                          (.replace "{{canonical-url}}" (hiccup-util/escape-html app-origin))
                          (clojure.string/replace #"\{\{cdn\-origin\}\}" (runtime-util/get-static-origin req))))
       (resp/header "x-anvil-sig" (secrets/encrypt-str-with-global-key :anvil-sig-header ""))
       (resp/content-type "text/html")
       (resp/set-cookie "anvil-test-cookie" true)
       (resp/status (if app-exists-but-no-key? 403 404)))))




(defn get-app-from-request
  ([request] (get-app-from-request request true))
  ([request allow-errors?]
   (app-data/get-app (:app-info request)
                     (app-data/get-version-spec-for-environment (:environment request))
                     allow-errors?)))






(defn get-spinner [req]
  ;; we can make this more involved in the future
  (slurp (runtime-client-resource req "/img/loading.min.svg")))

(defn serve-lazy-media [manager media-key media-id nodl request]
  (log/trace "Request for media" request)

  ; TODO: We should use our quotas directly here. Currently, only user-lazy-media uses the dispatcher, so only that type of
  ;       lazy media has rate limiting. Google drive file downloads do not.

  ;; TODO: Lazy media sessions should be loaded by ID (i.e. use an sid parameter rather than using the session from the
  ;;       request, then load the app from the session rather than the request)
  (with-channel request channel
    (try+
      (let [app (get-app-from-request request false)]
        (worker-pool/run-task! {:type :task
                                :name ::serve-lazy-media
                                :tags (worker-pool/get-task-tags-for-http-request request)}
          (try+
            (when-let [m (lazy-media/get-lazy-media {:app-id        (:app-id request)
                                                     :app           (:content app)
                                                     :session-state (:app-session request)
                                                     :environment   (:environment request)}
                                                    manager media-key media-id)]
              (send! channel (-> {:body (.getInputStream ^Media m)}
                                 (resp/status 200)
                                 (#(if-let [l (.getLength ^Media m)] (resp/header % "Content-Length" l) %))
                                 (resp/header "Content-Disposition" (if nodl nil (str "attachment"
                                                                                      (when-let [name (.getName ^MediaDescriptor m)]
                                                                                        (str ";filename=" name)))))
                                 (resp/content-type (.getContentType ^MediaDescriptor m)))))
            (catch :anvil/server-error e
              (log/trace (:throwable &throw-context) (:anvil/server-error e))
              (send! channel (-> {:body (:anvil/server-error e)}
                                 (resp/status 500)
                                 (resp/content-type "text/plain"))))

            (catch :lm/rate-limited e
              (send! channel (-> {:body (str "Rate limit exceeded: " (:lm/rate-limited e))}
                                 (resp/status 429)
                                 (resp/content-type "text/plain"))))

            (catch :anvil/lazy-media-error e
              (send! channel (-> {:body (str "Bad request: " (:anvil/lazy-media-error e))}
                                 (resp/status 400)
                                 (resp/content-type "text/plain"))))

            (catch Object e
              (let [error-id (random/hex 6)]
                (log/error e "Error getting lazy media:" error-id)
                (send! channel (-> {:body (str "Internal server error: " error-id)}
                                   (resp/status 500)
                                   (resp/content-type "text/plain"))))))))
      (catch :anvil/app-loading-error e
        (let [error-id (random/hex 6)]
          (log/error (:throwable &throw-context) "App dependency error when getting lazy media:" error-id)
          (send! channel (-> {:body (str "Internal server error: " error-id)}
                             (resp/status 500)
                             (resp/content-type "text/plain"))))))))

; This is the real ID. Converted from id-or-alias before this point.
(defroutes app-routes
  (GET "/_/email-confirm/:email/:email-key" [email email-key :as request]
    (when-let [app (get-app-from-request request)]
      (if (user-service/confirm-email app (:environment request) email email-key)
        (serve-templated-html request (runtime-client-resource request "/user_email_confirmed.html")
                              {"{{email-address}}" (hiccup-util/escape-html email)})
        (resp/redirect (:app-origin request)))))

  (GET "/_/email-pw-reset/:email/:email-key" [email email-key :as request]
    (when-let [app (get-app-from-request request)]
      (when (user-service/email-password-reset-key-valid? app (:environment request) email email-key)
        (serve-templated-html request (runtime-client-resource request "/user_email_password_reset.html")
                              {"{{email-address}}" (hiccup-util/escape-html email)
                               "{{error}}" ""}))))

  (GET ["/_/:path/:token" :path #"login|reset_password" :token #".*"] [token :as request]
    (when-let [app (get-app-from-request request)]
      (when (user-service/do-login-with-token app (request :environment) (request :app-session) (codec/url-decode token))
        (sessions/persist! (request :app-session))
        (resp/redirect (str (:app-origin request) "?_anvil_session=" (sessions/url-token (request :app-session)))))))

  (POST "/_/email-pw-reset/:email/:email-key" [email email-key password :as request]
    (when-let [app (get-app-from-request request)]
      (try+
        (when (user-service/reset-email-password! app (:environment request) email email-key password)
          (serve-templated-html request (runtime-client-resource request "/user_email_password_reset_done.html")
                                {"{{email-address}}" (hiccup-util/escape-html email)}))
        (catch :anvil/server-error e
          (serve-templated-html request (runtime-client-resource request "/user_email_password_reset.html")
                                {"{{email-address}}" (hiccup-util/escape-html email)
                                 "{{error}}"         (str "<div class=\"alert alert-danger\" role=\"alert\"><b>" (:anvil/server-error e) "</b></div>")})))))

  (GET "/_/print/:print-id/:print-key" [print-id print-key :as request]
    (when-let [app (get-app-from-request request)]
      (serve-app/serve-app request {} {:action :print, :print-id print-id, :print-key print-key})))

  (ANY "/_/logout" request
    (sessions/delete! (:app-session request))
    (-> {:body            ""}
        (resp/status 200)
        (resp/content-type "text/plain")
        (resp/header "Access-Control-Allow-Credentials" "true")))

  (GET ["/_/theme/:asset-name", :asset-name #".*"] [asset-name :as request]
    (let [{:keys [version content]} (get-app-from-request request)]
      (if (= version (get-in request [:headers "if-none-match"]))
        (-> (resp/response nil)
            (resp/status 304)
            (resp/header "X-Anvil-Cacheable" true)
            (resp/header "ETag" version)
            (resp/header "Access-Control-Expose-Headers" "X-Anvil-Cacheable"))
        (when-let [asset (app-data/get-asset content asset-name)]
          (log/trace "Serving an asset: " (:name asset))
          (let [mime-type (mime-type/ext-mime-type asset-name util/additional-mime-types)]
            (-> (Base64/decodeBase64 ^String (:content asset))
                (ByteArrayInputStream.)
                (resp/response)
                (resp/header "X-Anvil-Cacheable" true)
                (resp/header "ETag" version)
                (resp/header "Access-Control-Expose-Headers" "X-Anvil-Cacheable")
                (resp/content-type mime-type)))))))

  (ANY ["/_/lm/:manager/:media-key/:media-id/*"] [manager media-key media-id nodl :as request]
    (serve-lazy-media manager media-key media-id nodl request))

  (POST "/_/server-call-http" request
    (if-let [other-origin (:cross-origin request)]
      (do (log/warn (str "Origin header mismatch connection to " (:app-origin request) ": " other-origin))
          (-> (resp/response "Invalid origin")
              (resp/status 403)))
      (try+
        (when-let [app (get-app-from-request request false)]
          (browser-http/http-handler (assoc-in request [:environment :commit-id] (:version app)) (:content app)))
        (catch :anvil/app-loading-error e
          (log/error (:throwable &throw-context) "App dependency error when connecting")))))

  (ANY ["/_/ws:old-key" :old-key #".*"] request
    (if-let [other-origin (:cross-origin request)]
      (do (log/warn (str "Origin header mismatch on websocket connection to " (:app-origin request) ": " other-origin))
          (-> (resp/response "Invalid origin")
              (resp/status 403)))
      (try+
        (when-let [app (get-app-from-request request false)]
          (browser-ws/ws-handler (assoc-in request [:environment :commit-id] (:version app)) (:content app)))
        (catch :anvil/app-loading-error e
          (log/error (:throwable &throw-context) "App dependency error when connecting websocket")))))

  (GET "/_/service-worker" req
    (-> (slurp (runtime-client-resource req "/dist/static/js/sw.bundle.js"))
        (resp/response)
        (resp/header "Service-Worker-Allowed" (hiccup-util/escape-html (:app-origin req)))
        (resp/content-type "application/javascript")))

  (POST "/_/request_cookies" req
    (serve-app/with-anvil-cookies (resp/response "") (:app-session req)))

  (POST "/_/google_auth_complete" {:keys [body app-session app-origin environment] :as _req}
    (let [{:keys [tokens oauth_info]} (some-> (:encrypted_tokens body)
                                              (#(secrets/decrypt-str-with-global-key ::oauth-tokens-google %))
                                              util/read-json-str)]
      (if-not (runtime-util/oauth-info-valid? oauth_info app-origin environment app-session)
        (resp/status (resp/response {:error "Rejecting mismatched OAuth Info"}) 403)
        (do
          (swap! app-session assoc-in [:google :user-tokens] tokens)
          (sessions/notify-session-update! app-session)
          (resp/response {:id_token (:id-token tokens)})))))

  (POST "/_/facebook_auth_complete" {:keys [body app-session app-origin environment] :as _req}
    (let [{:keys [tokens oauth_info]} (some-> (:encrypted_tokens body)
                                              (#(secrets/decrypt-str-with-global-key ::oauth-tokens-facebook %))
                                              util/read-json-str)]
      (if-not (runtime-util/oauth-info-valid? oauth_info app-origin environment app-session)
        (resp/status (resp/response {:error "Rejecting mismatched OAuth Info"}) 403)
        (do
          (swap! app-session update-in [:facebook] merge tokens)
          (sessions/notify-session-update! app-session)
          (resp/response (select-keys tokens [:email]))))))

  (POST "/_/microsoft_auth_complete" {:keys [body app-session app-origin environment] :as _req}
    (let [{:keys [tokens oauth_info]} (some-> (:encrypted_tokens body)
                                              (#(secrets/decrypt-str-with-global-key ::oauth-tokens-microsoft %))
                                              util/read-json-str)]
      (if-not (runtime-util/oauth-info-valid? oauth_info app-origin environment app-session)
        (resp/status (resp/response {:error "Rejecting mismatched OAuth Info"}) 403)
        (do
          (swap! app-session update-in [:microsoft] merge tokens)
          (sessions/notify-session-update! app-session)
          (resp/response {:email (or (-> tokens :email)
                                     (-> tokens :id-token :preferred_username))})))))

  (POST "/_/saml_auth_complete" {:keys [body app-session app-origin environment] :as _req}
    (let [{:keys [tokens oauth_info]} (some-> (:encrypted_tokens body)
                                              (#(secrets/decrypt-str-with-global-key ::oauth-tokens-saml %))
                                              util/read-json-str)]
      (if-not (runtime-util/oauth-info-valid? oauth_info app-origin environment app-session)
        (resp/status (resp/response {:error "Rejecting mismatched OAuth Info"}) 403)
        (do
          (swap! app-session update-in [:saml] merge tokens)
          (sessions/notify-session-update! app-session)
          (resp/response (select-keys tokens [:email]))))))

  (GET "/_/saml-sp-metadata" request
    (let [app (:content (get-app-from-request request))
          saml-service (first (filter #(= (:source %) "/runtime/services/anvil/saml.yml") (:services app)))
          settings ^Saml2Settings (saml/get-settings (:server_config saml-service) (:app-info request))
          metadata (.getSPMetadata settings)
          errors (Saml2Settings/validateMetadata metadata)]
      (if (empty? errors)
        (-> metadata
            (resp/response)
            (resp/content-type "application/xml")
            (resp/header "content-disposition" (str "attachment; filename=SAML Metadata - " (clojure.string/replace (str (:name app)) #"[^A-Za-z0-9\. ]" "") ".xml")))
        (resp/response {:errors errors}))))

  (POST "/_/log" request
    ;; Absorb this by default
    {:status 200})

  (GET "/_/check-app-online" req
    {:status 200})

  (GET "/_/get_stripe_publishable_keys" []
    (resp/response {:live (conf/stripe-client-config :live-publishable-key)
                    :test (conf/stripe-client-config :test-publishable-key)}))

  (GET "/_/validate-app/:challenge" [challenge :as req]
    (when-let [nonce (try
                       (secrets/decrypt-str-with-global-key :domain-validation challenge)
                       (catch Exception _ nil))]
      (resp/response {:app-id (:app-id req)
                      :nonce nonce})))

  (GET "/_/manifest.json" {:keys [app-origin] :as req}
    (let [[app-info app-map style _head-html _commit-id] (app-data/sanitised-app-and-style-for-client (:app-id req) (app-data/get-version-spec-for-environment (:environment req)))]
      (-> (populate-template (runtime-client-resource req "/manifest.json")
                             {"{{app-name}}"           (:name app-info)
                              "{{social-description}}" (serve-app/render-app-description (get-in app-map [:metadata :description]))
                              "{{canonical-url}}"      (hiccup-util/escape-html app-origin)
                              "{{icon}}"               (serve-app/image-from-metadata-asset-or-url app-origin (get-in app-map [:metadata :logo_img]) "/icon-512x512.png")

                              "{{theme-color}}"        (:primary-color style)
                              "{{background-color}}"   (if (and (:primary-color style)
                                                                (= (.toLowerCase (:primary-color style)) "#2ab1eb"))
                                                         "white"
                                                         (:primary-color style))})
          (resp/response)
          (resp/content-type "application/json")))))


(defroutes runtime-common-routes
  ;; These routes are unusual - they are accessible at /runtime/... on all origins!

  (GET "/_/google_auth_redirect" {:keys [params] :as req}
    (let [{:keys [oauth_info scope]} params
          {:keys [app-origin app-info environment]} (runtime-util/get-app-details-from-oauth-info oauth_info)
          app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))
          allow-app-origin-redirect? (runtime-util/allow-oauth-app-origin-redirect? environment)]
      (try+
        (let [{:keys [google-url
                      csrf-token
                      redirect-uri]} (oauth/google-redirect app app-origin allow-app-origin-redirect? scope (:server-name req) "/_/client_auth_callback")

              cookie (secrets/encrypt-str-with-global-key
                       ::oauth-redirect-google
                       (util/write-json-str {:csrf_token   csrf-token
                                             :oauth_info   oauth_info
                                             :redirect_uri redirect-uri}))]
          (-> (resp/redirect google-url)
              (assoc :cookies {"oauth_redirect_google"
                               {:value cookie :http-only true :max-age 600}})))

        (catch ::oauth/restart-oauth-from-origin e
          (println e)
          (resp/redirect (str (:origin e) "/_/google_auth_redirect?" (:query-string req))))
        (catch ::oauth/invalid-oauth-origin e
          (oauth/respond-with-auth-error :google (str "Can't start OAuth from origin " (:origin e)) app-origin))
        (catch ::oauth/no-client-id _
          (oauth/respond-with-auth-error :google "No client ID specified in Google API service config" app-origin)))))

  ;; Historical name, should really be called "google_auth_callback"
  ;; Configured in the Google developer console, so we must redirect back to the same endpoint for every app.
  (GET "/_/client_auth_callback" {:keys [params cookies] :as _req}
    ;; We don't have an app session here, since we might be in the common runtime (anvil.works) origin.
    ;; Instead, we pass encrypted tokens back to the frontend, which forwards them to "/_/google_auth_complete"
    ;; in the app origin, which decrypts and adds them to the app session.
    (let [cookie (some-> (get-in cookies ["oauth_redirect_google" :value])
                         (#(secrets/decrypt-str-with-global-key ::oauth-redirect-google %))
                         util/read-json-str)]
      (if (nil? cookie)
        (oauth/respond-with-auth-error :google "OAuth cookie not found, make sure you have cookies enabled" "*")

        (let [oauth-info (:oauth_info cookie)
              {:keys [app-origin app-info environment]} (runtime-util/get-app-details-from-oauth-info oauth-info)
              app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))]

          (try
            (let [tokens (oauth/google-callback app (:code params) (:state params) (:csrf_token cookie) (:redirect_uri cookie))
                  encrypted-tokens (secrets/encrypt-str-with-global-key
                                     ::oauth-tokens-google
                                     (util/write-json-str {:tokens tokens :oauth_info oauth-info}))]

              (oauth/respond-with-auth-tokens :google encrypted-tokens app-origin))

            (catch Exception e
              (log/error e "Error in Google auth callback")
              (oauth/respond-with-auth-error :google (or (.getMessage e) (.toString e)) app-origin)))))))

  (GET "/_/facebook_auth_redirect" {:keys [params :as _req]}
    (let [{:keys [oauth_info scope]} params
          {:keys [app-origin app-info environment]} (runtime-util/get-app-details-from-oauth-info oauth_info)
          app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))]
      (try+
        (let [{:keys [facebook-url csrf-token]} (oauth/facebook-redirect app scope "/_/facebook_auth_callback")

              cookie (secrets/encrypt-str-with-global-key
                       ::oauth-redirect-facebook
                       (util/write-json-str {:csrf_token csrf-token :oauth_info oauth_info}))]
          (-> (resp/redirect facebook-url)
              (assoc :cookies {"oauth_redirect_facebook"
                               {:value cookie :http-only true :max-age 600}})))

        (catch ::oauth/no-client-id _
          (oauth/respond-with-auth-error :facebook "To specify custom permissions, you must provide an app ID in the Facebook service config." app-origin)))))

  (GET "/_/facebook_auth_callback" {:keys [params cookies] :as _req}
    (let [cookie (some-> (get-in cookies ["oauth_redirect_facebook" :value])
                         (#(secrets/decrypt-str-with-global-key ::oauth-redirect-facebook %))
                         util/read-json-str)]
      (if (nil? cookie)
        (oauth/respond-with-auth-error :facebook "OAuth cookie not found, make sure you have cookies enabled" "*")

        (let [oauth-info (:oauth_info cookie)
              {:keys [app-origin app-info environment]} (runtime-util/get-app-details-from-oauth-info oauth-info)
              app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))
              redirect-uri (str conf/runtime-common-url "/_/facebook_auth_callback")]

          (if (:error params)
            (oauth/respond-with-auth-error :facebook (:error_description params) app-origin)

            (try
              (let [tokens (oauth/facebook-callback app (:code params) (:state params) (:csrf_token cookie) redirect-uri)
                    encrypted-tokens (secrets/encrypt-str-with-global-key
                                       ::oauth-tokens-facebook
                                       (util/write-json-str {:tokens tokens :oauth_info oauth-info}))]

                (oauth/respond-with-auth-tokens :facebook encrypted-tokens app-origin))

              (catch Exception e
                (log/error e "Error in Facebook auth callback")
                (oauth/respond-with-auth-error :facebook (or (.getMessage e) (.toString e)) app-origin))))))))

  (GET "/_/microsoft_auth_redirect" {:keys [params] :as _req}
    (let [{:keys [oauth_info scope]} params
          {:keys [app-origin app-info environment]} (runtime-util/get-app-details-from-oauth-info oauth_info)
          app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))]
      (try+
        (let [{:keys [microsoft-url csrf-token nonce]} (oauth/microsoft-redirect app scope "/_/microsoft_auth_callback")

              cookie (secrets/encrypt-str-with-global-key
                       ::oauth-redirect-microsoft
                       (util/write-json-str {:csrf_token csrf-token :nonce nonce :oauth_info oauth_info}))]
          (-> (resp/redirect microsoft-url)
              (assoc :cookies {"oauth_redirect_microsoft"
                               {:value cookie :http-only true :max-age 600}})))

        (catch ::oauth/no-client-id _
          (oauth/respond-with-auth-error :microsoft "To specify custom permissions (scopes), you must provide an Application ID and Application Secret in the Microsoft service config." app-origin)))))

  (POST "/_/microsoft_auth_callback" {:keys [params cookies] :as req}
    ;; Tokens reference: https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-v2-tokens
    (let [cookie (some-> (get-in cookies ["oauth_redirect_microsoft" :value])
                         (#(secrets/decrypt-str-with-global-key ::oauth-redirect-microsoft %))
                         util/read-json-str)]

      (if (nil? cookie)
        (oauth/respond-with-auth-error :microsoft "OAuth cookie not found, make sure you have cookies enabled" "*")

        (let [oauth-info (:oauth_info cookie)
              {:keys [app-origin app-info environment]} (runtime-util/get-app-details-from-oauth-info oauth-info)
              app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))
              redirect-uri (str conf/runtime-common-url "/_/microsoft_auth_callback")]

          (if-let [error (:error params)]
            (oauth/respond-with-auth-error :microsoft (str error ": " (:error_description params)) app-origin)

            (try
              (let [tokens (oauth/microsoft-callback app (:code params) (:state params) (:id_token params) (:csrf_token cookie) (:nonce cookie) redirect-uri)
                    encrypted-tokens (secrets/encrypt-str-with-global-key
                                       ::oauth-tokens-microsoft
                                       (util/write-json-str {:tokens tokens :oauth_info oauth-info}))]

                (oauth/respond-with-auth-tokens :microsoft encrypted-tokens app-origin))

              (catch Exception e
                (log/error e "Error in Microsoft auth callback")
                (oauth/respond-with-auth-error :microsoft (or (.getMessage e) (.toString e)) app-origin))))))))

  (GET "/_/saml_auth_redirect" {:keys [params] :as _req}
    (try
      (let [{:keys [app-origin app-info environment]} (runtime-util/get-app-details-from-oauth-info (:oauth_info params))
            app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))]
        (try
          (let [saml-service (first (filter #(= (:source %) "/runtime/services/anvil/saml.yml") (get-in app [:content :services])))
                server-config (:server_config saml-service)
                settings (saml/get-settings server-config (:info app))

                [url csrf-token] (saml-sso/get-login-url settings
                                                         (:force_authentication server-config))
                cookie (secrets/encrypt-str-with-global-key
                         ::oauth-redirect-saml
                         (util/write-json-str {:csrf_token csrf-token
                                               :oauth_info (:oauth_info params)}))]
            (-> (resp/redirect url)
                (assoc :cookies {"oauth_redirect_saml"
                                 {:value cookie :http-only true :max-age 600}})))
          (catch Exception e
            (log/error e "Error in SAML auth redirect")
            (oauth/respond-with-auth-error :saml "SAML Redirect failed" app-origin))))))

  ;; Historical name, should really be called "saml_auth_callback"
  (POST "/_/saml_auth_login" {:keys [cookies] :as req}
    (let [cookie (some-> (get-in cookies ["oauth_redirect_saml" :value])
                         (#(secrets/decrypt-str-with-global-key ::oauth-redirect-saml %))
                         util/read-json-str)]
      (if (nil? cookie)
        (oauth/respond-with-auth-error :saml "OAuth cookie not found, make sure you have cookies enabled" "*")

        (let [oauth-info (:oauth_info cookie)
              {:keys [app-origin app-info environment]} (runtime-util/get-app-details-from-oauth-info oauth-info)
              app (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))]
          (try
            (let [saml-service (first (filter #(= (:source %) "/runtime/services/anvil/saml.yml") (get-in app [:content :services])))
                  settings (saml/get-settings (:server_config saml-service) app-info)
                  email-attribute (get-in saml-service [:server_config :email_attribute])
                  redirect-uri (str conf/runtime-common-url "/_/saml_auth_login")

                  tokens (saml-sso/process-callback req (:csrf_token cookie) settings email-attribute redirect-uri)
                  encrypted-tokens (secrets/encrypt-str-with-global-key
                                     ::oauth-tokens-saml
                                     (util/write-json-str {:tokens     tokens
                                                           :oauth_info oauth-info}))]
              (oauth/respond-with-auth-tokens :saml encrypted-tokens app-origin))

            (catch Exception e
              (log/error e "Error in SAML auth callback")
              (oauth/respond-with-auth-error :saml (or (.getMessage e) (.toString e)) app-origin))))))))
