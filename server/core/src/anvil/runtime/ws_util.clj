(ns anvil.runtime.ws-util
  (:require [anvil.util :as util])
  (:import (org.httpkit.server AsyncChannel)))


(defonce tag-channel! (fn [channel request]))               ;; Used for bookkeeping
(def set-ws-hooks! (util/hook-setter #{tag-channel!}))

(defmacro with-opening-channel
  "Similar to org.httpkit.server/with-channel, except body executes before
  the WebSocket handshake is done, ensuring that the on-receive handler is
  registered before we can possibly receive anything. On the other hand, we
  can't call send! directly in the body."
  [request ch-name on-open & body]
  `(let [~ch-name (:async-channel ~request)
         ~on-open (atom (fn []))]
     (tag-channel! ~ch-name ~request)
     (if (:websocket? ~request)
       (if-let [key# (get-in ~request [:headers "sec-websocket-key"])]
         (do ~@body
             (.sendHandshake ~(with-meta ch-name {:tag `AsyncChannel})
                             {"Upgrade"    "websocket"
                              "Connection" "Upgrade"
                              "Sec-WebSocket-Accept" (org.httpkit.server/accept key#)})
             (@~on-open)
             {:body ~ch-name})
         {:status 400 :body "Bad Sec-WebSocket-Key header"})
       (do ~@body
           {:body ~ch-name}))))
