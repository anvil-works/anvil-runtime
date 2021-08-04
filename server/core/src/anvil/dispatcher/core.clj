(ns anvil.dispatcher.core
  (:use [slingshot.slingshot :only [throw+ try+]]
        [clojure.pprint])
  (:require [anvil.runtime.conf :as conf]
            clojure.core.async.impl.protocols
            [clojure.tools.logging :as log]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.quota :as quota]
            [anvil.util :as util]
            [crypto.random :as random]
            [anvil.runtime.app-log :as app-log]
            [anvil.dispatcher.types :as types]
            [anvil.metrics :as metrics]))


(clj-logging-config.log4j/set-logger! :level :warn)

;; Dispatch handlers

;; Pair of a map of key->spec and a sorted list
(defonce dispatch-handlers (atom '[{} ()]))
(defn register-dispatch-handler! [key priority handler-func]
  (swap! dispatch-handlers
         (fn [[specs-by-key _sorted-fns]]
           (let [specs-by-key (assoc specs-by-key key [priority handler-func])
                 sorted-fns (sort-by first (map second specs-by-key))]
             [specs-by-key (map second sorted-fns)]))))


;; Special flag for missed Uplink)
(def ^:dynamic *stale-uplink?*)

;; Some useful constants

(def UPLINK-PRIORITY 10)
(def DOWNLINK-PRIORITY 20)
(def SANDBOX-PRIORITY 30)
(def CATCHALL-PRIORITY 100)

;; Native RPC functions and LiveObject backends are registered by name
(defonce native-rpc-handlers (atom {}))
(defonce native-live-object-backends (atom {}))

(defonce default-background-wrapper (atom nil))

(defonce response-routes (atom {}))

;; Standard dispatch

(defn route-response! [resp-type-kw return-path data]
  (if-let [direct-fn (get return-path resp-type-kw)]
    (direct-fn data)
    (if-let [route-handler (get @response-routes (:via return-path))]
      (route-handler resp-type-kw return-path data)
      (throw (Exception. (str "Invalid return path: " return-path))))))

(defn update! [return-path data]
  (route-response! :update! return-path data))

(defn respond! [return-path response]
  (route-response! :respond! return-path response))

;; A utility macro
(defn -synchronous-return-path [return-path return? f]
  (try+
    (if return? (respond! return-path {:response (f)}) (f))
    (catch :anvil/server-error e
      (respond! return-path {:error {:message (:anvil/server-error e), :type (:type e)}}))
    (catch Exception e
      (let [error-id (random/hex 6)]
        (log/error e "Unexpected error in synchronous-return-path code:" error-id)
        (respond! return-path {:error {:message (str "Internal server error: " error-id)}})))))

(defmacro synchronous-return-path [return-path & body]
  `(-synchronous-return-path ~return-path true (fn [] ~@body)))

(defmacro report-exceptions-to-return-path [return-path & body]
  `(-synchronous-return-path ~return-path false (fn [] ~@body)))

;; TODO: Stop retrying when source of request is gone (e.g. websocket disconnected, #653)

(defn dispatch!
  [{{:keys [live-object args kwargs func] :as call} :call
    :keys [app app-id app-info environment app-origin session-state call-stack origin thread-id use-quota? background? scheduled? vt_global]
    :as request}
   return-path]

  (when (not= "anvil.private.echo" func)
    (log/debug "Dispatch!" (str func (when live-object (str " (" (:backend live-object) ")"))) "for" app-id)
    (log/trace "Args:" (pr-str args))
    (log/trace "Kwargs:" (pr-str kwargs)))

  (when (util/app-locked? app-id)
    (log/debug (str "Cannot dispatch function " (pr-str func) " on locked app '" app-id "'"))
    (respond! return-path {:error {:type    "anvil.server.InternalError",
                                   :message (str "This app is currently down for maintenance. Please try again in a few minutes.")}})
    (throw+ {:anvil/server-error "App down for maintenance"}))

  (when (> (count call-stack) 10)
    (respond! return-path {:error {:type    "anvil.server.StackOverflow",
                                   :message (str "Too many nested anvil.server.call()s")}})
    (throw+ {:anvil/server-error "Too many nested anvil.server.call()s"}))

  (when (and (re-matches #".*:.*" func) (= :client origin))
    (log/debug "Denied client access to scoped function" (pr-str func))
    (respond! return-path {:error {:type    "anvil.server.PermissionDeniedError",
                                   :message (str "Cannot call scoped server function " (pr-str func) " from client code")}})
    (throw+ {:anvil/server-error "Cannot call scoped server function from client code"}))

  (binding [*stale-uplink?* (atom false)]
    (let [start-time (System/nanoTime)
          dispatch-end (atom 0)
          clock-stopped (atom 0)
          metrics-timer (atom nil)
          wrapped-respond! (fn [resp]
                             (when (and use-quota? (= 1 (swap! clock-stopped inc)))
                               (quota/decrement! session-state environment
                                                 :server-time
                                                 (/ (double (- (System/currentTimeMillis) start-time)) 1000)))

                             (when-let [stop-timer! @metrics-timer]
                               (stop-timer!))

                             (respond! return-path
                                       (merge resp
                                              (when (and session-state
                                                         (:anvil/enable-profiling @session-state))
                                                {:profile (merge {:origin      "Server (Native)"
                                                                  :description (str "Server dispatch (" func ")")
                                                                  :start-time  (/ start-time 1000000.0)
                                                                  :end-time    (/ (System/nanoTime) 1000000.0)}
                                                                 (when (:profile resp)
                                                                   {:children [{:origin "Dispatch" :description "Dispatch setup" :start-time (/ start-time 1000000.0) :end-time (/ @dispatch-end 1000000.0)} (:profile resp)]}))}))))

          return-path (assoc return-path :respond! wrapped-respond!)

          request (if app-info
                    request
                    (assoc request :app-info (or (and session-state (:app-info @session-state))
                                                 (app-data/get-app-info-insecure app-id))))
          app-info (:app-info request)
          request (if (or app (not app-id))
                    request
                    (let [{:keys [content version dependency-versions]} (app-data/get-app app-info (app-data/get-version-spec-for-environment environment) false)]
                      (-> request
                          (assoc :app content)
                          (update-in [:environment] assoc :commit-id version :dependency-commit-ids dependency-versions))))

          request (if thread-id
                    request
                    (assoc request :thread-id (str (name (or origin :unknown)) "-" (random/base64 18))))

          executor (or (util/with-meta-when {:executor :native}
                                            (if live-object
                                              (get @native-live-object-backends (:backend live-object))
                                              (get @native-rpc-handlers func)))

                       (some #(% request) (second @dispatch-handlers))

                       (do
                         (respond! return-path {:error {:message (str "Internal server error: Server runtime not available.")}})
                         (log/error (str "Internal server error: Server runtime not available for app " app-id " when calling " func))
                         (throw+ {:anvil/server-error "Internal server error: Server runtime not available."})))

          _ (log/trace "Using executor:" executor)
          executor-fn (:fn executor)

          return-path (assoc return-path
                        :respond! (fn [resp]
                                    (log/trace "Executor responded:" (pr-str resp))
                                    (respond! return-path resp)))

          request (assoc request :stale-uplink? @*stale-uplink?*)

          executor-type (get (meta executor) :executor :unknown)
          metric-labels {:executor  (name executor-type)
                         :version   (get (meta executor) :version nil)

                         :type      (cond
                                      live-object "lo-method-call"
                                      scheduled? "scheduled-task"
                                      background? "background-task"
                                      :else "function-call")

                         :native-fn (when (= :native executor-type)
                                      (str (when live-object (str (:backend live-object) ".")) func))}]


      ;;(log/trace "Using executor:" executor)
      (reset! metrics-timer (metrics/start-timer :api/runtime-dispatch-duration-seconds metric-labels))

      (try+
        (if-not background?
          (do
            (reset! dispatch-end (System/nanoTime))
            (executor-fn request return-path))
          (let [background-launch-fn (or (:bg-fn executor) (partial @default-background-wrapper executor))]
            (background-launch-fn request return-path)))

        (catch :anvil/runtime-unavailable e
          ;; We've already responded. Don't do anything - no need to clutter the logs.
          )
        (catch Exception e
          (let [error-id (random/hex 6)]
            (log/error e "Unexpected error in downlink executor:" error-id)
            (respond! return-path {:error {:message (str "Internal server error: " error-id)}})))))))
