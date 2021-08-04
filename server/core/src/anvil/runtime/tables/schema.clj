(ns anvil.runtime.tables.schema
  (:require [slingshot.slingshot :refer :all]
            [clojure.pprint :refer [pprint]]
            [anvil.runtime.tables.manager :as tables-manager]
            [crypto.random :as random]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.runtime.tables.util :as table-util]
            [clojure.tools.logging :as log]))

(clj-logging-config.log4j/set-logger! :level :trace)

(defn yaml-schema-column-from-raw-column [{:keys [name type backend table_id admin_ui]} python-name-from-table-id]
  (merge {:name     name,
          :admin_ui (dissoc admin_ui :order)}
         (cond
           (and backend (not= "anvil.tables.Row" backend))
           {:type "unresolved"}

           (= type "liveObject")
           {:type "link_single"
            :target (python-name-from-table-id table_id)}

           (= type "liveObjectArray")
           {:type "link_multiple"
            :target (python-name-from-table-id table_id)}

           :else
           {:type type})))

(defn raw-column-from-yaml-schema [{:keys [name admin_ui type target]} order table-id-from-python-name]
  (let [table-type (fn [type]
                     (if-let [tbl-id (table-id-from-python-name target)]
                       {:type     type
                        :backend  "anvil.tables.Row"
                        :table_id tbl-id}
                       {:type "unresolved"}))
        BASIC-COLUMN-TYPES #{"string" "number" "bool" "date" "datetime" "media" "simpleObject"}]
    [(table-util/gen-new-id 8) (merge {:name     name
                                       :admin_ui (assoc admin_ui :order order)}
                                      (or
                                        (cond
                                          (= type "link_single") (table-type "liveObject")
                                          (= type "link_multiple") (table-type "liveObjectArray")
                                          (contains? BASIC-COLUMN-TYPES type) {:type type}
                                          :else (throw+ {:anvil/server-error (format "Not a valid column type: '%s'" type)}))
                                        {:type "unresolved"}))]))

(defn yaml-schema-from-table-mapping-description [described-table-mapping]
  (let [python-name-from-id (fn [table-id] (:python_name (first (filter #(= (:id %) table-id) described-table-mapping))))]
    (into {}
          (for [{:keys [name columns python_name client server]} described-table-mapping]
            [python_name {:title   name,
                          :client  client,
                          :server  server,
                          :columns (for [[_id col-schema]
                                         (sort-by (fn [[_col-id col-spec]] (get-in col-spec [:admin_ui :order])) columns)]
                                     (yaml-schema-column-from-raw-column col-schema python-name-from-id))}]))))

(defn yaml-schema-from-old-yaml-schema [old-schema]
  (->> old-schema
       (map #(merge % (select-keys (:access %) [:server :client])))
       (yaml-schema-from-table-mapping-description)))

(defn- ids-overlap? [ids-1 ids-2]
  (some (fn [id-1] (some (fn [id-2] (= id-1 id-2)) ids-1)) ids-2))

(defn- col-ids-overlap? [col1 col2 hints]
  (let [col-1-ids (:known_ids (get hints (keyword (:name col1))))
        col-2-ids (:known_ids (get hints (keyword (:name col2))))]
    (ids-overlap? col-1-ids col-2-ids)))

(defn- table-ids-overlap? [t1-name t2-name hints]
  (let [t1-ids (:known_ids (get hints t1-name))
        t2-ids (:known_ids (get hints t2-name))]
    (ids-overlap? t1-ids t2-ids)))

; Schema is a map of {python_name: table_spec}
; Table spec is a map of {title, server, client, columns}
; Columns is a list of maps of {name, type, admin_ui, [target]}
(defn diff-schema [schema-source schema-target schema-hints]
  (let [schema-source (into {} (for [[table-name-kw table] schema-source] [(name table-name-kw) table]))
        schema-target (into {} (for [[table-name-kw table] schema-target] [(name table-name-kw) table]))
        schema-hints (into {} (for [[table-name-kw table] schema-hints] [(name table-name-kw) table]))
        [intermediate-schema actions] [schema-source []]

        [intermediate-schema actions] (let [;; Find all the tables in the source that aren't in the target. These could have been renamed.
                                            removed-tables (filter (fn [[table-name _]] (not (contains? schema-target table-name))) intermediate-schema)
                                            ;; Find all the tables in the target that aren't in the source. These could be the renamed tables.
                                            added-tables (filter (fn [[table-name _]] (not (contains? intermediate-schema table-name))) schema-target)

                                            ;; Given a list of remaining added tables and a removed table, find an added table that this removed table has been renamed to.
                                            find-matching-added-table (fn [added-tables [removed-table-name removed-table-spec]]
                                                                        ;; If there's an added table with a known id the same as any known ids for the removed table, that's the one.
                                                                        (if-let [id-match (first (filter (fn [[added-table-name _]] (table-ids-overlap? added-table-name removed-table-name schema-hints)) added-tables))]
                                                                          id-match
                                                                          ;; Otherwise, if there's an added table with the exact column spec of the removed table, that'll do.
                                                                          (when-let [content-match (first (filter #(= (:columns removed-table-spec) (:columns (second %))) added-tables))]
                                                                            content-match))
                                                                        ;; Otherwise, no match.
                                                                        )

                                            ;; Go through all removed tables, matching them up with added tables, returning a map of {old-table-name: [new-table-name new-table-spec-with-old-cols]}
                                            renamed-tables (first (reduce (fn [[renamed-tables remaining-added-tables] [removed-table-name removed-table-spec :as removed-table]]
                                                                            (if-let [[added-table-name added-table-spec :as added-table] (find-matching-added-table remaining-added-tables removed-table)]
                                                                              [(assoc renamed-tables removed-table-name [added-table-name (merge added-table-spec
                                                                                                                                                 (select-keys removed-table-spec [:columns]))]) (filter (fn [[name _]] (not= name added-table-name)) remaining-added-tables)]
                                                                              [renamed-tables remaining-added-tables]))
                                                                          [{} added-tables] removed-tables))]

                                        ;; Build our new intermediate schema, renaming tables
                                        [(into {} (for [[table-name _ :as original-table] intermediate-schema]
                                                    (get renamed-tables table-name original-table)))
                                         ;; Build the list of table update actions.
                                         (concat actions (for [[old-name [new-table-name {:keys [title server client]} :as new-table]] renamed-tables]
                                                           {:type :UPDATE_TABLE :table old-name :new_python_name new-table-name :title title :server server :client client}))])

        ;; Any tables in the target schema that aren't in the intermediate must be created
        [intermediate-schema actions] (let [added-tables (filter (fn [[table-name _]] (not (contains? intermediate-schema table-name))) schema-target)]
                                        [(into intermediate-schema added-tables)
                                         (concat actions (when (not-empty added-tables)
                                                           [{:type :CREATE_TABLES :tables (into {} added-tables)}]))])

        ;; Any tables in the intermediate schema that aren't in the target must be deleted
        [intermediate-schema actions] (let [deleted-table-names (map first (filter (fn [[table-name _]] (not (contains? schema-target table-name))) intermediate-schema))]
                                        [(apply dissoc intermediate-schema deleted-table-names)
                                         (concat actions (when (not-empty deleted-table-names)
                                                           (for [name deleted-table-names]
                                                             {:type :DELETE_TABLE :table name})))])]

    ;; At this point the intermediate schema should have the same tables as the target. Now sort out their columns.

    (apply concat actions (for [[table-name {src-cols :columns old-title :title old-server :server old-client :client :as src-table-spec}] intermediate-schema
                                :let [{target-cols :columns new-title :title new-server :server new-client :client :as target-table-spec} (get schema-target table-name)]
                                :when (not= src-table-spec target-table-spec)]
                            (let [;; Update the table properties if required.
                                  table-actions (when-let [updates (merge (when-not (= old-title new-title)
                                                                            {:title new-title})
                                                                          (when-not (= old-client new-client)
                                                                            {:client new-client})
                                                                          (when-not (= old-server new-server)
                                                                            {:server new-server}))]
                                                  ; Single element list to make concat nicer below.
                                                  [(merge {:type :UPDATE_TABLE :table table-name} updates)])

                                  ;; Now update any changed columns. Ignore ordering and admin_ui.
                                  IGNORED-KEYS [:admin_ui]
                                  simple-src-cols (map #(apply dissoc % IGNORED-KEYS) src-cols)
                                  simple-target-cols (map #(apply dissoc % IGNORED-KEYS) target-cols)
                                  removed-cols (filter (fn [col] (not (some #{(apply dissoc col IGNORED-KEYS)} simple-target-cols))) src-cols)
                                  added-cols (filter (fn [col] (not (some #{(apply dissoc col IGNORED-KEYS)} simple-src-cols))) target-cols)

                                  ;; Given a list of remaining added cols and a removed col, find an added col that this removed col has been renamed to.
                                  find-matching-added-col (fn [added-cols removed-col]
                                                            ;; If there's an added col with a known id the same as any known ids for the removed col, that's the one.
                                                            (when-let [added-col-match (first (filter (fn [added-col] (col-ids-overlap? removed-col added-col (:columns (get schema-hints table-name)))) added-cols))]
                                                              added-col-match)
                                                            ;; Otherwise, no match. Unlike tables, columns can only match by id.
                                                            )

                                  ;; Go through all removed cols, matching them up with added cols, returning a map of {old-col-name: new-col-name} and the remaining lists of actually-added and actually-removed columns.
                                  [renamed-cols added-cols removed-cols] (reduce (fn [[renamed-cols remaining-added-cols remaining-removed-cols] removed-col]
                                                                                   (if-let [added-col (find-matching-added-col remaining-added-cols removed-col)]
                                                                                     [(assoc renamed-cols (:name removed-col) (:name added-col))
                                                                                      (filter #(not= added-col %) remaining-added-cols)
                                                                                      (filter #(not= removed-col %) remaining-removed-cols)]
                                                                                     [renamed-cols remaining-added-cols remaining-removed-cols]))
                                                                                 [{} added-cols removed-cols] removed-cols)


                                  column-actions (concat
                                                   (when (not-empty renamed-cols)
                                                     (for [[old-name new-name] renamed-cols]
                                                       {:type :RENAME_COLUMN :table table-name :column_name old-name :new_column_name new-name}))
                                                   (when (not-empty removed-cols)
                                                     (for [col removed-cols]
                                                       {:type :DELETE_COLUMN :table table-name :column_name (:name col)}))
                                                   (when (not-empty added-cols)
                                                     (for [col added-cols]
                                                       {:type :ADD_COLUMN :table table-name :column col})))]

                              (concat table-actions column-actions))))))

(defn- get-table-id [table-ids python-name]
  (or (get table-ids python-name)
      (throw+ {:anvil/server-error (format "No such table '%s'" python-name)})))

(defn- get-table-id-and-cols
  ([python-name table-ids]
   (let [table-id (get-table-id table-ids python-name)
         cols (tables-util/get-cols table-id)]
     [table-id cols]))
  ([python-name table-ids col-name]
   (let [table-id (get-table-id table-ids python-name)
         cols (tables-util/get-cols table-id)
         col-id (first (for [[id col] cols :when (= (:name col) col-name)] id))]
     (when-not col-id
       (throw+ {:anvil/server-error (format "Table '%s' has no column '%s'" python-name col-name)}))
     [table-id cols col-id])))

(defn apply-changes! [table-mapping description schema-changes]
  (let [table-ids (into {} (for [{:keys [python_name id]} description] [python_name id]))]

    (loop [[{:keys [type table column column_name new_column_name] :as change} & more-changes] schema-changes
           table-ids table-ids]
      (when change
        (let [type (name type)]
          (cond

            (= "CREATE_TABLES" type)
            (let [tables (:tables change)
                  table-ids (into table-ids
                                  (for [[python_name {:keys [title server client]}] tables
                                        :let [python_name (name python_name)
                                              {new-id :id} (tables-manager/create-table! table-mapping title python_name server client)]]
                                    [python_name new-id]))]
              ;; Then do the columns after we've created all the tables, so the references match
              (doseq [[python_name {:keys [columns]}] tables]
                (let [columns (sort-by #(get-in % [:admin_ui :order]) columns)
                      new-cols (into {} (map-indexed (fn [order col] (raw-column-from-yaml-schema col order table-ids)) columns))
                      table-id (table-ids (name python_name))]
                  (tables-util/update-cols-returning table-id
                                                     new-cols
                                                     {})))
              (recur more-changes table-ids))

            (= "DELETE_TABLE" type)
            (let [table-id (get-table-id table-ids table)]
              (tables-manager/delete-table-access! table-mapping table-id)
              (recur more-changes (dissoc table-ids (:table type))))

            (= "UPDATE_TABLE" type)
            (let [{:keys [table new_python_name server client title]} change
                  table-id (get-table-id table-ids table)
                  new-table-ids (if new_python_name
                                  (-> table-ids
                                      (dissoc table)
                                      (assoc new_python_name table-id))
                                  table-ids)]
              (when (and new_python_name (not= new_python_name table) (contains? table-ids new_python_name))
                (throw+ {:anvil/server-error (format "A table with name '%s' already exists; cannot rename '%s'" new_python_name table)}))
              (when title
                (tables-manager/rename-table! table-id title))
              (when-let [update (merge (when new_python_name
                                         {:python_name new_python_name})
                                       (when server
                                         {:server server})
                                       (when client
                                         {:client client}))]
                (tables-util/update-table-access-record! table-mapping table-id update))
              (recur more-changes new-table-ids))

            (= "ADD_COLUMN" type)
            (let [[table-id cols] (get-table-id-and-cols table table-ids)
                  order (inc (apply max 0 (map #(:order (:admin_ui (second %))) cols)))
                  new-cols (conj cols (raw-column-from-yaml-schema column order table-ids))]
              (table-util/update-cols-returning table-id new-cols cols)
              (recur more-changes table-ids))

            (= "DELETE_COLUMN" type)
            (let [[table-id cols col-id] (get-table-id-and-cols table table-ids column_name)]
              (table-util/update-cols-returning table-id (dissoc cols col-id) cols)
              (recur more-changes table-ids))

            (= "RENAME_COLUMN" type)
            (let [[table-id cols col-id] (get-table-id-and-cols table table-ids column_name)]
              (when (some (fn [[id col]] (= (:name col) new_column_name)) cols)
                (throw+ {:anvil/server-error (format "Table '%s' already has a column named '%s'" table new_column_name)}))
              (table-util/update-cols-returning table-id (assoc-in cols [col-id :name] new_column_name) cols)
              (recur more-changes table-ids))

            :else
            (throw+ {:anvil/server-error (format "Unknown table command '%s'" type)})))))))
