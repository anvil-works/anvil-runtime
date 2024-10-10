(ns anvil.runtime.tables.rpc
  (:use [compojure.core]
        [slingshot.slingshot]
        [anvil.runtime.tables.util]
        [clojure.pprint])
  (:require [clojure.java.jdbc :as jdbc]
            [anvil.runtime.tables.util :as tables-util]
            [clojure.data.json :as json]
            [anvil.util :as util :refer [as-int]]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [anvil.dispatcher.types :as types]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [clojure.java.io :as io]
            digest
            [anvil.dispatcher.core :as dispatcher]
            [anvil.runtime.tables.util :as table-util]
            [anvil.dispatcher.native-rpc-handlers.util :as nrpc-util]
            [anvil.runtime.sessions :as sessions]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks]
            [anvil.core.tracing :as tracing])
  (:import (java.sql SQLException ResultSet Blob)
           (anvil.dispatcher.types Date DateTime LiveObjectProxy MediaDescriptor Media ChunkedStream BlobMedia SerialisableForRpc SerializedPythonObject)
           (java.io ByteArrayOutputStream InputStream OutputStream)
           (org.apache.commons.io IOUtils)
           (org.postgresql.util PSQLException)))

(clj-logging-config.log4j/set-logger! "anvil.runtime.tables.rpc" :level :info)

(def TRow)

(defn- ensure-table-access-ok-returning-cols-and-name [table-id op view-cols]

  (if (= op :read-row)
    ;; They have a LiveObject => they have a read capability.
    [(get-columns (db) table-id view-cols) nil]

    (if-let [{:keys [columns client server] table-name :name}
             (tables-util/get-table-access rpc-util/*environment* table-id)]
      (let [ambient-permission (if rpc-util/*client-request?*
                                 client server)

            op-allowed-with-permission? (fn [permission]
                                          (get {"full"   true
                                                "search" (= :search op)}
                                               permission))

            table-permission-from-lo {"cwrite" "full",
                                      "cread" "search"}

            permissions-from-lo (map table-permission-from-lo rpc-util/*permissions*)

            op-allowed?  (or (op-allowed-with-permission? ambient-permission)
                             (and (some op-allowed-with-permission? permissions-from-lo)
                                  (op-allowed-with-permission? server)))]

        (if op-allowed?
          [(filter-columns columns view-cols) table-name]
          (do
            (log/debug "Client? " rpc-util/*client-request?* "; op" op ", ambient '" ambient-permission "', LiveObject permission " rpc-util/*permissions*)
            (throw+ {:anvil/server-error (str "Permission denied: Cannot " (name op) " in table '" table-name "' from "
                                              (cond
                                                (not rpc-util/*client-request?*) "server"
                                                (rpc-util/have-live-object-permission? "cwrite") "client or server"
                                                :else "client") " code.")
                     :docId              "data_tables_permissions"
                     :docLinkTitle       "Learn about Data Table permissions"}))))
      (throw+ (general-tables-error "This table cannot be written or searched by this app")))))

(defn- ensure-table-access-ok-returning-cols [_c table-id op view-cols]
  (first (ensure-table-access-ok-returning-cols-and-name table-id op view-cols)))


(defn- get-cols-by-name [cols]
  (into {} (for [[col-id col-desc] cols]
             [(:name col-desc) (assoc col-desc :id col-id)])))

(defn- oid->Media [oid]
  (let [media-info (first (jdbc/query (db) [(str "SELECT " MEDIA-INFO-COLS " from app_storage_media WHERE object_id = ?") oid]))]
    (lazy-media/mk-LazyMedia-with-correct-mac {:manager   "table-media", :id (str oid),
                                               :mime-type (:content_type media-info), :name (:name media-info)}
                                              ;; LazyMedia needs a request for all sorts of reasons, but table RPC functions are sometimes called
                                              ;; without one (from a Users Service password reset, for example). In that case, Lazy Media won't
                                              ;; work, but pass a fake request object so that at least it doesn't explode
                                              (or rpc-util/*req* {:session-state (atom {})}))))

(def reinflate-val)
(def ^:dynamic *max-reinflation-recursion-depth* 5)

(defn- make-item-cache [cols data loaded-rows loaded-tables]
  (reduce (fn [itemCache [col-id {:keys [name _type] :as col}]]
            (let [rebuilt-val (reinflate-val col (get data col-id) loaded-rows loaded-tables)]
              (assoc itemCache name rebuilt-val))) {} cols))

(def ^:dynamic *reinflating-los* [])

(defn- reinflate-val [col val loaded-rows loaded-tables]
  (let [reconstitute-with-permissions (fn [live-object-map]
                                        (when live-object-map
                                          (let [live-object-map (update-in live-object-map [:methods] (fn [m] (or m (when (= (:backend live-object-map "anvil.tables.Row"))
                                                                                                                      #_(log/warn "****** Live object without methods!" (pr-str *reinflating-los*))
                                                                                                                      ["__anvil_iter_page__" "__getitem__" "update" "get_id" "__setitem__" "delete" "set"]))))
                                                lo (live-objects/load-LiveObjectProxy live-object-map {:permitted-live-object-backends #{"anvil.tables.Row"}})]
                                            (if (and (= (:backend lo) "anvil.tables.Row")
                                                     (rpc-util/have-live-object-permission? "cascade"))
                                              (assoc lo :permissions rpc-util/*permissions*)
                                              lo))))]
    ;;(log/trace "Reinflating:" (pr-str val))
    (when (not (nil? val))
      (binding [*reinflating-los* (conj *reinflating-los* val)]
        (condp = (:type col)
          "liveObject" (let [[table-id row-id] (json/read-str (:id val))
                             cols (get loaded-tables table-id)
                             data (:data (get loaded-rows row-id))

                             ;; Only build itemCache for this liveObject if we've cached the data already.
                             live-object-map (if (and cols data (pos? *max-reinflation-recursion-depth*))
                                               (binding [*max-reinflation-recursion-depth* (dec *max-reinflation-recursion-depth*)]
                                                 (assoc val :itemCache (make-item-cache cols data loaded-rows
                                                                                        ;; Prevent long loops with mutually referring rows
                                                                                        (dissoc loaded-tables table-id))))
                                               val)]
                         (reconstitute-with-permissions live-object-map))

          "liveObjectArray" (doall (map reconstitute-with-permissions val))
          "date" (Date. val)
          "datetime" (reinflate-anvil-datetime val)
          "media" (oid->Media val)
          val)))))



(defn- mk-Row [table-id cols view-cols loaded-rows loaded-tables {:keys [id data] :as _db-row}]
  (binding [*reinflating-los* (conj *reinflating-los* {:root-row [table-id id]})]
    (types/mk-LiveObjectProxy "anvil.tables.Row" (util/write-json-str (if (not-empty view-cols) [table-id id view-cols] [table-id id]))
                              rpc-util/*permissions* (keys TRow)
                              (make-item-cache cols data loaded-rows
                                               ;; Prevent mutual recursion between tables
                                               (dissoc loaded-tables table-id)))))


(defn iter-page [[table-id query-obj view-cols cols query-modifiers :as _liveobject-id] _kwargs start-vals]
  (tracing/with-span ["Load data page" {:internal true}]
    (let [start-time (double (System/currentTimeMillis))

          ;; Capitals are sanitised values. Yes, we are constructing SQL by hand.
          ;; Yes, this is very dangerous. Think carefully.
          CHUNKSIZE (int (or (some :chunk_size query-modifiers) 100))

          [start-id & start-col-vals] start-vals

          ORDER-BY (seq (for [[idx {:keys [order_by ascending]} start-val]
                              (map vector (range) query-modifiers (or start-col-vals (repeat nil)))
                              :when order_by
                              :when (re-matches #"[-A-Za-z0-9+_=]+" (name order_by))]
                          {:idx       idx,
                           :col-id    (name order_by),
                           :ascending ascending,
                           :start-val (util/write-json-str start-val)}))

          GET-START-CONDITION (fn get-start-condition [[{:keys [col-id ascending start-val] :as c} & more]]
                                (if-not c
                                  (str "id >= ?")
                                  (let [COMPARE (if ascending ">" "<")]
                                    (str "data->'" col-id "' " COMPARE " ?::jsonb OR data->'" col-id "' = ?::jsonb AND ("
                                         (get-start-condition more)
                                         ")"))))

          ;; We use each start-val twice
          start-val-args (mapcat (fn [{:keys [start-val]}]
                                   [start-val start-val])
                                 ORDER-BY)

          ;; Find out which columns in the table we're querying point to other tables.
          ;; Recursively build up a list of reference columns and tables they reference.
          link-cols-query "
          WITH RECURSIVE reference_cols AS (
            (WITH cs AS (SELECT (jsonb_each(columns)).key as col_id, (jsonb_each(columns)).value as value from app_storage_tables where id = ?)
              SELECT ? AS source_table_id, col_id, (value->>'table_id')::INTEGER as target_table_id FROM cs WHERE value->>'backend' = 'anvil.tables.Row' AND value->>'type' = 'liveObject')
            UNION
              (WITH cs AS (SELECT (jsonb_each(columns)).key as col_id, (jsonb_each(columns)).value as value, target_table_id from app_storage_tables, reference_cols where id=target_table_id)
                SELECT target_table_id AS source_table_id, col_id, (value->>'table_id')::INTEGER as target_table_id FROM cs WHERE value->>'backend' = 'anvil.tables.Row' AND value->>'type' = 'liveObject'))
          SELECT * from reference_cols;"

          ;;_ (log/trace "Link cols:\n" link-cols-query)

          _ (tracing/add-span-event! "Link-col query start")
          LINK-COLS (or (when rpc-util/*session-state*
                          (get-in (sessions/ephemeral-cache rpc-util/*session-state*) [::LINK-COL-CACHE table-id]))
                        (let [link-cols (util/with-metric-query "link-cols-query"
                                          (jdbc/query (db) [link-cols-query table-id table-id]))
                              ;; Based on user-provided data (col-specs via IDE)
                              LINK-COLS (for [{:keys [source_table_id target_table_id col_id] :as c} link-cols
                                              :when (and (number? source_table_id)
                                                         (number? target_table_id)
                                                         (re-matches #"[-A-Za-z0-9+_=]+" col_id))]
                                          (select-keys c [:source_table_id :target_table_id :col_id]))]
                          (when rpc-util/*session-state*
                            (swap! (sessions/ephemeral-cache rpc-util/*session-state*) assoc-in [::LINK-COL-CACHE table-id] LINK-COLS))
                          LINK-COLS))

          _ (tracing/add-span-event! "Link-col queried")

          [link-col-ids loaded-tables] (reduce (fn [[link-col-ids loaded-tables] {:keys [col_id target_table_id]}]
                                                 [(cons col_id link-col-ids)
                                                  (assoc loaded-tables target_table_id (ensure-table-access-ok-returning-cols (db) target_table_id :read-row nil))]) [nil nil] LINK-COLS)

          _ (tracing/add-span-event! "Link-col access checks")

          ;; Load all the rows we could possibly be interested in, following references to single rows in other
          ;; tables recursively.

          [QUERY-SQL query-args] (query->sql query-obj)

          _ (log/trace "Built SQL query: " QUERY-SQL query-args)

          row-query (str "
          WITH RECURSIVE rows AS (
            -- First get all the rows we're directly interested in

            SELECT *
            FROM (select *, TRUE as direct_match from app_storage_data
              WHERE table_id=? AND "
                         QUERY-SQL
                         (when start-vals
                           (str " AND (" (GET-START-CONDITION ORDER-BY) ")")) "
              ORDER BY "
                         (apply str
                                (interpose ","
                                           (concat
                                             (for [{:keys [col-id ascending]} ORDER-BY]
                                               (str "data->'" col-id "' " (if ascending "ASC" "DESC")))
                                             ["id"])))
                         " LIMIT " (inc CHUNKSIZE) "
            ) data"
                         (when link-col-ids (str "
            UNION
              -- Then repeatedly follow links to referenced rows from every row
              -- we've found so far
              SELECT asd.*, FALSE as direct_match
              FROM rows rs, app_storage_data asd WHERE "
                                                 (apply str
                                                        (interpose " OR "
                                                                   (map #(str "(rs.table_id = " (:source_table_id %) " and asd.table_id = " (:target_table_id %) " and asd.id = ((rs.data->'" (:col_id %) "'->>'id')::json->>1)::INTEGER)")
                                                                        LINK-COLS))))) "
          )
          SELECT id,table_id,data,direct_match FROM rows;")

          args (concat [table-id] query-args (when start-vals start-val-args) (when start-vals [start-id]))

          ;;_ (log/trace "Load rows:\n" (cons row-query args))

          _ (tracing/add-span-event! "Ready for query")

          _ (log/trace (with-out-str
                         (println "Query:")
                         (println row-query)
                         (println (pr-str args))
                         (println "Analysing query...")
                         (doseq [line (jdbc/query (db) (cons (str "EXPLAIN ANALYSE " row-query) args))]
                           (println ((keyword "query plan") line)))))

          all-rows (util/log-time :trace "Loading table rows"
                                  (try
                                    (util/with-metric-query "row-query"
                                      (jdbc/query (db) (cons row-query args)))
                                    (catch PSQLException e
                                      (let [msg (.getMessage e)]
                                        ;; Calm down, we're done generating SQL; we can do hacky string-mashing again...
                                        (if (re-find #"syntax.*tsquery" msg)
                                          (throw+ (general-tables-error (second (re-find #"ERROR: (.*)" msg))))
                                          (throw e))))))

          _ (tracing/add-span-event! "DB query complete")

          direct-match-rows (filter :direct_match all-rows)

          row-map (reduce (fn [row-map row]
                            (assoc row-map (:id row) row)) {} all-rows)

          _ (tracing/add-span-event! "Row map compiled")

          rows (doall (map (partial mk-Row table-id cols view-cols row-map loaded-tables)
                           direct-match-rows))]

      _ (tracing/add-span-event! (str "mk-Row executed " (count direct-match-rows) " times"))

      (when rpc-util/*profiles*
        (swap! rpc-util/*profiles* conj {:description "Loading data page"
                                         :start-time  start-time
                                         :end-time    (double (System/currentTimeMillis))}))
      {:items    (take CHUNKSIZE rows)
       :nextPage (when-let [next-row (first (drop CHUNKSIZE direct-match-rows))]
                   (cons (:id next-row)
                         (for [{:keys [col-id]} ORDER-BY]
                           (get-in next-row [:data (keyword col-id)]))))})))

(def TSearch {"__anvil_iter_page__" iter-page

              "__len__"             (fn [[table-id query-obj _view-cols _cols _chunk-size] _kwargs]
                                      (let [[QUERY-SQL query-args] (query->sql query-obj)]
                                        (util/with-metric-query "TSearch __len__"
                                          (:c (first (jdbc/query (db) (concat [(str "SELECT COUNT(1) AS c FROM app_storage_data WHERE table_id=? AND " QUERY-SQL) table-id]
                                                                              query-args)))))))

              "to_csv"              (fn [[table-id query-obj view-cols cols] {:keys [escape_for_excel]}]

                                      (ensure-table-access-ok-returning-cols (db) table-id :search view-cols)
                                      (lazy-media/mk-LazyMedia-with-correct-mac {:manager   "query-csv", :id (util/write-json-str [table-id query-obj view-cols cols escape_for_excel]),
                                                                                 :mime-type "text/csv", :name "download.csv"}
                                                                                rpc-util/*req*))})

(defn- prepare-update! [c table-id current-values updates view-cols auto-create-cols?]
  (let [cols (atom (ensure-table-access-ok-returning-cols c table-id :write nil))
        cols-by-name (get-cols-by-name (filter-columns @cols view-cols))
        set-column-type! (fn [id new-type]
                           (swap! cols update-in [id] #(merge new-type (select-keys % [:name :admin_ui])))
                           (jdbc/execute! c ["UPDATE app_storage_tables SET columns=?::jsonb WHERE id = ?"
                                             @cols table-id])
                           (update-table-views! c table-id @cols))
        media-updates (atom {})]

    [(into current-values
           (concat
             ;; Any un-set columns we should set explicitly to nil? (only do this if we *know* the current values!)
             (when current-values
               (for [col-id (keys @cols) :when (not (contains? current-values col-id))]
                 [col-id nil]))

             (for [[col-name value] updates
                   :let [col-name (name col-name)
                         {:keys [id type] :as col} (get cols-by-name col-name)
                         val-type (get-type-from-value value)]]
               (cond
                 (:error val-type)
                 (throw+ (general-tables-error
                           (if (= "simpleObject" type)
                             (str "Value for column '" col-name "' is not a valid Simple Object. "
                                  (if (:anvil.runtime.tables.util/unknown-type? val-type)
                                    "Simple Objects can only be lists, dicts with string keys, strings, numbers, True/False, or None."
                                    (:error val-type)))
                             (:error val-type))))

                 (and (not col) (not-empty view-cols))
                 (throw+ (general-tables-error (str "Cannot automatically add column '" col-name "' to this view")))

                 (not col)
                 (if-not auto-create-cols?
                   (throw+ (general-tables-error (str "Row update failed: Column '" col-name "' does not exist and automatic column creation is disabled.") "anvil.tables.NoSuchColumnError"))
                   (let [new-id (keyword (gen-new-id 8))]

                     (rpc-util/*rpc-println* (str "Automatically creating column " (pr-str col-name) " (" (get-type-name c val-type) ")"))

                     (set-column-type! new-id (assoc val-type :name col-name :admin_ui {:width 200
                                                                                        :order (count @cols)}))
                     (jdbc/execute! c ["UPDATE app_storage_data SET data = data || ?::jsonb WHERE table_id = ?"
                                       {new-id nil}
                                       table-id])

                     [new-id (reduced-val (:type val-type) value)]))

                 (or (= type "unresolved")
                     (and (= type "unresolvedArray")
                          (or (#{"liveObjectArray" "simpleObject"} (:type val-type)))))
                 (do
                   (set-column-type! id val-type)
                   (rpc-util/*rpc-print* (str "Type of column " (pr-str col-name) " is now " (get-type-name c val-type)))
                   [id (reduced-val (:type val-type) value)])

                 (not (is-type? value col))
                 (throw+ (general-tables-error (type-error? (db) value col col-name)))

                 (instance? MediaDescriptor value)
                 (let [current-oid (get current-values id)]
                   (swap! media-updates assoc id [current-oid value])
                   [id current-oid])

                 :else
                 (do
                   (when (and (nil? value)
                              (= (:type col) "media"))
                     (swap! media-updates assoc id [(get current-values id) nil]))
                   [id (reduced-val (:type col) value)])))))
     (filter-columns @cols view-cols)
     @media-updates]))

(def query-operators #{"anvil.tables.query.equal_to"
                       "anvil.tables.query.like"
                       "anvil.tables.query.ilike"
                       "anvil.tables.query.any_of"
                       "anvil.tables.query.all_of"
                       "anvil.tables.query.none_of"})

(def search-modifiers #{"anvil.tables.order_by"
                        "anvil.tables.query.page_size"})

(defn build-query-obj [query get-col table-name equality-only?]
  (log/trace "Building search expression from query:\n" (with-out-str (pprint query)))
  (let [op (fn [op col value]
             (let [val (:value value)]
               (condp = (:type col)
                 "string"
                 (when (not (string? val))
                   (throw+ (general-tables-error (str "Invalid query: Cannot query string column '" (:name col) "' with a value of type " (:type (get-type-from-value val))))))

                 "number"
                 (when (not (number? val))
                   (throw+ (general-tables-error (str "Invalid query: Cannot query number column '" (:name col) "' with a value of type " (:type (get-type-from-value val))))))

                 "date"
                 (when (and (not (instance? Date val))
                            (not (instance? DateTime val)))
                   (throw+ (general-tables-error (str "Invalid query: Cannot query date column '" (:name col) "' with a value of type " (:type (get-type-from-value val))))))

                 "datetime"
                 (when (and (not (instance? Date val))
                            (not (instance? DateTime val)))
                   (throw+ (general-tables-error (str "Invalid query: Cannot query datetime column '" (:name col) "' with a value of type " (:type (get-type-from-value val))))))

                 (throw+ (general-tables-error (str "Invalid query: Cannot use inequality operators to query column '" (:name col) "' of type " (:type (get-type-from-value val))))))

               {:op    op
                :col   (name (:id col))
                :type  (:type col)
                :value (if (and (contains? #{"date" "datetime"} (:type col))
                                (contains? #{"GT" "LT" "GTEQ" "LTEQ"} op))
                         ;; We special-case date and datetime because they can be compared to one another
                         (cond
                           (instance? Date val)
                           (reduced-val "date" val)
                           (instance? DateTime val)
                           (reduced-val "datetime" val))

                         (reduced-val (:type col) val true))}))

        value->expr (fn value->expr [col-name valuetype-or-literal]
                      (if (instance? SerializedPythonObject valuetype-or-literal)
                        (if equality-only?
                          (throw+ (general-tables-error (str "Invalid query value: '" (pr-str valuetype-or-literal) "'. View queries can only restrict column values by simple equality.")))
                          (let [{:keys [type value]} valuetype-or-literal
                                col (get-col col-name)]
                            (condp = type
                              "anvil.tables.query.equal_to"
                              (value->expr col-name (:value value))

                              "anvil.tables.query.like"
                              (let [pattern (:pattern value)]
                                (when-not (string? pattern)
                                  (throw+ (general-tables-error (str "Invalid query: Argument to the 'like' operator must be a string."))))
                                (when (not= "string" (:type col))
                                  (throw+ (general-tables-error (str "Invalid query: Cannot use 'like' operator on column '" (:name col) "', which is of type " (get-type-name (db) col) "."))))

                                {:op      "LIKE"
                                 :col     (name (:id col))
                                 :pattern pattern})

                              "anvil.tables.query.ilike"
                              (let [pattern (:pattern value)]
                                (when-not (string? pattern)
                                  (throw+ (general-tables-error (str "Invalid query: Argument to the 'ilike' operator must be a string."))))
                                (when (not= "string" (:type col))
                                  (throw+ (general-tables-error (str "Invalid query: Cannot use 'ilike' operator on column '" (:name col) "', which is of type " (get-type-name (db) col) "."))))

                                {:op      "ILIKE"
                                 :col     (name (:id col))
                                 :pattern pattern})

                              "anvil.tables.query.full_text_match"
                              (let [query (:query value)
                                    raw? (:raw value)]
                                (when-not (string? query)
                                  (throw+ (general-tables-error (str "Invalid query: Argument to the 'full_text_match' operator must be a string."))))
                                (when (not= "string" (:type col))
                                  (throw+ (general-tables-error (str "Invalid query: Cannot use 'full_text_match' operator on column '" (:name col) "', which is of type " (get-type-name (db) col) "."))))
                                (when (not (boolean? raw?))
                                  (throw+ (general-tables-error (str "Invalid query: 'raw' keyword argument to 'full_text_match' operator on column '" (:name col) "' must be True or False."))))

                                {:op    "TSQ"
                                 :col   (name (:id col))
                                 :query query
                                 :raw?  raw?})

                              "anvil.tables.query.greater_than"
                              (op "GT" col value)

                              "anvil.tables.query.greater_than_or_equal_to"
                              (op "GTEQ" col value)

                              "anvil.tables.query.less_than"
                              (op "LT" col value)

                              "anvil.tables.query.less_than_or_equal_to"
                              (op "LTEQ" col value)

                              "anvil.tables.query.all_of"
                              (if (not-empty (:kwargs value))
                                (throw+ (general-tables-error (str "Cannot specify keyword arguments when limiting column values with all_of(): " (apply str (interpose "," (map #(str "'" % "' ") (keys (:kwargs value))))))))
                                {:op    "AND"
                                 :terms (for [arg (:args value)] (value->expr col-name arg))})

                              "anvil.tables.query.any_of"
                              (if (not-empty (:kwargs value))
                                (throw+ (general-tables-error (str "Cannot specify keyword arguments when limiting column values with any_of(): " (apply str (interpose "," (map #(str "'" % "' ") (keys (:kwargs value))))))))
                                {:op    "OR"
                                 :terms (for [arg (:args value)] (value->expr col-name arg))})

                              "anvil.tables.query.none_of"
                              (if (not-empty (:kwargs value))
                                (throw+ (general-tables-error (str "Cannot specify keyword arguments when limiting column values with not_() or none_of(): " (apply str (interpose "," (map #(str "'" % "' ") (keys (:kwargs value))))))))
                                {:op      "NOT"
                                 :operand {:op    "OR"
                                           :terms (for [arg (:args value)] (value->expr col-name arg))}})

                              (throw+ (general-tables-error (str "Invalid query value: " (pr-str query)))))))

                        ;; else, aka (not (instance? SerializedPythonObject valuetype-or-literal))
                        (let [col (get-col col-name)

                              _ (when-not (is-type? valuetype-or-literal col)
                                  (throw+ (general-tables-error (str "Column '" col-name "' can only be searched with a " (get-type-name (db) col)
                                                                     (let [v (get-type-from-value valuetype-or-literal)]
                                                                       (when-not (:error v) (str " (not a " (get-type-name (db) v) ")")))
                                                                     " in table '" table-name "'"))))

                              _ (when (= "media" (:type col))
                                  (throw+ (general-tables-error (str "Cannot use a Media object as a search query"))))

                              reduced-value (if (and valuetype-or-literal (= (:type col) "liveObject"))
                                              ;; We manually reduce liveObjects for searching, so we can search with view-restricted rows
                                              (if (= "anvil.tables.Row" (:backend valuetype-or-literal))
                                                ;; Trim off any view restrictions when searching for a Row value
                                                {:backend (:backend valuetype-or-literal)
                                                 :id      (let [[tid rid] (json/read-str (:id valuetype-or-literal))]
                                                            (util/write-json-str [tid rid]))}
                                                (select-keys valuetype-or-literal [:backend :id]))
                                              ;; else, not a liveobject, reduce it normally
                                              (reduced-val (:type col) valuetype-or-literal))]
                          {:op    "EQ"
                           :col   (name (:id col))
                           :type  (:type col)
                           :value reduced-value})))

        query->expr (fn query->expr [query]
                      (let [terms (concat (if-not equality-only?
                                            (for [arg (:args (:value query))]
                                              (query->expr arg))
                                            ;; Error out early if we have any non-kwarg terms and we're equality-only
                                            ;; (this doesn't enforce security; we'll check other things later)
                                            (when (not-empty (:args (:value query)))
                                              (throw+ (general-tables-error (str "Invalid arguments: '" (pr-str (:args (:value query))) "'. View queries can only restrict column values by simple equality.")))))
                                          (for [[col-name-kw value] (:kwargs (:value query))]
                                            (value->expr (name col-name-kw) value)))]
                        (condp = (:type query)
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

                          (throw+ (general-tables-error (str "Invalid query operator: " (pr-str query)))))))

        built-expr (query->expr query)]

    (log/trace "Built search expression:\n" (with-out-str (pprint built-expr)))

    built-expr))

(defn- get-query-obj-and-modifiers [table-id view-query-obj equality-only? query-kwargs query-args]
  (let [[query-cols table-name] (ensure-table-access-ok-returning-cols-and-name table-id :search (get-cols-from-view-query view-query-obj))
        ;; NB the "ensure-table-access-ok..." call above filters out any
        ;; view columns from cols, so we won't overwrite any of the view
        ;; constraints. Security depends on this.

        cols-by-name (get-cols-by-name query-cols)

        view? (not-empty view-query-obj)

        get-col (fn [col-name]
                  (if-let [col (cols-by-name col-name)]
                    col
                    (throw+ (general-tables-error (str "No such column '" col-name "' in "
                                                       (when view? "this view of ")
                                                       "table '" table-name "'")))))

        ; Backwards compatibility with old query args - in case we have an old uplink connected.
        ; Once we're sure all uplinks are new, delete this.
        query-args (for [{type :type search-modifier :search_modifier :as arg} query-args]
                     (if (or (contains? query-operators type)
                               (contains? search-modifiers type))
                       arg
                       (cond
                         (= search-modifier "order_by")
                         {:type  "anvil.tables.order_by"
                          :value {:column_name (:order_by arg)
                                  :ascending   (:ascending arg)}}
                         (= search-modifier "page_size")
                         {:type "anvil.tables.query.page_size"
                          :value {:rows (:page_size arg)}}
                         :else
                         ;; This is definitely an invalid arg. Pass it through to be picked up below.
                         arg)))
        ;; </delete this>

        args (group-by (fn [{type :type :as arg}]
                         (cond
                           (contains? query-operators type)
                           :operators
                           (contains? search-modifiers type)
                           :modifiers
                           :else
                           (throw+ (general-tables-error (str "Invalid argument to table query: " (pr-str arg)))))) query-args)

        query (SerializedPythonObject. "anvil.tables.query.all_of"
                                       {:kwargs query-kwargs
                                        :args   (:operators args)}) ;; We don't actually trust that "query" is well-formed yet...

        query-obj (build-query-obj query get-col table-name equality-only?)

        query-obj (if view?
                      {:op "AND"
                       :terms [view-query-obj query-obj]}
                      query-obj)

        query-modifiers (for [{:keys [type value] :as modifier} (:modifiers args)]
                           (condp = type
                             "anvil.tables.order_by"
                             {:order_by (:id (get-col (:column_name value))) :ascending (boolean (:ascending value))}

                             "anvil.tables.query.page_size"
                             (if (and (number? (:rows value)) (pos? (:rows value)))
                               {:chunk_size (:rows value)}
                               (throw+ (general-tables-error (str "Page size must be a positive number."))))

                             (throw+ (general-tables-error (str "Invalid data tables search modifier: '" (pr-str modifier) "'")))))]

    (when view?
      (log/trace "Restricted search expression:\n" (with-out-str (pprint query-obj))))
    (log/trace "Search modifiers:\n" (with-out-str (pprint query-modifiers)))

    [query-cols query-obj query-modifiers]))

(defn- do-media-updates! [row-id table-id updates use-quota!]
  (reduce (fn [obj-ids [col-id [existing-oid media]]]
            (cond

              (and existing-oid
                     (not media))
              ; We are setting this field to None, and there is existing media. Delete it.
              (do
                (delete-media-in-cell table-id (name col-id) row-id use-quota!)
                (assoc obj-ids col-id nil))

              (not media)
              ;; We are setting this field to none, but there was no existing media. Nothing to see here, move along.
              obj-ids

              (when (instance? SerialisableForRpc media)
                (let [{:keys [type id manager]} (.serialiseForRpc ^SerialisableForRpc media nil)]
                  (and (some #{"LazyMedia"} type)
                       (= manager "table-media")
                       (= id (str existing-oid)))))
              ;; We're writing the same media back onto itself. No-op.
              obj-ids

              :else
              ; We are setting this field to something, so either create a media object or reuse the existing one.
              (let [new? (nil? existing-oid)
                    {existing-data-length :size has-lo? :has_lo} (when-not new?
                                                                   (first (jdbc/query (db) ["SELECT length(data) AS size, data IS NULL AS has_lo FROM app_storage_media WHERE object_id = ?" existing-oid])))
                    bytes-removed (if new?
                                    0
                                    (or existing-data-length (get-object-size existing-oid)))
                    media (cond
                            (satisfies? anvil.dispatcher.types/Media media)
                            media

                            (satisfies? anvil.dispatcher.types/ChunkedStream media)
                            (blocking-hacks/ChunkedStream->Media media)

                            (instance? anvil.dispatcher.types.LazyMedia media)
                            ;; TODO: Something better here. There's no guarantee what kind of thing (get-lazy-media) will return
                            ;;       It just so happens that all our current LazyMedia managers return BlobMedia (probably) so this will work for now.
                            (lazy-media/get-lazy-media rpc-util/*req* media)

                            :else
                            (throw (IllegalArgumentException. (str "'" (class media) "' object is neither Media, LazyMedia nor ChunkedStream"))))

                    in-stream ^InputStream (.getInputStream media)
                    out-stream (ByteArrayOutputStream.)
                    new-size (IOUtils/copy in-stream out-stream 4096)
                    new-data (.toByteArray out-stream)

                    final-oid (-> (if new?
                                    (jdbc/query (db) ["INSERT INTO app_storage_media (content_type, name, row_id, table_id, column_id, data) VALUES (?, ?, ?, ?, ?, ?) RETURNING object_id"
                                                         (.getContentType media) (.getName media) row-id table-id (name col-id) new-data])
                                    (jdbc/query (db) ["UPDATE app_storage_media SET content_type = ?, name = ?, data = ? WHERE object_id = ? RETURNING object_id"
                                                         (.getContentType media) (.getName media) new-data existing-oid]))
                                  (first)
                                  (:object_id))]
                (.close in-stream)
                (.close out-stream)

                (log/trace "Updating media in col" col-id "with" (if new? "new" "existing") "OID" existing-oid "has-lo?" has-lo?)

                (when has-lo?
                  (jdbc/query (db) ["SELECT lo_unlink(?)" existing-oid]))

                (use-quota! 0 (- new-size bytes-removed))

                (assoc obj-ids col-id final-oid))))
          {} updates))

(defn realise-media-in-kwargs [kwargs]
  (into {} (map (fn [[c v]]
                  (if (instance? ChunkedStream v)
                    [c (blocking-hacks/ChunkedStream->Media v)]
                    [c v])) kwargs)))

(defn- do-update! [[table-id row-id view-cols] kwargs]
  (let [kwargs (realise-media-in-kwargs kwargs)]
    (with-use-quota [use-quota! :repeatable-read]
      (try
        (let [auto-create-cols? (:auto_create_missing_columns (get-service-config))

              {current-value :data old-size-bytes :n_bytes}
              (or
                (first (jdbc/query (db) ["SELECT data, octet_length(data::text) as n_bytes from app_storage_data WHERE table_id = ? AND id = ? FOR UPDATE"
                                         table-id row-id]))
                (throw+ (general-tables-error "This row has been deleted")))

              [new-data cols media-updates] (prepare-update! (db) table-id current-value kwargs view-cols auto-create-cols?)
              new-data (merge new-data (do-media-updates! row-id table-id media-updates use-quota!))

              {new-size-bytes :n_bytes}
              (first (jdbc/query (db) ["UPDATE app_storage_data SET data = ?::jsonb WHERE table_id = ? AND id = ? RETURNING octet_length(data::text) as n_bytes"
                                       new-data table-id row-id]))]

          (log/debug (str "Tables v1 update of table " table-id " ADD " new-size-bytes " bytes, REMOVE " old-size-bytes " bytes"))
          (use-quota! 0 (- old-size-bytes))
          (use-quota! 0 new-size-bytes)

          (rpc-util/update-live-object-cache! "anvil.tables.Row" rpc-util/*live-object-id*
                                              (make-item-cache cols new-data nil nil))

          nil)
        (catch Exception e
          (log/debug (str "Row update failed on table " table-id " row " row-id))
          (throw e))))))

(defn- do-delete! [[table-id row-id view-cols] _kwargs]
  (ensure-table-access-ok-returning-cols (db) table-id :delete view-cols)
  (with-use-quota [use-quota! :serializable]
    (delete-media-in-row table-id row-id use-quota!)
    (let [[{bytes-deleted :n_bytes}] (jdbc/query (db) ["DELETE FROM app_storage_data WHERE table_id = ? AND id = ? RETURNING octet_length(data::text) as n_bytes" table-id row-id])]
      (log/debug (str "Tables v1 delete row from table " table-id " REMOVE " bytes-deleted " bytes"))
      (use-quota! -1 (- bytes-deleted))))
  (rpc-util/invalidate-live-object-cache! "anvil.tables.Row" rpc-util/*live-object-id*)
  nil)

(defn- do-delete-all! [[table-id view-query] _kwargs]
  (with-use-quota [use-quota! :serializable]
    (when-not (empty? view-query)
      (throw+ (general-tables-error "Cannot call delete_all_rows() on a view")))

    (ensure-table-access-ok-returning-cols-and-name table-id :delete-all (get-cols-from-view-query view-query))
    (delete-media-in-table table-id use-quota!)
    (let [deleted-rows (jdbc/query (db) ["DELETE FROM app_storage_data WHERE table_id = ? RETURNING octet_length(data::text) as n_bytes" table-id])
          bytes-deleted (reduce (fn [acc {row-bytes :n_bytes}] (+ acc row-bytes)) 0 deleted-rows)]
      (log/debug (str "Tables v1 truncate table " table-id " REMOVE " bytes-deleted " bytes"))
      (use-quota! (- (count deleted-rows)) (- bytes-deleted)))))

(defn- do-insert! [[table-id view-query] kwargs]
  ; Realise all media here, in case we have to repeat the transaction below.
  (util/timeit "Add row" [cp!]
    (let [kwargs (realise-media-in-kwargs kwargs)]
      (with-use-quota [use-quota! :serializable]
        (cp! "Using quota")
        (let [auto-create-cols? (:auto_create_missing_columns (get-service-config))

              [row-data cols media-updates] (prepare-update! (db) table-id {} kwargs (get-cols-from-view-query view-query) auto-create-cols?)
              media-object-ids (do-media-updates! nil table-id media-updates use-quota!)

              fixup-view-value (fn fixup-view-value [col-type value]
                                 (condp = col-type
                                   "liveObject"
                                   (if (= (:backend value) "anvil.tables.Row")
                                     ; We have to reinflate and then reduce Rows, or permissions etc will be lost.
                                     (reduced-val col-type
                                                  (types/mk-LiveObjectProxy "anvil.tables.Row" (:id value) [] (keys TRow)))

                                     (throw+ (general-tables-error "Can't add_row() on a view restricted by an arbitrary LiveObject"))) ;; Because we can't actually get the original object back from the view-query like we can with Rows.

                                   "liveObjectArray"
                                   (map (partial fixup-view-value "liveObject")
                                        value)

                                   value))

              ;; Finally, write the view-restricted values in on top
              get-view-data (fn get-view-data [view-query]
                              (when (not-empty view-query)
                                (condp = (:op view-query)
                                  "AND" (apply merge (map get-view-data (:terms view-query)))
                                  "EQ" (let [col (:col view-query)
                                             value (:value view-query)
                                             col-type (:type view-query)]
                                         {(keyword col) (fixup-view-value col-type value)})
                                  (throw+ (general-tables-error "Invalid view query object.")))))

              row-data (merge row-data media-object-ids (get-view-data view-query))
              _ (use-quota! 1 0)
              db-row (first (try (jdbc/query (db) ["INSERT INTO app_storage_data (table_id,data) VALUES (?,?::jsonb) RETURNING id, data, octet_length(data::text) as n_bytes"
                                                   table-id row-data])
                                 (catch Exception e
                                   (log/warn (str "Row insert failed on table " table-id " with new data of size " (try (count (json/write-str row-data)) (catch Exception _ :error))))
                                   (throw e))))
              new-row (mk-Row table-id cols (get-cols-from-view-query view-query) nil nil db-row)]

          (log/debug (str "Tables v1 insert into table " table-id " ADD " (:n_bytes db-row) " bytes"))
          (use-quota! 0 (:n_bytes db-row)) ;; TODO: If this fails, we won't revert the insert.

          ;; We didn't know the new row ID when we updated the media, so write that in now.
          (doseq [[col-id _] media-updates]
            (jdbc/execute! (db) ["UPDATE app_storage_media SET row_id = ? WHERE object_id = ?"
                                 (:id db-row) (get row-data col-id)]))
          new-row)))))

(def TRow* {"__anvil_iter_page__" (fn [[table-id row-id view-cols] _kwargs _page-id]
                                    (let [cols (ensure-table-access-ok-returning-cols (db) table-id :read-row
                                                                                      view-cols)]
                                      (if-let [r (:data (first (jdbc/query (db) ["SELECT data FROM app_storage_data WHERE table_id = ? AND id = ?" table-id row-id])))]
                                        {:items (for [[col-id {:keys [name] :as col}] cols]
                                                  [name (reinflate-val col (get r (keyword col-id)) nil nil)])}
                                        (throw+ (general-tables-error "This row has been deleted")))))

            "__getitem__"         (fn [[table-id row-id view-cols] _kwargs name]
                                    (let [cols (ensure-table-access-ok-returning-cols (db) table-id :read-row
                                                                                      view-cols)
                                          cbn (get-cols-by-name cols)
                                          col (get cbn name)
                                          _col-id (or (:id col) (throw+ (general-tables-error (str "No such column '" name "' in this " (if view-cols "view" "table")))))]
                                      (if-let [r (:data (first (jdbc/query (db) ["SELECT data FROM app_storage_data WHERE table_id = ? AND id = ?" table-id row-id])))]
                                        (let [item-cache (make-item-cache cols r nil nil)]
                                          (rpc-util/update-live-object-cache! "anvil.tables.Row" rpc-util/*live-object-id* item-cache)
                                          (get item-cache name))
                                        (throw+ (general-tables-error "This row has been deleted")))))


            ;; "set" maps to the same function
            "update"              #'do-update!

            "get_id"              (fn [[table-id row-id _view-cols] _kwargs]
                                    (util/write-json-str [table-id row-id]))


            "__setitem__"         (fn [ids _kwargs name value]
                                    ((TRow* "update") ids {name value}))

            "delete"              #'do-delete!})

;; Compatibility
(def TRow (assoc TRow* "set" (TRow* "update")))


(def Table {"add_row"                 #'do-insert!

            "__anvil_iter_page__"     (fn [_id _kwargs _page-id]
                                        (throw+ (general-tables-error "You can't iterate on a table. Call search() on this table to get an iterator of rows instead.")))

            "client_readable"         (fn [[table-id view-query] kwargs & args-that-should-not-be-supplied]
                                        (let [[_cols view-query-obj] (get-query-obj-and-modifiers table-id view-query true kwargs args-that-should-not-be-supplied)]
                                          (types/mk-LiveObjectProxy
                                            "anvil.tables.Table" (util/write-json-str [table-id view-query-obj]) ["cread"] (keys Table))))


            "client_writable"         (fn [[table-id view-query] kwargs & args-that-should-not-be-supplied]
                                        (ensure-table-access-ok-returning-cols-and-name table-id :create-writable-view (get-cols-from-view-query view-query))

                                        (let [[_cols view-query-obj] (get-query-obj-and-modifiers table-id view-query true kwargs args-that-should-not-be-supplied)]
                                          (types/mk-LiveObjectProxy
                                            "anvil.tables.Table" (util/write-json-str [table-id view-query-obj]) ["cwrite"] (keys Table))))


            "client_writable_cascade" (fn [[table-id view-query] kwargs & args-that-should-not-be-supplied]
                                        (when rpc-util/*client-request?*
                                          (throw+ (general-tables-error (str "Cannot create cascading writable view on the client."))))

                                        ;; This is the part that errors out if the table is read-only (or inaccessible) on the server
                                        (ensure-table-access-ok-returning-cols-and-name table-id :create-cascading-writable-view (get-cols-from-view-query view-query))

                                        (let [[_cols view-query-obj] (get-query-obj-and-modifiers table-id view-query true kwargs args-that-should-not-be-supplied)]
                                          (types/mk-LiveObjectProxy
                                            "anvil.tables.Table" (util/write-json-str [table-id view-query-obj]) ["cwrite" "cascade"] (keys Table))))


            "delete_all_rows"         #'do-delete-all!

            "get"                     (fn [[table-id view-query] kwargs & args]
                                        (let [[cols query-obj] (get-query-obj-and-modifiers table-id view-query false kwargs args)
                                              liveobject-id [table-id query-obj (get-cols-from-view-query view-query) cols [{:chunk_size 2}]]
                                              [first-item & more-items] (:items (iter-page liveobject-id {} nil))]
                                          (cond
                                            (nil? first-item)
                                            nil

                                            more-items
                                            (throw+ (general-tables-error "More than one row matched this query"))

                                            :else
                                            first-item)))

            "get_by_id"               (fn [[table-id view-query] _kwargs row-id-str]
                                        (let [[cols _table-name] (ensure-table-access-ok-returning-cols-and-name table-id :search (get-cols-from-view-query view-query))
                                              [row-tid row-id] (try (json/read-str row-id-str) (catch Exception _e))]
                                          (when (and row-id (= row-tid table-id))
                                            (let [[VIEW-QUERY-SQL view-query-params] (if (not-empty view-query)
                                                                                       (query->sql view-query)
                                                                                       ["TRUE" []])]
                                              (when-let [db-row (first (jdbc/query (db) (cons (str "SELECT * FROM app_storage_data WHERE table_id=? AND id=? AND " VIEW-QUERY-SQL)
                                                                                              (concat [table-id row-id] view-query-params))))]
                                                (mk-Row table-id cols (get-cols-from-view-query view-query) nil nil db-row))))))

            "has_row"                 (fn [[table-id view-query] _kwargs {:keys [backend id] :as _row}]
                                        (let [[row-tid row-id] (try (json/read-str id) (catch Exception _e))]
                                          (if (empty? view-query)
                                            ;; If this is a table, just return whether the row is in this table.
                                            (boolean (and (= "anvil.tables.Row" backend)
                                                          (= table-id row-tid)))

                                            ;; If this is a view, we have to query it to find out if the row is in there.
                                            (let [[VIEW-QUERY-SQL view-query-params] (query->sql view-query)]
                                              (boolean (first (jdbc/query (db) (cons (str "SELECT * FROM app_storage_data WHERE table_id=? AND id=? AND " VIEW-QUERY-SQL)
                                                                                     (concat [row-tid row-id] view-query-params)))))))))

            "list_columns"            (fn [[table-id view-query] _kwargs]
                                        (let [cols (->> (ensure-table-access-ok-returning-cols (db) table-id :search (get-cols-from-view-query view-query))
                                                        (sort-by (fn [[_id descr]] (:name descr)))
                                                        (sort-by (fn [[_id descr]] (get-in descr [:admin_ui :order]))))

                                              cs (for [[_id descr] cols]
                                                   (select-keys descr [:name :type]))]
                                          cs))

            "search"                  (fn [[table-id view-query] kwargs & args]
                                        (let [[cols query-obj query-modifiers] (get-query-obj-and-modifiers table-id view-query false kwargs args)
                                              liveobject-id [table-id query-obj (map keyword (get-cols-from-view-query view-query)) cols query-modifiers]]
                                          (types/mk-LiveObjectProxy "anvil.tables.SearchIterator" (util/write-json-str liveobject-id) rpc-util/*permissions* (keys TSearch)
                                                                    nil (iter-page liveobject-id {} nil))))

            "to_csv"                  (fn [[table-id view-query] {:keys [escape_for_excel]}]

                                        (let [view-cols (get-cols-from-view-query view-query)
                                              cols (ensure-table-access-ok-returning-cols (db) table-id :search view-cols)]

                                          (lazy-media/mk-LazyMedia-with-correct-mac {:manager   "query-csv", :id (util/write-json-str [table-id view-query view-cols cols escape_for_excel]),
                                                                                     :mime-type "text/csv", :name "download.csv"}
                                                                                    rpc-util/*req*)))})



(defn- wrap-native-fn [f]
  (rpc-util/wrap-native-fn #(tables-util/with-transform-err
                              (apply f %&))
                           :db-time))

(defn- add-sql-error-transformation-to-live-object-backend [method-map]
  (into {}
        (for [[name f] method-map]
          [name #(tables-util/with-transform-err
                   (apply f %&))])))


(defn- wrap-live-object-backend [method-map]
  (rpc-util/wrap-live-object-backend
    method-map
    :db-time))

;; Compatibility API for old versions of uplink
(defn- compat-unpack-table-id [lo]
  (when-not (and (instance? LiveObjectProxy lo) (= (:backend lo) "anvil.tables.Table"))
    (throw (Exception. "Invalid table API call")))
  (json/read-str (:id lo)))

(defn- wrap-tbl-fn [fn-name]
  (rpc-util/wrap-native-fn
    (fn [kwargs tbl & args]
      (apply (Table fn-name) (compat-unpack-table-id tbl) kwargs args))
    :db-time))

(defn- get-app-tables [_kwargs]
  (into {}
        (for [{:keys [table_id python_name]} (table-util/get-all-table-access-records nrpc-util/*environment*)]
          [python_name
           (types/mk-LiveObjectProxy "anvil.tables.Table" (util/write-json-str [table_id {}]) [] (keys Table))])))


(defn ensure-columns-exist! [table-id value-map]
  (prepare-update! (db) table-id {} value-map nil true))


(defn query-csv-lazy-media [TSearch-liveobject-id]
  (let [[table-id query-obj view-cols cols escape-for-excel?] (json/read-str TSearch-liveobject-id :key-fn keyword)
        environment rpc-util/*environment*]
    (binding [rpc-util/*client-request?* false]
      (ensure-table-access-ok-returning-cols (db) table-id :search view-cols)
      (let [name (:name (first (jdbc/query (db) ["SELECT name FROM app_storage_tables WHERE id=?" table-id])))
            name (str (.replaceAll ^String (or name "export") "[^A-Za-z0-9\\. ]" "") ".csv")
            app-id rpc-util/*app-id*]
        (reify
          MediaDescriptor
          (getName [_this] name)
          (getContentType [_this] "text/csv")
          Media
          (getLength [_this] 0)
          (getInputStream [_this]
            ;; We have to re-do the binding here, because this is likely to be called
            ;; from another thread.
            (binding [rpc-util/*app-id* app-id
                      rpc-util/*environment* environment]
              (export-as-csv table-id query-obj cols escape-for-excel?))))))))

(defn get-stored-media [object-id]
  (with-table-transaction
    (let [object-id (as-int object-id)
          media (first (jdbc/query (db) ["SELECT content_type, name, data from app_storage_media WHERE object_id = ?" object-id]))]
      (if (:data media)
        (BlobMedia. (:content_type media) (:data media) (:name media))
        (let [b (jdbc/db-query-with-resultset (db) ["SELECT ?" object-id]
                                              (fn [rs]
                                                (.next rs)
                                                (.getBlob rs 1)))
              b-stream (.getBinaryStream b)
              os (ByteArrayOutputStream.)]

          (io/copy b-stream os)
          (.close b-stream)
          (.free b)
          (BlobMedia. (:content_type media) (.toByteArray os) (:name media)))))))

(swap! lazy-media/managers assoc
       "query-csv" (rpc-util/wrap-lazy-media-server query-csv-lazy-media)
       "table-media" (rpc-util/wrap-lazy-media-server get-stored-media))

(def Table (add-sql-error-transformation-to-live-object-backend Table))
(def TRow (add-sql-error-transformation-to-live-object-backend TRow))
(def TSearch (add-sql-error-transformation-to-live-object-backend TSearch))

(def live-object-backends {"anvil.tables.Table" (wrap-live-object-backend Table)
                           "anvil.tables.Row" (wrap-live-object-backend TRow)
                           "anvil.tables.SearchIterator" (wrap-live-object-backend TSearch)})

(swap! dispatcher/native-live-object-backends merge live-object-backends)

(def rpc-handlers (into {"anvil.private.tables.get_app_tables" (wrap-native-fn get-app-tables)

                         "anvil.private.tables.open_transaction" (wrap-native-fn open-app-transaction!)
                         "anvil.private.tables.close_transaction" (wrap-native-fn close-app-transaction!)

                         ;; Compatibility for old versions of uplink
                         "anvil.private.tables.get_table_id"   (wrap-native-fn (fn [_kwargs python-name] (get (get-app-tables {}) python-name)))}
                        (for [fn-name ["search" "get_by_id" "add_row" "list_columns" "delete_all_rows"]]
                          [(str "anvil.private.tables." fn-name) (wrap-tbl-fn fn-name)])))

(swap! dispatcher/native-rpc-handlers merge rpc-handlers)
