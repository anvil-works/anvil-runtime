(ns migrator.core
  (:require [clojure.java.jdbc :as jdbc]
            [clj-commons.slingshot :refer :all]
            [migrator.pg-json-handler]
            [migrator.migrations :as migrations])
  (:gen-class)
  (:import (java.sql SQLException)))

(defn maybe-create-db-version-table! [db]
  (jdbc/execute! db ["CREATE TABLE IF NOT EXISTS db_version (version text not null, updated timestamp)"]))

(defn get-migration-version [db]
  (maybe-create-db-version-table! db)
  (when @migrations/ANVIL-USER
    (jdbc/execute! db [(str "GRANT ALL ON db_version TO " @migrations/ANVIL-USER)]))
  (:version (first (jdbc/query db "SELECT * FROM db_version"))))

(defn set-migration-version! [db version]
  (maybe-create-db-version-table! db)
  (jdbc/execute! db ["DELETE FROM db_version"])
  (jdbc/execute! db ["INSERT INTO db_version (version, updated) VALUES (?,NOW())" version]))

(defn migrate!
  ([db-conf db-types grant-to-user]
   (migrate! db-conf db-types grant-to-user nil))

  ([db-conf db-types grant-to-user requested-version]
   (reset! migrations/ANVIL-USER grant-to-user)
   (migrations/load-resource-migrations!)

   (let [timeout (Integer/parseInt (or (System/getenv "ANVIL_DB_TIMEOUT") "10"))
         db-empty? (loop [n timeout]
                     (let [[db-empty? err] (try
                                             [(migrations/is-db-empty? db-conf) nil]
                                             (catch SQLException e
                                               (println "Connection to DB failed. Waiting 1s, then retrying migration...")
                                               (Thread/sleep 1000)
                                               [nil e]))]
                       (if-not err
                         db-empty?
                         (if (pos? n)
                           (recur (dec n))
                           (do
                             (println "DB connection failed for" timeout "seconds. Abandoning migration:")
                             (println (str err))
                             (throw+ {::migration-failure :connection-failed}))))))
         all-migrations (->> (vals @migrations/all-migrations)
                             (apply concat)
                             (sort-by first))
         db-types-migrations (->> (mapcat #(get @migrations/all-migrations %) db-types)
                                  (sort-by first))
         latest-version (or (first (last all-migrations)) "0000-00-00-initial")
         target-version (or requested-version latest-version)]

     (if (< (compare target-version migrations/snapshot-version) 0)
       (do
         (println "You requested" target-version "but I only support from" migrations/snapshot-version)
         (throw+ {::migration-failure :version-not-supported})))

     (if (> (compare target-version latest-version) 0)
       (do
         (println "You requested" target-version "but I only support up to" latest-version)
         (throw+ {::migration-failure :version-not-supported})))

     (if db-empty?
       (do
         (println "Database is uninitialised. Setting up Anvil database from scratch...")
         (doseq [db-type db-types]
           (if-let [apply-schema (get @migrations/snapshots db-type)]
             (do
               (apply-schema db-conf)
               (set-migration-version! db-conf migrations/snapshot-version))
             (do
               (println "No snapshot schema found for DB type" (pr-str (name db-type)))
               (throw+ {::migration-failure :no-schema}))))
         (println "Setup complete.")
         (println "Database now at" migrations/snapshot-version)))

     (do
       (println "Running Anvil Database Migrator for" (map name db-types) "DB.")
       #_(println "Found" (reduce + 0 (for [t db-types]
                                      (count (get @migrations/all-migrations t))))
                "migration(s) for" (map name db-types) "DB.")
       (try

         (jdbc/with-db-transaction [db db-conf]
           (let [current-version (get-migration-version db)]
             (cond
               (= current-version target-version)
               (println (str "Database is already up to date at version '" current-version"'"))

               (> (compare current-version target-version) 0)
               (do
                 (println (str "Database can't be migrated backwards (from " current-version " to " target-version ")"))
                 (throw+ {::migration-failure :downgrade-not-supported}))

               :else
               (do
                 (println "Migrating database from" current-version)
                 (println "                     to" target-version)
                 (let [migrations (->> db-types-migrations
                                       (filter (fn [[v _fn]] (and
                                                               (> (compare v current-version) 0)
                                                               (<= (compare v target-version) 0)))))]
                   (do
                     (println (count migrations) "migration(s) to perform.")
                     (doseq [[v migrate!] migrations]
                       (println "Executing" (pr-str v))
                       (migrate! db)
                       )))
                 (set-migration-version! db target-version)
                 (println "Migration complete.")
                 (println "Database now at" target-version)))))

         (catch SQLException e
           (println (str e))
           (throw+ {::migration-failure :other-db-error})))))))
