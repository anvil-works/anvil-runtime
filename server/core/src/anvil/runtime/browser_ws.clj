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
            [anvil.runtime.sessions :as sessions]))

;; Hookable functions

(defonce on-client-connect (fn [connection] nil))
(defonce on-client-disconnect (fn [connection] nil))

(def set-browser-ws-hooks! (util/hook-setter [on-client-connect on-client-disconnect]))

(defonce connected-client-count (atom 0))

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
                                  d (serialisation/deserialise ds data)
                                  request-id (:id d)
                                  responder (serial-responder request-id)
                                  return-path {:respond!
                                               #(responder % true)
                                               :update!
                                               (fn [{:keys [output] :as r}]
                                                 (when (string? output)
                                                   (app-log/record! request "print"
                                                                    [{:t (System/currentTimeMillis) :s output}]))
                                                 (responder r false))}]
                              (swap! outstanding-incoming-request-ids assoc request-id {:context {:func (or (:command d) (:method (:liveObjectCall d)))}
                                                                                        :start-time (System/currentTimeMillis)})
                              (log/trace "Calling with replacement session?" (:anvil.runtime/replacement-session @app-session))
                              (try+
                                (if (= (:command d) "anvil.private.reset_session")
                                  (do
                                    (swap! app-session assoc :anvil.runtime/replacement-session false)
                                    (reload-anvil-cookies! app-session request)
                                    (responder {:response (:id @app-session)}
                                               true))
                                  (if (:anvil.runtime/replacement-session @app-session)
                                    (responder {:error {:type    "anvil.server.SessionExpiredError"
                                                        :message "Session expired"
                                                        :trace   [["<rpc>", 0]]}}
                                               true)
                                    (dispatcher/dispatch! (assoc request-template
                                                            :vt_global (:vt_global d)
                                                            :call (assoc (select-keys d [:args :kwargs])
                                                                    :func (or (:command d) (:method (:liveObjectCall d)))
                                                                    :live-object (serialisation/loadLiveObject ds (:liveObjectCall d))))
                                                          return-path)))

                                ;; Don't catch :anvil/server-error here, as dispatch functions should do that themselves
                                ;; and respond appropriately.

                                (catch Exception e
                                  (let [error-id (random/hex 6)]
                                    (log/error e "Error in function dispatch for '" (:command d) "/" (:method (:liveObjectCall d)) "':" error-id)
                                    (responder {:error {:message (str "Internal server error: " error-id)}}
                                               true)))))

                            (= type "LOG")
                            (try
                              (cond
                                (:error data)
                                (do (metrics/inc! :api/runtime-errors-total)
                                    (app-log/record! request "client_err" (:error data)))

                                (:warning data)
                                (app-log/record! request "client_warning" (:warning data))

                                :else
                                (app-log/record! request "client_print" (:print data)))
                              (catch Exception e
                                (log/error e)))

                            :else
                            (do
                              (log/warn "Client websocket got unknown message type" (pr-str type))
                              (close channel)))))


                      (catch Exception e
                        (log/error e "Error in client websocket handling")
                        (close channel)))))

      (reset! on-open (fn [] )))))
