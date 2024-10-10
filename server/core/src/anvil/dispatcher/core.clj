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
            [anvil.runtime.accounting :as accounting]
            [anvil.dispatcher.types :as types]
            [anvil.metrics :as metrics]
            [anvil.core.tracing :as tracing]
            [clojure.string :as str]
            [anvil.runtime.sessions :as sessions])
  (:import (io.opentelemetry.api.trace Span StatusCode)))

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

;; Native RPC functions for table access only
(defonce db-only-native-rpc-handlers (atom {}))

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
    (catch :anvil/websocket-payload-too-large e
      (respond! return-path {:error {:message "Data payload too big - please use Media objects to transfer large amounts of data." :type "anvil.server.SerializationError"}}))
    (catch Object e
      (let [error-id (random/hex 6)]
        (log/error e "Unexpected error in synchronous-return-path code:" error-id)
        (respond! return-path {:error {:message (str "Internal server error: " error-id)}})))))

(defmacro synchronous-return-path [return-path & body]
  `(-synchronous-return-path ~return-path true (fn [] ~@body)))

(defmacro report-exceptions-to-return-path [return-path & body]
  `(-synchronous-return-path ~return-path false (fn [] ~@body)))

;; TODO: Stop retrying when source of request is gone (e.g. websocket disconnected, #653)

(def ^:dynamic ^Span *responding-span* nil)

(defn return-path-with-closing-span [return-path span]
  {:respond! (fn [resp]
               (if (:error resp)
                 (.setStatus span (StatusCode/ERROR))
                 (.setStatus span (StatusCode/OK)))
               (tracing/end-span! span)
               (respond! return-path resp))
   :update!  (fn [update]
               ;; We may choose to add tracing events here.
               (update! return-path update))})

(defn request-task-description [{{:keys [live-object func] :as call} :call
                                 :keys [background? command liveObjectCall] :as request}]
  ;; Request might be serialised (command/liveObjectCall) or full (func/live-object). Cope with either.
  (cond
    call
    (let [func-description (if live-object (format "%s.%s" (:backend live-object) func) func)]
      {:short func-description
       :long  (str (if background? "Launch Background Task: " "Server call: ") (str/replace func-description #"^task:" ""))})

    command
    {:short command
     :long  (str (if background? "Launch Background Task: " "Server call: ") (str/replace command #"^task:" ""))}

    liveObjectCall
    (let [func-description (str (-> liveObjectCall :backend) "." (-> liveObjectCall :method))]
      {:short func-description
       :long  (str (if background? "Launch Background Task: " "Server call: ") (str/replace func-description #"^task:" ""))})

    :else
    "Unknown"))

(defn generate-child-span-and-return-path [{{:keys [live-object func] :as call} :call
                                            :keys [session-state call-stack tracing-span use-existing-tracing-span? background?] :as request} return-path]
  (let [return-path (or return-path {:respond! (fn [_])
                                     :update! (fn [_])})]
    (if use-existing-tracing-span?
      [(dissoc request :use-existing-tracing-span?) return-path tracing-span]
      (let [task-description (request-task-description request)
            child-span (tracing/start-span (str "Dispatch: " (:long task-description))
                                           {:task (:short task-description)
                                            :session-id (sessions/get-id session-state)}
                                           tracing-span)
            return-path (return-path-with-closing-span return-path child-span)
            request (assoc request :tracing-span child-span)]

        (when-not (or tracing-span (= (:short task-description) "anvil.private.echo"))
          (when (not= (count call-stack) 1)
            (log/trace "Called dispatch without tracing span and with invalid call stack" (:short task-description) (pr-str call-stack)))
          (tracing/log-trace child-span {:type (:type (first call-stack))
                                         :task (:short task-description)})
          (app-log/record-trace! session-state (tracing/get-trace-id child-span) (:short task-description)))
        [request return-path child-span]))))

(defn dispatch!
  [{{:keys [live-object args kwargs func] :as call} :call
    :keys [app app-id app-info environment app-origin session-state call-stack origin thread-id use-quota? background? scheduled? tracing-span use-existing-tracing-span? vt_global]
    :as request}
   return-path]

  (let [[request return-path child-span] (generate-child-span-and-return-path request return-path)]

    (when (not= "anvil.private.echo" func)
      (log/debug "Dispatch!" (str func (when live-object (str " (" (:backend live-object) ")"))) "for" app-id)
      (log/trace "Args:" (pr-str args))
      (log/trace "Kwargs:" (pr-str kwargs)))


    (cond
      (util/app-locked? app-id)
      (do
        (log/debug (str "Cannot dispatch function " (pr-str func) " on locked app '" app-id "'"))
        (respond! return-path {:error {:type    "anvil.server.InternalError",
                                       :message (str "This app is currently down for maintenance. Please try again in a few minutes.")}}))

      (> (count call-stack) 10)
      (do
        (respond! return-path {:error {:type    "anvil.server.StackOverflow",
                                       :message (str "Too many nested anvil.server.call()s")}}))

      (and (re-matches #".*:.*" func) (= :client origin))
      (do
        (log/debug "Denied client access to scoped function" (pr-str func))
        (respond! return-path {:error {:type    "anvil.server.PermissionDenied",
                                       :message (str "Cannot call scoped server function " (pr-str func) " from client code")}}))

      (when-let [limit (accounting/limit? app-id)]
        (or (= :client origin) (= (:type limit) :all)))
      (respond! return-path {:error {:type    "anvil.server.PermissionDenied",
                                     :message (str "This app cannot be accessed due to plan limits being exceeded.")}})

      :else
      (binding [*stale-uplink?* (atom false)]
        (let [start-time (System/nanoTime)
              dispatch-end (atom 0)
              clock-stopped (atom 0)
              metrics-timer (atom nil)
              wrapped-respond! (fn [resp]
                                 (when (and use-quota? (= 1 (swap! clock-stopped inc)))
                                   (accounting/record-platform-server-use! session-state (/ (double (- (System/nanoTime) start-time)) 1000000000.0)))

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
                        (let [{:keys [content version dependency-versions]} (tracing/with-span ["Load app" {:internal true} child-span]
                                                                              (app-data/get-app app-info (app-data/get-version-spec-for-environment environment) false))]
                          (-> request
                              (assoc :app content)
                              (update-in [:environment] assoc :commit-id version :dependency-commit-ids dependency-versions))))

              request (if thread-id
                        request
                        (assoc request :thread-id (str (name (or origin :unknown)) "-" (random/base64 18))))

              ;; TODO: We will create a permissions system where executors/dispatch handlers
              ;;       gate which things you're allowed to call based on your permissions.
              ;;       For now, we hard-code the first use case, which is "table uplink keys
              ;;       can only access table functions"
              executor (if (= origin :db-read-uplink)
                         (util/with-meta-when {:executor :native}
                                              (or (when-not live-object
                                                    (get @db-only-native-rpc-handlers func))
                                                  {:fn (fn [req return-path] (respond! return-path {:error {:message (format "Illegal call target for DB uplink: %s" func) :type "anvil.server.PermissionDenied"}}))}))
                         (or (util/with-meta-when {:executor :native}
                                                  (if live-object
                                                    (get @native-live-object-backends (:backend live-object))
                                                    (get @native-rpc-handlers func)))

                             (some #(% request) (second @dispatch-handlers))))]
          (if-not executor
            (do
              (log/error (str "Internal server error: Server runtime not available for app " app-id " when calling " func))
              (respond! return-path {:error {:message (str "Internal server error: Server runtime not available.")}}))

            (do
              (when (not= "anvil.private.echo" func)
                (log/trace "Using executor:" executor))
              (let [executor-fn (:fn executor)

                    return-path (assoc return-path
                                  :respond! (fn [resp]
                                              (when (not= "anvil.private.echo" func)
                                                (log/trace "Executor responded:" (pr-str resp)))
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
                (tracing/merge-span-attrs child-span (-> metric-labels
                                                         (dissoc :native-fn)))

                (try+
                  (if-not background?
                    (do
                      (reset! dispatch-end (System/nanoTime))
                      (executor-fn request return-path))
                    (let [background-launch-fn (or (:bg-fn executor) (partial @default-background-wrapper executor))]
                      (background-launch-fn request return-path)))

                  (catch Object e
                    (let [error-id (random/hex 6)]
                      (log/error e "Unexpected error in downlink executor:" error-id)
                      (respond! return-path {:error {:message (str "Internal server error: " error-id)}}))))))))))))
