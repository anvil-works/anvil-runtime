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
            [anvil.runtime.app-data :as app-data])
  (:use     [slingshot.slingshot :only [throw+ try+]])
  (:import (anvil.dispatcher.types DateTime)
           (java.util Date)))

;; Background task managers available on this node
;; maps impl-name -> {:get-state, kill!}
(defonce implementations (atom {}))

(defrecord BackgroundTask [app_id id task_name routing completion_status final_state start_time last_seen_alive])

;; Background task management and routing hooks

(defonce do-kill-task! (fn [{:keys [routing app_id id]} return-path]
                         ((get-in @implementations [(keyword routing) :kill!]) app_id id return-path)))

(defonce do-get-task-state (fn [{:keys [routing app_id id]} return-path]
                             ((get-in @implementations [(keyword routing) :get-state]) app_id id return-path)))

(defn clean-finished! [app-id started-before]
  (jdbc/execute! util/db ["DELETE FROM background_tasks WHERE app_id = ? AND completion_status IS NOT NULL AND start_time < to_timestamp(?)" app-id (/ started-before 1000.0)]))

(defonce create-background-task-record
         (fn [app-id impl task-name session-id debug?]
           (when-let [oldest-to-keep ^java.sql.Timestamp (:start_time (last (jdbc/query util/db ["SELECT start_time FROM background_tasks WHERE app_id = ? AND completion_status IS NOT NULL ORDER BY start_time DESC LIMIT 1000" app-id])))]
             (clean-finished! app-id (.getTime oldest-to-keep)))
           (let [new-id (str/lower-case (random/base32 25))]
             (map->BackgroundTask (first (jdbc/query util/db ["INSERT INTO background_tasks (app_id,id,session,routing,task_name,debug,start_time,last_seen_alive) VALUES (?,?,?,?::jsonb,?,?,NOW(),NOW()) RETURNING *"
                                                              app-id new-id session-id (json/write-str (name impl)) task-name debug?]))))))

(def set-background-task-hooks! (util/hook-setter #{do-kill-task! do-get-task-state create-background-task-record}))

(defn get-background-tasks [app-id]
  (map map->BackgroundTask (jdbc/query util/db ["SELECT id,completion_status,task_name,debug,session,start_time,last_seen_alive FROM background_tasks WHERE app_id = ?" app-id])))

(defn get-background-task
  ([app-id id] (get-background-task util/db app-id id))
  ([db-c app-id id]
   (when-let [a (first (jdbc/query db-c ["SELECT * FROM background_tasks WHERE app_id = ? AND id = ?" app-id id]))]
     (map->BackgroundTask a))))

(defn list-background-tasks
  ([app-id all-environments?] (list-background-tasks util/db app-id all-environments?))
  ([db-c app-id all-environments?]
   (let [all-tasks (jdbc/query db-c ["SELECT * FROM background_tasks WHERE app_id = ? ORDER BY start_time" app-id])
         selected-tasks (if all-environments?
                          all-tasks
                          (filter #(= (:debug %) (boolean (:debug? @rpc-util/*session-state*))) all-tasks))]
     (println (:debug? @rpc-util/*session-state*))
     (map map->BackgroundTask selected-tasks))))

(defn present-background-task [bt]
  (-> bt
      (select-keys [:id :completion_status :task_name :debug])
      (assoc :last_seen_alive (.getTime (:last_seen_alive bt)))
      (assoc :start_time (.getTime (:start_time bt)))
      (assoc :session_sha (util/sha-256 (str (:session bt))))))

;; Useful predicate for get-state
(defn is-running? [completion-status _final-state]
  {:response (nil? completion-status)})

(defn get-state
  ([app-id app session-state request-origin task-id return-path]
    (get-state app-id app session-state request-origin task-id return-path vector))
  ([app-id app session-state request-origin task-id return-path render-resp]
   (dispatcher/report-exceptions-to-return-path return-path
     (let [deserialise #(serialiser/deserialise-from-map % app-id app session-state request-origin)]
       (if-let [task (get-background-task app-id task-id)]
         (if (:completion_status task)
           (dispatcher/respond! return-path (render-resp (:completion_status task) (deserialise (:final_state task))))
           ;; We don't know. Go ask the implementation
           (do-get-task-state
             task
             {:update!  #(dispatcher/update! return-path %)
              :respond! (fn [{:keys [error response] :as r}]
                          (dispatcher/report-exceptions-to-return-path return-path
                            (cond
                              (not error)
                              (do
                                (jdbc/execute! util/db ["UPDATE background_tasks SET last_seen_alive=NOW() WHERE app_id=? AND id=?"
                                                        app-id task-id])
                                (dispatcher/respond! return-path (render-resp nil {:state response})))

                              (and error (= (:type error) "anvil.server.NotRunningTask"))
                              (let [bt (util/with-db-transaction [db-c util/db]
                                         (let [bt (get-background-task db-c app-id task-id)]
                                           (if (nil? (:completion_status bt))
                                             (do
                                               (jdbc/execute! db-c ["UPDATE background_tasks SET completion_status='mia'::background_task_status WHERE app_id=? AND id=?"
                                                                    app-id task-id])
                                               (assoc bt :completion_status "mia"))
                                             ;; Something else won this race - leave them to it
                                             bt)))]

                                (dispatcher/respond! return-path (render-resp (:completion_status bt)
                                                                              (deserialise (:final_state bt)))))

                              :else
                              (dispatcher/respond! return-path r))))}))
         ;; Else, no such job
         (dispatcher/respond! return-path {:response ["mia" nil]}))))))

(defn kill! [app-id task-id return-path]
  (let [task (get-background-task app-id task-id)]
    (if (and task (not (:completion_status task)))
      (do-kill-task!
        task
        {:update!  #(dispatcher/update! return-path %)
         :respond! (fn [{:keys [error] :as r}]
                     (cond
                       (not error)
                       (dispatcher/respond! return-path {:response nil})

                       (= (:type error) "anvil.server.NotRunningTask")
                       (do
                         (jdbc/execute! util/db ["UPDATE background_tasks SET completion_status='mia'::background_task_status WHERE app_id=? AND id=? AND completion_status IS NULL" app-id task-id])
                         (dispatcher/respond! return-path {:response nil}))

                       :else
                       (dispatcher/respond! return-path r)))})
      (dispatcher/respond! return-path {:response nil}))))

(defn record-final-state! [app-id task-id {:keys [taskState response error] :as _resp} error?]
  (let [[serialised-state error] (try+
                                   (if error
                                     [(serialiser/serialise-to-map {:state taskState}) error]
                                     [(serialiser/serialise-to-map {:state taskState :response response}) nil])
                                   (catch :anvil/media-serialisation-error e
                                     (log/error e response)
                                     [nil {:message "The state or return value could not be serialised"}])
                                   (catch :anvil/server-error e
                                     [nil {:message (:anvil/server-error e) :type (:type e)}])
                                   (catch Exception e
                                     (log/error e response)
                                     [nil {:message "An unknown serialisation error occurred"}]))

        serialised-state (merge
                           serialised-state
                           (when error {:error error}))]

    (let [{:keys [session debug]} (first (jdbc/query util/db [(str "UPDATE background_tasks SET completion_status = ?::background_task_status, final_state = ?::jsonb"
                                                                   (when (not= error? :mia) ", last_seen_alive=NOW()")
                                                                   " WHERE app_id = ? AND id = ? AND completion_status IS NULL RETURNING session, debug")
                                                              (cond
                                                                (#{:threw :mia :killed} error?) (name error?)
                                                                error? "threw"
                                                                :else "completed")
                                                              serialised-state app-id task-id]))]

      ; The session might already have ended - if this is the error coming in after a kill, for example.
      (when session
        (app-log/record-raw! session app-id "session_ended" {:type "background_task" :state nil} debug)))))



(def rpc-handlers {"anvil.private.background_tasks.launch"    {:fn (fn [{{[task-fn] :args} :call, :keys [origin from-bg-task? app-id session-state], :as request} return-path]
                                                                     (dispatcher/report-exceptions-to-return-path return-path
                                                                       (let [restrict? (app-data/abuse-caution? session-state app-id)]
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
                                                                                                                             (assoc :background? true)
                                                                                                                             (assoc :scheduled? (boolean (:scheduled-task-id request)))
                                                                                                                             (assoc :bg-task-timeout (if restrict?
                                                                                                                                                       30000
                                                                                                                                                       nil)))
                                                                                                                         return-path))]

                                                                           (if-not restrict?
                                                                             (do-dispatch!)
                                                                             ;; Don't let it gobble too many resources. Get all the tasks that might still be running...
                                                                             (let [existing-tasks (get-background-tasks app-id)
                                                                                   potentially-running-tasks (filter #(nil? (:completion_status %)) existing-tasks)
                                                                                   state-responses (atom {})]

                                                                               (if (< (count potentially-running-tasks) 2)
                                                                                 ;; There aren't many, so just go ahead and launch
                                                                                 (do-dispatch!)

                                                                                 ;; We probably have too many tasks running, so check whether they're still alive by swapping their completion statuses into an atom.
                                                                                 (doseq [task potentially-running-tasks]
                                                                                   (get-state app-id rpc-util/*app* rpc-util/*session-state* rpc-util/*request-origin* (:id task)
                                                                                              {:update!  (partial dispatcher/update! return-path)
                                                                                               :respond! (fn [{data :response}]
                                                                                                           (let [updated-state-responses (swap! state-responses assoc (:id task) data)]
                                                                                                             (when (= (count updated-state-responses) (count potentially-running-tasks))
                                                                                                               ;; We have collected completion state from all the possibly-running tasks, now count how many are actually still running.
                                                                                                               (if (< (count (filter identity (vals updated-state-responses))) 2)
                                                                                                                 (do-dispatch!)
                                                                                                                 (dispatcher/respond! return-path {:error {:message "Free users can only run two simultaneous Background Tasks."
                                                                                                                                                           :type    "anvil.server.BackgroundTaskError"}})))))}
                                                                                              is-running?)))))))))}
                   "anvil.private.background_tasks.get_by_id" (rpc-util/wrap-native-fn
                                                                (fn [_kwargs id]
                                                                  (when (= :client rpc-util/*request-origin*)
                                                                    (throw+ {:anvil/server-error "Can't manage background tasks from the client" :type "anvil.server.BackgroundTaskError"}))
                                                                  (if (get-background-task rpc-util/*app-id* id)
                                                                    (dispatcher/mk-BackgroundTaskLiveObject id)
                                                                    (throw+ {:anvil/server-error (str "Background Task not found: " id)
                                                                             :type               "anvil.server.BackgroundTaskNotFound"}))))

                   "anvil.private.background_tasks.list"      (rpc-util/wrap-native-fn
                                                                (fn [{:keys [all_environments] :as _kwargs}]
                                                                  (when (= :client rpc-util/*request-origin*)
                                                                    (throw+ {:anvil/server-error "Can't manage background tasks from the client" :type "anvil.server.BackgroundTaskError"}))
                                                                  (doall
                                                                    (for [bt (list-background-tasks rpc-util/*app-id* all_environments)
                                                                          :let [id (:id bt)]]
                                                                      (dispatcher/mk-BackgroundTaskLiveObject id)))))})

(def live-object-backends {"anvil.private.BackgroundTask" {:fn (fn [{{func :func {:keys [id]} :live-object} :call :keys [app app-id session-state origin] :as _request} return-path]
                                                                 (dispatcher/report-exceptions-to-return-path return-path
                                                                   (let [id (json/read-str id :key-fn keyword)
                                                                         get-state (partial get-state app-id app session-state origin id return-path)]
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
                                                                                                            (if-let [task (get-background-task app-id id)]
                                                                                                              {:response (.substring (:task_name task) 5)}
                                                                                                              {:error "Background Task not found"}))
                                                                       "get_start_time" (dispatcher/respond! return-path
                                                                                                             (if-let [task (get-background-task app-id id)]
                                                                                                               {:response (DateTime. (str (:start_time task)))}
                                                                                                               {:error "Background Task not found"}))
                                                                       "kill" (if (= :client origin)
                                                                                (throw+ {:anvil/server-error "Can't manage background tasks from the client" :type "anvil.server.BackgroundTaskError"})
                                                                                (kill! app-id id return-path))
                                                                       (throw+ {:anvil/server-error (str "Unsupported BackgroundTask method: " func) :type "anvil.server.BackgroundTaskError"})))))}})

;; What follows is the default background-task handler, for backends that do not support background operations


;; A utility function, for use in pypy and local wrapper. It sets up a new background task record,
;; a new session, and a return path pointing to that task. The return value of the function is (optionally) used
;; as the final state.
(defn setup-background-task-context [{:keys [app-id app-origin session-state scheduled-task-id] {func :func} :call :as request} impl cleanup-fn]
  (let [log-ctx (merge {:app-session (atom {:app-origin app-origin
                                            :client {:type :background_task}})}
                       (select-keys request [:app-id :app-version :app-branch]))
        _ (app-log/record! log-ctx :new-session (merge {:type "background-task" :func func}
                                                       (when scheduled-task-id
                                                         {:scheduled_task scheduled-task-id})))
        task (create-background-task-record app-id impl func (:session-id (:app-log @(:app-session log-ctx)))
                                          (boolean (:debug? @session-state)))

        return-path {:update!  (fn [{:keys [output]}]
                                 (when output
                                   (app-log/record! log-ctx "print" [{:t (System/currentTimeMillis) :s output}])))
                     :respond! (fn [{:keys [error] :as resp}]
                                 (record-final-state! app-id (:id task) resp (boolean error))

                                 (when error
                                   (app-log/record! log-ctx "err" error))
                                 (when cleanup-fn
                                   (cleanup-fn task)))}]

    [task return-path]))


;; Special background things
(defonce local-background-tasks (atom {}))

(def respond!)
(defn launch-local-background-task! [executor {:keys [app-id app-origin func] :as request}]
  ;; Launch an background task on a non-async-aware executor, using return value as final state
  (let [[bt return-path] (setup-background-task-context request :local-wrapper #(swap! local-background-tasks dissoc [(:app_id %) (:id %)]))]

    (swap! local-background-tasks assoc [(:app_id bt) (:id bt)] {})              ;; TODO store some useful info

    (try+
      ((:fn executor) (dissoc request :background?) return-path)
      (catch :anvil/server-error e
        (record-final-state! app-id (:id bt) {:error {:message (:anvil/server-error e) :type (:type e)}} true)
        (swap! local-background-tasks dissoc (:id bt)))
      (catch Exception e
        (record-final-state! app-id (:id bt) {:error {:message "Internal error launching task"}} true)
        (swap! local-background-tasks dissoc (:id bt))
        (throw e)))

    (:id bt)))

(swap! implementations assoc :local-wrapper
       {:get-state (fn [app-id id return-path]
                     (dispatcher/respond! return-path (if (contains? @local-background-tasks [app-id id])
                                                        {:response nil}
                                                        (throw+ {:anvil/server-error "No such task" :type "anvil.server.BackgroundTaskNotFound"}))))
        :kill!     (fn [app-id id return-path]
                     (log/info "Cannot honour request to kill background task " id " for app " app-id)
                     (dispatcher/respond! return-path {:response nil}))})

(reset! dispatcher/default-background-wrapper launch-local-background-task!)

(swap! dispatcher/native-live-object-backends merge live-object-backends)
(swap! dispatcher/native-rpc-handlers merge rpc-handlers)