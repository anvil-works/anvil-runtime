(ns anvil.runtime.tables.v2.rpc
  (:require
    [anvil.dispatcher.core :as dispatcher]
    [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
    [anvil.dispatcher.types :as types]
    [anvil.runtime.tables.util :as old-tables-util]
    [anvil.runtime.tables.v2.basic-ops :as basic-ops]
    [anvil.runtime.tables.v2.search :as search-v2]
    [anvil.runtime.tables.v2.updates :as updates]
    [anvil.runtime.tables.v2.csv :as csv]
    [anvil.runtime.tables.v2.util :as util-v2 :refer [unwrap-cap-with-perm!]]
    [clojure.java.jdbc :as jdbc]
    [clojure.pprint :as pprint]
    [clojure.string :as string]
    [clojure.tools.logging :as log]
    [slingshot.slingshot :refer :all]
    [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
    [clojure.data.json :as json]
    [anvil.util :as util]
    [anvil.runtime.tables.v2.search :as search])
  (:import (anvil.dispatcher.types SerializedPythonObject)))

(clj-logging-config.log4j/set-logger! :level :trace)

(defn- db [] (old-tables-util/db))
(defn- quota-ctx [] {:session-state rpc-util/*session-state*, :environment rpc-util/*environment*})

(defn- table-args [table-id tables]
  [(when (util-v2/has-ambient-level? tables table-id util-v2/READ)
     (types/->Capability ["_" "t" {:id table-id}]))
   (util-v2/str-view-key {:id table-id})
   table-id])

(defn can-auto-create? []
  (-> (if-let [props (first (filter #(= (:source %) "/runtime/services/tables.yml") (:services rpc-util/*app*)))]
        (merge (:client_config props) (:server_config props))
        nil)
      (:auto_create_missing_columns)))

(defn get-app-tables [_kwargs]
  (let [tables (util-v2/get-tables)]
    (reduce-kv (fn [app-tables table-id {python_name :python_name}]
                 (cond-> app-tables
                         (not (keyword? table-id))
                         (assoc python_name (table-args table-id tables))))
               {} tables)))

(defn get-table-by-id [_kwargs table-id]
  (let [tables (util-v2/get-tables)
        table-id (basic-ops/clean-table-id table-id)]
    (when (contains? tables table-id)
      (table-args table-id tables))))

(defn table-list-columns [_kwargs table-cap]
    (let [tables (util-v2/get-tables)
          [{:keys [id cols]}] (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
          all-cols (get-in tables [id :columns])]
      (for [[name col] (if cols
                         (select-keys all-cols cols)
                         all-cols)]
        (-> (select-keys col [:id :type :table_id])
            (assoc :name name)))))

(defn table-get-view [_kwargs table-cap new-perm only-cols query-args query-kwargs]
  (let [tables (util-v2/get-tables)
        [{table-id :id :keys [cols perm restrict]}] (util-v2/unwrap-cap table-cap :table)
        current-cols (basic-ops/get-col-names table-id tables cols)
        VIEW-NAMES {"rwc" "cascading writable", "rw" "read-write", "r" "read-only"}
        ;; Conditions for "are they allowed to do this?":
        ;; 1. The view-type is no more privileged than current permissions
        [required-perm required-ambient-level] (condp = new-perm
                                                 "rwc" [#{"rwc"} util-v2/WRITE]
                                                 "rw" [#{"rwc" "rw"} util-v2/WRITE]
                                                 "r" [#{"rwc" "rw" "r"} util-v2/READ]
                                                 (throw+ (util-v2/general-tables-error "Invalid view type")))
        has-required-permission? (if perm (contains? required-perm perm)
                                          (util-v2/has-ambient-level? tables table-id required-ambient-level))
        _ (when-not has-required-permission?
            (throw+ (util-v2/general-tables-error (str "You do not have permission to create a " (VIEW-NAMES new-perm) " view of this table here"))))

        ;; 2. The cols are no less restricted than the current column restriction.
        ;; If only-cols is nil then it inherits cols
        allowed-cols (set current-cols)
        new-cap-cols (cond
                       (nil? only-cols) cols
                       (every? allowed-cols only-cols) only-cols
                       :else (throw+ (util-v2/general-tables-error
                                       (str "Column " (->> only-cols
                                                           (remove allowed-cols)
                                                           (string/join ", "))
                                            (if cols " is not available in this view" " does not exist in this table")))))

        ;; Great, we're allowed. Create a new capability and view key, and return them.

        new-restrict (when (or query-args query-kwargs)
                       ;; Restrictions can apply to any cols accessible in the *parent* table/view (ie current-cols)
                       (search-v2/parse-query tables table-id allowed-cols query-args query-kwargs))
        combined-restrict (if (and restrict new-restrict)
                            (search-v2/both-queries restrict new-restrict)
                            (or restrict new-restrict))
        new-view-spec (merge {:id table-id :perm new-perm}
                             (when new-cap-cols {:cols new-cap-cols})
                             (when combined-restrict {:restrict combined-restrict}))
        new-cap (types/->Capability ["_" "t" new-view-spec])]
    [new-cap (util-v2/str-view-key new-view-spec)]))

(def CHUNK-SIZE 100)

(defn search-get-page [_kws cap & _args]
  (let [tables (util-v2/get-tables)
        [view-spec search-spec cursor] (util-v2/unwrap-cap cap :search)
        {:keys [search fetch order chunk]} search-spec
        chunk-size (or chunk CHUNK-SIZE)
        [table-data row-ids cursor] (search-v2/get-page tables (db) view-spec fetch search order chunk-size cursor)]
    [row-ids (when cursor (types/->Capability ["_" "t" view-spec search-spec cursor])) table-data]))

(defn search-get-length [_kws cap]
  (let [tables (util-v2/get-tables)
        [view-spec {:keys [search] :as _search-spec} _cursor] (util-v2/unwrap-cap cap :search)]
    (search-v2/count-rows tables (db) view-spec search)))

(defn search-delete [_kw cap]
  (let [tables (util-v2/get-tables)
        [view-spec {:keys [search]} _cursor] (unwrap-cap-with-perm! tables cap :search util-v2/WRITE)]
    (updates/delete-from-query! (db) tables view-spec search)))

(defn- setup-search [table-cap search-args query-kws]
  (let [tables (util-v2/get-tables)
        [{:keys [id cols restrict] :as view-spec}] (unwrap-cap-with-perm! tables table-cap :table util-v2/READ) 
        _ (assert id)
        cols (basic-ops/get-col-names id tables cols)
        [search-options query-args] (search-v2/get-search-options tables view-spec search-args)
        query (search-v2/parse-query tables id (set cols) query-args query-kws)]
    {:tables tables, :table-id id, :view-spec view-spec :search-options search-options, :query query}))

(defn- mk-search-cap [{:keys [query view-spec search-options]} cursor]
  (let [{:keys [order-by chunk-size fetch-request]} search-options]
    (as-> {:search query :fetch fetch-request} search-spec
          (assoc search-spec :order order-by :chunk chunk-size)
          (types/->Capability ["_" "t" view-spec search-spec cursor]))))

(defn table-search [_kws table-cap search-args query-kws]
  (let [{:keys [tables view-spec query search-options] :as search-spec} (setup-search table-cap search-args query-kws)
        {:keys [order-by chunk-size fetch-request]} search-options
        chunk-size (or chunk-size CHUNK-SIZE)
        [table-data row-ids cursor] (search-v2/get-page tables (db) view-spec fetch-request query order-by chunk-size nil)]
    [row-ids (mk-search-cap search-spec nil) (when cursor (mk-search-cap search-spec cursor)) table-data]))

(defn table-get-row [_kws table-cap search-args query-kws]
  (let [{:keys [tables search-options view-spec query]} (setup-search table-cap search-args query-kws)
        {:keys [fetch-request order-by chunk-size]} search-options
        _ (when (some some? [order-by chunk-size])
            (throw+ (util-v2/general-tables-error "Cannot specify ordering or pagination options with get()")))
        [table-data row-id] (search-v2/get-row tables (db) view-spec fetch-request query)]
    (when row-id
      [row-id table-data])))

(defn table-add-rows [_kw table-cap rows]
  (let [tables (util-v2/get-tables)
        [{table-id :id :keys [perm cols restrict] :as view-spec}] (unwrap-cap-with-perm! tables table-cap :table util-v2/WRITE)
        new-row-ids (updates/do-insert! (db) (quota-ctx) (can-auto-create?) tables view-spec rows)]
    [(for [row-id new-row-ids]
       [row-id (types/->Capability ["_" "t" view-spec {:r row-id}])])
     (basic-ops/get-table-spec table-id tables perm nil cols)]))

(defn table-add-row [_kws table-cap row]
  (let [[[[row-id cap]] table-spec] (table-add-rows _kws table-cap [row])]
    [row-id cap table-spec]))

(defn row-update [_kw row-cap values]
  (let [tables (util-v2/get-tables)
        [view-spec {row-id :r}] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE)]
    (updates/do-update! (db) (quota-ctx) (can-auto-create?) tables view-spec [{:row-id row-id :values values}])
    nil))

(defn row-batch-update [_kw updates]
  (let [tables (util-v2/get-tables)
        all-updates (->> (for [[row-cap update] updates
                               :let [[view-spec {row-id :r}] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE)]]
                           {:view-spec view-spec :row-id row-id :values update})
                         (group-by :view-spec))]
    (doseq [[view-spec updates] all-updates]
      (updates/do-update! (db) (quota-ctx) (can-auto-create?) tables view-spec updates))))

(defn row-batch-delete [_kw row-caps]
  (let [tables (util-v2/get-tables)
        all-deletions (->> (for [row-cap row-caps
                                 :let [[view-spec {row-id :r}] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE)]]
                             {:view-spec view-spec, :row-id row-id})
                           (group-by :view-spec))]
    (doseq [[view-spec deletions] all-deletions]
      (updates/do-delete! (db) (quota-ctx) tables view-spec (map :row-id deletions)))))

(defn do-row-fetch [tables {table-id :id :keys [cols] :as view-spec} row-id requested-cols]
  (let [{:keys [table-data primary-row-ids]} (basic-ops/get-row tables (db) view-spec row-id requested-cols)]
    ;;(log/trace "Fetch returns:" (with-out-str (pprint/pprint table-data)))
    (when (not-empty primary-row-ids)
      table-data)))

(defn row-fetch [_kw row-cap col-names]
  (let [tables (util-v2/get-tables)
        [view-spec {row-id :r}] (util-v2/unwrap-cap row-cap :row)]
    (if-let [table-data (do-row-fetch tables view-spec row-id col-names)]
      table-data
      (throw+ (util-v2/general-tables-error "This row has been deleted" "anvil.tables.RowDeleted")))))

(defn- validate-fetch-request [fetch-request]
  (when fetch-request
    (if (and (instance? SerializedPythonObject fetch-request) (= (:type fetch-request) "anvil.tables.fetch_only"))
      (:spec (:value fetch-request))
      (throw+ (util-v2/general-tables-error "The second argument to get_by_id() should be a q.fetch_only() object")))))

(defn table-get-row-by-id [{fetch-request :fetch :as _kws} table-cap row-id]
  (let [tables (util-v2/get-tables)
        [{table-id :id :as view-spec}] (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
        row-id (basic-ops/validate-clean-row-id row-id table-id)
        requested-cols (validate-fetch-request fetch-request)]
    (when row-id
      (when-let [table-data (do-row-fetch tables view-spec row-id requested-cols)]
        ;; we need to return the row-id since we've cleaned it
        [row-id table-data]))))

(defn table-has-row? [_kw table-cap row-id]
  (let [tables (util-v2/get-tables)
        [{table-id :id}] (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
        row-id (basic-ops/validate-clean-row-id row-id table-id)]
    (boolean (when row-id
               (seq (jdbc/query (db) ["SELECT 1 FROM app_storage_data WHERE table_id=? AND id=?" table-id row-id]))))))

(defn- get-csv-lazy-media [tables {table-id :id :keys [cols restrict] :as view-spec} query]
  (let [cols (or cols (keys (get-in tables [table-id :columns])))
        query (if (and restrict query) (search/both-queries restrict query) (or restrict query))]
    (lazy-media/mk-LazyMedia-with-correct-mac {:manager   "query-csv-v2", :id (util/write-json-str [table-id query cols]),
                                               :mime-type "text/csv", :name (csv/get-csv-filename tables table-id)}
                                              rpc-util/*req*)))

(defn table-to-csv [_kw table-cap]
  (let [tables (util-v2/get-tables)
        [view-spec] (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)]
    (get-csv-lazy-media tables view-spec nil)))

(defn search-to-csv [_kw search-cap]
  (let [tables (util-v2/get-tables)
        [view-spec {:keys [search] :as _search-spec} _cursor] (util-v2/unwrap-cap search-cap :search)]
    (get-csv-lazy-media tables view-spec search)))

(defn serve-csv-lazy-media [media-id]
  (let [tables (util-v2/get-tables)
        [table-id query cols] (json/read-str media-id :key-fn keyword)]
    (csv/serve-query-csv-lazy-media tables (db) table-id query cols)))

(defn- wrap-native-fn [f]
  (rpc-util/wrap-native-fn #(old-tables-util/with-transform-err (apply f %&)) :db-time))

(defn- NOT-IMPLEMENTED!
  ([] (NOT-IMPLEMENTED! nil))
  ([note] (throw+ (old-tables-util/general-tables-error (str "Not implemented" (when note (str ": " note)))))))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.tables.v2.get_app_tables"        (wrap-native-fn get-app-tables)
        "anvil.private.tables.v2.get_table_by_id"       (wrap-native-fn get-table-by-id)

        "anvil.private.tables.v2.table.get_view"        (wrap-native-fn table-get-view)
        "anvil.private.tables.v2.table.delete_all_rows" (wrap-native-fn (fn [_kws table-cap] (NOT-IMPLEMENTED!)))
        "anvil.private.tables.v2.table.add_rows"        (wrap-native-fn table-add-rows)
        "anvil.private.tables.v2.table.add_row"         (wrap-native-fn table-add-row)
        "anvil.private.tables.v2.table.get_row"         (wrap-native-fn table-get-row)
        "anvil.private.tables.v2.table.get_row_by_id"   (wrap-native-fn table-get-row-by-id)
        "anvil.private.tables.v2.table.has_row"         (wrap-native-fn table-has-row?)
        "anvil.private.tables.v2.table.list_columns"    (wrap-native-fn table-list-columns)
        "anvil.private.tables.v2.table.to_csv"          (wrap-native-fn table-to-csv)
        "anvil.private.tables.v2.table.search"          (wrap-native-fn table-search)

        "anvil.private.tables.v2.search.next_page"      (wrap-native-fn search-get-page)
        "anvil.private.tables.v2.search.slice"          (wrap-native-fn (fn [_kws search-cap start stop step] (NOT-IMPLEMENTED! "Need a cap on the whole search")))
        "anvil.private.tables.v2.search.index"          (wrap-native-fn (fn [_kws search-cap idx] (NOT-IMPLEMENTED! "Not documented what this is")))
        "anvil.private.tables.v2.search.to_csv"         (wrap-native-fn search-to-csv)
        "anvil.private.tables.v2.search.get_length"     (wrap-native-fn search-get-length)
        "anvil.private.tables.v2.search.delete_all"     (wrap-native-fn search-delete)


        "anvil.private.tables.v2.row.can_auto_create"   (wrap-native-fn (fn [_kws] (can-auto-create?)))
        "anvil.private.tables.v2.row.fetch"             (wrap-native-fn row-fetch)
        "anvil.private.tables.v2.row.update"            (wrap-native-fn row-update)
        "anvil.private.tables.v2.row.batch_delete"      (wrap-native-fn row-batch-delete)
        "anvil.private.tables.v2.row.delete"            (wrap-native-fn (fn [_kws row-cap] (row-batch-delete _kws [row-cap])))
        "anvil.private.tables.v2.row.batch_update"      (wrap-native-fn row-batch-update)}
       )

(swap! lazy-media/managers assoc "query-csv-v2" (rpc-util/wrap-lazy-media-server serve-csv-lazy-media))
