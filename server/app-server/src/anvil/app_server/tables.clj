(ns anvil.app-server.tables
  (:require [clojure.pprint :refer [pprint]]
            [anvil.util :as util]
            [clojure.java.jdbc :as jdbc]
            [clojure.tools.logging :as log]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.runtime.tables.schema :as schema]
            [anvil.app-server.conf :as conf]
            [anvil.runtime.tables.manager :as tables-manager]
            [anvil.app-server.dispatch :as dispatch]
            [clojure.pprint :as pprint]))

;;(clj-logging-config.log4j/set-logger! :level :trace)
(defn- pps [o] (with-out-str (pprint o)))

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



(defn validate-app-tables-schema [desired-schema schema-hints main-app-id auto-migrate? ignore-invalid?]
  (cond
    (not desired-schema)
    (log/warn "This app does not have a 'db_schema' configuration, so we are not setting up the database.")

    :else
    ; Find all the tables that don't exist in the DB. Create them.
    (let [desired-schema (if (map? desired-schema) desired-schema (schema/yaml-schema-from-old-yaml-schema desired-schema))

          current-tables (jdbc/query util/db ["SELECT * FROM app_storage_access JOIN app_storage_tables ON table_id=id"])

          _ (log/trace (pps current-tables))

          current-schema (schema/yaml-schema-from-table-mapping-description current-tables)

          _ (log/debug "App expects tables:" (keys desired-schema))
          _ (log/debug "Database contains tables:" (keys current-schema))

          _ (log/trace "Expected schema:\n" (pps desired-schema))
          _ (log/trace "Current schema:\n" (pps current-schema))

          updates (schema/diff-schema current-schema desired-schema schema-hints)

          auto-migrate? (or auto-migrate? (empty? current-tables))]

      (when (not-empty updates)
        (if (or (= {} current-schema)
                (and auto-migrate?
                     (not ignore-invalid?)))
          (do
            (log/info "Data tables schema out of date. Applying migrations:\n" (with-out-str (pprint updates)))
            (log/info "Migrating automatically...")
            (binding [tables-util/*environment-for-admin-call* {}]
              (schema/apply-changes! {} current-tables updates))
            (log/info "Migration complete."))
          (do
            (log/info "Data tables schema out of date. Here is the migration that will run if you restart Anvil with the --auto-migrate command-line flag:")
            (log/info (with-out-str (pprint updates)))
            (if ignore-invalid?
              (do
                (log/info "Ignoring non-matching data tables schema."))
              (do
                (log/info "Anvil will now exit. Run with --ignore-invalid-schema to startup anyway, or --auto-migrate to apply the changes above.")
                (System/exit 1)))))))))


(tables-util/set-table-hooks! {:mutate-db-for-mapping? (fn [mapping] true)})