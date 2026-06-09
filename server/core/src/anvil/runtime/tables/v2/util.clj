(ns anvil.runtime.tables.v2.util
  (:require [anvil.core.cache :as cache]
            [anvil.core.tracing :as tracing]
            [clojure.tools.logging :as log]
            [clj-commons.slingshot :refer :all]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.types :as types]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [crypto.random :as random]
            [anvil.util :as util])
  (:import (java.sql Connection)))

;(clj-logging-config.log4j/set-logger! :level :debug)

;; Access levels
(def NONE 0)
(def READ 1)
(def WRITE 2)
(defn- level-from-str [s]
  (condp = s
    "full" WRITE
    "search" READ
    NONE))

(defn- perm-to-access [perm]
  (condp = perm
    "rwc" WRITE
    "rw" WRITE
    "r" READ
    NONE))

(def MEDIA-INFO-COLS " object_id, name, content_type, table_id, column_id, row_id ")

(defn general-tables-error
  ([message] (general-tables-error message "anvil.tables.TableError"))
  ([message error-type]
   {:anvil/server-error message
    :type               error-type
    :docId              "data_tables"
    :docLinkTitle       "Learn more about Data tables"}))


;; table-mapping ID -> tables
(defonce ^:private global-schema-cache (cache/mk-ttl-cache 500 30000))

(defn clear-global-schema-cache-test-only!
  "Clear the schema cache on this node. Only use in testing; this doesn't help when crosslinked"
  []
  (cache/clear! global-schema-cache))

(defn- do-get-tables [db-c table-mapping]
  (tracing/with-span ["get-tables" (-> (select-keys table-mapping [:table_mapping_id :app_id])
                                       (assoc :internal true))]
    (log/debug "Get tables for " table-mapping)
    (into {::table-mapping table-mapping}
          (for [{:keys [table_id columns storage client server] :as tbl} (tables-util/get-all-table-access-records db-c table-mapping)]
            (let [columns (for [[id column] columns]
                            (-> (table-types/get-type-from-db-column column)
                                (assoc :name (:name column)
                                       :id (util/preserve-slashes id)
                                       :client_hidden (:client_hidden column)
                                       :ui-order (get-in column [:admin_ui :order]))))]
              [table_id (-> (select-keys tbl [:name :python_name :storage])
                            (assoc :columns (into {} (for [col columns]
                                                       [(:name col) col]))
                                   :client (level-from-str client)
                                   :server (level-from-str server)
                                   :table-record (-> tbl
                                                     (select-keys [:name :storage :columns])
                                                     (assoc :id table_id))))])))))

(defn get-tables
  "Get all available tables in a useful format"
  ([] (get-tables (tables-util/table-mapping-for-environment (tables-util/current-environment))))
  ([table-mapping]
   (let [db-c (tables-util/db)
         cache-key (tables-util/cache-key-for-table-mapping table-mapping)]
     (if-let [txn-schema-cache (:schema-cache db-c)]
       (or (get @txn-schema-cache cache-key)
           (let [tables (do-get-tables db-c table-mapping)]
             (swap! txn-schema-cache assoc cache-key tables)
             tables))
       (cache/lookup global-schema-cache cache-key #(do-get-tables db-c table-mapping))))))


(defn reload-tables
  ([] (reload-tables (tables-util/db) (tables-util/table-mapping-for-environment rpc-util/*environment*) nil))
  ([db-c table-mapping old-tables-must-match]
   (let [cache-key (tables-util/cache-key-for-table-mapping table-mapping)
         new-tables (if (:level db-c)
                      ;; We're in a transaction; reload here and schedule a cache flush when we commit
                      (let [tables (do-get-tables db-c table-mapping)]
                        (when-let [tc (:schema-cache db-c)]
                          (swap! tc assoc cache-key tables))
                        (util/call-when-committed db-c #(cache/evict! global-schema-cache cache-key))
                        tables)
                      (do
                        (cache/evict! global-schema-cache cache-key)
                        (when-let [tc (:schema-cache db-c)]
                          (swap! tc dissoc cache-key))
                        (get-tables table-mapping)))]

     (when (and old-tables-must-match (not (every? (set (keys new-tables))
                                                   (keys old-tables-must-match))))
       (throw+ (tables-util/general-tables-error "Cannot perform this operation concurrently with tables being deleted")))
     new-tables)))

(defn typemap-from-column [col]
  (select-keys col [:type :table_id]))

(defn get-ambient-level
  ([tables table-id] (get-ambient-level tables table-id false))
  ([tables table-id request-overrides]
   (let [is-client? (or rpc-util/*client-request?* (get request-overrides :use_client_config))
         level (get-in tables [table-id (if is-client? :client :server)])]
     (if (and level (= :db-read-uplink (:origin rpc-util/*req*)))
       (min level READ)
       level))))

(defn has-ambient-level?
  ([tables table-id required-level] (has-ambient-level? tables table-id required-level false))
  ([tables table-id required-level request-overrides]
   (let [my-level (get-ambient-level tables table-id request-overrides)]
     (and my-level (>= my-level required-level)))))


(defn- throw-permission-denied!
  ([] (throw-permission-denied! nil nil nil nil false))
  ([tables table-id required-level row? request-overrides]
   (let [name (get-in tables [table-id :name])
         name (if name (str " table '" name "'") " this table")]
     (throw+ {:anvil/server-error (str "Cannot " (condp = required-level WRITE "write to" READ "read from" "access") (when row? " row from") name " from "
                                       (if (or rpc-util/*client-request?* (get request-overrides :use_client_config)) "client" "server") " code.")
              :type               "anvil.server.PermissionDenied"
              :docId              "data_tables_permissions"
              :docLinkTitle       "Learn about Data Table permissions"}))))

(defn- ensure-access! [tables table-id perm required-level row? request-overrides]
  (when-not (or (>= (perm-to-access perm) required-level)
                (has-ambient-level? tables table-id required-level request-overrides))
    (throw-permission-denied! tables table-id required-level row? request-overrides)))

(defn ensure-combined-storage!
  ([storage]
   (when (:split storage)
     (throw+ (-> (tables-util/general-tables-error "This operation is not yet supported on split tables")
                 (assoc :log-stack-trace true)))))
  ([tables table-id]
   (ensure-combined-storage! (get-in tables [table-id :storage]))))

(defn generate-column-id []
  (.replace (random/base64 8) \/ \_))

(defn str-view-key [{:keys [id perm cols restrict] :as view-spec}]
  (->> view-spec
       (into (sorted-map))
       (util/write-json-str)))

(def table-scope ["_" "t" :ANY])
(def row-scope ["_" "t" :ANY {:r :ANY}])
(def search-scope ["_" "t" :ANY {:search :ANY, :fetch :ANY, :order :ANY, :chunk :ANY} :ANY])
(def scope-type {:table table-scope :row row-scope :search search-scope})

(defn unwrap-cap [cap type]
  {:pre [(#{:table :row :search} type)]}
  (let [scope (get scope-type type)
        [_ _ & unwrapped] (types/unwrap-capability cap scope)]
    unwrapped))

(defn unwrap-cap-with-perm!
  ([tables cap type required-level] (unwrap-cap-with-perm! tables cap type required-level false))
  ([tables cap type required-level request-overrides]
   (when (and (= type :table) (nil? cap))
     (throw-permission-denied!))
   (let [[{:keys [id perm]} :as unwrapped] (unwrap-cap cap type)]
     (ensure-access! tables id perm required-level (= type :row) request-overrides)
     unwrapped)))

(defn encode-view-spec [view-spec]
  (if (contains? view-spec :restrict)
    (update view-spec :restrict #(some-> % util/write-json-str))
    view-spec))

(defn decode-view-spec [{:keys [restrict] :as encoded-view-spec}]
  (if (string? restrict)
    (update encoded-view-spec :restrict util/read-json-str)
    encoded-view-spec))

(defn encode-search-spec [search-spec]
  (if (contains? search-spec :search)
    (update search-spec :search #(some-> % util/write-json-str))
    search-spec))

(defn decode-search-spec [{:keys [search] :as encoded-search-spec}]
  (if (string? search)
    (update encoded-search-spec :search util/read-json-str)
    encoded-search-spec))

(defn encode-cursor [cursor]
  (some-> cursor util/write-json-str))

(defn decode-cursor [encoded-cursor]
  (if (string? encoded-cursor)
    (util/read-json-str encoded-cursor)
    encoded-cursor))

(defn render-transmitted-value [table row-id row-data col]
  (let [json-value (get row-data (-> col :name keyword))]
    (table-types/render-column-value (:table-record table) row-id col json-value)))
