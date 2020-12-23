(ns anvil.app-server.tables
  (:require [clojure.pprint :refer [pprint]]
            [anvil.util :as util]
            [clojure.java.jdbc :as jdbc]
            [clojure.tools.logging :as log]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.app-server.conf :as conf]
            [anvil.runtime.tables.manager :as tables-manager]
            [anvil.app-server.dispatch :as dispatch]))

(defn update-indexes-and-views! [table-id]
  (let [db (tables-util/db)
        table-name (:python_name (first (jdbc/query (tables-util/db) ["SELECT python_name FROM app_storage_access WHERE table_id = ?" table-id])))
        SQL-NAME (let [s (.replaceAll table-name "[^\\p{Alnum}]" "_")]
                   (if (= s "") "_" s))]
    (tables-util/update-col-indexes (tables-util/db) table-id)
    (tables-util/update-table-views! (tables-util/db) table-id)

    (jdbc/execute! (tables-util/db) ["CREATE SCHEMA IF NOT EXISTS app_tables"])
    (jdbc/execute! (tables-util/db) [(str "DROP VIEW IF EXISTS app_tables." SQL-NAME)])
    (jdbc/execute! (tables-util/db) [(str "CREATE VIEW app_tables." SQL-NAME " AS SELECT * FROM data_tables.table_" table-id)])))

(defn execute-app-tables-updates! [updates]
  (binding [tables-util/*environment-for-admin-call* (dispatch/get-default-environment)]
    (tables-util/with-table-transaction

      (doseq [update updates]

        (condp = (:action update)
          :CREATE_TABLES
          ; First create the required tables, keeping track of which IDs became which.
          (let [table-id-mappings (into {} (for [{:keys [id name] {:keys [python_name server client]} :access} (:tables update)
                                                 :let [{new-id :id} (tables-manager/create-table! {} name python_name server client)]]
                                             [id new-id]))]
            (log/debug "Table id mappings:" table-id-mappings)
            ; Now set the columns in those new tables, rewriting linked table IDs as appropriate.

            (doseq [{:keys [id columns]} (:tables update)]
              (let [new-table-id (get table-id-mappings id)
                    new-cols (into {} (map (fn [[col-id {:keys [table_id] :as col-spec}]]
                                             [col-id (merge col-spec
                                                            (when table_id
                                                              {:table_id (get table-id-mappings table_id)}))]) columns))]
                (log/debug new-table-id new-cols)
                (jdbc/execute! (tables-util/db) ["UPDATE app_storage_tables SET columns=?::jsonb WHERE id = ?" new-cols new-table-id])
                (update-indexes-and-views! new-table-id))))

          :DELETE_TABLE
          (let [python-name (:python_name update)
                table-id (:table_id (first (jdbc/query (tables-util/db) ["DELETE FROM app_storage_access WHERE python_name = ? RETURNING table_id" python-name])))]
            (log/debug (str "Deleting table " table-id " ('" python-name "')"))
            (tables-util/update-col-indexes nil table-id {})
            (tables-manager/delete-table-content! (tables-util/db) table-id (constantly nil)))

          :UPDATE_TABLE
          (let [{:keys [client_access server_access name python_name table-id]} update]
            (log/debug "Updating table " table-id)
            (jdbc/execute! (tables-util/db) ["UPDATE app_storage_tables SET name = ? WHERE id = ?" name table-id])
            (jdbc/execute! (tables-util/db) ["UPDATE app_storage_access SET server = ?, client = ?, python_name = ? WHERE table_id = ?" server_access client_access python_name table-id])
            (update-indexes-and-views! table-id))

          :ADD_COLUMN
          (let [table-id (:table_id update)
                old-cols (tables-util/get-cols table-id)
                new-cols (assoc old-cols (:column_id update) (:spec update))]
            (log/debug "Adding column to table" table-id)
            (tables-util/update-cols-returning table-id new-cols old-cols)
            (update-indexes-and-views! table-id))

          :DELETE_COLUMN
          (let [table-id (:table_id update)
                old-cols (tables-util/get-cols table-id)
                new-cols (dissoc old-cols (:column_id update))]
            (log/debug "Deleting column from table" (:table_id update))
            (tables-util/update-cols-returning table-id new-cols old-cols)
            (update-indexes-and-views! table-id))

          :RENAME_COLUMN
          (let [table-id (:table_id update)
                old-cols (tables-util/get-cols table-id)
                new-cols (assoc-in old-cols [(:column_id update) :name] (:new_name update))]
            (log/debug "Renaming column in table" (:table_id update))
            (tables-util/update-cols-returning table-id new-cols old-cols)
            (update-indexes-and-views! table-id)))))))

(defn validate-app-tables-schema [schema-tables main-app-id auto-migrate? ignore-invalid?]
  (if-not schema-tables
    (log/warn "This app does not have a 'db_schema' configuration, so we are not setting up the database.")

    ; Find all the tables that don't exist in the DB. Create them.
    (let [database-tables (into {}
                                (for [row (jdbc/query util/db ["SELECT * FROM app_storage_access NATURAL JOIN app_storage_tables"])]
                                  [(:table_id row) row]))

          _ (log/debug "App expects tables:" (map :python_name schema-tables))
          _ (log/debug "Database contains tables:" (map #(:python_name (second %)) database-tables))

          auto-migrate? (or auto-migrate? (empty? database-tables))
          tables-to-create (reduce (fn [tables-to-create schema-table]
                                     ; Does this table exist in the DB?
                                     (if (first (jdbc/query util/db ["SELECT * FROM app_storage_access WHERE python_name = ?" (:python_name schema-table)]))
                                       tables-to-create
                                       (conj tables-to-create schema-table))
                                     ) [] schema-tables)

          updates (if (not-empty tables-to-create)
                    [{:action :CREATE_TABLES
                      :tables tables-to-create}]
                    [])

          ; For all the tables that do exist in the DB, but have the wrong columns, modify them to have the right columns.
          ; Also check client/server access in this pass.

          updates (reduce (fn [updates schema-table]
                            (if-let [db-table (first (jdbc/query util/db ["SELECT * FROM app_storage_access JOIN app_storage_tables ON (table_id = id) WHERE python_name = ?" (:python_name schema-table)]))]
                              ; Matching columns by name, as this is what matters to the source code.
                              (let [required-columns-by-name (into {} (for [[col-id {:keys [name]}] (:columns schema-table)] [name col-id]))
                                    found-columns-by-name (into {} (for [[col-id {:keys [name]}] (:columns db-table)] [name col-id]))

                                    [to-keep to-add to-rename] (reduce (fn [[to-keep to-add to-rename] [col-name col-id]]
                                                                         (let [required-column-spec (get (:columns schema-table) col-id)]

                                                                           (if-let [exact-match-id (some (fn [[found-col-id found-col-spec]]
                                                                                                           (when (= (select-keys found-col-spec [:name :type :backend]) ;; TODO: In the case of a link, check that it references a table with the same python_name
                                                                                                                    (select-keys required-column-spec [:name :type :backend]))
                                                                                                             found-col-id))
                                                                                                         (:columns db-table))]
                                                                             ; We found the column we're looking for. Keep it.
                                                                             [(conj to-keep exact-match-id) to-add to-rename]

                                                                             (if-let [partial-match-id (some (fn [[found-col-id found-col-spec]]
                                                                                                               (when (and
                                                                                                                       (= found-col-id col-id)
                                                                                                                       (= (select-keys found-col-spec [:type :backend]) ;; TODO: In the case of a link, check that it references a table with the same python_name
                                                                                                                          (select-keys required-column-spec [:type :backend])))
                                                                                                                 found-col-id))
                                                                                                             (:columns db-table))]
                                                                               ; We found a column with the same ID as the one we're looking for, and identical in all other ways except name. This is probably a rename.
                                                                               [to-keep to-add (assoc to-rename partial-match-id col-name)]

                                                                               ; We didn't find anything resembling the column we're looking for. Add it.
                                                                               [to-keep (assoc to-add col-id required-column-spec) to-rename]))))
                                                                       [#{} {} {}]
                                                                       required-columns-by-name)

                                    to-remove (reduce (fn [to-remove [_col-name col-id]]
                                                        ; Remove any column that is not being kept or renamed.
                                                        (if-not (or (contains? to-keep col-id)
                                                                    (contains? to-rename col-id))
                                                          (conj to-remove col-id)
                                                          to-remove))
                                                      #{}
                                                      found-columns-by-name)

                                    old-table-info {:client_access (:client db-table)
                                                    :server_access (:server db-table)
                                                    :name          (:name db-table)
                                                    :python_name   (:python_name db-table)}

                                    new-table-info {:client_access (get-in schema-table [:access :client])
                                                    :server_access (get-in schema-table [:access :server])
                                                    :name          (:name schema-table)
                                                    :python_name   (get-in schema-table [:access :python_name])}

                                    describe-column (fn [tables [col-id {:keys [type _backend table_id] n :name}]]
                                                      (format "%s: %s    (%s)"
                                                              n
                                                              (if (#{"liveObject" "liveObjectArray"} type)
                                                                (format "%s from table #%s(%s)"
                                                                        (if (= type "liveObject") "row" "multiple rows")
                                                                        table_id
                                                                        (or (get-in tables [table_id :python_name])
                                                                            (get-in tables [table_id :access :python_name])))
                                                                type)
                                                              (name col-id)))]
                                (log/trace (str "Checking columns in db table " (:id db-table) " (" (:name db-table) ")"))
                                (log/trace "To add: " to-add)
                                (log/trace "To remove: " to-remove)
                                (log/trace "To rename:" to-rename)
                                (log/trace "To keep:" to-keep)

                                (when (or (seq to-add) (seq to-remove) (seq to-rename))
                                  (log/info (format "Table '%s' exists in this database, but with a different schema.\nApp expects columns:\n  %s\nDatabase has columns:\n  %s"
                                                    (:name db-table)
                                                    (apply str (interpose "\n  " (map #(describe-column schema-tables %) (:columns schema-table))))
                                                    (apply str (interpose "\n  " (map #(describe-column database-tables %) (:columns db-table)))))))

                                (-> updates
                                    (concat (when (not= old-table-info new-table-info)
                                              [(assoc new-table-info :action :UPDATE_TABLE :table-id (:id db-table))]))
                                    (concat (map (fn [[col-id col-spec]] {:action     :ADD_COLUMN
                                                                          :table_name (:python_name new-table-info)
                                                                          :table_id   (:id db-table)
                                                                          :column_id  col-id
                                                                          :spec       col-spec}) to-add))

                                    (concat (map (fn [col-id] {:action      :DELETE_COLUMN
                                                               :table_name  (:python_name db-table)
                                                               :column_name (get-in db-table [:columns col-id :name])
                                                               :table_id    (:id db-table)
                                                               :column_id   col-id}) to-remove))

                                    (concat (map (fn [[col-id new-name]] {:action     :RENAME_COLUMN
                                                                          :table_name (:python_name db-table)
                                                                          :table_id   (:id db-table)
                                                                          :column_id  col-id
                                                                          :old_name   (get-in schema-table [:columns col-id :name])
                                                                          :new_name   new-name}) to-rename))))

                              ; Else the table isn't already in the DB, so we don't have to do anything to any columns.
                              updates))
                          updates schema-tables)

          ; For all the tables that are in the DB, but not the schema, drop them.
          updates (reduce (fn [updates db-table]
                            (if (first (filter #(= (:python_name %) (:python_name db-table)) schema-tables))
                              updates
                              (conj updates {:action      :DELETE_TABLE
                                             :python_name (:python_name db-table)})))
                          updates
                          (jdbc/query util/db ["SELECT * FROM app_storage_access"]))]


      (when (not-empty updates)
        (if (and auto-migrate?
                 (not ignore-invalid?))
          (do
            (log/info "Migrating automatically.")
            (execute-app-tables-updates! updates))
          (do
            (log/info "Data tables schema out of date. Here is the migration that will run if you restart Anvil with the --auto-migrate command-line flag:")
            (log/info (with-out-str (pprint updates)))
            (if ignore-invalid?
              (do
                (log/info "Ignoring invalid data tables schema."))
              (do
                (log/info "Anvil will now exit. Run with --ignore-invalid-schema to startup anyway, or --auto-migrate to apply the changes above.")
                (System/exit 1)))))))))


(tables-util/set-table-hooks! {:mutate-db-for-mapping? (fn [mapping] true)})