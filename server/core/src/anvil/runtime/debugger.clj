(ns anvil.runtime.debugger
  (:require [anvil.util :as util]))

(defonce handle-debugger-update! (fn [environment client-info debugger-update send-upstream!] nil))

(def set-debugger-hooks! (util/hook-setter [handle-debugger-update!]))
