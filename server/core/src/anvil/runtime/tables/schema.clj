(ns anvil.runtime.tables.schema
  (:require [anvil.util :as util]
            [clj-commons.slingshot :refer :all]
            [clojure.pprint :refer [pprint]]
            [anvil.core.validation :as validation]
            [anvil.runtime.tables.manager :as tables-manager]
            [crypto.random :as random]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.runtime.tables.util :as table-util]
            [clojure.set :as set]
            [clojure.tools.logging :as log])
  (:import (anvil.runtime.tables.util TableAdminPolicy)))

(clj-logging-config.log4j/set-logger! :level :trace)

(defn yaml-schema-column-from-raw-column [{:keys [name type backend table_id admin_ui client_hidden] :as col-spec} python-name-from-table-id]
  (tables-manager/validate-colspec! col-spec)
  (merge {:name     name,
          :client_hidden client_hidden
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

(defn raw-column-from-yaml-schema [{:keys [name admin_ui client_hidden type target]} order table-id-from-python-name]
  (let [table-type (fn [type]
                     (if-let [tbl-id (table-id-from-python-name target)]
                       {:type     type
                        :backend  "anvil.tables.Row"
                        :table_id tbl-id}
                       {:type "unresolved"}))
        BASIC-COLUMN-TYPES #{"string" "number" "bool" "date" "datetime" "media" "simpleObject"}]
    (merge {:name          name
            :client_hidden client_hidden
            :admin_ui      admin_ui}
           (when order
             {:admin_ui (assoc admin_ui :order order)})
           (or
             (cond
               (= type "link_single") (table-type "liveObject")
               (= type "link_multiple") (table-type "liveObjectArray")
               (contains? BASIC-COLUMN-TYPES type) {:type type}
               :else (throw+ {:anvil/server-error (format "Not a valid column type: '%s'" type)}))
             {:type "unresolved"}))))

(defn raw-index-from-yaml-schema [{:keys [type columns] :as _index} raw-cols]
  {:type type
   :columns (mapv #(first (for [[id col] raw-cols
                                :when (= (:name col) %)]
                            (name id)))
                  columns)})

(defn yaml-schema-from-table-mapping-description [described-table-mapping]
  (let [python-name-from-id (fn [table-id] (:python_name (first (filter #(= (:id %) table-id) described-table-mapping))))]
    (try+
      (into {}
            (for [{:keys [name columns python_name client server all_indexes]} described-table-mapping]
              [python_name {:title   name,
                            :client  client,
                            :server  server,
                            :indexes (doall (for [{index-columns :columns type :type} all_indexes]
                                              {:columns (mapv #(get-in columns [(keyword %) :name]) index-columns)
                                               :type type})),
                            :columns (doall (for [[_id col-schema]
                                                  (sort-by (fn [[_col-id col-spec]] (get-in col-spec [:admin_ui :order])) columns)]
                                              (yaml-schema-column-from-raw-column col-schema python-name-from-id)))}]))
      (catch ::validation/validation-failed e
        (throw (Exception. (str "Invalid table mapping (" (::validation/validation-failed e) "): " (pr-str described-table-mapping))))))))

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
; Columns is a list of maps of {name, type, admin_ui, client_hidden, [target]}
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
                                                                            content-match)))
                                                                        ;; Otherwise, no match.


                                            ;; Go through all removed tables, matching them up with added tables, returning a map of {old-table-name: [new-table-name new-table-spec-with-old-cols]}
                                            renamed-tables (first (reduce (fn [[renamed-tables remaining-added-tables] [removed-table-name removed-table-spec :as removed-table]]
                                                                            (if-let [[added-table-name added-table-spec :as added-table] (find-matching-added-table remaining-added-tables removed-table)]
                                                                              [(assoc renamed-tables removed-table-name [added-table-name (merge added-table-spec
                                                                                                                                                 (select-keys removed-table-spec [:columns :indexes]))]) (filter (fn [[name _]] (not= name added-table-name)) remaining-added-tables)]
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

    (apply concat actions (for [[table-name {src-cols :columns src-indexes :indexes old-title :title old-server :server old-client :client :as src-table-spec}] intermediate-schema
                                :let [{target-cols :columns target-indexes :indexes new-title :title new-server :server new-client :client :as target-table-spec} (get schema-target table-name)]
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

                                  ;; Now update any changed columns. Ignore ordering, admin_ui, client_hidden, and indexes.
                                  IGNORED-KEYS [:admin_ui :client_hidden :indexes]
                                  simple-src-cols (map #(apply dissoc % IGNORED-KEYS) src-cols)
                                  simple-target-cols (map #(apply dissoc % IGNORED-KEYS) target-cols)
                                  removed-cols (filter (fn [col] (not (some #{(apply dissoc col IGNORED-KEYS)} simple-target-cols))) src-cols)
                                  added-cols (filter (fn [col] (not (some #{(apply dissoc col IGNORED-KEYS)} simple-src-cols))) target-cols)

                                  ;; Get set of column names being added/removed for filtering
                                  added-names (set (map :name added-cols))
                                  removed-names (set (map :name removed-cols))

                                  ;; Only generate updates for columns that aren't being added/removed
                                  column-updates (for [[src-col target-col] (map vector src-cols target-cols)
                                                       :when (and (= (:name src-col) (:name target-col))
                                                                  (not= (boolean (:client_hidden src-col)) (boolean (:client_hidden target-col)))
                                                                  (not (contains? added-names (:name src-col)))
                                                                  (not (contains? removed-names (:name src-col))))]
                                                   {:type    :UPDATE_COLUMN
                                                    :table   table-name
                                                    :column_name (:name src-col)
                                                    :changes {:client_hidden (:client_hidden target-col)}})

                                  ;; Given a list of remaining added cols and a removed col, find an added col that this removed col has been renamed to.
                                  find-matching-added-col (fn [added-cols removed-col]
                                                            ;; If there's an added col with a known id the same as any known ids for the removed col, that's the one.
                                                            (when-let [added-col-match (first (filter (fn [added-col] (col-ids-overlap? removed-col added-col (:columns (get schema-hints table-name)))) added-cols))]
                                                              added-col-match))
                                                            ;; Otherwise, no match. Unlike tables, columns can only match by id.


                                  ;; Go through all removed cols, matching them up with added cols, returning a map of {old-col-name: new-col-name} and the remaining lists of actually-added and actually-removed columns.
                                  [renamed-cols added-cols removed-cols] (reduce (fn [[renamed-cols remaining-added-cols remaining-removed-cols] removed-col]
                                                                                   (if-let [added-col (find-matching-added-col remaining-added-cols removed-col)]
                                                                                     [(assoc renamed-cols (:name removed-col) (:name added-col))
                                                                                      (filter #(not= added-col %) remaining-added-cols)
                                                                                      (filter #(not= removed-col %) remaining-removed-cols)]
                                                                                     [renamed-cols remaining-added-cols remaining-removed-cols]))
                                                                                 [{} added-cols removed-cols] removed-cols)

                                  ;; Compare indexes after applying column renames, so a renamed column doesn't appear as index delete+add.
                                  target-indexes (set target-indexes)
                                  ;; For each source index, rewrite column names using the same rename map as column actions.
                                  src-indexes-after-rename (set (map (fn [src-index]
                                                                       (let [renamed-index (update src-index :columns (fn [cols] (mapv #(get renamed-cols % %) cols)))]
                                                                         (if (contains? target-indexes renamed-index)
                                                                           renamed-index
                                                                           src-index)))
                                                                     src-indexes))
                                  deleted-indexes (sort-by pr-str (set/difference src-indexes-after-rename target-indexes))
                                  added-indexes (sort-by pr-str (set/difference target-indexes src-indexes-after-rename))

                                  column-actions (concat
                                                   (when (not-empty renamed-cols)
                                                     (for [[old-name new-name] renamed-cols]
                                                       {:type :RENAME_COLUMN :table table-name :column_name old-name :new_column_name new-name}))
                                                   (for [index deleted-indexes]
                                                     {:type :DELETE_INDEX :table table-name :index index})
                                                   (when (not-empty removed-cols)
                                                     (for [col removed-cols]
                                                       {:type :DELETE_COLUMN :table table-name :column_name (:name col)}))
                                                   column-updates
                                                   (when (not-empty added-cols)
                                                     (for [col added-cols]
                                                       {:type :ADD_COLUMN :table table-name :column col}))
                                                   (for [index added-indexes]
                                                     {:type :ADD_INDEX :table table-name :index index}))]

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

;; TODO this is kinda ugly as a secret parameter to apply-changes!, but it should be temporary...right?
(def ^:dynamic *create-split-tables?* false)

(defn apply-changes!
  ([table-mapping description schema-changes table-admin-policy] (apply-changes! table-mapping description schema-changes ^TableAdminPolicy table-admin-policy nil))
  ([table-mapping description schema-changes ^TableAdminPolicy {:keys [allow-index?]} use-quota!]
   (let [table-ids (into {} (for [{:keys [python_name id]} description] [python_name id]))]

     (loop [[{:keys [type table column column_name new_column_name] :as change} & more-changes] schema-changes
            table-ids table-ids]
       (when change
         (let [type (name type)]
           (cond

             (= "CREATE_TABLES" type)
             (let [tables (:tables change)
                   storage (if *create-split-tables?* {:split true} nil)
                   table-ids (into table-ids
                                   (for [[python_name {:keys [title server client]}] tables
                                         :let [python_name (name python_name)
                                               {new-id :id} (tables-manager/create-table! table-mapping storage title python_name server client)]]
                                     [python_name new-id]))
                   db (table-util/db)]
               ;; Then do the columns after we've created all the tables, so the references match

               (doseq [[python_name {:keys [columns]}] tables]
                 (let [columns (sort-by #(get-in % [:admin_ui :order]) columns)
                       ; Don't add indexes to col specs initially - we'll do that later, depending on policy and storage type.
                       new-cols (map-indexed (fn [order col] (raw-column-from-yaml-schema col order table-ids)) columns)
                       table-id (table-ids (name python_name))]
                   (tables-manager/table-create-columns! db table-id new-cols false)))

               (doseq [[python_name {:keys [indexes]}] tables
                       :let [table-id (table-ids (name python_name))
                             {:keys [columns] :as table-record} (table-util/load-table-record db table-id)
                             col-id-strs (into {} (map (fn [[id col-spec]] [(:name col-spec) (name id)]) columns))
                             all-allowed-indexes (->> indexes
                                                      (mapv #(update % :columns (partial mapv col-id-strs)))
                                                      (filterv (partial allow-index? db storage)))
                             ;; Currently only used for non-split tables. TODO: Presumably we should have restrictions on split table index types too.
                             valid-index-types {"b_tree"    #{"string" "number" "date" "datetime" "bool"}
                                                "trigram"   #{"string"}
                                                "full_text" #{"string"}}

                             table-record (if *create-split-tables?*
                                            ;; Split tables: Add all indexes we're allowed to.
                                            (assoc table-record :indexes all-allowed-indexes)

                                            ;; Non-split tables: Add all suitable indexes to their respective col-specs
                                            (assoc table-record :columns (into {} (->> columns
                                                                                       (mapv (fn [[id col-spec]]
                                                                                               (let [this-col-indexes (->> all-allowed-indexes
                                                                                                                           (filterv #(and (= (:columns %) [(name id)])
                                                                                                                                          (contains? (get valid-index-types (:type %)) (:type col-spec) )))
                                                                                                                           (mapv #(dissoc % :columns)))]
                                                                                                 [id (cond-> col-spec
                                                                                                       (not-empty this-col-indexes) (assoc :indexes this-col-indexes))])))))))]]
                 (table-util/save-table-record! db table-record)
                 (tables-manager/update-col-indexes! db table-record))
               (recur more-changes table-ids))

             (= "DELETE_TABLE" type)
             (let [table-id (get-table-id table-ids table)
                   table-record (table-util/load-table-record (table-util/db) table-id)]
               (tables-manager/delete-table-access! table-mapping table-record)
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
               (when-let [update (merge {:python_name (or new_python_name table)}
                                        (when server
                                          {:server server})
                                        (when client
                                          {:client client}))]
                 (tables-util/update-table-access-record! table-mapping table-id update))
               (recur more-changes new-table-ids))

             (= "ADD_COLUMN" type)
             (let [table-id (get-table-id table-ids table)]
               (tables-manager/table-create-columns! (table-util/db) table-id [(raw-column-from-yaml-schema column nil table-ids)] true)
               (recur more-changes table-ids))

             (= "DELETE_COLUMN" type)
             (let [[table-id cols col-id] (get-table-id-and-cols table table-ids column_name)
                   col-id-kw (keyword col-id)]
               (tables-manager/table-delete-column! (table-util/db) table-id col-id-kw)
               (recur more-changes table-ids))

             (= "RENAME_COLUMN" type)
             (let [[table-id cols col-id] (get-table-id-and-cols table table-ids column_name)
                   col-id-kw (keyword col-id)]
               (when (some (fn [[id col]] (= (:name col) new_column_name)) cols)
                 (throw+ {:anvil/server-error (format "Table '%s' already has a column named '%s'" table new_column_name)}))
               (tables-manager/table-update-column! (table-util/db) table-id col-id-kw {:name new_column_name})
               (recur more-changes table-ids))

             (= "UPDATE_COLUMN" type)
             (let [[table-id cols col-id] (get-table-id-and-cols table table-ids column_name)
                   changes {:client_hidden (boolean (get-in change [:changes :client_hidden]))}
                   col-id-kw (keyword col-id)]
               (tables-manager/table-update-column! (table-util/db) table-id col-id-kw changes)
               (recur more-changes table-ids))

             (= "ADD_INDEX" type)
             (let [[table-id cols] (get-table-id-and-cols table table-ids)
                   index (:index change)
                   db-c (table-util/db)
                   {:keys [storage] :as table-record} (tables-util/load-table-record db-c table-id)]
               (when-not (allow-index? db-c storage index)
                 (throw+ {:anvil/server-error "Cannot create table index - permission denied."}))
               (tables-manager/table-create-index! db-c table-record (raw-index-from-yaml-schema index cols))
               (recur more-changes table-ids))

             (= "DELETE_INDEX" type)
             (let [[table-id cols] (get-table-id-and-cols table table-ids)
                   index (:index change)
                   db-c (table-util/db)
                   {:keys [storage] :as table-record} (tables-util/load-table-record db-c table-id)]
               (when-not (allow-index? db-c storage index)
                 (throw+ {:anvil/server-error "Cannot delete table index - permission denied."}))
               (tables-manager/table-delete-index! db-c table-record (raw-index-from-yaml-schema index cols))
               (recur more-changes table-ids))

             :else
             (throw+ {:anvil/server-error (format "Unknown table command '%s'" type)}))))))))
