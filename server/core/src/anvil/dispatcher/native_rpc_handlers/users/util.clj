(ns anvil.dispatcher.native-rpc-handlers.users.util
  (:use slingshot.slingshot)
  (:require [anvil.dispatcher.native-rpc-handlers.util :as util]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.runtime.tables.rpc :as tables]))

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
              :type               "AnvilServiceNotAdded"
              :docId              "users"
              :docLinkTitle       "You need to add the Users service to your app. Learn more"}))))

(defn get-props-with-named-user-table
  ([] (get-props-with-named-user-table (tables-util/db) (tables-util/table-mapping-for-environment util/*environment*) util/*app*))
  ([mapping app] (get-props-with-named-user-table (tables-util/db-for-mapping mapping) mapping app))
  ([db-c mapping app]
   (let [{:keys [user_table] :as props} (get-props app)]
     (if (string? user_table)
       (assoc props :user_table (tables-util/get-table-id-by-name db-c mapping user_table))
       props))))

(defn remap-user-table [source-app-info source-app-version-spec new-app-yaml table-mappings]
  (let [SERVICE-URL "/runtime/services/anvil/users.yml"]
    (when (some #(= SERVICE-URL (:source %)) (:services new-app-yaml))
      (update-in new-app-yaml [:services] (fn [svcs] (doall (map #(if (= SERVICE-URL (:source %))
                                                                    (let [source-app (app-data/get-app source-app-info source-app-version-spec)
                                                                          old-user-table-id (:user_table (get-props (:content source-app)))
                                                                          new-user-table-id (:new-id (get table-mappings old-user-table-id))]
                                                                      (assoc % :server_config {:user_table (or new-user-table-id old-user-table-id)}))
                                                                    %) svcs)))))))

(defn row-to-map [r]
  ;; this is disgusting. Item caches come out of the native table funcs with string keys, but
  ;; off the wire with keyword keys, so we normalise them:
  (when-let [ic (:itemCache r)]
    (if (keyword? (first (keys ic)))
      (into {} (for [[k v] ic] [(name k) v]))
      ic)))

(defn get-and-create-columns
  ([table-id query-map] (get-and-create-columns table-id query-map nil))
  ([table-id original-query-map lowercase-column]
   (let [val-to-lowercase (get original-query-map lowercase-column)
         applying-lowercase? (and lowercase-column (string? val-to-lowercase))
         query-map (if applying-lowercase?
                     (assoc original-query-map lowercase-column (.toLowerCase ^String val-to-lowercase))
                     original-query-map)]

     (or
       (try+
         ((tables/Table "get") [table-id {}] query-map)
         (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumn" (:type %))) _e
           (tables/ensure-columns-exist! table-id query-map)
           ((tables/Table "get") [table-id {}] query-map)))

       (when applying-lowercase?
         ;; If it didn't match, fall back to an exact-case match
         (get-and-create-columns table-id original-query-map))))))

(defn get-user-and-check-enabled
  ([table-id query-map] (get-user-and-check-enabled table-id query-map nil))
  ([table-id query-map lowercase-column]
   (let [u (get-and-create-columns table-id query-map lowercase-column)]
     (when (and u (not (get (row-to-map u) "enabled")))
       (throw+ {:anvil/server-error "This account has not been enabled by an administrator", :type "anvil.users.AccountIsNotEnabled"}))
     u)))
