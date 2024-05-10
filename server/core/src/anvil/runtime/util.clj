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
            [hiccup.util :as hiccup-util]
            [clojure.java.io :as io])
  (:import (com.google.common.net InternetDomainName)))

;;(clj-logging-config.log4j/set-logger! :level :trace)




(defn reload-anvil-cookies! [into-session req]
  ;; When a request comes in, we have some stuff on the actual cookies coming into the request. It might be
  ;; different to what the session thinks - if so, the request wins
  (when-let [current-cookies-serialised (:cookies @into-session)]
    (let [session-current-local (cookies/deserialise-cookie (:local current-cookies-serialised))
          session-current-shared (cookies/deserialise-cookie (:shared current-cookies-serialised))
          req-local-serialised (get-in req [:cookies (:local conf/app-cookie-names) :value])
          req-shared-serialised (get-in req [:cookies (:shared conf/app-cookie-names) :value])
          req-local (cookies/deserialise-cookie req-local-serialised)
          req-shared (cookies/deserialise-cookie req-shared-serialised)]

      (when (or (not= session-current-local req-local)
                (not= session-current-shared req-shared))
        (swap! into-session update-in [:cookies] merge
               (when req-local {:local req-local-serialised})
               (when req-shared {:shared req-shared-serialised}))))))

(defn with-identify-cross-origin [handler]
  (fn [request]
    (let [origin-header (get-in request [:headers "origin"])
          referer-header (get-in request [:headers "referer"])
          origin-subset? (fn [valid-app-origin provided-header]
                           ;; NB an app origin may include path components, and origin/referer header is likely
                           ;; just a top-level domain, so we have to accept headers that are the domain component of
                           ;; the origin:
                           (or (= valid-app-origin provided-header)
                               (.startsWith valid-app-origin (str provided-header "/"))))

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

(defn apply-substitutions [content substitutions]
  (reduce (fn [^String content [^String k ^String v]]
            (.replace content k ^String (or v "")))
          content
          substitutions))

(defn populate-template [resource & substitution-maps]
  (let [content (slurp resource)]
    (reduce apply-substitutions content substitution-maps)))

(defn with-assert-app-id [handler]
  (fn [req]
    (assert (contains? req :app-id))
    (assert (contains? req :app-info))
    (handler req)))

(defonce runtime-client-resource (fn
                               ([req path] (runtime-client-resource req "runtime-client-core" path))
                               ([req prefix path] (io/resource (str prefix path)))))

(defonce get-static-origin (fn [req] conf/static-root-url))

;; Don't merge the substitutions here since order matters
;; an earlier substitution (e.g. legacy-bootstrap-css) might include {{app-origin}}
(defn serve-templated-html [req resource & substitutions]
  (let [base-substitutions {"{{canonical-url}}" (hiccup-util/escape-html (:app-origin req))
                            "{{cdn-origin}}"    (get-static-origin req)
                            "{{app-origin}}"    (hiccup-util/escape-html (:app-origin req))}]
    (-> (apply populate-template resource (conj (vec substitutions) base-substitutions))
        (resp/response)
        (resp/content-type "text/html"))))

(defonce get-runtime-app-info (fn [environment] {:id "" :branch nil :environment (select-keys environment [:description :tags])}))

(def set-hooks! (util/hook-setter #{runtime-client-resource get-static-origin get-runtime-app-info}))