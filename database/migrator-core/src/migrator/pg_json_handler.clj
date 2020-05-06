(ns migrator.pg-json-handler
  "Direct copy of anvil.core.pg-json-handler"
  (:require [clojure.java.jdbc :as jdbc]
            [clojure.data.json :as json])
  (:import org.postgresql.util.PGobject
           (clojure.lang IPersistentMap IPersistentVector)))

;; Pass to json/write-str to preserve slashes in keywords
(defn preserve-slashes [val]
  (if (keyword? val)
    (.substring (.toString val) 1)
    val))

(defn value-to-json-pgobject [value]
  (doto (PGobject.)
    (.setType "json")
    (.setValue (json/write-str value :key-fn preserve-slashes))))

(extend-protocol jdbc/ISQLValue
  IPersistentMap
  (sql-value [value] (value-to-json-pgobject value))

  IPersistentVector
  (sql-value [value] (value-to-json-pgobject value)))

(extend-protocol jdbc/IResultSetReadColumn
  PGobject
  (result-set-read-column [pgobj _metadata _idx]
    (let [type  (.getType pgobj)
          value (.getValue pgobj)]
      (condp = type
        "json" (json/read-str value :key-fn keyword)
        "jsonb" (json/read-str value :key-fn keyword)
        value))))
