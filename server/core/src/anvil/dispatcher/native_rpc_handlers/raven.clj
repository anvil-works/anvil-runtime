(ns anvil.dispatcher.native-rpc-handlers.raven
  (:use [anvil.dispatcher.native-rpc-handlers.util])
  (:require clojure.java.io))

(defn get-user-crsid [_kwargs]
  (-> @*session-state* :raven :crsid))

(defn get-user-email [_kwargs]
  (str (-> @*session-state* :raven :crsid) "@cam.ac.uk"))

(def handlers {"anvil.private.raven.get_user_crsid" (wrap-native-fn get-user-crsid)
               "anvil.private.raven.get_user_email" (wrap-native-fn get-user-email)})