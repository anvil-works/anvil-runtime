(ns anvil.dispatcher.native-rpc-handlers.users.util
  (:use slingshot.slingshot)
  (:require [anvil.dispatcher.native-rpc-handlers.util :as util]
            [anvil.dispatcher.types :as types]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.runtime.sessions]
            [anvil.util :as hook-util]
            [medley.core :refer [find-first map-keys remove-keys]]
            [clojure.data.json :as json]
            [anvil.runtime.tables.v2.rpc :as tables-v2]
            [anvil.runtime.tables.rpc :as tables]
            [clojure.string :as str])
  (:import (anvil.dispatcher.types LiveObjectProxy SerializedPythonObject)))

(defn get-props
  ([] (merge (get-props util/*app*)
             (when util/*session-state*
               (get-in @util/*session-state* [:users :test-config-override!]))))
  ([app]
   (if-let [props (first (filter #(= (:source %) "/runtime/services/anvil/users.yml") (:services app)))]
     (merge (:client_config props) (:server_config props)
            (when util/*session-state*
              (get-in @util/*session-state* [:users :test-config-override!])))
     (throw+ {:anvil/server-error "Add the Users service to your app before calling this function"
              :type               "anvil.server.ServiceNotAdded"
              :docId              "users"
              :docLinkTitle       "You need to add the Users service to your app. Learn more"}))))

(defn get-props-with-named-user-table
  ([] (get-props-with-named-user-table (tables-util/db) (tables-util/table-mapping-for-environment util/*environment* util/*session-state*) util/*app*))
  ([mapping app] (get-props-with-named-user-table (tables-util/db-for-mapping mapping) mapping app))
  ([db-c mapping app]
   (let [{:keys [user_table] :as props} (get-props app)]
     (if (string? user_table)
       (assoc props :user_table (tables-util/with-transform-err
                                  (tables-util/get-table-id-by-name db-c mapping user_table)))
       props))))

(defn remap-user-table [source-app-info source-app-version-spec new-app-yaml table-mappings]
  (let [SERVICE-URL "/runtime/services/anvil/users.yml"]
    (when (some #(= SERVICE-URL (:source %)) (:services new-app-yaml))
      (let [updated-new-app-yaml (update-in new-app-yaml [:services] (fn [svcs] (doall (map #(if (= SERVICE-URL (:source %))
                                                                                               (let [source-app (app-data/get-app source-app-info source-app-version-spec)
                                                                                                     old-user-table-id (:user_table (get-props (:content source-app)))
                                                                                                     new-user-table-id (:new-id (get table-mappings old-user-table-id))]
                                                                                                 (update % :server_config merge {:user_table (or new-user-table-id old-user-table-id)}))
                                                                                               %) svcs))))]
        (when (not= updated-new-app-yaml new-app-yaml)
          ;; Only return new yaml if something actually changed
          updated-new-app-yaml)))))

;;;; Table Helpers
(defn- is-v2-tables-enabled? []
  (->> (:services util/*app*)
       (find-first #(= "/runtime/services/tables.yml" (:source %)))
       :client_config
       :enable_v2))

(defn- is-v1-row? [r]
  (instance? LiveObjectProxy r))

(defn- is-v2-row-ref? [r]
  (and (instance? SerializedPythonObject r)
       (= (:type r) "anvil.tables.v2._RowRef")))

(defn- force-row-id-str [row-id]
  (if (string? row-id)
    row-id
    (json/write-str row-id)))

(defn- row-by-id-v1 [table-id v1-row-id-str]
  ((tables/Table "get_by_id") [table-id {}] {} (force-row-id-str v1-row-id-str)))

;; we represent a v2 row as a vector of row arguments [view_key, table_id, row_id, table_data]
;; in python: _Row.create_from_trusted(view_key, table_id, row_id, table_data)
(defn- row-by-id-v2 [table-id row-id]
  (let [[cap view-key table-id] (tables-v2/get-table-by-id nil table-id)
        row-id (force-row-id-str row-id)
        ;; v2 understands old-row-id format integer row-id and str row-id
        [row-id table-data :as row] (tables-v2/table-get-row-by-id nil cap row-id)]
    (when row
      [view-key table-id row-id table-data])))

(defn get-user-row-by-id [table-id row-id]
  (if (is-v2-tables-enabled?)
    (row-by-id-v2 table-id row-id)
    (row-by-id-v1 table-id row-id)))

(defn- add-user-v1 [table-id attributes]
  (try+
    ((tables/Table "add_row") [table-id {}] attributes)
    (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
      (tables/ensure-columns-exist! table-id attributes)
      ((tables/Table "add_row") [table-id {}] attributes))))

(defn- do-add-user-v2 [table-id attributes]
  (let [[cap _view-key table-id] (tables-v2/get-table-by-id nil table-id)
        [row-id _cap _table-spec] (tables-v2/table-add-row nil cap attributes)]
    (get-user-row-by-id table-id (str row-id))))

(defn- add-user-v2 [table-id attributes]
  (try+
    (do-add-user-v2 table-id attributes)
    (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
      ;; TODO this is using the old API so we might want to move this method at some point
      (tables/ensure-columns-exist! table-id attributes)
      (do-add-user-v2 table-id attributes))))

(defn add-new-user [table-id attributes]
  (if (is-v2-tables-enabled?)
    (add-user-v2 table-id attributes)
    (add-user-v1 table-id attributes)))

(defn user-row->table-id-row-id [r]
  (if (is-v1-row? r)
    (when (:id r)
      (json/read-str (:id r)))
    (when r
      (let [[_view-key table-id row-id _table_data] r]
        [table-id row-id]))))

(defn user-row->v1-id-str [r]
  (str "[" (str/join "," (user-row->table-id-row-id r)) "]"))

(defn user-row->row-id-int [r]
  (second (user-row->table-id-row-id r)))

(defn- table-get-create-v1 [table-id query-map]
  (try+
    ((tables/Table "get") [table-id {}] query-map)
    (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
      (tables/ensure-columns-exist! table-id query-map)
      ((tables/Table "get") [table-id {}] query-map))))

(defn- table-get-v2 [table-id query-map]
  (let [[cap view-key table-id] (tables-v2/get-table-by-id nil table-id)
        [row-id table-data :as row] (tables-v2/table-get-row nil cap [] query-map)]
    (when row
      [view-key table-id row-id table-data])))

(defn- table-get-create-v2 [table-id query-map]
  (try+
    (table-get-v2 table-id query-map)
    (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
      ;; TODO this is using the old API so we might want to move this method at some point
      (tables/ensure-columns-exist! table-id query-map)
      (table-get-v2 table-id query-map))))

(defn table-get [table-id query-map]
  (if (is-v2-tables-enabled?)
    (table-get-create-v2 table-id query-map)
    (table-get-create-v1 table-id query-map)))

(defn- row-to-map-v1 [r]
  ;; this is disgusting. Item caches come out of the native table funcs with string keys, but
  ;; off the wire with keyword keys, so we normalise them:
  (when-let [ic (:itemCache r)]
    (if (keyword? (first (keys ic)))
      (into {} (for [[k v] ic] [(name k) v]))
      ic)))

(def link-types #{"link-single" "link-multiple"})

;; we need to remove linked columns since the linked column values are integer pointers
;; sending linked columns as part of the update would be a bad idea
(defn- map-from-compact [row-vals cols cache]
  (->> cols
       (map #(when-not (zero? %1) %2) cache)
       (remove nil?)
       (#(zipmap % row-vals))
       (remove-keys #(link-types (:type %)))
       (map-keys :name)))

(comment
  ;; {"a" 1 "e" 5}
  (map-from-compact [1 4 5 "CAP"]
                    [{:name "a"} {:name "b"} {:name "c"} {:name "d" :type "link-single"} {:name "e"} {:name "f"}]
                    [1 0 0 1 1 0])

  ;
  )

(defn- map-from-non-compact [row cols]
  (->> (dissoc row :c)
       (map-keys #(get cols (Integer/parseInt %)))
       (remove-keys #(link-types (:type %)))
       (map-keys :name)))

(defn row-to-map-v2 [[view-key, _table-id, row-id, table-data :as _row_args]]
  (let [{:keys [spec rows]} (table-data view-key)
        {:keys [cache cols]} spec
        row (get rows (str row-id))]
    (if (map? row)
      (map-from-non-compact row cols)
      (map-from-compact row cols cache))))

(defn row-to-map [r]
  (if (is-v1-row? r)
    (row-to-map-v1 r)
    (when r
      (row-to-map-v2 r))))

(defn get-row-cap [[view-key, _table-id, row-id, table-data :as _row_args]]
  (let [row (get-in table-data [view-key :rows (str row-id)])]
    (if (map? row)
      (:c row)
      (last row))))

;; we just use the v2 update here
#_(defn update-row-values [table-id row-id updates]
    (let [user-row (row-by-id-v2 table-id row-id)
          row-cap (get-row-cap user-row)]
      (tables-v2/row-update nil row-cap updates)))

;; because the row-id doesn't really know what it wants to be - is it an int a str a vector
;; who knows at this point
(defn row-id-int [v1-id]
  (cond
    (int? v1-id) v1-id
    (string? v1-id) (second (json/read-str v1-id))
    :else (second v1-id)))

(defn update-row-values [table-id row-id updates]
  ((tables/TRow "update") [table-id (row-id-int row-id)] updates))

(defn set-values-creating-col-if-necessary [table-id row-id value-map]
  (let [value-map-with-keywords (map-keys keyword value-map)]
    (try+
      (update-row-values table-id row-id value-map-with-keywords)
      (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
        (tables/ensure-columns-exist! table-id value-map)
        (update-row-values table-id row-id value-map-with-keywords)))))

(defn update-row! [[table-id row-id :as v1-id-vec] update-fn]
  (tables-util/with-table-transaction
    (let [user-row (row-by-id-v1 table-id (json/write-str v1-id-vec)) #_(row-by-id-v2 table-id row-id)
          new-values (-> user-row row-to-map update-fn)
          do-update! #((tables/TRow "update") [table-id row-id] new-values)
          #_#(tables-v2/row-update nil (get-row-cap user-row) new-values)]
      (try+
        (do-update!)
        (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
          (tables/ensure-columns-exist! table-id new-values)
          (do-update!))))))

(defn is-valid-v1? [user-row]
  (and (instance? LiveObjectProxy user-row)
       (= (:backend user-row) "anvil.tables.Row")
       (= (first (user-row->table-id-row-id user-row)) (:user_table (get-props-with-named-user-table)))))

(defn is-valid-v2? [user-row]
  (and (instance? SerializedPythonObject user-row)
       (= (:type user-row) "anvil.tables.v2._RowRef")
       (try
         (let [[_ _ {table-id :id} _] (types/unwrap-capability (:value user-row) ["_" "t" :ANY {:r :ANY}])]
           (= table-id (:user_table (get-props-with-named-user-table))))
         (catch Exception e false))))

;; used in force-login
(defn row-ref-to-row [row-ref]
  (if (and (instance? SerializedPythonObject row-ref) (= (:type row-ref) "anvil.tables.v2._RowRef"))
    (let [[_ _ {table-id :id} {row-id :r}] (types/unwrap-capability (:value row-ref) ["_" "t" :ANY {:r :ANY}])]
      (row-by-id-v2 table-id (str row-id)))
    row-ref))

(defn is-valid-user-row? [user-row]
  (if (is-v2-row-ref? user-row)
    (is-valid-v2? user-row)
    (is-valid-v1? user-row)))

(defn get-and-create-columns
  ([table-id query-map] (get-and-create-columns table-id query-map nil))
  ([table-id original-query-map lowercase-column]
   (let [val-to-lowercase (get original-query-map lowercase-column)
         applying-lowercase? (and lowercase-column (string? val-to-lowercase))
         query-map (if applying-lowercase?
                     (assoc original-query-map lowercase-column (.toLowerCase ^String val-to-lowercase))
                     original-query-map)]

     (or
       (table-get table-id query-map)
       (when applying-lowercase?
         ;; If it didn't match, fall back to an exact-case match
         (get-and-create-columns table-id original-query-map))))))

(defonce validate-enabled-user! (fn [user-map]))

(def set-users-impl! (hook-util/hook-setter #{validate-enabled-user!}))

(defn get-user-check-enabled-and-validate
  ([table-id query-map] (get-user-check-enabled-and-validate table-id query-map nil))
  ([table-id query-map lowercase-column]
   (let [u (get-and-create-columns table-id query-map lowercase-column)
         user-map (row-to-map u)]
     (when u
       (if (get user-map "enabled")
         (validate-enabled-user! user-map)
         (throw+ {:anvil/server-error "This account has not been enabled by an administrator", :type "anvil.users.AccountIsNotEnabled"})))
     u)))
