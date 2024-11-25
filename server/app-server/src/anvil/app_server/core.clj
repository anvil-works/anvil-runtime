(ns anvil.app-server.core
  (:require [anvil.executors.downlink :as downlink]
            [anvil.executors.uplink :as uplink]
            [anvil.runtime.conf :as runtime-conf]
            [clojure.java.io :as io]
            [clojure.java.jdbc :as jdbc]
            [clojure.tools.logging :as log]
            [anvil.runtime.read-app-storage :as read-app-storage]
            [anvil.app-server.conf :as conf]
            [slingshot.slingshot :refer [try+ throw+]]
            [compojure.core :refer [defroutes routes GET POST ANY context]]
            [anvil.util :as util]
            [anvil.app-server.dispatch :as dispatch]
            [anvil.runtime.cron :as cron]
            [anvil.app-server.tables :as tables]
            [ring.util.response :as resp]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.app-log :as app-log]
            [anvil.dispatcher.background-tasks :as background-tasks]
            [anvil.dispatcher.native-rpc-handlers.email :as email]
            [anvil.dispatcher.native-rpc-handlers.google.util :as google-util]
            [compojure.route :as route]
            [anvil.runtime.server :as runtime]
            [anvil.runtime.sessions :as runtime-sessions]
            [anvil.runtime.serve-app :as serve-app]
            [anvil.core.ring.util :as ring-util])
  (:import (java.io File)))


;; Balance performance with live-editing (we'll want to tweak this):
;; Cache apps, reloading every 10s or when idle for >500ms
(def app-cache (atom {}))
;; Change this revision every time we load an app and discover it's changed.
;; This will invalidate persistent downlinks.
(def next-app-revision (atom 0))

(defn- load-app [package-name]
  (let [now (delay (System/currentTimeMillis))]
    (if (re-matches #"[a-zA-Z0-9_]+" package-name)
      (let [{:keys [app loaded last-touched] :as cache} (get @app-cache package-name)]
        (if (and app (> last-touched (- @now 500)) (> loaded (- @now 10000)))
          (do
            (swap! app-cache assoc-in [package-name :last-touched] @now)
            app)

          (let [f (File. ^String (conf/get-app-path) ^String package-name)]
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

                    prev-app (get-in @app-cache [package-name :app])

                    app {:id      package-name
                         :content yaml
                         :info    {:id      package-name
                                   :dep_ids (conf/get-dep-ids)
                                   :name    (or (:name yaml) package-name)
                                   :alias   "UNUSED"}}
                    app (if (= app (dissoc prev-app :version))
                          prev-app
                          (let [v (swap! next-app-revision inc)]
                            (log/trace "Invalidating; new version" v)
                            (assoc app :version v)))]
                (swap! app-cache assoc package-name {:app app, :loaded @now :last-touched @now})

                app)))))
      (log/error (str "Cannot load app '" package-name "' - this is not a valid Python package name. Valid names may include only letters, numbers and underscores (_).")))))

(defn update-cron-jobs! [app-yaml]
  (util/with-db-transaction [db util/db]
    (let [q (jdbc/query db ["SELECT job_id, next_run, time_spec, task_name, last_bg_task_id FROM scheduled_tasks"])
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
    (tables/validate-app-tables-schema (-> app :content :db_schema) (-> app :content :table_id_hints) main-app-id auto-migrate-tables? ignore-invalid-schema?)
    (tables/update-indexes-and-views!)
    app))

(defn wrap-cors [f origin]
  (fn [x]
    (when-let [r (f x)]
      (resp/header r "Access-Control-Allow-Origin" (or origin "*")))))

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
   :get-app-origin                        (fn [_env] (conf/get-app-origin))
   :get-default-hostnames                 (fn [_env] [(conf/get-hostname)])
   :get-valid-origins                     (fn [_env] [(conf/get-app-origin)])})


(app-log/set-log-impl! {:record-session! (fn record-session! [session log-data]
                                           (log/info "[SESSION]" (-> @session :client :type) (runtime-sessions/get-id session) log-data))
                        :record-event!   (fn [_session _trace-id type log-text data]
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
                                             (log/info (if (= "client_print" type)
                                                          "[CLIENT]" "[SERVER]") (.replaceAll ^String log-text "\n$" ""))

                                             ;; :else
                                             (if data (log/info (str "[LOG " type "]") log-text data)
                                                      (log/info (str "[LOG " type "]") log-text))))})

(background-tasks/set-background-task-hooks! {:get-environment-for-background-task (constantly {})})

(email/set-email-hooks! {:get-smtp-connection (fn [_email-service-config _environment]
                                                (let [{:keys [host] :as smtp-config} (:default runtime-conf/app-smtp-config)]

                                                  (when-not host
                                                    (throw+ {:anvil/server-error "No SMTP server has been configured"}))

                                                  (email/open-smtp-connection smtp-config)))})

(google-util/set-google-token-hooks! {:get-delegation-refresh-token (fn [_app-info service-config]
                                                                      (or (conf/get-google-refresh-token)
                                                                          (:delegation_refresh_token service-config)))})

;; AGPL compliance: Serve up our source code (or, if we are an official release package, a GitHub link)
(def i-have-a-non-agpl-licence-to-this-software (atom false))
(def source-link (delay
                   (if (io/resource "anvil-runtime-source.tgz")
                     (str (conf/get-app-origin) "/_/static/anvil-runtime-source.tgz")
                     "https://github.com/anvil-works/anvil-runtime")))

(defn wrap-provide-source [f]
  (fn [request]
    (cond-> (f request)
            (not @i-have-a-non-agpl-licence-to-this-software)
            (assoc-in [:headers "X-Source-Available"] @source-link))))

(defroutes http-routes
  (wrap-cors
    (routes
      (route/resources "/_/static/runtime" {:root "runtime-client-core" :mime-types util/additional-mime-types})
      (route/resources "/_/static/services" {:root "services-core" :mime-types util/additional-mime-types})
      (GET "/_/static/icon-512x512.png" []
           (resp/resource-response "runtime-client-core/icon-512x512.png"))
      (GET "/_/static/anvil-runtime-source.tgz" []
           ;; AGPL compliance: Provide source download
           (resp/resource-response "anvil-runtime-source.tgz"))
      (context "/_/downlink" [] downlink/handle-incoming-ws)
      (context "/_/uplink" [] uplink/handle-incoming-ws))
    "*")
  #'runtime/runtime-common-routes

  (wrap-constant-app
    (ring-util/wrap-async
      (routes
        runtime/app-routes
        #(serve-app/serve-request-to-app-url % {:consoleMessage (when-not @i-have-a-non-agpl-licence-to-this-software
                                                                  (format "***********\nThis application is served with the Anvil App Server, which is open-source software.\nYou can find the source code at:\n%s\n**********"
                                                                          @source-link))} identity))
      [(runtime-sessions/with-app-session (constantly "anvil-session"))]))
  runtime/app-404)

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
