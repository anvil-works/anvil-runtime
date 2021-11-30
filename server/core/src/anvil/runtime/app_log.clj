(ns anvil.runtime.app-log
  (:require [clojure.tools.logging :as log]
            [anvil.util :as util]))

(defn log-data-from-ring-request [{:keys [remote-addr] :as req}]
  (merge {}
         (when remote-addr
           {:addr     remote-addr
            :location (util/get-ip-location remote-addr)})))

(defonce record-session! (fn [session log-data]))

(defonce record-event! (fn [session trace-id type log-text data]
                         nil))

(defonce record-trace! (fn [session trace-id task-name]))

(def set-log-impl! (util/hook-setter #{record-session! record-event! record-trace!}))

