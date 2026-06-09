(ns anvil.runtime.tables.v2.basic-ops
  (:require
    [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
    [anvil.dispatcher.types :as types]
    [anvil.runtime.tables.v2.table-types :as table-types]
    [anvil.runtime.tables.v2.util :as util-v2]
    [anvil.util :as util]
    [clojure.java.jdbc :as jdbc]
    [anvil.runtime.tables.v2.jdbc-trace :as jdbc-t]
    [clojure.string :as str]
    [clojure.tools.logging :as log]
    [clj-commons.slingshot :refer :all]
    [clojure.string :as string]
    [medley.core :refer [indexed map-keys map-vals remove-vals]]
    [clojure.pprint :as pprint]
    [anvil.runtime.tables.v2.query :as query]
    [anvil.runtime.tables.split.sql :as split-sql]
    [anvil.runtime.tables.v2.sql-util :as sql-util]))

(clj-logging-config.log4j/set-logger! :level :trace)

(defn- get-all-cols-maybe-removing-client-hidden [tables table-id]
  (let [all-cols (get-in tables [table-id :columns])]
    (if rpc-util/*client-request?*
      (remove-vals :client_hidden all-cols)
      all-cols)))

(defn SELECT-COLUMNS [tables fetch-spec fetch-id]
  (let [{{table-id :id} :view-spec, :keys [fetching-cols] :as fs} (get-in fetch-spec [:fetches fetch-id])
        all-columns (get-all-cols-maybe-removing-client-hidden tables table-id)
        colspecs-to-fetch (for [cn fetching-cols] (get all-columns cn))
        {:keys [storage] :as table-record} (get-in tables [table-id :table-record])]

    (if (:split storage)
      [(sql-util/JSONB-BUILD-OBJECT (for [{:keys [type id] :as colspec} colspecs-to-fetch]
                                      (str "?, " (split-sql/TO-JSON-EXPR table-record id colspec true true))))
       (map :name colspecs-to-fetch)]

      [(sql-util/JSONB-BUILD-OBJECT (for [{:keys [type]} colspecs-to-fetch]
                                      (if (= type "media")
                                        (str "?, (SELECT to_jsonb(all_except_data) from (select " util-v2/MEDIA-INFO-COLS " from app_storage_media) all_except_data WHERE object_id = (data->>?)::text::bigint)")
                                        (str "?, data->?"))))
       (mapcat (fn [{:keys [name id]}] [name id]) colspecs-to-fetch)])))

(defn LOOKUP-ROW-QUERY [tables {table-id :id :keys [restrict] :as view-spec} row-id fetch-spec]
  (let [{:keys [storage] :as table-record} (get-in tables [table-id :table-record])
        [SELECT-EXPR select-params] (SELECT-COLUMNS tables fetch-spec 0)
        [RESTRICT-EXPR restrict-params] (when restrict (query/QUERY->SQL table-record restrict))]
    (if (:split storage)
      [(str "SELECT _id AS id, " SELECT-EXPR " AS rdata, 0 AS fid, 0 AS primary_order FROM " (split-sql/TABLE-NAME table-record) " WHERE _id = ? AND "
            (or RESTRICT-EXPR "TRUE"))
       (concat select-params [row-id] restrict-params)]
      [(str "SELECT id, " SELECT-EXPR " AS rdata, 0 AS fid, 0 AS primary_order FROM app_storage_data WHERE table_id = ? AND id = ? AND "
            (or RESTRICT-EXPR "TRUE"))
       (concat select-params [table-id row-id] restrict-params)])))

(defn LINK-FOLLOW-CTE [tables fetch-spec FETCH-ID]
  (let [{{:keys [fetch-id col-name link-type]} :link-from, {table-id :id} :view-spec} (get-in fetch-spec [:fetches FETCH-ID])
        {:keys [storage] :as table-record} (get-in tables [table-id :table-record])
        FROM-FETCH (str "fetch_" (int fetch-id))
        [COLUMN-SQL col-params] (SELECT-COLUMNS tables fetch-spec FETCH-ID)
        ID-COL (if (:split storage) "_id" "app_storage_data.id")
        FROM-TABLE (if (:split storage) (split-sql/TABLE-NAME table-record) "app_storage_data")
        [TABLE-ID-COND table-id-cond-args] (when-not (:split storage) ["WHERE app_storage_data.table_id=?" [table-id]])]

    (condp = link-type
      "link_single" [(str "fetch_" FETCH-ID " AS (SELECT " ID-COL " AS id, " COLUMN-SQL " AS rdata, " FETCH-ID " AS fid, NULL::integer AS primary_order "
                          " FROM " FROM-FETCH " JOIN " FROM-TABLE " ON "
                          ID-COL " = (((" FROM-FETCH ".rdata->?->>'id')::jsonb)->>1)::bigint "
                          TABLE-ID-COND ")")
                     (concat col-params [col-name] table-id-cond-args)]
      "link_multiple" [(str "fetch_" FETCH-ID " AS (SELECT " ID-COL " AS id, " COLUMN-SQL " AS rdata, " FETCH-ID " AS fid, NULL::integer AS primary_order "
                            " FROM (SELECT jsonb_array_elements(case jsonb_typeof(rdata->?) when 'array' then rdata->? else NULL end) AS lj FROM " FROM-FETCH ") AS links JOIN " FROM-TABLE " ON "
                            ID-COL " = (((lj->>'id')::jsonb)->>1)::bigint "
                            TABLE-ID-COND ")")
                       (concat col-params [col-name col-name] table-id-cond-args)])))

(defn- get-linked-row-id [link-json]
  (when link-json
    (-> link-json :id util/read-json-str second)))


(defn- clean-id [maybe-id index]
  (if-let [id (try (Long/parseLong (str maybe-id)) (catch Exception _e))]
    (assoc [nil nil] index id)
    (try (->> (re-matches #"^\[(\d+),(\d+)\]$" maybe-id)
              rest
              (map #(Long/parseLong %))
              seq) (catch Exception _e))))

(defn- clean-row-id [maybe-id]
  (clean-id maybe-id 1))

(defn clean-table-id [maybe-id]
  (first (clean-id maybe-id 0)))

(defn validate-clean-row-id [maybe-row-id table-cap-id]
  (let [[old-style-table-id row-id] (clean-row-id maybe-row-id)]
    (when (or (nil? old-style-table-id) (= old-style-table-id table-cap-id))
      row-id)))

(comment
  (validate-clean-row-id 1 4)
  (validate-clean-row-id "20" 4)
  (validate-clean-row-id "[1,5]" 1)
  (validate-clean-row-id "[1,5]" 4)
  (clean-table-id "[1,5]")
  (clean-table-id "foo")
  (clean-table-id 32))


(defn- get-linked-view-spec [table-id root-perm]
  ;; the linked table gets whatever the yaml says
  (if (= root-perm "rwc")
    {:id table-id :perm "rwc"}
    {:id table-id}))

(defn- get-linked-view-key [table-id root-perm]
  (if (= root-perm "rwc")
    (format "{\"id\":%s,\"perm\":\"rwc\"}" (util/write-json-str table-id))
    (format "{\"id\":%s}" (util/write-json-str table-id))))

(defn get-col-names-removing-client-hidden [table-id tables only-columns]
   ;; sort the names for consistent view specs
  (let [all-cols (get-all-cols-maybe-removing-client-hidden tables table-id)
        ordered-cols (sort (or only-columns (seq (keys all-cols))))]
   (if rpc-util/*client-request?*
     (filter all-cols ordered-cols)
     ordered-cols)))

(defn get-table-spec [table-id tables root-perm cached-columns only-columns]
  ;; cached columns is a set or nil
  (let [columns (get-all-cols-maybe-removing-client-hidden tables table-id)
        col-names (get-col-names-removing-client-hidden table-id tables only-columns)]
    {:cols  (for [c col-names
                  :let [{:keys [table_id] :as col-spec} (get columns c)]]
              (merge (select-keys col-spec [:name :type :table_id :client_hidden])
                     (when table_id
                       {:view_key (get-linked-view-key table_id root-perm)})))
     :cache (for [c col-names]
              (if (contains? cached-columns c) 1 0))}))


(defn- default-cols-to-fetch-removing-client-hidden [column-map]
  (if rpc-util/*client-request?*
    (keys (remove-vals :client_hidden column-map))
    (keys column-map)))
  ;; old behaviour ignores simpleObjects - can remove at some point
  ;;(for [[col-name {:keys [type]}] column-map
  ;;      :when (not= type "simpleObject")]
  ;;  col-name)


(defn- is-valid-and-visible? [cols column-map col-name]
  (let [col (column-map col-name)
        valid-cols (if cols (set cols) column-map)
        is-valid (valid-cols col-name)]
    (if rpc-util/*client-request?*
      (and is-valid col (not (:client_hidden col)))
      is-valid)))


(defn- check-requested-cols! [tables {table-id :id :keys [cols] :as view-spec} column-map requested-cols]
  (let [allowed? (partial is-valid-and-visible? cols column-map)]
    (->>
      (for [[col-name request] requested-cols
            :let [col-name (util/preserve-slashes col-name)]]
        (do
          (when-not (allowed? col-name)
            (throw+ (util-v2/general-tables-error
                      (str "No such column '" col-name "' exists in " (when cols (str "this view of "))
                           "table '" (get-in tables [table-id :name]) "'"))))
          (when request
            col-name)))
      (filter identity)
      (doall))))

;; If not specified, how many links do we walk?
(def DEFAULT-WALK-DEPTH 2)

(defn setup-table-cache [{:keys [table-data cache-cols] :as state} fetch-id fetching-cols {:keys [tables table-id view-spec root-perm]}]
  (let [cols (:cols view-spec)
        my-spec (get-table-spec table-id tables root-perm fetching-cols cols)
        ;; TODO kinda icky, we already compute this order in (get-table-spec). In fact, (get-table-spec) recomputes a *lot* here
        cache-order (->> (:cols my-spec) (map :name) (filter fetching-cols))
        already-fetching-cols (get-in cache-cols [view-spec :cache-set])]
    ;; Are we going to clash with another fetch of this view key?
    (cond

      (or (not already-fetching-cols) (= already-fetching-cols fetching-cols) (= already-fetching-cols #{}))
      (-> state
          (assoc-in [:table-data (util-v2/str-view-key view-spec) :spec] my-spec)
          (assoc-in [:cache-cols view-spec] {:cache-set fetching-cols :cache-order cache-order}))

      ;; There's already a cache specification in the table-data, and we don't want to change it
      ;; because we won't be fetching any rows anyway
      (= fetching-cols #{})
      state

      :else
      (assoc-in state [:fetches fetch-id :cache-clash?] true))))

(defn- convert-requested-to-map [requested-cols]
  (if-not (sequential? requested-cols)
    requested-cols
    (zipmap requested-cols (repeat true))))

(defn- clean-requested-cols
  "Not a public api expect either nil, map, true"
  [requested-cols]
  (cond
    (nil? requested-cols) nil
    (boolean? requested-cols) requested-cols
    (map? requested-cols) (map-keys util/preserve-slashes requested-cols)))

(defn- get-cols-to-fetch
  "false was filtered out as we walked the links"
  [requested-cols all-cols {:keys [tables level view-spec]}]
  (set (cond
         (map? requested-cols) (check-requested-cols! tables view-spec all-cols requested-cols)
         requested-cols (default-cols-to-fetch-removing-client-hidden all-cols)
         (<= level DEFAULT-WALK-DEPTH) (default-cols-to-fetch-removing-client-hidden all-cols))))

(defn- follow-link? [requested-cols col-name level type]
  (if-not (map? requested-cols)
    (< level DEFAULT-WALK-DEPTH)
    ;;(and (< level DEFAULT-WALK-DEPTH) (not= "link_multiple" type))
    ((every-pred identity (partial not= {})) (get requested-cols col-name))))

(declare add-fetch)

(defn- follow-links [fetch-spec col-name fetch-id {:keys [all-cols requested-cols level root-perm] :as args}]
  (let [{target-type :type target-table-id :table_id} (get all-cols col-name)
        target-view-spec (get-linked-view-spec target-table-id root-perm)
        args (assoc args :view-spec target-view-spec :table-id target-table-id)
        fetch-spec (assoc-in fetch-spec [:fetches fetch-id :links col-name]
                             {:type      target-type,
                              :view-spec target-view-spec
                              :view-key  (util-v2/str-view-key target-view-spec)})]

    ;;(log/trace "Following" col-name "? RC=" requested-cols "; level =" level)
    (if (follow-link? requested-cols col-name level target-type)
      (add-fetch fetch-spec (assoc args :level (inc level)
                                        :requested-cols (get requested-cols col-name)
                                        :link-from {:fetch-id fetch-id, :col-name col-name, :link-type target-type}))
      ;; Otherwise, we still need a table-cache entry for the target
      (setup-table-cache fetch-spec nil #{} args))))

(defn- is-link? [col-name all-cols]
  (#{"link_single" "link_multiple"} (:type (get all-cols col-name))))

(defn- populate-links [fetch-spec fetch-cols fetch-id {:keys [all-cols] :as args}]
  (reduce (fn [fetch-spec col-name]
            (if (is-link? col-name all-cols)
              (follow-links fetch-spec col-name fetch-id args)
              fetch-spec))
          fetch-spec fetch-cols))

(defn- update-fetch-spec [fetch-spec fetching-cols fetch-id {:keys [view-spec link-from] :as args}]
  (-> fetch-spec
      (update-in [:next-fetch-id] inc)
      (assoc-in [:fetches fetch-id] {:view-key      (util-v2/str-view-key view-spec)
                                     :view-spec     view-spec
                                     :fetching-cols fetching-cols
                                     :link-from     link-from
                                     :links         {}})
      (setup-table-cache fetch-id fetching-cols args)))

(defn- add-fetch [fetch-spec {:keys [table-id requested-cols tables] :as args}]
  (let [requested-cols (clean-requested-cols requested-cols)
        all-cols (get-all-cols-maybe-removing-client-hidden tables table-id)
        fetching-cols (get-cols-to-fetch requested-cols all-cols args)
        fetch-id (:next-fetch-id fetch-spec)
        fetch-spec (update-fetch-spec fetch-spec fetching-cols fetch-id args)]
    (populate-links fetch-spec fetching-cols fetch-id (assoc args :requested-cols requested-cols
                                                                  :all-cols all-cols))))

(defn compute-fetch-spec [tables {root-perm :perm table-id :id :as view-spec} requested-cols]
  (let [requested-cols (convert-requested-to-map requested-cols)]
    (add-fetch {:next-fetch-id 0} {:level          0
                                   :root-perm      root-perm
                                   :table-id       table-id
                                   :view-spec      view-spec
                                   :requested-cols requested-cols
                                   :tables         tables})))

(defn- dict-row-data [table row-id row-data cap fetching-cols cols]
  (reduce (fn [row-dict [i {col-name :name}]]
           (if (fetching-cols col-name)
             (assoc row-dict (str i) (util-v2/render-transmitted-value table row-id row-data (get-in table [:columns col-name])))
             row-dict))
         {:c cap} (indexed cols)))

(defn- compact-row-data [table row-id row-data cap col-names]
  (conj (mapv #(util-v2/render-transmitted-value table row-id row-data (get-in table [:columns %])) col-names) cap))

(defn- get-cached-col-order [fetch-spec view-spec]
  (get-in fetch-spec [:cache-cols view-spec :cache-order]))

(defn- get-col-specs [table-data view-key]
  (get-in table-data [view-key :spec :cols]))

(defn- get-transmitted-row-data [tables fetch-spec table-data id rdata {:keys [view-key fetching-cols cache-clash? view-spec]}]
  (let [_ (assert view-spec)
        table-id (:id view-spec)
        cap (types/->Capability ["_" "t" (util-v2/encode-view-spec view-spec) {:r id}])
        table (get tables table-id)]
    (if cache-clash?
      (dict-row-data table id rdata cap fetching-cols (get-col-specs table-data view-key))
      (compact-row-data table id rdata cap (get-cached-col-order fetch-spec view-spec)))))

(defn- add-cap [view-key view-spec table-data row-link-json]
  (if row-link-json
    (let [row-id (get-linked-row-id row-link-json)]
      ;;(log/trace "FILL SCOPE:" ["_" "t" view-spec {:r row-id}])
      (update-in table-data [view-key :rows (str row-id)]
                 #(or % {:c (types/->Capability ["_" "t" (util-v2/encode-view-spec view-spec) {:r row-id}])})))
    table-data))

(defn- fill-missing-caps [table-data rdata links]
  (reduce (fn [table-data [col-name {:keys [type view-spec view-key]}]]
            ;;(log/trace "Filling in target cap for" col-name "to" view-spec)
            (condp = type
              "link_single" (add-cap view-key view-spec table-data (get rdata (keyword col-name)))
              "link_multiple" (reduce (partial add-cap view-key view-spec) table-data (get rdata (keyword col-name)))
              table-data))
          table-data links))

(defn- make-table-data [tables results fetch-spec]
  (reduce (fn [table-data {:keys [fid id rdata]}]
            (let [{:keys [view-key links] :as this-fetch} (get-in fetch-spec [:fetches fid])
                  transmitted-row-data (get-transmitted-row-data tables fetch-spec table-data id rdata this-fetch)]
              (-> table-data
                  (assoc-in [view-key :rows (str id)] transmitted-row-data)
                  (fill-missing-caps rdata links))))
          (:table-data fetch-spec) results))

(defn walk-and-fetch-table-links [tables db-c {table-id :id root-perm :perm :as view-spec} PRIMARY-SQL-QUERY fetch-spec]
  (let [;; TODO: Walk the link graph building up the set of UNION queries required to follow all the links
        ;; we want to follow. While we're at it, we probably want to build up all the content

        ;; Structure of a query:
        ;; WITH fetch_0 AS (...PRIMARY SQL...),
        ;;      fetch_1 AS (...LINK-FOLLOWING SQL),
        ;;      ...
        ;;   (SELECT * FROM fetch_0) UNION (SELECT * FROM fetch_1) UNION ...


        LINK-QUERIES (for [fetch-id (range 1 (:next-fetch-id fetch-spec))]
                       (LINK-FOLLOW-CTE tables fetch-spec fetch-id))
        ;;_ (log/trace "Link queries:" LINK-QUERIES)

        [PRIMARY-SQL primary-params] PRIMARY-SQL-QUERY
        FULL-SQL (str "WITH fetch_0 AS (" PRIMARY-SQL ")"
                      (apply str (for [[SQL params] LINK-QUERIES] (str ", " SQL)))
                      (string/join " UNION" (for [FETCH-ID (range (:next-fetch-id fetch-spec))]
                                               (str " SELECT * FROM fetch_" FETCH-ID)))
                      " ORDER BY primary_order")

        full-params (apply concat primary-params (for [[SQL params] LINK-QUERIES] params))
        ;;_ (log/trace "walk-and-fetch:" FULL-SQL full-params)
        ;;_ (log/trace "Fetch spec:\n" (with-out-str (pprint/pprint fetch-spec)))
        results (util/with-metric-query "SELECT v2 tables fetch"
                  (jdbc-t/query db-c (cons FULL-SQL full-params)))
        ;;_ (log/trace "Fetch returns:" results)

        raw-primary-results (filter #(= (:fid %) 0) results)]

    {:table-data          (make-table-data tables results fetch-spec)
     :this-table-view-key (get-in fetch-spec [:fetches 0 :view-key])
     :primary-row-ids     (map :id raw-primary-results)
     :last-primary-row    (last raw-primary-results)}))

(defn get-row [tables db-c {table-id :id :as view-spec} row-id requested-cols]
  (let [fetch-spec (compute-fetch-spec tables view-spec requested-cols)
        SQL-QUERY (LOOKUP-ROW-QUERY tables view-spec row-id fetch-spec)]
    (walk-and-fetch-table-links tables db-c view-spec SQL-QUERY fetch-spec)))


(defn table-has-row? [tables db-c {table-id :id :keys [restrict] :as view-spec} row-id]
  (-> (when row-id
        (let [{:keys [storage] :as table-record} (get-in tables [table-id :table-record])
              [RESTRICT-EXPR restrict-args] (when restrict (query/QUERY->SQL table-record restrict))
              [SQL args] (if (:split storage)
                           [(str "SELECT 1 FROM " (split-sql/TABLE-NAME table-record) " WHERE _id = ? AND " (or RESTRICT-EXPR "TRUE"))
                            (concat [row-id] restrict-args)]
                           [(str "SELECT 1 FROM app_storage_data WHERE table_id=? AND id=? AND " (or RESTRICT-EXPR "TRUE"))
                            (concat [table-id row-id] restrict-args)])]
          (seq (jdbc-t/query db-c (cons SQL args)))))
      (boolean)))

(defn- select-indices
  "returns a vector of elements from coll at the given indices (idxs)"
  [coll idxs]
  (mapv #(nth coll %) idxs))

(defn- get-client-visible-col-indices [{:keys [cols] :as spec}]
  (vec (keep-indexed (fn [i col]
                       (when-not (:client_hidden col) i))
                     cols)))

(defn clean-spec [{:keys [cols cache] :as spec}]
  (let [visible-col-idxs (get-client-visible-col-indices spec)]
    {:cols  (select-indices cols visible-col-idxs)
     :cache (select-indices cache visible-col-idxs)}))


(defn- clean-row-map [row-data  {:keys [old-key->new-key] :as params}]
  (reduce-kv (fn [m k v]
               (if-let [new-k (old-key->new-key k)]
                 (assoc m new-k v)
                 m))
    {} row-data))



(defn- clean-row [row-data {:keys [visible-cached-row-indices] :as params}]
  (cond
    ;; For row vectors, select only visible & cached values, then append capability
    (vector? row-data)
    (conj (select-indices row-data visible-cached-row-indices) (peek row-data))

    (map? row-data)
    (clean-row-map row-data params)

    :else row-data))

(defn- compute-row-transform-params [{:keys [cache] :as spec}]
  (let [visible-col-idxs (get-client-visible-col-indices spec)
        cached-col-idxs (keep-indexed (fn [i v] (when (= v 1) i)) cache)
        visible-and-cached-idxs (filter (set cached-col-idxs) visible-col-idxs)
        col-idx->row-pos (zipmap cached-col-idxs (range))]
    {:old-key->new-key           (merge {:c :c}
                                        (zipmap (map str visible-col-idxs)
                                                (map str (range (count visible-col-idxs)))))
     :visible-cached-row-indices (map col-idx->row-pos visible-and-cached-idxs)}))

;; TODO this appears to be unused?
(defn- clean-rows [rows spec]
  ;; compute the params once per table
  (let [params (compute-row-transform-params spec)]
    (map-vals #(clean-row % params) rows)))


(declare walk-linked-columns)
;; Recursively walk a row and all client-visible links, building up a cleaned version of the table data
;; Only includes columns and linked rows that are not client_hidden.
;;
(defn clean-table-data-for-client
  "Recursively walks from a starting row, following only client-visible links, and builds up a cleaned table-data map
  only containing visible columns and reachable rows. Uses an accumulator for cleaned-data."
  ([table-data table-id row-id]
   (clean-table-data-for-client table-data table-id row-id {}))
  ([table-data table-id row-id cleaned-data]
   (let [view-key (get-linked-view-key table-id "r")
         str-row-id (util/write-json-str row-id)
         table-entry (get table-data view-key)
         spec (:spec table-entry)
         cleaned-spec (clean-spec spec)
         already-cleaned-row? (contains? (get-in cleaned-data [view-key :rows] {}) str-row-id)]
     (if already-cleaned-row?
       cleaned-data
       (let [row (get-in table-entry [:rows str-row-id])
             ;; todo - consider caching the compute-row-transform-params per table-id
             ;; and keeping this in local cache
             cleaned-row (clean-row row (compute-row-transform-params spec))
             updated-data (-> cleaned-data
                              (assoc-in [view-key :spec] cleaned-spec)
                              (assoc-in [view-key :rows str-row-id] cleaned-row))]
         (walk-linked-columns cleaned-spec cleaned-row table-data updated-data))))))


(defn walk-linked-columns
  "Given a cleaned spec and cleaned row, recursively walk all non-client-hidden link columns.
  Handles both link_single and link_multiple columns.
  Uses medley.core/indexed to provide col and col-idx.
  - cleaned-spec: spec with only client-visible columns
  - cleaned-row: cleaned row (vector or map)
  - table-data: original full table-data
  - cleaned-data: accumulator"
  [cleaned-spec cleaned-row table-data cleaned-data]
  (reduce
    (fn [acc-data [col-idx {:keys [type] :as col}]]
      (if (#{"link_single" "link_multiple"} type)
        (let [linked-table-id (:table_id col)
              linked-row-val (if (vector? cleaned-row)
                               (nth cleaned-row col-idx nil)
                               ;; For map rows, key is string index (as per row cleaning convention)
                               (get cleaned-row (str col-idx)))]
          (cond
            ;; Only recurse for non-nil link_single
            (and (= type "link_single") (some? linked-row-val))
            (clean-table-data-for-client table-data linked-table-id linked-row-val acc-data)

            ;; recurse for row-ids in link_multiple - if a vector these can't be nil
            (and (= type "link_multiple") (sequential? linked-row-val))
            (reduce (fn [a row-id]
                      (clean-table-data-for-client table-data linked-table-id row-id a))
                    acc-data
                    linked-row-val)

            :else acc-data))
        acc-data))
    cleaned-data
    (indexed (:cols cleaned-spec))))


