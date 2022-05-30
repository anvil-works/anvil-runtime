(ns anvil.runtime.quota
  (:require [anvil.util :as util]))

;; Stubs for quota enforcement

(defonce decrement! (fn [session-state environment db-txn bucket tokens-required]))

(defonce decrement-if-possible! (fn [session-state environment db-txn bucket tokens-required] true))

;; Wrappers for a slightly more abstracted API
(defn decrement-c! [{:keys [session-state environment] :as ctx} db-txn bucket tokens-required]
  (decrement! session-state environment db-txn bucket tokens-required))

(defn decrement-if-possible-c! [{:keys [session-state environment] :as ctx} db-txn bucket tokens-required]
  (decrement-if-possible! session-state environment db-txn bucket tokens-required))

(def set-quota-impl! (util/hook-setter #{decrement! decrement-if-possible!}))

