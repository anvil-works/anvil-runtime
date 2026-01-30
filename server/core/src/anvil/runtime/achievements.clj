(ns anvil.runtime.achievements
  (:require [anvil.util :as util]))

(defonce claim-runtime-achievement (fn [session-state achievement-id] ))

(def set-achievements-impl! (util/hook-setter #{claim-runtime-achievement}))