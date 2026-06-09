(ns anvil.runtime.tables.util
  (:use [compojure.core]
        [clj-commons.slingshot])
  (:require [anvil.metrics :as metrics]
            [anvil.runtime.tables.split.sql :as split-sql]
            [anvil.runtime.tables.v2.jdbc-trace :as jdbc-t]
            [crypto.random :as random]
            [clojure.java.jdbc :as jdbc]
            [anvil.runtime.conf :as conf]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [clojure.data.json :as json]
            [anvil.util :as util]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [anvil.runtime.quota :as quota]
            digest
            [clojure.string :as str]
            [clojure.string :as string])
  (:import (java.sql Connection SQLException)
           (anvil.dispatcher.types Date DateTime LiveObjectProxy MediaDescriptor SerialisableForRpc)
           (java.io InputStream ByteArrayInputStream SequenceInputStream OutputStream)
           (java.util Collections)
           (java.time Instant OffsetDateTime ZoneId ZoneOffset)
           (java.time.format DateTimeFormatter DateTimeFormatterBuilder)
           (java.time.temporal ChronoField)))

;(clj-logging-config.log4j/set-logger! :level :trace)

(defn allow-admin-actions-on-db [db]
  (assoc-in db [:anvil/pool-info :allow-admin-actions?] true))

(defonce table-mapping-for-environment (fn
                                         ([environment] {})
                                         ([environment session-state] {})))
(defonce cache-key-for-table-mapping (fn [mapping] :one-table-mapping))
(defonce db-for-mapping (fn
                          ([mapping] (allow-admin-actions-on-db util/db))
                          ([session-state mapping] (allow-admin-actions-on-db util/db))))
(defonce db-for-mapping-transaction (fn [mapping] (allow-admin-actions-on-db util/db)))

(defonce get-table-access
         (fn [_mapping table-id]
           (->> (jdbc/query util/db
                            ["SELECT name,columns,client,server,storage FROM app_storage_tables,app_storage_access WHERE id = table_id AND table_id = ?"
                             table-id])
                (first))))

(defonce get-table-id-by-name
         (fn [db-c _mapping python-name]
           (:table_id (first (jdbc/query db-c ["SELECT table_id FROM app_storage_access WHERE python_name = ?" python-name])))))

(defonce get-all-table-access-records
         (fn
           ([mapping] (get-all-table-access-records util/db mapping))
           ([db-c _mapping]
            (jdbc-t/query db-c ["SELECT DISTINCT ON (table_id) table_id,name,python_name,columns,client,server,storage FROM app_storage_tables,app_storage_access WHERE id = table_id"]))))

(defonce update-table-access-record!
         (fn [_mapping table-id update]
           (jdbc/update! util/db "app_storage_access" update ["table_id = ?" table-id])))

(defonce delete-table-access-record!
         (fn [db-c _mapping table-id]
           (-> (jdbc/query db-c ["DELETE FROM app_storage_access WHERE table_id = ? RETURNING 1" table-id])
               (first) (boolean))))

(def MEDIA-INFO-COLS " object_id, name, content_type, table_id, column_id, row_id ")

(defn general-tables-error
  ([message] (general-tables-error message "anvil.tables.TableError"))
  ([message error-type]
   {:anvil/server-error message
    :type               error-type
    :docId              "data_tables"
    :docLinkTitle       "Learn more about Data tables"}))

(defonce ^:private log-every-sql-error? false)

(defn transform-err [^SQLException e]
  (log/debug e)
  (if (= "40001" (.getSQLState e))
    (general-tables-error "Another transaction has changed this data; aborting"
                          "anvil.tables.TransactionConflict")
    (if (or (re-matches #"(?s).*ResultSet is closed.*" (str (.getMessage e))) log-every-sql-error?)
      (let [error-id (random/hex 6)]
        (log/error e "An \"impossible\" SQLException occurred, Error code: " error-id)
        (general-tables-error (str "Internal database error: " (.getMessage e) " (" error-id ")")))

      (general-tables-error (str "Internal database error: " (.getMessage e))))))

(defmacro with-transform-err [& body]
  `(try
     (do ~@body)
     (catch SQLException e#
       (throw+ (transform-err e#)))))

(def ^:dynamic *environment-for-admin-call* nil)

(defn current-environment []
  (or rpc-util/*environment*
      *environment-for-admin-call*
      (throw (Exception. "(current-environment) called outside native RPC handler or admin call"))))


(defn db-for-current-app []
  (db-for-mapping rpc-util/*session-state* (table-mapping-for-environment (current-environment) rpc-util/*session-state*)))

(defn get-service-config []
  (if-let [props (first (filter #(= (:source %) "/runtime/services/tables.yml") (:services rpc-util/*app*)))]
    (merge (:client_config props) (:server_config props))
    nil))

(defn gen-new-id [nbytes]
  (.replace (random/base64 nbytes) \/ \_))

(defn- is-jsonable? [x]
  (cond
    (instance? SerialisableForRpc x) false
    (string? x) true
    (number? x) (not (Double/isNaN x))
    (nil? x) true
    (contains? #{true false} x) true
    (or (vector? x) (list? x)) (every? is-jsonable? x)
    (map? x) (every? (fn [[k v]] (and (or (string? k) (keyword? k))
                                      (is-jsonable? v)))
                     x)
    :else false))

(defn get-type-from-value [json-value]
  (cond
    (string? json-value) {:type "string"}

    (number? json-value) (cond
                           (or (= Double/POSITIVE_INFINITY json-value)
                               (= Double/NEGATIVE_INFINITY json-value))
                           {:error "Cannot store Infinity value in a data table"}

                           (Double/isNaN (double json-value))
                           {:error "Cannot store NaN in a data table"}

                           :else
                           {:type "number"})

    (contains? #{true false} json-value) {:type "bool"}

    (nil? json-value) {:type "unresolved"}

    (and (map? json-value)
         (or (instance? LiveObjectProxy json-value)
             (live-objects/valid-mac? json-value nil)))
    (if (= (:backend json-value) "anvil.tables.Row")
      {:type "liveObject" :backend "anvil.tables.Row" :table_id (first (json/read-str (:id json-value)))}
      {:type "liveObject", :backend (:backend json-value)})

    (instance? Date json-value) {:type "date"}

    (instance? DateTime json-value) {:type "datetime"}

    (instance? MediaDescriptor json-value) {:type "media"}

    (sequential? json-value)
    (if-let [first-val (first json-value)]
      (if-let [first-type (get-type-from-value first-val)]
        (if (:error first-type)
          first-type
          (if (:table_id first-type)
            (if (every? #(= first-type (get-type-from-value %)) (rest json-value))
              (assoc first-type :type "liveObjectArray")
              {:error "All elements of a table-row list must be rows from the same table"})
            (if (is-jsonable? json-value)
              {:type "simpleObject"}
              {:error "The only lists you can store in a data table are lists of simple objects or lists of table rows",
               ::unknown-type? true}))))
      {:type "unresolvedArray"})

    (is-jsonable? json-value) {:type "simpleObject"}

    :else {:error "You can only store strings, numbers, dates, references to other table rows, or simple objects in a table",
           ::unknown-type? true}))

(defn- get-table-name [c table-id]
  (:name (first (jdbc/query c ["SELECT name FROM app_storage_tables WHERE id = ?" table-id]))))

(defn get-type-name [c {:keys [type backend table_id]}]
  (condp = type
    "liveObject"
    (if (not= backend "anvil.tables.Row")
      (str backend " object")
      (str "Row from '" (get-table-name c table_id) "' table"))

    "liveObjectArray"
    (if (not= backend "anvil.tables.Row")
      (str "List of " backend " objects")
      (str "List of rows from '" (get-table-name c table_id) "' table"))

    "unresolved" "Unresolved (None)"

    "unresolvedArray" "Unresolved (empty list)"

    ;; else
    type))

(defn is-type? [json-value type-map]
  (or (nil? json-value)

      (and (#{"unresolvedArray" "liveObjectArray" "simpleObject"} (:type type-map))
           (= json-value []))

      (and (= (:type type-map) "simpleObject")
           (is-jsonable? json-value))

      (let [jv-type (get-type-from-value json-value)]
        (every? (fn [[k v]] (= v (get type-map k))) jv-type))))


(defn type-error? [c json-value col-type col-name]
  (when-not (is-type? json-value col-type)
    (str "Column '" col-name "' is a " (get-type-name c col-type) " - "
         (let [val-type (get-type-from-value json-value)]
           (log/debug (str "Column type mismatch: " (pr-str col-type) " " (pr-str val-type)))
           (or (:error val-type)
               (str "cannot set it to a " (get-type-name c val-type)))))))

(def reduce-formatter (-> (DateTimeFormatterBuilder.)
                            (.append DateTimeFormatter/ISO_LOCAL_DATE)
                            (.appendLiteral " ")
                            (.appendValue ChronoField/HOUR_OF_DAY 2)
                            (.appendLiteral ":")
                            (.appendValue ChronoField/MINUTE_OF_HOUR 2)
                            (.appendLiteral ":")
                            (.appendValue ChronoField/SECOND_OF_MINUTE 2)
                            (.appendFraction ChronoField/MICRO_OF_SECOND 0 9 true)
                            (.appendOffset "+HHMM" "+0000")
                            (.toFormatter)
                            (.withZone (ZoneId/of "UTC"))))

(def reinflate-parser (-> (DateTimeFormatterBuilder.)
                          (.append DateTimeFormatter/ISO_LOCAL_DATE)
                          (.appendLiteral "A")
                          (.appendValue ChronoField/HOUR_OF_DAY 2)
                          (.appendLiteral ":")
                          (.appendValue ChronoField/MINUTE_OF_HOUR 2)
                          (.appendLiteral ":")
                          (.appendValue ChronoField/SECOND_OF_MINUTE 2)
                          (.appendFraction ChronoField/MICRO_OF_SECOND 0 9 true)
                          (.appendOffset "+HHMM" "+0000")
                          (.toFormatter)
                          (.withZone (ZoneId/of "UTC"))))

(def normal-datetime-parser (-> (DateTimeFormatterBuilder.)
                                (.append DateTimeFormatter/ISO_LOCAL_DATE)
                                (.appendLiteral " ")
                                (.appendValue ChronoField/HOUR_OF_DAY 2)
                                (.appendLiteral ":")
                                (.appendValue ChronoField/MINUTE_OF_HOUR 2)
                                (.appendLiteral ":")
                                (.appendValue ChronoField/SECOND_OF_MINUTE 2)
                                (.appendFraction ChronoField/MICRO_OF_SECOND 0 9 true)
                                (.appendOffset "+HHMM" "+0000")
                                (.toFormatter)
                                (.withZone (ZoneId/of "UTC"))))

(defn datetime->instant [datetime]
  (when-let [val (:datetime-string datetime)]
    (.toInstant (OffsetDateTime/parse val reduce-formatter))))

(defn reduce-datetime [val]
  (when-let [instant (datetime->instant val)]
    (let [datetime-str (:datetime-string val)
          offset (.substring datetime-str (- (count datetime-str) 5))]
      (-> (DateTimeFormatter/ofPattern (str "yyyy-MM-dd'A'HH:mm:ss.SSSSSS'" offset "'"))
          (.withZone (ZoneOffset/UTC))
          (.format instant)))))

(defn reinflate-anvil-datetime [^String val]
  (when val
    (DateTime.
      (let [offset-pos (- (.length val) 5)
            DATE-END-POS 10]
        (if (= \A (.charAt val DATE-END-POS))
          (let [swapped-offset (str (.substring val 0 offset-pos)
                                    (if (= (get val offset-pos) \+) "-" "+")
                                    (.substring val (+ offset-pos 1)))
                instant (.toInstant (OffsetDateTime/parse swapped-offset reinflate-parser))]
            (-> (DateTimeFormatter/ofPattern (str "yyyy-MM-dd HH:mm:ss.SSSSSS'" (.substring val offset-pos) "'"))
                (.withZone (ZoneOffset/UTC))
                (.format instant)))
          (str (.toInstant (OffsetDateTime/parse val normal-datetime-parser))))))))

(defn reduced-val
  ([type val] (reduced-val type val false))
  ([type val permit-view-rows?]
   (if (nil? val)
     nil
     (condp = type
       "liveObject" (select-keys
                      (if (instance? LiveObjectProxy val)
                        (let [is-view-row? (and (= (:backend val) "anvil.tables.Row")
                                                (not= 2 (count (json/read-str (:id val)))))
                              val (if is-view-row?
                                    (assoc val :id (util/write-json-str (take 2 (json/read-str (:id val)))))
                                    val)]
                          ;; Don't allow view rows
                          (when (and is-view-row? (not permit-view-rows?))
                            (throw+ {:anvil/server-error "You cannot store a view row in a table column. Store the full row (not from a view) instead"
                                     :docId              "data_tables_views"
                                     :docLinkTitle       "Learn more about views in data tables"}))

                          (.serialiseForRpc
                            ;; Strip permissions from all table objects
                            (if (.startsWith (str (:backend val)) "anvil.tables.")
                              (assoc val :permissions [])
                              val)
                            nil))
                        val)
                      [:id :backend :permissions :mac :methods])
       "liveObjectArray" (map (partial reduced-val "liveObject") val)
       "string" (str val)
       "number" (do (assert (number? val)) val)
       "bool" (boolean val)
       "date" (:date-string val)
       "datetime" (reduce-datetime val)
       "media" nil
       "simpleObject" (do (assert (is-jsonable? val)) val)
       "unresolved" nil
       "unresolvedArray" []))))

(defmulti query->sql :op)

(defmethod query->sql "EQ" [q]
  [(str "(data @> ?::jsonb)") [{(:col q) (:value q)}]])

(defmethod query->sql "AND" [q]
  (if (empty? (:terms q))
    ["TRUE" []]
    (let [terms-sql (map query->sql (:terms q))
          sql-fragments (map first terms-sql)
          params (map second terms-sql)]
      [(str "(" (apply str (interpose " AND " sql-fragments)) ")") (apply concat params)])))

(defmethod query->sql "OR" [q]
  (if (empty? (:terms q))
    ["FALSE" []]
    (let [terms-sql (map query->sql (:terms q))
          sql-fragments (map first terms-sql)
          params (map second terms-sql)]
      [(str "(" (apply str (interpose " OR " sql-fragments)) ")") (apply concat params)])))

(defmethod query->sql "NOT" [q]
  (let [[operand-sql operand-params] (query->sql (:operand q))]
    [(str "NOT("operand-sql ")") operand-params]))

(defmethod query->sql "LIKE" [q]
  [(str "(data->>? LIKE ?)") [(:col q) (:pattern q)]])

(defmethod query->sql "ILIKE" [q]
  [(str "(data->>? ILIKE ?)") [(:col q) (:pattern q)]])

(defmethod query->sql "TSQ" [{:keys [col query raw?] :as _q}]
  [(str "(to_tsvector('english', data->>?) @@ " (if raw?
                                                  ;; Either way, query is a string
                                                  "to_tsquery"
                                                  "plainto_tsquery") "(?))") [col query]])

(defn inequality-query->sql [inequality q]
  (condp = (:type q)

    "number"
    [(str "((data->>?)::float " inequality " ?)") [(:col q) (:value q)]]

    "string"
    [(str "(data->>? " inequality " ?)") [(:col q) (:value q)]]

    "date"
    [(str "(data->>? " inequality " ?)") [(:col q) (:value q)]] ; Can compare dates to datetimes and vice versa.

    "datetime"
    [(str "(data->>? " inequality " ?)") [(:col q) (:value q)]]


    (throw+ (general-tables-error (str "Could not query column of type '" (:type q) "' with inequality '" inequality "'")))))

(defmethod query->sql "GT" [q]
  (inequality-query->sql ">" q))

(defmethod query->sql "GTEQ" [q]
  (inequality-query->sql ">=" q))

(defmethod query->sql "LT" [q]
  (inequality-query->sql "<" q))

(defmethod query->sql "LTEQ" [q]
  (inequality-query->sql "<=" q))

(defmethod query->sql nil [q]
  ["true" []])

(defmethod query->sql :default [q]
  (throw+ (general-tables-error (str "Could not generate SQL for query:" (pr-str q)))))

;; thread-id -> {:db-map MAP, :open INT, :last-touched TIMESTAMP}
(defonce open-transactions (atom {}))

(defn clean-up-open-transactions []
  (let [dead? #(and (= 0 (:open %))
                    (< (:last-touched %) (- (System/currentTimeMillis) conf/db-transaction-timeout)))]
    (doseq [[id tx] @open-transactions :when (dead? tx)]
      (when (not (contains? (swap! open-transactions #(if (dead? (get % id))
                                                        (dissoc % id)
                                                        %))
                            id))
        (log/info "Transaction expired for thread" id "(last touched" (/ (- (System/currentTimeMillis) (:last-touched tx)) 1000.0)
                  "seconds ago)")
        (try
          (.close ^Connection (:connection (:db-map tx)))
          (catch Exception _))
        (util/rollback-quota-changes! (:anvil-txn-state (:db-map tx)))))))

(defn start-transaction-tidy-timer []
  (.start (Thread. ^Runnable
                   (fn []
                     (while true
                       (Thread/sleep (/ conf/db-transaction-timeout 2))
                       (try
                         (clean-up-open-transactions)
                         (catch Exception e
                           (util/report-uncaught-exception "start-transaction-tidy-timer" e))))))))


(def ^:dynamic *current-db-transaction* nil)

(defn db [] (or *current-db-transaction*
                (when (@open-transactions rpc-util/*thread-id*)
                  (-> (swap! open-transactions #(if (get % rpc-util/*thread-id*)
                                                  (assoc-in % [rpc-util/*thread-id* :last-touched] (System/currentTimeMillis))
                                                  %))
                      (get-in [rpc-util/*thread-id* :db-map])))

                (when rpc-util/*session-state*
                  (when (and rpc-util/*thread-id* (contains? (::transaction-threads @rpc-util/*session-state*) rpc-util/*thread-id*))
                    (log/info "Threw error for an expired transaction in thread" rpc-util/*thread-id*)
                    (throw+ (general-tables-error "This transaction has expired" "anvil.tables.TransactionError")))

                  (get @rpc-util/*session-state* ::special-db))

                (db-for-current-app)))

(defmacro with-table-transaction [& body]
  `(util/with-db-transaction [db# (db)]
     (binding [*current-db-transaction* db#]
       ~@body)))

(defn with-app-transaction*
  "Run body-fn in a local transaction, or in the ongoing app transaction if there is one"
  [require-ongoing-transaction? relaxed-isolation-level body-fn]
  (let [ot (get (swap! open-transactions #(if (get % rpc-util/*thread-id*)
                                            (update-in % [rpc-util/*thread-id* :open] inc)
                                            %))
                rpc-util/*thread-id*)]
    (if-not ot
      (if require-ongoing-transaction?
        (if (contains? (::transaction-threads @rpc-util/*session-state*) rpc-util/*thread-id*)
          (throw+ (general-tables-error "This transaction has expired" "anvil.tables.TransactionError"))
          (throw+ {:anvil/server-error "No transaction currently running"}))
        ;; expanded (with-table-transaction) to hackily pipe in relaxed-isolation-level
        (util/with-db-transaction [db-c (db) relaxed-isolation-level]
          (binding [*current-db-transaction* db-c]
            (body-fn))))
      (try
        (log/trace "Reusing open transaction. Probably.")
        (body-fn)
        (finally
          (when ot
            (swap! open-transactions update-in [rpc-util/*thread-id* :open] dec)))))))


(def total-open-txns (atom 0))

(defn open-app-transaction! [{:keys [isolation] :as _kwargs}]
  (if-let [thread-id rpc-util/*thread-id*]
    (let [_ (when-not (and thread-id (not rpc-util/*client-request?*))
              (throw+ (general-tables-error "You can only perform table transactions from server modules. You can't use them here.")))

          _ (when (@open-transactions thread-id)
              (throw+ (general-tables-error "You already have a transaction open here")))

          db-map (db-for-mapping-transaction (table-mapping-for-environment rpc-util/*environment* rpc-util/*session-state*))

          [isolation-kw isolation-level] (if (= isolation "relaxed")
                                           [:repeatable-read Connection/TRANSACTION_REPEATABLE_READ]
                                           [:serializable Connection/TRANSACTION_SERIALIZABLE])
          conn (try
                 (doto (jdbc/get-connection db-map)
                   (.setAutoCommit false)
                   (.setTransactionIsolation isolation-level))
                 (catch SQLException e
                   (log/error "DB Connection failed in open-app-transaction! for app" rpc-util/*app-id* ", probably too many transactions:" (str e))
                   (throw+ (general-tables-error "Failed to connect to database: Too many transactions already in progress."))))

          db-map (-> (jdbc/add-connection db-map conn)
                     ;; Tell the JDBC helper it's in a transaction already
                     (assoc :level 1
                            :anvil-txn-state (atom {:quota-rollbacks {} :on-commit nil})
                            :anvil-txn-isolation-level isolation-kw
                            :schema-cache (atom {})))]

      (log/trace "Opening app transaction in thread" rpc-util/*thread-id*)

      (swap! rpc-util/*session-state* update-in [::transaction-threads] #(conj (or % #{}) thread-id))

      (swap! open-transactions update-in [thread-id]
             #(if %
                (do
                  (try (.close conn) (catch Exception _))
                  (util/rollback-quota-changes! (:anvil-txn-state db-map))
                  (throw+ (general-tables-error "Internal error: Duplicate racing transactions on the same thread")))
                {:open 0, :db-map db-map, :last-touched (System/currentTimeMillis)}))

      (swap! total-open-txns inc)

      nil)
    (throw+ (general-tables-error "Cannot open a transaction in an unidentified thread"))))

(defn close-app-transaction! [_kwargs rollback?]
  (log/trace "Closing app transaction in thread" rpc-util/*thread-id*)
  (when-not rpc-util/*thread-id*
    (throw+ (general-tables-error "Cannot close a transaction in an unidentified thread")))
  ;; Atomically remove and retrieve the value of the 'thread-id' key from this map
  (if-let [{{:keys [^Connection connection anvil-txn-state]} :db-map}
           (-> (swap-vals! open-transactions dissoc rpc-util/*thread-id*)
               (first)
               (get rpc-util/*thread-id*))]
    ;; We now MUST close connection before returning, because nobody else will
    (try
      (swap! rpc-util/*session-state* update-in [::transaction-threads] disj rpc-util/*thread-id*)
      (if-not rollback?
        (.commit connection)
        (do
          (.rollback connection)
          (metrics/inc! :api/jdbc-transaction-rollbacks {:transaction "<app>"})))
      (util/rollback-quota-changes! anvil-txn-state)
      (finally
        (.close connection)))

    ;; Else, there is no transaction for our thread. Throw an appropriate error.
    (if (contains? (::transaction-threads @rpc-util/*session-state*) rpc-util/*thread-id*)
      (do
        ;; Once we've thrown this error on a transaction close, we can reset the session, because user code
        ;; is no longer expecting to be in a transaction
        (swap! rpc-util/*session-state* update ::transaction-threads disj rpc-util/*thread-id*)
        (when-not rollback?                                 ;; Rolling back an expired transaction is not an error
          (throw+ (general-tables-error "This transaction has expired" "anvil.tables.TransactionError"))))
      (throw+ {:anvil/server-error "No transaction currently running"}))))


(defn -mk-use-quota [db-txn decrement! decrement-if-possible!]
  (fn use-quota!
    ([rows-added bytes-added] (use-quota! rows-added bytes-added true))
    ([rows-added bytes-added allow-throw?]

     (when (not= rows-added 0)
       (if allow-throw?
         (when-not (decrement-if-possible! db-txn :db-rows rows-added)
           (throw+ (general-tables-error "Datatables row count quota exceeded" "anvil.tables.QuotaExceededError")))
         (decrement! db-txn :db-rows rows-added)))

     (when (not= bytes-added 0)
       (if allow-throw?
         (when-not (decrement-if-possible! db-txn :db-bytes bytes-added)
           (throw+ (general-tables-error "Datatable database size limit exceeded" "anvil.tables.QuotaExceededError")))
         (decrement! db-txn :db-bytes bytes-added))))))

(defmacro -with-use-quota [[decrement! decrement-if-possible! relaxed-isolation-level] [use-quota!] & body]
  `(try
     (with-app-transaction* false ~relaxed-isolation-level
                            (fn [] (let [~use-quota! (-mk-use-quota (db) ~decrement! ~decrement-if-possible!)]
                                     ~@body)))
     (catch Exception e#
       (if (= (.getMessage e#) "An attempt by a client to checkout a Connection has timed out.")
         (do
           (log/error "DB Connection failed in open-app-transaction! for app " rpc-util/*app-id* ", probably too many transactions:" (str e#))
           (throw+ (general-tables-error "Failed to connect to database: Too many transactions already in progress.")))
         (throw e#)))))

(defmacro with-use-quota
  "Define a function that uses quota from the local app in a transaction, and rolls back on exception.
   If app-id is not specified, uses the current app for admin"
  [[use-quota! relaxed-isolation-level] & body]
  `(-with-use-quota [(partial quota/decrement! rpc-util/*session-state* (current-environment))
                     (partial quota/decrement-if-possible! rpc-util/*session-state* (current-environment))
                     ~relaxed-isolation-level]
                    [~use-quota!]
                    ~@body))

(defn get-cols
  ([table-id] (get-cols (db) table-id))
  ([c table-id]
   (->
     (jdbc/query c ["SELECT columns FROM app_storage_tables WHERE id = ?" table-id])
     (first) (:columns))))

(defn get-cols-from-view-query [view-query-obj]
  ;; View query should be either empty, a single EQ op, or an AND of EQ ops
  ;; (we don't allow nested ANDs in view queries, ick. Query-obj building phase gives you a nice error if you try)
  (cond
    (empty? view-query-obj)
    #{}

    (and (= (:op view-query-obj) "AND")
         (every? #(= (:op %) "EQ") (:terms view-query-obj)))
    (set (map :col (:terms view-query-obj)))

    (= (:op view-query-obj) "EQ")
    #{(:col view-query-obj)}

    :else
    (throw+ (general-tables-error (str "Not a valid view query: " (pr-str view-query-obj))))))

(defn filter-columns [columns view-cols]
  (select-keys columns (->> (keys columns) (remove #(contains? (set view-cols) (name %))))))

(defn normalise-indexes [{:keys [columns indexes] :as table-record}]
  (let [all-indexes (reduce (fn [all-indexes [col-id {:keys [indexes]}]]
                              (apply conj all-indexes
                                     (for [{:keys [type]} indexes]
                                       {:columns [(name col-id)]
                                        :type    type})))
                            (set indexes) columns)]
    ;; This sort is entirely arbitrary, but should be stable (for use in app-schema YAML in git)
    (assoc table-record :all_indexes (sort-by (fn [{:keys [columns type]}]
                                                (apply str type ":" (interpose ":" columns)))
                                              all-indexes))))

(defn load-table-record [db-c table-id]
  (if-let [table-record (first (jdbc/query db-c ["SELECT * FROM app_storage_tables WHERE id = ?"
                                                 table-id]))]
    (normalise-indexes table-record)
    (throw+ (-> (general-tables-error "Table not found. Has it been deleted?")
                (assoc :anvil.tables/no-such-table true
                       :log-stack-trace true)))))

(defn save-table-record! [db-c {:keys [id columns indexes] :as table-record}]
  (when (empty? (jdbc/query db-c ["UPDATE app_storage_tables SET columns=?::jsonb, indexes=?::jsonb WHERE id=? RETURNING id"
                                  columns (some-> indexes vec) id]))
    (throw (Exception. (format "Table %s does not exist" id))))
  table-record)

(defn update-columns-vals!
  "Like (swap-vals!) but for the 'columns' map of the specified table. Must be called in a transaction."
  [db-c table-id update-fn & args]
  (let [old-cols (:columns (first (jdbc/query db-c ["SELECT columns FROM app_storage_tables WHERE id = ?" table-id])))
        new-cols (apply update-fn old-cols args)]
    (when new-cols                                          ;; nil return aborts
      (jdbc/execute! db-c ["UPDATE app_storage_tables SET columns = ?::jsonb WHERE id = ?" new-cols table-id])
      [old-cols new-cols])))

(defn get-columns-and-storage [c table-id view-cols]
  (if-let [{:keys [columns storage]} (first (jdbc/query c ["SELECT columns,storage FROM app_storage_tables WHERE id = ?"
                                                           table-id]))]
    [(filter-columns columns view-cols) storage]
    (throw+ (assoc (general-tables-error "Table not found. Has it been deleted?")
              :log-stack-trace true))))

(defn get-table-storage [db-c table-id]
  (:storage (first (jdbc/query db-c ["SELECT storage FROM app_storage_tables WHERE id = ?" table-id]))))

(defn ensure-combined-storage! [{:keys [split] :as storage}]
  ;; call from places where we can't yet handle split tables
  (when split
    (throw+ (assoc (general-tables-error "Please enable Accelerated Tables in order to use new-style tables")
              :log-stack-trace true))))

(defn get-object-size
  ([oid] (get-object-size (db) oid))
  ([db oid]
   (or (:size (first (jdbc/query db ["SELECT length(data) AS size FROM app_storage_media WHERE object_id = ?" oid])))
       (:size (first (jdbc/query db ["SELECT get_lo_size(?) AS size" oid])))
       0)))

(defn- delete-media-objects
  ([object-ids use-quota!] (delete-media-objects (db) object-ids use-quota!))
  ([db-c object-ids use-quota!]
   (doseq [object-id object-ids]
     (let [size (get-object-size db-c object-id)]
       (when use-quota! (use-quota! 0 (- size)))
       (jdbc/query db-c ["SELECT lo_unlink(?)" object-id])))))

(defn delete-media-in-row [table-id row-id use-quota!]
  (let [affected-media (jdbc/query (db) ["DELETE FROM app_storage_media WHERE table_id = ? AND row_id = ? RETURNING object_id, (data is null) as has_lo, length(data) AS len" table-id row-id])]
    (delete-media-objects (->> affected-media
                               (filter :has_lo)
                               (map :object_id)) use-quota!)
    (when use-quota! (use-quota! 0 (- (->> affected-media (filter :len) (map :len) (reduce + 0)))))))

(defn delete-media-in-table
  ([table-id use-quota!] (delete-media-in-table (db) table-id use-quota!))
  ([db-c table-id use-quota!]
   (let [affected-media (jdbc/query db-c ["DELETE FROM app_storage_media WHERE table_id = ? RETURNING object_id, (data is null) as has_lo, length(data) AS len" table-id])]
     (delete-media-objects db-c (->> affected-media
                                     (filter :has_lo)
                                     (map :object_id)) use-quota!)
     (when use-quota! (use-quota! 0 (- (->> affected-media (filter :len) (map :len) (reduce + 0))))))))

(defn delete-media-in-cell [table-id col-id row-id use-quota!]
  (let [affected-media (jdbc/query (db) ["DELETE FROM app_storage_media WHERE table_id = ? AND column_id = ? AND row_id = ? RETURNING object_id, (data is null) as has_lo, length(data) AS len" table-id (util/preserve-slashes col-id) row-id])]
    (delete-media-objects (->> affected-media
                               (filter :has_lo)
                               (map :object_id)) use-quota!)
    (when use-quota! (use-quota! 0 (- (->> affected-media (filter :len) (map :len) (reduce + 0)))))))

(defn copy-media [^InputStream in-stream ^OutputStream out-stream]
  (try
    (let [buffer (make-array Byte/TYPE 65536)]
      (loop [bytes-so-far 0]
        (let [size (.read in-stream buffer)]
          (when (pos? size)
            (.write out-stream buffer 0 size)
            (recur (+ bytes-so-far size))))))
    (finally
      (.close out-stream)
      (.close in-stream))))

(defn lazy-export-combined-data
  ([^Connection raw-conn, table-ids] (lazy-export-combined-data raw-conn table-ids {}))
  ([^Connection raw-conn, table-ids, view-query]
   (into {}
         (for [id table-ids
               :let [storage (get-table-storage {:connection raw-conn} id)
                     _ (ensure-combined-storage! storage)]]
           [id
            (let [[QUERY-SQL query-args] (query->sql view-query)
                  stmt (doto (.prepareStatement raw-conn (str "SELECT * FROM app_storage_data WHERE table_id=? AND " QUERY-SQL))
                         (.setFetchSize 100)                ; Need to do this, else jdbc will load every row into memory on the first fetch. Doh.
                         (.setInt 1 id))]
              (dorun (map-indexed (fn [idx val]
                                    (jdbc/set-parameter val stmt (+ idx 2)))
                                  query-args))
              (.executeQuery stmt))]))))

(defn export-as-csv-v1 [table-id query-obj cols escape-for-excel?]
  (let [raw-conn ^Connection (jdbc/get-connection (db))
        columns (->> (for [[col-id col-spec] cols] (assoc col-spec :id col-id))
                     (sort-by #(:order (:admin_ui %))))

        esc-string (fn [s]
                     (let [s (str/replace (str s) "\"" "\"\"")
                           s (if escape-for-excel?
                               (str/replace s #"^([=+\-@])" "'$1")
                               s)]
                       (str \" s \")))

        render (fn render [{:keys [type backend]} value]
                 (condp = type
                   "number" (str value)
                   "string" (esc-string value)
                   "date" (render {:type "string"} value)
                   "datetime" (render {:type "string"} value)
                   "simpleObject" (render {:type "string"} (json/write-str value))
                   "bool" (if value "1", "0")
                   "media" "#MEDIA"
                   "liveObject" (if (= backend "anvil.tables.Row")
                                  (if (:id value)
                                    (esc-string (str "#ROW" (:id value)))
                                    "")
                                  "#REF")
                   "liveObjectArray" (if (= backend "anvil.tables.Row")
                                       (esc-string (str "#ROWS[" (apply str (interpose "," (map :id value))) "]"))
                                       "#REF")
                   "#REF"))

        render-row (fn [data row-id]
                     (->> (for [{:keys [id] :as col} columns]
                            (render col (get data id)))
                          (cons (esc-string row-id))
                          (interpose ",")
                          (apply str)))

        table-data (-> (lazy-export-combined-data raw-conn [table-id] query-obj)
                       (get table-id))

        header (->> columns
                    (map #(render {:type "string"} (:name %)))
                    (cons "\"ID\"")
                    (interpose ",")
                    (apply str))

        csv-lines (->> table-data
                       (jdbc/result-set-seq)
                       (map #(render-row (:data %) (util/write-json-str [(:table_id %) (:id %)])))
                       (cons header)
                       (interpose "\n"))]

    (SequenceInputStream. (Collections/enumeration
                            (concat (map #(ByteArrayInputStream. (.getBytes ^String %))
                                         csv-lines)
                                    (lazy-seq
                                      (.close raw-conn)
                                      '()))))))


(defn get-view-name-from-table-id [db table-id]
  (format "data_tables.table_%d" table-id))

(defn drop-view! [db {table-id :id :keys [storage] :as table-record}]
  (when-not (:split storage)
    (let [VIEW-NAME (get-view-name-from-table-id db table-id)]
      (util/with-metric-query "DROP VIEW" (jdbc/execute! db [(str "DROP VIEW IF EXISTS " VIEW-NAME " CASCADE")]))
      (util/with-metric-query "DROP FUNCTION" (jdbc/execute! db [(str "DROP FUNCTION IF EXISTS " VIEW-NAME "_update")]))
      (util/with-metric-query "DROP TRIGGER" (jdbc/execute! db [(str "DROP TRIGGER IF EXISTS update_trigger ON " VIEW-NAME)])))))


(defn update-table-view! [db {table-id :id :keys [columns storage] :as table-record}]
  (when (and (not (:split storage))
             (not (get-in db [:anvil/pool-info :multi-tenant-db?]))
             (get-in db [:anvil/pool-info :allow-admin-actions?]))
    (drop-view! db table-record)
    (log/trace "Updating view for table" table-id "with cols" (pr-str columns))
    (let [VIEW-NAME (get-view-name-from-table-id db table-id)
          view-cols (for [col (sort-by (fn [c] (-> c :admin_ui :order)) (for [[col-id col-spec] columns]
                                                                          (assoc col-spec :id col-id)))]
                      (do
                        (when-not (re-matches #"[-A-Za-z0-9+_=]+" (name (:id col)))
                          (throw (Exception. (str "Invalid column ID " (:id col)))))
                        (assoc col :VIEW-NAME (-> (:name col)
                                                  (.toLowerCase)
                                                  (clojure.string/replace #"[^a-zA-Z0-9]" "_"))
                                   :ID (name (:id col)))))

          ;; TODO: Check for clashing col-names. Currently blows up silently, but then so does everything else.

          create-view-sql [(str "CREATE VIEW " VIEW-NAME " WITH (security_barrier) AS"
                                " SELECT "
                                " id as _id"
                                (->> (for [col view-cols
                                           :let [ID (:ID col)]]
                                       (str
                                         (condp = (:type col)

                                           "number"
                                           (str ", (data->>'" ID "')::float")

                                           "bool"
                                           (str ", (data->>'" ID "')::bool")

                                           "date"
                                           (str ", (data->>'" ID "')::date")

                                           "datetime"
                                           (str ", (parse_anvil_timestamp(data->>'" ID "'))::timestamptz")

                                           "simpleObject"
                                           (str ", (data->'" ID "')::jsonb")

                                           "liveObject"
                                           (str ", (trim('\"' from data->'" ID "'->>'id')::jsonb->>1)::bigint")

                                           "media"
                                           (str ", (data->>'" ID "')::oid")

                                           ;"string" or anything else
                                           (str ", data->>'" ID "'"))

                                         " AS \"" (:VIEW-NAME col) "\""))
                                     (apply str))
                                " FROM app_storage_data"
                                " WHERE table_id = " table-id)]

          create-update-trigger-fn [(str "
          CREATE FUNCTION " VIEW-NAME "_update() RETURNS trigger AS $$
            DECLARE
              deleted_oid integer;
              has_lo boolean;
            BEGIN


              IF TG_OP = 'UPDATE' THEN

                IF NEW._id != OLD._id OR NEW._id IS NULL THEN
                  RAISE EXCEPTION 'Cannot change data table row ID';
                END IF;

                "
                                         (->> (for [col view-cols
                                                    :let [ID (:ID col)
                                                          COL-NAME (:VIEW-NAME col)
                                                          ERR (get {"liveObject"      "Cannot update links to other rows using SQL. Please use the Python Data Tables API."

                                                                    "liveObjectArray" "Cannot update links to other rows using SQL. Please use the Python Data Tables API."

                                                                    "media"           "Cannot update Media objects in Data Tables using SQL. Please use the Python Data Tables API."}
                                                                   (:type col))]
                                                    :when ERR]
                                                (str "IF NEW.\"" COL-NAME "\" IS NOT NULL AND (NEW.\"" COL-NAME "\" != OLD.\"" COL-NAME "\" OR OLD.\"" COL-NAME "\" IS NULL) THEN RAISE EXCEPTION '" ERR "'; END IF;"
                                                     (when (= (:type col) "media")

                                                       (str "\nIF NEW.\"" COL-NAME "\" IS NULL AND OLD.\"" COL-NAME "\" IS NOT NULL THEN \n"
                                                            "  DELETE FROM public.app_storage_media WHERE table_id = " table-id " AND row_id = OLD._id AND column_id = '" ID "' RETURNING object_id, (data IS NULL) as has_lo INTO deleted_oid, has_lo;\n"
                                                            "  IF has_lo THEN \n"
                                                            "    PERFORM lo_unlink(deleted_oid);\n"
                                                            "  END IF; \n"
                                                            "END IF;"))))
                                              (interpose "\n")
                                              (apply str))
                                         "

                UPDATE public.app_storage_data SET data = data || jsonb_build_object("
                                         (->> (for [col view-cols
                                                    :let [ID (:ID col)]
                                                    :when (not (#{"liveObject" "liveObjectArray" "media"} (:type col)))]
                                                (str
                                                  "'" ID "',"
                                                  (condp = (:type col)

                                                    "number"
                                                    (str "NEW.\"" (:VIEW-NAME col) "\"::float")

                                                    "bool"
                                                    (str "NEW.\"" (:VIEW-NAME col) "\"::bool")

                                                    "date"
                                                    (str "NEW.\"" (:VIEW-NAME col) "\"::date")

                                                    "datetime"
                                                    (str "public.to_anvil_timestamp(NEW.\"" (:VIEW-NAME col) "\"::timestamptz)")

                                                    "simpleObject"
                                                    (str "NEW.\"" (:VIEW-NAME col) "\"::jsonb")

                                                    (str "NEW.\"" (:VIEW-NAME col) "\""))))
                                              (interpose ",")
                                              (apply str)) ")"
                                         (->> (for [col view-cols
                                                    :let [COL-NAME (:VIEW-NAME col)
                                                          ID (:ID col)]
                                                    :when (#{"liveObject" "liveObjectArray" "media"} (:type col))]
                                                (str " || CASE WHEN NEW.\"" COL-NAME "\" IS NULL THEN '{\"" ID "\":null}'::jsonb ELSE '{}'::jsonb END"))
                                              (apply str))

                                         " WHERE table_id = " table-id " AND id = NEW._id;
                RETURN NEW;
              ELSIF TG_OP = 'INSERT' THEN
                INSERT INTO public.app_storage_data (table_id, data) VALUES (" table-id ", jsonb_build_object("
                                         (->> (for [col view-cols
                                                    :let [ID (:ID col)]]
                                                (str
                                                  "'" ID "',"
                                                  (condp = (:type col)

                                                    "number"
                                                    (str "NEW.\"" (:VIEW-NAME col) "\"::float")

                                                    "bool"
                                                    (str "NEW.\"" (:VIEW-NAME col) "\"::bool")

                                                    "date"
                                                    (str "NEW.\"" (:VIEW-NAME col) "\"::date")

                                                    "datetime"
                                                    (str "public.to_anvil_timestamp(NEW.\"" (:VIEW-NAME col) "\"::timestamptz)")

                                                    "simpleObject"
                                                    (str "NEW.\"" (:VIEW-NAME col) "\"::jsonb")

                                                    "liveObject" "NULL"
                                                    "liveObjectArray" "NULL"
                                                    "media" "NULL"

                                                    ;; else
                                                    (str "NEW.\"" (:VIEW-NAME col) "\""))))
                                              (interpose ",")
                                              (apply str))
                                         ")) RETURNING id INTO NEW._id;
                   RETURN NEW;
                 ELSIF TG_OP = 'DELETE' THEN
                   "
                                         (->> (for [col view-cols
                                                    :let [ID (:ID col)]
                                                    :when (= (:type col) "media")]
                                                (str "DELETE FROM public.app_storage_media WHERE table_id = " table-id " AND row_id = OLD._id AND column_id = '" ID "' RETURNING object_id, (data IS NULL) as has_lo INTO deleted_oid, has_lo;"
                                                     "IF has_lo THEN \n"
                                                     "  PERFORM lo_unlink(deleted_oid); \n"
                                                     "END IF; "))
                                              (apply str))
                                         "
                   DELETE FROM public.app_storage_data WHERE table_id = " table-id " AND id = OLD._id;
                IF NOT FOUND THEN RETURN NULL; END IF;
                RETURN OLD;
              END IF;
            END;
            $$ LANGUAGE plpgsql SECURITY DEFINER;")]

          setup-function-permissions-sql [(str "REVOKE ALL ON FUNCTION " VIEW-NAME "_update FROM public;")]

          create-update-trigger-sql [(str "
          CREATE TRIGGER update_trigger
            INSTEAD OF INSERT OR UPDATE OR DELETE ON " VIEW-NAME "
            FOR EACH ROW EXECUTE PROCEDURE " VIEW-NAME "_update();")]]
      (util/with-metric-query "CREATE VIEW" (jdbc/execute! db create-view-sql))
      (util/with-metric-query "CREATE/UPDATE TRIGGER FUNCTION" (jdbc/execute! db create-update-trigger-fn))
      (util/with-metric-query "CONFIGURE TRIGGER FUNCTION" (jdbc/execute! db setup-function-permissions-sql))
      (util/with-metric-query "CREATE/UPDATE TRIGGER SQL" (jdbc/execute! db create-update-trigger-sql)))))

(defonce update-table-views! (fn [db table-record] (update-table-view! db table-record)))


(def set-table-hooks! (util/hook-setter [table-mapping-for-environment cache-key-for-table-mapping
                                         db-for-mapping db-for-mapping-transaction
                                         get-table-access get-table-id-by-name
                                         get-all-table-access-records delete-table-access-record!
                                         update-table-access-record! update-table-views!]))

(defrecord TableAdminPolicy [allow-index?]) ; allow-index?: (db, storage, index) -> bool

(def TABLE-ADMIN-POLICY-ALLOW-ALL (map->TableAdminPolicy {:allow-index? (constantly true)}))