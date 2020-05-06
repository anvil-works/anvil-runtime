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

(clj-logging-config.log4j/set-logger! :level :trace)


(defn client-info-from-request [session-type req]
  {:type     session-type
   :ip       (:remote-addr req)
   :location (util/get-ip-location (:remote-addr req))})

(defonce app-sessions (atom {}))
(defonce session-setup-hooks (atom {}))
(defn- mk-app-session
  ([new-session-id req] (mk-app-session new-session-id req :browser))
  ([new-session-id req client-type]
   (apply merge
          {:id                   new-session-id
           :debug?               (boolean (:anvil-debug req))
           :app-origin           (:app-origin req)
           :app-id               (:app-id req)
           :app-info             (:app-info req)
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

(defn get-app-session [session-id]
  (get @app-sessions session-id))

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


(defn request-with-session [req try-session-id]
  (let [existing-session (get @app-sessions try-session-id)]
    (if (and existing-session
             ; If we're using an existing session, make sure its app-id matches this request.
             (or (not (:app-id @existing-session))
                 (not (:app-id req))
                 (= (:app-id req) (:app-id @existing-session)))
             ; Also make sure we don't share debug and production sessions.
             (or (not (contains? req :anvil-debug)) ; Some requests won't have a debug flag, e.g. OAuth callbacks
                 (= (:anvil-debug req) (:debug? @existing-session))))
      (do
        (log/trace (str "Using existing " (when (:debug? @existing-session) "debug ") "session " try-session-id " (last accessed " (::last-accessed @existing-session) ", app id " (:app-id req) ")"))
        (touch-session! existing-session)
        (metrics/set! :api/runtime-active-sessions-total (count @app-sessions))
        (assoc req :app-session existing-session
                   :tmp-session-id (when (not= try-session-id (:id @existing-session))
                                      try-session-id)))
      (let [new-session-id (.toLowerCase (random/base32 15))]
        (log/trace (str "Creating new " (when (:anvil-debug req) "debug ") "session") new-session-id "for app" (:app-id req) "replacing" (or try-session-id "NONE (new session)"))
        (swap! app-sessions #(assoc % new-session-id (atom (-> (mk-app-session new-session-id req)
                                                               (assoc :anvil.runtime/replacement-session (boolean try-session-id))))))
        (metrics/set! :api/runtime-active-sessions-total (count @app-sessions))
        (assoc req :app-session (get @app-sessions new-session-id) :new-session true)))))

(defn mk-temp-session [req client-type]
  (mk-app-session "temp" req client-type))

(defn with-identify-cross-origin [handler]
  (fn [request]
    (let [origin-header (get-in request [:headers "origin"])
          referer-header (get-in request [:headers "referer"])
          origin-subset? #(or (= %1 %2) (.startsWith %1 (str %2 "/")))

          [cross-origin? foreign-origin] (or
                                           (when (and origin-header
                                                      (not (origin-subset? (:app-origin request) origin-header)))
                                             (if (not-any? #(origin-subset? % origin-header) (:valid-app-origins request))
                                               (do
                                                 (log/trace "Origin header indicates cross-origin request:" (pr-str origin-header)
                                                            "doesn't match" (:app-origin request) (:valid-app-origins request))
                                                 [true origin-header])
                                               (do
                                                 (log/trace "Origin header indicates alternate app origin" (pr-str origin-header))
                                                 [false origin-header])))

                                           (when referer-header
                                             (if-let [[_ referer-origin] (re-matches #"([^:/]+://[^/]+)/.*" referer-header)]

                                               (when-not (origin-subset? (:app-origin request) referer-origin)
                                                 (if (not-any? #(origin-subset? % referer-origin) (:valid-app-origins request))
                                                   (do
                                                     (log/trace "Referer header indicates cross-origin:" (pr-str referer-header) "->" (pr-str referer-origin)
                                                                "doesn't match" (:app-origin request) (:valid-app-origins request))
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
    (let [requested-session-id (or (-> req :params :s) (get-in req [:session (:app-id req) (:app-version req) :session-id]))
          request-with-session (request-with-session req requested-session-id)]

      (when-let [r (handler request-with-session)]
        ;; This will explicitly nuke any session state the handler set, stopping us from accidentally using it.
        (-> r
            (assoc :session (assoc-in (:session req)
                                      [(:app-id req) (:app-version req) :session-id]
                                      (when-not (:delete-session? r)
                                        ;; This (or) allows us to use temporary session IDs
                                        ;; we use for print sessions, when using a browser to access sessions
                                        ;; that don't normally have IDs (eg HTTP endpoints, uplink, etc)
                                        (or (:id @(:app-session request-with-session))
                                            requested-session-id))))
            (dissoc :delete-session?))))))



(defn with-app-version [handler]
  (fn [{:keys [path-info app-origin app-id] :as req}]
    (let [app-info (app-data/get-app-info-insecure app-id)
          [full-prefix version key] (re-find #"^/_version/([^/]*)/([^/]*)" path-info)]
      (if-not full-prefix
        ; No version was requested, valid or otherwise.
        (let [app-version (app-data/get-published-revision app-info)
              app-branch (if app-version "published" "master")]
          (handler (assoc req :app-version app-version
                              :app-branch app-branch
                              :app-info app-info
                              :anvil-debug false)))

        ;; A particular version was requested. If the key is invalid, return nil (404).
        (when (app-data/version-key-valid? app-id (:access-key app-info) version key)

          ; A valid version key was provided
          (let [app-version (condp = version
                              "dev" nil
                              (app-data/get-published-revision app-info))
                app-branch (if app-version "published" "master")]
            (handler (assoc req :path-info (.replace path-info full-prefix "")
                                :app-origin (str app-origin "/_version/" version "/" key)
                                :app-version app-version
                                :app-branch app-branch
                                :app-info app-info
                                :anvil-debug (= version "dev")))))))))



(defn with-unlocked-apps-only [handler]
  (fn [{:keys [app-id] :as request}]
    (if (util/app-locked? app-id)
      (-> (resp/response"This app is currently undergoing maintenance, please try again in a few minutes.")
          (resp/content-type "text/plain")
          (resp/status 503))
      (handler request))))

(defn is-password-pwned? [password]
  (let [sha1sum ^String (digest/sha-1 password)

        r (:body @(http/request {:url     (str "https://api.pwnedpasswords.com/range/" (.substring sha1sum 0 5))
                                 :headers {"user-agent" "Anvil"}}))
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
