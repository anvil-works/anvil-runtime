(ns anvil.runtime.browser-ws
  (:use [org.httpkit.server]
        [slingshot.slingshot :only [throw+ try+]]
        [anvil.runtime.util])
  (:require [clojure.tools.logging :as log]
            [clojure.data.json :as json]
            [crypto.random :as random]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.serialisation.core :as serialisation]
            [anvil.util :as util]
            [anvil.runtime.app-log :as app-log]
            [anvil.metrics :as metrics]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.runtime.ws-util :as ws-util]
            [anvil.runtime.sessions :as sessions]
            [anvil.core.tracing :as tracing]))

;; Hookable functions

(defonce on-client-connect (fn [connection] nil))
(defonce on-client-disconnect (fn [connection] nil))
(defonce share-server-logs-with-client? (fn [environment] false))

(def set-browser-ws-hooks! (util/hook-setter [on-client-connect on-client-disconnect share-server-logs-with-client?]))

(defonce connected-client-count (atom 0))

(defn process-log-data [data {:keys [app-session] :as request}]
  (try
    (sessions/resolve-ambiguous-client-type! app-session "browser") ;; Just in case this is a replacement session that hasn't been logged yet.
    (cond
      (:error data)
      (do (metrics/inc! :api/runtime-errors-total)
          (app-log/record-event! app-session nil "client_err" (str (:type (:error data)) ": " (:message (:error data))) (:error data)))

      (:warning data)
      (app-log/record-event! app-session nil "client_warning" nil (:warning data))

      :else
      (app-log/record-event! app-session nil "client_print" (:print data) nil))
    (catch Exception e
      (log/error e))))


(defn ws-handler [{:keys [app-id app-session environment app-origin] :as request} app-yaml]

  (ws-util/with-opening-channel request channel on-open

    (let [session-liveobject-secret (-> (swap! app-session
                                               (fn [x] (if-not (:liveobject-secret x)
                                                         (assoc x :liveobject-secret (random/base64 128))
                                                         x)))
                                        (:liveobject-secret))

          ds (serialisation/mk-Deserialiser {:origin :client, :session-liveobject-key session-liveobject-secret})

          outstanding-incoming-request-ids (atom {})

          disconnect-on-idle? (atom false)
          maybe-disconnect-if-idle! (fn []
                                      (when (and @disconnect-on-idle? (empty? @outstanding-incoming-request-ids))
                                        (close channel)))
          disconnect-on-idle! (fn []
                                (reset! disconnect-on-idle? true)
                                (maybe-disconnect-if-idle!))

          connection {:environment environment
                      :app-info (:app-info @app-session)
                      ::disconnect-on-idle! disconnect-on-idle!
                      ::get-pending-responses (fn [] @outstanding-incoming-request-ids)}

          serial-responder (fn [request-id]
                             (fn [resp call-finished?]
                               (serialisation/serialise-to-websocket! (assoc resp :id request-id) channel true session-liveobject-secret)
                               (when call-finished?
                                 (swap! outstanding-incoming-request-ids dissoc request-id)
                                 (maybe-disconnect-if-idle!))))

          session-listener-registration (sessions/register-session-listener! app-session {:on-event! #(serialisation/serialise-to-websocket! {:id (str "evt" (random/base32 10)) :event %} channel true session-liveobject-secret)})]

      (log/debug "Client websocket connected for session" (:id @app-session))
      (on-client-connect connection)
      (metrics/set! :api/runtime-connected-clients-total (swap! connected-client-count inc))

      (on-close channel
                (fn [why]
                  (worker-pool/set-task-info! :websocket ::close)
                  (on-client-disconnect connection)
                  (metrics/set! :api/runtime-connected-clients-total (swap! connected-client-count dec))
                  (sessions/unregister-session-listener! app-session session-listener-registration)
                  (log/debug "Client websocket closed: " (:id @app-session) (pr-str why))
                  ;; TODO: A websocket closing constitutes 'activity' on this session, so reset its expiry countdown.
                  ))

      (on-receive channel
                  (fn [json-or-binary]
                    (worker-pool/set-task-info! :websocket ::receive)
                    (log/trace "Got websocket data from client: " json-or-binary)
                    (try

                      (if-not (string? json-or-binary)
                        (serialisation/processBlob ds json-or-binary)
                        (let [{:keys [type] :as data} (json/read-str json-or-binary :key-fn keyword)]
                          (cond
                            (= type "CHUNK_HEADER")
                            (serialisation/processBlobHeader ds data)

                            (= type "CALL")
                            (let [request-template {:app           app-yaml
                                                    :app-id        app-id
                                                    :environment   environment
                                                    :app-origin    app-origin
                                                    :origin        :client
                                                    :session-state app-session
                                                    :use-quota?    true
                                                    :call-stack    (list {:type :browser})}
                                  func (or (:command data) (:method (:liveObjectCall data)))
                                  request-id (:id data)
                                  responder (serial-responder request-id)
                                  ;; respond causes the dispatcher to return update doesn't (e.g. print output)
                                  return-path {:respond!
                                               #(responder % true)
                                               :update!
                                               (fn [{:keys [output] :as r}]
                                                 (if (string? output)
                                                   ;; TODO NEW TRACE API
                                                   (do
                                                     (app-log/record-event! app-session nil "print" output nil)
                                                     (when (share-server-logs-with-client? environment)
                                                       (responder r false)))
                                                   (responder r false)))}]
                              (swap! outstanding-incoming-request-ids assoc request-id {:context    {:func (or (:command data) (:method (:liveObjectCall data)))}
                                                                                        :start-time (System/currentTimeMillis)})
                              (log/trace "Calling with replacement session?" (:anvil.runtime/replacement-session @app-session))
                              (try+
                                (if (= (:command data) "anvil.private.reset_session")
                                  (do
                                    (swap! app-session assoc :anvil.runtime/replacement-session false)
                                    (reload-anvil-cookies! app-session request)
                                    (sessions/resolve-ambiguous-client-type! app-session "browser")
                                    (sessions/ensure-logged! app-session)
                                    (sessions/persist! app-session)
                                    (responder {:response (sessions/url-token app-session)}
                                               true))
                                  (if (and (:anvil.runtime/replacement-session @app-session)
                                           (not (.startsWith (str (:command data)) "anvil.record_schema.get/")))
                                    (do
                                      ;; Set the session type here, just in case something (like a log event) causes the replacement session to be logged.
                                      (sessions/resolve-ambiguous-client-type! app-session "browser")
                                      (responder {:error {:type    "anvil.server.SessionExpiredError"
                                                          :message "Session expired"
                                                          :trace   [["<rpc>", 0]]}}
                                                 true))
                                    (let [[deserialised-data live-object] (try+
                                                                            (let [deserialised-data (serialisation/deserialise ds data)
                                                                                  live-object (serialisation/loadLiveObject ds (:liveObjectCall deserialised-data))]
                                                                              [deserialised-data live-object])
                                                                            (catch :anvil/invalid-mac e
                                                                              (responder {:error {:type    "anvil.server.InvalidObjectError"
                                                                                                  :message "Error processing object from expired session"
                                                                                                  :trace   [["<rpc>", 0]]}}
                                                                                         true)))]
                                      ;; this does the server call
                                      (dispatcher/dispatch! (assoc request-template
                                                              :vt_global (:vt_global deserialised-data)
                                                              :call (assoc (select-keys deserialised-data [:args :kwargs])
                                                                      :func func
                                                                      :live-object live-object))
                                                            return-path))))

                                ;; Don't catch :anvil/server-error here, as dispatch functions should do that themselves
                                ;; and respond appropriately.
                                (catch Exception e
                                  (let [error-id (random/hex 6)]
                                    (log/error e "Error in function dispatch for '" (:command data) "/" (:method (:liveObjectCall data)) "':" error-id)
                                    (responder {:error {:message (str "Internal server error: " error-id)}}
                                               true)))))

                            (= type "LOG")
                            (process-log-data data request)


                            :else
                            (do
                              (log/warn "Client websocket got unknown message type" (pr-str type))
                              (close channel)))))


                      (catch Exception e
                        (log/error e "Error in client websocket handling")
                        (close channel)))))

      (reset! on-open (fn [] )))))
