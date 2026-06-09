(ns anvil.runtime.tables.split.manager
  (:require [slingshot.slingshot :refer :all]
            [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]
            [clojure.tools.logging :as log]
            [anvil.runtime.tables.split.sql :as sql]
            [anvil.runtime.tables.util :as tables-util]
            [clojure.set :as set]
            [anvil.runtime.tables.v2.table-types :as table-types]))

;; A place to contain all the SQL for generating and executing DDL against split-storage tables

(clj-logging-config.log4j/set-logger! :level :trace)

(defn- unresolved? [type]
  (or (= type "unresolved") (= type "unresolvedArray")))

(defn- choose-column-name [{:keys [columns] :as table-record} new-id-kw suggested-name]
  (let [existing-column-names (-> (set (for [[col-id-kw {:keys [sql_name]}] columns
                                             :when (and sql_name (not= col-id-kw new-id-kw))]
                                         sql_name))
                                  (conj "_id"))
        BASE-NAME (sql/SAFE-IDENTIFIER suggested-name)

        NEW-NAME (->> (cons BASE-NAME
                            (for [n (iterate inc 2)]
                              (str BASE-NAME "_" n)))
                      (remove existing-column-names)
                      (first))]
    (assoc-in table-record [:columns new-id-kw :sql_name] NEW-NAME)))

(defn create-table! [db-c table-record]
  (jdbc/execute! db-c [(str "CREATE TABLE " (sql/TABLE-NAME table-record) " (_id BIGSERIAL PRIMARY KEY)" (when-let [tablespace (get-in db-c [:anvil/pool-info :tablespace-for-split-tables])]
                                                                                                           (str " TABLESPACE " (sql/SANITISE tablespace))))]))

(defn delete-table! [db-c {:keys [columns] :as table-record} use-quota!]
  (doseq [[column-id-kw {:keys [type] :as column-spec}] columns
          :when (= type "liveObjectArray")]
    (jdbc/execute! db-c [(str "DROP TABLE " (sql/LINK-TABLE-NAME table-record column-id-kw) " CASCADE")]))
  (when use-quota!
    (util/with-long-query
      (when-let [{:keys [n_rows n_bytes]} (first (jdbc/query db-c [(str "SELECT COUNT(*) AS n_rows, SUM(pg_column_size(t.*)) AS n_bytes "
                                                                        " FROM " (sql/TABLE-NAME table-record) " AS t")]))]
        (use-quota! (- n_rows) (- (or n_bytes 0))))))
  (jdbc/execute! db-c [(str "DROP TABLE " (sql/TABLE-NAME table-record) " CASCADE")]))

(defn do-add-column! [db-c table-record column-id-kw]
  (let [{:keys [type name sql_name] :as column-spec} (get-in table-record [:columns column-id-kw])
        column-id (util/preserve-slashes column-id-kw)
        link-table (delay (tables-util/load-table-record db-c (:table_id column-spec)))
        table-record (choose-column-name table-record column-id-kw (or sql_name name))]
    (log/trace "Adding column" name "to split table" table-record)
    (cond
      (unresolved? type)
      nil
      (= type "liveObjectArray")
      (jdbc/execute! db-c [(str "CREATE TABLE " (sql/LINK-TABLE-NAME table-record column-id)
                                "(from_row BIGINT REFERENCES " (sql/TABLE-NAME table-record) "(_id) ON DELETE CASCADE DEFERRABLE, "
                                " to_row BIGINT " (when (:split (:storage @link-table))
                                                    (str "REFERENCES " (sql/TABLE-NAME @link-table) " ON DELETE CASCADE DEFERRABLE")) ", "
                                " idx INTEGER NOT NULL, "
                                " UNIQUE (from_row, idx, to_row))"
                                (when-let [tablespace (get-in db-c [:anvil/pool-info :tablespace-for-split-tables])]
                                  (str " TABLESPACE " (sql/SANITISE tablespace))))])

      :else
      ;; Else, it's a regular column
      (let [TYPE (sql/SQL-TYPE type)
            REFS (when (and (= type "liveObject") (:split (:storage @link-table)))
                   (str "REFERENCES " (sql/TABLE-NAME @link-table) " ON DELETE SET NULL DEFERRABLE"))]
        (jdbc/execute! db-c [(str "ALTER TABLE " (sql/TABLE-NAME table-record) " ADD COLUMN " (sql/COLUMN-NAME table-record column-id) " " TYPE " " REFS)])))
    table-record))

(defn do-remove-column! [db-c table-record column-id-kw]
  (let [column-id (util/preserve-slashes column-id-kw)
        {:keys [type] :as _column-spec} (get-in table-record [:columns column-id-kw])]
    (cond
      (unresolved? type)
      nil
      (= type "liveObjectArray")
      (jdbc/execute! db-c [(str "DROP TABLE " (sql/LINK-TABLE-NAME table-record column-id))])
      :else
      (jdbc/execute! db-c [(str "ALTER TABLE " (sql/TABLE-NAME table-record) " DROP COLUMN " (sql/COLUMN-NAME table-record column-id) " CASCADE")]))))

(defn do-rename-column! [db-c table-record column-id-kw old-col-spec]
  (let [column-id (util/preserve-slashes column-id-kw)
        {:keys [type name] :as column-spec} (get-in table-record [:columns column-id-kw])
        old-table-record (assoc-in table-record [:columns column-id-kw] old-col-spec)
        new-table-record (choose-column-name table-record column-id-kw name)]
    (cond
      (unresolved? type)
      nil
      (= type "liveObjectArray")
      (jdbc/execute! db-c [(str "ALTER TABLE " (sql/LINK-TABLE-NAME old-table-record column-id)
                                " RENAME TO " (->> (sql/LINK-TABLE-NAME new-table-record column-id)
                                                   (re-matches #".*\.(.*)")
                                                   (last)))])
      :else
      (jdbc/execute! db-c [(str "ALTER TABLE " (sql/TABLE-NAME old-table-record)
                                " RENAME COLUMN " (sql/COLUMN-NAME old-table-record column-id)
                                " TO " (sql/COLUMN-NAME new-table-record column-id))]))
    new-table-record))

(defn- get-index-changes-needed [db-c {:keys [all_indexes] :as table-record}]
  (let [TABLE-NAME (sql/TABLE-NAME table-record)
        INDEX-NAME-PREFIX (sql/INDEX-NAME-PREFIX table-record)
        EXISTING-INDEX-NAMES (->> (jdbc/query db-c [(str "SELECT indexrelid::regclass::text AS indexname"
                                                         " FROM pg_index WHERE indrelid=?::regclass OR indrelid::regclass::text like ?")
                                                    TABLE-NAME (str TABLE-NAME "_link_%")])
                                  (map :indexname)
                                  (filter #(.startsWith % (str "data_tables." INDEX-NAME-PREFIX "_midx_")))
                                  (set))
        required-indexes (for [{:keys [columns type]} all_indexes]
                           {:type type
                            :col-id-kws (map keyword columns)
                            :SQL-NAME (apply str INDEX-NAME-PREFIX "_midx_" (sql/SANITISE type) "_"
                                             (->> columns
                                                  (map sql/SANITISE)
                                                  (interpose "_")))})]
    ;(println "EXISTING" EXISTING-INDEX-NAMES)
    ;(println "REQUIRED" (set (map #(str "data_tables." (:SQL-NAME %)) required-indexes)))
    {:TO-REMOVE (set/difference EXISTING-INDEX-NAMES (set (map #(str "data_tables." (:SQL-NAME %)) required-indexes)))
     :to-create (for [{:keys [SQL-NAME] :as idx} required-indexes
                      :when (not (contains? EXISTING-INDEX-NAMES (str "data_tables." SQL-NAME)))]
                  idx)}))

(defn- GET-INDEX-EXPR [{:keys [columns] :as table-record} {:keys [type col-id-kws] :as index}]
  (let [column-types (doall (map #(->> %
                                       (get columns)
                                       (table-types/get-type-from-db-column)
                                      :type) col-id-kws))
        valid-index-types {"b_tree"    #{"string" "number" "date" "datetime" "bool" "link_single" "link_multiple"}
                           "trigram"   #{"string"}
                           "full_text" #{"string"}}
        COL-NAMES (map (partial sql/COLUMN-NAME table-record) col-id-kws)]

    (when-not (every? #(get-in valid-index-types [type %]) column-types)
      (throw (Exception. (format "Index type '%s' not valid for column types '%s'" type (pr-str column-types)))))

    (when (and (not= type "b_tree")
               (> (count col-id-kws) 1))
      (throw (Exception. (format "Index type '%s' not valid for multiple columns" type))))

    (if (contains? (set column-types) "link_multiple")
      (if (> (count col-id-kws) 1)
        (throw (Exception. (format "Indexes on link-to-multi columns cannot include other columns")))
        (str (sql/LINK-TABLE-NAME table-record (first col-id-kws)) " USING BTREE(to_row)")) ;; TODO: Work out how to properly index for ordering by idx

      (str (sql/TABLE-NAME table-record) " USING "
           (condp = type
             ;; We only support multiple columns for b-tree indexes.
             "b_tree" (str "BTREE(" (apply str (interpose "," COL-NAMES)) ")")
             "trigram" (str "GIN(" (first COL-NAMES) " GIN_TRGM_OPS)")
             "full_text" (str "GIN(TO_TSVECTOR('english', " (first COL-NAMES) "))"))))))

(defn update-indexes! [db-c table-record]
  (let [{:keys [TO-REMOVE to-create]} (get-index-changes-needed db-c table-record)]
    ;(util/next-console-color!)
    ;(println "TO REMOVE" TO-REMOVE)
    ;(println "TO CREATE" to-create)
    (util/with-really-long-query
      (doseq [INDEX-NAME TO-REMOVE]
        (jdbc/execute! db-c [(str "DROP INDEX CONCURRENTLY IF EXISTS " INDEX-NAME)] {:transaction? false}))
      (doseq [{:keys [SQL-NAME] :as index} to-create
              :let [INDEX-EXPR (GET-INDEX-EXPR table-record index)]]
        (jdbc/execute! db-c [(str "CREATE INDEX CONCURRENTLY IF NOT EXISTS " SQL-NAME " ON " INDEX-EXPR)] {:transaction? false})))))

