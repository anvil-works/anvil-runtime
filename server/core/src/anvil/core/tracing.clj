(ns anvil.core.tracing
  (:require [clojure.tools.logging :as log]
            [anvil.util :as util]
            [anvil.runtime.app-log :as app-log])
  (:import (io.opentelemetry.api.trace Span StatusCode)
           (io.opentelemetry.context Context)
           (io.opentelemetry.api GlobalOpenTelemetry)
           (io.opentelemetry.context.propagation TextMapSetter TextMapGetter)
           (io.opentelemetry.api.trace.propagation W3CTraceContextPropagator)))

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
                 (get [_ carrier key] (get carrier (keyword key))))
        propagator (W3CTraceContextPropagator/getInstance)]
    (.extract propagator (Context/root) map getter)))

(defonce on-start-span (fn [tracing-span] nil))

(defn start-span
  "If you use this, you are responsible for closing the returned span!"
  ([span-name attrs] (start-span span-name attrs nil))
  ([span-name attrs parent]
   (let [open-telemetry (GlobalOpenTelemetry/get)
         tracer (.getTracer open-telemetry "anvil.core.tracing")
         span-builder (-> tracer
                          (.spanBuilder span-name))
         span-builder (if parent
                        (-> span-builder
                            (.setParent (cond
                                          (map? parent)
                                          (map->context parent)

                                          (instance? Context parent)
                                          parent

                                          (instance? Span parent)
                                          (-> (Context/root)
                                              (.with parent))

                                          :else
                                          (log/error (str "Invalid parent passed to start-span: " (pr-str parent))))))
                        span-builder)
         span ^Span (-> span-builder
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
  `(try
    (with-start-span [~name ~attrs ~parent]
      (let [span# (Span/current)]
        (try
          ~@body
          (finally
            (end-span! span#)))))))

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

(def set-tracing-hooks! (util/hook-setter [on-start-span]))

;(with-span ["Foo"]
;  (println "Hi from foo")
;  (with-span ["Bar" {:key "value"}]
;    (println "Bar")
;    (set-span-status :ERROR))
;  (with-span ["Baz" {:t 42}]
;    (Thread/sleep 20)
;    (.addEvent (Span/current) "Wake!")
;    (Thread/sleep 20)
;    (set-span-status :OK)
;    (println "Wake!")))
