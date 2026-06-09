(ns anvil.dispatcher.native-rpc-handlers.users.v2.util
  (:use slingshot.slingshot)
  (:require [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.types :as types]
            [anvil.runtime.tables.util :as tables-util]
            [clojure.tools.logging :as log]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.tables.v2.util :as table-util]
            [anvil.runtime.tables.v2.rpc :as table-rpc]
            [anvil.runtime.tables.v2.updates :as table-updates]
            [anvil.util :as hook-util]
            [clojure.data.json :as json]
            [clojure.string :as str]
            [medley.core :refer [find-first map-keys remove-keys remove-vals map-kv]])
  (:import (anvil.dispatcher.types LiveObjectProxy SerializedPythonObject))) ; Needed for _get-base-props

(defn- force-row-id-str [row-id]
  (if (string? row-id)
    row-id
    (json/write-str row-id)))

(defn get-base-user-props
  ([] (merge (get-base-user-props rpc-util/*app*)
             (when rpc-util/*session-state*
               (get-in @rpc-util/*session-state* [:users :test-config-override!]))))
  ([app]
   (if-let [props (first (filter #(= (:source %) "/runtime/services/anvil/users.yml") (:services app)))]
     (merge (:client_config props) (:server_config props)
            (when rpc-util/*session-state*
              (get-in @rpc-util/*session-state* [:users :test-config-override!])))
     (throw+ {:anvil/server-error "Add the Users service to your app before calling this function"
              :type               "anvil.server.ServiceNotAdded"
              :docId              "users"
              :docLinkTitle       "You need to add the Users service to your app. Learn more"}))))

(defn get-user-props
  ([] (get-user-props (tables-util/table-mapping-for-environment rpc-util/*environment* rpc-util/*session-state*) rpc-util/*app*))
  ([app] (get-user-props (tables-util/table-mapping-for-environment rpc-util/*environment* rpc-util/*session-state*) app))
  ([mapping app]
   (let [{:keys [user_table] :as props} (get-base-user-props app)]
     (cond
       (string? user_table)
       (let [found-entry (->> (dissoc (table-util/get-tables mapping) ::table-util/table-mapping)
                              (filter (fn [[_id info]] (= (:python_name info) user_table)))
                              first)]
         (if found-entry
           (assoc props :table_id (first found-entry))
           (throw+ {:anvil/server-error (str "Users service is configured with user table '" user_table "', but no table with that name was found.")})))

       user_table
       (let [tables (table-util/get-tables mapping)]
         (if (contains? tables user_table)
           (assoc props :table_id user_table)
           (throw+ {:anvil/server-error (str "Users service is configured with user table id '" user_table "', but no such table was found.")})))

       :else
       props))))

(defn remap-user-table [source-app-info source-app-version-spec new-app-yaml table-mappings]
  (let [SERVICE-URL "/runtime/services/anvil/users.yml"]
    (when (some #(= SERVICE-URL (:source %)) (:services new-app-yaml))
      (let [updated-new-app-yaml (update-in new-app-yaml [:services]
                                            (fn [svcs]
                                              (doall (map #(if (= SERVICE-URL (:source %))
                                                             (let [source-app (app-data/get-app source-app-info source-app-version-spec)
                                                                   old-user-table-id (:user_table (get-base-user-props (:content source-app)))
                                                                   new-user-table-id (:new-id (get table-mappings old-user-table-id))]
                                                               (update % :server_config merge {:user_table (or new-user-table-id old-user-table-id)}))
                                                             %) svcs))))]
        (when (not= updated-new-app-yaml new-app-yaml)
          ;; Only return new yaml if something actually changed
          updated-new-app-yaml)))))

(defn is-v2-tables-enabled? []
  (->> (:services rpc-util/*app*)
       (find-first #(= "/runtime/services/tables.yml" (:source %)))
       :client_config
       :enable_v2))

(def link-types #{"link_single" "link_multiple"})

;; we need to remove linked columns since the linked column values are integer pointers
;; sending linked columns as part of the update would be a bad idea
(defn- map-from-compact [row-data cols cache]
  (->> cols
       (map #(when-not (zero? %1) %2) cache)
       (remove nil?)
       (#(zipmap % row-data))
       (remove-keys #(link-types (:type %)))
       (map-keys :name)))

(comment
  ;; {"a" 1 "e" 5}
  (map-from-compact [1 4 5 "CAP"]
                    [{:name "a"} {:name "b"} {:name "c"} {:name "d" :type "link_single"} {:name "e"} {:name "f"}]
                    [1 0 0 1 1 0])
  (comment))

(defn- map-from-non-compact [row-data cols]
  (->> (dissoc row-data :c)
       (map-keys #(get cols (Integer/parseInt %)))
       (remove-keys #(link-types (:type %)))
       (map-keys :name)))

(comment
  ;; {"a" 42 "c" 43}
  (map-from-non-compact {:c "CAP" "0" 42 "2" 43} [{:name "a"} {:name "b"} {:name "c"} {:name "d" :type "link_single"} {:name "e"} {:name "f"}])

  (comment))

(defn row-to-map [[view-key, _table-id, row-id, table-data :as _row_args]]
  (let [{:keys [spec rows]} (get table-data view-key)
        {:keys [cache cols]} spec
        row-data (get rows (str row-id))]
    (if (map? row-data)
      (map-from-non-compact row-data cols)
      (map-from-compact row-data cols cache))))

(defn- get-col-idx [cols key]
  (->> cols
       (keep-indexed (fn [i col] (when (= (:name col) key) i)))
       first))

(defn- col-idx-in-cache [cache col-idx]
  ;; [0 0 1 1 0] 3 ;; true
  (and col-idx (pos? (nth cache col-idx 0))))

(defn- get-row-idx [cache col-idx]
  (when (col-idx-in-cache cache col-idx)
    ;; sum all the 1s in the cache array [1 0 0 1] ;;
    (->> cache
         (take col-idx)
         (reduce +))))

(defn get-from-compact
  ([row-data cols cache key] (get-from-compact row-data cols cache key nil))
  ([row-data cols cache key default]
   (let [col-idx (get-col-idx cols key)]
     (when-let [row-idx (get-row-idx cache col-idx)]
       (nth row-data row-idx default)))))

(defn get-from-non-compact
  ([row-data cols key] (get-from-non-compact row-data cols key nil))
  ([row-data cols key default]
   (let [col-idx (get-col-idx cols key)]
     (when col-idx
       (get row-data (str col-idx) default)))))

(comment
  ;; 5
  (get-from-compact [1 4 5 "CAP"]
                    [{:name "a"} {:name "b"} {:name "c"} {:name "d" :type "link_single"} {:name "e"} {:name "f"}]
                    [1 0 0 1 1 0]
                    "e")

  ;; 43
  (get-from-non-compact {:c "CAP" "0" 42 "2" 43} [{:name "a"} {:name "b"} {:name "c"} {:name "d" :type "link_single"} {:name "e"} {:name "f"}] "c")

  (comment))

(defn user-row->parts [user-row]
  (let [[view-key, _table-id, row-id, table-data] user-row
        {:keys [spec rows]} (get table-data view-key)
        {:keys [cache cols]} spec
        row-data (get rows (str row-id))
        cap (if (map? row-data) (:c row-data) (last row-data))]
    {:cap cap :data row-data :cache cache :cols cols}))

(defn get-in-user-row
  ([user-row key] (get-in-user-row user-row key nil))
  ([user-row key default]
   (if-not user-row
     default
     (let [key (name key)
           {:keys [data cache cols]} (user-row->parts user-row)]
       (if (map? data)
         (get-from-non-compact data cols key default)
         (get-from-compact data cols cache key default))))))

(defn spec-to-fetch-only [spec] (SerializedPythonObject. "anvil.tables.fetch_only" {:spec spec}))

;; When we use the users service, we know we probably need these columns
;; But we support user provided fetch specs - so we need to merge a user provided fetch-spec with this fetch spec
(def required-fetch-spec
  {:email                  true
   :password_hash          true
   :enabled                true
   :mfa                    true
   :n_password_failures    true
   :last_login             true
   :confirmed_email        true
   :remembered_logins      true
   :email_confirmation_key true})

(defn client-hidden-link? [col-meta]
  (and rpc-util/*client-request?*
       (:client_hidden col-meta)
       (link-types (:type col-meta))))

(defn remove-client-hidden-links [columns]
  (remove-vals client-hidden-link? columns))

(defn remove-client-hidden-links-from-fetch-spec [fetch-spec columns]
  (remove-keys #(client-hidden-link? (get columns (name %))) fetch-spec))

(defn- merge-user-fetch-spec-with-required-fetch-spec [fetch-spec columns]
  (let [column-keys (set (map keyword (keys columns)))
        valid-required-fetch-spec (select-keys required-fetch-spec column-keys)]
    (-> fetch-spec
        (remove-client-hidden-links-from-fetch-spec columns)
        (merge valid-required-fetch-spec))))

;; the fetch-spec will be nil if one was not provided by the python user
;; this means we should get all the columns
;; if the fetch-spec is not nil then it will be from the python user
;; But the python caller may need some columns for user checks
;; So at this stage we enhance the fetch spec with columns required for user checks
;; (The users service default fetch spec)
;;
;; we filter out client-hidden linked rows at this stage (if it's a client request)
;; this way we are not in danger of leaking client hidden linked row data to the client
;;
;; TODO - possibly be cleverer here, if the user provided a fetch spec and it's a client request
;; we should throw NoSuchColumn errors in these cases, at the moment we just silently ignore them
;; since we merge the python users fetch spec with the users service default fetch spec
;;
;; Note: other client hidden columns will be filtered out before we return the user-row to the client
;; (see sanitize-row-wrapper)
;;
;; NOTE: this function should not be inside a nested binding rpc-util/*client-request* false
;; We also must call this again when doing operations that require ensuring the columns exist
;; in case the columns change after a NoSuchColumnError was thrown
(defn as-fetch-only [table-id fetch-spec]
  (let [columns (get-in (table-util/get-tables) [table-id :columns])
        filtered-spec (if fetch-spec
                        (merge-user-fetch-spec-with-required-fetch-spec fetch-spec columns)
                        (map-kv (fn [col-name _] [(keyword col-name) {}])
                                (remove-client-hidden-links columns)))]
    (spec-to-fetch-only filtered-spec)))

(defn- bound-ensure-column-exists! [table-id query]
  (binding [rpc-util/*client-request?* false]
    ;; Reload table cache first so we see current schema; otherwise ensure-columns-exist!
    ;; may think the column already exists (stale cache) and skip creating it.
    (table-util/reload-tables)
    (table-updates/ensure-columns-exist! (tables-util/db) (table-util/get-tables) table-id query))
  ;; Reload again so subsequent code sees the new column(s).
  (table-util/reload-tables))

(defn- bound-table-get-row-from-query [table-id query-map fetch-spec]
  (let [fetch (as-fetch-only table-id fetch-spec)]
    (binding [rpc-util/*client-request?* false]
      (let [[cap view-key table-id] (table-rpc/get-table-by-id nil table-id)
            [row-id table-data :as row] (table-rpc/table-get-row nil cap [fetch] query-map)]
        (when row
          [view-key table-id row-id table-data])))))

(defn table-get-row-from-query
  ([table-id query-map] (table-get-row-from-query table-id query-map {}))
  ([table-id query-map fetch-spec]
   (try+
     (bound-table-get-row-from-query table-id query-map fetch-spec)
     (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
       (bound-ensure-column-exists! table-id query-map)
       (bound-table-get-row-from-query table-id query-map fetch-spec)))))

(defn table-get-row-by-id
  ([table-id row-id] (table-get-row-by-id table-id row-id {}))
  ([table-id row-id fetch-spec]
   (let [fetch (as-fetch-only table-id fetch-spec)]
     (binding [rpc-util/*client-request?* false]
       (let [[cap view-key table-id] (table-rpc/get-table-by-id nil table-id)
             row-id (force-row-id-str row-id)
             [row-id table-data :as row] (table-rpc/table-get-row-by-id {:fetch fetch} cap row-id)]
         (when row
           [view-key table-id row-id table-data]))))))

(defn- bound-update-user-row-from-cap [cap updates]
  (when (seq updates)
    (binding [rpc-util/*client-request?* false]
      (table-rpc/row-update nil cap updates))))

(defn update-user-row [user-row updates]
  (when (seq updates)
    (let [{:keys [cap]} (user-row->parts user-row)]
      (bound-update-user-row-from-cap cap updates))))

(defn update-user-row-creating-cols-as-necessary [[_ table-id _ _ :as user-row] updates]
  (try+
    (update-user-row user-row updates)
    (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
      (bound-ensure-column-exists! table-id updates)
      (update-user-row user-row updates))))

(defn- bound-add-row-returning-row-id [table-id attributes]
  (binding [rpc-util/*client-request?* false]
    (let [[cap _view-key _table-id] (table-rpc/get-table-by-id nil table-id)
          [row-id _cap _table-spec] (table-rpc/table-add-row nil cap attributes nil nil)]
      row-id)))

(defn- add-user-returning-row-id [table-id attributes]
  (try+
    (bound-add-row-returning-row-id table-id attributes)
    (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumnError" (:type %))) _e
      (bound-ensure-column-exists! table-id attributes)
      (bound-add-row-returning-row-id table-id attributes))))

(defn add-new-user [table-id attributes fetch-spec]
  (let [row-id (add-user-returning-row-id table-id attributes)]
    (table-get-row-by-id table-id row-id fetch-spec)))

(defn live-object->table-id-row-id [r]
  (when (:id r)
    (json/read-str (:id r))))

(defn- is-v1-live-object? [r]
  (instance? LiveObjectProxy r))

(defn- is-v2-row-ref? [r]
  (and (instance? SerializedPythonObject r)
       (= (:type r) "anvil.tables.v2._RowRef")))

(defn is-live-object-valid-user-row? [user-row]
  (and (instance? LiveObjectProxy user-row)
       (= (:backend user-row) "anvil.tables.Row")
       (= (first (live-object->table-id-row-id user-row)) (:table_id (get-user-props)))))

(defn is-v2-row-ref-valid-user-row? [user-row]
  (when (is-v2-row-ref? user-row)
    (try
      (let [[_ _ {table-id :id} _] (types/unwrap-capability (:value user-row) ["_" "t" :ANY {:r :ANY}])]
        (= table-id (:table_id (get-user-props))))
      (catch Exception e false))))

(defn user-row->table-id-row-id [r]
  (if (is-v1-live-object? r)
    (live-object->table-id-row-id r)
    (when r
      (let [[_view-key table-id row-id _table_data] r]
        [table-id row-id]))))

(defn user-row->v1-id-str [r]
  (str "[" (str/join "," (user-row->table-id-row-id r)) "]"))

(defn row-ref->user-row [row-ref fetch-spec]
  (when (is-v2-row-ref? row-ref)
    (let [[_ _ {table-id :id} {row-id :r}] (types/unwrap-capability (:value row-ref) ["_" "t" :ANY {:r :ANY}])]
      (when (= table-id (:table_id (get-user-props)))
        (table-get-row-by-id table-id row-id fetch-spec)))))

(defn live-object->user-row [live-object fetch-spec]
  (when (is-live-object-valid-user-row? live-object)
    (let [[table-id row-id] (live-object->table-id-row-id live-object)]
      (table-get-row-by-id table-id row-id fetch-spec))))

(defn is-valid-serialized-user-row? [serialized-row]
  (or (is-v2-row-ref-valid-user-row? serialized-row) (is-live-object-valid-user-row? serialized-row)))

;; used in force-login
(defn serialized-row->user-row [serialized-row fetch-spec]
  (cond
    (is-v2-row-ref? serialized-row) (row-ref->user-row serialized-row fetch-spec)
    (is-v1-live-object? serialized-row) (live-object->user-row serialized-row fetch-spec)
    :else nil))

(defonce validate-enabled-user! (fn [user-map]))

(def set-users-impl! (hook-util/hook-setter #{validate-enabled-user!}))

(defn- table-get-by-email
  ([table-id email fetch-spec] (table-get-by-email table-id email fetch-spec true))
  ([table-id orig-email fetch-spec applying-lowercase?]
   (let [applying-lowercase? (and applying-lowercase? (string? orig-email))
         email (cond-> orig-email
                 applying-lowercase? .toLowerCase)]
     (or
       (table-get-row-from-query table-id {:email email} fetch-spec)
       (when applying-lowercase?
         (table-get-by-email table-id orig-email fetch-spec false))))))

(defn table-get-from-email-check-enabled-and-validate
  ([table-id email] (table-get-from-email-check-enabled-and-validate table-id email {}))
  ([table-id email fetch-spec]
   (let [user-row (table-get-by-email table-id email fetch-spec)]
     (when user-row
       (if (get-in-user-row user-row :enabled)
         (validate-enabled-user! (row-to-map user-row))
         (throw+ {:anvil/server-error "This account has not been enabled by an administrator", :type "anvil.users.AccountIsNotEnabled"})))
     user-row)))

(defn record-login-failure! [user-row]
  (when user-row
    (let [[_ table-id row-id _] user-row]
      (tables-util/with-table-transaction
        (when-let [fresh-user-row (table-get-row-by-id table-id row-id)]
          (update-user-row-creating-cols-as-necessary
            fresh-user-row
            {"n_password_failures" (inc (or (get (row-to-map fresh-user-row) "n_password_failures") 0))}))))))

(comment)
