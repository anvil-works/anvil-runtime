(ns anvil.app-server.postgres
  (:require [clojure.java.jdbc :as jdbc]
            [clojure.tools.logging :as log]
            [crypto.random :as random])
  (:import (java.net ServerSocket BindException URLEncoder)
           (java.io File FileOutputStream)
           (io.zonky.test.db.postgres.embedded EmbeddedPostgres)
           (java.lang ProcessBuilder$Redirect)))


;; Slightly more sane pg_hba.conf defaults
(def OVERRIDE-PG-HBA-CONF "
# TYPE  DATABASE        USER            ADDRESS                 METHOD
# IPv4 local connections:
host    all             all             127.0.0.1/32            md5
# IPv6 local connections:
host    all             all             ::1/128                 md5
")

(defn launch-bundled-db! [^File anvil-data-dir exclusivity-port]
  ;; So, sometimes we may have a "zombie" postgres lying around.
  ;; Our logic: If we can serve on the port we're supposed to, the previous
  ;; owner of that postgres is dead, and we can kill it.
  (try
    (.close (ServerSocket. exclusivity-port))
    (catch BindException e
      (println (format "HTTP port %d is not available: %s.\nThis probably means another Anvil app server with this configuration is already running." exclusivity-port (.getMessage e)))
      (System/exit 1)))


  (let [data-dir (File. anvil-data-dir "db")
        bin-dir (File. anvil-data-dir "db-bin")
        pg-hba-conf (File. data-dir "pg_hba.conf")
        log-stdout (File. anvil-data-dir "postgres.log")
        log-stderr (File. anvil-data-dir "postgres.err")
        password-file (File. anvil-data-dir "postgres.password")]

    (clj-logging-config.log4j/set-logger! "io.zonky.test.db.postgres.embedded"
                                          :level :trace
                                          :out (File. anvil-data-dir "postgres-embedding.log")
                                          :pattern "[%-5p %c] %m%n")

    (log/info "Launching embedded Postgres database. Find Postgres daemon logs in" (.getPath anvil-data-dir))

    (when (.exists (-> anvil-data-dir (File. "db") (File. "postmaster.pid")))
      (log/info "Found postmaster.pid; attempting to shut down orphaned DB")

      ;; Quick and dirty call to "pg_ctl stop"
      (-> (doto (ProcessBuilder. #^"[Ljava.lang.String;" (into-array String [(str (.getPath (first (.listFiles bin-dir))) "/bin/pg_ctl")
                                                                             "-D" (.getPath data-dir) "stop" "-m" "fast" "-w" ]))
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
                        (.setCleanDataDirectory false))

          ;; By default, this library brings up a DB with no password for the superuser(!)
          ;; Set a password, then overwrite pg_hba.conf with something more sane.
          password (if (.exists password-file)
                     (slurp password-file)
                     (let [password (random/base32 32)
                           pg (.start pg-config)]

                       (log/info "Initialising embedded Postgres database...")

                       ;; Yes, command substitution doesn't work here, so we do That Thing You
                       ;; Should Never Do. Mercifully, we only just generated `password`, and
                       ;; random/base32 produces only numbers and letters.
                       (jdbc/execute! {:classname      "org.postgresql.Driver"
                                       :connection-uri (.getJdbcUrl pg "postgres" "postgres")}
                                      [(str "ALTER USER postgres WITH PASSWORD '" password "'")])

                       (.close pg)

                       (with-open [f (FileOutputStream. password-file)]
                         (.write f (.getBytes password)))
                       (with-open [f (FileOutputStream. pg-hba-conf)]
                         (.write f (.getBytes OVERRIDE-PG-HBA-CONF)))
                       password))

          pg-config (.setConnectConfig pg-config "password" password)

          pg (.start pg-config)]

      ;; Our embedded postgres library

      (str (.getJdbcUrl pg "postgres" "postgres") "&password=" (URLEncoder/encode password)))))