(ns anvil.app-server.dispatch
  (:require [clojure.tools.logging :as log]
            [anvil.executors.downlink :as downlink]
            [anvil.app-server.conf :as conf]
            [anvil.util :refer [sha-256]]
            [anvil.dispatcher.native-rpc-handlers.pdf :as pdf]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.executors.uplink :as uplink]
            [anvil.runtime.app-data :as app-data]
            [anvil.executors.ws-calls :as ws-calls]
            [anvil.runtime.cron :as cron])
  (:import (java.io File)
           (java.lang ProcessBuilder$Redirect)))

(def shutting-down? (atom false))

(def shutdown-hook (Thread. ^Runnable (fn [] (reset! shutting-down? true))))

(defn launch-downlink! [downlink-key server-host server-port worker-timeout-seconds]
  (.removeShutdownHook (Runtime/getRuntime) shutdown-hook)
  (.addShutdownHook (Runtime/getRuntime) shutdown-hook)

  (doto (Thread. ^Runnable
                 (fn []
                   (while (not @shutting-down?)
                     (log/info "Launching built-in downlink...")
                     (let [pb (ProcessBuilder. #^"[Ljava.lang.String;" (into-array String [(or (System/getenv "PYTHON_INTERPRETER") "python") "-m" "anvil_downlink_host.run"]))
                           env (.environment pb)]
                       (.directory pb (when-let [dir (System/getenv "DOWNLINK_WORKDIR")]
                                        (File. dir)))
                       (.put env "DOWNLINK_SERVER" (str "ws://" server-host ":" server-port "/_/downlink"))
                       (.put env "DOWNLINK_KEY" downlink-key)
                       (.put env "ENABLE_PDF_RENDER" "1")
                       (.put env "DOWNLINK_CAN_PERSIST" "1")
                       (.put env "DOWNLINK_WORKER_TIMEOUT" (str worker-timeout-seconds))
                       (.redirectError pb ProcessBuilder$Redirect/INHERIT)
                       (.redirectOutput pb ProcessBuilder$Redirect/INHERIT)
                       (.waitFor (.start pb)))
                     (when (not shutting-down?) (log/error "Downlink process terminated; restarting in 1s..."))
                     (Thread/sleep 1000))))
    (.setDaemon true)
    (.start)))


(defonce downlink (atom nil))

(downlink/set-downlink-hooks!
  {:register-downlink!      (fn [{:keys [key] :as _registration-request} connection]
                              (let [correct-key (conf/get-downlink-key)]
                                (when (and key correct-key (= (sha-256 key) (sha-256 correct-key)))
                                  (reset! downlink connection)
                                  ;; Return the connection itself as the cookie
                                  connection)))
   :drain-downlink!         (fn [_cookie] nil)
   :unregister-downlink!    (fn [cookie]
                              (swap! downlink (fn [previous-connection]
                                                (if (= cookie previous-connection)
                                                  nil
                                                  previous-connection))))
   :dispatch-downlink-call! (fn [cookie context call-stack-info extra-request-params deserialiser-conf wire-request return-path]
                              (ws-calls/dispatch-request! context call-stack-info
                                                          (-> extra-request-params
                                                              (assoc ::downlink/same-downlink-spec {}))
                                                          deserialiser-conf wire-request return-path))
   :get-downlink-executor   (fn [same-server-routing]
                              (when-let [connection @downlink]
                                 (downlink/wrap-as-executor connection)))})

(pdf/set-pdf-impl! {:get-pdf-renderer       (fn [& _] (when-let [connection @downlink]
                                                        (downlink/wrap-as-executor connection)))
                    :get-pdf-render-timeout (constantly 30)})

(dispatcher/register-dispatch-handler! ::downlink dispatcher/DOWNLINK-PRIORITY
                                       (fn [_request]
                                         (when-let [connection @downlink]
                                           (downlink/wrap-as-executor connection))))

(defn downlink-connected? [] (boolean @downlink))

(defonce next-uplink-id (atom 0))
;; reg-id -> {:func func-pattern, :uplink-id id, :executor executor}
(defonce uplink-registrations (atom {}))
;; Contains str(func-pattern) -> func-pattern
(defonce stale-uplink-funcs (atom {}))

(defn get-default-environment []
  {:env_id      ::default
   :app_id      (conf/get-main-app-id)
   :name        "App Server"
   :description "App Server"})

(uplink/set-uplink-hooks!
  {:get-app-info-environment-and-privileges-for-uplink-key
   (fn [uplink-key]
     (cond
       (when-let [k (conf/get-uplink-key)] (= (sha-256 uplink-key) (sha-256 k)))
       [(app-data/get-app-info-insecure (conf/get-main-app-id)) (get-default-environment) :server_uplink]

       (when-let [k (conf/get-client-uplink-key)] (= (sha-256 uplink-key) (sha-256 k)))
       [(app-data/get-app-info-insecure (conf/get-main-app-id)) (get-default-environment) :client_uplink]))

   :on-uplink-connect
   (fn [connection]
     {:uplink-id (swap! next-uplink-id inc) :executor (uplink/wrap-as-executor connection)})

   :set-uplink-handler!
   (fn [{:keys [uplink-id executor]} func]
     (let [reg-id (swap! next-uplink-id inc)
           func-pattern (re-pattern func)]
       (swap! uplink-registrations assoc reg-id {:func func-pattern, :uplink-id uplink-id, :executor executor})
       [reg-id func-pattern]))

   :clear-uplink-registrations!
   (fn [_uplink-info registrations]
     (let [reg-ids (set (map first registrations))
           funcs (map second registrations)]
       (swap! stale-uplink-funcs #(reduce (fn [stale-funcs func]
                                            (assoc stale-funcs (str func) func))
                                          % funcs))
       (swap! uplink-registrations #(reduce dissoc % reg-ids))))})

(dispatcher/register-dispatch-handler! ::uplink dispatcher/UPLINK-PRIORITY
                                       (fn [{{:keys [func live-object]} :call}]
                                         (when-not live-object
                                           (if-let [matching-uplinks (->> (map second @uplink-registrations)
                                                                          (filter #(when (re-matches (:func %) func)
                                                                                     (:executor %)))
                                                                          (seq))]
                                             (:executor (rand-nth matching-uplinks))
                                             (when (some #(re-matches % func) (map second @stale-uplink-funcs))
                                               (reset! dispatcher/*stale-uplink?* true)
                                               nil)))))