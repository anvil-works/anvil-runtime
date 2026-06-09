(ns anvil.runtime.tables.v2.rpc
  (:require
    [anvil.dispatcher.core :as dispatcher]
    [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
    [anvil.dispatcher.types :as types]
    [anvil.runtime.tables.util :as old-tables-util]
    [anvil.runtime.tables.v2.basic-ops :as basic-ops]
    [anvil.runtime.tables.v2.jdbc-trace :as jdbc-t]
    [anvil.runtime.tables.v2.search :as search-v2]
    [anvil.runtime.tables.v2.updates :as updates]
    [anvil.runtime.tables.v2.export :as export]
    [anvil.runtime.tables.v2.util :as util-v2 :refer [unwrap-cap-with-perm! encode-view-spec decode-view-spec encode-search-spec decode-search-spec encode-cursor decode-cursor]]
    [clojure.java.jdbc :as jdbc]
    [clojure.pprint :as pprint]
    [clojure.string :as string]
    [clojure.tools.logging :as log]
    [clj-commons.slingshot :refer :all]
    [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
    [clojure.data.json :as json]
    [anvil.util :as util]
    [anvil.runtime.tables.v2.search :as search]
    [medley.core :refer [remove-vals]]
    [clojure.set :as set]
    [anvil.runtime.tables.v2.query :as query]
    [anvil.runtime.tables.split.data :as split-data])
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


(defn get-table-by-id [_kws table-id]
  (let [tables (util-v2/get-tables)
        table-id (basic-ops/clean-table-id table-id)]
    (when (contains? tables table-id)
      (table-args table-id tables))))

(defn table-list-columns [_kws table-cap]
  (let [tables (util-v2/get-tables)
        {:keys [id cols]} (-> (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
                              (first)
                              (decode-view-spec))
        all-cols (get-in tables [id :columns])
        all-cols (if rpc-util/*client-request?*
                   (remove-vals :client_hidden all-cols)
                   all-cols)
        available-cols (->> (if cols
                              (select-keys all-cols cols)
                              all-cols)
                            (sort-by (fn [[name col]] name))
                            (sort-by (fn [[name col]] (:ui-order col))))]
    (for [[name col] available-cols]
      (-> (select-keys col [:id :type :table_id :client_hidden])
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

(defn- backcompat-request-overrides [request-overrides]
  ;; Older versions of downlink/uplink code just passed a boolean called "treat-as-client-request?". We now have
  ;; a more complex map of flags. To be compatible with old code, we translate a boolean as
  ;; {:use_client_config <value>}. This will not help us with client-hidden columns, but if the requesting code is that
  ;; old it can't preserve those security boundaries anyway.
  (if (boolean? request-overrides)
    {:use_client_config request-overrides}
    request-overrides))

(defn table-get-view [_kws table-cap new-perm _only-cols query-args query-kws]
  (let [tables (util-v2/get-tables)
        {table-id :id :keys [cols perm restrict]} (-> (util-v2/unwrap-cap table-cap :table)
                                                      (first)
                                                      (decode-view-spec))
        current-cols (basic-ops/get-col-names-removing-client-hidden table-id tables cols)
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
                       (query/parse-query tables table-id allowed-cols query-args query-kws))
        combined-restrict (if (and restrict new-restrict)
                            (query/both-queries restrict new-restrict)
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
        cols (basic-ops/get-col-names-removing-client-hidden id tables cols)
        [search-options query-args] (search-v2/get-search-options tables view-spec search-args)
        query (query/parse-query tables id (set cols) query-args query-kws)]
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

(defn- do-add-rows [tables {table-id :id :keys [perm cols] :as view-spec} row-dicts request-overrides]
  (let [new-row-ids (updates/do-insert! (db) (quota-ctx) (can-auto-create?) tables view-spec row-dicts request-overrides)]
    [(for [row-id new-row-ids]
       [row-id (types/->Capability ["_" "t" (encode-view-spec view-spec) {:r row-id}])])
     (basic-ops/get-table-spec table-id tables perm nil cols)]))


(defn- table-add-rows
  ([_kw table-cap row-dicts] (table-add-rows _kw table-cap row-dicts nil))
  ([_kw table-cap row-dicts request-overrides]
   (let [tables (util-v2/get-tables)
         [encoded-view-spec] (unwrap-cap-with-perm! tables table-cap :table util-v2/WRITE request-overrides)
         view-spec (decode-view-spec encoded-view-spec)]
     (do-add-rows tables view-spec row-dicts request-overrides))))

;; trusted doesn't make sense in the table-add-rows function
;; because there's no _do_create_rows and no batching of add-row
;; first we check the row-dict items are valid - i.e. check if they are trying to update client-hidden-columns
;; then we merge the row-dict with the trusted-row-dict before calling the do-add-rows function
(defn- do-table-add-row [tables table-cap row-dict request-overrides trusted-row-dict]
  (let [request-overrides (backcompat-request-overrides request-overrides)
        [encoded-view-spec] (unwrap-cap-with-perm! tables table-cap :table util-v2/WRITE request-overrides)
        view-spec (decode-view-spec encoded-view-spec)
        _ (when (or trusted-row-dict (:filter_client_hidden request-overrides))
            (doseq [kv row-dict]
              (updates/ensure-valid-column-for-update tables view-spec request-overrides kv)))
        row-dict (merge row-dict trusted-row-dict)
        request-overrides (dissoc request-overrides :filter_client_hidden)
        [[[row-id cap]] table-spec] (do-add-rows tables view-spec [row-dict] request-overrides)]
    [row-id cap table-spec]))

(defn table-add-row
  ([_kws table-cap row-dict] (table-add-row _kws table-cap row-dict nil))
  ([_kws table-cap row-dict request-overrides] (table-add-row _kws table-cap row-dict request-overrides nil))
  ([_kws table-cap row-dict request-overrides trusted-row-dict]
   (let [tables (util-v2/get-tables)]
     (do-table-add-row tables table-cap row-dict request-overrides trusted-row-dict))))

(defn row-update
  ([_kw row-cap values] (row-update _kw row-cap values nil))
  ([_kw row-cap values request-overrides]
   (let [tables (util-v2/get-tables)
         request-overrides (backcompat-request-overrides request-overrides)
         [encoded-view-spec encoded-search-spec] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE request-overrides)
         {table-id :id :keys [perm cols] :as view-spec} (decode-view-spec encoded-view-spec)
         {row-id :r} (decode-search-spec encoded-search-spec)]
        ;; include treat as client request in this update
     (updates/do-update! (db) (quota-ctx) (can-auto-create?) tables view-spec [{:row-id row-id :values values :request-overrides request-overrides}])
     (basic-ops/get-table-spec table-id tables perm nil cols))))

(defn row-batch-update [_kws updates]
  (let [tables (util-v2/get-tables)
        indexed-updates (map-indexed (fn [idx [row-cap update request-overrides]]
                                       (let [request-overrides (backcompat-request-overrides request-overrides)
                                             [encoded-view-spec encoded-search-spec] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE request-overrides)
                                             {table-id :id :keys [perm cols] :as view-spec} (decode-view-spec encoded-view-spec)
                                             {row-id :r} (decode-search-spec encoded-search-spec)]
                                         {:index idx :view-spec view-spec :row-id row-id :values update :request-overrides request-overrides}))
                                     updates)
        grouped-updates (group-by :view-spec indexed-updates)]
    (reduce (fn [acc [view-spec updates]]
              ;; Perform updates for each group and collect table-spec
              (let [table-spec (do
                                 (updates/do-update! (db) (quota-ctx) (can-auto-create?) tables view-spec updates)
                                 (basic-ops/get-table-spec (:id view-spec) tables (:perm view-spec) nil (:cols view-spec)))]
                ;; Place the table-spec in the accumulator at the correct indices
                (reduce (fn [acc {:keys [index]}]
                          (assoc acc index table-spec))
                        acc
                        updates)))
            (vec (repeat (count updates) nil))
            grouped-updates)))

(defn row-batch-delete-2 [_kw row-caps]
  (let [tables (util-v2/get-tables)
        all-deletions (->> (for [[row-cap request-overrides] row-caps
                                 :let [request-overrides (backcompat-request-overrides request-overrides)
                                       [encoded-view-spec encoded-search-spec] (unwrap-cap-with-perm! tables row-cap :row util-v2/WRITE request-overrides)
                                       {row-id :r} (decode-search-spec encoded-search-spec)]]
                             {:view-spec (decode-view-spec encoded-view-spec), :row-id row-id})
                           (group-by :view-spec))]
    (doseq [[view-spec deletions] all-deletions]
      (updates/do-delete! (db) (quota-ctx) tables view-spec (map :row-id deletions)))))

(defn row-batch-delete-1 [_kw row-caps]
  "A compatibility shim for pre-models code that doesn't know to pass [row-cap request-overrides] pairs"
  (row-batch-delete-2 _kw (for [rc row-caps] [rc nil])))

(defn row-delete
  ([_kws row-cap] (row-delete _kws row-cap nil))
  ([_kws row-cap request-overrides]
   (row-batch-delete-2 _kws [[row-cap request-overrides]])))

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

(defn validate-fetch-request [fetch-request]
  (when fetch-request
    (if (and (instance? SerializedPythonObject fetch-request) (= (:type fetch-request) "anvil.tables.fetch_only"))
      (:spec (:value fetch-request))
      (throw+ (util-v2/general-tables-error (str "Expected a q.fetch_only() object"))))))

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
        {table-id :id :as view-spec} (-> (unwrap-cap-with-perm! tables table-cap :table util-v2/READ)
                                         (first)
                                         (decode-view-spec))
        row-id (basic-ops/validate-clean-row-id row-id table-id)]
    (basic-ops/table-has-row? tables (db) view-spec row-id)))

(defn- get-csv-lazy-media [tables {table-id :id :keys [cols restrict] :as _view-spec} query escape-for-excel?]
  (let [query (query/both-queries restrict query)
        ;; Enforce client_hidden filtering for client-originated CSV exports only.
        ;; Server-side exports should preserve their existing column semantics.
        cols (if rpc-util/*client-request?*
               (basic-ops/get-col-names-removing-client-hidden table-id tables cols)
               cols)]
    (lazy-media/mk-LazyMedia-with-correct-mac {:manager   "query-csv-v2", :id (util/write-json-str [table-id query cols escape-for-excel?]),
                                               :mime-type "text/csv", :name (export/get-csv-filename tables table-id)}
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
        {:keys [search]} (decode-search-spec encoded-search-spec)
        view-spec (decode-view-spec encoded-view-spec)]
    (get-csv-lazy-media tables view-spec search escape_for_excel)))

(defn serve-csv-lazy-media [media-id]
  (let [tables (util-v2/get-tables)
        [table-id query cols escape-for-excel?] (json/read-str media-id :key-fn keyword)]
    (export/serve-query-csv-lazy-media tables (db) table-id query cols escape-for-excel?)))

(defn serve-split-table-media [media-id]
  (let [[table-id row-id col-id] (util/read-json-str media-id)]
    (or (when-let [table-record (old-tables-util/load-table-record (db) table-id)]
          (split-data/get-media-with-data (db) table-record row-id col-id))
        (throw (util-v2/general-tables-error "Media object deleted")))))

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
   "anvil.private.tables.v2.row.batch_delete"      (wrap-native-fn row-batch-delete-1)
   "anvil.private.tables.v2.row.batch_delete_2"    (wrap-native-fn row-batch-delete-2)
   "anvil.private.tables.v2.row.delete"            (wrap-native-fn row-delete)
   "anvil.private.tables.v2.row.batch_update"      (wrap-native-fn row-batch-update)

   "anvil.record_schema.get/anvil.tables"          (wrap-native-fn get-table-schema)})

(swap! dispatcher/native-rpc-handlers merge tables-v2-rpc-handlers)
(swap! dispatcher/db-only-native-rpc-handlers merge tables-v2-rpc-handlers)

(swap! lazy-media/managers merge
       {"query-csv-v2" (rpc-util/wrap-lazy-media-server serve-csv-lazy-media)
        "table-media-s" (rpc-util/wrap-lazy-media-server serve-split-table-media)})
