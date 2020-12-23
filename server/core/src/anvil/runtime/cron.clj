(ns anvil.runtime.cron
  (:import java.util.Date
           (java.util Calendar TimeZone))
  (:require [anvil.util :as util]
            [clojure.java.jdbc :as jdbc]
            [anvil.runtime.app-data :as app-data]
            [anvil.dispatcher.background-tasks :as background-tasks]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.core :as dispatcher]
            [clojure.data.json :as json]))

(defn get-cal-utc []
  (doto (Calendar/getInstance (TimeZone/getTimeZone "UTC"))
    (.setFirstDayOfWeek Calendar/SUNDAY)))

(defn get-next-execution-time [^Date last-execution run-spec]
  (let [last-exec (doto (get-cal-utc) (.setTime (or last-execution (Date.))))
        set-or-spec (fn [^Calendar cal, ^Number field, spec, default-val]
                      (.set cal field (or ^Number (when spec (get-in run-spec [:at spec]))
                                          (when last-execution (.get cal field))
                                          default-val
                                          (.get cal field))))
        periods {"minute" Calendar/MINUTE
                 "hour" Calendar/HOUR
                 "day" Calendar/DAY_OF_MONTH
                 "week" Calendar/WEEK_OF_YEAR
                 "month" Calendar/MONTH}

        next-exec (condp = (:every run-spec)
                    "minute" last-exec
                    "hour" (doto last-exec
                             (set-or-spec Calendar/MINUTE :minute nil))
                    "day" (doto last-exec
                            (set-or-spec Calendar/HOUR_OF_DAY :hour nil)
                            (set-or-spec Calendar/MINUTE :minute (rand-int 30))
                            (set-or-spec Calendar/SECOND nil (rand-int 60)))
                    "week" (doto last-exec
                             (set-or-spec Calendar/HOUR_OF_DAY :hour nil)
                             (set-or-spec Calendar/MINUTE :minute (rand-int 30))
                             (set-or-spec Calendar/SECOND nil (rand-int 60))
                             (set-or-spec Calendar/DAY_OF_WEEK :day nil))
                    "month" (doto last-exec
                              (set-or-spec Calendar/HOUR_OF_DAY :hour nil)
                              (set-or-spec Calendar/MINUTE :minute (rand-int 30))
                              (set-or-spec Calendar/SECOND nil (rand-int 60))
                              (set-or-spec Calendar/DAY_OF_MONTH :day 1))
                    nil)

        next-exec (if (and next-exec
                           (.before next-exec (get-cal-utc)))
                    (doto next-exec
                      (.add (get periods (:every run-spec)) (or (:n run-spec) 1)))
                    next-exec)]

    (when next-exec
      (java.sql.Timestamp. (max (.getTimeInMillis next-exec) (System/currentTimeMillis))))))

(defn get-cron-job-info [app-id job-id]
  (when-let [info (first (jdbc/query util/db ["SELECT next_run, last_bg_task_id, id, completion_status, background_tasks.task_name as task_name, debug, session, start_time, last_seen_alive FROM scheduled_tasks LEFT JOIN background_tasks ON (last_bg_task_id = id) WHERE scheduled_tasks.app_id = ? AND job_id = ?" app-id job-id]))]
    (merge
      (when (:last_bg_task_id info)
        (background-tasks/present-background-task info))
      (select-keys info [:next_run]))))

;; Common code for updating jobs from DB records
(defn get-scheduled-jobs [scheduled-tasks-yaml previous-scheduled-jobs extra-keys]
  (let [known-jobs (into {} (for [job previous-scheduled-jobs] [(:job_id job) job]))]
    (for [{:keys [job_id task_name time_spec] :as task} scheduled-tasks-yaml
          :let [{:keys [next_run last_bg_task_id] :as cached-task} (get known-jobs job_id)
                next-run (if (= time_spec (:time_spec cached-task))
                           next_run                           ; Time-spec for this task hasn't changed, don't modify next-run.
                           (get-next-execution-time nil time_spec))]
          :when (and task_name next-run)]
      (merge (select-keys task [:job_id :task_name :time_spec])
             {:next_run next-run, :last_bg_task_id last_bg_task_id}
             extra-keys))))

(defn get-next-execution-time-logging-errors [last-execution time-spec job]
  (try
    (get-next-execution-time last-execution time-spec)
    (catch Exception e
      (log/error "Error computing execution time for job" (pr-str (:job_id job)) ", for app" (:app_id job))
      nil)))

(defonce update-job!
         (fn [db job updates]
           (jdbc/update! db "scheduled_tasks" updates ["job_id = ?" (:job_id job)])))

(defonce get-environment-for-job
         (fn [job] (throw (UnsupportedOperationException.))))

(def set-cron-hooks! (util/hook-setter #{update-job! get-environment-for-job}))

(defn launch-cron-jobs! []
  (let [jobs-we-have-committed-to-launching
        (util/with-db-transaction [db util/db]
          (let [jobs (jdbc/query db ["SELECT * FROM scheduled_tasks WHERE next_run < NOW() ORDER BY random() LIMIT 10"])
                now (Date.)]
            (doall
              (for [job jobs
                    :let [next-run (get-next-execution-time-logging-errors (:next_run job) (:time_spec job) job)
                          next-run (when next-run
                                     (if (.before next-run now)
                                       (get-next-execution-time-logging-errors nil (:time_spec job) job)
                                       next-run))
                          locked? (util/app-locked? (:app_id job))]
                    :when (and next-run
                               (not locked?))]
                (do
                  (update-job! db job {:next_run next-run})
                  job)))))]

    (doseq [{:keys [job_id task_name last_bg_task_id] :as job} jobs-we-have-committed-to-launching]
      (let [{:keys [app_id] :as environment} (get-environment-for-job job)]
       (when-not (app-data/abuse-caution? nil app_id)
         (let [launch! (fn []
                         (dispatcher/dispatch!
                           {:call              {:func   "anvil.private.background_tasks.launch"
                                                :args   [task_name]
                                                :kwargs {}}
                            :scheduled-task-id job_id
                            :app-id            app_id
                            :environment       environment
                            :session-state     (atom {:app-id app_id, :environment environment})
                            :origin            :server}
                           ;; Return path
                           {:update!  (constantly nil)
                            :respond! (fn [{:keys [error response]}]
                                        (if error
                                          ;; TODO log this somewhere the app can see it
                                          (log/error "Failed to launch BG task for" job_id "for app" app_id ":" error)
                                          (update-job! util/db job {:last_bg_task_id (json/read-str (:id response))})))}))]
           (if (nil? last_bg_task_id)
             (launch!)
             (background-tasks/get-state (background-tasks/load-background-task-by-id util/db last_bg_task_id)
                                         {:app-id app_id, :environment environment, :session-state (atom {}), :origin :server}
                                         {:update!  (constantly nil)
                                          :respond! (fn [{:keys [error response] :as r}]
                                                      (cond
                                                        error
                                                        (log/error "Failed to retrieve last BG task:" error)

                                                        response
                                                        (log/info "Not running BG task " job_id "for app" app_id "because background task" last_bg_task_id "is still running")

                                                        :else
                                                        (launch!)))}
                                         background-tasks/is-running?))))))
    (not-empty jobs-we-have-committed-to-launching)))
