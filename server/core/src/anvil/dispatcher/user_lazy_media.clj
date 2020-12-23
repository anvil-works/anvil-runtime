(ns anvil.dispatcher.user-lazy-media
  (:use [slingshot.slingshot :only [throw+ try+]])
  (:require [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [clojure.data.json :as json]
            [anvil.dispatcher.native-rpc-handlers.util :as nrpc-util]
            [anvil.dispatcher.core :as dispatcher]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.types :as types])
  (:import (anvil.dispatcher.types Media SerialisableForRpc ChunkedStream)))

(defn serve-lazy-media [media-id]
  (let [[func args kwargs] (json/read-str media-id)
        trigger (promise)
        return-path (-> (or (:default-return-path @nrpc-util/*session-state*)
                            {:update! (constantly nil) :respond! (constantly nil)})
                        (assoc :respond! #(do (log/trace "Response:" %) (deliver trigger %))))]

    (log/trace "Dispatching call")
    (dispatcher/dispatch! {:call          {:func func, :args (or args []), :kwargs (or kwargs {})},
                           :app           nrpc-util/*app*, :app-id nrpc-util/*app-id*, :app-origin nrpc-util/*app-origin*
                           :environment nrpc-util/*environment*
                           :session-state nrpc-util/*session-state*
                           :use-quota? true}
                          return-path)

    (log/trace "Going to sleep")
    (let [{:keys [response error]} @trigger]
      (cond
        (= (:type error) "RateLimitExceeded")
        (do
          (log/trace "User-defined LazyMedia exceeded rate:" error)
          (throw+ {:lm/rate-limited (:message error)}))

        (nil? response)
        (do
          (log/trace "User-defined LazyMedia returned error:" @trigger)
          (dispatcher/update! return-path {:error error})
          (throw+ {:anvil/server-error (or (:message error) (str "Server function '" func "' raised an error"))}))

        (instance? Media response)
        (if-not (and (instance? SerialisableForRpc response)
                     (= "py" (:manager (.serialiseForRpc ^SerialisableForRpc response nil))))
          response
          (do
            (log/trace "User-defined LazyMedia returned another LazyMedia")
            (dispatcher/update! return-path {:error {:type "anvil.server.InvalidResponseError", :message (str "LazyMedia: Server function '" func "' did not return a Media object")}})
            (throw+ {:anvil/server-error (str "Server function '" func "' did not return Media data; cannot download")})))

        (instance? ChunkedStream response)
        (types/ChunkedStream->Media response)

        :else
        (do
          (log/trace "User-defined LazyMedia did not return a Media object; instead returned: " (pr-str response))
          (throw+ {:anvil/server-error (str "Server function '" func "' did not return a Media object; cannot download")}))))))

(swap! lazy-media/managers assoc "py" (nrpc-util/wrap-lazy-media-server serve-lazy-media))
