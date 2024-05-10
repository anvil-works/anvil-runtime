(ns anvil.app-server.postgres
  (:require [clojure.java.jdbc :as jdbc]
            [clojure.tools.logging :as log]
            [crypto.random :as random]
            clj-logging-config.log4j
            [anvil.core.worker-pool :as worker-pool])
  (:import (java.net ServerSocket BindException URLEncoder)
           (java.io File FileOutputStream)
           (io.zonky.test.db.postgres.embedded EmbeddedPostgres EmbeddedPostgres$Builder)
           (java.lang ProcessBuilder$Redirect)
           (java.nio.file FileSystems)
           (java.sql SQLException)
           (java.time Duration)
           (java.util Timer)
           (org.apache.commons.io.input Tailer TailerListener TailerListenerAdapter)))


;; Slightly more sane pg_hba.conf defaults
(def OVERRIDE-PG-HBA-CONF "
# TYPE  DATABASE        USER            ADDRESS                 METHOD
# IPv4 local connections:
host    all             all             127.0.0.1/32            md5
# IPv6 local connections:
host    all             all             ::1/128                 md5
")
;; This is the default from the embedded-postgres library, but we also
;; have to set it directly to recover a backup with an unknown postgres
;; password.
(def INSECURE-TRUST-PG-HBA-CONF "
# TYPE  DATABASE        USER            ADDRESS                 METHOD
# IPv4 local connections:
host    all             all             127.0.0.1/32            trust
# IPv6 local connections:
host    all             all             ::1/128                 trust
")

(defn start-postgres-with-timeout [^File anvil-data-dir ^EmbeddedPostgres$Builder pg-config]
  ;; A smarter timeout that checks for Postgres's arrival
  (let [startup-result (future (.start pg-config))
        db-data-dir (File. anvil-data-dir "db")
        pid-file (File. db-data-dir "postmaster.pid")
        start-time (System/currentTimeMillis)]
    (loop [pid-seen? false ^Tailer tailer nil]
      (let [now (System/currentTimeMillis)]
        (cond
          (realized? startup-result)
          (do
            (when tailer
              (.stop tailer)
              (log/info "**** Further postgres logs available in" (.getPath (File. anvil-data-dir "postgres.log")) "***"))
            @startup-result)

          (not pid-seen?)
          (cond
            (.exists pid-file)
            (recur true nil)

            (> now (+ start-time 10000))
            (throw (Exception. "Database server did not start (no PID file) within 10s"))

            :else
            (do
              (Thread/sleep 200)
              (recur false nil)))

          (and (not tailer) (> now (+ start-time 10000)))
          (let [tailer (Tailer. (File. anvil-data-dir "postgres.log")
                                (proxy [TailerListenerAdapter] []
                                  (handle [line]
                                    (if (string? line)
                                      (println line)
                                      (do
                                        (.printStackTrace ^Exception line)
                                        (System/exit 1))))))]
            (log/info "Database server has started, but taking >10s to start. Providing live logs for information:\n******** POSTGRES LOGS BEGIN ********")
            (.start (Thread. tailer))
            (recur true tailer))

          ;(not (.exists pid-file))
          ;(throw (Exception. "Database server started but terminated unexpectedly. Check logs for details."))

          :else
          (do
            (Thread/sleep 200)
            (recur true tailer)))))))

(defn launch-bundled-db! [^File anvil-data-dir exclusivity-port init-config]
  ;; So, sometimes we may have a "zombie" postgres lying around.
  ;; Our logic: If we can serve on the port we're supposed to, the previous
  ;; owner of that postgres is dead, and we can kill it.
  (try
    (.close (ServerSocket. exclusivity-port))
    (catch BindException e
      (println (format "HTTP port %d is not available: %s.\nThis probably means another Anvil app server with this configuration is already running." exclusivity-port (.getMessage e)))
      (System/exit 1)))

  (try
    (let [data-dir (File. anvil-data-dir "db")
          bin-dir (File. anvil-data-dir "db-bin")
          pg-hba-conf (File. anvil-data-dir "pg_hba.conf")
          log-stdout (File. anvil-data-dir "postgres.log")
          log-stderr (File. anvil-data-dir "postgres.err")
          password-file (File. anvil-data-dir "postgres.password")]

      (clj-logging-config.log4j/set-logger! "io.zonky.test.db.postgres.embedded"
                                            :level :trace
                                            :out (File. anvil-data-dir "postgres-embedding.log")
                                            :pattern "[%-5p %c] %m%n")

      (log/info "Launching embedded Postgres database. Find Postgres daemon logs in the '" (.getPath anvil-data-dir) "' directory.")

      (when (.exists (-> anvil-data-dir (File. "db") (File. "postmaster.pid")))
        (log/info "Found postmaster.pid; attempting to shut down orphaned DB")

        ;; Quick and dirty call to "pg_ctl stop"
        (-> (doto (ProcessBuilder. #^"[Ljava.lang.String;" (into-array String [(str (.getPath (first (.listFiles bin-dir))) "/bin/pg_ctl")
                                                                               "-D" (.getPath data-dir) "stop" "-m" "fast" "-w"]))
              (.redirectError (ProcessBuilder$Redirect/appendTo log-stdout))
              (.redirectOutput (ProcessBuilder$Redirect/appendTo log-stderr)))
            (.start)
            (.waitFor)))

      ;; TODO set up some authentication, my goodness.

      (let [pg-config (-> (EmbeddedPostgres/builder)
                          (.setOutputRedirector (ProcessBuilder$Redirect/appendTo log-stdout))
                          (.setErrorRedirector (ProcessBuilder$Redirect/appendTo log-stderr))
                          (.setDataDirectory data-dir)
                          (.setOverrideWorkingDirectory bin-dir)
                          (.setCleanDataDirectory false)
                          (.setPGStartupWait (Duration/ofDays 10000))
                          (.setServerConfig "hba_file" (.getAbsolutePath pg-hba-conf))
                          ^EmbeddedPostgres$Builder (init-config))

            ;; By default, this library brings up a DB with no password for the superuser(!)
            ;; Set a password, then overwrite pg_hba.conf with something more sane.
            password (if (.exists password-file)
                       (do
                         (with-open [f (FileOutputStream. pg-hba-conf)]
                           (.write f (.getBytes OVERRIDE-PG-HBA-CONF)))
                         (slurp password-file))
                       (let [_ (with-open [f (FileOutputStream. pg-hba-conf)]
                                 (.write f (.getBytes INSECURE-TRUST-PG-HBA-CONF)))

                             password (random/base32 32)
                             pg ^EmbeddedPostgres (start-postgres-with-timeout anvil-data-dir pg-config)]

                         (log/info "Initialising embedded Postgres database...")

                         (loop []
                           ;; Yes, command substitution doesn't work here, so we do That Thing You
                           ;; Should Never Do. Mercifully, we only just generated `password`, and
                           ;; random/base32 produces only numbers and letters.
                           (when
                             (try
                               (jdbc/execute! {:classname      "org.postgresql.Driver"
                                               :connection-uri (.getJdbcUrl pg "postgres" "postgres")}
                                              [(str "ALTER USER postgres WITH PASSWORD '" password "'")])
                               false
                               (catch SQLException e
                                 (when (= "25006" (.getSQLState e))
                                   (Thread/sleep 200)
                                   true)))
                             (recur)))

                         (.close pg)

                         (with-open [f (FileOutputStream. password-file)]
                           (.write f (.getBytes password)))
                         (with-open [f (FileOutputStream. pg-hba-conf)]
                           (.write f (.getBytes OVERRIDE-PG-HBA-CONF)))
                         password))

            pg-config (.setConnectConfig pg-config "password" password)

            pg (start-postgres-with-timeout anvil-data-dir pg-config)]

        {:managed? true
         :connection-string (str (.getJdbcUrl pg "postgres" "postgres") "&password=" (URLEncoder/encode password))
         :data-dir (.getAbsolutePath data-dir)
         :password password
         :username "postgres"
         :dbname "postgres"
         :port (.getPort pg)}))
    (catch Exception e
      (.printStackTrace e)
      (println (str "Failed to start built-in Postgres database: " (str e)
                    "\nMore logs are available in " (.getPath (File. anvil-data-dir "postgres.log")) "."
                    "\nSome common causes of this problem:"
                    "\n - Are you launching this server as 'root' on a UNIX system? "
                    "\n   Postgres will not run as root; try launching the server as an ordinary user."
                    "\n - Are you running this server on an unusual architecture or OS? (" (System/getProperty "os.name") "/" (System/getProperty "os.arch") ")"))
      (System/exit 1))))
