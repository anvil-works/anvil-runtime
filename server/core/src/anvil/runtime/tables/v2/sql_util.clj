(ns anvil.runtime.tables.v2.sql-util
  (:require [clojure.string :as str]))

(defn JSONB-BUILD-OBJECT [kv-pairs]
  ;; We can only pass 100 arguments to jsonb_build_object, so we partition the colspecs and join the resulting objects together
  (str "(" (->> (for [param-group (if (not-empty kv-pairs) (partition-all 50 kv-pairs) [[]])]
                  (str "jsonb_build_object(" (str/join ", " param-group) ")"))
                (str/join " || "))
       ")"))
