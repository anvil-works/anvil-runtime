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
            [anvil.core.worker-pool :as worker-pool]))


(clj-logging-config.log4j/set-logger! :level :info)

;; Hookable functions
(defonce register-downlink! (fn [registration-request executor] (throw (UnsupportedOperationException.))))
(defonce drain-downlink! (fn [cookie] nil))
(defonce unregister-downlink! (fn [cookie] (throw (UnsupportedOperationException.))))
(defonce report-downlink-stats (fn [cookie stats] nil))

(def set-downlink-hooks! (util/hook-setter [register-downlink! drain-downlink! unregister-downlink! report-downlink-stats]))

(defn- sanitise-app-for-downlink [app]
  (select-keys app [:modules :server_modules :forms :runtime_options :dependency_code :dependency_order :package_name]))

(defn gen-id [hint]
  (str (name hint) "-" (random/base64 16)))

(defn- request-template-from-pending-response [pending-response]
  (select-keys pending-response [:app-id :app :environment :app-origin :session-state :call-stack]))

(defn send-request! [channel pending-responses bg-task req-id
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

(defn call-fn [channel pending-responses
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

;; [app-id id] -> {:channel, :call-id}
(defonce background-tasks (atom {}))

(defn launch-bg-fn [channel pending-responses request]
  (let [[{:keys [id] :as bt} new-return-path]
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
    id))


(swap! background-tasks/implementations assoc :downlink
       {:kill!     (fn [{:keys [id]} return-path]
                     (dispatcher/synchronous-return-path return-path
                       (if-let [{:keys [channel call-id]} (@background-tasks id)]
                         (when-not (send! channel (util/write-json-str {:type "KILL_TASK", :task call-id}))
                           (throw+ {:anvil/server-error "Downlink disconnected" :type "anvil.server.NotRunningTask"}))
                         (throw+ {:anvil/server-error "Downlink disconnected" :type "anvil.server.NotRunningTask"}))
                       nil))

        :get-state (fn [{:keys [id]} return-path]
                     (dispatcher/report-exceptions-to-return-path return-path
                       (if-let [{:keys [channel call-id pending-responses]} (@background-tasks id)]
                         (let [new-state-request-id (str "bgquery-" (random/base64 16))]
                           ;; TODO this pending-response context is very minimal - could provide more
                           ;; (which gets used in serialiser)
                           (swap! pending-responses assoc new-state-request-id
                                  {:return-path return-path})
                           (when-not (send! channel (util/write-json-str {:type "GET_TASK_STATE" :id new-state-request-id :task call-id}))
                             (swap! pending-responses dissoc new-state-request-id)
                             (log/trace "Failed to send task-state query to downlink")
                             (throw+ {:anvil/server-error "Downlink disconnected" :type "anvil.server.NotRunningTask"})))
                         ;; else, this task isn't one we know of
                         (throw+ {:anvil/server-error "No such task on this downlink" :type "anvil.server.NotRunningTask"}))))})


(defn handle-incoming-ws [request]
  (ws-util/with-opening-channel
    request channel on-open
    (let [registration-cookie (atom nil)
          pending-responses (atom {}) ;; id -> {:app-id app-id :respond! respond!, :send-update! send-update, :ssm-state ssm-state}
          ds (serialisation/mk-Deserialiser :permitted-live-object-backends #{"uplink."})
          internal-error (atom nil)
          executor {:fn (partial call-fn channel pending-responses)
                    :bg-fn (partial launch-bg-fn channel pending-responses)
                    ::send-fn (partial send-request! channel pending-responses nil)
                    ::tag-channel! (partial ws-util/tag-channel! channel)}]

      (on-close channel
                (fn [why]
                  (worker-pool/set-task-info! :websocket ::close)
                  (log/info "Downlink client disconnected:" (pr-str why))

                  ;; Remove closing channel from list of registered downlinks
                  (unregister-downlink! @registration-cookie)

                  (doseq [[_ p] @pending-responses]
                    (dispatcher/respond! (:return-path p)
                                         {:error (cond
                                                   @internal-error
                                                   {:type "anvil.server.RuntimeUnavailableError", :message (str "Downlink disconnected: " @internal-error)}

                                                   (= why :message-too-big)
                                                   {:type "anvil.server.InternalError", :message "Data payload too big - please use Media objects to transfer large amounts of data."}

                                                   :else
                                                   {:type "anvil.server.RuntimeUnavailableError", :message "Downlink disconnected"}
                                                   )}))))

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

                              (if-let [cookie (register-downlink! raw-data executor)]
                                (do
                                  (reset! registration-cookie cookie)
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
                            (when-let [{:keys [bg-task] :as pending-response} (get @pending-responses (:id raw-data))]
                              (let [data (serialisation/deserialise ds raw-data (assoc (request-template-from-pending-response pending-response)
                                                                                  :origin :server))]
                                (background-tasks/record-final-state! bg-task (if (:taskState data) {:taskState (:taskState data)} {}) :killed)))

                            ;; Fetch app (missed cache)
                            (= (:type raw-data) "GET_APP")
                            (if-let [{:keys [app-id blended-version app]} (get @pending-responses (:originating-call raw-data))]
                              (send! channel (util/write-json-str {:type "PROVIDE_APP", :id (:id raw-data),
                                                                   :app-id app-id, :app-version blended-version,
                                                                   :app (sanitise-app-for-downlink app)}))
                              (log/warn "Downlink made GET_APP request without originating-call data:" raw-data))

                            ;; Command (request from downlink, ie remote-initiated RPC)
                            (= (:type raw-data) "CALL")
                            (let [{:keys [session-state app-id environment app-origin app return-path call-stack]} (get @pending-responses (:call-stack-id raw-data))
                                  call-stack-id (:call-stack-id raw-data)
                                  change-session! (fn [new-session]
                                                    (swap! pending-responses #(if (contains? % call-stack-id)
                                                                                (update-in % [call-stack-id] merge {:session-state new-session
                                                                                                                    :pymod-session-at-send (:pymods @new-session)})
                                                                                %)))]

                              (ws-calls/process-call-from-ws channel ds raw-data
                                                             {:app-id                                app-id, :app app, :environment environment, :app-origin app-origin,
                                                              :session-state                         session-state, :anvil.dispatcher/change-session! change-session!, :origin :downlink,
                                                              :call-stack                            (cons {:type :server_module} call-stack),
                                                              :thread-id                             (str "downlink-" app-id "-" call-stack-id),
                                                              :anvil.dispatcher/same-server-executor executor}
                                                             {:use-quota? false,
                                                              :prune-liveobjects? true
                                                              :update-bypass! (when return-path #(dispatcher/update! return-path %))}))

                            ;; Statistics
                            (= (:type raw-data) "STATS")
                            (report-downlink-stats @registration-cookie (:data raw-data))

                            ;; Response from downlink
                            (or (contains? raw-data :response) (contains? raw-data :error))
                            (when-let [{:keys [session-state app-id app return-path pymod-session-at-send] :as pending-response}
                                       (@pending-responses (:id raw-data))]

                              (when-let [pysess (:sessionData raw-data)]
                                (when (= (:pymods @session-state) pymod-session-at-send)
                                  (swap! session-state assoc :pymods pysess)))
                              (let [raw-data (dissoc raw-data :sessionData)
                                    resp (ws-calls/process-response-from-ws ds (request-template-from-pending-response pending-response) return-path raw-data)]
                                ; Don't do this until we're sure process-response didn't blow up.
                                (swap! pending-responses dissoc (:id raw-data))
                                resp))

                            (contains? raw-data :output)
                            (when-let [{:keys [return-path]} (@pending-responses (:id raw-data))]
                              (ws-calls/process-update-from-ws return-path raw-data)))))


                      (catch Exception e
                        (let [error-id (random/hex 6)]
                          (log/error e "Error processing message from downlink. Internal server error:" error-id)
                          (reset! internal-error error-id))
                        (close channel))))))))