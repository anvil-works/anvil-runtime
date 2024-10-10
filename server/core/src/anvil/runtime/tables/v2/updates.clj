(ns anvil.runtime.tables.v2.updates
  (:require [slingshot.slingshot :refer :all]
            [anvil.runtime.tables.v2.search :as search-v2]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [anvil.runtime.tables.v2.util :as util-v2]
            [anvil.util :as util]
            [clojure.java.jdbc :as jdbc]
            [anvil.dispatcher.types :as dispatcher-types]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [clojure.tools.logging :as log]
            [medley.core :refer [assoc-some]]
            [anvil.runtime.quota :as quota]
            [clojure.pprint :as pprint])
  (:import (org.apache.commons.io IOUtils)
           (java.io ByteArrayOutputStream InputStream)
           (java.sql Blob ResultSet Array Connection)))

;;(clj-logging-config.log4j/set-logger! :level :trace)

;; Table updates are a finicky process. Before hitting the database, we need to:
;; * Type-check and reduce all the provided values to something that can go in the DB
;;   (this includes inserting view-inferred values)
;; * Work out whether this update might displace media
;; * Handle auto-creating columns or auto-resolving the types of created columns
;;
;; Then we need to:
;; * Alter schemas to create or resolve columns
;; * Pull out existing values of media columns that might get displaced
;; * Check that the new values match any view constraints
;; *
;;
;; The worst headaches are produced by autocreating and resolving columns, which makes batch operations very hard.
;; So right now we're omitting this problem entirely. This is necessarily temporary.

(defn- check-values-for-update [tables {table-id :id :keys [perm cols restrict] :as view-spec} value-args]
  (let [table-columns (get-in tables [table-id :columns])]
    (reduce (fn [rv [col-name value]]
              (let [col-name (util/preserve-slashes col-name)
                    _ (when-not (if cols
                                  (some #{col-name} cols)
                                  (contains? table-columns col-name))
                        (throw+ (cond-> (util-v2/general-tables-error (format "No such column '%s'%s" col-name (if cols " in this view" ""))
                                                                      "anvil.tables.NoSuchColumnError")
                                        (and (nil? cols) (nil? restrict)) (assoc ::would-create-column [col-name (table-types/get-type-from-value value)]))))

                    col (get table-columns col-name)
                    col-id (:id col)
                    col-type (util-v2/typemap-from-column col)
                    type-error (table-types/type-error? tables col-type col-name value)]
                (cond
                  type-error
                  (throw+ (-> (util-v2/general-tables-error type-error)
                              (cond-> (and (#{"unresolved" "unresolvedArray"} (:type col-type))
                                           (not= :error (table-types/resolve-type col-type (table-types/get-type-from-value value))))
                                      (assoc ::would-resolve-column [col-id col-type (table-types/get-type-from-value value)]))))

                  (= (:type col-type) "media")
                  (-> rv
                      (update :media-to-displace conj col-id)
                      (assoc-in [:reduced-values col-id] nil)
                      (cond-> value (assoc-in [:media-to-write col-id] {:media value
                                                                        :bytes (delay ; Don't do this until we need it, because it may never be required. In batch updates,
                                                                                      ; check-values-for-update is called repeatedly, and we only actually want the last one.
                                                                                      ; This is a delay rather than a fn because we can't re-consume the media object in the
                                                                                      ; event of a transaction retry.
                                                                                 (with-open [in-stream ^InputStream (blocking-hacks/?->InputStream rpc-util/*req* value)
                                                                                             out-stream (ByteArrayOutputStream.)]
                                                                                   (IOUtils/copy in-stream out-stream 4096)
                                                                                   (.toByteArray out-stream)))})))

                  :else
                  (assoc-in rv [:reduced-values col-id] (table-types/reduce-val col-type value))))
              ) {} value-args)))

;; Note: I am deeply resentful that any of this work is required. Automatic column addition is a silly feature
;; we should never have supported.

(defn- resolving-columns [db can-auto-create? tables {table-id :id :as table-spec} f]
  (try+
    (doall (f tables))
    (catch ::would-create-column e
      (when-not can-auto-create?
        (throw+ e))
      (util/with-db-transaction
        [db db]
        (let [[col-name col-type] (::would-create-column e)
              {:keys [columns]} (first (jdbc/query db ["SELECT columns FROM app_storage_tables WHERE id = ?" table-id]))]
          (when-not (some #(= (:name %) col-name) columns)
            ;; if we haven't lost the race:
            (jdbc/execute! db ["UPDATE app_storage_tables SET columns=?::jsonb WHERE id = ?"
                               (-> columns
                                   (assoc (util-v2/generate-column-id) (assoc (table-types/make-db-column-from-type col-type) :name col-name))
                                   (util/write-json-str))
                               table-id])
            (rpc-util/*rpc-println* (str "Automatically creating column " (pr-str col-name) " (" (table-types/get-type-name tables col-type) ")")))))
      ;; TODO invalidate the cache here
      (resolving-columns db can-auto-create? (util-v2/get-tables (::util-v2/table-mapping tables)) table-spec f))
    (catch ::would-resolve-column e
      (util/with-db-transaction [db db]
        (let [[col-id {unresolved-type :type} new-type] (::would-resolve-column e)
              col-id (keyword col-id)
              {:keys [columns]} (first (jdbc/query db ["SELECT columns FROM app_storage_tables WHERE id = ?" table-id]))
              ;;_ (log/trace "RESOLVING COLUMN:" col-id columns unresolved-type new-type)
              new-columns (into {} (for [[id {:keys [name type table_id] :as col}] columns]
                                     [id (cond-> col
                                                 (and (= id col-id) (= type unresolved-type))
                                                 (merge (table-types/make-db-column-from-type new-type)))]))]
          (when (not= new-columns columns)
            (jdbc/execute! db ["UPDATE app_storage_tables SET columns=?::jsonb WHERE id = ?" new-columns table-id])
            (rpc-util/*rpc-print* (str "Type of column " (pr-str (get-in columns [col-id :name])) " is now " (table-types/get-type-name tables new-type))))))
      ;; TODO invalidate the cache here
      (resolving-columns db can-auto-create? (util-v2/get-tables (::util-v2/table-mapping tables)) table-spec f))))


;; To insert a batch of rows, we must now:
;; * Type-check and reduce each of them, with (check-values-for-update)
;; * IF any of them have media to write (there is nothing to displace), then transactionally:
;;   - Create all new media
;;   - Update all in-memory pending media column values to include IDs of written media
;;   - Insert all new row values, checking en route that they match any view resrictions
;;     (if any view restrictions are not matched, then abort)
;; * ELSE IF there are view restrictions and we are inserting multiple rows, transactionally:
;;   - Insert all new row values, checking en route that they match any view restrictions
;;     (if any view restrictions are not matched, then abort)
;; * ELSE IF view restrictions and single row, nontransactionally:
;;   - Insert all new row values, checking en route that they match any view restrictions
;;     (if any view restrictions are not matched, then abort)
;; * ELSE no view restrictions or single insert:
;;   - Insert all new row values

(defn- delete-media! [db-c media-ids]
  (when-not (empty? media-ids)
    (log/trace "Deleting media:" media-ids)
    (-> (jdbc/query db-c ["WITH lo_sizes AS (SELECT object_id, get_lo_size(object_id) as bytes_removed FROM app_storage_media
                                              WHERE data IS NULL AND object_id = ANY(?)),
                                blob_deletions AS (SELECT lo_unlink(object_id), object_id FROM lo_sizes),
                                lo_record_deletions AS (DELETE FROM app_storage_media WHERE object_id IN (SELECT object_id FROM blob_deletions)),
                                data_sizes AS (SELECT object_id, length(data) as bytes_removed FROM app_storage_media
                                                  WHERE data IS NOT NULL AND object_id = ANY(?)),
                                data_record_deletions AS (DELETE FROM app_storage_media WHERE object_id IN (SELECT object_id FROM data_sizes))
                            SELECT bytes_removed FROM lo_sizes UNION SELECT bytes_removed FROM data_sizes"
                          (long-array media-ids) (long-array media-ids)])
        (first) (:bytes_removed))))

(defn- delete-displaced-media! [db-c table-id rows]
  (when-let [rows-displacing-media (seq (filter :media-to-displace rows))]
    (log/trace "delete-displaced-media! for" rows-displacing-media)
    (let [all-mentioned-columns (->> (mapcat :media-to-displace rows)
                                     (reduce conj #{})
                                     (seq))
          [MEDIA-FETCH-SQL media-fetch-args] [(str "SELECT id AS row_id, JSONB_BUILD_OBJECT("
                                                   (->> (repeat (count all-mentioned-columns) "?, data->?")
                                                        (interpose ",")
                                                        (apply str))
                                                   ") AS data FROM app_storage_data WHERE table_id=? AND id = ANY(?)")
                                              (concat (mapcat (fn [key] [key key]) all-mentioned-columns)
                                                      [table-id (long-array (map :row-id rows-displacing-media))])]
          results (jdbc/query db-c (cons MEDIA-FETCH-SQL media-fetch-args))

          rows-by-id (into {} (for [{:keys [row-id] :as row} rows-displacing-media] [row-id row]))
          media-ids (mapcat (fn [{:keys [row_id data]}]
                              (let [{:keys [media-to-displace media-to-write]} (get rows-by-id row_id)]
                                (for [col-id media-to-displace
                                      :let [{:keys [type manager id] :as new-media} (get-in media-to-write [col-id :media])
                                            current-oid (get data (keyword col-id))]
                                      ;; Destroy if there is media here and it's not being overwritten with itself
                                      :when (and current-oid (or (nil? new-media)
                                                                 (not
                                                                   (and (= type ["LazyMedia"])
                                                                        ;; TODO a typo here should have been caught by tests
                                                                        (= manager "table-media")
                                                                        (= id (str current-oid))))))]
                                  current-oid))) results)]
      (delete-media! db-c media-ids))))


(defn- create-media-records! [db-c table-id quota-ctx rows]
  ;; At this point we don't (necessarily) know row-id. That's fine, in the case of an insert, we'll come back later and fill it in.
  (for [{:keys [row-id media-to-write] :as row} rows]
    (if-not media-to-write
      row
      (let [created-oids
            (into {}
                  (for [[col-id {:keys [media bytes]}] media-to-write
                        :when media]
                    (let [size (alength @bytes)]
                      (quota/decrement-if-possible-c! quota-ctx db-c :db-bytes size)
                      (let [object-id (:object_id (first (jdbc/query db-c ["INSERT INTO app_storage_media(content_type, name, table_id, row_id, column_id, data) VALUES (?, ?, ?, ?, ?, ?) RETURNING object_id"
                                                                           (dispatcher-types/getContentType media) (dispatcher-types/getName media) table-id row-id (util/preserve-slashes col-id) @bytes])))]
                        [col-id object-id]))))]
        (-> row
            (dissoc :media-to-write)
            (assoc :created-oids (vals created-oids))
            (update-in [:reduced-values] merge created-oids))))))

(defn- merge-row-updates [tables view-spec row-updates]
  (reduce (fn [updates {:keys [row-id values]}]
            (let [[prev-vals _] (get updates row-id)
                  all-vals (merge prev-vals values)]
              ;; This duplicates the (check-values-for-update), so each update gets a solo check
              (assoc updates row-id [all-vals (check-values-for-update tables view-spec all-vals)])))
          {} row-updates))

(defn do-update! [db-c quota-ctx can-auto-create? tables {table-id :id :keys [perm cols restrict] :as view-spec} row-updates]
  (let [[RESTRICT-SQL restrict-args] (when restrict (search-v2/QUERY->SQL restrict))
        rows (resolving-columns db-c can-auto-create? tables view-spec
                                (fn [tables] (for [[row-id [_ checked-update]] (merge-row-updates tables view-spec row-updates)]
                                               (assoc checked-update :row-id row-id))))]
    ;; TODO: Only go transactional if (some #(or (:media-to-write %) (:media-to-displace %)) rows)
    ;; (but the overhead's pretty low, so this isn't urgent)
    (util/with-db-transaction [db-c db-c :repeatable-read]
      (let [rollback! #(do
                         ;; This is belt and braces - the exception ought to cause a rollback, but when there's a
                         ;; security boundary here it's best to be sure.
                         (.rollback ^Connection (:connection db-c))
                         (throw+ %))
            bytes-displaced (delete-displaced-media! db-c table-id rows)
            _ (when bytes-displaced
                (quota/decrement-c! quota-ctx db-c :db-bytes (- bytes-displaced)))
            rows (create-media-records! db-c table-id quota-ctx rows)

            data-json (-> (for [{:keys [row-id reduced-values]} rows]
                            {:id row-id, :data reduced-values})
                          (util/write-json-str))]

        (if-not RESTRICT-SQL
          ;; Updating normally: Create virtual table, update from it
          (let [{:keys [updated old_bytes new_bytes]}
                (-> (jdbc/query db-c ["WITH new_data AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(id bigint, data jsonb)),
                                            updates AS (SELECT table_id, nd.id, nd.data AS new_data, od.data AS old_data FROM app_storage_data AS od, new_data AS nd
                                                          WHERE table_id=? AND od.id = nd.id FOR UPDATE),
                                            updated_rows AS (UPDATE app_storage_data SET data=app_storage_data.data||nd.new_data
                                                                  FROM updates AS nd
                                                                  WHERE app_storage_data.table_id=? AND app_storage_data.id=nd.id
                                                                  RETURNING octet_length(app_storage_data.data::text) AS new_bytes, (SELECT octet_length(old_data::text) FROM updates AS old WHERE table_id=? AND old.id=app_storage_data.id) AS old_bytes)
                                               SELECT COUNT(*) AS updated, SUM(new_bytes) AS new_bytes, SUM(old_bytes) AS old_bytes FROM updated_rows"
                                      data-json table-id table-id table-id])
                    (first))]
            (log/trace "Updated" updated old_bytes new_bytes)
            (when (< updated (count rows))
              (rollback! (util-v2/general-tables-error "This row has been deleted" "anvil.tables.RowDeleted")))
            (quota/decrement-c! quota-ctx db-c :db-bytes (- old_bytes))
            (quota/decrement-if-possible-c! quota-ctx db-c :db-bytes new_bytes)
            (log/debug "v2 Updated " (- old_bytes) new_bytes "bytes in table" table-id))

          ;; Updating a view with restrictions: it's a little bit complicated. We need to join the virtual table
          ;; of new results back against the input data to get the final new data, then compute the view, then update that
          (let [{:keys [found matched updated old_bytes new_bytes]}
                (-> (jdbc/query db-c (concat [(str "WITH joined_data AS (SELECT o.data as old_data, o.data||x.data as data, x.id
                                                                      FROM jsonb_to_recordset(?::jsonb) AS x(id bigint, data jsonb)
                                                                           JOIN app_storage_data AS o ON (o.id = x.id)
                                                                      WHERE o.table_id = ?),
                                                      checked_data AS (SELECT * FROM joined_data WHERE " RESTRICT-SQL "),
                                                      updated_rows AS (UPDATE app_storage_data SET data=cd.data
                                                                            FROM checked_data AS cd
                                                                            WHERE table_id=? AND app_storage_data.id=cd.id
                                                                            RETURNING TRUE)
                                                SELECT (SELECT COUNT(*) FROM joined_data) AS found,
                                                       (SELECT COUNT(*) FROM checked_data) AS matched,
                                                       (SELECT COUNT(*) FROM updated_rows) AS updated,
                                                       (SELECT SUM(octet_length(old_data::text)) FROM joined_data) AS old_bytes,
                                                       (SELECT SUM(octet_length(data::text)) FROM joined_data) AS new_bytes")
                                              data-json table-id] restrict-args [table-id]))
                    (first))]
            (when (< found (count rows))
              (log/trace "Rolling back...")
              (rollback! (util-v2/general-tables-error "This row has been deleted" "anvil.tables.RowDeleted")))
            (when (< matched (count rows))
              (rollback! (util-v2/general-tables-error "Data does not match view constraints")))
            (when (not= updated matched)
              (rollback! (util-v2/general-tables-error "Unexpected conflict: Row was deleted mid-update")))
            (quota/decrement-c! quota-ctx db-c :db-bytes (- old_bytes))
            (quota/decrement-if-possible-c! quota-ctx db-c :db-bytes new_bytes)
            (log/debug "v2 Updated " (- old_bytes) new_bytes "bytes in table" table-id)))

        nil))))

(defn- merge-with-nil [cols row-dicts]
  (let [col-nil-map (zipmap (map keyword cols) (repeat nil))]
    (mapv #(merge col-nil-map %) row-dicts)))

(defn do-insert! [db-c quota-ctx autocreate-columns? tables {table-id :id :keys [perm cols restrict] :as view-spec} row-dicts]
  (let [view-inferred-values (search-v2/infer-values-from-query restrict)
        ;; You can only add rows to a column-restricted view if the view specifies every inaccessible column
        _ (when cols
            (let [table-cols (get-in tables [table-id :columns])
                  all-col-ids (for [[_ {:keys [id]}] table-cols] id)
                  specified-col-ids (concat (keys view-inferred-values)
                                            (for [cn cols] (get-in table-cols [cn :id])))]
              (when-not (= (set all-col-ids) (set specified-col-ids))
                ;(log/trace "View doesn't specify all cols. All:" all-col-ids "; specified" specified-col-ids)
                (throw+ (util-v2/general-tables-error "You cannot add rows to this view")))))

        [RESTRICT-SQL restrict-args] (when restrict (search-v2/QUERY->SQL restrict))

        ;; if there are cols we need to specify missing columns as nil so that the view-constraints will be triggered
        row-dicts (if cols
                    (merge-with-nil cols row-dicts)
                    row-dicts)

        rows (resolving-columns db-c autocreate-columns? tables view-spec
                                (fn [tables]
                                  (let [empty-value (into {} (for [[col-name {:keys [id]}] (get-in tables [table-id :columns])]
                                                               [id nil]))]
                                    (for [values row-dicts]
                                      (-> (check-values-for-update tables view-spec values)
                                          (update-in [:reduced-values] #(merge empty-value view-inferred-values %)))))))]
    ;; TODO: Only go transactional if (some #(or (:media-to-write %) (:media-to-displace %)) rows)
    ;; (but the roundtrips aren't that expensive, so this isn't urgent)
    (util/with-db-transaction [db-c db-c :repeatable-read]
      (quota/decrement-if-possible-c! quota-ctx db-c :db-rows (count rows))
      (let [rows (create-media-records! db-c table-id quota-ctx rows)
            new-rows (jdbc/query db-c (concat [(str "WITH new_data AS (SELECT value AS data, ordinality FROM jsonb_array_elements(?::jsonb) WITH ORDINALITY)
                                                     INSERT INTO app_storage_data (table_id,data)
                                                     (SELECT ? as table_id, data FROM new_data " (when RESTRICT-SQL (str "WHERE " RESTRICT-SQL)) " ORDER BY ordinality)
                                                     RETURNING id, octet_length(app_storage_data.data::text) AS n_bytes")
                                               (util/write-json-str (map :reduced-values rows)) table-id] restrict-args))
            _ (when-not (= (count new-rows) (count rows))
                (throw+ (util-v2/general-tables-error "Data does not match view constraints")))
            _ (log/debug "v2 Insert rows to table" table-id (map :n_bytes new-rows) "bytes")
            _ (quota/decrement-if-possible-c! quota-ctx db-c :db-bytes (reduce + 0 (map :n_bytes new-rows)))

            ;; Now match up the new media records, using the fact that the ids were returned in the same order as the input rows
            rows (map (fn [row {:keys [id]}]
                        (assoc row :row-id id))
                      rows new-rows)]
        (doseq [{:keys [row-id created-oids]} rows]
          (jdbc/execute! db-c ["UPDATE app_storage_media SET row_id = ? WHERE object_id = ANY(?)" row-id (int-array created-oids)]))
        (map :row-id rows)))))

(defn- RETURN-MEDIA [tables {table-id :id :as view-spec}]
  (let [media-column-ids (for [[col-name {:keys [id type]}] (get-in tables [table-id :columns])
                               :when (= type "media")]
                           id)
        [GET-MEDIA-SQL get-media-args] [(str "ARRAY["
                                             (->> (repeat (count media-column-ids) "data->>?")
                                                  (interpose ",")
                                                  (apply str))
                                             "]::bigint[] AS media")
                                        media-column-ids]]
    [GET-MEDIA-SQL get-media-args]))

(defn do-delete! [db-c quota-ctx tables {table-id :id :as view-spec} row-ids]
  (let [[GET-MEDIA-SQL get-media-args] (RETURN-MEDIA tables view-spec)]

        ;; TODO only go transactional when (not-empty media-column-ids)
        (util/with-db-transaction [db-c db-c :repeatable-read]
          (let [result (jdbc/query db-c (concat [(str "DELETE FROM app_storage_data WHERE table_id=? AND id = ANY(?) RETURNING "
                                                      GET-MEDIA-SQL ", octet_length(data::text) AS n_bytes")
                                                 table-id (long-array row-ids)]
                                                get-media-args))

                deleted-media-ids (mapcat #(filter identity (.getArray ^Array (:media %))) result)
                n-rows-deleted (count result)
                n-bytes-deleted (+ (or (delete-media! db-c deleted-media-ids) 0)
                                   (reduce + 0 (map :n_bytes result)))]
            (log/debug "v2 Deleted" n-bytes-deleted "bytes from table" table-id)
            (quota/decrement-c! quota-ctx db-c :db-rows (- n-rows-deleted))
            (when-not (zero? n-bytes-deleted)
              (quota/decrement-c! quota-ctx db-c :db-bytes (- n-bytes-deleted)))
            nil))))

(defn delete-from-query! [db-c quota-ctx tables {table-id :id :keys [perm cols restrict] :as view-spec} search]
  (when cols
    (throw+ (util-v2/general-tables-error "Cannot call delete_all_rows() on a view")))
  (let [query (if restrict (search-v2/both-queries restrict search) search)
        [QUERY-SQL query-args] (search-v2/QUERY->SQL query)
        [GET-MEDIA-SQL get-media-args] (RETURN-MEDIA tables view-spec)]
    ;; TODO only go transactional when (not-empty media-column-ids)
    (util/with-db-transaction [db-c db-c :repeatable-read]
      (let [result (jdbc/query db-c (concat [(str "DELETE FROM app_storage_data WHERE table_id=? AND " QUERY-SQL
                                                  " RETURNING " GET-MEDIA-SQL ", octet_length(data::text) AS n_bytes")
                                             table-id]
                                            query-args
                                            get-media-args))
            deleted-media-ids (mapcat #(filter identity (.getArray ^Array (:media %))) result)
            n-rows-deleted (count result)
            n-bytes-deleted (+ (or (delete-media! db-c deleted-media-ids) 0)
                               (reduce + 0 (map :n_bytes result)))]
        (quota/decrement-c! quota-ctx db-c :db-rows (- n-rows-deleted))
        (when-not (zero? n-bytes-deleted)
          (quota/decrement-c! quota-ctx db-c :db-bytes (- n-bytes-deleted)))
        (log/debug "v2 Deleted" n-bytes-deleted "bytes from table" table-id)
        nil))))

;; TODO: Quotas


;; To update a batch of rows, we must now:
;; * Type-check and reduce each of them, with (check-values-for-update)
;; * IF any of them have media to write or displace, then transactionally:
;;   - Get IDs of all displaced media
;;   - Compare with pending write values, discard "overwrite-with-self" case
;;   - Delete all displaced media (and return sizes for decrementing)
;;   - Create all new media
;;   - Update all in-memory pending media column values to include IDs of written media
;;   - Insert all new row values, checking en route that they match any view resrictions
;;     (if any view restrictions are not matched, then abort)
