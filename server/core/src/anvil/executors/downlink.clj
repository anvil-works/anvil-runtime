(ns anvil.executors.downlink
  (:use org.httpkit.server
        [slingshot.slingshot :only [throw+ try+]])
  (:require [digest]
            [anvil.util :as util]
            [anvil.runtime.ws-util :as ws-util]
            [anvil.dispatcher.serialisation.core :as serialisation]
            [clojure.tools.logging :as log]
            [clojure.data.json :as json]
            [crypto.random :as random]
            [anvil.executors.ws-calls :as ws-calls]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.background-tasks :as background-tasks]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.executors.ws-server :as ws-server]
            [anvil.runtime.app-data :as app-data]
            [anvil.core.tracing :as tracing]))


(clj-logging-config.log4j/set-logger! :level :info)

;; Hookable functions
(defonce register-downlink! (fn [registration-request send-request!] (throw (UnsupportedOperationException.))))
(defonce drain-downlink! (fn [cookie] nil))
(defonce unregister-downlink! (fn [cookie] (throw (UnsupportedOperationException.))))
(defonce report-downlink-stats (fn [cookie stats] nil))
(defonce dispatch-downlink-call! (fn [cookie context call-stack-info extra-request-params deserialiser-conf wire-request return-path]
                                   (throw (UnsupportedOperationException.))))
;; used by PDF rendering to identify a particular downlink
(defonce get-downlink-executor (fn [spec] (throw (UnsupportedOperationException.))))

(def set-downlink-hooks! (util/hook-setter [register-downlink! drain-downlink! unregister-downlink! report-downlink-stats dispatch-downlink-call! get-downlink-executor]))

(def STACK-FRAME-INFO {:origin :server, :stack-frame-type :server_module})

(def SANITISED-KEYS [:modules :server_modules :forms :scripts :runtime_options :dependency_code :dependency_order :dependency_ids :package_name :config])
(defn- sanitise-app-for-downlink [app]
  (let [sanitise #(select-keys % SANITISED-KEYS)]
    (-> app
        (sanitise)
        (update :dependency_code update-vals sanitise))))


(def WS-SERVER-PARAMS {:link-name "Downlink",
                       :bg-impl-id :downlink,
                       :disconnection-error "anvil.server.RuntimeUnavailableError"})

(defn launch-bg-task! [connection get-debugger-coordinates {:keys [app-info environment] :as request} return-path]
  ;; This could be called in contexts where we don't have the app:
  (let [get-app (fn []
                  (log/trace "Getting app for" app-info "env:" environment)
                  (or (:app request)
                      (:content (app-data/get-app app-info (app-data/get-version-spec-for-environment environment)))))]
    (ws-server/launch-bg-task! WS-SERVER-PARAMS {::get-app                  get-app
                                                 ::get-debugger-coordinates (when get-debugger-coordinates
                                                                              (partial get-debugger-coordinates environment))}
                               connection request return-path)))

(defn wrap-as-executor
  ([connection] (wrap-as-executor connection nil))
  ([{:keys [send-request!] :as connection} get-debugger-coordinates]
   {:fn    (fn execute-on-downlink! [{{:keys [func]} :call, :keys [app app-info environment tracing-span] :as request} return-path]
             (let [profiling-info {:origin      "Server (Downlink executor)"
                                   :description (format "Downlink execute (%s)" func)}

                   tracing-span (tracing/start-span (str "Downlink call: " (:short (dispatcher/request-task-description request))) {:internal true} tracing-span)
                   request (assoc request :tracing-span tracing-span)
                   return-path (dispatcher/return-path-with-closing-span return-path tracing-span)

                   {:keys [call-context request return-path]} (ws-calls/stateful-request-to-serialisable-request request return-path profiling-info)

                   request (assoc request :serialised-tracing-span nil) ;; TODO: Work out how to serialise the tracing span here, so the downlink can add spans of its own. See dispatch-downlink-call!

                   call-id (ws-server/gen-call-id request)
                   call-context (assoc call-context
                                  ::get-app (constantly app)
                                  ::get-debugger-coordinates (when get-debugger-coordinates
                                                               (partial get-debugger-coordinates environment)))]

               (send-request! call-context {:type "CALL" :id call-id} request return-path)))

    :bg-fn (partial launch-bg-task! connection get-debugger-coordinates)}))

(ws-server/setup-bg-task-impl! WS-SERVER-PARAMS)

(defn handle-incoming-ws [request]
  (ws-util/with-opening-channel
    request channel on-open
    (let [registration-cookie (atom nil)
          spec (atom nil) ; Only used for debug logging
          ds (serialisation/mk-Deserialiser {:origin :server, :permitted-live-object-backends #{}})
          internal-error (atom nil)

          {:keys [get-pending-response get-app-info-and-env is-closed? send-close-errors! send-request! handle-response! handle-update! handle-task-killed! is-idle? get-pending-responses]}
          (ws-server/setup-request-handlers WS-SERVER-PARAMS channel)

          disconnect-on-idle? (atom false)
          disconnect-on-idle! (fn []
                                (reset! disconnect-on-idle? true)
                                (when (is-idle?)
                                  (close channel)))

          close-with-error-message! (fn [error-msg]
                                      (send! channel (util/write-json-str {:error error-msg}))
                                      (close channel))

          connection {:send-request! send-request!, ::ws-server/send-raw! #(send! channel %), ::tag-channel! (partial ws-util/tag-channel! channel) ::disconnect-on-idle! disconnect-on-idle! ::get-pending-responses get-pending-responses ::close-with-error-message! close-with-error-message!}]

      (on-close channel
                (fn [why]
                  (worker-pool/set-task-info! :websocket ::close)
                  (log/info "Downlink client disconnected:" (pr-str why) (pr-str @spec))

                  ;; Remove closing channel from list of registered downlinks
                  (unregister-downlink! @registration-cookie)

                  (send-close-errors! (cond
                                        @internal-error
                                        {:type "anvil.server.RuntimeUnavailableError", :message (str "Downlink disconnected: " @internal-error)}

                                        (= why :message-too-big)
                                        {:type "anvil.server.RuntimeUnavailableError", :message "Data payload too big - please use Media objects to transfer large amounts of data."}

                                        :else
                                        {:type "anvil.server.RuntimeUnavailableError", :message "Downlink disconnected"}))))

      (on-receive channel
                  (fn [json-or-binary]
                    (worker-pool/set-task-info! :websocket ::receive)
                    (log/trace "Downlink got data: " json-or-binary)
                    (try
                      (if-not (string? json-or-binary)
                        (serialisation/processBlob ds json-or-binary)

                        (let [raw-data (json/read-str json-or-binary :key-fn keyword)]
                          (cond
                            (not @registration-cookie)
                            (if (not= (:v raw-data) 2)
                              (close-with-error-message! "You are using an outdated version of the downlink server")

                              (if-let [cookie (register-downlink! raw-data connection)]
                                (do
                                  (reset! registration-cookie cookie)
                                  (reset! spec (:spec raw-data))
                                  (log/info "Downlink client connected with spec" (pr-str (:spec raw-data)))
                                  (send! channel (util/write-json-str {:auth "OK"})))

                                ;; else
                                (close-with-error-message! "Incorrect downlink key")))

                            (= (:type raw-data) "CHUNK_HEADER")
                            (serialisation/processBlobHeader ds raw-data)

                            ;; Draining; please don't send me any new calls
                            (= (:type raw-data) "DRAIN")
                            (do
                              (log/trace "Downlink draining:" @registration-cookie)
                              (drain-downlink! @registration-cookie))

                            ;; Background task shuffling off its mortal coil
                            (= (:type raw-data) "NOTIFY_TASK_KILLED")
                            (handle-task-killed! ds raw-data)

                            ;; TODO restart conversion here: Need the versions of everything
                            ;; Fetch app (missed cache)
                            (= (:type raw-data) "GET_APP")
                            (if-let [get-app (::get-app (:context (get-pending-response (:originating-call raw-data))))]
                              (send! channel (util/write-json-str {:type   "PROVIDE_APP", :id (:id raw-data),
                                                                   :app-id (:app-id raw-data), :app-version (:app-version raw-data),
                                                                   :app    (sanitise-app-for-downlink (get-app))}))
                              (log/warn "Downlink made GET_APP request without originating-call data:" raw-data))

                            ;; Command (request from downlink, ie remote-initiated RPC)
                            (= (:type raw-data) "CALL")
                            (let [call-id (:id raw-data)
                                  call-stack-id (:call-stack-id raw-data)
                                  pending-response (get-pending-response call-stack-id)
                                  context (or (:context pending-response))
                                  return-path {:update! #(send! channel (util/write-json-str (assoc % :id call-id)))
                                               :respond! #(serialisation/serialise-to-websocket! (assoc % :id call-id) channel true nil)}
                                  request (serialisation/deserialise ds raw-data)]
                              (if context
                                (dispatch-downlink-call! @registration-cookie context STACK-FRAME-INFO {}
                                                         (serialisation/getConfig ds) request return-path)
                                (send! channel (util/write-json-str {:id call-id :error {:message "Call from invalid context"}}))))

                            ;; Statistics
                            (= (:type raw-data) "STATS")
                            (report-downlink-stats @registration-cookie (:data raw-data))

                            ;; Response from downlink
                            (or (contains? raw-data :response) (contains? raw-data :error))
                            (do (handle-response! (serialisation/deserialise ds raw-data))
                                (when (and @disconnect-on-idle? (is-idle?))
                                  (close channel)))

                            (contains? raw-data :debugger)
                            (let [call-id (:id raw-data)
                                  {:keys [::get-debugger-coordinates]} (:context (get-pending-response call-id))]
                              (when get-debugger-coordinates
                                (handle-update! (-> raw-data
                                                    (dissoc :debugger)
                                                    (assoc :debuggers
                                                           [(merge (:debugger raw-data)
                                                                   (get-debugger-coordinates call-id))])))))

                            (contains? raw-data :debuggers)
                            (let [call-id (:id raw-data)
                                  {:keys [::get-debugger-coordinates]} (:context (get-pending-response call-id))]
                              (handle-update! (cond-> raw-data
                                                      get-debugger-coordinates (update :debuggers cons (get-debugger-coordinates call-id)))))

                            (or (contains? raw-data :output) (contains? raw-data :invalidate-macs))
                            (handle-update! raw-data))))


                      (catch Exception e
                        (let [error-id (random/hex 6)]
                          (log/error e "Error processing message from downlink. Internal server error:" error-id)
                          (reset! internal-error error-id))
                        (close channel))))))))