(ns anvil.dispatcher.native-rpc-handlers.microsoft
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [slingshot.slingshot])
  (:require [clojure.data.json :as json]
            [org.httpkit.client :as http]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.runtime.conf :as conf]
            [anvil.util :as util])
  (:import (java.net URLEncoder)))

(defn get-microsoft-service-props []
  (first (filter #(= (:source %) "/runtime/services/anvil/microsoft.yml") (:services *app*))))

(defn throw-need-own-app-id! []
  (throw+ {:anvil/server-error "To get Microsoft API tokens, you need to supply your own Application ID and secret"
           :docId              "microsoft"
           :docLinkTitle       "Learn more about Microsoft API credentials"}))

(defn get-ensuring-application-id [key]
  (when-let [state (:microsoft @*session-state*)]
    (when (:id-token state)
      (when-not (get state :application-id)
        (throw-need-own-app-id!))
      (get state key))))

(defn get-user-access-token [_kwargs]
  (get-ensuring-application-id :access-token))

(defn get-user-refresh-token [_kwargs]
  (get-ensuring-application-id :refresh-token))

(defn refresh-access-token [_kwargs refresh-token]
  (let [microsoft-service (first (filter #(= (:source %) "/runtime/services/anvil/microsoft.yml") (:services *app*)))
        microsoft-application-id (or (get-in microsoft-service [:server_config :application_id])
                                     (and (:custom? conf/microsoft-client-config) (:application-id conf/microsoft-client-config)))]
    (when-not microsoft-application-id
      (throw-need-own-app-id!))
    (let [microsoft-application-secret (or (get-in microsoft-service [:server_config :application_secret])
                                           (and (:custom? conf/microsoft-client-config) (:application-secret conf/microsoft-client-config)))

          tenant-id (or (get-in microsoft-service [:server_config :tenant_id])
                        (and (:custom? conf/microsoft-client-config) (:tenant-id conf/microsoft-client-config)))

          response @(http/post "https://login.microsoftonline.com/" (URLEncoder/encode tenant-id) "/oauth2/v2.0/token"
                               {:keepalive -1
                                :form-params {:refresh_token refresh-token
                                              :client_id     microsoft-application-id
                                              :client_secret microsoft-application-secret
                                              :grant_type    "refresh_token"}})
          body (json/read-str (:body response) :key-fn keyword)]

      (when (or (:error body) (not= 200 (:status response)))
        (throw+ {:anvil/server-error (str "Could not refresh Access Token."
                                          (when (:error body)
                                            (str " (" (:error body) "; " (:error_description body) ")")))}))

      (swap! *session-state* update-in [:microsoft] merge {:access-token (:access_token body)
                                                           :refresh-token (:refresh_token body)
                                                           :application-id microsoft-application-id})

      (:access_token body))))

(defn get-user-email [_kwargs]
  (or (-> @*session-state* :microsoft :email)
      (-> @*session-state* :microsoft :id-token :preferred_username)))

(defn get-user-id [_kwargs]
  (-> @*session-state* :microsoft :id-token :sub))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.microsoft.auth.get_user_email"         (wrap-native-fn get-user-email)
        "anvil.private.microsoft.auth.get_user_id"            (wrap-native-fn get-user-id)
        "anvil.private.microsoft.auth.get_user_access_token"  (wrap-native-fn get-user-access-token)
        "anvil.private.microsoft.auth.get_user_refresh_token" (wrap-native-fn get-user-refresh-token)
        "anvil.private.microsoft.auth.refresh_access_token"   (wrap-native-fn #'refresh-access-token)})
