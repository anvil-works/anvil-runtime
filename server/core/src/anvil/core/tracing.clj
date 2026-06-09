(ns anvil.core.tracing
  (:require [clojure.tools.logging :as log]
            [anvil.util :as util]
            [anvil.runtime.app-log :as app-log]
            [clojure.pprint :refer [pprint]])
  (:import (io.opentelemetry.api.common Attributes)
           (io.opentelemetry.api.trace Span StatusCode)
           (io.opentelemetry.context Context)
           (io.opentelemetry.api GlobalOpenTelemetry OpenTelemetry)
           (io.opentelemetry.context.propagation TextMapSetter TextMapGetter)
           (io.opentelemetry.api.trace.propagation W3CTraceContextPropagator)
           (java.time Instant)
           (java.time.format DateTimeFormatter)))

(clj-logging-config.log4j/set-logger! :level :info)

(defn get-current-span []
  (Span/current))

(defn merge-span-attrs
  ([attrs] (merge-span-attrs (Span/current) attrs))
  ([^Span span attrs]
   (when span
     (doseq [[k v] attrs
             :let [key-name ^String (name k)]]
       (cond
         (instance? Integer v) (.setAttribute span key-name (long v))
         (keyword? v) (.setAttribute span key-name ^String (name v))
         (string? v) (.setAttribute span key-name ^String v)
         (nil? v) (.setAttribute span key-name nil)
         :else (.setAttribute span key-name v))))))

(defn span->map [span]
  (let [carrier (atom {})
        setter (reify TextMapSetter
                 (set [_ carrier key val] (swap! carrier assoc key val)))
        propagator (W3CTraceContextPropagator/getInstance)]
    (.inject propagator (-> (Context/root)
                            (.with span)) carrier setter)
    @carrier))

(defn map->context [map]
  (let [getter (reify TextMapGetter
                 (keys [_ carrier] (keys carrier))
                 (get [_ carrier key]
                   ;; Sometimes the map has been round-tripped through JSON and keys are keywords.
                   ;; Other times, they remain as strings. Support both!
                   (let [str-val (get carrier key ::not-found)]
                     (if (not= str-val ::not-found)
                       str-val
                       (get carrier (keyword key))))))
        propagator (W3CTraceContextPropagator/getInstance)]
    (.extract propagator (Context/root) map getter)))

(defn mk-attrs [attrs]
  (let [b (Attributes/builder)]
    (doseq [[k v] attrs]
      (.put b (name k) v))
    (.build b)))

(defonce on-start-span (fn [tracing-span] nil))

(defn start-span
  "If you use this, you are responsible for closing the returned span!"
  ([span-name attrs] (start-span span-name attrs nil))
  ([span-name attrs parent] (start-span span-name attrs parent (GlobalOpenTelemetry/get) nil))
  ([span-name attrs parent ^OpenTelemetry open-telemetry start-time]
   (let [tracer (.getTracer open-telemetry "anvil.core.tracing")
         span ^Span (-> tracer
                        (.spanBuilder span-name)
                        (cond->
                          start-time (.setStartTimestamp start-time)
                          parent (.setParent (cond
                                               (map? parent)
                                               (map->context parent)

                                               (instance? Context parent)
                                               parent

                                               (instance? Span parent)
                                               (-> (Context/root)
                                                   (.with parent))

                                               :else
                                               (log/error (str "Invalid parent passed to start-span: " (pr-str parent))))))
                        (.startSpan))]
     (log/trace (str "Started span '" span-name "' (" (.getSpanId (.getSpanContext span)) ") with parent " (pr-str parent)))
     (merge-span-attrs span attrs)
     (on-start-span span)
     span)))

(defn end-span! [span]
  (log/trace (str "Ending span '" (.getName span) "' (" (.getSpanId (.getSpanContext span)) ")"))
  (.end span))

(defn log-trace [span info]
  (log/trace "New trace started:"
             (-> span
               (.getSpanContext)
               (.getTraceId))
             info))

(defn get-trace-id
  ([]
   (get-trace-id (get-current-span)))
  ([span]
   (when span
     (.getTraceId (.getSpanContext span)))))

(defmacro with-parent-span [span & body]
  `(if ~span
     (with-open [_# (.makeCurrent ~span)]
       ~@body)
     (do ~@body)))

;; If you use this, it's your responsibility to call end-span!
(defmacro with-start-span [[name & [attrs parent]] & body]
  `(let [span# (start-span ~name ~attrs ~parent)]
     (with-parent-span span#
       ~@body)))

(defmacro with-span [[name & [attrs parent]] & body]
  `(with-start-span [~name ~attrs ~parent]
     (let [span# (Span/current)]
       (try
         ~@body
         (finally
           (end-span! span#))))))

(defmacro with-recorded-span [[name & args] & body]
  `(with-span [~name ~@args]
     (app-log/record-trace! nil (get-trace-id) ~name)
     ~@body))

(defn set-span-status! [status]
  "Set the status of the current span. :OK or :ERROR"
  (.setStatus (Span/current) (StatusCode/valueOf (name status))))

(defn add-span-event!
  ([event] (add-span-event! (Span/current) event))
  ([span event-name]
   (.addEvent span event-name)))

(defonce get-sdk (fn [service] nil))

(defonce mk-span (fn [] (Span/getInvalid)))

(defn something->instant [thing]
  (cond
    (instance? Instant thing) thing

    (string? thing)
    ; Workaround for <Java12 due to http://bugs.openjdk.org/browse/JDK-8166138
    ; (Instant/parse (:start_time span-data))
    (Instant/from (.parse DateTimeFormatter/ISO_OFFSET_DATE_TIME thing))

    (number? thing)
    (Instant/ofEpochMilli thing)))

(defn ingest-spans! [data service-name]
  (log/trace (str "Ingesting spans for service '" service-name "': " (with-out-str (pprint data))))
  (try
    (doseq [data (:spans data)]
      (mk-span data))
    (catch Throwable e
      (log/error e (str "Could not ingest trace data for service '" service-name "': " (pr-str data))))))


(def set-tracing-hooks! (util/hook-setter [on-start-span get-sdk mk-span]))

#_(with-span ["Foo"]
  (println "Hi from foo")
  (with-span ["Bar" {:key "value"}]
    (println "Bar")
    ;(set-span-status :ERROR)
    )
  (with-span ["Baz" {:t 42}]
    (Thread/sleep 20)
    (.addEvent (Span/current) "Wake!")
    (Thread/sleep 20)
    ;(set-span-status :OK)
    (println "Wake!")))
