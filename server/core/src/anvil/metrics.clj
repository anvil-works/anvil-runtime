(ns anvil.metrics
  (:require [iapetos.core :as prometheus]
            [iapetos.standalone :as standalone]
            [iapetos.collector.jvm :as jvm]
            [clojure.tools.logging :as log])
  (:import (io.prometheus.client.exemplars ExemplarConfig)))

; Default buckets to use for request and query durations
(def DEFAULT-BUCKETS [0.001 0.002 0.004 0.007 0.010 0.05 0.1 0.2 0.5 1 2 5 10 20 60 120])

(ExemplarConfig/enableExemplars)

;;; PATCH iapetos to produce latest prometheus text format (with support for exemplars)

(ns iapetos.export)
;; These are the original export functions, with the same default behaviour, but now accepting a format arg
(defn write-text-format!
  ([^java.io.Writer w registry] (write-text-format! TextFormat/CONTENT_TYPE_004 w registry))
  ([format ^java.io.Writer w registry]
   (TextFormat/writeFormat
     format
     w
     (.metricFamilySamples ^CollectorRegistry (registry/raw registry)))))
(defn text-format
  ([registry] (text-format TextFormat/CONTENT_TYPE_004))
  ([format registry]
   (with-open [out (java.io.StringWriter.)]
     (write-text-format! format out registry)
     (str out))))

(ns iapetos.collector.ring)
;; This used to hard-code CONTENT_TYPE_004. Not anymore.
(defn metrics-response
  [registry]
  {:status 200
   :headers {"Content-Type" TextFormat/CONTENT_TYPE_OPENMETRICS_100}
   :body    (iapetos.export/text-format TextFormat/CONTENT_TYPE_OPENMETRICS_100 registry)})
(ns anvil.metrics
  (:import (io.opentelemetry.api.trace Span)
           (io.prometheus.client Histogram$Child Histogram$Timer)
           (java.util Map)))

;;; END PATCH

;; Override hookable functions in iapetos

(defprotocol TimeableExemplarCollector
  (start-timer-with-exemplar [this ^Map exemplar]))

(extend-type Histogram$Child
  TimeableExemplarCollector
  (start-timer-with-exemplar [this ^Map exemplar]
    (let [^Histogram$Timer t (.startTimer ^Histogram$Child this)]
      #(.observeDurationWithExemplar t exemplar))))

;; If you update this with a hotfix, you will need to:
;;   - Manually register the new metrics with `(register-metric)`
;;   - Restart the metrics server with `(start-server! 9080)`
(defonce registry (atom (-> (prometheus/collector-registry)
                            (jvm/initialize)
                            (prometheus/register
                              (prometheus/counter :api/http-request-calls-total {:labels #{:method :path :status}})


                              (prometheus/gauge :api/active-worker-threads-total) ;; TODO: Max, avg
                              (prometheus/gauge :api/waiting-worker-threads-total) ;; TODO: Max, avg
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
                              (prometheus/counter :api/jdbc-pool-checkout-wait-time-total {:labels #{:uri :pool}})
                              (prometheus/gauge :api/jdbc-pool-checkouts-max {:labels #{:uri :pool}}) ;; TODO: Remove
                              (prometheus/gauge :api/jdbc-pool-active-connections-total {:labels #{:uri :pool}}) ;; TODO: Max, avg
                              (prometheus/counter :api/jdbc-pool-usage-seconds-total {:labels #{:uri :pool}})

                              (prometheus/gauge :api/runtime-connected-downlinks-total {:labels #{:downlink-type}})
                              (prometheus/gauge :api/runtime-connected-uplinks-total)
                              (prometheus/gauge :api/runtime-connected-clients-total)
                              (prometheus/counter :api/runtime-serve-app-total)
                              (prometheus/counter :api/runtime-serve-api-total)
                              (prometheus/counter :api/runtime-errors-total)
                              (prometheus/histogram :api/runtime-dispatch-duration-seconds {:buckets DEFAULT-BUCKETS
                                                                                            :labels  #{:executor :type :version :native-fn}})

                              (prometheus/counter :api/runtime-session-deref-cache-total)
                              (prometheus/counter :api/runtime-session-deref-update-total)
                              (prometheus/counter :api/runtime-session-deref-select-total)
                              (prometheus/counter :api/runtime-session-swap-total)
                              (prometheus/counter :api/runtime-session-update-total)
                              (prometheus/counter :api/runtime-session-edn-roundtrip-total)

                              (prometheus/counter :api/downlink-builds-started-total)
                              (prometheus/counter :api/downlink-builds-completed-total {:labels #{:succeeded}})
                              (prometheus/counter :api/downlink-calls-started-total)
                              (prometheus/counter :api/downlink-calls-completed-total {:labels #{:succeeded}})
                              (prometheus/counter :api/background-tasks-started-total)
                              (prometheus/counter :api/background-tasks-responded-total {:labels #{:succeeded}})

                              (prometheus/counter :api/downlink-launches-total {:labels #{:downlink-server}})
                              (prometheus/counter :api/downlink-rate-limit-launch-delayed-total {:labels #{:downlink-server}})
                              (prometheus/counter :api/downlink-rate-limit-launch-cancelled-total {:labels #{:downlink-server}})))))

(defonce server (atom nil))

(defn stop-server! []
  (swap! server #(when % (.close %))))

(defn start-server! [port]
  (stop-server!)
  (reset! server (standalone/metrics-server @registry {:port port})))

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

(defn observe!
  ([metric value labels] (observe! metric value labels nil))
  ([metric value labels [trace-id span-id :as exemplar]]
   (try
     (let [collector (iapetos.registry/get @registry metric (or labels {}))]
       (if (and trace-id span-id)
         (.observeWithExemplar collector value ^Map {"trace_id" trace-id "span_id" span-id})
         (.observe collector value)))
     (catch Exception e
       (log/error e "Failed to set metric")))))

(defn start-timer [metric & [labels]]
  (try
    (prometheus/start-timer @registry metric (or labels {}))
    (catch Exception e
      (log/error e "Failed to start metric timer")
      (fn []))))

(defn register-metric [metric]
  (swap! registry prometheus/register metric))

(defn unregister-metric [metric-name]
  (swap! registry prometheus/unregister metric-name))