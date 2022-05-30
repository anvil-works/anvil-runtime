(ns anvil.runtime.tables.v2.csv
  (:require [anvil.runtime.tables.v2.search :as search]
            [clojure.java.jdbc :as jdbc]
            [clojure.data.json :as json]
            [anvil.util :as util]
            [clojure.string :as str])
  (:import (java.sql Connection)
           (java.util Collections)
           (java.io SequenceInputStream ByteArrayInputStream)
           (anvil.dispatcher.types MediaDescriptor Media)))



(defn lazy-export-data
  ([^Connection db-c, table-ids] (lazy-export-data db-c table-ids {}))
  ([^Connection db-c, table-ids, view-query]
   (into {}
         (for [id table-ids]
           [id
            (let [[QUERY-SQL query-args] (search/QUERY->SQL view-query)
                  stmt (doto (.prepareStatement db-c (str "SELECT * FROM app_storage_data WHERE table_id=? AND " QUERY-SQL))
                         (.setFetchSize 100)                ; Need to do this, else jdbc will load every row into memory on the first fetch. Doh.
                         (.setInt 1 id))]
              (dorun (map-indexed (fn [idx val]
                                    (jdbc/set-parameter val stmt (+ idx 2)))
                                  query-args))
              (.executeQuery stmt))]))))

(defn export-as-csv [tables db-c table-id query-obj col-names]
  (let [raw-conn ^Connection (jdbc/get-connection db-c)
        columns (->> (-> (get-in tables [table-id :columns])
                         (select-keys col-names))
                     (map second))

        esc-string #(str "\"" (.replace (str %) "\"" "\"\"") "\"")

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
                   "link_multiple" (esc-string (when value (str "#ROWS[" (str/join "," (map :id value)) "]")))
                   "#REF"))

        render-row (fn [data row-id]
                     (->> (for [{:keys [id] :as col} columns]
                            (render col (get data (keyword id))))
                          (cons (esc-string row-id))
                          (str/join ",")))

        table-data (-> (lazy-export-data raw-conn [table-id] query-obj)
                       (get table-id))

        header (->> columns
                    (map #(render {:type "string"} (:name %)))
                    (cons "\"ID\"")
                    (str/join ","))

        csv-lines (->> table-data
                       (jdbc/result-set-seq)
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

(defn serve-query-csv-lazy-media [tables db-c table-id query-obj cols]
  (reify
    MediaDescriptor
    (getName [_this] (get-csv-filename tables table-id))
    (getContentType [_this] "text/csv")
    Media
    (getLength [_this] 0)
    (getInputStream [_this]
      ;; We have to re-do the binding here, because this is likely to be called
      ;; from another thread.
      (export-as-csv tables db-c table-id query-obj cols))))
