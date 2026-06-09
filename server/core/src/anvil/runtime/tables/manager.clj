(ns anvil.runtime.tables.manager
  (:require [anvil.runtime.tables.util :as tables-util :refer [db]]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [clojure.java.jdbc :as jdbc]
            [clojure.set :as set]
            [slingshot.slingshot :refer :all]
            [medley.core :refer [indexed]]
            [anvil.util :as util]
            [anvil.runtime.tables.split.manager :as split-table-manager]
            [anvil.core.worker-pool :as worker-pool]
            [clojure.tools.logging :as log]
            [anvil.core.validation :as validation]
            [clojure.string :as string]))

;(clj-logging-config.log4j/set-logger! :level :trace)
#_(defn- delete-media-in-column [table-id col-id use-quota!]
  (let [affected-media (jdbc/query (db) ["DELETE FROM app_storage_media WHERE table_id = ? AND column_id = ? RETURNING object_id, (data is null) as has_lo, length(data) AS len" table-id (util/preserve-slashes  col-id)])]
    (delete-media-objects (->> affected-media
                               (filter :has_lo)
                               (map :object_id)) use-quota!)
    (when use-quota! (use-quota! 0 (- (->> affected-media (filter :len) (map :len) (reduce + 0)))))))

(def BASIC-COLUMN-TYPES #{"string" "number" "bool" "date" "datetime" "media" "simpleObject" "link_single"})
(def COLSPEC-COLUMN-TYPES (conj BASIC-COLUMN-TYPES "liveObject" "liveObjectArray" "unresolved" "unresolvedArray"))

(declare update-col-indexes!)
(defn validate-colspec! [col-spec]
  (validation/check-keys! {:name string?
                           :type COLSPEC-COLUMN-TYPES
                           :backend #{"anvil.tables.Row"}
                           :table_id int?
                           :admin_ui (constantly true)
                           :client_hidden boolean?
                           :init (constantly true)
                           :sql_name string?
                           :indexes [{:type #{"b_tree" "trigram" "full_text" "gin"}}]}
                          col-spec))

(defn create-table! [table-mapping storage name python_name server-access client-access]
  (tables-util/with-table-transaction
    (let [name (or name "New Table")
          python_name (or python_name name)

          python_name (.replaceAll (str python_name) "[^A-Za-z0-9_]" "")
          python_name (if-not (re-matches #"[A-Za-z_].*" python_name) (str "_" python_name) python_name)


          id (:id (first (jdbc/query util/db ["SELECT nextval('app_storage_tables_id_seq') AS id"])))
          [table-record] (jdbc/query (db) ["INSERT INTO app_storage_tables (id, name,columns, storage) VALUES (?,?,'{}'::jsonb,?::jsonb) RETURNING *"
                                           id name storage])
          access (assoc (select-keys table-mapping (if (:table_mapping_id table-mapping)
                                                     [:table_mapping_id] [:app_id]))
                   :table_id id
                   :python_name python_name
                   :server (or server-access "full")
                   :client (or client-access "none"))]
      (jdbc/insert! (db) "app_storage_access" access)
      (when (:split storage)
        (split-table-manager/create-table! (db) table-record))
      (tables-util/update-table-views! (db) table-record)
      {:id id, :name name,
       :access access})))

(defn rename-table! [table-id new-name]
  (first
    (jdbc/query (db) ["UPDATE app_storage_tables SET name = ? WHERE id = ? RETURNING *"
                      new-name table-id])))

(defn- delete-table-after-all-access-removed! [db-c {:keys [id storage] :as table-record} use-quota!]
  (tables-util/drop-view! db-c table-record)
  (if (:split storage)
    (split-table-manager/delete-table! db-c table-record use-quota!)
    (do
      (tables-util/delete-media-in-table db-c id use-quota!)
      (let [deleted-row-count (first (jdbc/execute! db-c ["DELETE FROM app_storage_data WHERE table_id = ?" id]))]
        (use-quota! (- deleted-row-count) 0))))
  (jdbc/execute! db-c ["DELETE FROM app_storage_tables WHERE id = ?" id]))


(defn delete-table-access!
  ([mapping table-record] (delete-table-access! (tables-util/db-for-mapping mapping) mapping table-record))
  ([db-c mapping {:keys [id storage] :as table-record}]
   ;; Drop access to a table, and the whole table if it's not used anywhere else.
   (util/with-db-transaction [db-c db-c :repeatable-read]
     (when (tables-util/delete-table-access-record! db-c mapping id)
       (tables-util/with-use-quota [use-quota!]
         (delete-table-after-all-access-removed! db-c table-record use-quota!))
       true))))

(defn- update-data-after-column-change!
  "This function exists to do slow asynchronous updates (creating indexes, filling out nulls in a combined storage).
  It must be called outside a transaction."
  [{table-id :id :keys [columns storage] :as table-record} added-col-ids init-new-columns?]
  (let [update-all-added-cols (fn [columns update-fn & args]
                                (-> (fn [columns col-id]
                                      (assert (keyword? col-id) "col-id must be a keyword")
                                      (log/trace "Updating" col-id "in" columns)
                                      (apply update columns col-id update-fn args))
                                    (reduce columns added-col-ids)))]
    (worker-pool/with-expanding-threadpool-when-slow
      (try
        (update-col-indexes! (db) table-record)
        (when (and init-new-columns? (seq added-col-ids) (not (:split storage)))
          (tables-util/update-columns-vals! (db) table-id update-all-added-cols
                                            assoc-in [:init :started] (System/currentTimeMillis))
          ;; Wait for (get-tables) cache to empty. By the time this finishes, we can guarantee that anyone else
          ;; writing to this table is putting nulls into our new columns, so anything that happens after our UPDATE
          ;; below will still be correct
          (Thread/sleep 500)

          (let [new-col-values (into {} (for [col-id added-col-ids
                                              :let [col-type (get-in columns [col-id :type])]]
                                          [col-id (if (= col-type "bool") false nil)]))]
            (tables-util/with-table-transaction
              (jdbc/execute! (db) ["UPDATE app_storage_data SET data = ?::jsonb || data WHERE table_id = ?"
                                   new-col-values table-id])
              (tables-util/update-columns-vals! (db) table-id update-all-added-cols
                                                assoc-in [:init :completed] (System/currentTimeMillis)))))
        (catch Throwable e
          (log/info e "Failed to initialise columns for table" table-id ":")
          (tables-util/update-columns-vals! (db) table-id update-all-added-cols
                                            assoc-in [:init :failed] {:time (System/currentTimeMillis) :error (str e)}))))))

(defn table-create-columns! [db-c table-id col-specs init-new-columns?]
  (log/trace "Creating columns for table " table-id ": " col-specs)
  (doseq [col-spec col-specs]
    (validate-colspec! col-spec))
  (let [new-cols (for [col-spec col-specs]
                   [(keyword (tables-util/gen-new-id 9)) col-spec])
        new-col-ids (map first new-cols)
        table-record
        (util/with-db-transaction [db-c db-c :repeatable-read]
          (let [{:keys [storage] :as table-record} (tables-util/load-table-record db-c table-id)
                order-start (inc (apply max 0 (for [[idkw {:keys [admin_ui]}] (:columns table-record)
                                                    :when (:order admin_ui)]
                                                (:order admin_ui))))
                new-cols-with-order (for [[idx [idkw col-spec]] (indexed new-cols)]
                                      [idkw (update-in col-spec [:admin_ui :order] #(or % (+ order-start idx)))])
                table-record (update table-record :columns into new-cols-with-order)

                table-record
                (if (:split storage)
                  (reduce (fn [table-record col-id-kw]
                            (split-table-manager/do-add-column! db-c table-record col-id-kw))
                          table-record
                          new-col-ids)
                  table-record)]
            (tables-util/save-table-record! db-c table-record)
            (tables-util/update-table-views! db-c table-record)
            table-record))

        new-cols (for [col-id-kw new-col-ids]
                   [col-id-kw (get-in table-record [:columns col-id-kw])])

        environment (tables-util/current-environment)]

    (util/call-when-committed
      db-c (fn []
             (worker-pool/run-task! ::init-new-columns
               (binding [tables-util/*environment-for-admin-call* environment]
                 (update-data-after-column-change! table-record new-col-ids init-new-columns?)))))

    new-cols))

(defn table-update-column! [db-c table-id col-id-kw {:keys [name client_hidden admin_ui indexes] :as col-spec-update}]
  (let [[table-record reindexed?]
        (util/with-db-transaction [db-c db-c :repeatable-read]
          (let [{:keys [storage] :as table-record} (tables-util/load-table-record db-c table-id)
                old-col (get-in table-record [:columns col-id-kw])
                _ (when-not old-col
                    (throw+ {:anvil/server-error (format "No column with ID %s in %s"
                                                         (util/preserve-slashes col-id-kw) (:name table-record))}))
                new-col (merge old-col col-spec-update)
                table-record (assoc-in table-record [:columns col-id-kw] new-col)
                renamed? (not= (:name old-col) (:name new-col))
                reindexed? (not= (:indexes old-col) (:indexes new-col))
                table-record (if (and (:split storage) renamed?)
                               (split-table-manager/do-rename-column! db-c table-record col-id-kw old-col)
                               table-record)
                table-record (tables-util/normalise-indexes table-record)]
            (tables-util/save-table-record! db-c table-record)
            (tables-util/update-table-views! db-c table-record)
            [table-record reindexed?]))]

    (when reindexed?
      (update-data-after-column-change! table-record nil false))
    table-record))

(defn table-resolve-column! [db-c table-id col-id-kw type-map]
  (util/with-db-transaction [db-c db-c :repeatable-read]

    ;;_ (log/trace "RESOLVING COLUMN:" col-id columns unresolved-type new-type)
    (let [{:keys [storage columns] :as table-record} (tables-util/load-table-record db-c table-id)
          unresolved-type (get-in columns [col-id-kw :type])
          _ (when-not (#{"unresolved" "unresolvedArray"} unresolved-type)
              (throw (Exception. (str "Attempted to resolve a column of type " (pr-str unresolved-type)))))
          table-record (update-in table-record [:columns col-id-kw] merge (table-types/make-db-column-from-type type-map))
          table-record (if (:split storage)
                         (split-table-manager/do-add-column! db-c table-record col-id-kw)
                         table-record)]
      (tables-util/save-table-record! db-c table-record))))

(defn table-delete-column! [db-c table-id col-id-kw]
  (util/with-db-transaction [db-c db-c]
    (let [{:keys [storage] :as old-table-record} (tables-util/load-table-record db-c table-id)
          table-record (update-in old-table-record [:columns] dissoc col-id-kw)]
      (when (:split storage)
        (split-table-manager/do-remove-column! db-c old-table-record col-id-kw))
      (tables-util/update-table-views! db-c table-record)
      (tables-util/save-table-record! db-c table-record))))

(defn table-create-index! [db-c {:keys [columns storage] :as old-table-record} index]
  (util/with-db-transaction [db-c db-c]
    (let [index (select-keys index [:type :columns])
          table-id (:id old-table-record)]

      (when-not (contains? #{"b_tree" "trigram" "full_text"} (:type index))
        (throw (Exception. (str "Invalid index type: '" (:type index) "'"))))
      (when-not old-table-record
        (throw (Exception. (str "Cannot create index on unknown table " table-id))))
      (doseq [col-id (:columns index)
              :when (not (get columns (keyword col-id)))]
        (throw (Exception. (str "Cannot create index on unknown column '" col-id "' in table " table-id))))
      (when (empty? (:columns index))
        (throw (Exception. (str "Indexes must refer to at least one column"))))
      (when (and (not (:split storage))
                 (> (count (:columns index)) 1))
        (throw (Exception. (str "Indexes on tables in unified storage must refer to precisely one column"))))
      ;; TODO: Should probably also validate index types against column types here.

      (let [table-record (if (:split storage)
                           (update old-table-record :indexes #(vec (conj (set %) index)))
                           (let [col-id-kw (keyword (first (:columns index)))]
                             (update-in old-table-record [:columns col-id-kw :indexes] #(vec (conj (set %) {:type (:type index)})))))]
        (update-col-indexes! db-c table-record)
        (tables-util/save-table-record! db-c table-record)))))

(defn table-delete-index! [db-c old-table-record index]
  (util/with-db-transaction [db-c db-c]
    ;; Remove from both per-col indexes and top-level indexes, because it could be in either. Type of storage is irrelevant here.
    (let [table-record (cond->
                         (update old-table-record :indexes #(vec (disj (set %) index)))
                         (= 1 (count (:columns index))) (update-in [:columns (keyword (first (:columns index))) :indexes] #(vec (disj (set %) {:type (:type index)}))))]
      (update-col-indexes! db-c table-record)
      (tables-util/save-table-record! db-c table-record))))

;; Useful for manually adding columns when it doesn't work through the UI because of timeouts.
(defn add-col-no-init
  ([app-id table-mapping-id table-id name type] (add-col-no-init app-id table-mapping-id table-id name type nil nil))
  ([app-id table-mapping-id table-id name type backend linked-table-id]
   (binding [tables-util/*environment-for-admin-call* {:app_id app-id :table_mapping_id table-mapping-id}]
     (let [new-col (cond-> {:name     name
                            :type     type}
                           backend (assoc :backend backend :table-id linked-table-id))]
       (table-create-columns! (db) table-id [new-col] false)))))


(defn update-col-indexes! [db-c {table-id :id :keys [columns storage] :as table-record}]
  ; This doesn't use the DB passed in, because it can't run in a transaction.
  (if (:split storage)
    (let [env-for-admin-call tables-util/*environment-for-admin-call*] ; Ew. Preserve across callback boundary.
      (util/call-when-committed
        db-c
        (fn []
          (binding [tables-util/*environment-for-admin-call* env-for-admin-call]
            (let [db-c (tables-util/db-for-current-app)]
              (if-not (get-in db-c [:anvil/pool-info :allow-admin-actions?])
                (log/warn (str "Cannot update col indexes for table " table-id " - admin actions not allowed."))
                (worker-pool/run-task!
                  (worker-pool/with-expanding-threadpool-when-slow
                    ;; TODO ascribe this (possibly heroic) amount of work to the
                    (->> table-record
                         (tables-util/normalise-indexes)    ;; In case the table record has been updated since it was loaded.
                         (split-table-manager/update-indexes! db-c))))))))))

    ;; Else: combined storage
    (when (and (get-in db-c [:anvil/pool-info :allow-admin-actions?])
               (not (get-in db-c [:anvil/pool-info :multi-tenant-db?])))
      (let [db (tables-util/db-for-current-app)
            _ (tables-util/ensure-combined-storage! storage)
            valid-index-types {"b_tree"    #{"string" "number" "date" "datetime" "bool"}
                               "trigram"   #{"string"}
                               "full_text" #{"string"}}
            required-indexes (reduce (fn [required-indexes [col-id {indexes :indexes col-type :type :as _col}]]
                                       (if (empty? indexes)
                                         required-indexes
                                         (concat required-indexes
                                                 (filter identity
                                                         (map (fn [{index-type :type :as index-spec}]
                                                                (let [valid-col-types (get valid-index-types index-type)]
                                                                  (if (get valid-col-types col-type)
                                                                    {:col-id     col-id
                                                                     :type       index-type
                                                                     :NAME       (.toLowerCase (str "data_table_" table-id "_" (string/replace col-id #"[^a-zA-Z0-9]" "") "_" index-type))
                                                                     :index-spec index-spec
                                                                     :col-type   col-type}
                                                                    (throw+ {:anvil/server-error (str "Could not update index of type '" index-type "' on column of type '" col-type "'")}))))
                                                              indexes))))) [] columns)

            EXISTING-INDEX-NAMES (set (map :relname (jdbc/query db ["select relname from pg_class where relname ilike ? and relkind = 'i';" (str "data_table_" table-id "_%")])))
            REQUIRED-INDEX-NAMES (set (map :NAME required-indexes))

            INDEXES-TO-DROP (clojure.set/difference EXISTING-INDEX-NAMES REQUIRED-INDEX-NAMES)
            INDEXES-TO-CREATE (clojure.set/difference REQUIRED-INDEX-NAMES EXISTING-INDEX-NAMES)]

        (log/trace "Required indexes:" required-indexes)
        (log/trace "Existing indexes:" EXISTING-INDEX-NAMES)
        (log/trace "Required index names:" REQUIRED-INDEX-NAMES)
        (log/trace "Indexes to drop:" INDEXES-TO-DROP)
        (log/trace "Indexes to create:" INDEXES-TO-CREATE)

        ;; Here lieth Ian's attempt to do CREATE INDEX CONCURRENTLY so that Business Plan users could create indexes on
        ;; the main app_storage_data table. Unfortunately, this causes postgres to wedge completely the *second* time
        ;; you try to create an index. No idea why, and life is too short to dig deeply enough to find out. Only allow
        ;; dedicated-db users to do this for now.

        (util/with-metric-query "DROP INDEX"
          (doseq [IDX-NAME INDEXES-TO-DROP]
            (util/with-metric-query "DROP INDEX" (jdbc/execute! db (str "DROP INDEX IF EXISTS " IDX-NAME) {:transaction? false}))))
        (util/with-metric-query "CREATE INDEX"
          (doseq [IDX-NAME INDEXES-TO-CREATE]
            (let [{:keys [type col-id col-type] :as _idx} (first (filter #(= IDX-NAME (:NAME %)) required-indexes))
                  TABLE-ID (str (int table-id))
                  COL-ID (string/replace (name col-id) #"[^A-Za-z0-9+_=]" "")
                  SQL
                  (condp = type
                    "b_tree"
                    (if (= col-type "number")
                      (str "CREATE INDEX IF NOT EXISTS " IDX-NAME " ON app_storage_data USING btree(((data->>'" COL-ID "')::float)) where table_id = " TABLE-ID)
                      (if (contains? #{"string" "date" "datetime"} col-type)
                        (str "CREATE INDEX IF NOT EXISTS " IDX-NAME " ON app_storage_data USING btree((data->>'" COL-ID "')) where table_id = " TABLE-ID)
                        (throw (Exception. (str "Could not create index of type '" type "' on column of type '" col-type "'")))))

                    "trigram"
                    (str "CREATE INDEX IF NOT EXISTS " IDX-NAME " ON app_storage_data USING gin((data->>'" COL-ID "') gin_trgm_ops) where table_id = " TABLE-ID)

                    "full_text"
                    ;; TODO: Get tsvector configuration name from spec to support other languages.
                    (str "CREATE INDEX IF NOT EXISTS " IDX-NAME " ON app_storage_data USING gin(to_tsvector('english', (data->>'" COL-ID "'))) where table_id = " TABLE-ID)

                    (throw (Exception. (str "Could not create index of type '" type "': " IDX-NAME))))]
              (log/trace (pr-str SQL))
              (util/with-metric-query "CREATE INDEX"
                (util/with-long-query
                  (jdbc/execute! db SQL {:transaction? false}))))))

        (log/trace "Finished updating indexes.")))))