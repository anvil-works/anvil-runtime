(ns anvil.core.server
  (:require [org.httpkit.server :as http-kit]
            [anvil.runtime.conf :as conf]
            [clojure.tools.logging :as log]
            [anvil.util :as util]
            [anvil.metrics :as metrics])
  (:import (java.util.concurrent TimeUnit ThreadPoolExecutor ArrayBlockingQueue)
           (org.httpkit PrefixThreadFactory)))

(clj-logging-config.log4j/set-logger! :level :info)

(def INITIAL-WORKERS 8)
(def SLOW-HANDLER-TIME-MS 500)

(defonce request-queue (ArrayBlockingQueue. 20480))

(defonce worker-pool (let [wait-timers (atom {})
                           execution-timers (atom {})]
                       (proxy [ThreadPoolExecutor] [INITIAL-WORKERS INITIAL-WORKERS 0 TimeUnit/MILLISECONDS request-queue (PrefixThreadFactory. "http-worker-")]
                         (beforeExecute [_thread runnable]
                           ((get @wait-timers runnable))
                           (swap! wait-timers dissoc runnable)
                           (swap! execution-timers assoc runnable (System/nanoTime)))
                         (execute [runnable]
                           (swap! wait-timers assoc runnable (metrics/start-timer :api/http-request-queue-wait-seconds))
                           (try
                             (proxy-super execute runnable)
                             (catch Exception e
                               (swap! wait-timers dissoc runnable)
                               (throw e))))
                         (afterExecute [runnable _throwable]
                           (let [execution-time-nanos (- (System/nanoTime) (get @execution-timers runnable))]
                             (metrics/inc! :api/http-request-execution-seconds-total {} (/ execution-time-nanos 1e9)))
                           (swap! execution-timers dissoc runnable)))))

(defonce largest-pool-size (atom INITIAL-WORKERS))

(defn get-worker-pool-size []
  (.getCorePoolSize worker-pool))

(defn set-worker-pool-size [n]
  (locking worker-pool
    (let [current-size (get-worker-pool-size)]
      (if (> n current-size)
        (do
          (.setMaximumPoolSize worker-pool n)
          (.setCorePoolSize worker-pool n))
        (do
          (.setCorePoolSize worker-pool n)
          (.setMaximumPoolSize worker-pool n)))
      (swap! largest-pool-size max n))))

(defmacro with-expanding-threadpool-when-slow [& body]
  `(let [finished# (promise)
         watcher# (future
                    (Thread/sleep SLOW-HANDLER-TIME-MS)
                    (when-not (realized? finished#)
                      (log/trace "Expanding HTTP worker pool due to long-running task")
                      (locking worker-pool
                        (set-worker-pool-size (inc (get-worker-pool-size))))
                      (try @finished# (catch InterruptedException _#))
                      (log/trace "Shrinking HTTP worker pool after long-running task")
                      (locking worker-pool
                        (set-worker-pool-size (dec (get-worker-pool-size))))))]
     (try
       (do ~@body)
       (finally
         (deliver finished# true)
         (future-cancel watcher#)))))

(defn run-server [ip port handler]
  (http-kit/run-server handler
                       {:ip           ip
                        :port         port
                        :max-ws       conf/max-websocket-payload
                        :max-body     conf/max-http-body
                        :worker-pool  worker-pool
                        :error-logger util/report-uncaught-exception
                        :warn-logger  util/report-uncaught-exception})

  (log/info "HTTP Server running on port" port)

  (future
    (while true
      (metrics/set! :api/http-active-worker-threads-total (.getActiveCount worker-pool))
      (metrics/set! :api/http-max-thread-pool-size-total (.getCorePoolSize worker-pool))
      (metrics/set! :api/http-request-queue-length-total (.size request-queue))
      (Thread/sleep 1000))))