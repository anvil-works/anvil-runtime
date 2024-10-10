(ns anvil.dispatcher.native-rpc-handlers.pdf
  (:use [slingshot.slingshot])
  (:require [anvil.dispatcher.core :as dispatcher]
            [crypto.random :as random]
            [anvil.util :as util]
            [anvil.runtime.app-data :as app-data]
            [clojure.tools.logging :as log]
            [anvil.runtime.sessions :as sessions]
            [anvil.executors.downlink :as downlink]))

(clj-logging-config.log4j/set-logger! :level :info)

(defonce get-pdf-renderer (constantly nil))

(defonce get-pdf-render-timeout (fn [_app-id] 30))

(def set-pdf-impl! (util/hook-setter #{get-pdf-renderer get-pdf-render-timeout}))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.pdf.do_print"      {:fn (fn [{:keys [session-state] :as req} return-path]
                                                 ;; A downlink is holding components to print in RAM.
                                                 ;; Set up a return path so that when the renderer opens the print
                                                 ;; page, it will fetch components from that same downlink,
                                                 ;; then pass the request to the renderer
                                                 (dispatcher/report-exceptions-to-return-path return-path
                                                   (when-not (= :server_module (:type (first (:call-stack req))))
                                                     (throw+ {:anvil/server-error "Permission denied to private function"}))

                                                   (let [downlink-spec (:anvil.executors.downlink/same-downlink-spec req)
                                                         ;; Even within a session, the client shouldn't be able to guess a print key (the PDF's contents might be secret), so
                                                         print-id (random/base32 16)
                                                         print-key (random/base32 32)
                                                         tmp-url-token (sessions/generate-tmp-url-token! session-state)
                                                         new-return-path {:respond! #(do
                                                                                       (swap! (:session-state req) update-in [:print-sessions] dissoc print-id)
                                                                                       (sessions/clear-temporary-url-token! session-state tmp-url-token)
                                                                                       (sessions/notify-session-update! (:session-state req))
                                                                                       (dispatcher/respond! return-path %))
                                                                          :update!  #(dispatcher/update! return-path %)}]

                                                     (when-not downlink-spec
                                                       (throw+ {:anvil/server-error "No executor return trace available: Probably called from wrong environment"}))

                                                     (swap! session-state
                                                            assoc-in [:print-sessions print-id]
                                                            {:key print-key :downlink downlink-spec, :ref (first (:args (:call req)))})
                                                     (sessions/notify-session-update! session-state)

                                                     (dispatcher/report-exceptions-to-return-path new-return-path
                                                       ;; The downlink calls do_print(ref); the renderer gets do_print(url)
                                                       (let [origin (or (:app-origin req)
                                                                        (app-data/get-app-origin (:environment req))
                                                                        (throw+ {:anvil/server-error "Cannot render a PDF in an environment with no URL"}))
                                                             url (str origin "/_/print/" print-id "/" print-key "?_anvil_session=" tmp-url-token)
                                                             options (second (:args (:call req)))
                                                             load-timeout (get-pdf-render-timeout (:app-id req))
                                                             req (assoc-in req [:call :args] [url options load-timeout])]
                                                         (log/trace "URL for PDF renderer in session" (sessions/get-id (:session-state req)) " :" url)
                                                         (if-let [executor (get-pdf-renderer (:app-id req) (:session-state req))]
                                                           ((:fn executor) req new-return-path)
                                                           (throw+ {:anvil/server-error "PDF rendering service not available"})))))))}

        "anvil.private.pdf.get_component" {:fn (fn [{:keys                        [session-state]
                                                     {[print-id print-key] :args} :call
                                                     :as                          req} return-path]
                                                 (dispatcher/report-exceptions-to-return-path return-path
                                                   ;; We're being called from the renderer's browser, and we want to steer this
                                                   ;; request back to the downlink that's triggering this render.
                                                   (log/trace "Retrieving print session from" (get @session-state :print-sessions) "for session id" (sessions/get-id session-state))
                                                   (if-let [[downlink ref] (when-let [{:keys [key downlink ref]} (get-in @session-state [:print-sessions print-id])]
                                                                             (when (= (util/sha-256 key) (util/sha-256 print-key))
                                                                               [downlink ref]))]
                                                     ((:fn (downlink/get-downlink-executor downlink)) (assoc-in req [:call :args] [ref]) return-path)

                                                     (throw+ {:anvil/server-error "Invalid print session"}))))}})