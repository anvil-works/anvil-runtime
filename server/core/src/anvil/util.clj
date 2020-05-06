(ns anvil.util
  (:use [clojure.pprint]
        [slingshot.slingshot])
  (:require [digest]
            [anvil.runtime.conf :as conf]
            [clojure.data.json :as json]
            [clojure.java.jdbc :as jdbc]
            [clojure.tools.logging :as log]
            [ring.util.codec :as codec]
            [clojure.string :as string]
            [anvil.metrics :as metrics]
            [clojure.core.cache.wrapped :as cache])
  (:import (org.httpkit.server AsyncChannel)
           (java.sql SQLException)
           (javax.crypto Mac)
           (javax.crypto.spec SecretKeySpec)
           (org.mindrot.jbcrypt BCrypt)
           (clojure.lang Keyword)
           (java.net InetAddress)
           (com.maxmind.db CHMCache)
           (com.maxmind.geoip2 DatabaseReader$Builder DatabaseReader)
           (java.io File)
           (com.maxmind.geoip2.exception GeoIp2Exception)
           (com.mchange.v2.c3p0 DataSources)
           (java.util Properties Map Timer TimerTask)
           (javax.sql DataSource)
           (java.time Instant ZoneOffset)
           (java.time.format DateTimeFormatter)
           (net.ttddyy.dsproxy.support ProxyDataSourceBuilder)
           (net.ttddyy.dsproxy.listener QueryExecutionListener)
           (net.ttddyy.dsproxy ExecutionInfo QueryInfo)
           (com.maxmind.geoip2.model CityResponse)))

(def ^:dynamic *in-repl?* false)

; These apps are down for maintenance. Don't let anything touch them.
(defonce locked-app-ids (atom #{}))

(defn app-locked? [app-id]
  (contains? @locked-app-ids (.toUpperCase (or app-id ""))))

(defn sha-256 [val]
  (digest/sha-256 (or val "")))

(defn bcrypt-checkpw [password hash]
  (try
    (let [hash (clojure.string/replace hash #"^\$2[bxy]\$" "\\$2a\\$")]
      (BCrypt/checkpw password hash))
    (catch Exception e
      ;; E.g. NullPointerException because there was no hash or no password
      false)))

(defn- hexify "Convert byte sequence to hex string" [coll]
  (let [hex [\0 \1 \2 \3 \4 \5 \6 \7 \8 \9 \a \b \c \d \e \f]]
    (letfn [(hexify-byte [b]
              (let [v (bit-and b 0xFF)]
                [(hex (bit-shift-right v 4)) (hex (bit-and v 0x0F))]))]
      (apply str (mapcat hexify-byte coll)))))

(defn hmac-sha-256
  [key-seq byte-seq]
  (let [hmac-key (SecretKeySpec. (byte-array key-seq) "HmacSHA256")
        hmac (doto (Mac/getInstance "HmacSHA256") (.init hmac-key))]
    (hexify (.doFinal hmac (byte-array byte-seq)))))

;; Pass to json/write-str to preserve slashes in keywords
(defn preserve-slashes [val]
  (if (keyword? val)
    (.substring (.toString ^Keyword val) 1)
    val))

(defn write-json-str [val]
  (json/write-str val :key-fn preserve-slashes))

(defn as-properties [kw-map]
  (let [p (Properties.)]
    (doseq [[k v] kw-map]
      (.put p (name k) (str v)))
    p))

(def ^:dynamic *metric-query-name* nil)

(defmacro with-metric-query [name & body]
  `(binding [*metric-query-name* (str "<" ~name ">")]
     ~@body))

(defonce metric-queries (atom {}))

(defn mk-refractory-DataSource ^DataSource [jdbc-url underlying-config-map refractory-period]
  (let [ds (DataSources/unpooledDataSource jdbc-url (as-properties underlying-config-map))
        last-failure-time (atom 0)
        get-connection (fn [[username password :as has-auth?]]
                         (let [start (System/currentTimeMillis)]
                           (when (and (pos? refractory-period) (< (System/currentTimeMillis) (+ @last-failure-time refractory-period)))
                             (throw (SQLException. (format "Database connection failed recently (%.1fs ago)"
                                                           (/ (- (System/currentTimeMillis) @last-failure-time) 1000.0)))))
                           (try
                             (if has-auth?
                               (.getConnection ds username password)
                               (.getConnection ds))
                             (catch SQLException e
                               (println (format "Failed in %.1fs" (/ (- (System/currentTimeMillis) start) 1000.0)))
                               (reset! last-failure-time (System/currentTimeMillis))
                               (throw e)))))]
    (reify DataSource
      (getConnection [_this] (get-connection nil))
      (getConnection [_this username password] (get-connection [username password])))))

(defonce query-timeout-timer (Timer. true))

(def ^:dynamic *db-query-timeout* 60000)

(defn on-before-query [jdbc-uri ^ExecutionInfo exec-info query-info-list]
  (let [query (or *metric-query-name*
                  (try
                    (-> (.getQuery ^QueryInfo (first query-info-list))
                        (clojure.string/replace #"\s+" " "))
                    (catch Exception e nil))
                  "<Unknown query>")

        query-loc (or (get @metric-queries query)
                      (let [location (if-let [loc (first
                                                    (->> (.getStackTrace (Exception.))
                                                         (drop-while #(not (.startsWith (.getClassName %) "clojure.java.jdbc")))
                                                         (drop-while #(not (.startsWith (.getClassName %) "anvil.")))))]
                                       (let [func (-> (apply str (interpose "/" (take 2 (.split (.getClassName loc) "\\$"))))
                                                      (.replace "_BANG_" "!"))
                                             file (str (.getFileName loc) ":" (.getLineNumber loc))]
                                         (str func " (" file ")"))
                                       "Unknown location")]

                        (swap! metric-queries assoc query location)
                        location))
        query-length (count query)
        query-label (str (subs query 0 (min query-length 150))
                         (when (> query-length 150) "...")
                         " ["
                         query-loc
                         "]")
        timeout-task (proxy [TimerTask] []
                       (run []
                         (log/error "DB Query timed out after >" *db-query-timeout* "ms on" jdbc-uri ":" query-label)
                         (metrics/inc! :api/jdbc-query-timeouts)
                         (.cancel (.getStatement exec-info))))]
    (.schedule ^Timer query-timeout-timer timeout-task ^Number *db-query-timeout*)
    (.addCustomValue exec-info "query-timeout-task" timeout-task)
    (.addCustomValue exec-info "stop-query-timer!"
                     (metrics/start-timer :api/jdbc-query-duration-seconds
                                          {:uri   jdbc-uri
                                           :query query-label}))))

(defn on-after-query [_jdbc-uri ^ExecutionInfo exec-info _query-info-list]
  (.cancel ^TimerTask (.getCustomValue exec-info "query-timeout-task" TimerTask))
  ((.getCustomValue exec-info "stop-query-timer!" Runnable)))

(defonce cached-pools (atom {}))

(defn get-pooled-datasource [{:keys [subprotocol subname dbtype dbname host port connection-uri]
                              :as   db-spec}
                             pool-params]
  (or (get @cached-pools db-spec)
      (locking cached-pools
        (or (get @cached-pools db-spec)
            (let [jdbc-uri (or connection-uri
                               (when (and subprotocol subname)
                                 (format "jdbc:%s:%s" subprotocol subname))
                               (when (and dbtype dbname host)
                                 (format "jdbc:%s://%s%s/%s" dbtype host (when port (str ":" port)) dbname)))

                  ds (mk-refractory-DataSource jdbc-uri
                                               (-> db-spec
                                                   (dissoc :connection-uri :subprotocol :subname :dbtype :dbname
                                                           :host :port :classname))
                                               (or (:refractory-period pool-params) 0))

                  proxied-ds (-> (ProxyDataSourceBuilder/create ds)
                                 (.listener (reify QueryExecutionListener
                                              (beforeQuery [_ exec-info query-info-list]
                                                (on-before-query jdbc-uri exec-info query-info-list))
                                              (afterQuery [_ exec-info query-info-list]
                                                (on-after-query jdbc-uri exec-info query-info-list))))
                                 (.build))

                  pool-params (into {} (for [[k v] pool-params] [(name k) (if (integer? v) (int v) v)]))
                  pool (DataSources/pooledDataSource proxied-ds ^Map pool-params)]
              (swap! cached-pools assoc db-spec pool)
              pool)))))

(def ^:private global-db-datasource (delay (if conf/db
                                             (get-pooled-datasource (assoc conf/db :refractory-period 0) conf/db-pool-params)
                                             (throw (Exception. "Attempted to use util/db before conf/db was set up")))))

(def db {:datasource (reify DataSource
                       (getConnection [_this] (.getConnection ^DataSource @global-db-datasource)))})

(def LATEST-DB-VERSION "2019-09-23-B-denormalise-app-sessions")

(defn require-latest-db-version []
  (try
    (let [current-version (:version (first (jdbc/query db ["SELECT version FROM db_version"])))]
      (when (not= current-version LATEST-DB-VERSION)
        (throw (Exception.))))
    (catch Exception _
      (log/warn "Anvil DB schema update required. Please run migrator then restart Anvil.")
      #_(System/exit 1))))

(defmacro letd [lets & body]
  (let [new-lets (->> lets
                      (partition 2)
                      (map (fn [[s v]] `(~s ~v _# (println (str (quote ~s) ":") ~s))))
                      (apply concat)
                      (vec))
        new-lets (conj new-lets `_# `(println "************"))]
    `(do
       (println "*** letd ***")
       (let ~new-lets ~@body))))

(defmacro log-time [level message & body]
  `(let [start-time# (System/currentTimeMillis)
         val# (do ~@body)]
    (log/logp ~level ~message (str "(" (- (System/currentTimeMillis) start-time#) " ms)"))
    val#))

(defmacro with-opening-channel
  "Similar to org.httpkit.server/with-channel, except body executes before
  the WebSocket handshake is done, ensuring that the on-receive handler is
  registered before we can possibly receive anything. On the other hand, we
  can't call send! directly in the body."
  [request ch-name on-open & body]
  `(let [~ch-name (:async-channel ~request)
         ~on-open (atom (fn []))]
     (if (:websocket? ~request)
       (if-let [key# (get-in ~request [:headers "sec-websocket-key"])]
         (do ~@body
             (.sendHandshake ~(with-meta ch-name {:tag `AsyncChannel})
                             {"Upgrade"    "websocket"
                              "Connection" "Upgrade"
                              "Sec-WebSocket-Accept" (org.httpkit.server/accept key#)})
             (@~on-open)
             {:body ~ch-name})
         {:status 400 :body "Bad Sec-WebSocket-Key header"})
       (do ~@body
           {:body ~ch-name}))))

(defmacro with-db-transaction [bindings & body]
  `(loop [n# 10]
     (let [[recur?# r#]
           (try+
             (jdbc/with-db-transaction [~@bindings {:isolation :serializable}]
               [false (do ~@body)])
             (catch SQLException e#
               (if (and (= "40001" (.getSQLState e#)) (> n# 0))
                 (do (log/trace "Conflict in with-db-transaction") [true nil])
                 (throw e#))))]
       (if recur?#
         (recur (dec n#))
         r#))))

(defn- double-escape [^String x]
  (.replace (.replace x "\\" "\\\\") "$" "\\$"))

(defn real-actual-genuine-url-encoder [unencoded & [encoding]]
  (string/replace
    unencoded
    #"[^A-Za-z0-9_~.-]+"
    #(double-escape (codec/percent-encode % (or encoding "UTF-8")))))

(defmacro or-str
  ([] nil)
  ([s & rest]
   `(let [s# ~s]
      (if (and s#
               (not-empty s#))
        s#
        (or-str ~@rest)))))

(defmacro timeit [desc [checkpoint!] & body]
  `(let [s# (System/currentTimeMillis)
         ~checkpoint! (fn [c#] (log/trace (str ~desc ":" c#) "completed in" (- (System/currentTimeMillis) s#) "ms"))
         r# (do ~@body)]
     (log/trace ~desc "completed in" (- (System/currentTimeMillis) s#) "ms")
     r#))

(def additional-mime-types
  {"woff2" "application/font-woff2"})

(defn iso-instant [^Instant instant]
  (.format (.withZone (DateTimeFormatter/ofPattern "yyyy-MM-dd'T'HH:mm:ss'Z'")
                      (ZoneOffset/UTC))
           instant))

(defn iso-now [] (iso-instant (Instant/now)))

(def geoip-db
  (delay
    (when conf/geoip-db-path
      (let [f (File. ^String conf/geoip-db-path)]
        (when (.isFile f)
          (-> (DatabaseReader$Builder. f)
              (.withCache (CHMCache.))
              (.build)))))))

(defn get-ip-location [remote-addr]
  (when (and @geoip-db remote-addr)
    (try
      (let [r ^CityResponse
              (->> (InetAddress/getByName remote-addr)
                   (.city ^DatabaseReader @geoip-db))]

        {:country     (when-let [c (.getCountry r)]
                        {:code (.getIsoCode c), :name (.getName c)})
         :city        (when-let [c (.getCity r)] (.getName c))
         :location    (when-let [l (.getLocation r)] {:lat (.getLatitude l), :lng (.getLongitude l)})
         :subdivision (when-let [s (.getMostSpecificSubdivision r)]
                        {:code (.getIsoCode s), :name (.getName s)})})
      (catch GeoIp2Exception _e
        nil))))

(defn report-uncaught-exception [location-description e]
  (log/error e (str "Reporting uncaught exception in " location-description))
  (metrics/inc! :api/uncaught-exceptions-total))

(defmacro with-report-uncaught-exceptions [name & body]
  ;; NB: This re-throws any exceptions, so make sure they don't end up being caught by report-uncaught-exception again.
  `(try
     ~@body
     (catch Exception e#
       (report-uncaught-exception ~name e#)
       (throw e#))))

(defmacro future-reporting-exceptions [name & body]
  ;; NB: This re-throws any exceptions, so make sure they don't end up being caught by derefing the future.
  `(future
     (with-report-uncaught-exceptions name
       ~@body)))

(defmacro with-meta-when [m & body]
  `(when-let [r# (do ~@body)]
     (with-meta r# ~m)))

(defmacro $ [a b c] `(~b ~a ~c))

;; To define hookable functions, in runtime:
;;     (def set-foo-hooks! (hook-setter #{foo bar baz})
;; To set hooks, in platform or standalone:
;;     (runtime.blah/set-foo-hooks! {:foo my-foo, :bar my-bar})
;; OR, if your hooked functions have the same names:
;;     (runtime.blah/set-foo-hooks! (util/hooks #{foo bar baz}))

(defn -set-hooks! [kws-to-vars kws-to-values]
  (doseq [[kw val] kws-to-values]
    (if-let [v (get kws-to-vars kw)]
      (alter-var-root v (constantly val))
      (throw (Exception. (format "%s is not a hookable function" (name kw)))))))

(defn -map-from-symbols
  ([syms] (-map-from-symbols syms identity))
  ([syms default-val-fn]
   (if (map? syms)
     syms
     (into {}
           (for [sym syms]
             (do
               (when-not (symbol? sym)
                 (Exception. (format "'%s' is not a symbol" (pr-str sym))))
               [(keyword (name sym)) (default-val-fn sym)]))))))

(defmacro hook-setter [hookable-fns]
  (let [var-map (-map-from-symbols hookable-fns (fn [sym] `(var ~sym)))]
    `(fn [hook-map#]
       (-set-hooks! ~var-map hook-map#))))

(defmacro hooks [hooks]
  (-map-from-symbols hooks))

(defmacro defn-with-ttl-memoization [func args ttl & body]
  `(def ~func
     (let [ttl-cache# (cache/ttl-cache-factory {} :ttl ~ttl)]
       (fn ~args
         (-> (cache/through-cache ttl-cache# ~args (fn [~args] ~@body))
             (get ~args))))))
