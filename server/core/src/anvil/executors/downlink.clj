(ns anvil.executors.downlink
  (:use org.httpkit.server
        [slingshot.slingshot :only [throw+ try+]])
  (:require [digest]
            [anvil.util :as util]
            [anvil.dispatcher.serialisation.core :as serialisation]
            [clojure.tools.logging :as log]
            [clojure.data.json :as json]
            [crypto.random :as random]
            [anvil.executors.ws-utils :as ws-utils]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.background-tasks :as background-tasks]))


(clj-logging-config.log4j/set-logger! :level :info)

;; Hookable functions
(defonce register-downlink! (fn [registration-request executor] (throw (UnsupportedOperationException.))))
(defonce drain-downlink! (fn [cookie] nil))
(defonce unregister-downlink! (fn [cookie] (throw (UnsupportedOperationException.))))

(def set-downlink-hooks! (util/hook-setter [register-downlink! drain-downlink! unregister-downlink!]))

(defn- sanitise-app-for-downlink [app]
  (select-keys app [:modules :server_modules :forms :runtime_options :dependency_code :dependency_order :package_name]))

(defn executor-fn [channel pending-responses bg-task-id
                {{:keys [live-object args kwargs func vt_global] :as _call} :call
                 :keys [app-id app-branch app-version app-origin app session-state origin stale-uplink? background? call-stack] :as _request}
                return-path]

  (let [new-id (str (if (= origin :client) "client-" "server-") (random/base64 16))
        ;; We key the downlink cache with a blend of *all* versions (incl dependencies),
        ;; but any calls the downlink makes in the meantime are tagged with the original app-version.
        blended-version (apply str app-version (for [[_ {:keys [version]}] (sort-by first (:dependency_code app))] version))]
    (swap! pending-responses assoc new-id {:app                   app
                                           :app-id                app-id
                                           :app-branch            app-branch
                                           :app-version           app-version
                                           :blended-version       blended-version
                                           :app-origin            app-origin
                                           :bg-task-id            bg-task-id
                                           :return-path           {:update!  #(dispatcher/update! return-path (assoc % :id new-id))
                                                                   :respond! #(dispatcher/respond! return-path (dissoc % :id))}
                                           :call-stack            call-stack
                                           :session-state         session-state
                                           :pymod-session-at-send (:pymods @session-state)})

    (log/debug "Executing RPC function on downlink:" (str func (when live-object (str " (" (:backend live-object) ")"))))

    (try
      (serialisation/serialise-to-websocket! (merge {:id               new-id
                                                     :call-stack-id    new-id
                                                     :call-stack       (map #(select-keys % [:type]) call-stack)
                                                     :client           (:client @session-state)
                                                     :type             (if background? "LAUNCH_BACKGROUND" "CALL")
                                                     :sessionData      (or (:pymods @session-state) {})
                                                     :app-id           app-id
                                                     :app-info         {:id app-id, :branch app-branch}
                                                     :app-version      blended-version
                                                     :persist-key      (when (get-in app [:runtime_options :server_persist])
                                                                         app-branch)
                                                     :stale-uplink?    stale-uplink?
                                                     :args             args
                                                     :kwargs           kwargs
                                                     :enable-profiling (:anvil/enable-profiling @session-state)
                                                     :vt_global        vt_global}
                                                    (when (or (not blended-version) (= blended-version ""))
                                                      {:app (sanitise-app-for-downlink app)})
                                                    (if live-object
                                                      {:liveObjectCall (assoc live-object :method func)}
                                                      {:command func})) channel false nil true)
      new-id

      (catch Exception e
        (let [error-id (random/hex 6)]
          (log/error e "Error serialising downlink request:" error-id)
          (dispatcher/respond! return-path {:error {:type "anvil.server.SerializationError" :message (str "Internal server error: " error-id)}}))))))

;; [app-id id] -> {:channel, :call-id}
(defonce background-tasks (atom {}))

(defn launch-bg-fn [channel pending-responses request]
  (let [[{:keys [app_id id] :as bt} new-return-path]
        (background-tasks/setup-background-task-context
          request :downlink #(swap! background-tasks dissoc [(:app_id %) (:id %)]))

        lookup-key [app_id id]

        ;; Ugly two-step setup because we don't know the call-id until executor-fn is finished.
        ;; Make this nicer (perhaps when we go horizontal?)

        _ (swap! background-tasks assoc lookup-key {:channel channel, :pending-responses pending-responses})

        call-id (executor-fn channel pending-responses id request new-return-path)

        _ (swap! background-tasks #(if (get % lookup-key)
                                    (assoc-in % [lookup-key :call-id] call-id)
                                    %))]
    id))



(swap! background-tasks/implementations assoc :downlink
       {:kill!     (fn [app-id id return-path]
                     (dispatcher/synchronous-return-path return-path
                       (if-let [{:keys [channel call-id]} (@background-tasks [app-id id])]
                         (when-not (send! channel (util/write-json-str {:type "KILL_TASK", :task call-id}))
                           (throw+ {:anvil/server-error "Downlink disconnected" :type "anvil.server.NotRunningTask"}))
                         (throw+ {:anvil/server-error "Downlink disconnected" :type "anvil.server.NotRunningTask"}))
                       nil))

        :get-state (fn [app-id id return-path]
                     (dispatcher/report-exceptions-to-return-path return-path
                       (if-let [{:keys [channel call-id pending-responses]} (@background-tasks [app-id id])]
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
  (util/with-opening-channel
    request channel on-open
    (let [registration-cookie (atom nil)
          pending-responses (atom {}) ;; id -> {:app-id app-id :respond! respond!, :send-update! send-update, :ssm-state ssm-state}
          ds (serialisation/mk-Deserialiser :permitted-live-object-backends #{"uplink."})
          internal-error (atom nil)
          executor {:fn (partial executor-fn channel pending-responses nil)
                    :bg-fn (partial launch-bg-fn channel pending-responses)}]

      (on-close channel
                (fn [why]
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
                            (when-let [{:keys [app-id app session-state bg-task-id]} (get @pending-responses (:id raw-data))]
                              (let [data (serialisation/deserialise ds raw-data app-id app session-state :server)]
                                (background-tasks/record-final-state! app-id bg-task-id (if (:taskState data) {:taskState (:taskState data)} {}) :killed)))

                            ;; Fetch app (missed cache)
                            (= (:type raw-data) "GET_APP")
                            (when-let [{:keys [app-id blended-version app]} (get @pending-responses (:originating-call raw-data))]
                              (send! channel (util/write-json-str {:type "PROVIDE_APP", :id (:id raw-data),
                                                                   :app-id app-id, :app-version blended-version,
                                                                   :app (sanitise-app-for-downlink app)})))

                            ;; Command (request from downlink, ie remote-initiated RPC)
                            (= (:type raw-data) "CALL")
                            (let [{:keys [session-state app-id app-version app-branch app-origin app return-path call-stack]} (get @pending-responses (:call-stack-id raw-data))
                                  call-stack-id (:call-stack-id raw-data)
                                  change-session! (fn [new-session]
                                                    (swap! pending-responses #(if (contains? % call-stack-id)
                                                                                (update-in % [call-stack-id] merge {:session-state new-session
                                                                                                                    :pymod-session-at-send (:pymods @new-session)})
                                                                                %)))]

                              (ws-utils/process-call-from-ws channel ds raw-data
                                                             {:app-id                                app-id, :app app, :app-branch app-branch, :app-version app-version, :app-origin app-origin,
                                                              :session-state                         session-state, :anvil.dispatcher/change-session! change-session!, :origin :downlink,
                                                              :call-stack                            (cons {:type :server_module} call-stack),
                                                              :thread-id                             (str "downlink-" app-id "-" call-stack-id),
                                                              :anvil.dispatcher/same-server-executor executor}
                                                             {:use-quota? false,
                                                              :prune-liveobjects? true
                                                              :update-bypass! (when return-path #(dispatcher/update! return-path %))}))

                            ;; Response from downlink
                            (or (contains? raw-data :response) (contains? raw-data :error))
                            (when-let [{:keys [session-state app-id app return-path pymod-session-at-send]} (@pending-responses (:id raw-data))]

                              (when-let [pysess (:sessionData raw-data)]
                                (when (= (:pymods @session-state) pymod-session-at-send)
                                  (swap! session-state assoc :pymods pysess)))
                              (let [raw-data (dissoc raw-data :sessionData)
                                    resp (ws-utils/process-response-from-ws ds return-path app-id app session-state raw-data :server)]
                                ; Don't do this until we're sure process-response didn't blow up.
                                (swap! pending-responses dissoc (:id raw-data))
                                resp))

                            (contains? raw-data :output)
                            (when-let [{:keys [return-path]} (@pending-responses (:id raw-data))]
                              (ws-utils/process-update-from-ws return-path raw-data)))))


                      (catch Exception e
                        (let [error-id (random/hex 6)]
                          (log/error e "Error processing message from downlink. Internal server error:" error-id)
                          (reset! internal-error error-id))
                        (close channel))))))))