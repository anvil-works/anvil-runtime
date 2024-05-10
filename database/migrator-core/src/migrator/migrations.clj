(ns migrator.migrations
  (:require [slingshot.slingshot :refer :all]
            [clojure.java.jdbc :as jdbc]
            [clojure.java.io :as io]
            [clojure.string :as str]
            digest)
  (:import (java.net JarURLConnection)
           (java.io File)
           (java.sql SQLException)))

(def all-migrations (atom {}))

(def schemas (atom {}))

(def ANVIL-USER (atom nil))

(defn add-migration! [migration-db-type version-tag migrate-fn]
  (swap! all-migrations update-in [migration-db-type] conj [version-tag migrate-fn]))

(defn list-resource-directory-files [path]
  (when-let [resource (io/resource path)]
    (condp = (.getProtocol resource)
      "file" (for [file (.listFiles (.getAbsoluteFile ^File (io/as-file resource)))]
               [(.getName file) file])
      "jar" (let [path (if (.endsWith path "/")
                         path
                         (str path "/"))]
              (map #(vector (.getName %)
                            (io/resource (.getName %)))
                   (filter #(let [name (.getName %)]
                              (and (.startsWith name path)
                                   (> (.length name) (.length path))))
                           (-> ^JarURLConnection (.openConnection resource)
                               (.getJarFile)
                               (.entries)
                               (enumeration-seq))))))))


(defn load-resource-migrations! []
  (doseq [[filename slurpable migration-db-type] (apply concat
                                                    (for [type [:base :dedicated :runtime :central :app-logs :accounting :data-tables :data-tables-central]]
                                                      (map #(conj % type) (list-resource-directory-files
                                                                            (str "migrations/" (name type))))))
          :let [[_ migration-name] (re-matches #"(?:.*/)?([^/\\]+).sql" filename)
                execute-fn (fn [db]
                             (let [sql (-> (slurp slurpable))
                                   sql (if @ANVIL-USER
                                         (-> sql
                                             (str/replace "$ANVIL_USER" @ANVIL-USER)
                                             (str/replace "$ANVIL_DATABASE" (:db (first (jdbc/query db ["SELECT current_database() AS db"])))))
                                         (.replaceAll sql "(?s)--\\[GRANTS\\]--.*--\\[/GRANTS\\]--" ""))]
                               (try
                                 (if-let [conn (jdbc/db-find-connection db)]
                                   (.execute (jdbc/prepare-statement conn sql))
                                   (with-open [conn (jdbc/get-connection db)]
                                     (.execute (jdbc/prepare-statement conn sql))))
                                 (catch SQLException e
                                   (println (format "Error while executing %s/%s:\n%s"
                                                    (name migration-db-type) migration-name e))
                                   (throw+ {:migrator.core/migration-failure :migration-failed})))))]
          :when migration-name]

    (if (= migration-name "schema")
      (swap! schemas assoc migration-db-type execute-fn)
      (add-migration! migration-db-type migration-name execute-fn))))


(defn is-db-empty? [db]
  (try
    (jdbc/query db ["SELECT 'Test for presence of table' FROM db_version LIMIT 1"])
    false
    (catch SQLException e
      (if (= "42P01" (.getSQLState e))
        true
        (throw e)))))


;; ------------------------------------------------
;; TODO migrate Clojure migrations into code that uses this as a library.

(defn denormalise-app-sessions [db]
  (jdbc/query db ["SELECT * FROM app_logs WHERE type = 'new_session' ORDER BY session"]
              {:fetch-size    10000
               :auto-commit?  false
               :result-set-fn (fn [rs]
                                (let [i (atom 0)]
                                  (jdbc/with-db-transaction [db db]
                                    (doseq [batch (partition 5000 5000 [] rs)]
                                      (jdbc/insert-multi! db :app_sessions
                                                          [:session_id :sha :start_time :app_id :app_version :anvil_version :debug :type :data]
                                                          (for [row batch]
                                                            [(:session row) (digest/sha-256 (str (:session row))) (:log_time row) (:app_id row) (:version (:data row)) (:anvil_version (:data row)) (:debug row) (:type (:data row)) (dissoc (:data row) :type :version :anvil_version)]))
                                      (swap! i inc)
                                      (when (zero? (mod @i 2)) (println "Migrated" (* 5000 @i) "sessions."))))))})
  (jdbc/execute! db ["DELETE FROM app_logs WHERE type = 'new_session'"]))

(add-migration! :central "2019-09-23-B-denormalise-app-sessions" denormalise-app-sessions)
