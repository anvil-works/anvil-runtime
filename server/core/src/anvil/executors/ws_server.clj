(ns anvil.executors.ws-server
  (:require [org.httpkit.server :refer :all]
            [slingshot.slingshot :refer [throw+ try+]]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.background-tasks :as background-tasks]
            [anvil.executors.ws-calls :as ws-calls]
            [anvil.util :as util]
            [anvil.dispatcher.serialisation.core :as serialisation]
            [crypto.random :as random]
            [clojure.tools.logging :as log]
            [anvil.core.tracing :as tracing]
            [clojure.string :as str]
            [anvil.runtime.app-log :as app-log]
            [anvil.runtime.sessions :as sessions]
            [org.httpkit.server :as ws])
  (:import (io.opentelemetry.api.trace Span)))

(clj-logging-config.log4j/set-logger! :level :info)

;; Common functions for use by server sockets (downlink and uplink).
;; All this code has precisely two call sites, and it's pretty tightly coupled. If
;; you find yourself adding an (if) statement that acts differently on uplink and downlink,
;; perhaps you should just re-inline that code back into the downlink and uplink rather than
;; trying to maintain this tenuous abstraction.

(defonce background-tasks (atom {}))

(defn launch-bg-task! [{:keys [bg-impl-id]} extra-context {:keys [send-request!] :as connection} launcher-request return-path]
  (dispatcher/synchronous-return-path return-path
    (let [call-id (str "bg-" (random/base64 10))
          [bg-task request return-path] (background-tasks/setup-background-task-context
                                          launcher-request bg-impl-id #(swap! background-tasks dissoc (:id %)))
          task-name (str/replace (get-in request [:call :func]) #"^task:" "")
          bg-task-span (tracing/start-span (str "Background task: " task-name)
                                           (merge {:executor bg-impl-id
                                                   :launcher_session_id (sessions/get-id (:session-state launcher-request))}
                                                  (when-let [launch-span ^Span (:tracing-span request)]
                                                    {:launcher_trace_id (tracing/get-trace-id launch-span)})))
          request-with-task-span (assoc request :tracing-span bg-task-span)
          return-path (dispatcher/return-path-with-closing-span return-path bg-task-span)]

      (tracing/log-trace bg-task-span {:type :bg-task :task task-name})
      (app-log/record-trace! (:session-state request) (tracing/get-trace-id bg-task-span) (get-in request [:call :func]))

      (let [{:keys [request return-path call-context]} (ws-calls/stateful-request-to-serialisable-request request-with-task-span return-path nil)]
        (swap! background-tasks assoc (:id bg-task) {:task bg-task, :call-id call-id, :connection connection})
        (send-request! (-> call-context
                           (merge extra-context)
                           (assoc ::task-id (:id bg-task)))
                       {:type "LAUNCH_BACKGROUND", :id call-id} request return-path)
        (background-tasks/mk-BackgroundTaskLiveObject (:id bg-task))))))



(defn setup-bg-task-impl! [{:keys [bg-impl-id link-name disconnection-error]}]
  (swap! background-tasks/implementations assoc bg-impl-id
         {:kill!     (fn [{:keys [id] :as _task} return-path]
                       (dispatcher/synchronous-return-path return-path
                         (let [{:keys [call-id connection]} (@background-tasks id)]
                           (log/trace "Kill" link-name "background task:" {:type "KILL_TASK", :task call-id})
                           (when-not (and connection
                                          ((::send-raw! connection) (util/write-json-str {:type "KILL_TASK", :task call-id})))
                             (throw+ {:anvil/server-error (str link-name " disconnected") :type "anvil.server.NotRunningTask"})))
                         nil))

          :get-state (fn [{:keys [id] :as _task} return-path]
                       (dispatcher/report-exceptions-to-return-path return-path
                         (if-let [{:keys [call-id connection]} (@background-tasks id)]
                           (let [req-id (str "bgquery-" (random/base64 16))
                                 {:keys [app-info environment send-request!]} connection
                                 return-path {:update!  #(dispatcher/update! return-path %)
                                              :respond! #(dispatcher/respond! return-path
                                                                              (if (= (get-in % [:error :type]) disconnection-error)
                                                                                (assoc-in % [:error :type] "anvil.server.NotRunningTask")
                                                                                %))}]
                             (send-request! (ws-calls/new-call-context :bg-task-get-state app-info environment nil nil (atom {}))
                                            {:type "GET_TASK_STATE", :id req-id}
                                            {:task call-id}
                                            return-path))
                           (throw+ {:anvil/server-error "No such background task found" :type "anvil.server.NotRunningTask"}))))}))

(defn gen-call-id [serialisable-request]
  (str (if (= (:origin serialisable-request) :client) "client-" "server-")
       (random/base64 10)))

(defn setup-request-handlers [{:keys [link-name disconnection-error]} channel]
  (let [pending-responses (atom {})
        closed? (atom false)]
    {:get-pending-response  #(get @pending-responses %)
     :is-idle?              #(empty? @pending-responses)
     :get-pending-responses (fn [] @pending-responses)
     :get-bg-task           #(when-let [id (get-in @pending-responses [% :context ::task-id])]
                               {:id id})                    ;; fake it!
     :is-closed?            (fn [] @closed?)
     :send-request!         (fn send-request! [context {:keys [type id] :as _envelope} serialisable-request return-path]
                              (let [call-id (or id (gen-call-id serialisable-request))]
                                (log/trace "Sending" link-name "request" call-id ":" serialisable-request)

                                (when-not (ws/open? channel)
                                  (log/warn "About to try sending to a closed" link-name "websocket channel for app" (:app-id serialisable-request) (str "(" (:command serialisable-request) ")")))

                                (try
                                  (when return-path
                                    (swap! pending-responses assoc call-id {:context context :return-path return-path}))
                                  (serialisation/serialise-to-websocket!
                                    (-> serialisable-request
                                        (assoc :type (or type "CALL")
                                               :id call-id
                                               :call-stack-id call-id))
                                    channel false nil)
                                  (catch Exception e
                                    (log/error e "Error serialising uplink request")
                                    (swap! pending-responses dissoc call-id)
                                    (when return-path
                                      (dispatcher/respond! return-path {:error {:type "anvil.server.SerializationError" :message (str e)}}))))
                                (when (and @closed? return-path)
                                  ;; Avoid a race condition. If we were invoked as the connection was closing and we
                                  ;; added ourselves to pending-responses too late, our message could get lost without
                                  ;; an error because disconnection notices were already sent. But @closed is set _before_
                                  ;; disconnection errors go out, which means that if there's any danger that we didn't
                                  ;; safely record ourselves in pending-responses, we'll hit this code path.
                                  ;; (This might issue duplicate errors, but that's not a problem.)
                                  (dispatcher/respond! return-path
                                                       {:error {:type disconnection-error, :message (str link-name " disconnected")}}))))
     :send-close-errors!    (fn closed! [error-to-send]
                              (reset! closed? true)
                              (doseq [[_ p] @pending-responses]
                                (dispatcher/respond! (:return-path p) {:error error-to-send})))

     :handle-response!      (fn handle-response! [response]
                              (when-let [{:keys [return-path]} (-> (@pending-responses (:id response)))]
                                (log/trace "Handling response:" response)
                                (when-let [pymods (:sessionData response)]
                                  (log/trace "Got session data")
                                  (dispatcher/update! return-path {:update-python-session pymods}))
                                (dispatcher/respond! return-path response)
                                (swap! pending-responses dissoc (:id response))))

     :handle-task-killed!   (fn handle-task-killed! [ds response]
                              (when-let [ctx (get-in @pending-responses [(:id response) :context])]
                                (let [task-id (::task-id ctx)
                                      data (serialisation/deserialise ds response)
                                      session @(::ws-calls/current-session ctx)]
                                  (background-tasks/record-final-state! session {:id task-id} (if (:taskState data) {:taskState (:taskState data)} {}) :killed)
                                  (swap! pending-responses dissoc (:id response)))))

     :handle-update!        (fn handle-update! [update]
                              (when-let [p (@pending-responses (:id update))]
                                (dispatcher/update! (:return-path p) update)))}))


