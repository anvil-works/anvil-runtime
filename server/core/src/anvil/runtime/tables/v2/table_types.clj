(ns anvil.runtime.tables.v2.table-types
  (:require [slingshot.slingshot :refer :all]
            [anvil.dispatcher.types :as types]
            [clojure.tools.logging :as log]
            [anvil.util :as util]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util])
  (:import (anvil.dispatcher.types Date DateTime MediaDescriptor Media ChunkedStream BlobMedia SerialisableForRpc SerializedPythonObject)
           (java.time.format DateTimeFormatter DateTimeFormatterBuilder)
           (java.time.temporal ChronoField)
           (java.time ZoneId OffsetDateTime ZoneOffset)))

(clj-logging-config.log4j/set-logger! :level :trace)

;; Table type handling

(defn- is-jsonable? [x]
  (cond
    (instance? SerialisableForRpc x) false
    (string? x) true
    (number? x) true
    (nil? x) true
    (contains? #{true false} x) true
    (or (vector? x) (list? x)) (every? is-jsonable? x)
    (map? x) (every? (fn [[k v]] (and (or (string? k) (keyword? k))
                                      (is-jsonable? v)))
                     x)
    :else false))

(defn is-datelike? [x]
  (or (instance? Date x)
      (instance? DateTime x)))

(defn get-type-from-value [json-value]
  (cond
    (string? json-value) {:type "string"}

    (number? json-value) (cond
                           (or (= Double/POSITIVE_INFINITY json-value)
                               (= Double/NEGATIVE_INFINITY json-value))
                           {:error "Cannot store Infinity value in a data table"}

                           (Double/isNaN (double json-value))
                           {:error "Cannot store NaN in a data table"}

                           :else
                           {:type "number"})

    (contains? #{true false} json-value) {:type "bool"}

    (nil? json-value) {:type "unresolved"}

    (and (instance? SerializedPythonObject json-value)
         (= (:type json-value) "anvil.tables.v2._RowRef")
         (try
           (types/unwrap-capability (:value json-value) ["_" "t" :ANY {:r :ANY}])
           (catch Exception e
             false)))
    (let [[_ _ {table-id :id} {row-id :r}] (:scope (:value json-value))]
      {:type "link_single", :table_id table-id})

    (instance? Date json-value) {:type "date"}

    (instance? DateTime json-value) {:type "datetime"}

    (instance? MediaDescriptor json-value) {:type "media"}

    (sequential? json-value)
    (if-let [first-val (first json-value)]
      (let [first-type (get-type-from-value first-val)]
        (if (:error first-type)
          first-type
          (if (:table_id first-type)
            (if (every? #(= first-type (get-type-from-value %)) (rest json-value))
              (assoc first-type :type "link_multiple")
              {:error "All elements of a table-row list must be rows from the same table"})
            (if (is-jsonable? json-value)
              {:type "simpleObject"}
              {:error "The only lists you can store in a data table are lists of simple objects or lists of table rows",
               ::unknown-type? true}))))
      {:type "unresolvedArray"})

    (is-jsonable? json-value) {:type "simpleObject"}

    :else {:error "You can only store strings, numbers, dates, references to other table rows, or simple objects in a table",
           ::unknown-type? true}))

(defn get-type-from-db-column [{:keys [type backend table_id] :as col}]
  (if (and backend (not= "anvil.tables.Row" backend))
    {:type "unknown"}
    (condp = type
      "liveObject" {:type "link_single" :table_id table_id}
      "liveObjectArray" {:type "link_multiple" :table_id table_id}
      {:type type})))

(defn make-db-column-from-type [{:keys [type table_id]}]
  (condp = type
    "link_single" {:type "liveObject" :backend "anvil.tables.Row" :table_id table_id}
    "link_multiple" {:type "liveObjectArray" :backend "anvil.tables.Row" :table_id table_id}
    {:type type}))

(defn get-type-name [tables {:keys [type table_id] :as type-map}]
  (condp = type
    "link_single" (str "Row from '" (get-in tables [table_id :name]) "' table")
    "link_multiple" (str "List of rows from '" (get-in tables [table_id :name]) "' table")
    "unresolved" "Unresolved (None)"
    "unresolvedArray" "Unresolved (empty list)"
    type))

(defn is-type? [json-value type-map]
  (or (nil? json-value)

      (and (#{"unresolvedArray" "link_multiple" "simpleObject"} (:type type-map))
           (= json-value []))

      (and (= (:type type-map) "simpleObject")
           (is-jsonable? json-value))

      (= type-map (get-type-from-value json-value))))


(defn type-error? [tables col-type col-name json-value]
  (when-not (is-type? json-value col-type)
    (str "Column '" col-name "' is a " (get-type-name tables col-type) " - "
         (let [val-type (get-type-from-value json-value)]
           (log/error (str "Column type mismatch: " (pr-str col-type) " vs " (pr-str val-type)))
           (or (:error val-type)
               (str "cannot set it to a " (get-type-name tables val-type)))))))


(def datetime-reduce-formatter (-> (DateTimeFormatterBuilder.)
                                   (.append DateTimeFormatter/ISO_LOCAL_DATE)
                                   (.appendLiteral " ")
                                   (.appendValue ChronoField/HOUR_OF_DAY 2)
                                   (.appendLiteral ":")
                                   (.appendValue ChronoField/MINUTE_OF_HOUR 2)
                                   (.appendLiteral ":")
                                   (.appendValue ChronoField/SECOND_OF_MINUTE 2)
                                   (.appendFraction ChronoField/MICRO_OF_SECOND 0 9 true)
                                   (.appendOffset "+HHMM" "+0000")
                                   (.toFormatter)
                                   (.withZone (ZoneId/of "UTC"))))

(def datetime-reinflate-parser (-> (DateTimeFormatterBuilder.)
                                   (.append DateTimeFormatter/ISO_LOCAL_DATE)
                                   (.appendLiteral "A")
                                   (.appendValue ChronoField/HOUR_OF_DAY 2)
                                   (.appendLiteral ":")
                                   (.appendValue ChronoField/MINUTE_OF_HOUR 2)
                                   (.appendLiteral ":")
                                   (.appendValue ChronoField/SECOND_OF_MINUTE 2)
                                   (.appendFraction ChronoField/MICRO_OF_SECOND 0 9 true)
                                   (.appendOffset "+HHMM" "+0000")
                                   (.toFormatter)
                                   (.withZone (ZoneId/of "UTC"))))

(defn reduce-datetime [val]
  (when-let [val (:datetime-string val)]
    (let [instant (.toInstant (OffsetDateTime/parse val datetime-reduce-formatter))
          offset (.substring val (- (count val) 5))]
      (-> (DateTimeFormatter/ofPattern (str "yyyy-MM-dd'A'HH:mm:ss.SSSSSS'" offset "'"))
          (.withZone (ZoneOffset/UTC))
          (.format instant)))))

(defn reinflate-anvil-datetime [val]
  (when val
    (DateTime.
      (let [offset-pos (- (count val) 5)
            swapped-offset (str (.substring val 0 offset-pos)
                                (if (= (get val offset-pos) \+) "-" "+")
                                (.substring val (+ offset-pos 1)))
            instant (.toInstant (OffsetDateTime/parse swapped-offset datetime-reinflate-parser))]
        (-> (DateTimeFormatter/ofPattern (str "yyyy-MM-dd HH:mm:ss.SSSSSS'" (.substring val offset-pos) "'"))
            (.withZone (ZoneOffset/UTC))
            (.format instant))))))

(defn reduce-val [{:keys [type] :as type-map} val]
  (if (nil? val)
    nil
    (condp = type
      "link_single" (let [[_ _ {:keys [id]} {row-id :r}] (types/unwrap-capability (:value val) ["_" "t" :ANY {:r :ANY}])]
                      (when-not (and id row-id)
                        ;; Something has gone VERY wrong if we get here, but this is a security boundary so
                        ;; it doesn't hurt to double check
                        (log/error "THIS SHOULD NEVER BE ALLOWED TO HAPPEN: Invalid capability for link target:" type-map ":" (:value val))
                        (throw (Exception. "Invalid capability for link target")))

                      (assert (and (instance? SerializedPythonObject val)
                                   (= (:type val) "anvil.tables.v2._RowRef")
                                   (= id (:table_id type-map))))
                      {:id (util/write-json-str [(:table_id type-map) row-id]), :backend "anvil.tables.Row"})
      "link_multiple" (map (partial reduce-val (assoc type-map :type "link_single")) val)
      "string" (str val)
      "number" (do (assert (number? val)) val)
      "bool" (boolean val)
      "date" (:date-string val)
      "datetime" (reduce-datetime val)
      "media" nil
      "simpleObject" (do (assert (is-jsonable? val)) val)
      "unresolved" nil
      "unresolvedArray" [])))


(defn- get-linked-row-id [link-json]
  (when link-json
    (-> link-json :id util/read-json-str second)))

(defn render-column-value [tables table-id col-name value]
  (let [{:keys [id name type table_id] :as col} (get-in tables [table-id :columns col-name])]
    (condp = type
      "link_single" (get-linked-row-id value)
      "link_multiple" (map get-linked-row-id value)
      "media" (let [{:keys [content_type name object_id]} value]
                (lazy-media/mk-LazyMedia-with-correct-mac
                  {:manager "table-media", :id (str object_id), :mime-type content_type, :name name}
                  ;; LazyMedia needs a request for all sorts of reasons, but table RPC functions are sometimes called
                  ;; without one (from a Users Service password reset, for example). In that case, Lazy Media won't
                  ;; work, but pass a fake request object so that at least it doesn't explode
                  (or rpc-util/*req* {:session-state (atom {})})))
      "date" (Date. value)
      "datetime" (reinflate-anvil-datetime value)
      value)))

(defn resolve-type [{type1 :type :as typemap-1} {type2 :type :as typemap-2}]
  (cond
    (= type1 type2) typemap-1
    (= type1 "unresolved") typemap-2
    (= type2 "unresolved") typemap-1
    (= type1 "unresolvedArray") (if (#{"simpleObject" "link_multiple"} type2)
                                  typemap-2
                                  :error)
    (= type2 "unresolvedArray") (if (#{"simpleObject" "link_multiple"} type1)
                                  typemap-1
                                  :error)
    :else :error))
