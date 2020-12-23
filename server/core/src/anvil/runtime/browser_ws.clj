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
            [anvil.runtime.ws-util :as ws-util]))

(defn ws-handler [{:keys [app-id app-session environment] :as request} app-yaml]
  (ws-util/with-opening-channel request channel on-open

    (let [session-liveobject-secret (-> (swap! app-session
                                               (fn [x] (if-not (:liveobject-secret x)
                                                         (assoc x :liveobject-secret (random/base64 128))
                                                         x)))
                                        (:liveobject-secret))

          ds (serialisation/mk-Deserialiser :session-liveobject-key session-liveobject-secret)

          serial-responder (fn [request-id]
                             #(serialisation/serialise-to-websocket! (assoc % :id request-id) channel true session-liveobject-secret true))]

      (log/debug "Client websocket connected for session" (:id @app-session))
      (swap! app-session (fn [x] (assoc x ::runtime-ws channel)))

      (on-close channel
                (fn [why]
                  (worker-pool/set-task-info! :websocket ::close)
                  (log/debug "Client websocket closed: " (:id @app-session) (pr-str why))
                  ;; A websocket closing constitutes 'activity' on this session,
                  ;; so reset its expiry countdown.
                  (touch-session! app-session)
                  (swap! app-session (fn [x] (dissoc x ::runtime-ws)))))

      (on-receive channel
                  (fn [json-or-binary]
                    (worker-pool/set-task-info! :websocket ::receive)
                    (log/trace "Got websocket data from client: " json-or-binary)
                    (touch-session! app-session)
                    (try

                      (if-not (string? json-or-binary)
                        (serialisation/processBlob ds json-or-binary)
                        (let [{:keys [type] :as data} (json/read-str json-or-binary :key-fn keyword)]
                          (cond
                            (= type "CHUNK_HEADER")
                            (serialisation/processBlobHeader ds data)

                            (= type "CALL")
                            (let [request-template {:app           app-yaml
                                                    :app-id        (:app-id request)
                                                    :environment   environment
                                                    :app-origin    (:app-origin request)
                                                    :origin        :client
                                                    :session-state app-session
                                                    :use-quota?    true
                                                    :call-stack    (list {:type :browser})}
                                  d (serialisation/deserialise ds data request-template)
                                  responder (serial-responder (:id d))
                                  return-path {:respond!
                                               responder
                                               :update!
                                               (fn [{:keys [output] :as r}]
                                                 (when (string? output)
                                                   (app-log/record! request "print"
                                                                    [{:t (System/currentTimeMillis) :s output}]))
                                                 (responder r))}]

                              (log/trace "Calling with replacement session?" (:anvil.runtime/replacement-session @app-session))
                              (try+
                                (if (= (:command d) "anvil.private.reset_session")
                                  (do
                                    (swap! app-session assoc :anvil.runtime/replacement-session false)
                                    (reload-anvil-cookies! app-session request)
                                    (responder {:response (:id @app-session)}))
                                  (if (:anvil.runtime/replacement-session @app-session)
                                    (responder {:error {:type    "anvil.server.SessionExpiredError"
                                                        :message "Session expired"
                                                        :trace   [["<rpc>", 0]]}})
                                    (dispatcher/dispatch! (assoc request-template
                                                            :call (assoc (select-keys d [:args :kwargs :vt_global])
                                                                    :func (or (:command d) (:method (:liveObjectCall d)))
                                                                    :live-object (serialisation/loadLiveObject ds (:liveObjectCall d))))
                                                          return-path)))

                                ;; Don't catch :anvil/server-error here, as dispatch functions should do that themselves
                                ;; and respond appropriately.

                                (catch Exception e
                                  (let [error-id (random/hex 6)]
                                    (log/error e "Error in function dispatch for '" (:command d) "/" (:method (:liveObjectCall d)) "':" error-id)
                                    (responder {:error {:message (str "Internal server error: " error-id)}})))))

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

      (reset! on-open (fn []
                        (swap! app-session assoc :default-return-path
                               {:update!  #(try (send! channel (util/write-json-str %)) (catch Exception _e))
                                :respond! (fn [_] (throw+ {:anvil/server-error "Cannot send a call result down the default return path"}))}))))))
