(ns anvil.dispatcher.native-rpc-handlers.facebook
  (:use [anvil.dispatcher.native-rpc-handlers.util]))

(defn get-user-email [_kwargs]
  (-> @*session-state* :facebook :email))

(defn get-user-id [_kwargs]
  (-> @*session-state* :facebook :id))

(defn get-user-access-token [_kwargs]
  (-> @*session-state* :facebook :access-token))

(def handlers {"anvil.private.facebook.auth.get_user_email" (wrap-native-fn get-user-email)
               "anvil.private.facebook.auth.get_user_id" (wrap-native-fn get-user-id)
               "anvil.private.facebook.auth.get_user_access_token" (wrap-native-fn get-user-access-token)})