(ns migrator.core
  (:require [clojure.java.jdbc :as jdbc]
            [slingshot.slingshot :refer :all]
            [migrator.pg-json-handler]
            [migrator.migrations :as migrations])
  (:gen-class)
  (:import (java.sql SQLException)))


(defn get-migration-version [db]
  (jdbc/execute! db ["CREATE TABLE IF NOT EXISTS db_version (version text not null, updated timestamp)"])
  (when @migrations/ANVIL-USER
    (jdbc/execute! db [(str "GRANT ALL ON db_version TO " @migrations/ANVIL-USER)]))
  (:version (first (jdbc/query db "SELECT * FROM db_version"))))

(defn set-migration-version! [db version]
  (jdbc/execute! db ["DELETE FROM db_version"])
  (jdbc/execute! db ["INSERT INTO db_version (version, updated) VALUES (?,NOW())" version]))

(defn migrate! [db-conf db-types grant-to-user]
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
        all-migrations (->> (mapcat #(get @migrations/all-migrations %) db-types)
                            (sort-by first))
        latest-version (first (last all-migrations))]

    (if db-empty?
      (do
        (println "Database is uninitialised. Setting up Anvil database from scratch...")
        (doseq [db-type db-types]
          (if-let [apply-schema (get @migrations/schemas db-type)]
            (do
              (apply-schema db-conf)
              (set-migration-version! db-conf latest-version))
            (do
              (println "No schema found for DB type" (pr-str (name db-type)))
              (throw+ {::migration-failure :no-schema}))))
        (println "Setup complete.\nDatabase now at" (pr-str latest-version)))

      (do
        (println "Found" (reduce + 0 (for [t db-types]
                                       (count (get @migrations/all-migrations t))))
                 "migration(s) for" (map name db-types) "DB.")
        (println "Executing Anvil migrations...")
        (try

          (jdbc/with-db-transaction [db db-conf]
            (let [current-version (get-migration-version db)
                  migrations (->> all-migrations
                                  (filter (fn [[v _fn]] (> (compare v current-version) 0))))]
              (println "Database currently at" (pr-str current-version))
              (println (count migrations) "migration(s) to perform.")
              (doseq [[v migrate!] migrations]
                (println "Executing" (pr-str v))
                (migrate! db))
              (when latest-version
                (set-migration-version! db latest-version)
                (println "Database now at" (pr-str latest-version)))
              (println "Migration complete.")))
          (catch SQLException e
            (println (str e))
            (throw+ {::migration-failure :other-db-error})))))))
