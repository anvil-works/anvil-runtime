(ns anvil.runtime.tables.v2.jdbc-trace
  (:require [anvil.core.tracing :as tracing]
            [anvil.util :as util]
            [clojure.java.jdbc :as jdbc]
            [clojure.string :as string]
            [clojure.tools.logging :as log])
  (:import (io.opentelemetry.api.trace Span)
           (org.apache.commons.codec.binary Base64)))

(clj-logging-config.log4j/set-logger! :level :trace)

(defonce THRESHOLD 1000)
(defonce SAMPLE_PERCENT 0)

(defn- ellipsise [[query & params]]
  (let [query (str query)]
    (if (> (.length query) 30)
      (str (.substring query 27) "...")
      query)))

(defn log-slow-queries [func db query-and-args]
  (tracing/with-span [(str "Query " (ellipsise query-and-args)) {:internal true}]
    (let [start-time (System/currentTimeMillis)]
      (try
        (func db query-and-args)
        (finally
          (let [time-taken (- (System/currentTimeMillis) start-time)]
            (when (and (> time-taken THRESHOLD) (< (* 100 (Math/random)) SAMPLE_PERCENT))
              (let [tracing-span-ctx (.getSpanContext (Span/current))
                    trace-id (when (.isValid tracing-span-ctx) (.getTraceId tracing-span-ctx))
                    query-str (try
                                (util/write-json-str query-and-args)
                                (catch Exception e
                                  (str "Query could not be stringified: " (pr-str query-and-args))))]
                (log/trace (str "SLOW QUERY " time-taken "ms" (when trace-id (str " (TRACE " trace-id ")")) ":" query-str))))))))))

(defn query [db query]
  (log-slow-queries jdbc/query db query))

(defn execute! [db query]
  (log-slow-queries jdbc/execute! db query))


(defn- unpack-query-and-args [query-and-args]
  (if (string? query-and-args)
    (if-let [[_ json-from-log-msg] (re-matches #"(?s)\[TRACE anvil.runtime.tables.v2.jdbc-trace\].*?:(.*)" query-and-args)]
      (util/read-json-str json-from-log-msg)
      (util/read-json-str query-and-args))
    query-and-args))

(defn attempt-to-reconstruct-query [query-and-args]
  "Given a logged query from (log-slow-queries), turn it into something we can EXPLAIN ANALYZE."
  (let [[query & args] (unpack-query-and-args query-and-args)
        args-atom (atom args)
        extra-args (atom [])
        escape-as-string (fn [^String s]
                           ;; SQL escaping is, in general, not safe, and this is untrusted data
                           ;; from someone who might be reading this code. No half measures.
                           (if (re-matches #"[a-zA-Z0-9_\+= \{\}\[\]\"\.:,/\-]*" s)
                             (str "'" s "'")
                             (let [b64enc (Base64/encodeBase64String (.getBytes s))]
                               (str "convert_from(decode('" b64enc "', 'base64'), 'UTF-8')"))))]
    (println (string/replace query #"\?"
                             (fn [_]
                               (let [[[arg & more] _] (swap-vals! args-atom rest)]
                                 (cond
                                   (number? arg) (str arg)
                                   (nil? arg) "NULL"
                                   (string? arg) (escape-as-string arg)
                                   (map? arg) (str "(" (escape-as-string (util/write-json-str arg)) "::JSONB)")
                                   :else
                                   (do
                                     (swap! extra-args)))))))))

(defn visualise-query [query-and-args]
  (let [[query & args] (unpack-query-and-args query-and-args)
        args-atom (atom args)]
    (println
      (string/replace query #"\?"
                      (fn [_]
                        (let [[[arg & more] _] (swap-vals! args-atom rest)]
                          (str "--" (pr-str arg) "--")))))))
