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

(defn- sanitise-app-for-downlink [app]
  (select-keys app [:modules :server_modules :forms :runtime_options :dependency_code :dependency_order :package_name]))

#_(defn gen-id [hint]
  (str (name hint) "-" (random/base64 18)))

;; TODO make sure the new version supports:
;; * Blended versions
;; * Same-server executors (for PDF rendering)
;; * Sending app with request when we have a nil or blank blended-version (ie hard-coded apps)


#_(defn send-request! [channel pending-responses bg-task req-id
                     {{:keys [live-object args kwargs func vt_global] :as _call} :call
                      :keys [app-id environment app-origin app session-state origin stale-uplink? call-stack]
                      :as _request}
                     message
                     return-path]

  ;; We key the downlink cache with a blend of *all* versions (incl dependencies),
  ;; but any calls the downlink makes in the meantime are tagged with the original environment.
  (let [blended-version (apply str (:commit-id environment) (for [[_ {:keys [commit-id]}] (sort-by first (:dependency_code app))] commit-id))
        start-time (System/nanoTime)]
    (swap! pending-responses assoc req-id {:app                   app
                                           :app-id                app-id
                                           :environment           environment
                                           :blended-version       blended-version
                                           :app-origin            app-origin
                                           :bg-task               bg-task
                                           :return-path           {:update!  #(dispatcher/update! return-path (assoc % :id req-id))
                                                                   :respond! (fn [resp]
                                                                               (let [resp (merge resp
                                                                                                 (when (:anvil/enable-profiling @session-state)
                                                                                                   {:profile (merge {:origin      "Server (Downlink executor)"
                                                                                                                     :description (str "Downlink execute (" func ")")
                                                                                                                     :start-time  (/ start-time 1000000.0)
                                                                                                                     :end-time    (/ (System/nanoTime) 1000000.0)}
                                                                                                                    (when (:profile resp)
                                                                                                                      {:children [(:profile resp)]}))}))]
                                                                                 (dispatcher/respond! return-path (dissoc resp :id))))}
                                           :call-stack            call-stack
                                           :session-state         session-state
                                           :pymod-session-at-send (:pymods @session-state)})

    (log/debug "Executing RPC function on downlink:" (str func (when live-object (str " (" (:backend live-object) ")"))))

    (try
      (serialisation/serialise-to-websocket! (merge {:id               req-id
                                                     :call-stack-id    req-id
                                                     :call-stack       (map #(select-keys % [:type]) call-stack)
                                                     :client           (:client @session-state)
                                                     :sessionData      (or (:pymods @session-state) {})
                                                     :app-id           app-id
                                                     :app-info         {:id          app-id,
                                                                        :branch      (:branch environment),
                                                                        :environment (select-keys environment [:description :tags])}
                                                     :app-version      blended-version
                                                     :persist-key      (when (get-in app [:runtime_options :server_persist])
                                                                         (str (:env_id environment)))
                                                     :stale-uplink?    stale-uplink?
                                                     :args             args
                                                     :kwargs           kwargs
                                                     :enable-profiling (:anvil/enable-profiling @session-state)
                                                     :vt_global        vt_global}
                                                    (when (or (not blended-version) (= blended-version ""))
                                                      {:app (sanitise-app-for-downlink app)})
                                                    message) channel false nil true)
      req-id

      (catch Exception e
        (let [error-id (random/hex 6)]
          (log/error e "Error serialising downlink request:" error-id)
          (dispatcher/respond! return-path {:error {:type "anvil.server.SerializationError" :message (str "Internal server error: " error-id)}}))))))

#_(defn call-fn [channel pending-responses
               {{:keys [live-object func]} :call
                :keys [origin]
                :as request}
               return-path]
  (send-request! channel pending-responses nil
                 (gen-id (if (= origin :client) "client" "server"))
                 request
                 (merge
                   {:type "CALL"}
                   (if live-object
                     {:liveObjectCall (assoc live-object :method func)}
                     {:command func}))
                 return-path))

#_(defn launch-bg-fn [channel pending-responses request return-path]
  (dispatcher/synchronous-return-path return-path
    (let [[{:keys [id] :as bt} request new-return-path]
          (background-tasks/setup-background-task-context
            request :downlink #(swap! background-tasks dissoc (:id %)))

          ;; Ugly two-step setup because we don't know the call-id until executor-fn is finished.
          ;; Make this nicer (perhaps when we go horizontal?)

          _ (swap! background-tasks assoc id {:channel channel, :pending-responses pending-responses})

          call-id (send-request! channel pending-responses bt (gen-id :bgtask) request
                                 {:type "LAUNCH_BACKGROUND", :command (get-in request [:call :func])}
                                 new-return-path)

          _ (swap! background-tasks #(if (get % id)
                                       (assoc-in % [id :call-id] call-id)
                                       %))]
      (background-tasks/mk-BackgroundTaskLiveObject id))))

(def WS-SERVER-PARAMS {:link-name "Downlink",
                       :bg-impl-id :downlink,
                       :disconnection-error "anvil.server.RuntimeUnavailableError"})

(defn launch-bg-task! [connection {:keys [app-info environment] :as request} return-path]
  ;; This could be called in contexts where we don't have the app:
  (let [get-app (fn []
                  (log/trace "Getting app for" app-info "env:" environment)
                  (or (:app request)
                      (:content (app-data/get-app app-info (app-data/get-version-spec-for-environment environment)))))]
    (ws-server/launch-bg-task! WS-SERVER-PARAMS {::get-app get-app} connection request return-path)))

(defn wrap-as-executor [{:keys [send-request!] :as connection}]
  {:fn    (fn execute-on-downlink! [{{:keys [func]} :call, :keys [app app-info environment tracing-span] :as request} return-path]
            (let [profiling-info {:origin      "Server (Downlink executor)"
                                  :description (format "Downlink execute (%s)" func)}
                  blended-version (apply str (:commit-id environment) (for [[_ {:keys [commit-id]}] (sort-by first (:dependency_code app))] commit-id))

                  tracing-span (tracing/start-span (str "Downlink call: " (:short (dispatcher/request-task-description request))) {:internal true} tracing-span)
                  request (assoc request :tracing-span tracing-span)
                  return-path (dispatcher/return-path-with-closing-span return-path tracing-span)

                  {:keys [call-context request return-path]} (ws-calls/stateful-request-to-serialisable-request request return-path profiling-info)

                  request (assoc request :app-version blended-version
                                         :serialised-tracing-span nil)] ;; TODO: Work out how to serialise the tracing span here, so the downlink can add spans of its own. See dispatch-downlink-call!

              (send-request! (assoc call-context ::get-app (constantly app)) {:type "CALL"} request return-path)))

   :bg-fn (partial launch-bg-task! connection)})

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

          connection {:send-request! send-request!, ::ws-server/send-raw! #(send! channel %), ::tag-channel! (partial ws-util/tag-channel! channel) ::disconnect-on-idle! disconnect-on-idle! ::get-pending-responses get-pending-responses}]

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
                              (do
                                (send! channel (util/write-json-str {:error "You are using an outdated version of the downlink server"}))
                                (close channel))

                              (if-let [cookie (register-downlink! raw-data connection)]
                                (do
                                  (reset! registration-cookie cookie)
                                  (reset! spec (:spec raw-data))
                                  (log/info "Downlink client connected with spec" (pr-str (:spec raw-data)))
                                  (send! channel (util/write-json-str {:auth "OK"})))

                                ;; else
                                (do
                                  (send! channel (util/write-json-str {:error "Incorrect downlink key"}))
                                  (close channel))))

                            (= (:type raw-data) "CHUNK_HEADER")
                            (serialisation/processBlobHeader ds raw-data)

                            ;; Draining; please don't send me any new calls
                            (= (:type raw-data) "DRAIN")
                            (do
                              (log/info "Downlink draining:" @registration-cookie)
                              (drain-downlink! @registration-cookie))

                            ;; Background task shuffling off its mortal coil
                            (= (:type raw-data) "NOTIFY_TASK_KILLED")
                            (handle-task-killed! ds raw-data)

                            ;; TODO restart conversion here: Need the versions of everything
                            ;; Fetch app (missed cache)
                            (= (:type raw-data) "GET_APP")
                            (if-let [get-app (::get-app (:context (get-pending-response (:originating-call raw-data))))]
                              (send! channel (util/write-json-str {:type   "PROVIDE_APP", :id (:id raw-data),
                                                                   :app-id (:id raw-data), :app-version (:app-version raw-data),
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

                            (contains? raw-data :output)
                            (handle-update! raw-data))))


                      (catch Exception e
                        (let [error-id (random/hex 6)]
                          (log/error e "Error processing message from downlink. Internal server error:" error-id)
                          (reset! internal-error error-id))
                        (close channel))))))))