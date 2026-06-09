(ns anvil.runtime.tables.v2.export
  (:require [anvil.runtime.tables.v2.search :as search]
            [clojure.java.jdbc :as jdbc]
            [clojure.data.json :as json]
            [medley.core :refer [indexed filter-vals]]
            [anvil.util :as util]
            [clojure.string :as str]
            [anvil.runtime.tables.v2.util :as util-v2]
            [anvil.runtime.tables.v2.query :as query]
            [anvil.runtime.tables.v2.sql-util :as sql-util]
            [anvil.runtime.tables.split.sql :as sql]
            [anvil.runtime.tables.split.sql :as split-sql]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [anvil.dispatcher.types :as types]
            [clojure.java.io :as io])
  (:import (java.sql Connection Blob)
           (java.util Collections)
           (java.io SequenceInputStream ByteArrayInputStream ByteArrayOutputStream)
           (anvil.dispatcher.types MediaDescriptor Media)))

(defn- load-combined-blob-media [db-c {:keys [storage] :as table-record} col-id-kw col-values]
  (when-let [object-id (get col-values col-id-kw)]
    (when-let [{:keys [content_type name data]}
               (first (jdbc/query db-c ["SELECT content_type, name, column_id, data FROM app_storage_media WHERE object_id = ?" object-id]))]
      (let [bytes (or data
                      (let [src-blob ^Blob (jdbc/db-query-with-resultset db-c ["SELECT ?" object-id]
                                                                         (fn [rs]
                                                                           (.next rs)
                                                                           (.getBlob rs 1)))
                            src-stream (.getBinaryStream src-blob)
                            dst-stream (ByteArrayOutputStream.)
                            _size (io/copy src-stream dst-stream)
                            bytes (.toByteArray dst-stream)]
                        (.close dst-stream)
                        (.close src-stream)
                        (.free src-blob)
                        bytes))]
        (types/->BlobMedia content_type bytes name)))))

(defn- lazy-export-table [^Connection db-c, {:keys [id storage columns] :as table-record}, include-media?, col-id-kws, view-query]
  (let [col-id-kws (seq (or col-id-kws (keys columns)))
        n-cols (count col-id-kws)
        media-cols (indexed (filter-vals #(= (:type %) "media") columns))
        [QUERY-SQL query-args] (query/QUERY->SQL table-record view-query)]
    (if (:split storage)
      (let [SQL (str "SELECT _id AS id, ? AS table_id, "
                     (when include-media?
                       (->> (for [[idx [col-id-kw _]] media-cols]
                              (str "(" (split-sql/COLUMN-NAME table-record col-id-kw) ").bytes AS bytes_" idx ", "))
                            (apply str)))
                     (sql-util/JSONB-BUILD-OBJECT
                       (for [col-id col-id-kws
                             :let [col-id-kw (keyword col-id)
                                   colspec (get columns col-id-kw)
                                   col-type (table-types/get-type-from-db-column colspec)]]
                         (str "?, " (split-sql/TO-JSON-EXPR table-record col-id-kw col-type true true))))
                     " AS data"
                     " FROM " (split-sql/TABLE-NAME table-record)
                     " WHERE " (or QUERY-SQL "TRUE"))
            stmt (.prepareStatement db-c SQL)]
        (.setFetchSize stmt 100)                                 ; Need to do this, else jdbc will load every row into memory on the first fetch. Doh.
        (.setLong stmt 1 id)
        (doseq [[idx col-id-kw] (indexed col-id-kws)]
          (.setString stmt (+ idx 2) (util/preserve-slashes col-id-kw)))
        (doseq [[idx val] (indexed query-args)]
          (jdbc/set-parameter val stmt (+ idx 2 n-cols)))
        (cond->> (lazy-seq (jdbc/result-set-seq (.executeQuery stmt)))
                 (and include-media? (not-empty media-cols))
                 (map (fn [row]
                        (reduce (fn [row [idx [col-id-kw _]]]
                                  (if-let [{:keys [content_type name]} (get-in row [:data col-id-kw])]
                                    (assoc-in row [:data col-id-kw] (types/->BlobMedia content_type (get row (keyword (str "bytes_" idx))) name))
                                    row))
                                row media-cols)))))

      ;; Else: Not split storage
      (let [stmt (.prepareStatement db-c (str "SELECT * FROM app_storage_data WHERE table_id=? AND " QUERY-SQL))]
        (.setFetchSize stmt 100)                                 ; Need to do this, else jdbc will load every row into memory on the first fetch. Doh.
        (.setLong stmt 1 id)
        (doseq [[idx val] (indexed query-args)]
          (jdbc/set-parameter val stmt (+ idx 2)))
        (cond->> (lazy-seq (jdbc/result-set-seq (.executeQuery stmt)))
                 (and include-media? (not-empty media-cols))
                 (map (fn [row]
                        (reduce (fn [row [idx [col-id-kw _]]]
                                  (if (get-in row [:data col-id-kw])
                                    (assoc-in row [:data col-id-kw] (load-combined-blob-media {:connection db-c} table-record col-id-kw (:data row)))
                                    row))
                                row media-cols))))))))

(defn lazy-export-data [^Connection db-c, table-records, include-media?]
  (into {}
        (for [{:keys [id] :as table-record} table-records]
          [id (fn [] (lazy-export-table db-c table-record include-media? nil nil))])))

(defn export-as-csv [tables db-c table-id query-obj col-names escape-for-excel?]
  (let [raw-conn ^Connection (jdbc/get-connection db-c)
        columns (->> (-> (get-in tables [table-id :columns])
                         (cond-> col-names (select-keys col-names)))
                     (map second))

        esc-string (fn [s]
                     (let [s (str/replace (str s) "\"" "\"\"")
                           s (if escape-for-excel?
                               (str/replace s #"^([=+\-@])" "'$1")
                               s)]
                       (str \" s \")))

        render (fn render [{:keys [type] :as col} value]
                 (condp = type
                   "number" (str value)
                   "string" (esc-string value)
                   "date" (render {:type "string"} value)
                   "datetime" (render {:type "string"} value)
                   "simpleObject" (render {:type "string"} (json/write-str value))
                   "bool" (if value "1", "0")
                   "media" "#MEDIA"
                   "link_single" (esc-string (when value (str "#ROW" (:id value))))
                   "link_multiple" (esc-string (str "#ROWS[" (str/join "," (map :id value)) "]"))
                   "#REF"))

        render-row (fn [data row-id]
                     (->> (for [{:keys [id] :as col} columns]
                            (render col (get data (keyword id))))
                          (cons (esc-string row-id))
                          (str/join ",")))

        table-record (get-in tables [table-id :table-record])
        table-data (lazy-export-table raw-conn table-record false (map #(keyword (:id %)) columns) query-obj)

        header (->> columns
                    (map #(render {:type "string"} (:name %)))
                    (cons "\"ID\"")
                    (str/join ","))

        csv-lines (->> table-data
                       (map #(render-row (:data %) (util/write-json-str [(:table_id %) (:id %)])))
                       (cons header)
                       (interpose "\n"))]

    (SequenceInputStream. (Collections/enumeration
                            (concat (map #(ByteArrayInputStream. (.getBytes ^String %))
                                         csv-lines)
                                    (lazy-seq
                                      (.close raw-conn)
                                      '()))))))

(defn get-csv-filename [tables table-id]
  (let [table-name (get-in tables [table-id :name])]
    (str (.replaceAll ^String (or table-name "export") "[^A-Za-z0-9\\. ]" "") ".csv")))

(defn serve-query-csv-lazy-media [tables db-c table-id query-obj cols escape-for-excel?]
  (reify
    MediaDescriptor
    (getName [_this] (get-csv-filename tables table-id))
    (getContentType [_this] "text/csv")
    Media
    (getLength [_this] 0)
    (getInputStream [_this]
      ;; We have to re-do the binding here, because this is likely to be called
      ;; from another thread.
      (export-as-csv tables db-c table-id query-obj cols escape-for-excel?))))
