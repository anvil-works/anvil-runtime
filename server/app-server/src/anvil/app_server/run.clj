(ns anvil.app-server.run
  (:use [org.httpkit.server :only [run-server]]
        [compojure.handler :only [site]]
        [slingshot.slingshot]
        [ring.middleware.session.memory :only [memory-store]]
        [clojure.pprint])
  (:require [anvil.app-server.conf :as conf]
            [anvil.app-server.tables :as tables]
            [anvil.app-server.dispatch :as dispatch]
            [anvil.app-server.postgres :as postgres]
            [anvil.util :refer :all]
            [anvil.logging]
            [compojure.core :refer :all]
            [compojure.route :as route]
            [anvil.runtime.email-server :as email-server]
            [anvil.runtime.cron :as cron]
            [clojure.tools.logging :as log]
            [anvil.runtime.tables.util :as tables-util]
            [anvil.util :as util]
            [ring.util.response :as resp]
            [anvil.core.server :as anvil-server]
            [anvil.runtime.server :as runtime]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.read-app-storage :as read-app-storage]
            [anvil.executors.downlink :as downlink]
            [anvil.executors.uplink :as uplink]
            [anvil.app-server.secrets]
            [clojure.tools.cli :as cli]
            [clojure.java.io :as io]
            [clj-yaml.core :as yaml]
            [migrator.core :as migrator-core]
            [anvil.runtime.conf :as runtime-conf]
            (anvil.dispatcher.native-rpc-handlers core bcrypt cookies email facebook http microsoft stripe time util)
            [crypto.random :as random]
            [anvil.runtime.util :as runtime-util]
            [anvil.logging :as logging]
            [embedded-traefik.core :as traefik]
            [ring.middleware.json :as ring-json]
            [anvil.runtime.app-log :as app-log]
            [clojure.java.jdbc :as jdbc]
            [anvil.dispatcher.background-tasks :as background-tasks]
            [cheshire.core :as json])
  (:gen-class)
  (:import (org.subethamail.smtp.server SMTPServer)
           (java.io File)
           (java.lang ProcessBuilder)
           (java.net ServerSocket URI)))

(clj-logging-config.log4j/set-logger! :level :trace)

;; Balance performance with live-editing (we'll want to tweak this):
;; Cache apps, reloading every 10s or when idle for >500ms
(def app-cache (atom {}))
;; Change this revision every time we load an app and discover it's changed.
;; This will invalidate persistent downlinks.
(def next-app-revision (atom 0))

(defn- load-app [app-id]
  (let [now (delay (System/currentTimeMillis))]
    (if (re-matches #"[a-zA-Z0-9_]+" app-id)
      (let [app-id ^String (conf/get-app-package app-id)
            {:keys [app loaded last-touched] :as cache} (get @app-cache app-id)]
        (if (and app (> last-touched (- @now 500)) (> loaded (- @now 10000)))
          (do
            (swap! app-cache assoc-in [app-id :last-touched] @now)
            app)

          (let [f (File. ^String (conf/get-app-path) app-id)]
            (when (.isDirectory f)
              (let [yaml (read-app-storage/get-app-yaml-from-resource-directory (.toURL f) true false)

                    ;; Cope with older apps that specify the user table by ID
                    yaml (update-in yaml [:services]
                                    (fn [services]
                                      (for [{:keys [source server_config] :as service} services]
                                        (if-let [table-name (and (= source "/runtime/services/anvil/users.yml")
                                                                 (number? (:user_table server_config))
                                                                 (some #(when (= (:id %) (:user_table server_config))
                                                                          (get-in % [:access :python_name]))
                                                                       (:db_schema yaml)))]
                                          (assoc-in service [:server_config :user_table] table-name)
                                          service))))

                    prev-app (get-in @app-cache [app-id :app])

                    app {:id      app-id
                         :content yaml
                         :info    {:id    app-id
                                   :name  (or (:name yaml) app-id)
                                   :alias "UNUSED"}}
                    app (if (= app (dissoc prev-app :version))
                          prev-app
                          (let [v (swap! next-app-revision inc)]
                            (log/trace "Invalidating; new version" v)
                            (assoc app :version v)))]
                (swap! app-cache assoc app-id {:app app, :loaded @now :last-touched @now})

                app)))))
      (log/error (str "Cannot load app '" app-id "' - this is not a valid Python package name. Valid names may include only letters, numbers and underscores (_).")))))

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

(defn update-cron-jobs! [app-yaml]
  (util/with-db-transaction [db util/db]
    (let [q (jdbc/query db ["SELECT job_id, next_run, time_spec FROM scheduled_tasks"])
          scheduled-jobs (cron/get-scheduled-jobs (:scheduled_tasks app-yaml) q nil)]

      (jdbc/execute! db ["DELETE FROM scheduled_tasks"])

      (doseq [spec scheduled-jobs]
        (jdbc/insert! db "scheduled_tasks" spec)))))


(defn get-environment-for-job [_job]
  (dispatch/get-default-environment))

(cron/set-cron-hooks! (util/hooks #{get-environment-for-job}))


(defn load-main-app [auto-migrate-tables? ignore-invalid-schema?]
  (let [main-app-id (conf/get-main-app-id)
        app (try
              (load-app main-app-id)
              (catch Exception e
                (log/error e "Failed to load app %s: %s" main-app-id)
                (System/exit 1)))]
    (update-cron-jobs! (:content app))
    (tables/validate-app-tables-schema (-> app :content :db_schema) main-app-id auto-migrate-tables? ignore-invalid-schema?)))

(defn wrap-cors [f origin]
  (fn [x]
    (when-let [r (f x)]
      (resp/header  r "Access-Control-Allow-Origin" (or origin "*")))))

;; Don't give runtime a choice of app
(defn wrap-constant-app [handler]
  (fn [{:keys [uri server-name origin-scheme origin-port] :as req}]
    (let [app-origin (str origin-scheme "://" server-name ":" origin-port)]
      (handler (assoc req :app-id (conf/get-main-app-id)
                          :app-info (:info (load-app (conf/get-main-app-id)))
                          :app-origin app-origin
                          :path-info uri
                          :environment (dispatch/get-default-environment))))))

(app-data/set-app-storage-impl!
  {:get-app-info-insecure                 (fn [app-id] (:info (load-app (or app-id (conf/get-main-app-id)))))
   :get-app-content                       (fn [app-info _version] (load-app (:id app-info)))
   :get-app-environment-by-email-hostname (fn [_] (dispatch/get-default-environment))
   :get-default-app-origin                (fn [_env] (conf/get-app-origin))
   :get-default-hostnames                 (fn [_env] [(conf/get-hostname)])
   :get-valid-origins                     (fn [_env] [(conf/get-app-origin)])})


(app-log/set-log-impl! {:record! (fn record! [_request-ctx type data & [_trust-sess?]]
                                   (condp contains? type
                                     #{"client_err" "err"}
                                     (log/error (apply str
                                                       "Error report from "
                                                       (if (= "client_err" type) "client" "server") " code:\n"
                                                       (:type data) ": " (:message data)
                                                       (when (:trace data) "\nTraceback:")
                                                       (for [[path line] (:trace data)]
                                                         (str "\n  " path ":" line "\n"))))

                                     #{"print" "client_print"}
                                     (doseq [msg (map :s data) :when (not (re-matches #"(?s)\s*" msg))]
                                       (log/debug (if (= "client_print" type)
                                                    "[CLIENT]" "[SERVER]") (.replaceAll ^String msg "\n$" "")))

                                     ;; :else
                                     (log/info (str "[LOG " type "]") data)))})

(background-tasks/set-background-task-hooks! {:get-environment-for-background-task (constantly {})})


;; AGPL compliance: Serve up our source code (or, if we are an official release package, a GitHub link)
(def source-link (delay
                   (if (io/resource "anvil-runtime-source.tgz")
                     (str (conf/get-app-origin) "/_/static/anvil-runtime-source.tgz")
                     "https://github.com/anvil-works/anvil-runtime")))

(defn wrap-provide-source [f]
  (fn [request]
    (assoc-in (f request) [:headers "X-Source-Available"] @source-link)))

(defroutes app
  (wrap-cors
    (routes
      (route/resources "/_/static/runtime" {:root "runtime-client-core" :mime-types util/additional-mime-types})
      (route/resources "/_/static/services" {:root "runtime-client-core" :mime-types util/additional-mime-types})
      (GET "/_/static/anvil-runtime-source.tgz" []
        ;; AGPL compliance: Provide source download
        (resp/resource-response "anvil-runtime-source.tgz"))
      (context "/_/downlink" [] downlink/handle-incoming-ws)
      (context "/_/uplink" [] uplink/handle-incoming-ws))
    "*")
  runtime/runtime-common-routes
  (wrap-constant-app
    (runtime-util/with-app-session
      (routes
        (GET "/" request
          (runtime/serve-app request
                             {:consoleMessage (format "***********\nThis application is served with the Anvil App Server, which is open-source software.\nYou can find the source code at:\n%s\n**********"
                                                      @source-link)}
                             {:action :run-app}))
        runtime/app-routes)))
  runtime/app-404)



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

;; This is seriously gross. The http-kit server just trusts X-Forwarded-For headers,
;; and doesn't provide any way to turn that off. This is fine when running behind an
;; HTTPS proxy, but this app server might well be run unencrypted on localhost or a
;; LAN, where we might want to be able to trust anvil.server.client.ip. So, we use the
;; only way that http-kit actually exposes the remote address - AsyncChannel.toString()
;; - and use that to overwrite :remote-addr.
;;
;; I warned you it would be gross.
;;
(defn wrap-retrieve-original-remote-address [f]
  (fn [request]
    (let [[_ real-remote-address] (re-matches #".*<->.*/(.*):\d+$" (str (:async-channel request)))]
      (f (assoc request :remote-addr real-remote-address)))))

(defn wrap-with-origin-scheme-and-port [f scheme port]
  (fn [req]
    (f (assoc req :origin-scheme scheme :origin-port port))))

(Thread/setDefaultUncaughtExceptionHandler
  (reify Thread$UncaughtExceptionHandler
    (uncaughtException [_ thread ex]
      (log/error ex))))

(defn -main [& args]
  (let [require-equals [#(re-matches #"(.*?)=(.*)" %) "Expected NAME=VALUE"]
        update-map-with-equals #(let [[_ k v] (re-matches #"(.*?)=(.*)" %3)]
                                  (update-in %1 [%2] assoc (keyword k) v))
        {:keys [options errors arguments summary]}
        (cli/parse-opts args [[nil "--config-file FILENAME" "Load config from the specified YAML file"]
                              [nil "--data-dir DIRECTORY" "Store data in the specified directory (default: .anvil-data)"]
                              [nil "--auto-migrate" "Migrate data tables schema automatically"]
                              [nil "--ignore-invalid-schema" "Ignore invalid data tables schema and run anyway"]
                              [nil "--database DB-URL" "Database URL"]
                              [nil "--app DIRECTORY" "Load and run the specified app"]
                              [nil "--dep-id ID=PACKAGE" "Associate a dependency app ID with its package name"
                               :validate require-equals :assoc-fn update-map-with-equals]
                              [nil "--secret NAME=VALUE" "Provide an app secret"
                               :validate require-equals :assoc-fn update-map-with-equals]
                              [nil "--encryption-key NAME=VALUE" "Pass an app encryption key"
                               :validate require-equals :assoc-fn update-map-with-equals]
                              [nil "--downlink-key KEY" "Authentication key for a separately launched downlink"]
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
                              [nil "--letsencrypt-storage PATH" "Path to a JSON file to store LetsEncrypt certificates (default: <data-dir>/letsencrypt-certs.json)"]
                              [nil "--letsencrypt-staging" "Use the LetsEncrypt staging server"]
                              [nil "--manual-cert-file PATH" "Path to an external TLS certificate in PEM format"]
                              [nil "--manual-cert-key-file PATH" "Path to an external TLS certficate private key file in PEM format"]
                              [nil "--smtp-host HOST" "Hostname of SMTP server to use for sending email"]
                              [nil "--smtp-port PORT" "Port to connect to on SMTP server"
                               :validate [#(re-matches #"[0-9]+" %) "Expected a port number"]]
                              [nil "--smtp-encryption" "Use TLS to connect to SMTP server"
                               :validate [#(contains? #{"ssl" "starttls"} %) "Expected 'ssl' or 'starttls'"]]
                              [nil "--smtp-username USER" "Username to authenticate with on SMTP server"]
                              [nil "--smtp-password PASSWORD" "Password to authenticate with on SMTP server"]
                              [nil "--google-client-id CLIENT_ID" "Client ID to use for Google authentication"]
                              [nil "--google-client-secret CLIENT_SECRET" "Client secret to use for Google authentication"]
                              [nil "--google-api-key KEY" "API key to use for Google integration"]
                              [nil "--facebook-app-id APP_ID" "App ID to use for Facebook authentication"]
                              [nil "--facebook-app-secret APP_SECRET" "App secret to use for Facebook authentication"]
                              [nil "--microsoft-app-id APP_ID" "App ID to use for Microsoft authentication"]
                              [nil "--microsoft-app-secret APP_SECRET" "App secret to use for Microsoft authentication"]
                              [nil "--microsoft-tenant-id TENANT_ID" "Tenant ID to use for Microsoft authentication"]])

        options (if-let [config (:config-file options)]
                  (merge (yaml/parse-string (slurp config)) options)
                  options)

        error-out! (fn [error-msg]
                     (println error-msg)
                     (println "Available options:")
                     (println summary)
                     (System/exit 1))

        _ (when (or errors (seq arguments))
            (doseq [e errors] (println e))
            (when errors (println (count errors) "error(s)"))
            (when (seq arguments)
              (println "Unknown argument(s):" (apply str (interpose " " arguments))))
            (println "Available options:")
            (println summary)
            (System/exit 1))

        specified-data-dir? (:data-dir options)
        options (update-in options [:data-dir] #(or % ".anvil-data"))

        options (update-in options [:app] #(or % "."))

        options (update-in options [:uplink-key] #(or % (when (:shell options) (random/base64 32))))

        app-dir (-> (File. ^String (:app options))
                    (.getAbsoluteFile) (.toPath) (.normalize) (.toFile))

        _ (when-not (.exists (File. app-dir "anvil.yaml"))
            (error-out! (str (if (= "." (:app options))
                               "The current directory"
                               (format "'%s'" (:app options)))
                             " does not contain an Anvil app.\nSpecify the app to serve with the --app option.")))

        options (assoc options :app (.getName app-dir)
                               :app-path (.getPath (.getParentFile app-dir)))

        specified-downlink-key? (:downlink-key options)
        options (update-in options [:downlink-key] #(or % (random/base32 32)))

        options (update-in options [:ip] #(or % "0.0.0.0"))

        coerce-number #(cond (number? %) %
                             (string? %) (Integer/parseInt %))

        options (update-in options [:port] coerce-number)

        options (update-in options [:smtp-port] coerce-number)

        options (update-in options [:smtp-server-port] #(or (coerce-number %) 25))

        options (update-in options [:origin] #(or (when %
                                                    (.replaceAll (str %) "/$" ""))
                                                  (format "http://localhost:%d" (or (:port options) 3030))))


        options (update-in options [:letsencrypt-storage] #(or % (str (:data-dir options) "/letsencrypt-certs.json")))

        options (assoc options :app-smtp-config (when (:smtp-host options)
                                                  (merge {:host       (:smtp-host options)
                                                          :port       (or (:smtp-port options) (if (:smtp-encryption options) 587 25))
                                                          :encryption (:smtp-encryption options)}
                                                         (when-let [pass (:smtp-password options)]
                                                           {:user (or (:smtp-username options) "apikey")
                                                            :pass pass}))))

        origin-uri (URI. (:origin options))

        use-reverse-proxy? (and (not (:disable-tls options))
                                (= (.getScheme origin-uri) "https"))

        manual-tls? (and use-reverse-proxy?
                         (:manual-cert-file options)
                         (:manual-cert-key-file options))

        letsencrypt? (and use-reverse-proxy?
                          (not manual-tls?))

        http-port (if use-reverse-proxy?
                    (get-available-port)
                    (or (:port options)
                        (get-port (:origin options))
                        80))

        https-port (when use-reverse-proxy?
                     (let [origin-port (get-port (:origin options))]
                       (cond manual-tls?
                             (or (:port options) origin-port)

                             (and letsencrypt? (or (nil? origin-port)
                                                   (= 443 origin-port)))
                             (or (:port options) origin-port 443)

                             letsencrypt?
                             (throw (Exception. "App origin must use port 443 when using automatic certificate generation")))))

        options (update-in options [:database] #(or % (postgres/launch-bundled-db! (File. ^String (:data-dir options)) http-port)))

        traefik-dashboard-port (when use-reverse-proxy? (get-available-port))]


    (when-not specified-data-dir?
      (let [f (File. ".anvil-data")]
        (when-not (.exists f)
          (.mkdir f))))

    (try+
      (conf/set-config! options)
      (catch ::conf/config-error err
        (println (format "Incomplete configuration:\n%s" (::conf/config-error err)))
        (println "Available options:")
        (println summary)
        (System/exit 1)))

    (logging/setup-logging!)

    (when use-reverse-proxy?
      (println (str "Launching HTTPS Server on port " https-port))
      (println (str "Traefik dashboard: http://localhost:" traefik-dashboard-port "/dashboard/"))

      (let [traefik-exited (traefik/run-traefik (merge
                                                  ;; Common config
                                                  {:traefik-dir       (str (.getAbsolutePath (File. ^String (:data-dir options))) "/traefik")
                                                   :forward-to        (str "http://localhost:" http-port)
                                                   :listen-ip         (:ip options)
                                                   :http-listen-port  (:http-redirect-port options)
                                                   :https-listen-port https-port

                                                   :dashboard-port    traefik-dashboard-port}

                                                  ;; If we're doing LetsEncrypt
                                                  (when letsencrypt?
                                                    {:letsencrypt-domain   (.getHost origin-uri)
                                                     :letsencrypt-staging? (:letsencrypt-staging options)
                                                     :letsencrypt-storage  (:letsencrypt-storage options)})

                                                  ;; If we're providing our own certificates
                                                  (when manual-tls?
                                                    {:manual-cert-file     (:manual-cert-file options)
                                                     :manual-cert-key-file (:manual-cert-key-file options)})))]

        #_(println traefik-exited)
        (future (let [exit-code @traefik-exited]
                  (println "Reverse proxy exited with code" exit-code)
                  (System/exit exit-code)))))

    ;; Do we need to set up or migrate the DB?
    (try+
      (migrator-core/migrate! runtime-conf/db [:base :runtime] nil)
      (catch ::migrator-core/migration-failure e
        (println "Database migration failed:" (name (::migrator-core/migration-failure e)))
        (System/exit 1)))

    (load-main-app (:auto-migrate options) (:ignore-invalid-schema options))

    ;; TODO: Check Same-Site cookie defaults. May need to be set to :none rather than :strict.
    (anvil-server/run-server (:ip options) http-port
                             (site
                               (ring-json/wrap-json-response
                                 (wrap-provide-source
                                   (wrap-with-origin-scheme-and-port
                                     (if (or use-reverse-proxy? (:disable-tls options))
                                       #'app
                                       (wrap-retrieve-original-remote-address #'app))
                                     (.getScheme origin-uri)
                                     (if (= (.getScheme origin-uri) "https")
                                       (or (get-port (:origin options)) 443)
                                       (or (get-port (:origin options)) 80)))))))

    (log/info "App URL: " (:origin options))

    ;; If they didn't specify a downlink key, we start our own!
    (when-not specified-downlink-key?
      (dispatch/launch-downlink! (:downlink-key options) "localhost" http-port))

    (when (:shell options)
      (Thread/sleep 1000)
      (launch-shell! (:uplink-key options) "localhost" http-port))

    (email-server/setup-failsafe-timer!)
    (try
      (doto
        (SMTPServer. email-server/smtp-listener-factory)
        (.setPort (:smtp-server-port options))
        (.start))
      (log/info "SMTP Server running on port" (:smtp-server-port options))
      (catch Exception e
        (log/error "Failed to start mail server on port" (:smtp-server-port options)
                   "- this application will not be able to receive email: " (str (.getMessage e)))))
    
    (clj-logging-config.log4j/set-logger! "org.subethamail.smtp" :level :off)



    (tables-util/start-transaction-tidy-timer)

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
    nil))
