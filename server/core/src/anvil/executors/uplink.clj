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
    [anvil.executors.ws-calls :as ws-calls]
    [anvil.executors.ws-server :as ws-server]
    [anvil.metrics :as metrics]
    [anvil.runtime.util :as runtime-util]
    [anvil.core.worker-pool :as worker-pool]
    [anvil.runtime.ws-util :as ws-util]
    [anvil.runtime.sessions :as sessions])
  (:import (java.util.regex PatternSyntaxException)))


(clj-logging-config.log4j/set-logger! :level :info)

;; Hookable functions

(defonce on-uplink-connect (fn [{:keys [protocol-version environment server-privilege?] :as connect-info} send-request!] nil))

(defonce set-uplink-handler! (fn [cookie func]
                               (throw (UnsupportedOperationException.))))

(defonce clear-uplink-registrations! (fn [cookie specs]
                                       (throw (UnsupportedOperationException.))))

(defonce get-app-info-environment-and-privileges-for-uplink-key (fn [uplink-key] nil))

(defonce dispatch-uplink-call!
         (fn [cookie context call-stack-info extra-request-params deserialiser-conf wire-request return-path]
           (ws-calls/dispatch-request! context call-stack-info extra-request-params
                                       deserialiser-conf wire-request return-path)))

(def set-uplink-hooks! (util/hook-setter [get-app-info-environment-and-privileges-for-uplink-key on-uplink-connect
                                           clear-uplink-registrations! set-uplink-handler! dispatch-uplink-call!]))

(defn STACK-FRAME-INFO [server-privilege?]
  {:origin           (if server-privilege? :uplink :client)
   :stack-frame-type (if server-privilege? :uplink :client-uplink)})

(def WS-SERVER-PARAMS {:link-name           "Uplink",
                       :bg-impl-id          :uplink,
                       :disconnection-error "anvil.server.UplinkDisconnected"})

(def launch-bg-task! (partial ws-server/launch-bg-task! WS-SERVER-PARAMS {}))

(defn wrap-as-executor [{:keys [send-request!] :as connection}]
  {:fn    (fn execute-on-uplink! [{{:keys [func]} :call, :keys [app app-info environment] :as request} return-path]
            (let [profiling-info {:origin      (format "Server (Uplink executor)")
                                  :description (str "Uplink execute (" func ")")}
                  {:keys [call-context request return-path]} (ws-calls/stateful-request-to-serialisable-request request return-path profiling-info)]

              (send-request! call-context {:type "CALL"} request return-path)))

   :bg-fn (partial launch-bg-task! connection)})

(ws-server/setup-bg-task-impl! WS-SERVER-PARAMS)

(defonce connected-uplink-count (atom 0))

(defn handle-incoming-ws [request]
  (ws-util/with-opening-channel
    request channel on-open
    (let [connection (atom nil)
          my-fn-registrations (atom #{})
          ds (delay (serialisation/mk-Deserialiser
                      (if (:server-privilege? @connection)
                        {:origin :uplink}
                        {:origin :client})))

          outstanding-incoming-call-ids (atom #{})

          {:keys [get-pending-response is-closed? send-close-errors! send-request! handle-response! handle-update! is-idle?]}
          (ws-server/setup-request-handlers WS-SERVER-PARAMS channel)

          disconnect-on-idle? (atom false)
          maybe-disconnect-if-idle! (fn []
                                     (when (and @disconnect-on-idle? (is-idle?) (empty? outstanding-incoming-call-ids))
                                       (close channel)))
          disconnect-on-idle! (fn []
                                (reset! disconnect-on-idle? true)
                                (maybe-disconnect-if-idle!))

          default-session-state (sessions/new-session {})
          ;; call-stack-ids aren't trusted (they're user supplied), but we need stable thread-ids for uplink-originated
          ;; calls (for transactions etc) - so we generate them for outbound calls by prefixing
          ;; the user-supplied string with a string unique to this session:
          thread-id-prefix (str "uplink-outbound-" (random/base64 18) "-")
          internal-error (atom nil)
          connection-cookie (atom nil)]

      (metrics/set! :api/runtime-connected-uplinks-total (swap! connected-uplink-count inc))

      (on-close channel
                (fn [why]
                  (worker-pool/set-task-info! :websocket ::close)
                  (when-let [{:keys [app-info]} @connection]
                    (log/debug "Uplink websocket closed for app" (:id app-info) (pr-str why)))
                  (metrics/set! :api/runtime-connected-uplinks-total (swap! connected-uplink-count dec))

                  (clear-uplink-registrations! @connection-cookie @my-fn-registrations)

                  (send-close-errors! {:type    "anvil.server.UplinkDisconnectedError"
                                       :message (cond
                                                  @internal-error
                                                  (str "Uplink disconnected: " @internal-error)

                                                  (= why :message-too-big)
                                                  "Data payload too big - please use Media objects to transfer large amounts of data."

                                                  :else
                                                  "Uplink disconnected")})))

      (on-receive channel
                  (fn [json-or-binary]
                    (worker-pool/set-task-info! :websocket ::receive)
                    (when-not (is-closed?)
                      (log/trace "Uplink got data: " json-or-binary)
                      (try+
                        (if-not (string? json-or-binary)
                          (when @connection
                            (serialisation/processBlob @ds json-or-binary))

                          (let [raw-data (json/read-str json-or-binary :key-fn keyword)]
                            (cond
                              (not @connection)
                              (let [[app-info env priv] (get-app-info-environment-and-privileges-for-uplink-key (if (string? (:key raw-data)) (:key raw-data) ""))
                                    protocol-version (:v raw-data)]
                                (cond
                                  (not (and (number? protocol-version)
                                            (>= protocol-version 5)))
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
                                    (ws-util/tag-channel! channel {:app-info app-info, :environment env, :app-session default-session-state})
                                    (reset! connection {:app-info app-info,
                                                        :protocol-version protocol-version,
                                                        :environment env,
                                                        :app-origin (app-data/get-default-app-origin env),
                                                        :server-privilege? (= priv :uplink)})
                                    (reset! default-session-state
                                            {:client (runtime-util/client-info-from-request (if (= :uplink priv) :uplink :client_uplink)
                                                                                            request)
                                             :app-id (:id app-info)
                                             :environment env})
                                    (send! channel (util/write-json-str {:auth     "OK"
                                                                         :priv     priv
                                                                         :app-info (runtime-util/get-runtime-app-info env)}))

                                    (when (< protocol-version 7)
                                      (send! channel "{\"output\": \"You are using a deprecated version of the Anvil Uplink. Upgrade for bug-fixes and new features by typing 'pip install --upgrade anvil-uplink'\"}"))

                                    (log/debug "Uplink connected for app" (:id app-info) " environment " env)
                                    (reset! connection-cookie (on-uplink-connect (assoc @connection
                                                                                   :send-request! send-request!
                                                                                   ::ws-server/send-raw! #(send! channel %)
                                                                                   ::disconnect-on-idle! disconnect-on-idle!))))))

                              (= (:type raw-data) "REGISTER")
                              (if-not (:server-privilege? @connection)
                                (do
                                  (send! channel "{\"error\": \"Cannot register @anvil.server.callable functions from an unprivileged (client) uplink.\"}")
                                  (log/debug "Closing uplink channel: Client uplink attempted to register a function")
                                  (close channel))
                                (try
                                  (log/debug "Server function registered:" (:name raw-data))

                                  (swap! my-fn-registrations conj (set-uplink-handler! @connection-cookie (:name raw-data)))
                                  (catch PatternSyntaxException _e
                                    (send! channel "{\"error\": \"Invalid function name specification\"}")
                                    (log/debug "Closing uplink channel: Invalid function spec")
                                    (close channel))))

                              (= (:type raw-data) "REGISTER_LIVE_OBJECT_BACKEND")
                              (do
                                (send! channel "{\"error\": \"Cannot register live-object backends the uplink.\"}")
                                (log/debug "Closing uplink channel: Uplink attempted to register a LiveObject backend")
                                (close channel))


                              (= (:type raw-data) "CHUNK_HEADER")
                              (serialisation/processBlobHeader @ds raw-data)

                              ;; Command (request from uplink, ie remote-initiated RPC)
                              (= (:type raw-data) "CALL")
                              (let [call-id (:id raw-data)
                                    call-stack-id (:call-stack-id raw-data)
                                    pending-response (get-pending-response call-stack-id)
                                    context (or (:context pending-response)
                                                (ws-calls/new-call-context :uplink-call (:app-info @connection) (:environment @connection) nil default-session-state))
                                    call-stack-info (STACK-FRAME-INFO (:server-privilege? @connection))
                                    return-path {:update!  #(send! channel (util/write-json-str (assoc % :id call-id)))
                                                 :respond! #(do (serialisation/serialise-to-websocket! (assoc % :id call-id) channel true nil)
                                                                (swap! outstanding-incoming-call-ids disj call-id)
                                                                (maybe-disconnect-if-idle!))}
                                    request (serialisation/deserialise @ds raw-data)]
                                (swap! outstanding-incoming-call-ids conj call-id)
                                (dispatch-uplink-call! @connection-cookie context call-stack-info
                                                       ;; If this is a call stack id we haven't heard of, it's a new call - we use our quotas and the user-supplied thread ID
                                                       (when-not pending-response
                                                         {:use-quota? true
                                                          :thread-id (str thread-id-prefix call-stack-id)})
                                                       (serialisation/getConfig @ds) request return-path))

                              ;; Response from uplink
                              (or (contains? raw-data :response) (contains? raw-data :error))
                              (when (:server-privilege? @connection) ;; Defensive belt-and-braces
                                (handle-response! (serialisation/deserialise @ds raw-data))
                                (maybe-disconnect-if-idle!))

                              (contains? raw-data :output)
                              (when (:server-privilege? @connection) ;; Belt and braces
                                (handle-update! raw-data)))))

                        (catch :anvil/server-error e
                          (send! channel (util/write-json-str {:error (:anvil/server-error e)}))
                          (log/warn "Closing uplink channel:" (:anvil/server-error e))
                          (close channel))
                        (catch Exception e
                          (let [error-id (random/hex 6)]
                            (log/error e "Error processing message from uplink. Internal server error:" error-id)
                            (reset! internal-error error-id))
                          (close channel)))))))))