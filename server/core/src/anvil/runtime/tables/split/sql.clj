(ns anvil.runtime.tables.split.sql
  (:require [clojure.string :as string]
            [anvil.util :as util]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [anvil.runtime.tables.v2.sql-util :as sql-util]))

(defn SANITISE [^String input-string]
  (-> (string/replace input-string #"[^\p{Alpha}\p{Digit}_]" "_")
      (.toLowerCase)))

(defn SAFE-IDENTIFIER [^String input-string]
  (let [RESULT (SANITISE input-string)]
    (if-not (re-matches #"\p{Alpha}.*" RESULT)
      (str "_" RESULT)
      RESULT)))

(defn- COLUMN-NAME-UNQUOTED [{:keys [id columns] :as table-record} column-id]
  (SANITISE (or (get-in columns [(keyword column-id) :sql_name])
                (str "_" column-id))))

(defn COLUMN-NAME [table-record column-id]
  (str "\"" (COLUMN-NAME-UNQUOTED table-record column-id) "\""))

(defn TABLE-NAME [{:keys [id] :as table-record}]
  (str "data_tables.table_" (long id)))

(defn INDEX-NAME-PREFIX [{:keys [id] :as table-record}]
  (str "table_" (long id)))

(defn LINK-TABLE-NAME [{:keys [id] :as table-record} link-col-id]
  (str (TABLE-NAME table-record) "_link_" (COLUMN-NAME-UNQUOTED table-record (util/preserve-slashes link-col-id))))

(defn COMMA-SEPARATED [INPUTS]
  (apply str (interpose ", " INPUTS)))

(defn SQL-TYPE [type]
  (condp = type
    "string" "TEXT"
    "number" "DOUBLE PRECISION"
    "bool" "BOOLEAN"
    "date" "DATE"
    "datetime" "datetime_with_tz"
    "media" "media"
    "simpleObject" "JSONB"
    "liveObject" "BIGINT"
    "liveObjectArray" nil))

(defn- COMPAT-LINK [EXPR target-table-id]
  (str "CASE WHEN " EXPR " IS NULL THEN NULL ELSE"
       " jsonb_build_object('id', '[" (util/as-int target-table-id) ",' || (" EXPR ")::text || ']', 'backend', 'anvil.tables.Row')"
       " END"))

(defn TO-JSON-EXPR [{:keys [id] :as table-record} col-id {:keys [type table_id] :as type-map} compat-links? compat-datetimes?]
  (let [COLNAME (COLUMN-NAME table-record col-id)]
    (condp = type
      "string" COLNAME
      "number" COLNAME
      "bool" COLNAME
      "date" (str COLNAME "::text")
      "datetime" (if compat-datetimes?
                   (str "(REPLACE((" COLNAME ").utc::text, ' ', 'A') || (" COLNAME ").tz)")
                   (str "to_jsonb(" COLNAME ")"))
      "media" (str "CASE WHEN " COLNAME " IS NULL THEN NULL ELSE jsonb_build_object('content_type', (" COLNAME ").content_type, 'name', (" COLNAME ").name) END")
      "simpleObject" COLNAME
      "link_single" (if compat-links? (COMPAT-LINK COLNAME table_id) COLNAME)
      "link_multiple"
      (str "(SELECT COALESCE(jsonb_agg(" (if compat-links? (COMPAT-LINK "to_row" table_id) "to_row") " ORDER BY idx, to_row), '[]'::jsonb) "
           " FROM " (LINK-TABLE-NAME table-record col-id) " WHERE from_row=_id)")
      "unresolved" "NULL"
      "unresolvedArray" "'[]'::jsonb")))

(defn SELECT-ALL-COLUMNS-AS-JSON [{:keys [id columns] :as table-record} compat-links?]
  (let [cols (seq columns)
        SQL (str (sql-util/JSONB-BUILD-OBJECT
                   (for [[col-id {:keys [type] :as column-spec}] cols
                         :let [col-type (table-types/get-type-from-db-column column-spec)]]
                     (str "?, " (TO-JSON-EXPR table-record (util/preserve-slashes col-id) col-type compat-links? true)))))
        args (for [[col-id _] cols]
               (util/preserve-slashes col-id))]
    [SQL args]))

(defn VALUE-SQL
  ([{:keys [type] :as column-spec}]
   ;; This should return data with a number of ?s corresponding to the number of elements in the split branch of
   ;; (table-types/reduce-val-for-update). This is really ugly; I'd love to break that logic out to here, but there is a useful
   ;; utility function there that'd be annoying to put somewhere else and Clojure hates circular references.
   (condp = type
     "date" "?::date"
     "datetime" (str "CASE WHEN ? THEN ROW(?, ?)::datetime_with_tz ELSE NULL END")
     "media" (str "CASE WHEN ? THEN ROW(?, ?, ?)::media ELSE NULL END")
     "simpleObject" "?::jsonb"
     ;; else
     "?"))
  ([{:keys [id columns] :as table-record} col-id]
   (let [col-id-kw (keyword col-id)]
     (VALUE-SQL (get columns col-id-kw)))))

(defn empty-value [{:keys [type] :as column-spec}]
  (condp = type
    "datetime" [false nil nil]
    "media" [false nil nil nil]
    [nil]))