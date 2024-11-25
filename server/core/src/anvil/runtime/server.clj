(ns anvil.runtime.server
  (:use org.httpkit.server
        compojure.core
        clojure.pprint
        [slingshot.slingshot :only [throw+ try+]]
        anvil.runtime.util)
  (:require [anvil.runtime.conf :as conf]
            [anvil.runtime.browser-ws :as browser-ws]
            [anvil.runtime.browser-http :as browser-http]
            [anvil.runtime.secrets :as secrets]
            [digest]
            [ring.util.response :as resp]
            [ring.util.mime-type :as mime-type]
            [clojure.data.json :as json]
            [anvil.core.sso.google :as google-sso]
            [anvil.core.sso.azure :as azure-sso]
            [hiccup.util :as hiccup-util]
            [anvil.runtime.app-data :as app-data]
            [anvil.util :as utils]
            [crypto.random :as random]
            [clojure.string :as string]
            [clojure.data.codec.base64 :as b64]
            [clojure.tools.logging :as log]
            [medley.core :refer [map-kv-vals]]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.native-rpc-handlers.users.core :as user-service]
            [anvil.dispatcher.native-rpc-handlers.saml :as saml]
            [org.httpkit.client :as http]
            [anvil.dispatcher.user-lazy-media]
            [anvil.runtime.app-log :as app-log]
            [anvil.dispatcher.types :as types]
            [ring.util.codec :as codec]
            [anvil.dispatcher.native-rpc-handlers.cookies :as cookies]
            [ring.middleware.cookies]
            [clj-yaml.core :as yaml]
            [clojure.java.io :as io]
            [anvil.util :as util]
            [anvil.metrics :as metrics]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.runtime.sessions :as sessions]
            [anvil.runtime.util :as runtime-util]
            [anvil.runtime.serve-app :as serve-app]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks]
            [anvil.runtime.debugger :as debugger])
  (:import (java.io ByteArrayInputStream)
           (anvil.dispatcher.types Media MediaDescriptor InputStreamMedia ChunkedStream)
           (org.apache.commons.codec.binary Base64)
           (java.net URLEncoder URLDecoder)
           (com.onelogin.saml2.authn AuthnRequest SamlResponse)
           (com.onelogin.saml2.settings SettingsBuilder Saml2Settings)
           (com.onelogin.saml2.util Constants)))

(clj-logging-config.log4j/set-logger! :level :info)
(clj-logging-config.log4j/set-logger! "com.onelogin.saml2" :level :debug)




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
        (when-let [asset (->> (app-data/get-all-assets content)
                              (filter #(= (:name %) asset-name))
                              (first))]
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
    (-> (slurp (runtime-client-resource req "/dist/sw.bundle.js"))
        (resp/response)
        (resp/header "Service-Worker-Allowed" (hiccup-util/escape-html (:app-origin req)))
        (resp/content-type "application/javascript")))

  (POST "/_/request_cookies" req
    (serve-app/with-anvil-cookies (resp/response "") (:app-session req)))


  (GET "/_/client_auth_redirect" request
    (if (:anvil.runtime/replacement-session @(:app-session request))
      (resp/redirect (str conf/static-root-url "/runtime-new/runtime/client_auth_error.html#" (codec/url-encode "SESSION_EXPIRED")))
      (let [params (:params request)
            app (:content (get-app-from-request request))

            ;; Can only use this if we have added and configured the google service for our app.
            ;; Look up its config.

            google-service (first (filter #(= (:source %) "/runtime/services/google.yml") (:services app)))
            google-client-id (or (get-in google-service [:server_config :client_id]) (and (:custom? conf/google-client-config) (:client-id conf/google-client-config)))

            custom-google-config? (not-empty google-client-id)

            params (if custom-google-config?
                     params
                     (assoc params :scope "https://www.googleapis.com/auth/userinfo.email"))

            offline-access (and (not= "" google-client-id) google-client-id)

            google-client-id (if custom-google-config?
                               google-client-id
                               (:client-id conf/google-client-config))

            redirect (str (if (and custom-google-config?
                                   (not (get-in request [:environment :allow-debug?])) ;; When debugging, use the shared redirect regardless
                                   (get-in google-service [:server_config :app_origin_redirect]))
                            (:app-origin request)
                            conf/runtime-common-url) "/_/client_auth_callback")]

        (if (empty? google-client-id)

          (resp/redirect (str conf/static-root-url "/runtime-new/runtime/client_auth_error.html#" (codec/url-encode "No client ID specified in Google API service config.")))

          (let [[url csrf-token] (google-sso/get-login-url (sessions/get-id (:app-session request)) google-client-id redirect (:scope params) offline-access)]
            ;; Store csrf-token in app-session rather than ring session.
            (swap! (:app-session request) assoc
                   ::google-csrf-token csrf-token
                   ::google-redirect redirect)              ;; Saves working out the redirect again in the callback.
            (sessions/notify-session-update! (:app-session request))
            (resp/redirect url))))))

  (GET "/_/client_auth_id_token" request
    (resp/response (-> @(:app-session request) :google :user-tokens :id-token)))

  (GET "/_/facebook_auth_redirect" request
    (if (:anvil.runtime/replacement-session @(:app-session request))
      (resp/redirect (str conf/static-root-url "/runtime-new/runtime/facebook_auth_error.html#" (codec/url-encode "SESSION_EXPIRED")))
      (let [csrf-token (random/hex 60)

            app (:content (get-app-from-request request))

            facebook-service (first (filter #(= (:source %) "/runtime/services/facebook.yml") (:services app)))
            facebook-client-id (or (get-in facebook-service [:server_config :app_id])
                                   (and (:custom? conf/facebook-client-config) (:app-id conf/facebook-client-config)))

            app-id-provided? (not (or (= "" facebook-client-id) (nil? facebook-client-id)))

            facebook-client-id (if app-id-provided?
                                 facebook-client-id
                                 (:app-id conf/facebook-client-config))

            requested-scopes (-> request :params :scopes)

            scope (if app-id-provided?
                    (str "email," requested-scopes)
                    "email")]

        (if (and requested-scopes
                 (not= "" requested-scopes)
                 (not app-id-provided?))
          (resp/redirect (str conf/static-root-url "/runtime-new/runtime/facebook_auth_error.html#" (codec/url-encode "To specify custom permissions, you must provide an app ID in the Facebook service config.")))

          (do (swap! (:app-session request) assoc ::facebook-csrf-token csrf-token)
              (sessions/notify-session-update! (:app-session request))
              (resp/redirect (str "https://www.facebook.com/v3.2/dialog/oauth?"
                                  "&client_id=" facebook-client-id
                                  "&redirect_uri=" (codec/url-encode (str conf/runtime-common-url "/_/facebook_auth_callback"))
                                  "&state=" (sessions/get-id (:app-session request)) "G" (codec/url-encode csrf-token)
                                  "&scope=" (codec/url-encode scope)
                                  ;"&auth_type=reauthenticate" ; This causes Colette to land in an infinite loop being asked for her password.
                                  "&display=popup")))))))

  (GET "/_/microsoft_auth_redirect" request

    ;; We implement OpenID Connect here: https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-v2-protocols-oidc

    ;; To register an app, visit https://apps.dev.microsoft.com/#/appList
    ;; Set redirect_url to https://anvil.works/apps/_/microsoft_auth_callback
    ;; No need for an Application Secret if just using login.
    (if (:anvil.runtime/replacement-session @(:app-session request))
      (resp/redirect (str conf/static-root-url "/runtime-new/runtime/microsoft_auth_error.html#" (codec/url-encode "SESSION_EXPIRED")))
      (let [csrf-token (random/hex 60)
            nonce (random/hex 60)

            app (:content (get-app-from-request request))

            microsoft-service (first (filter #(= (:source %) "/runtime/services/anvil/microsoft.yml") (:services app)))
            application-id (or (get-in microsoft-service [:server_config :application_id])
                               (and (:custom? conf/microsoft-client-config) (:application-id conf/microsoft-client-config)))
            additional-scopes (get-in microsoft-service [:server_config :additional_oauth_scopes])
            app-secret-provided? (or (get-in microsoft-service [:server_config :application_secret_enc])
                                     (get-in microsoft-service [:server_config :application_secret])
                                     (and (:custom? conf/microsoft-client-config) (:application-secret conf/microsoft-client-config)))

            app-id-provided? (not (or (= "" application-id) (nil? application-id)))

            tenant-id (if app-id-provided?
                        (or (get-in microsoft-service [:server_config :tenant_id])
                            (and (:custom? conf/microsoft-client-config) (:tenant-id conf/microsoft-client-config)))
                        (:tenant-id conf/microsoft-client-config))

            application-id (if app-id-provided?
                             application-id
                             (:application-id conf/microsoft-client-config))

            requested-scopes (.trim (str (-> request :params :scopes) " " additional-scopes))

            scope (if app-id-provided?
                    (str "openid email profile offline_access " requested-scopes)
                    "openid email profile")

            ;_ (prn "Scope:" app-id-provided? application-id microsoft-service scope)
            ]

        (if (and requested-scopes
                 (not-empty (-> request :params :scopes))
                 (or (not app-id-provided?)
                     (not app-secret-provided?)))
          (resp/redirect (str conf/static-root-url "/runtime-new/runtime/microsoft_auth_error.html#" (codec/url-encode "To specify custom permissions (scopes), you must provide an Application ID and Application Secret in the Microsoft service config.")))

          (let [[url nonce] (azure-sso/get-login-url (sessions/get-id (:app-session request)) tenant-id application-id (if app-id-provided? "code" "id_token") scope (str conf/runtime-common-url "/_/microsoft_auth_callback"))]
            (swap! (:app-session request) assoc ::microsoft-nonce nonce)
            (sessions/notify-session-update! (:app-session request))
            (resp/redirect url))))))

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

  (GET "/_/saml_auth_redirect" request
    (try
      (let [app (:content (get-app-from-request request))
            saml-service (first (filter #(= (:source %) "/runtime/services/anvil/saml.yml") (:services app)))
            server-config (:server_config saml-service)
            settings (saml/get-settings server-config (:app-info request))

            authn-request (AuthnRequest. settings (boolean (:force_authentication server-config)) false true)
            sso-url (.getIdpSingleSignOnServiceUrl settings)

            saml-request (.getEncodedAuthnRequest authn-request)
            csrf-token (random/hex 60)

            relay-state (str (sessions/get-id (:app-session request)) "G" csrf-token)

            query-string (str "SAMLRequest=" (util/real-actual-genuine-url-encoder saml-request)
                              "&RelayState=" (util/real-actual-genuine-url-encoder relay-state)
                              "&SigAlg=" (util/real-actual-genuine-url-encoder (.getSignatureAlgorithm settings)))

            signature (saml/sign-request query-string settings)

            redirect-target (str sso-url
                                 "?" query-string
                                 "&Signature=" (util/real-actual-genuine-url-encoder signature))]
        (swap! (:app-session request) assoc ::saml-csrf-token csrf-token)
        (sessions/notify-session-update! (:app-session request))
        (log/info "SAML auth redirect in session" (pr-str (sessions/get-id (:app-session request))) "with token" (pr-str csrf-token))
        (resp/redirect redirect-target))
      (catch Exception e
        (-> (resp/response
              (populate-template (runtime-client-resource request "/auth_result.html")
                                 {"{{canonical-url}}" (hiccup-util/escape-html (:app-origin @(:app-session request)))
                                  "{{callback-fn}}"   "samlAuthErrorCallback"
                                  "{{args-json}}"     (json/write-str {:message (str "SAML Redirect failed: " (.getMessage e))})}))
            (resp/content-type "text/html")
            (resp/status 200)))))

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
                              "{{icon}}"               (serve-app/image-from-metadata app-origin (:metadata app-map) :logo_img "/icon-512x512.png")

                              "{{theme-color}}"        (:primary-color style)
                              "{{background-color}}"   (if (and (:primary-color style)
                                                                (= (.toLowerCase (:primary-color style)) "#2ab1eb"))
                                                         "white"
                                                         (:primary-color style))})
          (resp/response)
          (resp/content-type "application/json")))))


(defroutes runtime-common-routes

  ;; These routes are unusual - they are accessible at /runtime/... on all origins!
  (GET "/_/client_auth_callback" req
    ;; in the Google developer console, so we must redirect back to the same place for every app.
    (let [session-id (clojure.string/replace (or (-> req :params :state) "") #"G[^G]*$" "")
          app-session (sessions/load-session-by-id-without-authentication session-id)]

      (if-not app-session
        (resp/redirect (str conf/static-root-url "/runtime-new/runtime/client_auth_error.html#" (codec/url-encode "SESSION_EXPIRED")))
        (let [session-state (sessions/deref-db app-session)
              request (merge req {:app-session app-session} (select-keys session-state [:app-id :app-info :environment]))
              app (:content (get-app-from-request request))
              google-service (first (filter #(= (:source %) "/runtime/services/google.yml") (:services app)))
              google-client-id (or (get-in google-service [:server_config :client_id])
                                   (and (:custom? conf/google-client-config) (:client-id conf/google-client-config)))

              custom-google-config? (not-empty google-client-id)

              google-client-secret (if custom-google-config?
                                     (or (when-let [encrypted-client-secret (get-in google-service [:server_config :client_secret_enc])]
                                           (:value (secrets/get-global-app-secret-value (:app-info session-state) "google-service/client-secret" encrypted-client-secret)))
                                         (get-in google-service [:server_config :client_secret])
                                         (and (:custom? conf/google-client-config) (:client-secret conf/google-client-config)))
                                     (:client-secret conf/google-client-config))

              google-client-id (if custom-google-config?
                                 google-client-id
                                 (:client-id conf/google-client-config))]

          (log/trace "Client auth callback in session" session-id (str "(app " (get request :app-id) ")"))

          (try
            (let [tokens (google-sso/process-callback (-> req :params :code)
                                                      (-> req :params :state)
                                                      (::google-csrf-token session-state)
                                                      nil ; Don't require all scopes to be granted - that's for the app developer to decide.
                                                      google-client-id
                                                      google-client-secret
                                                      (::google-redirect session-state))]

              (log/debug "CLIENT AUTH COMPLETE")
              (log/trace (with-out-str (pprint tokens)))

              (swap! app-session #(assoc-in % [:google :user-tokens] tokens))

              (sessions/notify-session-update! app-session)

              (-> (resp/response (-> (slurp (runtime-client-resource request "/client_auth_success.html"))
                                     (.replace "{{canonical-url}}" ^String (hiccup-util/escape-html (:app-origin session-state)))))
                  (resp/content-type "text/html")
                  (resp/status 200)))

            (catch Exception e
              (log/error e "Error in Google auth callback")
              (resp/redirect (str conf/static-root-url "/runtime-new/runtime/client_auth_error.html#" (codec/url-encode (.getMessage e))))))))))

  (GET "/_/facebook_auth_callback" req
    (let [redirect-uri (str conf/runtime-common-url "/_/facebook_auth_callback")
          session-id (clojure.string/replace (or (-> req :params :state) "") #"G[^G]*$" "")
          app-session (sessions/load-session-by-id-without-authentication session-id)]
      (if-not app-session
        (resp/redirect (str conf/static-root-url "/runtime-new/runtime/facebook_auth_error.html#" (codec/url-encode "SESSION_EXPIRED")))
        (let [session-state (sessions/deref-db app-session)
              request (merge req {:app-session app-session} (select-keys session-state [:app-id :app-info :environment]))
              app (:content (get-app-from-request request))
              facebook-service (first (filter #(= (:source %) "/runtime/services/facebook.yml") (:services app)))
              facebook-client-id (or (get-in facebook-service [:server_config :app_id])
                                     (and (:custom? conf/facebook-client-config) (:app-id conf/facebook-client-config)))

              facebook-client-secret (if (or (= "" facebook-client-id) (nil? facebook-client-id))
                                       (:app-secret conf/facebook-client-config)
                                       (or (when-let [encrypted-app-secret (get-in facebook-service [:server_config :app_secret_enc])]
                                             (:value (secrets/get-global-app-secret-value (:app-info session-state) "facebook-service/app-secret" encrypted-app-secret)))
                                           (get-in facebook-service [:server_config :app_secret])
                                           (and (:custom? conf/facebook-client-config) (:app-secret conf/facebook-client-config))))

              facebook-client-id (if (or (= "" facebook-client-id) (nil? facebook-client-id))
                                   (:app-id conf/facebook-client-config)
                                   facebook-client-id)]
          (try
            (let [provided-csrf-token (last (.split ^String (-> req :params :state) "G"))]

              ;; First, check the CSRF token matches the one we put in the session
              (if (not= provided-csrf-token (::facebook-csrf-token session-state))

                ;; CSRF does not match. Fail.
                (throw (Exception. "CSRF CHECK FAILED"))

                ;; CSRF matches. Start by exchanging the auth code for an access token
                (let [body-json (:body @(http/post "https://graph.facebook.com/v3.2/oauth/access_token"
                                                   {:keepalive -1
                                                    :form-params {:code          (-> req :params :code)
                                                                  :client_id     facebook-client-id
                                                                  :client_secret facebook-client-secret
                                                                  :redirect_uri  redirect-uri
                                                                  :grant_type    "authorization_code"}}))
                      body (json/read-str body-json :key-fn keyword)]

                  (if (:error body)

                    ;; Something went wrong.
                    (throw (Exception. (str "FAILED TO GET ACCESS TOKEN: " body-json)))

                    ;; There was no error, so we should be able to find the access token
                    (let [access-token (:access_token body)
                          body-json (:body @(http/post "https://graph.facebook.com/v2.9/me?fields=email"
                                                       {:keepalive -1
                                                        :form-params {:access_token access-token}}))
                          body (json/read-str body-json :key-fn keyword)]

                      (swap! app-session assoc :facebook (merge body {:access-token access-token}))
                      (sessions/notify-session-update! app-session)


                      (-> (resp/response (-> (slurp (runtime-client-resource request "/facebook_auth_success.html"))
                                             (.replace "{{canonical-url}}" ^String (hiccup-util/escape-html (:app-origin session-state)))))
                          (resp/content-type "text/html")
                          (resp/status 200)))))))

            (catch Exception e
              (log/error e "Error in Facebook auth callback")
              (resp/redirect (str conf/static-root-url "/runtime-new/runtime/facebook_auth_error.html#" (codec/url-encode (.getMessage e))))))
          ))))

  (POST "/_/microsoft_auth_callback" req
    ;; Tokens reference: https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-v2-tokens
    (let [redirect-uri (str conf/runtime-common-url "/_/microsoft_auth_callback")
          session-id (-> req :params :state)
          app-session (sessions/load-session-by-id-without-authentication session-id)]

      (if-not app-session
        (resp/redirect (str conf/static-root-url "/runtime-new/runtime/microsoft_auth_error.html#" (codec/url-encode "SESSION_EXPIRED")))
        (if-let [error (-> req :params :error)]
          (resp/redirect (str conf/static-root-url "/runtime-new/runtime/microsoft_auth_error.html#" (codec/url-encode (str error ": " (-> req :params :error_description)))))

          (try
            (let [session-state (sessions/deref-db app-session)
                  request (merge req {:app-session app-session} (select-keys session-state [:app-id :app-info :environment]))
                  app (:content (get-app-from-request request))
                  microsoft-service (first (filter #(= (:source %) "/runtime/services/anvil/microsoft.yml") (:services app)))

                  application-id (or (get-in microsoft-service [:server_config :application_id])
                                     (and (:custom? conf/microsoft-client-config) (:application-id conf/microsoft-client-config)))
                  application-secret (or (when-let [encrypted-app-secret (get-in microsoft-service [:server_config :application_secret_enc])]
                                           (:value (secrets/get-global-app-secret-value (:app-info session-state) "microsoft-service/application-secret" encrypted-app-secret)))
                                         (get-in microsoft-service [:server_config :application_secret])
                                         (and (:custom? conf/microsoft-client-config) (:application-secret conf/microsoft-client-config)))
                  tenant-id (or (when (get-in microsoft-service [:server_config :application_id])
                                  (get-in microsoft-service [:server_config :tenant_id]))
                                (and (:custom? conf/microsoft-client-config) (:tenant-id conf/microsoft-client-config)))
                  nonce (::microsoft-nonce session-state)

                  tokens (azure-sso/process-callback req nonce tenant-id application-id application-secret redirect-uri)]

              (swap! app-session update-in [:microsoft] merge tokens)
              (sessions/notify-session-update! app-session)

              (-> (resp/response (-> (slurp (runtime-client-resource req "/microsoft_auth_success.html"))
                                     (.replace "{{canonical-url}}" ^String (hiccup-util/escape-html (:app-origin session-state)))))
                  (resp/content-type "text/html")
                  (resp/status 200)))

            (catch Exception e
              (log/error e "Error in Microsoft auth callback")
              (resp/redirect (str conf/static-root-url "/runtime-new/runtime/microsoft_auth_error.html#" (codec/url-encode (or (.getMessage e) (.toString e)))))))))))

  (POST "/_/saml_auth_login" req
    (let [{relay-state :RelayState saml-response :SAMLResponse} (:params req)
          [_ session-id provided-csrf-token] (re-matches #"^(.*)G([^G]*)$" (codec/url-decode relay-state))]

      (log/info "SAML auth callback in session" (pr-str session-id) "with token" (pr-str provided-csrf-token))
      (let [app-session (sessions/load-session-by-id-without-authentication session-id)

            response-params {"{{canonical-url}}" (when app-session (hiccup-util/escape-html (:app-origin @app-session)))
                             "{{callback-fn}}"   "samlAuthErrorCallback"}]
        (when-not app-session
          (throw (Exception. (str "Session not found: " session-id))))
        (log/info "SAML CSRF token in session:" (pr-str (::saml-csrf-token @app-session)))

        (-> (resp/response
              (populate-template
                (runtime-client-resource req "/auth_result.html")
                (if-not (and app-session (= provided-csrf-token (::saml-csrf-token @app-session)))
                  (assoc response-params "{{args-json}}" (json/write-str {:message "Login failed: Invalid CSRF token"}))

                  ;; CSRF check passed
                  (let [request (merge req (select-keys @app-session [:app-id :app-info :environment]))
                        app (:content (get-app-from-request request))
                        saml-service (first (filter #(= (:source %) "/runtime/services/anvil/saml.yml") (:services app)))
                        settings (saml/get-settings (:server_config saml-service) (:app-info request))
                        saml-response (SamlResponse. settings (str conf/runtime-common-url "/_/saml_auth_login") saml-response)]

                    ;; Make sure we can't use this token again
                    (swap! app-session dissoc ::saml-csrf-token)

                    (if-not (.isValid saml-response)
                      (assoc response-params "{{args-json}}" (json/write-str {:message "Login failed: Invalid SAML response"}))

                      ;; SAML Response is valid
                      (let [attributes (into {} (.getAttributes saml-response))
                            name-id (.getNameId saml-response)
                            name-id-format (.getNameIdFormat saml-response)

                            email (first (or (get attributes (get-in saml-service [:server_config :email_attribute]))
                                             (and (= name-id-format Constants/NAMEID_EMAIL_ADDRESS)
                                                  [name-id])
                                             (get attributes "urn:oid:0.9.2342.19200300.100.1.3")
                                             (get attributes "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")))]

                        (if-not email
                          (assoc response-params "{{args-json}}" (json/write-str {:message (str "Login failed: SAML response did not contain a valid email address. NameID format was \"" name-id-format "\". You may need to configure the Email Attribute setting in the SAML Service configuration.")}))
                          (do
                            ;; Useful reference for SAML attributes: https://edx.readthedocs.io/projects/edx-installing-configuring-and-running/en/named-release-dogwood.rc/configuration/tpa/tpa_SAML_IdP.html
                            (swap! app-session update-in [:saml] merge {:attributes (json/read-str (json/write-str attributes)) ;; This is silly, but gets rid of pesky ArrayLists that won't serialise.
                                                                        :email      email})
                            (sessions/notify-session-update! app-session)
                            (log/trace "Successful SAML Login:" (with-out-str (pprint attributes)))
                            (merge response-params {"{{callback-fn}}" "samlAuthSuccessCallback"
                                                    "{{args-json}}"   "null"})))))))))
            (resp/content-type "text/html")
            (resp/status 200)))))

  )
