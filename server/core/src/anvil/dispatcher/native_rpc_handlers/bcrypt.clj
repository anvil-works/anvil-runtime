(ns anvil.dispatcher.native-rpc-handlers.bcrypt
  (:use slingshot.slingshot)
  (:require [anvil.dispatcher.native-rpc-handlers.util :as native-util])
  (:import org.mindrot.jbcrypt.BCrypt))

(def handlers
  {"anvil.private.bcrypt.gensalt" (native-util/wrap-native-fn (fn [_kwargs n-rounds] (BCrypt/gensalt n-rounds)))
   "anvil.private.bcrypt.hashpw"  (native-util/wrap-native-fn (fn [_kwargs password salt]
                                                                (try
                                                                  (BCrypt/hashpw password salt)
                                                                  (catch Exception e
                                                                    (throw+ {:anvil/server-error (str "Could not hash password: " (.getMessage e))})))))})
