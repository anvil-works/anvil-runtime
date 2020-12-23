(ns anvil.runtime.tables.manager
  (:require [anvil.runtime.tables.util :as table-util :refer [db]])
  (:require [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]))


(defn create-table! [table-mapping name python_name server-access client-access]
  (table-util/with-table-transaction
    (let [name (or name "New Table")
          python_name (or python_name name)

          python_name (.replaceAll (str python_name) "[^A-Za-z0-9_]" "")
          python_name (if-not (re-matches #"[A-Za-z_].*" python_name) (str "_" python_name) python_name)


          id (:id (first (jdbc/query util/db ["SELECT nextval('app_storage_tables_id_seq') AS id"])))
          _ (jdbc/execute! (db) ["INSERT INTO app_storage_tables (id, name,columns) VALUES (?,?,'{}'::jsonb)"
                                 id name])
          access (assoc (select-keys table-mapping (if (:table_mapping_id table-mapping)
                                                     [:table_mapping_id] [:app_id]))
                   :table_id id
                   :python_name python_name
                   :server (or server-access "full")
                   :client (or client-access "none"))]
      (jdbc/insert! (db) "app_storage_access" access)
      {:id id, :name name,
       :access access})))

(defn delete-table-content! [db-c table-id use-quota!]
  (table-util/delete-media-in-table table-id use-quota!)
  (let [deleted-row-count (first (jdbc/execute! db-c ["DELETE FROM app_storage_data WHERE table_id = ?" table-id]))]
    (use-quota! (- deleted-row-count) 0))
  (jdbc/execute! db-c ["DELETE FROM app_storage_tables WHERE id = ?" table-id])
  (table-util/drop-view! db-c table-id))

(defn delete-table-access!
  ([mapping table-id] (delete-table-access! (table-util/db-for-mapping mapping) mapping table-id))
  ([db-c mapping table-id]
   ;; Drop access to a table, and the whole table if it's safe to do so
   (when (table-util/delete-table-access-record! db-c mapping table-id)
     (binding [table-util/*current-db-transaction* db-c]
       ;; Ew.
       (table-util/with-use-quota [use-quota!]
         (delete-table-content! db-c table-id use-quota!)))
     true)))
