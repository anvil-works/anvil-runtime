(ns anvil.core.pg-json-handler
  "Shamelessly ripped off from http://hiim.tv/clojure/2014/05/15/clojure-postgres-json/"
  (:require [clojure.java.jdbc :as jdbc]
            [clojure.data.json :as json]
            [anvil.runtime.accounting]
            [anvil.util :as util])
  (:import org.postgresql.util.PGobject
           (clojure.lang IPersistentMap IPersistentVector)))

(defn value-to-json-pgobject [value]
  (doto (PGobject.)
    (.setType "json")
    (.setValue (util/write-json-str value))))

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
        "account" (anvil.runtime.accounting/read-account value)
        value))))
