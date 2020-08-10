(ns anvil.metrics
  (:require [anvil.runtime.conf :as conf]
            [iapetos.core :as prometheus]
            [iapetos.standalone :as standalone]
            [iapetos.collector.jvm :as jvm]
            [clojure.tools.logging :as log]))

; Default buckets to use for request and query durations
(def DEFAULT-BUCKETS [0.001 0.002 0.004 0.007 0.010 0.05 0.1 0.2 0.5 1 2 5 10 20 60 120])

(defonce registry (atom (-> (prometheus/collector-registry)
                            (jvm/initialize)
                            (prometheus/register
                              (prometheus/counter :api/http-request-calls-total {:labels #{:method :path :status}})


                              (prometheus/gauge :api/active-worker-threads-total) ;; TODO: Max, avg
                              (prometheus/gauge :api/max-thread-pool-size-total)
                              (prometheus/gauge :api/task-queue-length-total) ;; TODO: Max, avg
                              (prometheus/histogram :api/task-queue-wait-seconds {:buckets DEFAULT-BUCKETS})
                              (prometheus/histogram :api/task-execution-seconds {:buckets DEFAULT-BUCKETS
                                                                                 :labels  #{:type :name}})

                              (prometheus/histogram :api/jdbc-query-duration-seconds {:buckets DEFAULT-BUCKETS
                                                                                      :labels  #{:query :uri}})

                              (prometheus/counter :api/uncaught-exceptions-total)
                              (prometheus/counter :api/jdbc-query-timeouts)
                              (prometheus/counter :api/jdbc-pool-checkouts-total {:labels #{:uri :pool}})
                              (prometheus/gauge :api/jdbc-pool-checkouts-max {:labels #{:uri :pool}}) ;; TODO: Remove
                              (prometheus/gauge :api/jdbc-pool-active-connections-total {:labels #{:uri :pool}}) ;; TODO: Max, avg
                              (prometheus/counter :api/jdbc-pool-usage-seconds-total {:labels #{:uri :pool}})

                              (prometheus/gauge :api/runtime-active-sessions-total)
                              (prometheus/gauge :api/runtime-connected-downlinks-total)
                              (prometheus/gauge :api/runtime-connected-uplinks-total)
                              (prometheus/counter :api/runtime-serve-app-total)
                              (prometheus/counter :api/runtime-serve-api-total)
                              (prometheus/counter :api/runtime-errors-total)
                              (prometheus/histogram :api/runtime-dispatch-duration-seconds {:buckets DEFAULT-BUCKETS
                                                                                            :labels  #{:executor :type :version :native-fn}})))))

(defn start-server [port]
  (standalone/metrics-server @registry {:port port}))

(defn inc! [metric & [labels amount]]
  (try
    (prometheus/inc @registry metric (or labels {}) (or amount 1.0))
    (catch Exception e
      (log/error e "Failed to increment metric"))))

(defn set! [metric value & [labels]]
  (try
    (prometheus/set @registry metric (or labels {}) value)
    (catch Exception e
      (log/error e "Failed to set metric"))))

(defn observe! [metric value labels]
  (try
    (prometheus/observe @registry metric (or labels {}) value)
    (catch Exception e
      (log/error e "Failed to set metric"))))

(defn start-timer [metric & [labels]]
  (try
    (prometheus/start-timer @registry metric labels)
    (catch Exception e
      (log/error e "Failed to start metric timer")
      (fn []))))

(defn register-metric [metric]
  (swap! registry prometheus/register metric))

