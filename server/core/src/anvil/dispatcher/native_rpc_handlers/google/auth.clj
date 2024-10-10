(ns anvil.dispatcher.native-rpc-handlers.google.auth
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [anvil.dispatcher.native-rpc-handlers.google.util]
        [slingshot.slingshot])
  (:require [anvil.runtime.conf :as conf]
            [anvil.runtime.secrets :as secrets]))

(defn get-user-email [_kwargs]
  (-> @*session-state* :google :user-tokens :id-token :email))

(defn ensure-client-id!
  ([] (ensure-client-id! nil))
  ([google-service]
   (when-not (has-own-client-id? google-service)
     (throw+ {:anvil/server-error "To get Google API tokens, you need to supply your own client ID and secret"
              :docId              "google_rest_api"
              :docLinkTitle       "Learn more about Google API credentials"}))))

(defn get-user-access-token [_kwargs]
  (ensure-client-id!)
  (-> @*session-state* :google :user-tokens :access-token))

(defn get-user-refresh-token [_kwargs]
  (ensure-client-id!)
  (-> @*session-state* :google :user-tokens :refresh-token))

(defn get-user-scope [_kwargs]
  (ensure-client-id!)
  (-> @*session-state* :google :user-tokens :scope))

(defn refresh-access-token [_kwargs refresh-token]
  (let [google-service (first (filter #(= (:source %) "/runtime/services/google.yml") (:services *app*)))
        google-client-id (or (get-in google-service [:server_config :client_id]) (and (:custom? conf/google-client-config) (:client-id conf/google-client-config)))]
    (ensure-client-id! google-service)
    (let [google-client-secret (or (when-let [encrypted-client-secret (get-in google-service [:server_config :client_secret_enc])]
                                     (:value (secrets/get-global-app-secret-value *app-info* "google-service/client-secret" encrypted-client-secret)))
                                   (get-in google-service [:server_config :client_secret])
                                   (and (:custom? conf/google-client-config) (:client-secret conf/google-client-config)))]
      (:access_token (anvil.core.sso.google/refresh-access-token refresh-token google-client-id google-client-secret)))))

(defn- get-config [_kwargs]
  (:client_config (first (filter #(= (:source %) "/runtime/services/google.yml") (:services *app*)))))

(def handlers {"anvil.private.google.auth.get_user_email" (wrap-native-fn get-user-email)
               "anvil.private.google.get_config" (wrap-native-fn get-config)
               "anvil.private.google.auth.get_user_access_token" (wrap-native-fn get-user-access-token)
               "anvil.private.google.auth.get_user_refresh_token" (wrap-native-fn get-user-refresh-token)
               "anvil.private.google.auth.get_user_scope" (wrap-native-fn get-user-scope)
               "anvil.private.google.auth.refresh_access_token" (wrap-native-fn refresh-access-token)})
