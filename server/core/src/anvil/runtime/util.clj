(ns anvil.runtime.util
  (:require [anvil.runtime.app-data :as app-data]
            [anvil.runtime.conf :as conf]
            [crypto.random :as random]
            [ring.util.response :as resp]
            [clojure.tools.logging :as log]
            [anvil.util :as util]
            [anvil.dispatcher.native-rpc-handlers.cookies :as cookies]
            [org.httpkit.client :as http]
            [clj-logging-config.log4j]
            digest
            [anvil.metrics :as metrics]
            [hiccup.util :as hiccup-util])
  (:import (com.google.common.net InternetDomainName)))

;;(clj-logging-config.log4j/set-logger! :level :info)


(defn client-info-from-request [session-type req]
  {:type     session-type
   :ip       (:remote-addr req)
   :location (util/get-ip-location (:remote-addr req))})

;; id -> {:url-token token, :temporary-url-tokens #{...},  ...session}
(defonce app-sessions (atom {}))
(defonce session-setup-hooks (atom {}))
(defn- mk-app-session
  ([new-session-id req] (mk-app-session new-session-id req :browser))
  ([new-session-id req client-type]
   (apply merge
          {:id                   new-session-id
           :url-token            (when (or conf/permit-url-session-tokens? (:allow-debug? (:environment req)))
                                   (str new-session-id "=" (random/base32 30)))
           :app-origin           (:app-origin req)
           :app-id               (:app-id req)
           :app-info             (:app-info req)
           :environment          (:environment req)
           :cookie-keys          {:local  (keyword (.substring (util/sha-256 (:app-id req)) 0 16))
                                  :shared (keyword (.substring (util/sha-256 (app-data/get-shared-cookie-key (:app-info req))) 0 16))}

           :shared-cookie-domain (when (:app-origin req)    ;; There is no origin if we're, say, in a client_auth_callback. In that case we don't care.
                                   (let [[_ host] (re-find #"//([^/:]*)" (:app-origin req))
                                         idn (try (InternetDomainName/from host) (catch IllegalArgumentException e nil))]
                                     (if (and idn (.isUnderPublicSuffix idn))
                                       (.topPrivateDomain idn)
                                       host)))

           :cookies              {:local  (atom nil)
                                  :shared (atom nil)}

           :client               (client-info-from-request client-type req)

           ::last-accessed       (System/currentTimeMillis)
           ::remote-addr         (:remote-addr req)         ; Happily, Ring seems to magically use x-real-ip if behind proxy.
           ::user-agent          (get-in req [:headers "user-agent"])}

          (for [[_ hook] @session-setup-hooks]
            (hook req)))))

(defn reload-anvil-cookies! [into-session req]
  (when (:cookies @into-session)
    (when-let [local-cookie (get-in req [:cookies (:local conf/app-cookie-names)])]
      (swap! (-> @into-session :cookies :local) (fn [_] (cookies/deserialise-cookie local-cookie))))
    (when-let [shared-cookie (get-in req [:cookies (:shared conf/app-cookie-names)])]
      (swap! (-> @into-session :cookies :shared) (fn [_] (cookies/deserialise-cookie shared-cookie)))))
  into-session)

(defn delete-session! [request]
  (swap! app-sessions dissoc (:id @(:app-session request))))

; TODO: Run this on a timer when the runtime starts. Don't rely on the user of the runtime library running it every so often.
(defn cleanup-sessions! []
  (swap! app-sessions #(into {} (filter (fn [[_ s]] (or (< (- (System/currentTimeMillis) (* conf/runtime-session-expire-seconds 1000))
                                                           (::last-accessed @s))
                                                        (:anvil.runtime.ws/runtime-ws @s)))
                                        %))))

(defn touch-session! [s]
  (swap! s assoc ::last-accessed (System/currentTimeMillis)))


(defn- session-matches? [{:keys [environment] :as req} existing-session]
  (and existing-session
       ; If we're using an existing session, make sure its app-id matches this request.
       (or (not (:app-id @existing-session))
           (not (:app-id req))
           (= (:app-id req) (:app-id @existing-session)))
       ; Also make sure we don't share debug and production sessions.
       (or (not environment) ; Some requests allegedly don't have an environment, e.g. OAuth callbacks
           (= (:env_id environment) (:env_id (:environment @existing-session))))))

(defn- request-with-new-session [{:keys [environment] :as req} replaced-session-id]
  (let [new-session-id (.toLowerCase (random/hex 32))]
    (log/trace (str "Creating new session") new-session-id "for app" (:app-id req) " + environment " (:env_id environment) "), replacing" (or replaced-session-id "NONE (new session)"))
    (swap! app-sessions #(assoc % new-session-id (atom (-> (mk-app-session new-session-id req)
                                                           (assoc :anvil.runtime/replacement-session (boolean replaced-session-id))))))
    (metrics/set! :api/runtime-active-sessions-total (count @app-sessions))
    (assoc req :app-session (get @app-sessions new-session-id) :new-session true)))

(defn request-with-session [{:keys [environment] :as req} app-session]
  (do
    (log/trace (str "Using existing session " (:id @app-session) " (last accessed " (::last-accessed @app-session) ", app id " (:app-id req) " + environment " (:env_id environment) ")"))
    (touch-session! app-session)
    (metrics/set! :api/runtime-active-sessions-total (count @app-sessions))
    (assoc req :app-session app-session
               :environment-from-url environment
               :environment (merge environment (:environment @app-session)))))

(defn request-with-session-by-trusted-id-when-valid [req session-id]
  (when-let [existing-session (get @app-sessions session-id)]
    (when (session-matches? req existing-session)
      (log/trace "Session matched by trusted ID")
      (request-with-session req existing-session))))

(defn request-with-session-by-trusted-id [req try-session-id]
  (or (request-with-session-by-trusted-id-when-valid req try-session-id)
      (request-with-new-session req try-session-id)))

(defn request-with-session-by-url-token-when-valid [req session-id supplied-token]
  (when-let [app-session (and session-id supplied-token (get @app-sessions session-id))]
    (let [{:keys [url-token temporary-url-tokens]} @app-session]
      (when (and (or (and url-token (= (util/sha-256 url-token) (util/sha-256 supplied-token)))
                     (some #(= (util/sha-256 %) (util/sha-256 supplied-token)) temporary-url-tokens))
                 (session-matches? req app-session))
        (log/trace "Session matched by URL token")
        (-> (request-with-session req app-session)
            (assoc :url-session-token supplied-token
                   :temporary-url-session-token? (not= url-token supplied-token)))))))

(defn generate-tmp-url-token! [app-session]
  (when-not (:id @app-session)
    (swap! app-session update-in [:id] #(or % (random/hex 32)))
    (touch-session! app-session)
    (swap! app-sessions assoc (:id @app-session) app-session))
  (let [token (str (:id @app-session) "=" (random/base32 30))]
    (swap! app-session update-in [:temporary-url-tokens] #(conj (or % #{}) token))
    token))

(defn clear-temporary-url-token! [app-session combined-token]
  (when-let [[_ _id token] (re-matches #"(.*?)=(.*)" combined-token)]
    (swap! app-session update-in [:temporary-url-tokens] disj token)))

(defn mk-temp-session [req client-type]
  (mk-app-session "temp" req client-type))

(defn with-identify-cross-origin [handler]
  (fn [request]
    (let [origin-header (get-in request [:headers "origin"])
          referer-header (get-in request [:headers "referer"])
          origin-subset? #(or (= %1 %2) (.startsWith %1 (str %2 "/")))

          valid-origins (app-data/get-valid-origins (:environment request))
          [cross-origin? foreign-origin] (or
                                           (when (and origin-header
                                                      (not (origin-subset? (:app-origin request) origin-header)))
                                             (if (not-any? #(origin-subset? % origin-header) valid-origins)
                                               (do
                                                 (log/trace "Origin header indicates cross-origin request:" (pr-str origin-header)
                                                            "doesn't match" (:app-origin request) valid-origins)
                                                 [true origin-header])
                                               (do
                                                 (log/trace "Origin header indicates alternate app origin" (pr-str origin-header))
                                                 [false origin-header])))

                                           (when referer-header
                                             (if-let [[_ referer-origin] (re-matches #"([^:/]+://[^/]+)/.*" referer-header)]

                                               (when-not (origin-subset? (:app-origin request) referer-origin)
                                                 (if (not-any? #(origin-subset? % referer-origin) valid-origins)
                                                   (do
                                                     (log/trace "Referer header indicates cross-origin:" (pr-str referer-header) "->" (pr-str referer-origin)
                                                                "doesn't match" (:app-origin request) valid-origins)
                                                     [true referer-origin])
                                                   (do
                                                     (log/trace "Referer headers indicate alternate app origin" (pr-str referer-origin))
                                                     [false referer-origin])))

                                               ;; If the referer exists but we failed to parse it, so we
                                               ;; default to cross-origin
                                               (do
                                                 (log/trace "Could not parse referer; assuming cross-origin:" referer-header)
                                                 [true referer-header])))

                                           (do
                                             (log/trace "Same-origin request (" (pr-str origin-header) (pr-str referer-header) ") for" (:app-origin request))
                                             nil))]

      (handler (if cross-origin?
                 (assoc request :cross-origin foreign-origin)
                 (assoc request :alternate-app-origin foreign-origin))))))

(defn with-app-session [handler]
  (fn [req]
    (let [env-id (get-in req [:environment :env_id])

          session-token-from-url (or (-> req :params :s))
          [_ session-id-from-url] (when session-token-from-url
                                    (re-matches #"(.+?)=.*" session-token-from-url))

          ;; To prevent PDF rendering from clobbering URL tokens, we treat their cookies differently.
          ;; Specifically, we special -case "app session ID from cookies that were themselves set because
          ;; of a *temporary* URL token", and don't clobber the session's URL token in that case.
          r-s (get-in req [:session (:app-id req) env-id])
          session-id-from-cookie (or (:session-id r-s) (:tmp-session-id r-s))
          ;_ (log/trace "Request for" (:app-id req) "/" env-id " to " (:path-info req))
          ;_ (log/trace "Cookie says" session-id-from-cookie "; URL says" session-id-from-url)
          {:keys [app-session temporary-url-session-token?] :as req-with-session}
          (or
            (request-with-session-by-url-token-when-valid req session-id-from-url session-token-from-url)

            (request-with-session-by-trusted-id-when-valid req session-id-from-cookie)

            (request-with-new-session req (or session-id-from-url session-id-from-cookie)))]

      ;; If the main client for this session can use cookies, disable URL tokens for this session
      ;; (but only when using HTTPS, because Chrome is madly inconsistent about cookies and iframes on HTTP,
      ;; and if you're running in an HTTP configuration outside a dev environment, you've got bigger problems.)
      (when (and (contains? r-s :session-id) (:url-token @app-session) (.startsWith "https://" (:app-origin req)))
        (swap! app-session dissoc :url-token))

      ;; Callback used for caching purposes
      (when-let [callback (::call-when-app-session-loaded! req)]
        (callback app-session))

      (when-let [r (handler req-with-session)]
        ;; This will explicitly nuke any Ring session state the handler set, stopping us from accidentally using it.
        (-> r
            (assoc :session (assoc-in (:session req)
                                      [(:app-id req) env-id (if temporary-url-session-token? :tmp-session-id :session-id)]
                                      (when-not (:delete-session? r)
                                        ;; This (or) allows us to use temporary session IDs
                                        ;; we use for print sessions, when using a browser to access sessions
                                        ;; that don't normally have IDs (eg HTTP endpoints, uplink, etc)
                                        (:id @app-session))))
            (dissoc :delete-session?))))))



(defn with-unlocked-apps-only [handler]
  (fn [{:keys [app-id] :as request}]
    (if (util/app-locked? app-id)
      (-> (resp/response"This app is currently undergoing maintenance, please try again in a few minutes.")
          (resp/content-type "text/plain")
          (resp/status 503))
      (handler request))))

(defn is-password-pwned? [password]
  (let [sha1sum ^String (digest/sha-1 password)

        r (:body @(http/request {:keepalive -1
                                 :url       (str "https://api.pwnedpasswords.com/range/" (.substring sha1sum 0 5))
                                 :headers   {"user-agent" "Anvil"}}))
        lines (when r (.split r "(?m)\n"))]

    (some #(-> (.toLowerCase ^String %)
               (.split ":")
               (first)
               (= (.substring sha1sum 5)))
          lines)))

(defn is-server-origin? [origin]
  (boolean (#{:downlink, :uplink, :pypy} origin)))

(defn populate-template [resource substitutions]
  (let [content (slurp resource)]
    (reduce (fn [^String content [^String k ^String v]] (.replace content k ^String (or v "")))
            content substitutions)))

(defn serve-templated-html [req resource substitutions]
  (-> (populate-template resource (assoc substitutions
                                    "{{canonical-url}}" (hiccup-util/escape-html (:app-origin req))
                                    "{{cdn-origin}}" conf/static-root-url
                                    "{{app-origin}}" (hiccup-util/escape-html (:app-origin req))))
      (resp/response)
      (resp/content-type "text/html")))

(defn with-assert-app-id [handler]
  (fn [req]
    (assert (contains? req :app-id))
    (assert (contains? req :app-info))
    (handler req)))
