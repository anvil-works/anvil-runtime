(ns anvil.runtime.tables.v2.util
  (:require [clojure.tools.logging :as log]
            [slingshot.slingshot :refer :all]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.types :as types]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [crypto.random :as random]
            [anvil.util :as util]))

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


(defn get-tables
  "Get all available tables in a useful format"
  ;; TODO cache this in the session, and invalidate on table change
  ([] (get-tables (tables-util/table-mapping-for-environment rpc-util/*environment*)))
  ([table-mapping]
   (log/debug "Get tables for " table-mapping)
   (into {::table-mapping table-mapping}
         (for [{:keys [table_id columns client server] :as tbl} (tables-util/get-all-table-access-records table-mapping)]
           (let [columns (for [[id column] columns]
                           (-> (table-types/get-type-from-db-column column)
                               (assoc :name (:name column)
                                      :id (util/preserve-slashes id)
                                      :ui-order (get-in column [:admin_ui :order]))))]
             [table_id (-> (select-keys tbl [:name :python_name])
                           (assoc :columns (into {} (for [col columns]
                                                      [(:name col) col]))
                                  :client (level-from-str client)
                                  :server (level-from-str server)))])))))

(defn typemap-from-column [col]
  (select-keys col [:type :table_id]))

(defn get-ambient-level [tables table-id]
  (let [level (get-in tables [table-id (if rpc-util/*client-request?* :client :server)])]
    (if (and level (= :db-read-uplink (:origin rpc-util/*req*)))
      (min level READ)
      level)))

(defn has-ambient-level? [tables table-id required-level]
  (let [my-level (get-ambient-level tables table-id)]
    (and my-level (>= my-level required-level))))


(defn- throw-permission-denied!
  ([] (throw-permission-denied! nil nil nil nil))
  ([tables table-id required-level row?]
   (let [name (get-in tables [table-id :name])
         name (if name (str " table '" name "'") " this table")]
     (throw+ {:anvil/server-error (str "Cannot " (condp = required-level WRITE "write to" READ "read from" "access") (when row? " row from") name " from "
                                       (if rpc-util/*client-request?* "client" "server") " code.")
              :type               "anvil.server.PermissionDenied"
              :docId              "data_tables_permissions"
              :docLinkTitle       "Learn about Data Table permissions"}))))

(defn- ensure-access! [tables table-id perm required-level row?]
  (when-not (or (>= (perm-to-access perm) required-level)
                (has-ambient-level? tables table-id required-level))
    (throw-permission-denied! tables table-id required-level row?)))

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

(defn unwrap-cap-with-perm! [tables cap type required-level]
  (when (and (= type :table) (nil? cap))
    (throw-permission-denied!))
  (let [[{:keys [id perm]} :as unwrapped] (unwrap-cap cap type)]
    (ensure-access! tables id perm required-level (= type :row))
    unwrapped))

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
