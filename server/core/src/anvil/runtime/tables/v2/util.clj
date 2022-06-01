(ns anvil.runtime.tables.v2.util
  (:require [slingshot.slingshot :refer :all]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.types :as types]
            [anvil.runtime.tables.v2.table-types :as table-types]
            [crypto.random :as random]
            [anvil.util :as util]))

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
   (into {::table-mapping table-mapping}
         (for [{:keys [table_id columns client server] :as tbl} (tables-util/get-all-table-access-records table-mapping)]
           (let [columns (for [[id column] columns]
                           (-> (table-types/get-type-from-db-column column)
                               (assoc :name (:name column) :id (util/preserve-slashes id))))]
             [table_id (-> (select-keys tbl [:name :python_name])
                           (assoc :columns (into {} (for [col columns]
                                                      [(:name col) col]))
                                  :client (level-from-str client)
                                  :server (level-from-str server)))])))))

(defn typemap-from-column [col]
  (select-keys col [:type :table_id]))

(defn get-ambient-level [tables table-id]
  (get-in tables [table-id (if rpc-util/*client-request?* :client :server)]))

(defn has-ambient-level? [tables table-id required-level]
  (let [my-level (get-ambient-level tables table-id)]
    (and my-level (>= my-level required-level))))


(defn- throw-permission-denied!
  ([] (throw-permission-denied! nil nil nil nil))
  ([tables table-id required-level row?]
   (let [name (get-in tables [table-id :name])
         name (if name (str " table '" name "'") " this table")]
     (throw+ {:anvil/server-error (str "Permission denied: Cannot " (condp = required-level WRITE "write to" READ "read from" "access") (when row? " row from") name " from "
                                       (if rpc-util/*client-request?* "client" "server") " code.")
              :docId              "data_tables_permissions"
              :docLinkTitle       "Learn about Data Table permissions"}))))

(defn- ensure-access! [tables table-id perm required-level row?]
  (when-not (or (>= (perm-to-access perm) required-level)
                (has-ambient-level? tables table-id required-level))
    (throw-permission-denied! tables table-id required-level row?)))

(defn ensure-table-permission! [tables table-cap required-level]
  (if (nil? table-cap)
    (throw-permission-denied!)
    (let [[_ _ {:keys [id perm]}] (types/unwrap-capability table-cap ["_" "t" :ANY])]
      (ensure-access! tables id perm required-level false))))

(defn ensure-row-permission! [tables row-cap required-level]
  (let [[_ _ {:keys [id perm]} _] (types/unwrap-capability row-cap ["_" "t" :ANY {:r :ANY}])]
    (ensure-access! tables id perm required-level true)))

(defn ensure-search-permission! [tables search-cap required-level]
  (let [search-scope ["_" "t" :ANY {:search :ANY, :fetch :ANY, :order :ANY, :chunk :ANY} :ANY]
        [_ _ {:keys [id perm]} _] (types/unwrap-capability search-cap search-scope)]
    (ensure-access! tables id perm required-level false)))

(defn get-default-view-cols [tables table-id restrictions]
  (let [columns (get-in tables table-id :columns)
        col-names (keys columns)]
    (when-not (= ()))))

(defn generate-column-id []
  (.replace (random/base64 8) \/ \_))

(defn str-view-key [{:keys [id perm cols restrict] :as view-spec}]
  (->> view-spec
       (into (sorted-map))
       (util/write-json-str)))
