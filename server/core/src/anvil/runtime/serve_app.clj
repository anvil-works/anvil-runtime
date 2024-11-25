(ns anvil.runtime.serve-app
  (:require [anvil.runtime.accounting :as accounting]
            [anvil.runtime.debugger :as debugger]
            [anvil.util :as utils]
            [slingshot.slingshot :refer [try+ throw+]]
            [anvil.runtime.app-data :as app-data]
            [anvil.util :as util]
            [ring.util.response :as resp]
            [clojure.tools.logging :as log]
            [anvil.runtime.util :as runtime-util]
            [hiccup.util :as hiccup-util]
            [clojure.string :as string]
            [anvil.runtime.secrets :as secrets]
            [anvil.runtime.conf :as conf]
            [anvil.runtime.sessions :as sessions]
            [anvil.metrics :as metrics]
            [clj-yaml.core :as yaml]
            [clojure.java.io :as io]
            [org.httpkit.server :as http-kit :refer [send!]]
            ring.middleware.cookies
            [anvil.runtime.app-log :as app-log]
            [medley.core :refer [map-kv-vals map-keys]]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks]
            [crypto.random :as random]
            [anvil.dispatcher.types :as types]
            [anvil.dispatcher.core :as dispatcher]
            [clojure.pprint :as pprint]
            [anvil.dispatcher.serialisation.core :as serialiser]
            [anvil.runtime.browser-ws :as browser-ws])
  (:import (anvil.dispatcher.types LazyMedia Media MediaDescriptor InputStreamMedia ChunkedStream SerializedPythonObject)
           (org.apache.commons.codec.binary Base64)
           (java.io ByteArrayInputStream)))

(clj-logging-config.log4j/set-logger! :level :info)



;; Hooks
(defonce get-embedding-restrictions (fn [app-map]
                                      (when-not (or (:allow_embedding app-map) (nil? (:allow_embedding app-map)))
                                        [])))

(def set-app-embedding-impl! (util/hook-setter #{get-embedding-restrictions}))


;; Utilities also used from outside
(defn image-from-metadata [app-origin metadata key not-found]
  (let [img-url (fn [url]
                  (if-let [[_ n] (when url (re-matches #"asset:(.*)" url))]
                    (str app-origin "/_/theme/" (util/real-actual-genuine-url-encoder n))
                    url))]
    (util/or-str (img-url (get metadata key)) (str conf/static-root-url not-found))))

(defn render-app-description [description]
  (hiccup-util/escape-html
    (util/or-str description
                 "This app is built with Anvil, the platform for building full-stack web apps quickly and robustly.")))

(defn app-500
  ([req] (app-500 req "An internal error occurred"))
  ([{:keys [app-id app-origin] :as req} message]
   (log/debug "Couldn't load app" app-id ":" message)
   (-> (resp/response (-> (slurp (runtime-util/runtime-client-resource req "/500-app.html"))
                          (.replace "{{anvil-error}}" (hiccup-util/escape-html message))
                          (clojure.string/replace #"\{\{cdn\-origin\}\}" (runtime-util/get-static-origin req))))
       (resp/content-type "text/html")
       (resp/set-cookie "anvil-test-cookie" true)
       (resp/status 500))))

(defn with-anvil-cookies [resp session]
  ;; Takes the current value of the anvil cookies from the session and puts them onto an HTTP response
  (update-in resp [:cookies] #(into (or % {})
                                    (for [type [:local :shared]]
                                      [(get conf/app-cookie-names type)
                                       (merge {:value     (or (when-let [cookie-serialised (get-in @session [:cookies type])] cookie-serialised) "")
                                               :path      "/"
                                               :http-only true
                                               :max-age   2147483647}
                                              (when conf/force-secure-cookies?
                                                {:same-site :none
                                                 :secure    true})
                                              (when (= type :shared)
                                                {:domain (:shared-cookie-domain @session)}))]))))

(defonce service-snippet-fns (atom {}))

(swap! service-snippet-fns assoc "/runtime/services/segment.yml"
       (fn [app-map {:keys [client_config]}]
         (format "<script type=\"text/javascript\">\n  !function(){var analytics=window.analytics=window.analytics||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error(\"Segment snippet included twice.\");else{analytics.invoked=!0;analytics.methods=[\"trackSubmit\",\"trackClick\",\"trackLink\",\"trackForm\",\"pageview\",\"identify\",\"reset\",\"group\",\"track\",\"ready\",\"alias\",\"debug\",\"page\",\"once\",\"off\",\"on\"];analytics.factory=function(t){return function(){var e=Array.prototype.slice.call(arguments);e.unshift(t);analytics.push(e);return analytics}};for(var t=0;t<analytics.methods.length;t++){var e=analytics.methods[t];analytics[e]=analytics.factory(e)}analytics.load=function(t){var e=document.createElement(\"script\");e.type=\"text/javascript\";e.async=!0;e.src=(\"https:\"===document.location.protocol?\"https://\":\"http://\")+\"cdn.segment.com/analytics.js/v1/\"+t+\"/analytics.min.js\";var n=document.getElementsByTagName(\"script\")[0];n.parentNode.insertBefore(e,n)};analytics.SNIPPET_VERSION=\"4.0.0\";\n  analytics.load(\"%s\");\n  analytics.page();\n  }}();\n</script>"
                 (hiccup-util/escape-html (:write_key client_config)))))

;; Local utilities
(defn- block-app [{:keys [app-id app-origin] :as req} message]
  (log/debug "Couldn't load app" app-id ":" message)
  (-> (resp/response (-> (slurp (runtime-util/runtime-client-resource req "/block-app.html"))
                         (.replace "{{canonical-url}}" (hiccup-util/escape-html app-origin))
                         (.replace "{{anvil-error}}" (hiccup-util/escape-html message))
                         (string/replace #"\{\{cdn\-origin\}\}" (runtime-util/get-static-origin req))))
      (resp/header "x-anvil-sig" (secrets/encrypt-str-with-global-key :anvil-sig-header ""))
      (resp/content-type "text/html")
      (resp/set-cookie "anvil-test-cookie" true)
      (resp/status 404)))                                 ;TODO maybe a different 4xx?

(defn- get-service-snippets [app-map]
  (->> (for [{:keys [source] :as service} (:services app-map)
             :let [get-snippet (get @service-snippet-fns source)]
             :when get-snippet]
         (get-snippet app-map service))
       (apply str)))

(defn- get-service-code [app-map]
  (apply str
         (for [{:keys [source]} (:services app-map)
               :let [[_ service-name anvil-prefix] (re-matches #"/runtime/services/((anvil/)?[A-Za-z0-9]+).yml" source)]

               :when service-name
               :let [service-conf (util/parse-yaml-str (slurp (or (io/resource (str "services-core/" service-name ".yml"))
                                                                  (io/resource (str "services-platform/" service-name ".yml")))))
                     source-paths (:path_whitelist service-conf)]]
           (apply str
             (for [p source-paths
                   :let [content (slurp (or (io/resource (str "services-core/" anvil-prefix p))
                                          (io/resource (str "services-platform/" anvil-prefix p))))
                         fake-path (str "anvil-services/" anvil-prefix p)]]
               (str "Sk.builtinFiles.files[" (util/write-json-str fake-path) "] = " (util/write-json-str content) ";"))))))


;; Static sha values can be found in commented out code in the built html files
(def legacy-runtime-templates
  {"{{legacy-bootstrap-css}}" "<link rel=\"stylesheet\" href=\"{{app-origin}}/_/static/runtime/css/bootstrap.css?sha=c72a0381af84afb75234\" crossorigin/>\n<link rel=\"stylesheet\" href=\"{{app-origin}}/_/static/runtime/css/bootstrap-theme.min.css?sha=42cf18f709a52a7f4a0a\" crossorigin/>\n<link rel=\"stylesheet\" href=\"{{app-origin}}/_/static/runtime/node_modules/animate.css/animate.min.css?sha=b99997f8705218b0610b\" crossorigin/>"
   "{{legacy-bootstrap-js}}" "<script src=\"{{app-origin}}/_/static/runtime/node_modules/bootstrap/dist/js/bootstrap.min.js?sha=14a09c1d8116fd5b43e4\" crossorigin></script>"
   "{{legacy-classnames}}" "<link rel=\"stylesheet\" href=\"{{app-origin}}/_/static/runtime/dist/runner.min.css?sha=adc877189c16a1666010\" crossorigin/>"
   "{{legacy-head-class}}" "runner"})

(def legacy-designer-templates
  {"{{legacy-bootstrap-css}}" "<link rel=\"stylesheet\" href=\"{{cdn-origin}}/runtime/css/bootstrap.css?sha=c72a0381af84afb75234\" crossorigin/>\n<link rel=\"stylesheet\" href=\"{{cdn-origin}}/runtime/css/bootstrap-theme.min.css?sha=42cf18f709a52a7f4a0a\" crossorigin/>\n<link rel=\"stylesheet\" href=\"{{cdn-origin}}/runtime/node_modules/animate.css/animate.min.css?sha=b99997f8705218b0610b\" crossorigin/>"
   "{{legacy-bootstrap-js}}" "<script src=\"{{cdn-origin}}/runtime/node_modules/bootstrap/dist/js/bootstrap.min.js?sha=14a09c1d8116fd5b43e4\" crossorigin></script>"
   "{{legacy-classnames}}" "<link rel=\"stylesheet\" href=\"{{cdn-origin}}/runtime/dist/runner.min.css?sha=adc877189c16a1666010\" crossorigin/>\n<link rel=\"stylesheet\" href=\"{{cdn-origin}}/runtime/css/designer.css?sha=fb36a2a2289ed3972433\" crossorigin/>"
   "{{legacy-head-class}}" "designer"})

;; :__dict__ not required since it's implementation is executed at runtime
(def template-key-to-legacy-key
  {"{{legacy-classnames}}" :class_names
   "{{legacy-head-class}}" :class_names
   "{{legacy-bootstrap-css}}" :bootstrap3
   "{{legacy-bootstrap-js}}" :bootstrap3})

(defn inject-legacy-features [app-map & {:keys [designer]}]
  (let [version (get-in app-map [:runtime_options :version] 0)
        legacy-features (get-in app-map [:runtime_options :legacy_features])
        legacy-templates (if designer legacy-designer-templates legacy-runtime-templates)]
    (if (< version 3)
      legacy-templates
      (map-kv-vals (fn [k v] (if (get legacy-features (template-key-to-legacy-key k)) v "")) legacy-templates))))


;; The meat of this logic

(defn serve-app [{:keys [app-id environment environment-from-url app-session] :as req} client-params {:keys [action print-id print-key form-name module-name form-arg-json replace-url app-startup-data-json] :as what-to-do}]
  (utils/timeit "Serve app" [checkpoint!]
    (let [environment (or environment-from-url environment) ;; Ignore overrides from the session on reload
          [app-info app-map style head-html commit-id]
          (app-data/sanitised-app-and-style-for-client app-id
                                                       (app-data/get-version-spec-for-environment environment)
                                                       app-session {})
          environment (assoc environment :commit-id commit-id)
          _ (checkpoint! "YAML loaded")
          meta (merge (:metadata app-map) (:override-meta what-to-do))
          app-map (assoc-in (dissoc app-map :metadata) [:theme :vars] (:theme-vars style))
          app-origin (:app-origin req)

          app-services (:services app-map)
          get-service (fn [url] (first (filter #(= (:source %) url) app-services)))
          google-service (get-service "/runtime/services/google.yml")
          google-api-key (utils/or-str (-> google-service :client_config :api_key)
                                       (:maps-api-key conf/google-client-config))
          _ (checkpoint! "Google configured")
          {:keys [body-class]} (app-data/get-extra-rendering-info app-id app-session {})
          runnerVersion (get-in app-map [:runtime_options :version] 0)

          client-params (-> client-params
                            (assoc :runtimeVersion (max runnerVersion 3))
                            (assoc :isCrawler
                                   (util/crawler? (get-in req [:headers "user-agent"]))))]
      (if-let [error-message (app-data/should-app-be-blocked? app-id app-session environment)]
        (block-app req error-message)
        (if (accounting/limit? app-id)
          (block-app req (str "This app cannot be accessed due to plan limits being exceeded."))
          (do
            (sessions/resolve-ambiguous-client-type! app-session "browser")
            (sessions/ensure-logged! app-session)

            ;; We are loading this app from scratch, so we don't care if our old session has expired.
            ;; We also reset the environment in this session to match what the URL told us, so that refreshing
            ;; the page gets you the latest version
            (swap! app-session assoc
                   :anvil.runtime/replacement-session false
                   :environment environment)
            (runtime-util/reload-anvil-cookies! (:app-session req) req)
            (metrics/inc! :api/runtime-serve-app-total)

            (sessions/persist! app-session)

            (-> (runtime-util/serve-templated-html
                  req (runtime-util/runtime-client-resource req "/dist/runner2.html")
                  (inject-legacy-features app-map)
                  {"{{body-class}}"         (or body-class "")
                   "{{app-name}}"           (hiccup-util/escape-html
                                              (util/or-str (:title meta) (:name app-info) (:name app-map)))
                   "{{app-title}}"          (hiccup-util/escape-html
                                              (util/or-str (:title meta) (:name app-info) (:name app-map)))
                   "{{ms-tile-image}}"      (image-from-metadata app-origin meta :logo_img "/mstile-144x144.png")
                   "{{favicon}}"            (image-from-metadata app-origin meta :logo_img "/favicon-96x96.png")
                   "{{social-image}}"       (image-from-metadata app-origin meta :logo_img "/img/logo-square-padded.png")
                   "{{description}}"        (render-app-description (:description meta))
                   "{{canonical-url}}"      (hiccup-util/escape-html app-origin)
                   "{{environment-origin}}" (hiccup.util/escape-html (app-data/get-app-origin environment))
                   "{{anvil-version}}"      conf/anvil-version
                   "{{google-api-key}}"     (or google-api-key "")
                   "{{session-token}}"      (or (:session-url-token req)
                                                (get-in @app-session [::sessions/tokens :url])
                                                (get-in @app-session [::sessions/tokens :burned])
                                                "")
                   "{{manifest-url}}"       (str (hiccup-util/escape-html app-origin) "/_/manifest.json")
                   "{{theme-color}}"        (:primary-color style)
                   "{{shim-css}}"           (:css-shims style)
                   "{{theme-css}}"          (:css style)
                   ;;    "{{theme-spinner}}"      (get-spinner req) ;; TODO - support customizing the svg spinner
                   "{{root-vars}}"          (:root-vars style)
                   "{{head-html}}"          head-html
                   "{{extra-snippets}}"     (get-service-snippets app-map)
                   "{{app-info-object}}"    (util/write-json-str (runtime-util/get-runtime-app-info environment))
                   "{{load-app-code}}"      (str "\n$(function() {"
                                                 (when replace-url
                                                   (str "window.history.replaceState(window.history.state, \"\", " (util/write-json-str replace-url) ");"))
                                                 (get-service-code app-map)
                                                 "const loadApp = window.loadApp(" (util/write-json-str (merge {"app"            app-map
                                                                                                                "appId"          app-id
                                                                                                                "appOrigin"      app-origin
                                                                                                                "appStartupData" app-startup-data-json}
                                                                                                               client-params)) ");"
                                                 "const loadAppAfter = window.anvil._loadAppAfter || [];"
                                                 "loadApp.then(function() { Promise.all(loadAppAfter).then(function() {"
                                                 (condp = action
                                                   :run-app (let [startup (or (:startup app-map) {:type "form" :module (:startup_form app-map)})]
                                                              (if (= "module" (:type startup))
                                                                (str "window.openMainModule(" (util/write-json-str (:module startup)) ");")
                                                                (str "window.openForm(" (util/write-json-str (:module startup)) ");")))
                                                   :open-module (str "window.openMainModule(" (util/write-json-str module-name) ");")
                                                   :open-form (str "window.openForm(" (util/write-json-str form-name) ");")
                                                   :print (str "window.printComponents(" (util/write-json-str print-id) "," (util/write-json-str print-key) ");"))
                                                 "});"
                                                 "});"
                                                 "});")})
                (resp/header "Referrer-Policy" "no-referrer")
                (resp/header "X-UA-Compatible" "IE=edge")
                (resp/header "Content-Type" "text/html")
                (resp/header "X-Anvil-Cacheable" true)
                ;; TODO: Serve-app can't easily do clever ETag things, because even if the app has not been modified you may need a new
                ;;       session token and new cookies. Meredydd thinks this is not impossible, but for now don't do clever caching of
                ;;       the whole app. Note that we *do* do clever caching of assets, below.
                ; (resp/header "ETag" commit-id)
                (resp/header "Access-Control-Expose-Headers" "X-Anvil-Cacheable")
                (resp/set-cookie "anvil-test-cookie" true)
                (#(if-not (contains? (:cookies req) (:shared conf/app-cookie-names))
                    (assoc-in % [:cookies (:shared conf/app-cookie-names)] (merge {:value     "x"
                                                                                   :max-age   2147483647
                                                                                   :domain    (:shared-cookie-domain @(:app-session req))
                                                                                   :path      "/"
                                                                                   :http-only true}
                                                                                  (when conf/force-secure-cookies?
                                                                                    {:same-site :none
                                                                                     :secure    true})))
                    %))
                (#(if-let [restrict-embedding-origins (get-embedding-restrictions app-map)]
                    (-> %
                        (resp/header "X-Frame-Options" (if-let [first-origin (first restrict-embedding-origins)]
                                                         (str "allow-from " first-origin)
                                                         "deny"))
                        (resp/header "Content-Security-Policy" (if (empty? restrict-embedding-origins)
                                                                 "frame-ancestors none"
                                                                 (apply str "frame-ancestors " (interpose " " restrict-embedding-origins)))))
                    %)))))))))


(def override-headers {"content-type"        "Content-Type"
                       "content-disposition" "Content-Disposition"})

(defn- with-safe-headers [resp headers]
  (reduce (fn [resp [k v]]
            (let [h (.toLowerCase (name k))]
              (cond
                (and (= h "set-cookie")
                     ((set (vals conf/app-cookie-names)) (first (string/split v #"[=\s]+"))))
                resp

                (contains? override-headers h)
                ; Because this has already been set, we need to explicitly override it
                (assoc-in resp [:headers (override-headers h)] v)

                :else
                (update-in resp [:headers h] conj v))))
          resp headers))


(defn- with-safe-anvil-cookies [resp req headers anvil-cookies-updated?]
  (let [{:keys [app-session cross-origin]} req
        resp-with-safe-headers (with-safe-headers resp headers)]
    (if (and @anvil-cookies-updated? (not cross-origin))
      (-> resp-with-safe-headers
          (with-anvil-cookies app-session)
          (ring.middleware.cookies/cookies-response))
      resp-with-safe-headers)))


(defn- is-app-response? [body]
  (and (instance? SerializedPythonObject body)
       (= (:type body) "anvil.server._LoadAppResponse")))

(defn- app-response-action [body]
  (let [{:keys [form module]} (:value body)]
    (cond
      form :open-form
      module :open-module
      :else :run-app)))

(defn- get-app-response-serve-object [body json-data json-media]
  (let [{:keys [form module meta]} (:value body)
        serialised-data (-> json-data
                            (dissoc :id)
                            (assoc :media json-media))]
    (cond-> {:action                (app-response-action body)
             :override-meta         (map-keys keyword meta)
             :app-startup-data-json serialised-data}
            form (assoc :form-name form :form-arg-json serialised-data)
            module (assoc :module-name module))))

(defn- get-app-response-object-to-serialize [body]
  (let [{:keys [data args kwargs form]} (:value body)]
    (merge {:data data :id "DUMMY"}
           (when form
             {:args args :kwargs kwargs}))))

(defn- handle-app-response [wrap-response channel request client-params app-session body]
  (serialiser/serialise-to-map-with-media
    (get-app-response-object-to-serialize body)
    (fn [json-data json-media]
      (send! channel
        (wrap-response (serve-app request client-params
                                  (get-app-response-serve-object body json-data json-media)))))
    {:extra-liveobject-key (browser-ws/get-session-liveobject-secret app-session)}))


(defn serve-http-endpoint [{:keys [uri app-id app-origin environment environment-from-url request-method body cross-origin app-session new-session]
                            :as   request}
                           client-params wrap-response request-category]
  ;; Send this HTTP request to an app's server modules. The server will either return an HTTP response or (for
  ;; :route requests) an anvil.open_form() instance
  (log/trace "Endpoint hit" request)
  (log/trace "Session:" app-session)
  (sessions/resolve-ambiguous-client-type! app-session "http") ;; ...sort of? Perhaps revise later.
  (when-not (= request-category :route)
    ;; This is a temporary measure to avoid flooding our logs with app-route 404s
    (sessions/ensure-logged! app-session))
  (http-kit/with-channel request channel
    (try+
      (let [anvil-cookies-updated? (atom false)

            responded? (atom false)

            _ (when new-session
                (swap! app-session assoc-in [:client :type] :http))

            method (.toUpperCase (name request-method))

            _ (runtime-util/reload-anvil-cookies! app-session request)

            ;; TODO: Work out how to get the path and method into session data that may have already been logged.
            [session alternate-session] (if cross-origin
                                          ;; N.B This session doesn't get logged immediately, because it might be thrown away if the http_endpoint allows cross-origin sessions.
                                          ;; If it needs logging (because we ended up using it), that will happen in anvil.private.switch_session!
                                          [(sessions/new-unlogged-session-with-state (sessions/new-session-state-from-request request :http)
                                                                                     (-> (app-log/log-data-from-ring-request request)
                                                                                         (assoc :path uri
                                                                                                :method method)))
                                           app-session]
                                          [app-session nil])

            dispatcher-request (promise)

            trace-id nil                                    ;; TODO NEW TRACE API
            return-path {:update!
                         (fn [{:keys [output set-cookie debuggers] :as r}]
                           (cond
                             set-cookie
                             (reset! anvil-cookies-updated? true)

                             debuggers
                             (debugger/handle-debugger-update! (:environment request) {:type "http"} debuggers nil)

                             (string? output)
                             ;; TODO which session do we log this into?!
                             (app-log/record-event! session trace-id "print" output nil)))

                         :respond!
                         (fn [{{:keys [status body headers] :or {headers []}} :response :keys [response error] :as r}]

                           (when (get-in @(sessions/ephemeral-cache session) [::sessions/dirty])
                             (sessions/notify-session-update! session))

                           (binding [rpc-util/*environment* environment]
                             (try+
                               (cond
                                 (= (:type error) "RateLimitExceeded")
                                 (send! channel (-> {:body (str "Rate limit exceeded: " (:message error))}
                                                    (resp/status 429)
                                                    (resp/content-type "text/plain")))

                                 error
                                 ;; NoServerFunctionError -> 404; anything else -> 500
                                 (if (and (= (:type error) "anvil.server.NoServerFunctionError")
                                          (not= -1 (.indexOf (str (:message error)) (str (name request-category) ":"))))
                                   (do
                                     (send! channel (-> {:body "No matching API endpoint"}
                                                        (resp/status 404)
                                                        (resp/content-type "text/plain")))
                                     ;; This is a temporary measure to avoid flooding our logs with app-route 404s
                                     (if (= request-category :route)
                                       (log/debug "Dropping :route 404 for app" app-id uri)
                                       ;; TODO which session do we log this into?
                                       (let [error (assoc error :message (str "API request routing failed. No @anvil.server.http_endpoint exists with path matching '" (subs uri 0 (min (count uri) 100)) (when (> (count uri) 100) "...") "'"))]
                                         (app-log/record-event! session trace-id "err" (str (:type error) ": " (:message error)) error))))

                                   (do
                                     (send! channel (-> {:body "An exception was raised. Check the application logs for details."}
                                                        (resp/status 500)
                                                        (resp/content-type "text/plain")))
                                     (when-not @responded?
                                       (app-log/record-event! session trace-id "err" (str (:type error) ": " (:message error)) error))))

                                 (is-app-response? body)
                                 (if-not (= request-category :route)
                                   (throw+ {:anvil/server-error (str "Cannot return a" (:type body) "from an anvil.server.http_endpoint.")})
                                   (handle-app-response wrap-response channel request client-params app-session body))


                                 (or (instance? Media body) (instance? anvil.dispatcher.types.LazyMedia body))
                                 (worker-pool/run-task! {:type :task
                                                         :name ::serve-api-lazy-media
                                                         :tags (worker-pool/get-task-tags-for-http-request request)}
                                                        (try+
                                                          (send! channel (-> {:body   (blocking-hacks/?->InputStream @dispatcher-request body)
                                                                              :status status}
                                                                             (cond->
                                                                               (.getName ^MediaDescriptor body)
                                                                               (resp/header "Content-Disposition"
                                                                                            (str "inline; filename=\""
                                                                                                 (util/real-actual-genuine-url-encoder
                                                                                                   (clojure.string/replace (str (.getName ^MediaDescriptor body)) "\"" "_"))
                                                                                                 "\"")))
                                                                             (resp/content-type (.getContentType ^MediaDescriptor body))
                                                                             (with-safe-anvil-cookies request headers anvil-cookies-updated?)))
                                                          (catch Object e
                                                            (let [error-id (random/hex 6)]
                                                              (log/error e "Error in app API Lazy Media response:" error-id)
                                                              (send! channel (-> {:body (str "Internal server error serving Lazy Media: " error-id)}
                                                                                 (resp/status 500)
                                                                                 (resp/content-type "text/plain")))))))

                                 (instance? ChunkedStream body)
                                 (do
                                   (send! channel (-> {:status status}
                                                      (resp/content-type (.getContentType ^MediaDescriptor body))
                                                      (with-safe-anvil-cookies request headers anvil-cookies-updated?)) false)
                                   (types/consume ^ChunkedStream body
                                                  (fn [chunk-idx last-chunk? data]
                                                    (send! channel {:body (ByteArrayInputStream. data)} last-chunk?))))

                                 (string? body)
                                 (send! channel (-> {:body   body,
                                                     :status status}
                                                    (resp/content-type "text/plain; charset=utf-8")
                                                    (with-safe-anvil-cookies request headers anvil-cookies-updated?)))

                                 :else
                                 (do
                                   ((fn check-json [value path]
                                      (let [fail! #(throw+ {:anvil/server-error (format "Cannot send a %s object over HTTP as response%s.\nYou must return either Media, a string, or a JSON-compatible object (lists/dicts/strings/numbers/bools/None).\n"
                                                                                        (.getSimpleName (.getClass value))
                                                                                        (apply str (for [p (reverse path)] (str "[" (pr-str p) "]"))))})]
                                        (cond
                                          (or (string? value) (number? value) (nil? value) (boolean? value))
                                          :ok

                                          (and (map? value) (not (record? value)))
                                          (doseq [[k v] value] (check-json v (cons (name k) path)))

                                          (or (seq? value) (vector? value))
                                          (doall (map-indexed #(check-json %2 (cons %1 path)) value))

                                          :else
                                          (fail!))))
                                    body nil)
                                   (send! channel (-> {:body   (util/write-json-str body),
                                                       :status status}
                                                      (resp/content-type "application/json")
                                                      (with-safe-anvil-cookies request headers anvil-cookies-updated?)))))

                               (reset! responded? true)
                               (catch :anvil/server-error e
                                 (log/trace e)
                                 (send! channel (-> {:body (:anvil/server-error e)}
                                                    (resp/status 500)
                                                    (resp/content-type "text/plain"))))
                               (catch Object e
                                 (log/trace e)
                                 (send! channel (-> {:body   "This response cannot be transmitted over HTTP. You must return either Media, a string, or a JSON-compatible object (lists/dicts/strings/numbers/None)"
                                                     :status 500}
                                                    (resp/content-type "text/plain")))))))}

            body-media (when body
                         ; For some reason, if there's no Content-Type header, the body has already been read. Reset it.
                         (.reset body)
                         (InputStreamMedia. (get-in request [:headers "content-type"])
                                            body
                                            (second (re-matches #"attachment;\s*filename=\"(.*)\"\s*"
                                                                (get-in request [:headers "content-disposition"] "")))
                                            (get-in request [:headers "content-length"])))
            authorization (get-in request [:headers "authorization"] "")
            [[_ username password]] (try
                                      (when-let [m (re-matches #"\s*Basic\s+(.+)" authorization)]
                                        (-> m
                                            ^String second
                                            (.getBytes "UTF-8")
                                            Base64/decodeBase64
                                            (String. "UTF-8")
                                            (#(re-seq #"([^:]*):(.*)" %))))
                                      (catch Exception e
                                        (throw+ {::api-error (str "Invalid Authorization header for HTTP Basic auth: " authorization)})))


            headers-without-app-cookies (update-in (:headers request) ["cookie"] (fn [cookies-header]
                                                                                   (when cookies-header
                                                                                     (apply str (interpose "; " (filter
                                                                                                                  #(not ((set (vals conf/app-cookie-names)) (first (string/split % #"="))))
                                                                                                                  (string/split cookies-header #"; ")))))))]

        (deliver dispatcher-request {:call                               {:func (str (name request-category) ":" uri),
                                                                          :args [] :kwargs {:method                    method
                                                                                            :path                      uri
                                                                                            :origin                    (get headers-without-app-cookies "origin")
                                                                                            :query_params              (:query-params request)
                                                                                            :form_params               (:form-params request)
                                                                                            :headers                   headers-without-app-cookies
                                                                                            :remote_address            (:remote-addr request)
                                                                                            :body                      body-media
                                                                                            :username                  username
                                                                                            :password                  password
                                                                                            :same_app_alternate_origin (:alternate-app-origin request)}}
                                     :app-id                             app-id, :app-origin app-origin
                                     :environment                        (or environment-from-url environment)
                                     :session-state                      session
                                     :origin                             :http_endpoint
                                     :call-stack                         (list {:type :http})
                                     :thread-id                          (str "endpoint-" app-id "-" (random/hex 16))
                                     :use-quota?                         true
                                     :anvil.dispatcher/alternate-session alternate-session})
        (metrics/inc! :api/runtime-serve-api-total)
        (dispatcher/dispatch! @dispatcher-request
                              return-path))

      (catch ::api-error e
        (send! channel (-> {:body (::api-error e)}
                           (resp/status 400)
                           (resp/content-type "text/plain"))))
      (catch :anvil/server-error e
        (log/trace "Serving error" e)
        (send! channel (-> {:body (:anvil/server-error e)}
                           (resp/status 500)
                           (resp/content-type "text/plain"))))

      (catch :anvil/app-loading-error e
        (let [error-id (random/hex 6)]
          (log/warn (str "App dependency error when loading app " app-id " for API call to " uri ": " error-id))
          (send! channel (-> {:body (str "Internal server error: " error-id)}
                             (resp/status 500)
                             (resp/content-type "text/plain")))))

      (catch Object e
        (let [error-id (random/hex 6)]
          (log/error e "Error in app API:" error-id)
          (send! channel (-> {:body (str "Internal server error: " error-id)}
                             (resp/status 500)
                             (resp/content-type "text/plain"))))))))




(defn serve-request-to-app-url [{:keys [app-id app-session environment uri] :as request} client-params wrap-response]
  ;; A request has come in to a URL owned by this app. Examine the app's config to see whether we should be serving
  ;; a startup form/module or asking its server modules for a route
  (log/trace "Serving" uri "for" app-id)
  ;;(pprint/pprint request)
  (try+
    (if-let [error-message (app-data/should-app-be-blocked? app-id app-session environment)]
      (block-app request error-message)

      (let [app-info (app-data/get-app-info-insecure app-id)
            ;; TODO this is quite an expensive load when all we really want is to know the startup configuration,
            ;; and in the app-serving case we're going to repeat it in a moment with `environment-from-url` which is usually the same!
            {app :content :keys [content version dependency-versions] :as loaded-app} (app-data/get-app app-info (app-data/get-version-spec-for-environment environment) false)
            environment (assoc environment :commit-id (:version loaded-app) :dependency-commit-ids (:dependency-versions loaded-app))
            startup-config (or (:startup app) (when-let [f (:startup_form app)] {:type "form" :module f}))]
        (cond
          (and (= uri "/") (#{"form" "module"} (:type startup-config)))
          (serve-app request client-params {:action :run-app})

          (.startsWith uri "/_/api/")
          (serve-http-endpoint (update request :uri #(.substring ^String % 6))
                               nil wrap-response :http)

          (.startsWith uri "/.well-known/")
          (serve-http-endpoint (update request :uri #(.substring ^String % 12))
                               nil wrap-response :http-wellknown)

          (.startsWith uri "/_/")
          nil

          :else
          (serve-http-endpoint request client-params wrap-response :route))))
    (catch :anvil/app-loading-error e
      (app-500 request (:message e)))))

