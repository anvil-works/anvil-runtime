(ns anvil.executors.ws-server
  (:require [org.httpkit.server :refer :all]
            [slingshot.slingshot :refer [throw+ try+]]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.background-tasks :as background-tasks]
            [anvil.executors.ws-calls :as ws-calls]
            [anvil.util :as util]
            [anvil.dispatcher.serialisation.core :as serialisation]
            [crypto.random :as random]
            [clojure.tools.logging :as log]))

(clj-logging-config.log4j/set-logger! :level :info)

;; Common functions for use by server sockets (downlink and uplink).
;; All this code has precisely two call sites, and it's pretty tightly coupled. If
;; you find yourself adding an (if) statement that acts differently on uplink and downlink,
;; perhaps you should just re-inline that code back into the downlink and uplink rather than
;; trying to maintain this tenuous abstraction.

(defonce background-tasks (atom {}))

(defn launch-bg-task! [{:keys [bg-impl-id]} extra-context {:keys [send-request!] :as connection} request return-path]
  (dispatcher/synchronous-return-path return-path
    (let [call-id (str "bg-" (random/base64 10))
          [bg-task request return-path] (background-tasks/setup-background-task-context
                                          request bg-impl-id #(swap! background-tasks dissoc (:id %)))
          {:keys [request return-path call-context]} (ws-calls/stateful-request-to-serialisable-request request return-path nil)]
      (swap! background-tasks assoc (:id bg-task) {:task bg-task, :call-id call-id, :connection connection})
      (send-request! (-> call-context (merge extra-context) (assoc ::task-id (:id bg-task)))
                     {:type "LAUNCH_BACKGROUND", :id call-id} request return-path)
      (background-tasks/mk-BackgroundTaskLiveObject (:id bg-task)))))



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

(defn setup-request-handlers [{:keys [link-name disconnection-error]} channel]
  (let [pending-responses (atom {})
        closed? (atom false)]
    {:get-pending-response  #(get @pending-responses %)
     :is-idle?              #(empty? @pending-responses)
     :get-pending-responses (fn [] @pending-responses)
     :get-bg-task           #(when-let [id (get-in @pending-responses [% ::task-id])]
                               {:id id})                    ;; fake it!
     :is-closed?            (fn [] @closed?)
     :send-request!         (fn send-request! [context {:keys [type id] :as _envelope} serialisable-request return-path]
                              (let [call-id (or id
                                                (str (if (= (:origin serialisable-request) :client) "client-" "server-")
                                                     (random/base64 10)))]
                                (log/trace "Sending" link-name "request" call-id ":" serialisable-request)

                                (try
                                  (swap! pending-responses assoc call-id {:context context :return-path return-path})
                                  (serialisation/serialise-to-websocket!
                                    (-> serialisable-request
                                        (assoc :type (or type "CALL")
                                               :id call-id
                                               :call-stack-id call-id))
                                    channel false nil)
                                  (catch Exception e
                                    (log/error e "Error serialising uplink request")
                                    (swap! pending-responses dissoc call-id)
                                    (dispatcher/respond! return-path {:error {:type "anvil.server.SerializationError" :message (str e)}})))
                                (when @closed?
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

     :handle-update!        (fn handle-update! [update]
                              (when-let [p (@pending-responses (:id update))]
                                (ws-calls/process-update-from-ws (:return-path p) update)))}))


