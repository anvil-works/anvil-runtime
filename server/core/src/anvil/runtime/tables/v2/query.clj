(ns anvil.runtime.tables.v2.query
  (:require
    [slingshot.slingshot :refer [throw+ try+]]
    [anvil.runtime.tables.v2.table-types :as table-types]
    [anvil.runtime.tables.v2.util :as util-v2]
    [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
    [anvil.util :as util]
    [anvil.runtime.tables.split.sql :as sql]
    [anvil.runtime.tables.split.sql :as split-sql])
  (:import (anvil.dispatcher.types SerializedPythonObject)))


(defn- in-allowed-cols-and-visible? [allowed-cols column-map col-name]
  (if rpc-util/*client-request?*
    (and (not (:client_hidden (column-map col-name))) (allowed-cols col-name))
    (allowed-cols col-name)))


(defn parse-query [tables table-id allowed-cols args kwargs]
  (let [storage (get-in tables [table-id :table-record :storage])
        inequality-op (fn [op col value]
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

                          (let [type (if (contains? #{"date" "datetime"} (:type col))
                                       ;; Are we cross-comparing datetimes with dates?
                                       (condp = (:type (table-types/get-type-from-value val))
                                         (:type col) (:type col) ;; no.
                                         "date" "dtd"       ;; date compared to datetime
                                         "datetime" "ddt"   ;; datetime compared to date
                                         )
                                       (:type col))]
                            {:op    op
                             :col   (name (:id col))
                             :type  type
                             :value (condp = type
                                      "dtd" (:date-string val)
                                      "ddt" (:datetime-string val)
                                      (table-types/reduce-val-for-query storage col val))})))

        equality-op (fn equality-op [col col-type literal-value fuzzy?]
                      (let [table-name (get-in tables [table-id :name])

                            _ (when (and (= "media" (:type col-type)) (some? literal-value))
                                (throw+ (util-v2/general-tables-error (str "Media columns can only be searched for None"))))

                            _ (when-not (table-types/is-type? literal-value col-type)
                                (throw+ (util-v2/general-tables-error (str "Column '" (:name col) "' can only be searched with a " (table-types/get-type-name tables col-type)
                                                                           (let [t (table-types/get-type-from-value literal-value)]
                                                                             (when-not (:error t) (str " (not a " (table-types/get-type-name tables t) ")")))
                                                                           " in table '" table-name "'"))))]
                        {:op    (if fuzzy? "EQ" "EQX")
                         :col   (name (:id col))
                         :type  (:type col)
                         :value (table-types/reduce-val-for-query storage col-type literal-value)}))

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
                              (equality-op col col-type (:value value) false)

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
                          (equality-op col col-type valuetype-or-literal true))))

        query->expr (fn query->expr [{:keys [type] {:keys [args kwargs]} :value :as query}]
                      (let [terms (concat (map query->expr args)
                                          (for [[col-kw value] kwargs :let [col-name (name col-kw)]]
                                            (if-not (in-allowed-cols-and-visible? allowed-cols (get-in tables [table-id :columns]) col-name)
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
  (cond
    (nil? q2) q1
    (nil? q1) q2
    :else
    {:op    "AND"
     :terms [q1 q2]}))

;; 3. SQL generation

;; Capitals are sanitised values, and capitalised functions return SQL.
;; Yes, we are constructing SQL by hand. Yes, this is very dangerous. Think carefully.

(defmulti QUERY->SQL (fn [table-record expr]
                       (:op expr)))

(defmethod QUERY->SQL "EQ" [{:keys [storage] :as table-record} {:keys [col value type] :as q}]
  (if (:split storage)
    (cond
      (= type "link_multiple")
      (let [[target-ids] value
            n-targets (count target-ids)]
        (condp = n-targets
          0 ["TRUE" []]
          1 [(str "EXISTS (SELECT * FROM " (sql/LINK-TABLE-NAME table-record col) " WHERE from_row=_id AND to_row=?)") [(first target-ids)]]
          ;; else
          ;; NB if you optimise this to do the (set) earlier you MUST update the tests to trigger this case a different way
          [(str "(SELECT COUNT(DISTINCT to_row) = ? FROM " (sql/LINK-TABLE-NAME table-record col) " WHERE from_row=_id AND to_row=ANY(?))")
           [(count (set target-ids)) (long-array (set target-ids))]]))

      (nil? value)
      [(str "(" (sql/COLUMN-NAME table-record col) " IS NULL)") []]

      (= type "simpleObject")
      [(str "(" (sql/COLUMN-NAME table-record col) " IS NOT NULL AND " (sql/COLUMN-NAME table-record col) " @> " (sql/VALUE-SQL table-record col) ")") value]

      :else
      [(str "(" (sql/COLUMN-NAME table-record col) " IS NOT NULL AND " (sql/COLUMN-NAME table-record col) " = " (sql/VALUE-SQL table-record col) ")") value])

    ;; Else, non-split
    [(str "(data @> ?::jsonb)") [{col value}]]))

(defmethod QUERY->SQL "EQX" [{:keys [storage] :as table-record} {:keys [col value] :as q}]
  ;; For now preserve same semantics as EQ:
  (QUERY->SQL table-record (assoc q :type "EQ"))
  ;; TODO support exact equality of simpleObject values.
  #_(if (:split storage)
    (if (nil? value)
      [(str "(" (sql/COLUMN-NAME table-record col) " IS NULL)") []]
      [(str "(" (sql/COLUMN-NAME table-record col) " = " (sql/VALUE-SQL table-record col) ")") value])
    [(str "(data->? = ?::jsonb)") [col (util/write-json-str value)]]))

(defmethod QUERY->SQL "AND" [table-record q]
  (if (empty? (:terms q))
    ["TRUE" []]
    (let [terms-sql (map #(QUERY->SQL table-record %) (:terms q))
          sql-fragments (map first terms-sql)
          params (map second terms-sql)]
      [(str "(" (apply str (interpose " AND " sql-fragments)) ")") (apply concat params)])))

(defmethod QUERY->SQL "OR" [table-record q]
  (if (empty? (:terms q))
    ["FALSE" []]
    (let [terms-sql (map #(QUERY->SQL table-record %) (:terms q))
          sql-fragments (map first terms-sql)
          params (map second terms-sql)]
      [(str "(" (apply str (interpose " OR " sql-fragments)) ")") (apply concat params)])))

(defmethod QUERY->SQL "NOT" [table-record q]
  (let [[operand-sql operand-params] (QUERY->SQL table-record (:operand q))]
    [(str "NOT(" operand-sql ")") operand-params]))

(defmethod QUERY->SQL "TSQ" [{:keys [storage] :as table-record} {:keys [col query raw?] :as _q}]
  (let [FUNC (if raw? "to_tsquery" "plainto_tsquery")]
    (if (:split storage)
      [(str "(to_tsvector('english', " (sql/COLUMN-NAME table-record col) ") @@ " FUNC "(?))") [query]]
      [(str "(to_tsvector('english', data->>?) @@ " FUNC "(?))") [col query]])))

(defn- INFIXOP->SQL [OP table-record {:keys [col value type] :as q}]
  (if (:split (:storage table-record))
    (let [COLUMN-NAME (sql/COLUMN-NAME table-record col)]
      (condp = type
        ;; Special handling for comparing dates with datetimes
        "dtd" [(str "(" COLUMN-NAME ").utc " OP " ?::date") [value]]
        "ddt" [(str "(" COLUMN-NAME ") " OP " ?::datetime") [value]]
        ;; else,standard
        [(str "(" (sql/COLUMN-NAME table-record col) " " OP " " (sql/VALUE-SQL table-record col) ")") value]))
    (let [FLOAT-CAST (when (= type "number") "::float")]
      [(str "((data->>?)" FLOAT-CAST " " OP " ?)") [col value]])))

(defn- LIKE->SQL [OP {:keys [storage] :as table-record} q]
  (INFIXOP->SQL OP table-record (assoc q :value (if (:split storage) [(:pattern q)] (:pattern q)))))

(defmethod QUERY->SQL "LIKE" [table-record q]
  (LIKE->SQL "LIKE" table-record q))

(defmethod QUERY->SQL "ILIKE" [table-record q]
  (LIKE->SQL "ILIKE" table-record q))

(defmethod QUERY->SQL "GT" [table-record q]
  (INFIXOP->SQL ">" table-record q))

(defmethod QUERY->SQL "GTEQ" [table-record q]
  (INFIXOP->SQL ">=" table-record q))

(defmethod QUERY->SQL "LT" [table-record q]
  (INFIXOP->SQL "<" table-record q))

(defmethod QUERY->SQL "LTEQ" [table-record q]
  (INFIXOP->SQL "<=" table-record q))

(defmethod QUERY->SQL nil [_ q]
  ["true" []])

(defmethod QUERY->SQL :default [_ q]
  (throw+ (util-v2/general-tables-error (str "Could not generate SQL for query:" (pr-str q)))))



(defn ORDER-BY-SQL [{:keys [storage] :as table-record} order-by-with-ids]
  [(str
     (->> (for [{:keys [col-id desc]} order-by-with-ids]
            (str (if (:split storage) (split-sql/COLUMN-NAME table-record col-id) "data->?")
                 (if desc " DESC NULLS LAST" " ASC NULLS FIRST") ", "))
          (apply str))
     (if (:split storage) "_id" "id"))
   (when-not (:split storage)
     (map :col-id order-by-with-ids))])

(defn CURSOR->SQL [{:keys [storage] :as table-record} order-by-with-ids cursor]
  (when cursor
    (if (:split storage)
      [(str (->> (for [[{:keys [col-id desc]} v] (map vector order-by-with-ids cursor)
                       :let [COL-NAME (split-sql/COLUMN-NAME table-record col-id)
                             VALUE-SQL (split-sql/VALUE-SQL table-record col-id)]]
                   (if (nil? v)
                     ;; NULL is less than everything else.
                     ;; For ASC:
                     ;;   The semantics we want are: x > v OR x = v AND
                     ;;   But if v IS NULL, we need: x IS NOT NULL OR x IS NULL AND
                     ;; For DESC:
                     ;;   The semantics we want are: (x < v OR x IS NULL) OR x = v AND
                     ;;   But if v IS NULL, x cannot be < v, and therefore we only need: x IS NULL AND
                     (if desc
                       (str "(" COL-NAME " IS NULL AND ")
                       (str "(" COL-NAME " IS NOT NULL OR " COL-NAME " IS NULL AND "))
                     (if desc
                       (str "((" COL-NAME " IS NULL OR " COL-NAME " < " VALUE-SQL ") OR (" COL-NAME ") = (" VALUE-SQL ") AND ")
                       (str "((" COL-NAME " IS NOT NULL AND " COL-NAME " > " VALUE-SQL ") OR (" COL-NAME ") = (" VALUE-SQL ") AND "))))
                 (apply str))
            "_id > ?"
            (apply str (repeat (count order-by-with-ids) ")")))
       (concat (apply concat (for [v (drop-last cursor)]
                               ;; We need each of these doubled because we use VALUE-SQL twice (or v is nil, in
                               ;; which case we don't need it at all, and concat will give us what we want because
                               ;; v is an empty seq).
                               (concat v v)))
               [(last cursor)])]
      ;; Else (not split)
      [(str (->> (for [{:keys [col-id desc]} order-by-with-ids]
                   (str "((data->? " (if desc "<" ">") "(?::jsonb)) OR (data->?) = (?::jsonb) AND "))
                 (apply str))
            "id > ?"
            (apply str (repeat (count order-by-with-ids) ")")))
       (-> (mapcat (fn [{:keys [col-id desc]} last-val]
                     (let [val-str (util/write-json-str last-val)]
                       [col-id val-str col-id val-str]))
                   order-by-with-ids (drop-last cursor))
           (concat [(last cursor)]))])))
