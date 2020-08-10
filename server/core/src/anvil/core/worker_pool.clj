(ns anvil.core.worker-pool
  (:require [anvil.metrics :as metrics]
            [clojure.tools.logging :as log]
            [anvil.util :as util])
  (:import (java.util.concurrent ArrayBlockingQueue TimeUnit ThreadPoolExecutor)
           (org.httpkit PrefixThreadFactory)
           (java.util Timer TimerTask)))

(def INITIAL-WORKERS (* 2 (.availableProcessors (Runtime/getRuntime))))
(def SLOW-HANDLER-TIME-MS 500)

(defonce request-queue (ArrayBlockingQueue. 20480))

;; TODO worker-duration-seconds with a binding for saying what you were up to

(def ^:private task-info (ThreadLocal.))
(defn set-task-info! [type n]
  (.set task-info {:type (name type), :name (if (keyword? n) (.substring (str n) 1) n)}))

(defonce pool
         (let [execution-start-time (ThreadLocal.)]
           (proxy [ThreadPoolExecutor] [INITIAL-WORKERS INITIAL-WORKERS 0 TimeUnit/MILLISECONDS request-queue (PrefixThreadFactory. "anvil-worker-")]
             (execute [runnable]
               (let [stop-wait-timer! (metrics/start-timer :api/task-queue-wait-seconds)]
                 (try
                   (proxy-super execute (fn []
                                          (stop-wait-timer!)
                                          (.run runnable)))
                   (catch Exception e
                     (stop-wait-timer!)
                     (throw e)))))

             (beforeExecute [_thread runnable]
               (.set execution-start-time (System/nanoTime))
               (.set task-info nil))

             (afterExecute [runnable _throwable]
               (let [execution-time-nanos (- (System/nanoTime) (.get execution-start-time))
                     task-info (.get task-info)]
                 (metrics/observe! :api/task-execution-seconds (/ execution-time-nanos 1e9) task-info))))))

; We are not replacing the default Clojure thread pool, so calls to (future ...) don't use the one above
; (set! (. clojure.lang.Agent soloExecutor) pool)

(defonce largest-pool-size (atom INITIAL-WORKERS))

(defn get-worker-pool-size []
  (.getCorePoolSize pool))

(defn set-worker-pool-size [n]
  (locking pool
    (let [current-size (get-worker-pool-size)]
      (if (> n current-size)
        (do
          (.setMaximumPoolSize pool n)
          (.setCorePoolSize pool n))
        (do
          (.setCorePoolSize pool n)
          (.setMaximumPoolSize pool n)))
      (swap! largest-pool-size max n))))

(defonce ^:private pool-expand-timer (Timer. true))

(defn with-expanding-threadpool-when-slow* [body-fn]
  (let [status (atom :running)                              ;; :running -> :expanded -> :shrunk OR :running -> :finished
        expand-task (util/timer-task "expanding thread pool"
                      (log/trace "Checking worker status")
                      (when (= (swap! status #(if (= % :running) :expanded %))
                               :expanded)
                        (log/trace "Expanding worker pool due to long-running task")
                        (locking pool
                          (set-worker-pool-size (inc (get-worker-pool-size))))))]
    (.schedule pool-expand-timer expand-task (long SLOW-HANDLER-TIME-MS))
    (try
      (body-fn)
      (finally
        (.cancel expand-task)
        (when (= (swap! status #(if (= % :expanded) :shrunk :finished))
                 :shrunk)
          (log/trace "Shrinking worker pool after long-running task")
          (locking pool
            (set-worker-pool-size (dec (get-worker-pool-size)))))))))

(defmacro with-expanding-threadpool-when-slow [& body]
  `(with-expanding-threadpool-when-slow* (fn [] ~@body)))

(defonce -next-spawn-id (atom 0))

(defn run-task!* [f]
  (.execute pool f))

(defmacro run-task! [& code]
  (let [info (first code)
        [task-type task-name :as has-task-info?]
        (cond
          (or (string? info) (keyword? info))
          ["task" info]

          (and (map? info)
               (= (set (keys info)) #{:type :name}))
          [(:type info) (:name info)])]

    `(run-task!* (fn []
                      ~(if has-task-info?
                         `(let [task-type# ~task-type
                                task-name# ~task-name]
                            (util/with-report-uncaught-exceptions (str task-type# ": " task-name#)
                              (set-task-info! task-type# task-name#)
                              ~@code))
                         `(util/with-report-uncaught-exceptions "task"
                            ~@code))))))

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
             (metrics/set! :api/active-worker-threads-total (.getActiveCount pool))
             (metrics/set! :api/max-thread-pool-size-total (.getCorePoolSize pool))
             (metrics/set! :api/task-queue-length-total (.size request-queue))
             (Thread/sleep 1000))))

(future)