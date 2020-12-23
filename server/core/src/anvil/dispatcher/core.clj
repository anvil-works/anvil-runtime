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


(clj-logging-config.log4j/set-logger! :level :debug)

#_(comment
    (defn run-executor-server!
      "Starts a server that can interpret calls"
      [on-call-fn])

    (def OUR-SERVICE-URL (or (System/getenv "ANVIL_SERVICE_URL") "ws://localhost:5500"))

    (defn delete-our-ads! []
      (jdbc/execute! util/db ["DELETE FROM service_ads WHERE url=?" OUR-SERVICE-URL]))

    (defonce deleted-old-ads (delete-our-ads!))

    (defn advertise!
      "Places an advertisement in the database, saying that the provided spec map is available on this node"
      [spec]
      (jdbc/execute! util/db ["INSERT INTO service_ads (url,spec) VALUES (?,?::jsonb)" OUR-SERVICE-URL spec]))

    (defn get-executors [spec]
      (let [executors (jdbc/query util/db ["SELECT url,spec FROM service_ads WHERE spec @> ?::jsonb OR spec @> ?::jsonb OR spec @> ?::jsonb OR spec @> ?::jsonb"
                                           (select-keys spec [:app-id :func])
                                           (select-keys spec [:app-id :backend])
                                           {:app-id (:app-id spec), :func nil, :backend nil}
                                           {:app-id nil, :func nil, :backend nil, :runtime (:runtime spec)}])
            executors (sort-by #(cond
                                  (or (:func %) (:backend %)) 0
                                  (:app-id %) 1
                                  :else 2)
                               executors)]
        executors))

    (def message-from-executor)
    (def executor-connection-died)

    (let [sockets (ref {})]
      (defn get-executor-send-fn [executor-location]
        (let [new-socket-promise (promise)
              new? (dosync
                     (when-not (get @sockets executor-location)
                       (alter sockets assoc executor-location new-socket-promise)))]
          (when new?
            (let [ws-promise (promise)
                  ds (serialisation/mk-Deserialiser)
                  kill-conn (fn [err]
                              (log/debug "Dispatcher websocket closed:" (pr-str err))
                              (dosync (alter sockets dissoc executor-location))
                              (executor-connection-died executor-location err)
                              (ws/close @ws-promise))]
              (future
                (Thread/sleep 500)
                (when-not (realized? new-socket-promise)
                  (kill-conn "Connection timed out")))
              (deliver ws-promise
                       (ws/connect executor-location
                                   :on-connect (fn [conn]
                                                 (log/debug "Dispatcher websocket connected")
                                                 (deliver new-socket-promise @ws-promise))
                                   :on-receive (fn [msg]
                                                 (log/trace "Dispatcher received" msg)
                                                 (let [msg (json/read-str msg :key-fn keyword)]
                                                   (cond
                                                     (= (:type msg) "CHUNK_HEADER")
                                                     (serialisation/processBlobHeader ds msg)

                                                     :else
                                                     (message-from-executor executor-location (serialisation/deserialise ds msg :NOW-BROKEN)))))

                                   :on-binary #(serialisation/processBlob ds %)
                                   :on-error kill-conn
                                   :on-close #(fn [_ reason]
                                                (kill-conn reason))))))

          (fn send-fn [msg]
            (ws/send-msg @(get @sockets executor-location) msg)))))



    ;; Layers will be:
    ;; Try executors - In: "Try to make this call", Out: callbacks for when call succeeds or fails
    ;; Call manager - In: "Try to make this call on this executor", Out: callbacks for when this call succeeds or fails
    ;; Executors - In: "try to send this message", Out: general callbacks for "got message" (can be response, error or update)

    (def execute!)

    (let [pending-requests (atom {})]                         ;; executor -> id -> callbacks

      (defn make-call-on-executor [executor-url request on-update on-response]
        ;; Retrieve a connection to executor (url)
        ;; Invent a request ID
        ;; Store update and response callbacks in pending-requests (augmenting response to also remove from pending-requests)
        ;; Send request

        (let [id (random/base64 10)
              executor-send! (get-executor-send-fn executor-url)]
          (swap! pending-requests assoc-in [executor-url id] {:on-update   on-update
                                                              :on-response on-response})
          (executor-send! (assoc request :id id :type "CALL"))))

      (defn message-from-executor [executor-url msg]
        (log/trace "Message from" executor-url ":" (pr-str msg))

        (when-let [request-id (:id msg)]
          (if-let [{:keys [on-update on-response]} (get-in @pending-requests [executor-url request-id])]
            (cond
              (or (:error msg) (:response msg)) (do (swap! pending-requests update-in [executor-url] dissoc request-id)
                                                    (on-response msg))

              (:output msg) (on-update msg)

              :else (log/debug "Unknown message" (pr-str msg)))

            (log/debug "Orphaned message to nonexistent/completed request" (:id msg)))))

      (defn executor-connection-died [executor-url err]
        (let [swap-returning-old! (fn [atom f & args]
                                    (loop [old-value @atom]
                                      (if (compare-and-set! atom old-value (apply f old-value args))
                                        old-value (recur @atom))))

              orphaned-requests (-> (swap-returning-old! pending-requests dissoc executor-url)
                                    (get executor-url))]

          (doseq [[_id callbacks] orphaned-requests]
            ((:on-response callbacks) {:error {:message "Executor died" :err-string (str err)}})))))


    (defn dispatch!
      "Execute a server call on whichever executor is appropriate. Calls on-update with intermediate updates,
       on-response with the final result (which will be a map with :session-state and :return-value or :error)."
      [{{:keys [backend method args kwargs func] :as call} :call
        :keys                                              [app app-id session-state origin]
        :as                                                request}
       on-update
       on-response]

      (let [executor-spec {:app-id app-id, :func func, :backend backend, :runtime "pypy-sandbox"}
            ;; TODO we will look up the correct runtime from the DB by app ID
            potential-executors (get-executors executor-spec)
            try-an-executor (fn try-an-executor [[executor & more-executors]]
                              (if executor
                                (make-call-on-executor executor request on-update
                                                       #(if (get-in % [:error :executor-call-failed])
                                                          (do
                                                            (log/debug "Failed to call on executor" executor)
                                                            (try-an-executor more-executors))
                                                          (on-response %)))

                                (on-response {:error {:message "No executors available"}})))]

        (try-an-executor (map :url potential-executors)))))


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


;; Standard dispatch

(defn update! [return-path data]
  ((:update! return-path) data))

(defn respond! [return-path response]
  ((:respond! return-path) response))

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

; This is here because we need it here and in the background-tasks ns, which imports this one.
(defn mk-BackgroundTaskLiveObject [id]
  (types/mk-LiveObjectProxy "anvil.private.BackgroundTask" (util/write-json-str id) [] ["get_id" "get_termination_status" "get_error" "get_state" "get_return_value" "get_task_name" "get_start_time" "is_completed" "is_running" "kill"]) )

;; TODO: Stop retrying when source of request is gone (e.g. websocket disconnected, #653)

(defn dispatch!
  [{{:keys [live-object args kwargs func vt_global] :as call} :call
    :keys [app app-id app-info environment app-origin session-state call-stack origin thread-id use-quota? background? scheduled?]
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
                    (let [{:keys [content version]} (app-data/get-app app-info (app-data/get-version-spec-for-environment environment))]
                      (-> request
                          (assoc :app content)
                          (update-in [:environment] assoc :commit-id version))))
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

      (try
        (if-not background?
          (do
            (reset! dispatch-end (System/nanoTime))
            (executor-fn request return-path))
          (let [background-launch-fn (or (:bg-fn executor) (partial @default-background-wrapper executor))
                background-id (background-launch-fn request)]
            (respond! return-path {:response (mk-BackgroundTaskLiveObject background-id)})))

        (catch Exception e
          (let [error-id (random/hex 6)]
            (log/error e "Unexpected error in downlink executor:" error-id)
            (respond! return-path {:error {:message (str "Internal server error: " error-id)}})))))))
