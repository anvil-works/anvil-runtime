(ns anvil.dispatcher.native-rpc-handlers.pdf
  (:use [slingshot.slingshot])
  (:require [anvil.dispatcher.core :as dispatcher]
            [crypto.random :as random]
            [anvil.util :as util]
            [anvil.runtime.util :as runtime-util]
            [anvil.runtime.app-data :as app-data]))

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

                                                   (let [same-server-executor (:anvil.dispatcher/same-server-executor req)
                                                         ;; Even within a session, the client shouldn't be able to guess a print key (the PDF's contents might be secret), so
                                                         print-id (random/base32 16)
                                                         print-key (random/base32 32)
                                                         tmp-url-token (runtime-util/generate-tmp-url-token! session-state)
                                                         new-return-path {:respond! #(do
                                                                                       (swap! (:session-state req) update-in [:print-sessions] dissoc print-id)
                                                                                       (runtime-util/clear-temporary-url-token! session-state tmp-url-token)
                                                                                       (dispatcher/respond! return-path %))
                                                                          :update!  #(dispatcher/update! return-path %)}]

                                                     (when-not same-server-executor
                                                       (throw+ {:anvil/server-error "No executor return trace available: Probably called from wrong environment"}))

                                                     (swap! session-state
                                                            assoc-in [:print-sessions print-id]
                                                            {:key print-key :executor same-server-executor, :ref (first (:args (:call req)))})


                                                     (dispatcher/report-exceptions-to-return-path new-return-path
                                                       ;; The downlink calls do_print(ref); the renderer gets do_print(url)
                                                       (let [origin (or (:app-origin req)
                                                                        (app-data/get-default-app-origin (:environment req)))
                                                             url (str origin "/_/print/" print-id "/" print-key "?s=" tmp-url-token)
                                                             options (second (:args (:call req)))
                                                             load-timeout (get-pdf-render-timeout (:app-id req))
                                                             req (assoc-in req [:call :args] [url options load-timeout])]
                                                         (if-let [executor (get-pdf-renderer (:app-id req) (:session-state req))]
                                                           ((:fn executor) req new-return-path)
                                                           (throw+ {:anvil/server-error "PDF rendering service not available"})))))))}

        "anvil.private.pdf.get_component" {:fn (fn [{:keys                        [session-state]
                                                     {[print-id print-key] :args} :call
                                                     :as                          req} return-path]
                                                 (dispatcher/report-exceptions-to-return-path
                                                   ;; We're being called from the renderer's browser, and we want to steer this
                                                   ;; request back to the downlink that's triggering this render.
                                                   (if-let [[executor ref] (when-let [{:keys [key executor ref]} (get-in @session-state [:print-sessions print-id])]
                                                                             (when (= (util/sha-256 key) (util/sha-256 print-key))
                                                                               [executor ref]))]
                                                     ((:fn executor) (assoc-in req [:call :args] [ref]) return-path)

                                                     (throw+ {:anvil/server-error "Invalid print session"}))))}})