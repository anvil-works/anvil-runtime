(ns anvil.runtime.tables.split.data
  (:require [clojure.java.jdbc :as jdbc]
            [slingshot.slingshot :refer :all]
            [anvil.runtime.tables.split.sql :as sql]
            [anvil.runtime.tables.v2.jdbc-trace :as jdbc-t]
            [anvil.runtime.tables.v2.query :as query]
            [anvil.runtime.tables.v2.util :as util-v2]
            [anvil.dispatcher.types :as types]))

(clj-logging-config.log4j/set-logger! :level :trace)

(defn- do-delete! [db-c table-record [WHERE-SQL where-args]]
  (first (jdbc-t/query db-c (concat [(str "WITH d AS (DELETE FROM " (sql/TABLE-NAME table-record) " AS t WHERE " WHERE-SQL
                                          "            RETURNING pg_column_size(t.*) AS n_bytes)"
                                          "SELECT COUNT(*) AS n_rows, COALESCE(SUM(n_bytes), 0) AS n_bytes FROM d")]
                                    where-args))))

(defn delete-rows! [db-c table-record row-ids]
  (do-delete! db-c table-record ["_id = ANY(?)" [(long-array row-ids)]]))

(defn delete-from-query! [db-c table-record query]
  (do-delete! db-c table-record (query/QUERY->SQL table-record query)))

(defn fetch-media [db-c table-record row-id col-id]
  (let [COL-NAME (sql/COLUMN-NAME table-record col-id)]
    (first (jdbc/query db-c [(str "SELECT (" COL-NAME ").content_type AS content_type,"
                                  " (" COL-NAME ").name AS name,"
                                  " (" COL-NAME ").bytes AS data"
                                  " FROM " (sql/TABLE-NAME table-record)
                                  " WHERE _id = ?")
                             row-id]))))

(defn get-media-with-data [db-c table-record row-id col-id]
  (let [{:keys [content_type name data]} (fetch-media db-c table-record row-id col-id)]
    (when data
      (types/->BlobMedia content_type data name))))

(defn- partition-linkmulti-cols [columns]
  (let [{:keys [linkmulti-cols regular-cols]} (->> columns
                                                   (map second)
                                                   (group-by (fn [{:keys [type] :as col}]
                                                               (condp = type
                                                                 "link_multiple" :linkmulti-cols
                                                                 "unresolved" :unresolved
                                                                 "unresolvedArray" :unresolved
                                                                 :regular-cols))))]
    ;; Drop the unresolved columns, they don't matter.
    [regular-cols linkmulti-cols]))

(defn add-rows! [db-c tables {table-id :id :keys [restrict] :as view-spec} reduced-rows]
  #_(prn "Adding rows!" reduced-rows)
  (let [{:keys [columns table-record] :as table-info} (get tables table-id)
        [RESTRICT-SQL restrict-args] (if restrict (query/QUERY->SQL table-record restrict) ["TRUE" nil])
        [regular-cols linkmulti-cols] (partition-linkmulti-cols columns)
        ;; An annoying consequence of testing view restrictions with SQL is that we can't test view restrictions that
        ;; apply to link-to-multi rows unless we check them *after* both inserting the row (to get its ID) and inserting
        ;; the links. It'd be worryingly brittle to walk the restriction query looking for whether it refers to any
        ;; link-to-multi columns, so we defer the view checks til afterwards for anything that has both a link_multi
        ;; column and a view restriction.
        restrict-later? (and (not-empty linkmulti-cols) restrict)
        new-rows
        (if (empty? regular-cols)
          (doall
            (for [row reduced-rows]
              (first (jdbc-t/query db-c (concat
                                          [(str "INSERT INTO " (sql/TABLE-NAME table-record) " AS t DEFAULT VALUES "
                                                " RETURNING _id AS id, pg_column_size(t.*) AS n_bytes"
                                                (when-not restrict-later?
                                                  (str ", " RESTRICT-SQL " AS view_matches")))]
                                          restrict-args)))))
          ;; else, not empty
          (let [SQL-FOR-UPDATES (str "(" (sql/COMMA-SEPARATED (for [{:keys [id] :as col} regular-cols]
                                                                (sql/VALUE-SQL table-record id))) ")")
                empty-values (delay (into {} (for [{:keys [id] :as col} regular-cols]
                                               [id (sql/empty-value col)])))
                db-query (concat
                           [(str "INSERT INTO " (sql/TABLE-NAME table-record) " AS t"
                                 " (" (sql/COMMA-SEPARATED (for [{:keys [id] :as col} regular-cols]
                                                             (sql/COLUMN-NAME table-record id))) ")"
                                 " VALUES "
                                 (sql/COMMA-SEPARATED
                                   (repeat (count reduced-rows) SQL-FOR-UPDATES))

                                 " RETURNING _id AS id, pg_column_size(t.*) AS n_bytes"
                                 (when-not restrict-later?
                                   (str ", " RESTRICT-SQL " AS view_matches")))]
                           (apply concat
                                  (for [row reduced-rows]
                                    (apply concat
                                           (for [{:keys [id] :as col} regular-cols]
                                             (or (get row id) (get @empty-values id))))))
                           (when-not restrict-later?
                             restrict-args))
                ;;_ (prn "INSERT QUERY")
                new-rows (jdbc-t/query db-c db-query)
                _ (when-not (or restrict-later? (every? :view_matches new-rows))
                    (throw+ (util-v2/general-tables-error "Data does not match view constraints")))]
            new-rows))]
    (doseq [{col-id :id} linkmulti-cols
            :let [entries (->> (for [[row {:keys [id]}] (map vector reduced-rows new-rows)
                                     :let [[target-ids] (get row col-id)]
                                     :when (not-empty target-ids)]
                                 (map (fn [tid idx] [id tid idx]) target-ids (range)))
                               (apply concat))]
            :when (not-empty entries)]
      (doseq [entries-chunk (partition 20000 20000 nil entries)]
        (jdbc/execute! db-c (apply concat [(str "INSERT INTO " (sql/LINK-TABLE-NAME table-record col-id) " (from_row, to_row, idx) VALUES "
                                                (sql/COMMA-SEPARATED
                                                  (repeat (count entries) "(?,?,?)")))]
                                   entries-chunk))))
    (when restrict-later?
      (let [{:keys [all_matched]}
            (jdbc/query db-c (concat [(str "SELECT BOOL_AND(" RESTRICT-SQL ") AS all_matched FROM " (sql/TABLE-NAME table-record)
                                           " WHERE _id = ANY(?)")]
                                     restrict-args
                                     [(long-array (map :id new-rows))]))]
        (when-not all_matched
          (throw+ (util-v2/general-tables-error "Data does not match view constraints")))))
    new-rows))

(defn update-rows! [db-c tables {table-id :id :keys [restrict] :as view-spec} rows]
  (let [{:keys [columns table-record] :as table-info} (get tables table-id)
        TABLE-NAME (sql/TABLE-NAME table-record)
        [RESTRICT-SQL restrict-args] (when restrict (query/QUERY->SQL table-record restrict))
        [regular-cols linkmulti-cols] (partition-linkmulti-cols columns)
        regular-col-ids (set (map :id regular-cols))]
    (when (not-empty linkmulti-cols)
      (let [linkmulti-col-ids (set (map :id linkmulti-cols))]
        (doseq [{:keys [row-id reduced-values] :as row} rows]
          (doseq [[col-id [target-ids]] reduced-values
                  :when (contains? linkmulti-col-ids col-id)]
            (jdbc-t/execute! db-c [(str "DELETE FROM " (sql/LINK-TABLE-NAME table-record col-id) " WHERE from_row=?") row-id])
            (when (not-empty target-ids)
              (let [params (map (fn [v idx] [row-id v idx]) target-ids (range))]
                (doseq [params-chunk (partition 20000 20000 nil params)]
                  (jdbc-t/execute! db-c (apply concat
                                               [(str "INSERT INTO " (sql/LINK-TABLE-NAME table-record col-id) " (from_row, to_row, idx) VALUES "
                                                     (sql/COMMA-SEPARATED (for [v target-ids] "(?,?,?)")))]
                                               params-chunk)))))))))

    ;; This is extremely knife-and-fork, but should do the trick. We execute one UPDATE for each row we're updating.
    ;; If this proves too slow for batches, we can create a transaction-local temporary table and UPDATE FROM... there.
    (if (not-empty regular-cols)
      (->>
        (for [{:keys [row-id reduced-values]} rows
              :let [{regular-vals true, linkmulti-vals false} (group-by (fn [[col-id values]] (contains? regular-col-ids col-id)) reduced-values)]
              :when (not-empty regular-vals)
              :let [{:keys [old_bytes new_bytes view_matches]}
                    (jdbc-t/query db-c (concat
                                         [(str "WITH prev_size AS (SELECT pg_column_size(t.*) AS old_bytes FROM " TABLE-NAME " t WHERE _id=? FOR UPDATE),"
                                               " new_size AS ("
                                               "   UPDATE " TABLE-NAME " t SET "
                                               (sql/COMMA-SEPARATED (for [[col-id value] regular-vals]
                                                                      (str (sql/COLUMN-NAME table-record col-id) " = " (sql/VALUE-SQL table-record col-id))))
                                               "   WHERE _id = ?"
                                               "   RETURNING pg_column_size(t.*) AS new_bytes, (" (or RESTRICT-SQL " TRUE") ") AS view_matches"
                                               ") SELECT * FROM prev_size, new_size")
                                          row-id]
                                         (apply concat (for [[col-id values] regular-vals] values))
                                         [row-id]
                                         restrict-args))]]
          (cond
            (nil? view_matches)
            (throw+ (util-v2/general-tables-error "The row you are trying to update has been deleted"))
            (not view_matches)
            (throw+ (util-v2/general-tables-error "Cannot update row: Data does not match view constraints"))
            :else
            [old_bytes new_bytes]))
        (reduce (fn [[old-bytes new-bytes] [o n]]
                  [(+ old-bytes o) (+ new-bytes n)])
                [0 0]))
      [0 0])))
