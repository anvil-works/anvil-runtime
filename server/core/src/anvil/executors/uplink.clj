(ns anvil.executors.uplink
  (:use org.httpkit.server
        [slingshot.slingshot :only [throw+ try+]])
  (:require
    [slingshot.slingshot :refer [throw+ try+]]
    [clojure.stacktrace]
    [digest]
    [anvil.util :as util]
    [clojure.data.json :as json]
    [anvil.runtime.app-data :as app-data]
    [clojure.tools.logging :as log]
    [anvil.dispatcher.core :as dispatcher]
    [anvil.dispatcher.serialisation.core :as serialisation]
    [crypto.random :as random]
    [anvil.executors.ws-utils :as ws-utils]
    [anvil.metrics :as metrics]
    [anvil.runtime.util :as runtime-util]
    [anvil.core.worker-pool :as worker-pool])
  (:import (java.util.regex PatternSyntaxException)))


(clj-logging-config.log4j/set-logger! :level :info)

;; Hookable functions

(defonce on-uplink-connect (fn [app-id app-branch protocol-version] nil))

(defonce set-uplink-handler! (fn [cookie func handler]
                               (throw (UnsupportedOperationException.))))

(defonce clear-uplink-registrations! (fn [cookie specs]
                                       (throw (UnsupportedOperationException.))))

(defonce get-app-info-and-privileges-for-uplink-key (fn [uplink-key] nil))

(def set-uplink-hooks! (util/hook-setter [get-app-info-and-privileges-for-uplink-key on-uplink-connect
                                          clear-uplink-registrations! set-uplink-handler!]))


(defn- executor [{:keys [channel pending-responses prune-live-objects]}
                 {{:keys [live-object args kwargs func vt_global] :as call} :call
                  :keys [session-state origin call-stack app app-id app-branch app-version] :as request}
                 return-path]

  (let [new-id (str (if (= origin :client) "client-" "server-") (random/base64 10))
        return-path {:update! #(dispatcher/update! return-path (assoc % :id new-id))
                     :respond! #(dispatcher/respond! return-path (dissoc % :id))}]

    (swap! pending-responses assoc new-id {:app-id       app-id
                                           :app          app
                                           :app-branch   app-branch
                                           :app-version  app-version
                                           :call-stack   call-stack
                                           :return-path  return-path
                                           :ssm-state    session-state})


    (log/debug "Executing RPC function on uplink:" (str func (when live-object (str " (" (:backend live-object) ")"))))

    (try
      (serialisation/serialise-to-websocket! (merge {:id               new-id
                                                     :call-stack-id    new-id
                                                     :call-stack       (map #(select-keys % [:type]) call-stack)
                                                     :from-server?     (runtime-util/is-server-origin? origin)
                                                     :client           (:client @session-state)
                                                     :type             "CALL"
                                                     :args             args
                                                     :kwargs           kwargs
                                                     :enable-profiling (:anvil/enable-profiling @session-state)
                                                     :app-info         {:id app-id, :branch app-branch}
                                                     :vt_global        vt_global}
                                                    (if live-object
                                                      {:liveObjectCall (assoc live-object :method func)}
                                                      {:command func})) channel false nil prune-live-objects)
      (catch Exception e
        (log/error e "Error serialising uplink request")
        (dispatcher/respond! return-path {:error {:type "anvil.server.SerializationError" :message (str e)}})))))

(defonce connected-uplink-count (atom 0))

(defn handle-incoming-ws [request]
  (util/with-opening-channel
    request channel on-open
    (let [app-id (atom nil)
          app-branch (atom nil)
          app-version (atom nil)
          app-origin (atom nil)
          priv-level (atom nil)
          my-fn-registrations (atom #{})
          protocol-version (atom nil)
          closed (atom false)
          ds (delay (serialisation/mk-Deserialiser :permitted-live-object-backends #{"uplink."}
                                                   :no-live-object-pruning (<= @protocol-version 4)))

          ;; id -> {:return-path return-path, :ssm-state ssm-state}
          pending-responses (atom {})
          default-session-state (atom {})
          internal-error (atom nil)
          connection-cookie (atom nil)]

      (metrics/set! :api/runtime-connected-uplinks-total (swap! connected-uplink-count inc))

      (on-close channel
                (fn [why]
                  (worker-pool/set-task-info! :websocket ::close)
                  (when @app-id
                    (log/debug "Uplink websocket closed for app" @app-id (pr-str why)))
                  (metrics/set! :api/runtime-connected-uplinks-total (swap! connected-uplink-count dec))

                  (clear-uplink-registrations! @connection-cookie @my-fn-registrations)

                  (doseq [[_ p] @pending-responses]
                    (dispatcher/respond! (:return-path p)
                                         {:error (cond
                                                   @internal-error
                                                   {:type "anvil.server.UplinkDisconnectedError", :message (str "Uplink disconnected: " @internal-error)}

                                                   (= why :message-too-big)
                                                   {:type "anvil.server.UplinkDisconnectedError", :message "Data payload too big - please use Media objects to transfer large amounts of data."}

                                                   :else
                                                   {:type "anvil.server.UplinkDisconnectedError", :message "Uplink disconnected"}
                                                   )}))
                  (reset! closed true)))

      (on-receive channel
                  (fn [json-or-binary]
                    (worker-pool/set-task-info! :websocket ::receive)
                    (when-not @closed
                      (log/trace "Uplink got data: " json-or-binary)
                      (try+
                        (if-not (string? json-or-binary)
                          (when @app-id
                            (serialisation/processBlob @ds json-or-binary))

                          (let [raw-data (json/read-str json-or-binary :key-fn keyword)]
                            (cond
                              (not @app-id)
                              (let [[app-info priv] (get-app-info-and-privileges-for-uplink-key (or (:key raw-data) ""))]
                                (reset! protocol-version (:v raw-data))
                                (cond
                                  (not (and (number? @protocol-version)
                                            (>= @protocol-version 4)))
                                  (do
                                    (send! channel "{\"error\": \"You are using an outdated version of the uplink library. Please use 'pip install --upgrade anvil-uplink' to get a new one.\"}")
                                    (log/debug "Closing connecting uplink channel: Uplink library out of date for app" (:id app-info))
                                    (close channel))

                                  (not app-info)
                                  (do
                                    (send! channel "{\"error\": \"Incorrect uplink key\"}")
                                    (log/debug "Closing connecting uplink channel: Uplink key did not match a known app")
                                    (close channel))

                                  (util/app-locked? (:id app-info))
                                  (do
                                    (send! channel "{\"error\": \"This app is currently down for maintenance. Please try again in a few minutes.\"}")
                                    (log/debug "Closing connecting uplink channel: App locked: " (pr-str (:id app-info)))
                                    (close channel))

                                  :else
                                  (do
                                    (reset! app-id (:id app-info))
                                    (let [rev (when-not (= :dev (:version app-info))
                                                (app-data/get-published-revision app-info))]
                                      (reset! app-branch (if rev "published" "master"))
                                      (reset! app-version rev))
                                    (reset! app-origin (:app-origin request))
                                    (reset! priv-level priv)
                                    (reset! default-session-state
                                            {:client (runtime-util/client-info-from-request (if (= :uplink priv) :uplink :client_uplink)
                                                                                            request)
                                             :app-id (:id app-info)
                                             :debug? (= :dev (:version app-info))})
                                    (send! channel (util/write-json-str {:auth     "OK"
                                                                         :app-info {:branch @app-branch
                                                                                    :id     @app-id}}))

                                    (when (< @protocol-version 7)
                                      (send! channel "{\"output\": \"You are using a deprecated version of the Anvil Uplink. Upgrade for bug-fixes and new features by typing 'pip install --upgrade anvil-uplink'\"}"))

                                    (log/info "Uplink connected for app" @app-id " branch " @app-branch)
                                    (reset! connection-cookie (on-uplink-connect @app-id @app-branch @protocol-version)))))

                              (= (:type raw-data) "REGISTER")
                              (if-not (= @priv-level :uplink)
                                (do
                                  (send! channel "{\"error\": \"Cannot register @anvil.server.callable functions from an unprivileged (client) uplink.\"}")
                                  (log/info "Closing uplink channel: Client uplink attempted to register a function")
                                  (close channel))
                                (try
                                  (let [handler {:fn (partial executor {:channel            channel
                                                                        :pending-responses  pending-responses
                                                                        :prune-live-objects (>= @protocol-version 5)})}]
                                    (log/debug "Server function registered:" (:name raw-data))

                                    (swap! my-fn-registrations conj (set-uplink-handler! @connection-cookie (re-pattern (:name raw-data)) handler)))
                                  (catch PatternSyntaxException _e
                                    (send! channel "{\"error\": \"Invalid function name specification\"}")
                                    (log/info "Closing uplink channel: Invalid function spec")
                                    (close channel))))

                              (= (:type raw-data) "REGISTER_LIVE_OBJECT_BACKEND")
                              (do
                                (send! channel "{\"error\": \"Cannot register live-object backends the uplink.\"}")
                                (log/info "Closing uplink channel: Uplink attempted to register a LiveObject backend")
                                (close channel))


                              (= (:type raw-data) "CHUNK_HEADER")
                              (serialisation/processBlobHeader @ds raw-data)

                              ;; Command (request from uplink, ie remote-initiated RPC)
                              (= (:type raw-data) "CALL")
                              (let [call-stack-id (:call-stack-id raw-data)
                                    pending-response (get @pending-responses call-stack-id)
                                    session-state (or (:ssm-state pending-response)
                                                      default-session-state)
                                    app (:app pending-response)
                                    update-bypass! (when pending-response #(dispatcher/update! (:return-path pending-response) %))
                                    this-app-branch (or (:app-branch pending-response) @app-branch)
                                    this-app-version (or (:app-version pending-response) @app-version)
                                    change-session! (fn [new-session]
                                                      (swap! pending-responses #(if (contains? % call-stack-id)
                                                                                  (assoc-in % [call-stack-id :ssm-state] new-session)
                                                                                  %)))]

                                (ws-utils/process-call-from-ws channel @ds raw-data
                                                               {:app                              app,
                                                                :app-id                           @app-id,
                                                                :app-branch                       this-app-branch,
                                                                :app-version                      this-app-version,
                                                                :app-origin                       @app-origin,
                                                                :session-state                    session-state,
                                                                :anvil.dispatcher/change-session! change-session!
                                                                :origin                           @priv-level
                                                                :call-stack                       (cons {:type (if (= :uplink @priv-level) :uplink :client-uplink)} (:call-stack pending-response))
                                                                :thread-id                        (when call-stack-id
                                                                                                    (str (when (not= @priv-level :uplink) "client-")
                                                                                                         "uplink-" @app-id "-" call-stack-id))
                                                                :use-quota?                       (not pending-response)} ;; If this is a call stack id we haven't heard of, it's a new call and we should use our quotas.

                                                               {:prune-liveobjects? (>= @protocol-version 5)
                                                                :update-bypass!     update-bypass!}))

                              ;; Response from uplink
                              (or (contains? raw-data :response) (contains? raw-data :error))
                              (when (= @priv-level :uplink) ;; Defensive belt-and-braces
                                (when-let [p (@pending-responses (:id raw-data))]
                                  (let [resp (ws-utils/process-response-from-ws @ds (:return-path p) (:app-id p) (:app p) (or (:ssm-state p) default-session-state) raw-data :server)]
                                    (swap! pending-responses dissoc (:id raw-data))
                                    resp)))

                              (contains? raw-data :output)
                              (when (= @priv-level :uplink) ;; Belt and braces
                                (when-let [p (@pending-responses (:id raw-data))]
                                  (ws-utils/process-update-from-ws (:return-path p) raw-data))))))

                        (catch :anvil/server-error e
                          (send! channel (util/write-json-str {:error (:anvil/server-error e)}))
                          (log/info "Closing uplink channel:" (:anvil/server-error e))
                          (close channel))
                        (catch Exception e
                          (let [error-id (random/hex 6)]
                            (log/error e "Error processing message from uplink. Internal server error:" error-id)
                            (reset! internal-error error-id))
                          (close channel)))))))))