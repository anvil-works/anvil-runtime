(ns anvil.core.db-config
  (:require [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]
            [clojure.data.codec.base64 :as b64]))

(defn set-val
  ([key value]
   (set-val util/db key value))
  ([db key value]
   (let [key-name (util/preserve-slashes key)

         val (if (bytes? value)
               {:type "binary"
                :val  (String. ^bytes (b64/encode value))}
               {:val value})]
     (jdbc/execute! db ["INSERT INTO anvil_config (key, value) VALUES (?, ?::jsonb)
                             ON CONFLICT (key) DO UPDATE SET value=?::jsonb WHERE anvil_config.key=?"
                        key-name val val key-name])
     value)))

(defn get-val
  ([key]
   (get-val util/db key))
  ([db key]
   (when-let [{:keys [type val]} (:value (first (jdbc/query db ["SELECT value FROM anvil_config WHERE key = ?" (util/preserve-slashes key)])))]
     (if (= type "binary")
       (b64/decode (.getBytes val))
       val))))
