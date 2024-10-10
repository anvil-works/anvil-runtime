(ns anvil.app-server.run
  (:require [slingshot.slingshot :refer [try+ throw+]]
            [ring.middleware.defaults :refer [wrap-defaults site-defaults]]
            [clojure.pprint :refer :all]
            [anvil.app-server.conf :as conf]
            [anvil.app-server.core :as core]
            [anvil.app-server.dispatch :as dispatch]
            [anvil.app-server.postgres :as postgres]
            [anvil.util :refer :all]
            [anvil.logging]
            [compojure.core :refer :all]
            [anvil.runtime.email-server :as email-server]
            [anvil.runtime.cron :as cron]
            [clojure.tools.logging :as log]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.runtime.sessions :as runtime-sessions]
            [anvil.util :as util]
            [anvil.core.server :as anvil-server]
            [anvil.app-server.secrets]
            [clojure.tools.cli :as cli]
            [clj-yaml.core :as yaml]
            [migrator.core :as migrator-core]
            [anvil.runtime.conf :as runtime-conf]
            (anvil.dispatcher.native-rpc-handlers core bcrypt cookies email facebook http microsoft stripe time util)
            [crypto.random :as random]
            [anvil.logging :as logging]
            [embedded-traefik.core :as traefik]
            [ring.middleware.json :as ring-json]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.core.ring.middleware.absolute-redirects :as absolute-redirects]
            [org.httpkit.server :refer [send! Channel]])
  (:gen-class)
  (:import (org.subethamail.smtp.server SMTPServer)
           (java.io File)
           (java.lang ProcessBuilder)
           (java.net ServerSocket URI)))

(clj-logging-config.log4j/set-logger! :level :trace)

(defn launch-shell! [uplink-key server-host server-port]
  (doto (Thread. ^Runnable
                 (fn []
                   (log/info "Launching interactive Python shell...")
                   (let [pb (ProcessBuilder. #^"[Ljava.lang.String;" (into-array String [(or (System/getenv "PYTHON_INTERPRETER") "python") "-m" "anvil_app_server.shell"]))]
                     (doto (.environment pb)
                       (.put "ANVIL_UPLINK_URL" (str "ws://" server-host ":" server-port "/_/uplink"))
                       (.put "ANVIL_UPLINK_KEY" uplink-key)
                       (.put "ANVIL_APP_PATH" (conf/get-app-path)))
                     (.inheritIO pb)
                     (let [rv (.waitFor (.start pb))]
                       (log/info "Python shell exited with status" rv "; app server exiting.")
                       (System/exit rv)))))
    (.setDaemon true)
    (.start)))

(defn get-available-port []
  ;; Try 1000 random ports between 10000 and 60000 until we find an open one
  (loop [remaining-attempts 1000]
    (let [attempt-port (+ 10000 (rand-int 50000))
          unavailable? (try (.close (ServerSocket. attempt-port)) (catch Exception _ true))]
      (if unavailable?
        (recur (dec remaining-attempts))
        attempt-port))))

(defn get-port [uri-str]
  (let [uri (URI. (str uri-str))
        port (.getPort uri)]
    (when (> port -1)
      port)))

(Thread/setDefaultUncaughtExceptionHandler
  (reify Thread$UncaughtExceptionHandler
    (uncaughtException [_ thread ex]
      (log/error ex))))

(def arg-require-equals [#(re-matches #"(.*?)=(.*)" %) "Expected NAME=VALUE"])
(def arg-update-map-with-equals #(let [[_ k v] (re-matches #"(.*?)=(.*)" %3)]
                               (update-in %1 [%2] assoc (keyword k) v)))

(def COMMAND-LINE-OPTIONS [[nil "--config-file FILENAME" "Load config from the specified YAML file"]
                           [nil "--data-dir DIRECTORY" "Store data in the specified directory (default: .anvil-data)"]
                           [nil "--auto-migrate" "Migrate data tables schema automatically"]
                           [nil "--ignore-invalid-schema" "Ignore invalid data tables schema and run anyway"]
                           [nil "--database DB-URL" "Database URL"]
                           [nil "--data-table-txn-timeout SECONDS" "Data Table Transactions left idle for this long will time out. Default: 10"]
                           [nil "--db-connection-pool-size SIZE" "The maximum size of the DB connection pool. Default: 2*CPU cores (size of thread pool)"]
                           [nil "--app DIRECTORY" "Load and run the specified app"]
                           [nil "--dep-id ID=PACKAGE" "Associate a dependency app ID with its package name"
                            :validate arg-require-equals :assoc-fn arg-update-map-with-equals]
                           [nil "--secret NAME=VALUE" "Provide an app secret"
                            :validate arg-require-equals :assoc-fn arg-update-map-with-equals]
                           [nil "--encryption-key NAME=VALUE" "Pass an app encryption key"
                            :validate arg-require-equals :assoc-fn arg-update-map-with-equals]
                           [nil "--downlink-key KEY" "Authentication key for a separately launched downlink"]
                           [nil "--downlink-worker-timeout SECONDS" "Timeout for server code running in embedded downlink. Default: 30"]
                           [nil "--uplink-key KEY" "Key to connect server (privileged) uplinks to this app"]
                           [nil "--client-uplink-key KEY" "Key to connect client (unprivileged) uplinks to this app"]
                           [nil "--shell" "Launch an interactive Python shell (connected via the Uplink)"]
                           [nil "--ip IP" "Listen on the specified IP address"]
                           [nil "--port PORT" "Serve HTTP requests on the specified port"
                            :validate [#(re-matches #"[0-9]+" %) "Expected a port number"]]
                           [nil "--http-redirect-port PORT" "Redirect HTTP requests on the specified port to HTTPS"
                            :validate [#(re-matches #"[0-9]+" %) "Expected a port number"]]
                           [nil "--smtp-server-port PORT" "Accept SMTP email on the specified port"
                            :validate [#(re-matches #"[0-9]+" %) "Expected a port number"]]
                           [nil "--origin URL" "Set the home URL of this app (eg https://my-app.com)"]
                           [nil "--disable-tls" "Don't terminate TLS connections, regardless of the origin scheme"]
                           [nil "--forward-headers-insecure" "When running embedded TLS termination, pass through the X-Forwarded-* headers. Default: false"]
                           [nil "--add-hsts-headers" "Enable HSTS headers when origin URL uses https. Default: false"]
                           [nil "--letsencrypt-storage PATH" "Path to a JSON file to store LetsEncrypt certificates (default: <data-dir>/letsencrypt-certs.json)"]
                           [nil "--letsencrypt-staging" "Use the LetsEncrypt staging server"]
                           [nil "--manual-cert-file PATH" "Path to an external TLS certificate in PEM format"]
                           [nil "--manual-cert-key-file PATH" "Path to an external TLS certficate private key file in PEM format"]
                           [nil "--smtp-host HOST" "Hostname of SMTP server to use for sending email"]
                           [nil "--smtp-port PORT" "Port to connect to on SMTP server"
                            :validate [#(re-matches #"[0-9]+" %) "Expected a port number"]]
                           [nil "--smtp-encryption TYPE" "Use TLS to connect to SMTP server"
                            :validate [#(contains? #{"ssl" "starttls"} %) "Expected 'ssl' or 'starttls'"]]
                           [nil "--smtp-username USER" "Username to authenticate with on SMTP server"]
                           [nil "--smtp-password PASSWORD" "Password to authenticate with on SMTP server"]
                           [nil "--google-client-id CLIENT_ID" "Client ID to use for Google authentication"]
                           [nil "--google-client-secret CLIENT_SECRET" "Client secret to use for Google authentication"]
                           [nil "--google-api-key KEY" "API key to use for Google integration"]
                           [nil "--google-refresh-token TOKEN" "Refresh token to use for delegated Google access (eg App Files)"]
                           [nil "--facebook-app-id APP_ID" "App ID to use for Facebook authentication"]
                           [nil "--facebook-app-secret APP_SECRET" "App secret to use for Facebook authentication"]
                           [nil "--microsoft-app-id APP_ID" "App ID to use for Microsoft authentication"]
                           [nil "--microsoft-app-secret APP_SECRET" "App secret to use for Microsoft authentication"]
                           [nil "--microsoft-tenant-id TENANT_ID" "Tenant ID to use for Microsoft authentication"]])

(defn error-out! [{:keys [summary] :as parsed-opts} error-msg]
  (println error-msg)
  (println "Available options:")
  (println summary)
  (System/exit 1))

(defn coerce-number [n]
  (cond (number? n) n
        (string? n) (Integer/parseInt n)))


(defn handle-basic-config [{:keys [options config errors arguments summary] :as parsed-opts}]
  (logging/setup-logging!)

  (let [options (if-let [config (:config-file options)]
                  (merge (util/parse-yaml-str (slurp config)) options)
                  options)

        _ (when (or errors (seq arguments))
            (doseq [e errors] (println e))
            (when errors (println (count errors) "error(s)"))
            (when (seq arguments)
              (println "Unknown argument(s):" (apply str (interpose " " arguments))))
            (println "Available options:")
            (println summary)
            (System/exit 1))

        app-dir (-> (File. ^String (or (:app options) "."))
                    (.getAbsoluteFile) (.toPath) (.normalize) (.toFile))

        _ (when-not (.exists (File. app-dir "anvil.yaml"))
            (error-out! parsed-opts
                        (str (if (= "." (or (:app options) "."))
                               "The current directory"
                               (format "'%s'" (:app options)))
                             " does not contain an Anvil app.\nSpecify the app to serve with the --app option.")))

        options-or-default (fn [config defaults]
                             (into config (for [[k v] defaults]
                                            [k (or (get options k) v)])))


        number-options-or-default (fn [config defaults]
                                    (into config (for [[k v] defaults]
                                                   [k (or (coerce-number (get options k)) v)])))

        config (-> (or config {})
                   (options-or-default {:data-dir                ".anvil-data"
                                        :uplink-key              (when (:shell options) (random/base64 32))
                                        :client-uplink-key       nil
                                        :downlink-key            (random/base32 32)
                                        :downlink-worker-timeout "30"
                                        :shell                   false
                                        :ip                      "0.0.0.0"
                                        :dep-id                  nil
                                        :secret                  nil
                                        :encryption-key          nil

                                        :google-client-id        nil
                                        :google-client-secret    nil
                                        :google-api-key          nil
                                        :google-refresh-token    nil

                                        :facebook-app-id         nil
                                        :facebook-app-secret     nil
                                        :microsoft-app-id        nil
                                        :microsoft-app-secret    nil
                                        :microsoft-tenant-id     nil})

                   (number-options-or-default {:port                    nil
                                               :smtp-server-port        25
                                               :data-table-txn-timeout  nil
                                               :db-connection-pool-size nil
                                               :http-redirect-port nil})
                   (assoc
                     :app-dir app-dir
                     :app-path (.getPath (.getParentFile app-dir))
                     :origin (or (when (:origin options)
                                   (.replaceAll (str (:origin options)) "/$" ""))
                                 (format "http://localhost:%s" (or (:port options) 3030)))
                     :managed-downlink? (not (:downlink-key options))
                     :https-origin? (.startsWith (str (:origin options)) "https://")))

        config (-> config
                   (options-or-default {:letsencrypt-storage (str (:data-dir config) "/letsencrypt-certs.json")})
                   (assoc :app-smtp-config (when (:smtp-host options)
                                             {:default (merge {:host       (:smtp-host options)
                                                               :port       (or (coerce-number (:smtp-port options))
                                                                               (if (:smtp-encryption options) 587 25))
                                                               :encryption (:smtp-encryption options)}
                                                              (when-let [pass (:smtp-password options)]
                                                                {:user (or (:smtp-username options) "apikey")
                                                                 :pass pass}))})
                          :origin-uri (URI. (:origin config))))

        data-dir-file (File. ^String (:data-dir config))]

    (when-not (.isDirectory data-dir-file)
      (cond
        ;; If it was specified directly, don't try to create it
        (:data-dir options)
        (error-out! parsed-opts (format "data-dir '%s' is not a directory" (:data-dir config)))

        (.exists data-dir-file)
        (error-out! parsed-opts (format "data-dir '%s' already exists but is not a directory" (:data-dir config)))

        :else
        (.mkdir data-dir-file)))

    (assoc parsed-opts :options options :config config)))

(defn with-reverse-proxy-if-configured [{:keys [options config] :as parsed-opts}]
  (let [origin-uri (URI. (:origin config))

        use-reverse-proxy? (and (not (:disable-tls options))
                                (:https-origin? config))

        manual-tls? (and use-reverse-proxy?
                         (:manual-cert-file options)
                         (:manual-cert-key-file options))

        letsencrypt? (and use-reverse-proxy?
                          (not manual-tls?))

        http-port (if use-reverse-proxy?
                    (get-available-port)
                    (or (:port config)
                        (get-port (:origin config))
                        80))

        https-port (when use-reverse-proxy?
                     (let [origin-port (.getPort origin-uri)
                           origin-port (when (not= -1 origin-port) origin-port)]
                       (cond manual-tls?
                             (or (:port options) origin-port)

                             (and letsencrypt? (or (nil? origin-port)
                                                   (= 443 origin-port)))
                             (or (:port options) origin-port 443)

                             letsencrypt?
                             (error-out! parsed-opts "App origin must use port 443 when using automatic certificate generation"))))

        config (assoc config :http-port http-port :use-reverse-proxy? use-reverse-proxy?)

        traefik-dashboard-port (when use-reverse-proxy? (get-available-port))]

    (when use-reverse-proxy?
      (println (str "Launching HTTPS Server on port " https-port))
      (println (str "Traefik dashboard: http://localhost:" traefik-dashboard-port "/dashboard/"))

      (let [traefik-exited (traefik/run-traefik (merge
                                                  ;; Common config
                                                  {:traefik-dir       (str (.getAbsolutePath (File. ^String (:data-dir config))) "/traefik")
                                                   :forward-to        (str "http://localhost:" http-port)
                                                   :listen-ip         (:ip config)
                                                   :http-listen-port  (:http-redirect-port config)
                                                   :https-listen-port https-port
                                                   :forward-headers-insecure  (:forward-headers-insecure options)

                                                   :dashboard-port    traefik-dashboard-port}

                                                  ;; If we're doing LetsEncrypt
                                                  (when letsencrypt?
                                                    {:letsencrypt-domain   (.getHost origin-uri)
                                                     :letsencrypt-staging? (:letsencrypt-staging options)
                                                     :letsencrypt-storage  (:letsencrypt-storage config)})

                                                  ;; If we're providing our own certificates
                                                  (when manual-tls?
                                                    {:manual-cert-file     (:manual-cert-file options)
                                                     :manual-cert-key-file (:manual-cert-key-file options)})))]

        #_(println traefik-exited)
        (worker-pool/spawn-thread! "reverse-proxy-waiter"
          (let [exit-code @traefik-exited]
            (println "Reverse proxy exited with code" exit-code)
            (System/exit exit-code)))))

    (assoc parsed-opts :config config)))

(defn with-bundled-postgres-if-configured
  ([parsed-opts] (with-bundled-postgres-if-configured parsed-opts (fn [pg-config parsed-opts] pg-config)))
  ([{:keys [config options] :as parsed-opts} init-config]
   ;; Use *after* (with-reverse-proxy-if-configured), because we use the :http-port for exclusivity
   (assoc-in parsed-opts [:config :db-info]
             (if-let [conn-str (:database options)]
               {:managed? false :connection-string conn-str}
               (postgres/launch-bundled-db! (File. ^String (:data-dir config))
                                            (:http-port config)
                                            #(init-config % parsed-opts))))))

(defn handle! [{:keys [async-channel] :as request} handler]
  (let [{:keys [body] :as result} (handler request)]
    (when-not (satisfies? Channel body)
      (send! async-channel result)))
  {:body (:async-channel request)})

(defn launch-runtime-server! [{:keys [config options] :as parsed-opts}]
  (try+
    (conf/set-config! config)
    (catch ::conf/config-error err
      (error-out! parsed-opts (format "Incomplete configuration:\n%s" (::conf/config-error err)))))

  ; Now that we've configured the data directory, we can initialise logging errors to file.
  (logging/setup-file-logging!)

  ;; Do we need to set up or migrate the DB?
  (try+
    (migrator-core/migrate! runtime-conf/db [:base :data-tables :runtime] nil)
    (catch ::migrator-core/migration-failure e
      (println "Database migration failed:" (name (::migrator-core/migration-failure e)))
      (System/exit 1)))

  (let [app (core/load-main-app (:auto-migrate options) (:ignore-invalid-schema options))

        {:keys [origin-uri https-origin?]} config

        ring-config (-> site-defaults
                        (assoc-in [:security :anti-forgery] false)
                        (assoc-in [:session :cookie-attrs :secure] https-origin?)
                        (assoc-in [:security :hsts] (and https-origin? (get options :add-hsts-headers false)))
                        (assoc-in [:security :frame-options] (if (get-in app [:content :allow_embedding])
                                                               false ;; Don't set the X-Frame-Options header - allow embedding
                                                               :deny))
                        (assoc-in [:responses :absolute-redirects] false))

        handler #(handle! % (wrap-defaults
                              (absolute-redirects/wrap-absolute-redirects
                                (ring-json/wrap-json-response
                                  (core/wrap-provide-source
                                    (core/wrap-with-origin-scheme-and-port
                                      #'core/http-routes
                                      (.getScheme origin-uri)
                                      (or (get-port (:origin config)) (if https-origin? 443 80))))))
                              ring-config))]
    (anvil-server/run-server (:ip config) (:http-port config)
                             (core/wrap-retrieve-original-remote-address ;; We'll deal with X-Forwarded-For headers ourselves.
                               (if (or (:use-reverse-proxy? config)
                                       (:disable-tls options) (:forward-headers-insecure options))
                                 ;; Only trust X-Forwarded-For headers if behind a proxy
                                 (util/wrap-correct-forwarded-remote-addr handler)
                                 handler))))

  (email-server/setup-failsafe-timer!)
  (try
    (doto
      (SMTPServer. email-server/smtp-listener-factory)
      (.setPort (:smtp-server-port config))
      (.start))
    (log/info "SMTP Server running on port" (:smtp-server-port config))
    (catch Exception e
      (log/error "Failed to start mail server on port" (:smtp-server-port config)
                 "- this application will not be able to receive email: " (str (.getMessage e)))))

  (clj-logging-config.log4j/set-logger! "org.subethamail.smtp" :level :off)

  (tables-util/start-transaction-tidy-timer)

  (future
    (while true
      (try
        (runtime-sessions/cleanup-sessions!)
        (catch Exception e
          (util/report-uncaught-exception "runtime-util/cleanup-sessions!" e)))
      (Thread/sleep (* 5 60 1000))))

  (future
    (Thread/sleep 5000)
    (while true
      (if (dispatch/downlink-connected?)
        (try
          (while (cron/launch-cron-jobs!))
          (catch Exception e
            (util/report-uncaught-exception "launching scheduled tasks" e)))
        (log/info "No downlink connected; postponing check for scheduled tasks"))
      (Thread/sleep 60000)))
  parsed-opts)

(defn launch-bundled-downlink-if-configured! [{:keys [config] :as parsed-opts}]
  (when (:managed-downlink? config)
    (dispatch/launch-downlink! (:downlink-key config) "localhost" (:http-port config) (:downlink-worker-timeout config))))

(defn -main [& args]
  (let [parsed-opts (-> (cli/parse-opts args COMMAND-LINE-OPTIONS)
                        (handle-basic-config)
                        (with-reverse-proxy-if-configured))
        {:keys [config] :as parsed-opts} (with-bundled-postgres-if-configured parsed-opts)]

    (launch-runtime-server! parsed-opts)

    (launch-bundled-downlink-if-configured! parsed-opts)

    (log/info "App URL: " (:origin config))

    (when (:shell config)
      (Thread/sleep 1000)
      (launch-shell! (:uplink-key config) "localhost" (:http-port config)))

    nil))
