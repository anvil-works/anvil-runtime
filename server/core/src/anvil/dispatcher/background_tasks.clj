(ns anvil.dispatcher.background-tasks
  (:require [clojure.java.jdbc :as jdbc]
            [anvil.runtime.conf :as conf]
            [anvil.dispatcher.serialisation.core :as serialiser]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.util :as util]
            [crypto.random :as random]
            [anvil.runtime.app-log :as app-log]
            [clojure.tools.logging :as log]
            [clojure.data.json :as json]
            [clojure.string :as str]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.types :as types]
            [anvil.runtime.app-data :as app-data]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.runtime.sessions :as sessions]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks]
            [anvil.core.tracing :as tracing]
            [anvil.runtime.debugger :as debugger])
  (:use     [slingshot.slingshot :only [throw+ try+]])
  (:import (anvil.dispatcher.types DateTime)
           (java.sql Timestamp)
           (java.util Date)
           (java.io StringWriter)))

;; Background task managers available on this node
;; maps impl-name -> {:get-state, kill!}
(defonce implementations (atom {}))

(defrecord BackgroundTask [app_id env_id id task_name routing completion_status final_state start_time last_seen_alive session_id])

(defn mk-BackgroundTaskLiveObject [id]
  (types/mk-LiveObjectProxy "anvil.private.BackgroundTask" (util/write-json-str id) [] ["get_id" "get_termination_status" "get_error" "get_state" "get_return_value" "get_task_name" "get_start_time" "is_completed" "is_running" "kill"]) )

;; Background task management and routing hooks

(defonce do-kill-task! (fn [{:keys [routing] :as task} return-path]
                         ((get-in @implementations [(keyword routing) :kill!]) task return-path)))

(defonce do-get-task-state (fn [{:keys [routing] :as task} return-path]
                             ((get-in @implementations [(keyword routing) :get-state]) task return-path)))

(defn clean-all-finished-tasks-older-than! [started-before]
  (jdbc/execute! util/db ["DELETE FROM background_tasks WHERE completion_status IS NOT NULL AND start_time < to_timestamp(?)" (/ started-before 1000.0)]))

(defonce create-background-task-record
         (fn [_environment impl task-name session-id]
           (when-let [oldest-to-keep ^Timestamp (:start_time (last (jdbc/query util/db ["SELECT start_time FROM background_tasks WHERE completion_status IS NOT NULL ORDER BY start_time DESC LIMIT 1000"])))]
             (clean-all-finished-tasks-older-than! (.getTime oldest-to-keep)))
           (let [new-id (str/lower-case (random/base32 25))]
             (map->BackgroundTask (first (jdbc/query util/db ["INSERT INTO background_tasks (id,session_id,routing,task_name,debug,start_time,last_seen_alive) VALUES (?,?,?::jsonb,?,FALSE,NOW(),NOW()) RETURNING *"
                                                              new-id session-id (json/write-str (name impl)) task-name]))))))

(defonce list-background-tasks
         (fn [_environment _legacy-include-extra-environments?]
           (->> (jdbc/query util/db ["SELECT * FROM background_tasks"])
                (map map->BackgroundTask))))

(defonce load-background-task-in-environment
         (fn [_environment task-id]
           (when-let [a (first (jdbc/query util/db ["SELECT * FROM background_tasks WHERE id = ?" task-id]))]
             (map->BackgroundTask a))))

(defonce get-environment-for-background-task (fn [task] (throw (UnsupportedOperationException.))))

(def set-background-task-hooks! (util/hook-setter #{do-kill-task! do-get-task-state create-background-task-record list-background-tasks
                                                    load-background-task-in-environment get-environment-for-background-task}))

(defn load-background-task-by-id [db-c id]
  (first (->> (jdbc/query db-c ["SELECT * FROM background_tasks WHERE id = ?" id])
              (map map->BackgroundTask))))


(defn present-background-task [bt]
  (-> bt
      (select-keys [:id :completion_status :task_name :debug :session_id])
      (assoc :last_seen_alive (.getTime ^Timestamp (:last_seen_alive bt)))
      (assoc :start_time (.getTime ^Timestamp (:start_time bt)))
      (assoc :session_sha (util/sha-256 (str (:session bt))))))

;; Useful predicate for get-state
(defn is-running? [completion-status _final-state]
  {:response (nil? completion-status)})

(defn get-state
  ([task return-path]
   (get-state task return-path vector))
  ([task return-path render-resp]
   (dispatcher/report-exceptions-to-return-path return-path
     (if-not task
       (dispatcher/respond! return-path (render-resp "mia" nil))
       (let [deserialise #(serialiser/deserialise-from-map %)]
         (if (:completion_status task)
           (let [full-task (load-background-task-by-id util/db (:id task))]
             (dispatcher/respond! return-path (render-resp (:completion_status task) (deserialise (:final_state full-task)))))
           ;; We don't know. Go ask the implementation
           (do-get-task-state
             task
             {:update!  #(dispatcher/update! return-path %)
              :respond! (fn [{:keys [error response] :as r}]
                          (dispatcher/report-exceptions-to-return-path return-path
                            (cond
                              (not error)
                              (do
                                (jdbc/execute! util/db ["UPDATE background_tasks SET last_seen_alive=NOW() WHERE id=?"
                                                        (:id task)])
                                (dispatcher/respond! return-path (render-resp nil {:state response})))

                              (#{"anvil.server.NotRunningTask" "anvil.server.ExecutionTerminatedError" "anvil.server.TimeoutError" "anvil.server.InternalError" "anvil.server.RuntimeUnavailableError"} (:type error))
                              ;; TODO: We don't necessarily want to set the status to MIA here, but it's much less wrong than propagating other internal errors back to the result of get-state
                              (let [bt (util/with-db-transaction [db-c util/db]
                                         (let [bt (load-background-task-by-id db-c (:id task))]
                                           (if (nil? (:completion_status bt))
                                             (do
                                               (jdbc/execute! db-c ["UPDATE background_tasks SET completion_status='mia'::background_task_status WHERE id=?"
                                                                    (:id task)])
                                               (assoc bt :completion_status "mia"))
                                             ;; otherwise, something else won this race - leave them to it
                                             bt)))]

                                (dispatcher/respond! return-path (render-resp (:completion_status bt)
                                                                              (deserialise (:final_state bt)))))

                              :else                         ;; uncaught error querying task state
                              (dispatcher/respond! return-path r))))})))))))

(defn kill! [task return-path]
  (if (and task (not (:completion_status task)))
    (do-kill-task!
      task
      {:update!  #(dispatcher/update! return-path %)
       :respond! (fn [{:keys [error] :as r}]
                   (cond
                     (not error)
                     (dispatcher/respond! return-path {:response nil})

                     (#{"anvil.server.NotRunningTask" "anvil.server.RuntimeUnavailableError"} (:type error))
                     (do
                       (jdbc/execute! util/db ["UPDATE background_tasks SET completion_status='mia'::background_task_status WHERE id=? AND completion_status IS NULL" (:id task)])
                       (dispatcher/respond! return-path {:response nil}))

                     :else
                     (dispatcher/respond! return-path r)))})
    (dispatcher/respond! return-path {:response nil})))

(defn record-final-state! [session {:keys [id] :as _task} {:keys [taskState response error] :as _resp} error?]
  (let [[serialised-state error] (try+
                                   (if error
                                     [(serialiser/serialise-to-map {:state taskState}) error]
                                     [(serialiser/serialise-to-map {:state taskState :response response}) nil])
                                   (catch :anvil/media-serialisation-error e
                                     (log/error e response)
                                     [nil {:message "The state or return value could not be serialised"}])
                                   (catch :anvil/server-error e
                                     [nil {:message (:anvil/server-error e) :type (:type e)}])
                                   (catch Object e
                                     (log/error e response)
                                     [nil {:message "An unknown serialisation error occurred"}]))

        serialised-state (merge
                           serialised-state
                           (when error {:error error}))
        status (cond
                 (#{:threw :mia :killed} error?) (name error?)
                 error? "threw"
                 :else "completed")]

    (when (and (first (jdbc/query util/db [(str "UPDATE background_tasks SET completion_status = ?::background_task_status, final_state = ?::jsonb"
                                                (when (not= error? :mia) ", last_seen_alive=NOW()")
                                                " WHERE id = ? AND completion_status IS NULL RETURNING *")
                                           status serialised-state id]))
               session)

      ;; The session might already have ended - if this is the error coming in after a kill, for example.
      ;; So only record this event if we were the one to set the task's completion status
      (app-log/record-event! session nil "background_task_ended" nil {:status status}))))


;; When we send Media into a background task, we need to ensure that it has all arrived
;; before launch_background_task() returns. Ideally we'd plumb this through to the downlink,
;; but in the meantime realising it all in Clojure will do the trick.

(defn wait-for-media [req]
  (let [find-chunked-streams (fn find-media [obj path]
                               (cond
                                 (satisfies? types/ChunkedStream obj)
                                 [[obj path]]

                                 (satisfies? types/Media obj)
                                 nil

                                 (map? obj)
                                 (->> (for [[k v] obj]
                                        (find-media v (conj path k)))
                                      (apply concat))

                                 (sequential? obj)
                                 (->> (map-indexed (fn [idx v]
                                                     (find-media v (conj path idx))) obj)
                                      (apply concat))))

        chunked-streams (doall (concat (find-chunked-streams (:args (:call req)) [:call :args])
                                       (find-chunked-streams (:kwargs (:call req)) [:call :kwargs])))]

    (reduce (fn [req [obj path]]
              (assoc-in req path (blocking-hacks/ChunkedStream->Media obj)))
            req chunked-streams)))


(def rpc-handlers {"anvil.private.background_tasks.launch"    {:fn (fn [{{[task-fn] :args} :call, :keys [origin from-bg-task? app-id environment session-state tracing-span bg-task-timeout], :as request} return-path]
                                                                     (worker-pool/run-task! {:type :native-rpc,
                                                                                             :name ::bg-task-launch-async-for-media-wait
                                                                                             :tags (worker-pool/get-task-tags-for-dispatch-request request)}
                                                                       (dispatcher/report-exceptions-to-return-path return-path
                                                                         ;; This is naaaasty:
                                                                         (let [request (wait-for-media request)
                                                                               restrict? (app-data/abuse-caution? session-state app-id)
                                                                               return-path (assoc return-path :respond! (fn [resp]
                                                                                                                          ;; Response is always a BG task liveobject. Add its metadata to our tracing span.
                                                                                                                          ;; TODO: Once BG tasks are sensible Portable Classes, we won't need this DB lookup, we can include the session ID in the wire format for the object.
                                                                                                                          (when-let [response-id (get-in resp [:response :id])]
                                                                                                                            (let [task-id (json/read-str response-id)
                                                                                                                                  session-id (:session_id (first (jdbc/query util/db ["SELECT session_id FROM background_tasks WHERE id = ?" task-id])))]
                                                                                                                              (tracing/merge-span-attrs tracing-span {:task_id         task-id
                                                                                                                                                                      :task_session_id session-id})))
                                                                                                                          (dispatcher/respond! return-path resp)))]
                                                                           (when (= :client origin)
                                                                             (throw+ {:anvil/server-error "Can't launch background tasks from the client." :type "anvil.server.BackgroundTaskError"}))

                                                                           (when (and (= :pypy origin)
                                                                                      from-bg-task?)
                                                                             (throw+ {:anvil/server-error (str "Can't launch background tasks from other Background Tasks in the Restricted Python environment. " (if restrict?
                                                                                                                                                                                                                    "Please upgrade to use a Full Python server environment."
                                                                                                                                                                                                                    "Please choose a Full Python server environment.")) :type "anvil.server.BackgroundTaskError"}))

                                                                           ;; We could just launch the task here, but we want to limit free users to 2 concurrent tasks per app
                                                                           (let [do-dispatch! (fn [] (dispatcher/dispatch! (-> request
                                                                                                                               (assoc-in [:call :func] (str "task:" task-fn))
                                                                                                                               (update-in [:call :args] rest)
                                                                                                                               (dissoc :thread-id)
                                                                                                                               (assoc :background? true
                                                                                                                                      :scheduled? (boolean (:scheduled-task-id request))
                                                                                                                                      :bg-task-timeout (if restrict?
                                                                                                                                                         (min 300 (or bg-task-timeout 300))
                                                                                                                                                         bg-task-timeout)
                                                                                                                                      ;; It's useful to use the existing span here, because then we get all the task's executor info on *this* span, which has custom rendering anyway.
                                                                                                                                      :use-existing-tracing-span? true))
                                                                                                                           return-path))]

                                                                             (if-not restrict?
                                                                               (do-dispatch!)
                                                                               ;; Don't let it gobble too many resources. Get all the tasks that might still be running...
                                                                               (let [existing-tasks (list-background-tasks environment true)
                                                                                     potentially-running-tasks (filter #(nil? (:completion_status %)) existing-tasks)
                                                                                     state-responses (atom {})]

                                                                                 (if (< (count potentially-running-tasks) 2)
                                                                                   ;; There aren't many, so just go ahead and launch
                                                                                   (do-dispatch!)

                                                                                   ;; We probably have too many tasks running, so check whether they're still alive by swapping their completion statuses into an atom.
                                                                                   (doseq [task potentially-running-tasks]
                                                                                     (get-state task
                                                                                                {:update!  (partial dispatcher/update! return-path)
                                                                                                 :respond! (fn [{data :response}]
                                                                                                             (let [updated-state-responses (swap! state-responses assoc (:id task) data)]
                                                                                                               (when (= (count updated-state-responses) (count potentially-running-tasks))
                                                                                                                 ;; We have collected completion state from all the possibly-running tasks, now count how many are actually still running.
                                                                                                                 (if (< (count (filter identity (vals updated-state-responses))) 2)
                                                                                                                   (do-dispatch!)
                                                                                                                   (dispatcher/respond! return-path {:error {:message "Free users can only run two simultaneous Background Tasks."
                                                                                                                                                             :type    "anvil.server.BackgroundTaskError"}})))))}
                                                                                                is-running?))))))))))}
                   "anvil.private.background_tasks.get_by_id" (rpc-util/wrap-native-fn
                                                                (fn [_kwargs id]
                                                                  (when rpc-util/*client-request?*
                                                                    (throw+ {:anvil/server-error "Can't manage background tasks from the client" :type "anvil.server.BackgroundTaskError"}))
                                                                  (if (load-background-task-in-environment rpc-util/*environment* id)
                                                                    (mk-BackgroundTaskLiveObject id)
                                                                    (throw+ {:anvil/server-error (str "Background Task not found: " id)
                                                                             :type               "anvil.server.BackgroundTaskNotFound"}))))

                   "anvil.private.background_tasks.list"      (rpc-util/wrap-native-fn
                                                                (fn [{:keys [all_environments] :as _kwargs}]
                                                                  (when rpc-util/*client-request?*
                                                                    (throw+ {:anvil/server-error "Can't manage background tasks from the client" :type "anvil.server.BackgroundTaskError"}))
                                                                  (doall
                                                                    (for [bt (list-background-tasks rpc-util/*environment* all_environments)
                                                                          :let [id (:id bt)]]
                                                                      (mk-BackgroundTaskLiveObject id)))))})

(def live-object-backends {"anvil.private.BackgroundTask" {:fn (fn [{{func :func {:keys [id]} :live-object} :call :keys [origin environment] :as request} return-path]
                                                                 (dispatcher/report-exceptions-to-return-path return-path
                                                                   (let [id (json/read-str id :key-fn keyword)
                                                                         task (load-background-task-in-environment environment id)
                                                                         get-state (partial get-state task return-path)]
                                                                     (condp = func
                                                                       "get_id" (dispatcher/respond! return-path {:response id})
                                                                       "is_completed" (get-state (fn [status {:keys [error]}]
                                                                                                   (condp = status
                                                                                                     nil {:response false}
                                                                                                     "completed" {:response true}
                                                                                                     "killed" {:error {:message (str "The background task was killed.")
                                                                                                                       :type    "anvil.server.BackgroundTaskKilled"}}
                                                                                                     (if error
                                                                                                       {:error error}
                                                                                                       {:error {:message (str "The background task failed.")
                                                                                                                :type    "anvil.server.InternalError"}}))))

                                                                       "is_running" (get-state is-running?)

                                                                       "get_termination_status" (get-state (fn [status _state] {:response (condp = status
                                                                                                                                            nil nil
                                                                                                                                            "completed" "completed"
                                                                                                                                            "threw" "failed"
                                                                                                                                            "mia" "missing"
                                                                                                                                            "killed" "killed")}))
                                                                       "get_error" (get-state (fn [_status {:keys [error]}] (if error
                                                                                                                              {:error error}
                                                                                                                              {:response nil})))
                                                                       "get_state" (get-state (fn [_status {:keys [state]}]
                                                                                                ; TODO: Decide what to do in the case that there was a state serialisation error. Right now this returns None - should it throw? If so, how do we decide what type of error it was?
                                                                                                {:response state}))
                                                                       "get_return_value" (get-state (fn [_status {:keys [error response]}] (if error
                                                                                                                                              {:error error}
                                                                                                                                              {:response response})))
                                                                       "get_task_name" (dispatcher/respond! return-path
                                                                                                            (if task
                                                                                                              {:response (.substring (:task_name task) 5)}
                                                                                                              {:error {:message (str "Background Task not found: " id)
                                                                                                                       :type    "anvil.server.BackgroundTaskNotFound"}}))
                                                                       "get_start_time" (dispatcher/respond! return-path
                                                                                                             (if task
                                                                                                               {:response (DateTime. (str (:start_time task)))}
                                                                                                               {:error {:message (str "Background Task not found: " id)
                                                                                                                        :type    "anvil.server.BackgroundTaskNotFound"}}))
                                                                       "kill" (if (= :client origin)
                                                                                (throw+ {:anvil/server-error "Can't manage background tasks from the client" :type "anvil.server.BackgroundTaskError"})
                                                                                (kill! task return-path))
                                                                       (throw+ {:anvil/server-error (str "Unsupported BackgroundTask method: " func) :type "anvil.server.BackgroundTaskError"})))))}})

;; What follows is the default background-task handler, for backends that do not support background operations


;; A utility function, for use in pypy and local wrapper. It sets up a new background task record,
;; a new session, and a return path pointing to that task. The return value of the function is (optionally) used
;; as the final state.
(defn setup-background-task-context [{:keys [app-id app-origin environment scheduled-task-id tracing-span] {func :func} :call :as request} impl cleanup-fn]
  (let [new-session (sessions/new-session-with-state {:app-id      app-id
                                                      :app-origin  app-origin
                                                      :client      {:type :background_task}
                                                      :environment environment}
                                                     (merge {:func func}
                                                            (when scheduled-task-id
                                                              {:scheduled_task scheduled-task-id})))
        log-ctx (merge {:app-session new-session}
                       (select-keys request [:app-id :environment]))
        task (create-background-task-record environment impl func (sessions/get-id new-session))
        _ (swap! new-session assoc-in [:client :background-task-id] (:id task))

        return-path {:update!  (fn [{:keys [output debuggers]}]
                                 (when debuggers
                                   (debugger/handle-debugger-update! environment {:type "background_task"} debuggers nil))
                                 (when output
                                   (app-log/record-event! new-session (tracing/get-trace-id tracing-span) "print" output nil)))
                     :respond! (fn [{:keys [error] :as resp}]
                                 (record-final-state! new-session task resp (boolean error))

                                 (when error
                                   (app-log/record-event! new-session (tracing/get-trace-id tracing-span) "err" (str (:type error) ": " (:message error)) error))
                                 (when cleanup-fn
                                   (cleanup-fn task)))}]

    [task (assoc request :session-state new-session) return-path]))


;; Special background things
(defonce local-background-tasks (atom {}))

(def respond!)
(defn launch-local-background-task!
  ([executor request]
   ;; Launch an background task on a non-async-aware executor, using return value as final state
   (let [[bt {:keys [session-state] :as request} return-path] (setup-background-task-context request :local-wrapper #(swap! local-background-tasks dissoc (:id %)))
         task-state (atom {})]

     (swap! local-background-tasks assoc (:id bt) {:task-state task-state})

     (try+
       ((:fn executor) (-> request
                           (assoc ::task bt)
                           (assoc ::task-state task-state)
                           (dissoc :background?))
        return-path)
       (catch :anvil/server-error e
         (record-final-state! session-state bt {:error {:message (:anvil/server-error e) :type (:type e)}} true)
         (swap! local-background-tasks dissoc (:id bt)))
       (catch Object e
         (record-final-state! session-state bt {:error {:message "Internal error launching task"}} true)
         (swap! local-background-tasks dissoc (:id bt))
         (throw e)))

     (mk-BackgroundTaskLiveObject (:id bt))))
  ([executor request return-path]
   (dispatcher/synchronous-return-path return-path
     (launch-local-background-task! executor request))))

(swap! implementations assoc :local-wrapper
       {:get-state (fn [{:keys [id]} return-path]
                     (dispatcher/respond! return-path (if-let [{:keys [task-state]} (get @local-background-tasks id)]
                                                        {:response (when task-state @task-state)}
                                                        {:error {:type "anvil.server.NotRunningTask" :message "No such task"}})))
        :kill!     (fn [{:keys [id] :as task} return-path]
                     (log/info "Cannot honour request to kill background task " id ": " task)
                     (dispatcher/respond! return-path (if-let [{:keys [thread]} (get @local-background-tasks id)]
                                                        (do
                                                          (when thread
                                                            (.interrupt thread))
                                                          {:response nil})
                                                        {:error {:type "anvil.server.NotRunningTask" :message "No such task"}})))})

(def ^:dynamic *native-bg-task-state* nil)

(defn launch-native-background-task!* [f]
  (when-not rpc-util/*req*
    (throw (Exception. "Tried to launch native BG task without a request")))

  (launch-local-background-task! {:fn (fn [request return-path]
                                        (let [t (worker-pool/spawn-thread! :native-bg-task
                                                  (let [return-path {:respond! #(dispatcher/respond! return-path (assoc % :taskState @(::task-state request)))
                                                                     :update!  #(dispatcher/update! return-path %)}]
                                                    (dispatcher/report-exceptions-to-return-path return-path
                                                      (try
                                                        (rpc-util/with-native-bindings-from-request request return-path
                                                          (binding [*native-bg-task-state* (::task-state rpc-util/*req*)]
                                                            (dispatcher/respond! return-path {:response (f)})))
                                                        (catch InterruptedException _
                                                          (record-final-state! (:session-state request) (::task request) {:taskState @(::task-state request)} :killed))))))]
                                          (swap! local-background-tasks (fn [ts]
                                                                          (if (contains? ts (:id (::task request)))
                                                                            (assoc-in ts [(:id (::task request)) :thread] t)
                                                                            ts)))))}
                                 rpc-util/*req*))

(defmacro launch-native-background-task! [& body]
  `(launch-native-background-task!* (fn [] ~@body)))

(defmacro with-capture-output-into-state [& body]
  `(let [output!# #(swap! *native-bg-task-state* assoc :output %)]
     (binding [*out* (proxy [StringWriter] []
                       (write
                         ([a#] (proxy-super write a#) (output!# (.toString ~'this)))
                         ([a# b# c#] (proxy-super write a# b# c#) (output!# (.toString ~'this)))))
               util/*in-repl?* true]
       ~@body)))

(reset! dispatcher/default-background-wrapper launch-local-background-task!)

(swap! dispatcher/native-live-object-backends merge live-object-backends)
(swap! dispatcher/native-rpc-handlers merge rpc-handlers)