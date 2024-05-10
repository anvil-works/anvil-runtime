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
    [anvil.runtime.tables.v2.util :as util-v2 :refer [unwrap-cap-with-perm! encode-view-spec decode-view-spec encode-search-spec decode-search-spec encode-cursor decode-cursor]]
    [clojure.java.jdbc :as jdbc]
    [clojure.pprint :as pprint]
    [clojure.string :as string]
    [clojure.tools.logging :as log]
    [slingshot.slingshot :refer :all]
    [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
    [clojure.data.json :as json]
    [anvil.util :as util]
    [anvil.runtime.tables.v2.search :as search]
    [clojure.set :as set])
  (:import (anvil.dispatcher.types SerializedPythonObject)))

(clj-logging-config.log4j/set-logger! "anvil.runtime.tables.v2.rpc" :level :info)

(defn- db [] (old-tables-util/db))
(defn- quota-ctx [] {:session-state rpc-util/*session-state*, :environment rpc-util/*environment*})

(defn- table-args [table-id tables]
  [(when (util-v2/has-ambient-level? tables table-id util-v2/READ)
     (types/->Capability ["_" "t" {:id table-id}]))
   (util-v2/str-view-key {:id table-id})
   table-id])

(defn get-service-config []
  (first (filter #(= (:source %) "/runtime/services/tables.yml") (:services rpc-util/*app*))))

(defn can-auto-create? []
  (-> (if-let [config (get-service-config)]
        (merge (:client_config config) (:server_config config))
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
          {:keys [id cols]} (-> (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
                                (first)
                                (decode-view-spec))
          all-cols (get-in tables [id :columns])
          available-cols (->> (if cols
                                (select-keys all-cols cols)
                                all-cols)
                              (sort-by (fn [[name col]] name))
                              (sort-by (fn [[name col]] (:ui-order col))))]
      (for [[name col] available-cols]
        (-> (select-keys col [:id :type :table_id])
            (assoc :name name)))))

(defn- equality-val? [v]
  (not (and (instance? SerializedPythonObject v)
            (not= (:type v) "anvil.tables.v2._RowRef"))))

(defn- get-new-cap-cols [allowed-cols query-kws current-cap-cols]
  ;; we already know that all the query kws are valid from parsing the query earlier
  (let [new-cols (reduce-kv (fn [s k v]
                              (if (equality-val? v)
                                (disj s (name k))
                                s))
                            allowed-cols query-kws)]
    (if (identical? allowed-cols new-cols)
      current-cap-cols
      (sort new-cols))))

(defn validate-only-cols! [only-cols allowed-cols is-view]
  (when-not (vector? only-cols)
    (throw+ (util-v2/general-tables-error "invalid query argument for q.only_cols")))
  (if (every? allowed-cols only-cols)
    only-cols
    (throw+ (util-v2/general-tables-error
              (str "Column " (->> only-cols
                                  (remove allowed-cols)
                                  (string/join ", "))
                   (if is-view " is not available in this view" " does not exist in this table"))))))

(defn- only-cols-from-arg [allowed-cols arg is-view]
  (when (and (instance? SerializedPythonObject arg) (= (:type arg) "anvil.tables.query.only_cols"))
    (-> arg
        :value
        :cols
        (validate-only-cols! allowed-cols is-view)
        sort)))

(defn- get-only-cols [allowed-cols query-args is-view]
  (reduce (fn [[only-cols query-args] arg]
            (if-let [new-only-cols (only-cols-from-arg allowed-cols arg is-view)]
              [new-only-cols query-args]
              [only-cols (conj query-args arg)]))
          [nil []] query-args))

(defn table-get-view [_kws table-cap new-perm _only-cols query-args query-kws]
  (let [tables (util-v2/get-tables)
        {table-id :id :keys [cols perm restrict]} (-> (util-v2/unwrap-cap table-cap :table)
                                                      (first)
                                                      (decode-view-spec))
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

        _ (when (and (= new-perm "rwc") rpc-util/*client-request?*)
            (throw+ (util-v2/general-tables-error (str "Cannot create cascading writable view on the client."))))

        ;; 2. Parse the query to validate the query-args and query-kws
        allowed-cols (set current-cols)
        ;; extract and validate q.only-cols from the query args - (last writer wins)
        [only-cols query-args] (get-only-cols allowed-cols query-args cols)

        new-restrict (when (or query-args query-kws)
                       ;; Restrictions can apply to any cols accessible in the *parent* table/view (ie current-cols)
                       (search-v2/parse-query tables table-id allowed-cols query-args query-kws))
        combined-restrict (if (and restrict new-restrict)
                            (search-v2/both-queries restrict new-restrict)
                            (or restrict new-restrict))

        ;; 3. Great, the query is valid - get the new-cap-cols only-if there were no q.only_cols() defined in the query-args
        new-cap-cols (or only-cols (get-new-cap-cols allowed-cols query-kws cols))

        new-view-spec (merge {:id table-id :perm new-perm}
                             (when new-cap-cols {:cols new-cap-cols})
                             (when combined-restrict {:restrict combined-restrict}))
        new-cap (types/->Capability ["_" "t" (encode-view-spec new-view-spec)])]
    [new-cap (util-v2/str-view-key new-view-spec)]))

(defn table-delete-all [_kw cap]
  (let [tables (util-v2/get-tables)
        view-spec (-> (unwrap-cap-with-perm! tables cap :table util-v2/WRITE)
                      (first)
                      (decode-view-spec))]
    (updates/delete-from-query! (db) (quota-ctx) tables view-spec nil)))

(def CHUNK-SIZE 100)

(defn search-get-page [_kws cap & _args]
  (let [tables (util-v2/get-tables)
        [encoded-view-spec encoded-search-spec encoded-cursor] (util-v2/unwrap-cap cap :search)
        {:keys [search fetch order chunk]} (decode-search-spec encoded-search-spec)
        chunk-size (or chunk CHUNK-SIZE)
        [table-data row-ids cursor] (search-v2/get-page tables (db) (decode-view-spec encoded-view-spec) fetch search order chunk-size (decode-cursor encoded-cursor))]
    [row-ids (when cursor (types/->Capability ["_" "t" encoded-view-spec encoded-search-spec (encode-cursor cursor)])) table-data]))

(defn search-get-length [_kws cap]
  (let [tables (util-v2/get-tables)
        [encoded-view-spec encoded-search-spec] (util-v2/unwrap-cap cap :search)
        {:keys [search]} (decode-search-spec encoded-search-spec)]
    (search-v2/count-rows tables (db) (decode-view-spec encoded-view-spec) search)))

(defn search-delete [_kw cap]
  (let [tables (util-v2/get-tables)
        [encoded-view-spec encoded-search-spec] (unwrap-cap-with-perm! tables cap :search util-v2/WRITE)
        {:keys [search]} (decode-search-spec encoded-search-spec)]
    (updates/delete-from-query! (db) (quota-ctx) tables (decode-view-spec encoded-view-spec) search)))

(defn- setup-search [table-cap search-args query-kws]
  (let [tables (util-v2/get-tables)
        {:keys [id cols] :as view-spec} (-> (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
                                            (first)
                                            (decode-view-spec))
        _ (assert id)
        cols (basic-ops/get-col-names id tables cols)
        [search-options query-args] (search-v2/get-search-options tables view-spec search-args)
        query (search-v2/parse-query tables id (set cols) query-args query-kws)]
    {:tables tables, :table-id id, :view-spec view-spec :search-options search-options, :query query}))

(defn- mk-search-cap [{:keys [query view-spec search-options]} cursor]
  (let [{:keys [order-by chunk-size fetch-request]} search-options]
    (as-> {:search query :fetch fetch-request} search-spec
          (assoc search-spec :order order-by :chunk chunk-size)
          (types/->Capability ["_" "t" (encode-view-spec view-spec) (encode-search-spec search-spec) (encode-cursor cursor)]))))

(defn table-search [_kws table-cap search-args query-kws]
  (let [{:keys [tables view-spec query search-options] :as search-info} (setup-search table-cap search-args query-kws)
        {:keys [order-by chunk-size fetch-request]} search-options
        chunk-size (or chunk-size CHUNK-SIZE)
        [table-data row-ids cursor] (search-v2/get-page tables (db) view-spec fetch-request query order-by chunk-size nil)]
    [row-ids (mk-search-cap search-info nil) (when cursor (mk-search-cap search-info cursor)) table-data]))

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
        [encoded-view-spec] (unwrap-cap-with-perm! tables table-cap :table util-v2/WRITE)
        {table-id :id :keys [perm cols] :as view-spec} (decode-view-spec encoded-view-spec)
        new-row-ids (updates/do-insert! (db) (quota-ctx) (can-auto-create?) tables view-spec rows)]
    [(for [row-id new-row-ids]
       [row-id (types/->Capability ["_" "t" encoded-view-spec {:r row-id}])])
     (basic-ops/get-table-spec table-id tables perm nil cols)]))

(defn table-add-row [_kws table-cap row]
  (let [[[[row-id cap]] table-spec] (table-add-rows _kws table-cap [row])]
    [row-id cap table-spec]))

(defn row-update [_kw row-cap values]
  (let [tables (util-v2/get-tables)
        [encoded-view-spec encoded-search-spec] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE)
        {row-id :r} (decode-search-spec encoded-search-spec)]
    (updates/do-update! (db) (quota-ctx) (can-auto-create?) tables (decode-view-spec encoded-view-spec) [{:row-id row-id :values values}])
    nil))

(defn row-batch-update [_kw updates]
  (let [tables (util-v2/get-tables)
        all-updates (->> (for [[row-cap update] updates
                               :let [[encoded-view-spec encoded-search-spec] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE)
                                     {row-id :r} (decode-search-spec encoded-search-spec)]]
                           {:view-spec (decode-view-spec encoded-view-spec) :row-id row-id :values update})
                         (group-by :view-spec))]
    (doseq [[view-spec updates] all-updates]
      (updates/do-update! (db) (quota-ctx) (can-auto-create?) tables view-spec updates))))

(defn row-batch-delete [_kw row-caps]
  (let [tables (util-v2/get-tables)
        all-deletions (->> (for [row-cap row-caps
                                 :let [[encoded-view-spec encoded-search-spec] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE)
                                       {row-id :r} (decode-search-spec encoded-search-spec)]]
                             {:view-spec (decode-view-spec encoded-view-spec), :row-id row-id})
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
        [encoded-view-spec {row-id :r}] (util-v2/unwrap-cap row-cap :row)]
    (if-let [table-data (do-row-fetch tables (decode-view-spec encoded-view-spec) row-id col-names)]
      table-data
      (throw+ (util-v2/general-tables-error "This row has been deleted" "anvil.tables.RowDeleted")))))

(defn- validate-fetch-request [fetch-request]
  (when fetch-request
    (if (and (instance? SerializedPythonObject fetch-request) (= (:type fetch-request) "anvil.tables.fetch_only"))
      (:spec (:value fetch-request))
      (throw+ (util-v2/general-tables-error "The second argument to get_by_id() should be a q.fetch_only() object")))))

(defn table-get-row-by-id [{fetch-request :fetch :as _kws} table-cap row-id]
  (let [tables (util-v2/get-tables)
        {table-id :id :as view-spec} (-> (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
                                         (first)
                                         (decode-view-spec))
        row-id (basic-ops/validate-clean-row-id row-id table-id)
        requested-cols (validate-fetch-request fetch-request)]
    (when row-id
      (when-let [table-data (do-row-fetch tables view-spec row-id requested-cols)]
        ;; we need to return the row-id since we've cleaned it
        [row-id table-data]))))

(defn table-has-row? [_kw table-cap row-id]
  (let [tables (util-v2/get-tables)
        {table-id :id} (-> (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
                           (first)
                           (decode-view-spec))
        row-id (basic-ops/validate-clean-row-id row-id table-id)]
    (boolean (when row-id
               (seq (jdbc/query (db) ["SELECT 1 FROM app_storage_data WHERE table_id=? AND id=?" table-id row-id]))))))

(defn- get-csv-lazy-media [tables {table-id :id :keys [cols restrict] :as _view-spec} query escape-for-excel?]
  (let [cols (or cols (keys (get-in tables [table-id :columns])))
        query (if (and restrict query) (search/both-queries restrict query) (or restrict query))]
    (lazy-media/mk-LazyMedia-with-correct-mac {:manager   "query-csv-v2", :id (util/write-json-str [table-id query cols escape-for-excel?]),
                                               :mime-type "text/csv", :name (csv/get-csv-filename tables table-id)}
                                              rpc-util/*req*)))

(defn table-to-csv [{:keys [escape_for_excel]} table-cap]
  (let [tables (util-v2/get-tables)
        view-spec (-> (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
                      (first)
                      (decode-view-spec))]
    (get-csv-lazy-media tables view-spec nil escape_for_excel)))

(defn search-to-csv [{:keys [escape_for_excel]} search-cap]
  (let [tables (util-v2/get-tables)
        [encoded-view-spec encoded-search-spec] (util-v2/unwrap-cap search-cap :search)
        {:keys [search]} (decode-search-spec encoded-search-spec)]
    (get-csv-lazy-media tables (decode-view-spec encoded-view-spec) search escape_for_excel)))

(defn serve-csv-lazy-media [media-id]
  (let [tables (util-v2/get-tables)
        [table-id query cols escape-for-excel?] (json/read-str media-id :key-fn keyword)]
    (csv/serve-query-csv-lazy-media tables (db) table-id query cols escape-for-excel?)))

(defn get-table-schema [{:keys [_anvil_expose_all_for_designer] :as _kwargs}]
  (let [tables (dissoc (util-v2/get-tables) ::util-v2/table-mapping)
        server-config (-> (get-service-config) :server_config)
        available? (if (and (:allow-debug? rpc-util/*environment*) _anvil_expose_all_for_designer)
                     (constantly true)
                     (->> server-config :expose_record_types keys (map util/preserve-slashes) set))]
    {:name         "Data Tables"
     :description  "Tables from Anvil's built-in database"
     :record_types (for [[table-id {:keys [columns name python_name]}] (sort-by #(:name (second %)) tables)
                         :when (available? python_name)]
                     {:id     python_name,
                      :name   name
                      :fields (for [[name {:keys [type]}] (sort-by #(:ui-order (second %)) columns)]
                                {:key name
                                 :type (or (#{"string" "number" "bool" "date" "datetime" "media"} type)
                                           "object")})})}))

(defn- wrap-native-fn [f]
  (rpc-util/wrap-native-fn #(old-tables-util/with-transform-err (apply f %&)) :db-time))

(defn- NOT-IMPLEMENTED!
  ([] (NOT-IMPLEMENTED! nil))
  ([note] (throw+ (old-tables-util/general-tables-error (str "Not implemented" (when note (str ": " note)))))))

(def tables-v2-rpc-handlers
  {"anvil.private.tables.v2.get_app_tables"        (wrap-native-fn get-app-tables)
   "anvil.private.tables.v2.get_table_by_id"       (wrap-native-fn get-table-by-id)

   "anvil.private.tables.v2.table.get_view"        (wrap-native-fn table-get-view)
   "anvil.private.tables.v2.table.delete_all_rows" (wrap-native-fn table-delete-all)
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
   "anvil.private.tables.v2.row.batch_update"      (wrap-native-fn row-batch-update)

   "anvil.record_schema.get/anvil.tables"          (wrap-native-fn get-table-schema)})

(swap! dispatcher/native-rpc-handlers merge tables-v2-rpc-handlers)
(swap! dispatcher/db-only-native-rpc-handlers merge tables-v2-rpc-handlers)

(swap! lazy-media/managers assoc "query-csv-v2" (rpc-util/wrap-lazy-media-server serve-csv-lazy-media))
