(ns anvil.runtime.quota
  (:require [anvil.util :as util]))

;; Stubs for quota enforcement

(defn decrement! [session-state environment bucket tokens-required])

(defn decrement-if-possible! [session-state environment bucket tokens-required] true)

(def set-quota-impl! (util/hook-setter #{decrement! decrement-if-possible!}))

