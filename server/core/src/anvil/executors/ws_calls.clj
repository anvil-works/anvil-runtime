(ns anvil.executors.ws-calls
  (:use [slingshot.slingshot :only [throw+ try+]])
  (:require anvil.dispatcher.core
            [anvil.dispatcher.serialisation.core :as serialisation]
            [clojure.data.json :as json]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.core :as dispatcher]
            [org.httpkit.server :as ws]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [anvil.util :as util]))

(defn process-call-from-ws [channel deserialiser raw-data
                            {:keys [app-id app session-state environment app-origin thread-id origin call-stack use-quota?] :as req-template}
                            {:keys [extra-liveobject-key prune-liveobjects? update-bypass!] :as options}]
  (let [n-responses (atom 0)
        return-path {:respond!
                     (fn [response]
                       (when (= 1 (swap! n-responses inc))
                         (serialisation/serialise-to-websocket! (assoc response :id (:id raw-data)) channel true extra-liveobject-key prune-liveobjects?)))

                     :update!
                     (fn [obj]
                       (cond
                         (and (contains? obj :set-cookie) update-bypass!)
                         (update-bypass! obj)

                         :else
                         (ws/send! channel (util/write-json-str (assoc obj :id (:id raw-data))))))}

        data (serialisation/deserialise deserialiser raw-data req-template)]

    (log/debug "Received server call:" (:command data))
    (log/trace "Raw request:" (pr-str raw-data))
    (log/trace "Deserialised request:" (pr-str raw-data))

    (dispatcher/report-exceptions-to-return-path return-path
      (dispatcher/dispatch! (assoc req-template
                              :call {:func        (or (:method (:liveObjectCall data))
                                                      (:command data))
                                     :args        (:args data)
                                     :kwargs      (:kwargs data)
                                     :live-object (serialisation/loadLiveObject deserialiser (:liveObjectCall data))
                                     :vt_global   (:vt_global data)})
                            return-path))))

(defn process-response-from-ws [deserialiser request-ctx return-path raw-data]
  (let [data (serialisation/deserialise deserialiser raw-data request-ctx)]
    (log/debug "Responding to server call")
    (log/trace "Raw response:" (pr-str raw-data))
    (log/trace "Deserialised response:" (pr-str data))
    (dispatcher/respond! return-path data)))

(defn process-update-from-ws [return-path raw-data]
  ;; N.B. We do not deserialise output for now.
  (log/debug "Update from server call")
  (log/trace "Update:" (pr-str raw-data))
  (dispatcher/update! return-path raw-data))