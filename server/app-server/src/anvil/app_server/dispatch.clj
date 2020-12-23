(ns anvil.app-server.dispatch
  (:require [clojure.tools.logging :as log]
            [anvil.executors.downlink :as downlink]
            [anvil.app-server.conf :as conf]
            [anvil.util :refer [sha-256]]
            [anvil.dispatcher.native-rpc-handlers.pdf :as pdf]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.executors.uplink :as uplink]
            [anvil.runtime.app-data :as app-data])
  (:import (java.lang ProcessBuilder$Redirect)))

(def shutting-down? (atom false))

(def shutdown-hook (Thread. ^Runnable (fn [] (reset! shutting-down? true))))

(defn launch-downlink! [downlink-key server-host server-port]
  (.removeShutdownHook (Runtime/getRuntime) shutdown-hook)
  (.addShutdownHook (Runtime/getRuntime) shutdown-hook)

  (doto (Thread. ^Runnable
                 (fn []
                   (while (not @shutting-down?)
                     (log/info "Launching built-in downlink...")
                     (let [pb (ProcessBuilder. #^"[Ljava.lang.String;" (into-array String [(or (System/getenv "PYTHON_INTERPRETER") "python") "-m" "anvil_downlink_host.run"]))
                           env (.environment pb)]
                       (.put env "DOWNLINK_SERVER" (str "ws://" server-host ":" server-port "/_/downlink"))
                       (.put env "DOWNLINK_KEY" downlink-key)
                       (.put env "ENABLE_PDF_RENDER" "1")
                       (.redirectError pb ProcessBuilder$Redirect/INHERIT)
                       (.redirectOutput pb ProcessBuilder$Redirect/INHERIT)
                       (.waitFor (.start pb)))
                     (when (not shutting-down?) (log/error "Downlink process terminated; restarting in 1s..."))
                     (Thread/sleep 1000))))
    (.setDaemon true)
    (.start)))


(defonce downlink (atom nil))

(downlink/set-downlink-hooks!
  {:register-downlink!   (fn [{:keys [key] :as _registration-request} executor]
                           (let [correct-key (conf/get-downlink-key)]
                             (when (and key correct-key (= (sha-256 key) (sha-256 correct-key)))
                               (reset! downlink executor)
                               ;; Return the executor itself as the cookie
                               executor)))
   :drain-downlink!      (fn [_cookie] nil)
   :unregister-downlink! (fn [cookie]
                           (swap! downlink (fn [previous-executor]
                                             (if (= cookie previous-executor)
                                               nil
                                               previous-executor))))})

(pdf/set-pdf-impl! {:get-pdf-renderer       (fn [& _] @downlink)
                    :get-pdf-render-timeout (constantly 30)})

(dispatcher/register-dispatch-handler! ::downlink dispatcher/DOWNLINK-PRIORITY (fn [_req] @downlink))

(defn downlink-connected? [] (boolean @downlink))

(defonce next-uplink-id (atom 0))
;; reg-id -> {:func func-pattern, :uplink-id id, :executor executor}
(defonce uplink-registrations (atom {}))
;; Contains str(func-pattern) -> func-pattern
(defonce stale-uplink-funcs (atom {}))

(defn get-default-environment []
  {:env_id      ::default
   :app_id      (conf/get-main-app-id)
   :name        "App Server"})

(uplink/set-uplink-hooks!
  {:get-app-info-environment-and-privileges-for-uplink-key
   (fn [uplink-key]
     (cond
       (when-let [k (conf/get-uplink-key)] (= (sha-256 uplink-key) (sha-256 k)))
       [(app-data/get-app-info-insecure (conf/get-main-app-id)) nil :uplink]

       (when-let [k (conf/get-client-uplink-key)] (= (sha-256 uplink-key) (sha-256 k)))
       [(app-data/get-app-info-insecure (conf/get-main-app-id) nil :client)]))

   :on-uplink-connect
   (fn [_environment _protocol-version]
     (swap! next-uplink-id inc))

   :set-uplink-handler!
   (fn [uplink-id func handler]
     (let [reg-id (swap! next-uplink-id inc)]
       (swap! uplink-registrations assoc reg-id {:func func, :uplink-id uplink-id, :executor handler})
       [reg-id func]))

   :clear-uplink-registrations!
   (fn [_uplink-id registrations]
     (let [reg-ids (set (map first registrations))
           funcs (map second registrations)]
       (swap! stale-uplink-funcs #(reduce (fn [stale-funcs func]
                                            (assoc stale-funcs (str func) func))
                                          % funcs))
       (swap! uplink-registrations #(reduce dissoc % reg-ids))))})

(dispatcher/register-dispatch-handler! ::uplink dispatcher/UPLINK-PRIORITY
                                       (fn [{{:keys [func live-object]} :call}]
                                         (when-not live-object
                                           (or
                                             (some #(when (re-matches (:func %) func)
                                                      (:executor %))
                                                   (map second @uplink-registrations))
                                             (when (some #(re-matches % func) (map second @stale-uplink-funcs))
                                               (reset! dispatcher/*stale-uplink?* true)
                                               nil)))))