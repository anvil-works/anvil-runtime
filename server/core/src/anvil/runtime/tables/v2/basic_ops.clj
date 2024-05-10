(ns anvil.runtime.tables.v2.basic-ops
  (:require
    [anvil.dispatcher.types :as types]
    [anvil.runtime.tables.v2.table-types :as table-types]
    [anvil.runtime.tables.v2.util :as util-v2]
    [anvil.util :as util]
    [clojure.java.jdbc :as jdbc]
    [clojure.string :as str]
    [clojure.tools.logging :as log]
    [slingshot.slingshot :refer :all]
    [clojure.string :as string]
    [medley.core :refer [indexed map-keys]]
    [clojure.pprint :as pprint]))

(clj-logging-config.log4j/set-logger! :level :trace)

(defn SELECT-COLUMNS [tables fetch-spec fetch-id]
  (let [{{table-id :id} :view-spec, :keys [fetching-cols] :as fs} (get-in fetch-spec [:fetches fetch-id])
        all-columns (get-in tables [table-id :columns])
        colspecs-to-fetch (for [cn fetching-cols] (get all-columns cn))
        col-param-kvs (for [{:keys [type]} colspecs-to-fetch]
                        (if (= type "media")
                          (str "?, (SELECT to_jsonb(all_except_data) from (select " util-v2/MEDIA-INFO-COLS " from app_storage_media) all_except_data WHERE object_id = (data->>?)::text::bigint)")
                          (str "?, data->?")))]
    ;; We can only pass 100 arguments to jsonb_build_object, so we partition the colspecs and join the resulting objects together
    [(str "(" (->> (for [param-group (if (not-empty col-param-kvs) (partition-all 50 col-param-kvs) [[]])]
                 (str "jsonb_build_object(" (str/join ", " param-group) ")"))
               (str/join " || "))
          ") AS rdata")
     (mapcat (fn [{:keys [name id]}] [name id]) colspecs-to-fetch)]))

(defn LOOKUP-ROW-QUERY [tables table-id row-id fetch-spec]
  (let [[SELECT-EXPR select-params] (SELECT-COLUMNS tables fetch-spec 0)]
    [(str "SELECT id, " SELECT-EXPR ", 0 AS fid, 0 AS primary_order FROM app_storage_data WHERE table_id = ? AND id = ?")
     (concat select-params [table-id row-id])]))

(defn LINK-FOLLOW-CTE [tables fetch-spec FETCH-ID]
  (let [{{:keys [fetch-id col-name link-type]} :link-from, {table-id :id} :view-spec} (get-in fetch-spec [:fetches FETCH-ID])
        FROM-FETCH (str "fetch_" (int fetch-id))
        [COLUMN-SQL col-params] (SELECT-COLUMNS tables fetch-spec FETCH-ID)]
    (condp = link-type
       "link_single" [(str "fetch_" FETCH-ID " AS (SELECT app_storage_data.id, " COLUMN-SQL ", " FETCH-ID " AS fid, NULL::integer AS primary_order "
                          " FROM " FROM-FETCH " JOIN app_storage_data ON "
                          "app_storage_data.id = (((" FROM-FETCH ".rdata->?->>'id')::jsonb)->>1)::bigint"
                          " WHERE app_storage_data.table_id=?)")
                     (concat col-params [col-name table-id])]
      "link_multiple" [(str "fetch_" FETCH-ID " AS (SELECT app_storage_data.id, " COLUMN-SQL ", " FETCH-ID " AS fid, NULL::integer AS primary_order "
                            " FROM (SELECT jsonb_array_elements(case jsonb_typeof(rdata->?) when 'array' then rdata->? else NULL end) AS lj FROM " FROM-FETCH ") AS links JOIN app_storage_data ON "
                            "app_storage_data.id = (((lj->>'id')::jsonb)->>1)::bigint"
                            " WHERE app_storage_data.table_id=?)")
                       (concat col-params [col-name col-name table-id])])))

(defn- get-linked-row-id [link-json]
  (when link-json
    (-> link-json :id util/read-json-str second)))


(defn- clean-id [maybe-id index]
  (if-let [id (try (Integer/parseInt (str maybe-id)) (catch Exception _e))]
    (assoc [nil nil] index id)
    (try (->> (re-matches #"^\[(\d+),(\d+)\]$" maybe-id)
              rest
              (map #(Integer/parseInt %))
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
  (clean-table-id 32)
  ;
  )

(defn- get-linked-view-spec [table-id root-perm]
  ;; the linked table gets whatever the yaml says
  (if (= root-perm "rwc")
    {:id table-id :perm "rwc"}
    {:id table-id}))

(defn- get-linked-view-key [table-id root-perm]
  (if (= root-perm "rwc")
    (format "{\"id\":%s,\"perm\":\"rwc\"}" (util/write-json-str table-id))
    (format "{\"id\":%s}" (util/write-json-str table-id))))

(defn get-col-names [table-id tables only-columns]
   ;; sort the names for consistent view specs
   (sort (or only-columns (seq (keys (get-in tables [table-id :columns]))))))

(defn get-table-spec [table-id tables root-perm cached-columns only-columns]
  ;; cached columns is a set or nil
  (let [{:keys [columns]} (get tables table-id)
        col-names (get-col-names table-id tables only-columns)]
    {:cols  (for [c col-names
                  :let [{:keys [table_id] :as col-spec} (get columns c)]]
              (merge (select-keys col-spec [:name :type :table_id])
                     (when table_id
                       {:view_key (get-linked-view-key table_id root-perm)})))
     :cache (for [c col-names]
              (if (contains? cached-columns c) 1 0))}))

(defn- ensure-column-valid [tables {table-id :id :keys [cols] :as view-key} col-name]
  )

(defn- default-cols-to-fetch [column-map]
  (keys column-map)
  ;; old behaviour ignores simpleObjects - can remove at some point
  ;;(for [[col-name {:keys [type]}] column-map
  ;;      :when (not= type "simpleObject")]
  ;;  col-name)
  )

(defn- check-requested-cols! [tables {table-id :id :keys [cols] :as view-spec} column-map requested-cols]
  (let [allowed? (if cols (set cols) column-map)]
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
         requested-cols (default-cols-to-fetch all-cols)
         (<= level DEFAULT-WALK-DEPTH) (default-cols-to-fetch all-cols))))

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
        all-cols (get-in tables [table-id :columns])
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

(defn- render-transmitted-value [tables table-id row-data col-name]
  (let [json-value (get row-data (keyword col-name))]
    (when-not (nil? json-value)
      (table-types/render-column-value tables table-id col-name json-value))))


(defn- dict-row-data [row-data cap fetching-cols cols render-value]
  (reduce (fn [row-dict [i {col-name :name}]]
           (if (fetching-cols col-name)
             (assoc row-dict (str i) (render-value row-data col-name))
             row-dict))
         {:c cap} (indexed cols)))

(defn- compact-row-data [row-data cap col-names render-value]
  (conj (mapv (partial render-value row-data) col-names) cap))

(defn- get-cached-col-order [fetch-spec view-spec]
  (get-in fetch-spec [:cache-cols view-spec :cache-order]))

(defn- get-col-specs [table-data view-key]
  (get-in table-data [view-key :spec :cols]))

(defn- get-transmitted-row-data [tables fetch-spec table-data id rdata {:keys [view-key fetching-cols cache-clash? view-spec]}]
  (let [_ (assert view-spec)
        table-id (:id view-spec)
        render-value (partial render-transmitted-value tables table-id)
        cap (types/->Capability ["_" "t" (util-v2/encode-view-spec view-spec) {:r id}])]
    (if cache-clash?
      (dict-row-data rdata cap fetching-cols (get-col-specs table-data view-key) render-value)
      (compact-row-data rdata cap (get-cached-col-order fetch-spec view-spec) render-value))))

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
        results (jdbc/query db-c (cons FULL-SQL full-params))
        ;;_ (log/trace "Fetch returns:" results)

        raw-primary-results (filter #(= (:fid %) 0) results)]

    {:table-data          (make-table-data tables results fetch-spec)
     :this-table-view-key (get-in fetch-spec [:fetches 0 :view-key])
     :primary-row-ids     (map :id raw-primary-results)
     :last-primary-row    (last raw-primary-results)}))

(defn get-row [tables db-c {table-id :id :as view-spec} row-id requested-cols]
  (let [fetch-spec (compute-fetch-spec tables view-spec requested-cols)
        SQL-QUERY (LOOKUP-ROW-QUERY tables table-id row-id fetch-spec)]
    (walk-and-fetch-table-links tables db-c view-spec SQL-QUERY fetch-spec)))

(defn row-data-to-updates [table-data view-key row-id]
  (let [spec (get-in table-data [view-key :spec])
        data (get-in table-data [view-key :rows (str row-id)])
        cached-col-names (for [[col cached?] (map vector (:cols spec) (:cache spec))
                               :when (= cached? 1)]
                           (:name col))]
    (into {} (map vector cached-col-names data))))

(defn add-row [tables db-c table-id only-if-query reduced-values]
  (let []))