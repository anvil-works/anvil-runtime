(ns anvil.runtime.tables.v2.search
  (:require [anvil.runtime.tables.v2.jdbc-trace :as jdbc-t]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [clj-commons.slingshot :refer :all]
            [anvil.runtime.tables.v2.util :as util-v2]
            [anvil.runtime.tables.v2.basic-ops :as basic-ops]
            [anvil.runtime.tables.v2.query :as query]
            [clojure.pprint :as pprint]
            [anvil.runtime.tables.split.sql :as split-sql])
  (:import (anvil.dispatcher.types SerializedPythonObject)))

(clj-logging-config.log4j/set-logger! :level :trace)

;; The search process:
;; 1. Parse args + kwargs into query objects, checking against column restrictions
;; 2. Combine query with view -> actual query
;; THEN do the "get a page" thing:
;; 3. Generate WHERE clause
;; 4. Generate SELECT clause
;; 5. Generate JOINs
;;
;; 1-3 happen in the 'query' namespace. The rest happen here:

;; 4. Generate SELECT clause

(defn PRIMARY-QUERY [tables table-id fetch-spec query order-by chunk-size cursor]
  (let [order-by-with-ids (for [{:keys [column_name ascending]} order-by]
                            {:col-id (get-in tables [table-id :columns column_name :id])
                             :desc   (not ascending)})
        {:keys [storage] :as table-record} (get-in tables [table-id :table-record])
        [SELECT-EXPR select-params] (basic-ops/SELECT-COLUMNS tables fetch-spec 0)
        [WHERE-EXPR where-params] (query/QUERY->SQL table-record query)
        [CURSOR-EXPR cursor-params] (query/CURSOR->SQL table-record order-by-with-ids cursor)
        [ORDER-BY-EXPR order-by-params] (query/ORDER-BY-SQL table-record order-by-with-ids)
        ID-COL (if (:split storage) "_id" "id")
        TABLE-NAME (if (:split storage) (split-sql/TABLE-NAME table-record) "app_storage_data")
        [TABLE-ID-SQL table-id-args] (if (:split storage)
                                       ["TRUE" []]
                                       ["table_id = ?" [table-id]])]
    ;(log/trace "CURSOR" cursor)
    ;(log/trace "CURSOR EXPR" CURSOR-EXPR cursor-params)
    [(str "SELECT " ID-COL " AS id, " SELECT-EXPR " AS rdata, 0 AS fid, ROW_NUMBER() OVER (ORDER BY " ORDER-BY-EXPR ") AS primary_order FROM " TABLE-NAME
          " WHERE " TABLE-ID-SQL " AND " WHERE-EXPR
          (when cursor (str " AND " CURSOR-EXPR))
          " ORDER BY " ORDER-BY-EXPR " LIMIT " (int chunk-size))
     (concat select-params order-by-params table-id-args where-params cursor-params order-by-params)]))

(defn COUNT-QUERY [tables table-id query]
  (let [{:keys [storage] :as table-record} (get-in tables [table-id :table-record])
        [WHERE-EXPR where-params] (query/QUERY->SQL table-record query)]
    (if (:split storage)
      [(str "SELECT COUNT(*) AS n FROM " (split-sql/TABLE-NAME table-record) " WHERE " WHERE-EXPR)
       where-params]
      [(str "SELECT COUNT(*) AS n FROM app_storage_data WHERE table_id = ? AND " WHERE-EXPR)
       (concat [table-id] where-params)])))


(defn- assert-order-by [tables table-id cols column_name]
  (when-not (if cols (some #{column_name} cols) (get-in tables [table-id :columns column_name]))
    (throw+ (util-v2/general-tables-error (str "Cannot sort by nonexistent column \"" column_name "\"")))))

(defn- build-search-option [tables table-id cols options query-args arg]
  (when (instance? SerializedPythonObject arg)
    (condp = (:type arg)
      "anvil.tables.fetch_only" (assoc options :fetch-request (:spec (:value arg)))
      "anvil.tables.query.page_size" (if (and (number? (:rows (:value arg))) (pos? (:rows (:value arg))))
                                       (assoc options :chunk-size (:rows (:value arg)))
                                       (throw+ (util-v2/general-tables-error (str "Page size must be a positive number."))))
      "anvil.tables.order_by" (let [{:keys [column_name]} (:value arg)]
                                (assert-order-by tables table-id cols column_name)
                                (update options :order-by (fnil conj []) (:value arg)))
      nil)))

(defn get-search-options [tables {table-id :id :keys [cols] :as view-spec} search-args]
  (reduce (fn [[options query-args] arg]
            (if-let [new-options (build-search-option tables table-id cols options query-args arg)]
              [new-options query-args]
              [options (conj query-args arg)]))
          [{} []] search-args))

;; because if order-by cols are not included, our cursor approach falls apart
(defn include-order-by-cols [requesting-cols order-by]
  (if (map? requesting-cols)
    (reduce (fn [requesting-cols {col-name :column_name}]
              (if (not (contains? requesting-cols col-name))
                (assoc requesting-cols col-name true)
                requesting-cols))
            requesting-cols
            order-by)
    requesting-cols))

(defn result-row->cursor [table last-primary-row order-by]
  ;; Produce a cursor that can be ingested by query/CURSOR->SQL
  (let [{:keys [rdata id]} last-primary-row
        {:keys [storage columns]} table]

    (if (:split storage)
      (concat
        (for [{:keys [column_name]} order-by
              :let [col (get columns column_name)]]
          (table-types/reduce-val-for-query storage col
                                            (util-v2/render-transmitted-value table id rdata col)))
        [id])
      (concat
        (for [{:keys [column_name]} order-by]
          (get rdata (keyword column_name)))
        [id]))))

(defn get-page [tables db-c {table-id :id, :keys [restrict] :as view-spec} requested-cols query order-by chunk-size cursor]
  (let [query (query/both-queries query restrict)
        requested-cols (include-order-by-cols requested-cols order-by)
        fetch-spec (basic-ops/compute-fetch-spec tables view-spec requested-cols)
        PRIMARY-QUERY (PRIMARY-QUERY tables table-id fetch-spec query order-by chunk-size cursor)

        {:keys [table-data primary-row-ids last-primary-row]}
        (basic-ops/walk-and-fetch-table-links tables db-c view-spec PRIMARY-QUERY fetch-spec)

        cursor (when (>= (count primary-row-ids) chunk-size)
                 (result-row->cursor (get-in tables [table-id]) last-primary-row order-by))]
    [table-data primary-row-ids cursor]))

(defn get-row [tables db-c {table-id :id :keys [restrict] :as view-spec} requested-cols query]
  (let [query (query/both-queries query restrict)
        fetch-spec (basic-ops/compute-fetch-spec tables view-spec requested-cols)
        PRIMARY-QUERY (PRIMARY-QUERY tables table-id fetch-spec query nil 2 nil)

        {:keys [table-data primary-row-ids last-primary-row]}
        (basic-ops/walk-and-fetch-table-links tables db-c view-spec PRIMARY-QUERY fetch-spec)]
    (when (> (count primary-row-ids) 1)
      (throw+ (util-v2/general-tables-error "More than one row matched this query")))

    [table-data (first primary-row-ids)]))

(defn count-rows [tables db-c {table-id :id :keys [restrict] :as view-spec} query]
  (let [query (query/both-queries query restrict)
        [SQL params] (COUNT-QUERY tables table-id query)]
    (:n (first (jdbc-t/query db-c (cons SQL params))))))

;; MISC: Inference
(defn infer-values-from-query [{:keys [op col terms value] :as query}]
  (condp = op
    "EQ" {col value}
    "AND" (->> (map infer-values-from-query terms)
               (apply merge))
    {}))