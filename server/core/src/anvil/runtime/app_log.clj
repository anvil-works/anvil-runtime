(ns anvil.runtime.app-log
  (:require [clojure.tools.logging :as log]
            [anvil.util :as util]))

(defonce record-raw! (fn [session-id app-id type data debug?]
                       (log/info type data)))

(defonce record! (fn record!
                   ([request-ctx type data] (record! request-ctx type data true))
                   ([{:keys [app-session app-id app-version anvil-debug]
                      :as   _request-ctx} type data trust-sess?]
                    (log/info type data))))

(def set-log-impl! (util/hook-setter #{record! record-raw!}))

