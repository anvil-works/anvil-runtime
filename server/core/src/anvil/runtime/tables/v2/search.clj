(ns anvil.runtime.tables.v2.search
  (:require [clojure.pprint :refer [pprint]]
            [slingshot.slingshot :refer :all]
            [clojure.tools.logging :as log]
            [anvil.runtime.tables.v2.util :as util-v2]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [anvil.runtime.tables.v2.basic-ops :as basic-ops]
            [anvil.dispatcher.types :as types]
            [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [clojure.pprint :as pprint])
  (:import (anvil.dispatcher.types SerializedPythonObject)))

(clj-logging-config.log4j/set-logger! :level :trace)

;; The search process:
;; 1. Parse args + kwargs into query objects, checking against column restrictions
;; 2. Combine query with view -> actual query
;; THEN do the "get a page" thing:
;; 3. Generate WHERE clause
;; 4. Generate SELECT clause
;; 5. Generate JOINs


;; 1. + 2. QUERY PARSING

(defn parse-query [tables table-id allowed-cols args kwargs]
  (let [inequality-op (fn [op col value]
                        (let [val (:value value)
                              check! (fn [pred?]
                                       (when-not (pred? val)
                                         (throw+ (util-v2/general-tables-error
                                                   (str "Invalid query: Cannot query " (:type col) " column '" (:name col) "' with a value of type "
                                                        (:type (table-types/get-type-from-value val)))))))]
                          (condp = (:type col)
                            "string" (check! string?)
                            "number" (check! number?)
                            "date" (check! table-types/is-datelike?)
                            "datetime" (check! table-types/is-datelike?)
                            (throw+ (util-v2/general-tables-error
                                      (str "Invalid query: Cannot use inequality operators to query column '" (:name col)
                                           "' of type " (:type (table-types/get-type-from-value val))))))

                          {:op    op
                           :col   (name (:id col))
                           :type  (:type col)
                           :value (if (contains? #{"date" "datetime"} (:type col))
                                    ;; We special-case date and datetime because they can be compared to one another
                                    (table-types/reduce-val (table-types/get-type-from-value val) val)

                                    (table-types/reduce-val (util-v2/typemap-from-column col) val))}))

        value->expr (fn value->expr [col-name valuetype-or-literal]
                      (let [col (get-in tables [table-id :columns col-name])
                            col-type (util-v2/typemap-from-column col)]
                        (if (and (instance? SerializedPythonObject valuetype-or-literal)
                                 (not= (:type valuetype-or-literal) "anvil.tables.v2._RowRef"))
                          (let [{:keys [type value]} valuetype-or-literal
                                check-col-type! (fn [op-name type]
                                                  (when-not (= type (:type col-type))
                                                    (throw+ (util-v2/general-tables-error
                                                              (str "Invalid query: Cannot use '" op-name "' operator on column '"
                                                                   col-name "', which is a " (table-types/get-type-name tables col-type) ".")))))
                                check-arg-type! (fn [op-name arg-name arg pred descr]
                                                  (when-not (pred arg)
                                                    (throw+ (util-v2/general-tables-error
                                                              (str "Invalid query: " (if arg-name (format "'%s' argument" arg-name) "Argument")
                                                                   " to the '" op-name "' operator must be " descr ".")))))]
                            (condp = type
                              "anvil.tables.query.equal_to"
                              (value->expr col-name (:value value))

                              "anvil.tables.query.like"
                              (let [pattern (:pattern value)]
                                (check-arg-type! "like" nil pattern string? "a string")
                                (check-col-type! "like" "string")

                                {:op      "LIKE"
                                 :col     (name (:id col))
                                 :pattern pattern})

                              "anvil.tables.query.ilike"
                              (let [pattern (:pattern value)]
                                (check-arg-type! "ilike" nil pattern string? "a string")
                                (check-col-type! "ilike" "string")

                                {:op      "ILIKE"
                                 :col     (name (:id col))
                                 :pattern pattern})

                              "anvil.tables.query.full_text_match"
                              (let [query (:query value)
                                    raw? (:raw value)]
                                (check-arg-type! "full_text_match" nil query string? "a string")
                                (check-col-type! "full_text_match" "string")
                                (check-arg-type! "full_text_match" "raw" raw? boolean? "True or False")


                                {:op    "TSQ"
                                 :col   (name (:id col))
                                 :query query
                                 :raw?  raw?})

                              "anvil.tables.query.greater_than"
                              (inequality-op "GT" col value)

                              "anvil.tables.query.greater_than_or_equal_to"
                              (inequality-op "GTEQ" col value)

                              "anvil.tables.query.less_than"
                              (inequality-op "LT" col value)

                              "anvil.tables.query.less_than_or_equal_to"
                              (inequality-op "LTEQ" col value)

                              "anvil.tables.query.all_of"
                              (if (not-empty (:kwargs value))
                                (throw+ (util-v2/general-tables-error (str "Cannot specify keyword arguments when limiting column values with all_of(): " (apply str (interpose "," (map #(str "'" % "' ") (keys (:kwargs value))))))))
                                {:op    "AND"
                                 :terms (for [arg (:args value)] (value->expr col-name arg))})

                              "anvil.tables.query.any_of"
                              (if (not-empty (:kwargs value))
                                (throw+ (util-v2/general-tables-error (str "Cannot specify keyword arguments when limiting column values with any_of(): " (apply str (interpose "," (map #(str "'" % "' ") (keys (:kwargs value))))))))
                                {:op    "OR"
                                 :terms (for [arg (:args value)] (value->expr col-name arg))})

                              "anvil.tables.query.none_of"
                              (if (not-empty (:kwargs value))
                                (throw+ (util-v2/general-tables-error (str "Cannot specify keyword arguments when limiting column values with not_() or none_of(): " (apply str (interpose "," (map #(str "'" % "' ") (keys (:kwargs value))))))))
                                {:op      "NOT"
                                 :operand {:op    "OR"
                                           :terms (for [arg (:args value)] (value->expr col-name arg))}})

                              (throw+ (util-v2/general-tables-error (str "Invalid query object: " (pr-str type))))))

                          ;; else, aka (not (instance? SerializedPythonObject valuetype-or-literal))
                          (let [literal-value valuetype-or-literal
                                table-name (get-in tables [table-id :name])

                                _ (when (= "media" (:type col-type))
                                    (throw+ (util-v2/general-tables-error (str "Cannot search on Media column"))))

                                _ (when-not (table-types/is-type? literal-value col-type)
                                    (throw+ (util-v2/general-tables-error (str "Column '" col-name "' can only be searched with a " (table-types/get-type-name tables col-type)
                                                                               (let [t (table-types/get-type-from-value literal-value)]
                                                                                 (when-not (:error t) (str " (not a " (table-types/get-type-name tables t) ")")))
                                                                               " in table '" table-name "'"))))

                                reduced-value (table-types/reduce-val col-type literal-value)]
                            {:op    "EQ"
                             :col   (name (:id col))
                             :type  (:type col)
                             :value reduced-value}))))

        query->expr (fn query->expr [{:keys [type] {:keys [args kwargs]} :value :as query}]
                      (let [terms (concat (map query->expr args)
                                          (for [[col-kw value] kwargs :let [col-name (name col-kw)]]
                                            (if-not (contains? allowed-cols col-name)
                                              (throw+ (util-v2/general-tables-error (format "No such column '%s'" col-name) "anvil.tables.NoSuchColumnError"))
                                              (value->expr col-name value))))]
                        (condp = type
                          "anvil.tables.query.all_of"
                          (condp = (count terms)
                            1 (first terms)
                            {:op    "AND"
                             :terms terms})

                          "anvil.tables.query.any_of"
                          (condp = (count terms)
                            ;; If there are 0 terms, it's an empty OR and renders to FALSE
                            1 (first terms)
                            {:op    "OR"
                             :terms terms})

                          "anvil.tables.query.none_of"
                          (condp = (count terms)
                            0 nil
                            1 {:op      "NOT"
                               :operand (first terms)}
                            {:op      "NOT"
                             :operand {:op    "OR"
                                       :terms terms}})

                          (throw+ (util-v2/general-tables-error (str "Invalid query operator: " (pr-str query)))))))

        built-expr (query->expr {:type "anvil.tables.query.all_of", :value {:args args, :kwargs kwargs}})]

    built-expr))

(defn both-queries [q1 q2]
  {:op "AND"
   :terms [q1 q2]})

;; 3. SQL generation

;; Capitals are sanitised values, and capitalised functions return SQL.
;; Yes, we are constructing SQL by hand. Yes, this is very dangerous. Think carefully.

(defmulti QUERY->SQL :op)

(defmethod QUERY->SQL "EQ" [q]
  [(str "(data @> ?::jsonb)") [{(:col q) (:value q)}]])

(defmethod QUERY->SQL "AND" [q]
  (if (empty? (:terms q))
    ["TRUE" []]
    (let [terms-sql (map QUERY->SQL (:terms q))
          sql-fragments (map first terms-sql)
          params (map second terms-sql)]
      [(str "(" (apply str (interpose " AND " sql-fragments)) ")") (apply concat params)])))

(defmethod QUERY->SQL "OR" [q]
  (if (empty? (:terms q))
    ["FALSE" []]
    (let [terms-sql (map QUERY->SQL (:terms q))
          sql-fragments (map first terms-sql)
          params (map second terms-sql)]
      [(str "(" (apply str (interpose " OR " sql-fragments)) ")") (apply concat params)])))

(defmethod QUERY->SQL "NOT" [q]
  (let [[operand-sql operand-params] (QUERY->SQL (:operand q))]
    [(str "NOT("operand-sql ")") operand-params]))

(defmethod QUERY->SQL "LIKE" [q]
  [(str "(data->>? LIKE ?)") [(:col q) (:pattern q)]])

(defmethod QUERY->SQL "ILIKE" [q]
  [(str "(data->>? ILIKE ?)") [(:col q) (:pattern q)]])

(defmethod QUERY->SQL "TSQ" [{:keys [col query raw?] :as _q}]
  [(str "(to_tsvector('english', data->>?) @@ " (if raw?
                                                  ;; Either way, query is a string
                                                  "to_tsquery"
                                                  "plainto_tsquery") "(?))") [col query]])

(defn INEQUALITY->SQL [inequality q]
  (condp = (:type q)

    "number"
    [(str "((data->>?)::float " inequality " ?)") [(:col q) (:value q)]]

    "string"
    [(str "(data->>? " inequality " ?)") [(:col q) (:value q)]]

    "date"
    [(str "(data->>? " inequality " ?)") [(:col q) (:value q)]] ; Can compare dates to datetimes and vice versa.

    "datetime"
    [(str "(data->>? " inequality " ?)") [(:col q) (:value q)]]


    (throw+ (util-v2/general-tables-error (str "Could not query column of type '" (:type q) "' with inequality '" inequality "'")))))

(defmethod QUERY->SQL "GT" [q]
  (INEQUALITY->SQL ">" q))

(defmethod QUERY->SQL "GTEQ" [q]
  (INEQUALITY->SQL ">=" q))

(defmethod QUERY->SQL "LT" [q]
  (INEQUALITY->SQL "<" q))

(defmethod QUERY->SQL "LTEQ" [q]
  (INEQUALITY->SQL "<=" q))

(defmethod QUERY->SQL nil [q]
  ["true" []])

(defmethod QUERY->SQL :default [q]
  (throw+ (util-v2/general-tables-error (str "Could not generate SQL for query:" (pr-str q)))))



(defn ORDER-BY-SQL [order-by-with-ids]
  [(str
     (->> (for [{:keys [col-id desc]} order-by-with-ids]
            (str "data->?" (if desc " DESC") ", "))
          (apply str))
     "id")
   (map :col-id order-by-with-ids)])

;; TODO need brackets here!
(defn CURSOR->SQL [order-by-with-ids cursor]
  (when cursor
    [(str (->> (for [{:keys [col-id desc]} order-by-with-ids]
                 (str "((data->? " (if desc "<" ">") "(?::jsonb)) OR (data->?) = (?::jsonb) AND "))
               (apply str))
          "id > ?"
          (apply str (repeat (count order-by-with-ids) ")")))
     (-> (mapcat (fn [{:keys [col-id desc]} last-val]
                   (let [val-str (util/write-json-str last-val)]
                     [col-id val-str col-id val-str]))
                 order-by-with-ids (drop-last cursor))
         (concat [(last cursor)]))]))

(defn PRIMARY-QUERY [tables table-id fetch-spec query order-by chunk-size cursor]
  (let [order-by-with-ids (for [{:keys [column_name ascending]} order-by]
                            {:col-id (get-in tables [table-id :columns column_name :id])
                             :desc   (not ascending)})
        [SELECT-EXPR select-params] (basic-ops/SELECT-COLUMNS tables fetch-spec 0)
        [WHERE-EXPR where-params] (QUERY->SQL query)
        [CURSOR-EXPR cursor-params] (CURSOR->SQL order-by-with-ids cursor)
        [ORDER-BY-EXPR order-by-params] (ORDER-BY-SQL order-by-with-ids)]
    ;(log/trace "CURSOR" cursor)
    ;(log/trace "CURSOR EXPR" CURSOR-EXPR cursor-params)
    [(str "SELECT id, " SELECT-EXPR ", 0 AS fid, ROW_NUMBER() OVER (ORDER BY " ORDER-BY-EXPR ") AS primary_order FROM app_storage_data WHERE table_id = ? AND " WHERE-EXPR
          (when cursor (str " AND " CURSOR-EXPR))
          " ORDER BY primary_order LIMIT " (int chunk-size))
     (concat select-params order-by-params [table-id] where-params cursor-params)]))

(defn COUNT-QUERY [tables table-id query]
  (let [[WHERE-EXPR where-params] (QUERY->SQL query)]
    [(str "SELECT COUNT(*) AS n FROM app_storage_data WHERE table_id = ? AND " WHERE-EXPR)
     (concat [table-id] where-params)]))

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

(defn get-page [tables db-c {table-id :id, :keys [restrict] :as view-spec} requested-cols query order-by chunk-size cursor]
  (let [query (cond-> query restrict (both-queries restrict))
        requested-cols (include-order-by-cols requested-cols order-by)
        fetch-spec (basic-ops/compute-fetch-spec tables view-spec requested-cols)
        PRIMARY-QUERY (PRIMARY-QUERY tables table-id fetch-spec query order-by chunk-size cursor)

        {:keys [table-data primary-row-ids last-primary-row]}
        (basic-ops/walk-and-fetch-table-links tables db-c view-spec PRIMARY-QUERY fetch-spec)

        cursor (when (>= (count primary-row-ids) chunk-size)
                 (let [{:keys [rdata id]} last-primary-row]
                   (concat
                     (for [{:keys [column_name]} order-by]
                       (get rdata (keyword column_name)))
                     [id])))]
    [table-data primary-row-ids cursor]))

(defn get-row [tables db-c {table-id :id :keys [restrict] :as view-spec} requested-cols query]
  (let [query (cond-> query restrict (both-queries restrict))
        fetch-spec (basic-ops/compute-fetch-spec tables view-spec requested-cols)
        PRIMARY-QUERY (PRIMARY-QUERY tables table-id fetch-spec query nil 2 nil)

        {:keys [table-data primary-row-ids last-primary-row]}
        (basic-ops/walk-and-fetch-table-links tables db-c view-spec PRIMARY-QUERY fetch-spec)]
    (when (> (count primary-row-ids) 1)
      (throw+ (util-v2/general-tables-error "More than one row matched this query")))

    [table-data (first primary-row-ids)]))

(defn count-rows [tables db-c {table-id :id :keys [restrict] :as view-spec} query]
  (let [query (cond-> query restrict (both-queries restrict))
        [SQL params] (COUNT-QUERY tables table-id query)]
    (:n (first (jdbc/query db-c (cons SQL params))))))

;; MISC: Inference
(defn infer-values-from-query [{:keys [op col terms value] :as query}]
  (condp = op
    "EQ" {col value}
    "AND" (->> (map infer-values-from-query terms)
               (apply merge))
    {}))