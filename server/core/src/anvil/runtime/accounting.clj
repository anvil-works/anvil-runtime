(ns anvil.runtime.accounting
  (:require [anvil.util :as util]))

(defonce record-platform-server-use! (fn [session platform-seconds]))

(defonce read-account (fn [value]))

(def set-accounting-impl! (util/hook-setter #{record-platform-server-use! read-account}))
