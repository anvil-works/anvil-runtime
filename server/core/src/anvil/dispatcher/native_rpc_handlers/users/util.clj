(ns anvil.dispatcher.native-rpc-handlers.users.util
  (:use slingshot.slingshot)
  (:require [anvil.dispatcher.native-rpc-handlers.util :as util]
            [anvil.runtime.app-data :as app-data]))

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