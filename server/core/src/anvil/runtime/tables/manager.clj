(ns anvil.runtime.tables.manager
  (:use [anvil.runtime.tables.util])
  (:require [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]))


(defn create-table! [app-id name python_name server-access client-access]
  (with-table-transaction
    (let [name (or name "New Table")
          python_name (or python_name name)

          python_name (.replaceAll (str python_name) "[^A-Za-z0-9_]" "")
          python_name (if-not (re-matches #"[A-Za-z_].*" python_name) (str "_" python_name) python_name)


          id (:id (first (jdbc/query util/db ["SELECT nextval('app_storage_tables_id_seq') AS id"])))
          _ (jdbc/execute! (db) ["INSERT INTO app_storage_tables (id, name,columns) VALUES (?,?,'{}'::jsonb)"
                                 id name])

          access (first (jdbc/query (db) ["INSERT INTO app_storage_access (table_id,app_id,python_name,server,client) VALUES (?, ?, ?,?,?) RETURNING *"
                                          id app-id python_name (or server-access "full") (or client-access "none")]))]
      {:id id, :name name, :access access})))
