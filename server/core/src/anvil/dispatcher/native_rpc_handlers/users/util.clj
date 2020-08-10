(ns anvil.dispatcher.native-rpc-handlers.users.util
  (:use slingshot.slingshot)
  (:require [anvil.dispatcher.native-rpc-handlers.util :as util]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.runtime.tables.rpc :as tables]))

(defn get-props
  ([] (merge (get-props util/*app*)
             (get-in @util/*session-state* [:users :test-config-override!])))
  ([app]
   (if-let [props (first (filter #(= (:source %) "/runtime/services/anvil/users.yml") (:services app)))]
     (merge (:client_config props) (:server_config props))
     (throw+ {:anvil/server-error "Add the Users service to your app before calling this function"
              :type               "AnvilServiceNotAdded"
              :docId              "users"
              :docLinkTitle       "You need to add the Users service to your app. Learn more"}))))

(defn get-props-with-named-user-table
  ([] (get-props-with-named-user-table (tables-util/db) util/*app-id* util/*app*))
  ([app-id app] (get-props-with-named-user-table (tables-util/db-for-app app-id) app-id app))
  ([db-c app-id app]
   (let [{:keys [user_table] :as props} (get-props app)]
     (if (string? user_table)
       (assoc props :user_table (tables-util/get-table-id db-c app-id user_table))
       props))))

(defn remap-user-table [source-app-info new-app-yaml table-mappings]
  (let [SERVICE-URL "/runtime/services/anvil/users.yml"]
    (update-in new-app-yaml [:services] (fn [svcs] (doall (map #(if (= SERVICE-URL (:source %))
                                                                  (let [source-app (app-data/get-app source-app-info)
                                                                        old-user-table-id (:user_table (get-props (:content source-app)))
                                                                        new-user-table-id (:new-id (get table-mappings old-user-table-id))]
                                                                    (if new-user-table-id
                                                                      (assoc % :server_config {:user_table new-user-table-id})
                                                                      %))
                                                                  %) svcs))))))

(defn row-to-map [r]
  (:itemCache r))

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
