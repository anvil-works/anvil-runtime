(ns anvil.core.worker-pool
  (:require [anvil.metrics :as metrics]
            [clojure.tools.logging :as log]
            [anvil.util :as util]
            [anvil.core.hrr-queue :as hrr-queue])
  (:import (java.util.concurrent ArrayBlockingQueue TimeUnit ThreadPoolExecutor RejectedExecutionException AbstractExecutorService)
           (org.httpkit PrefixThreadFactory)
           (java.util Timer TimerTask)
           (java.time Instant)))

;;(clj-logging-config.log4j/set-logger! :level :trace)

(def INITIAL-WORKERS (* 2 (.availableProcessors (Runtime/getRuntime))))
(def SLOW-HANDLER-TIME-MS 500)
(def MAX-QUEUE-SIZE 20480)

(def ^:private task-info (ThreadLocal.))
(defn set-task-info!
  ([type n] (set-task-info! type n nil))
  ([type n tags]
   (.set task-info {:type (name type), :name (if (keyword? n) (.substring (str n) 1) n), :tags tags})))

(defonce TASK-LOCK (Object.))
(defonce task-queue (atom [nil]))
(defonce n-threads-waiting (atom 0))
(defonce n-threads-running (atom 0))
(defonce max-task-queue (atom {}))
(defonce execution-stats (atom {}))

(defn run-one-task! [timeout]
  (let [[_ [task enqueue-time] tags]
        (locking TASK-LOCK
          (when (nil? (first @task-queue))
            (try
              (swap! n-threads-waiting inc)
              (.wait TASK-LOCK timeout)
              (finally
                (swap! n-threads-waiting dec))))
          (swap! task-queue (fn [[queue]] (hrr-queue/hrr-pop queue))))
        start-time (System/nanoTime)]
    (when task
      (metrics/observe! :api/task-queue-wait-seconds (/ (- start-time enqueue-time) 1e9) nil)
      (.set task-info nil)
      (try
        (swap! n-threads-running inc)
        (.run ^Runnable task)
        (catch Exception e
          (.printStackTrace e))
        (finally
          (swap! n-threads-running dec)
          (let [execution-time-nanos (- (System/nanoTime) start-time)
                task-info (.get task-info)]
            ;; TODO record usage by task
            (swap! task-queue (fn [[queue]] [(hrr-queue/hrr-penalise queue tags execution-time-nanos)]))
            (swap! execution-stats
                   (fn update
                     ([stats] (update stats tags))
                     ([{n ::n-tasks, t ::task-time :as stats} [tag & more-tags :as tags]]
                      (let [stats (assoc stats ::n-tasks (inc (or n 0))
                                               ::task-time (+ (or t 0) (/ execution-time-nanos 1e9)))]
                        (if (not-empty tags)
                          (update-in stats [tag] update more-tags)
                          stats)))))
            (metrics/observe! :api/task-execution-seconds (/ execution-time-nanos 1e9) task-info)))))))

(defn enqueue-one-task! [task tags]
  (when (not= tags [:anvil-http]) (log/trace "Task:" tags))
  (when (> (hrr-queue/hrr-size (first @task-queue)) MAX-QUEUE-SIZE)
    (throw (RejectedExecutionException. "Worker queue overflow")))
  (swap! task-queue (fn [[queue]] [(hrr-queue/hrr-push queue [task (System/nanoTime)] tags)]))
  (try (swap! max-task-queue (fn [current-max] (merge-with hrr-queue/max-size-merger current-max (hrr-queue/to-structure (first @task-queue))))) (catch Exception _ nil))
  (locking TASK-LOCK (.notify TASK-LOCK)))


(defonce thread-pool (atom #{}))
(defonce largest-pool-size (atom INITIAL-WORKERS))
(defonce thread-factory (PrefixThreadFactory. "anvil-worker-"))
(defonce extra-thread-factory (PrefixThreadFactory. "anvil-extra-worker-"))

(defn launch-thread! []
  (let [t (.newThread thread-factory
                      (fn []
                        (while (contains? @thread-pool (Thread/currentThread))
                          (run-one-task! 60000))))]
    (swap! thread-pool conj t)
    (swap! largest-pool-size max (count @thread-pool))
    (.start t)))

(defonce pool-started (dotimes [_ INITIAL-WORKERS] (launch-thread!)))

(defn get-worker-pool-size []
  (count @thread-pool))

(defn set-worker-pool-size [n]
  (swap! thread-pool #(set (take n %)))
  (let [n-to-add (- n (get-worker-pool-size))]
    (when (> n-to-add 0)
      (dotimes [_ n-to-add] (launch-thread!)))))

(defonce ^:private pool-expand-timer (Timer. true))

(defn with-expanding-threadpool-when-slow* [body-fn]
  (let [running (atom true)
        expand-task (util/timer-task "expanding thread pool"
                      (let [t (.newThread extra-thread-factory
                                          #(try
                                             (while @running
                                               (run-one-task! SLOW-HANDLER-TIME-MS))
                                             (finally
                                               (swap! thread-pool disj (Thread/currentThread)))))]
                        (swap! largest-pool-size max (count (swap! thread-pool conj t)))
                        (.start t)))]
    (.schedule pool-expand-timer expand-task (long SLOW-HANDLER-TIME-MS))
    (try
      (body-fn)
      (finally
        (.cancel expand-task)
        (reset! running false)))))

(defmacro with-expanding-threadpool-when-slow [& body]
  `(with-expanding-threadpool-when-slow* (fn [] ~@body)))

(defonce -next-spawn-id (atom 0))

(defn run-task!* [f tags]
  (enqueue-one-task! f tags))

(defonce get-task-tags-for-http-request (fn [r] [:http]))
(defonce get-task-tags-for-dispatch-request (fn [r] [:dispatch]))
(def set-tag-hooks! (util/hook-setter #{get-task-tags-for-http-request get-task-tags-for-dispatch-request}))

(defmacro run-task! [& code]
  (let [info (first code)
        [task-type task-name task-tags :as has-task-info?]
        (cond
          (or (string? info) (keyword? info))
          ["task" info]

          (and (map? info)
               (#{#{:type :name}, #{:type :name :tags}} (set (keys info))))
          [(:type info) (:name info) (:tags info)])]

    `(run-task!* (fn []
                      ~(if has-task-info?
                         `(let [task-type# ~task-type
                                task-name# ~task-name]
                            (util/with-report-uncaught-exceptions (str task-type# ": " task-name#)
                              (set-task-info! task-type# task-name#)
                              ~@code))
                         `(util/with-report-uncaught-exceptions "task"
                            ~@code)))
                 ~task-tags)))

(defmacro spawn-thread! [& code]
  `(doto (Thread. ^Runnable (fn [] ~@code))
     (.setName (str ~(if (or (string? (first code)) (keyword? (first code)))
                       (name (first code))
                       "anvil-spawn")
                    "-" (swap! -next-spawn-id inc)))
     (.setDaemon true)
     (.start)))

(defonce _thread
         (spawn-thread!
           (while true
             (metrics/set! :api/active-worker-threads-total @n-threads-running)
             (metrics/set! :api/max-thread-pool-size-total (get-worker-pool-size))
             (metrics/set! :api/task-queue-length-total (hrr-queue/hrr-size (first @task-queue)))
             (Thread/sleep 1000))))


;; Analysis fuctions

(defn get-max-queues []
  (map (fn [[k v]] [k (:_size v)]) (take 10 (reverse (sort-by (fn [[_ v]] (:_size v)) @max-task-queue)))))

(defonce execution-status-history (atom '()))
(defn- rotate-load-summary! []
  (let [[stats] (swap-vals! execution-stats (constantly {}))]
    (swap! execution-status-history (fn [h]
                                      (cons [(Instant/now) stats] (doall (take 1440 h)))))))

(defonce -rotate-load-summary-thread
         (spawn-thread!
           (while true
             (rotate-load-summary!)
             (Thread/sleep 60000))))

(defn get-top-level-load
  ([] (get-top-level-load @anvil.core.worker-pool/execution-stats))
  ([stats]
   (->>
     (for [[k v] stats :when (map? v)]
       {:key k, :n-tasks (::n-tasks v), :task-time (::task-time v)})
     (sort-by :task-time))))
