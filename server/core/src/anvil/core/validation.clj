(ns anvil.core.validation
  (:require
    [clj-commons.slingshot :refer :all]))

(defn- do-check-keys [check-map map keyseq]
  (doseq [k (keys map)]
    (when-not (contains? check-map k)
      (throw+ {::validation-failed (format "Disallowed key '%s'" (name k))
               ::path (reverse (cons k keyseq))})))
  (doseq [[k check-fn] check-map
          :when (contains? map k)
          :let [v (get map k)]]
    (cond
      (map? check-fn)
      (do-check-keys check-fn v (cons k keyseq))

      (vector? check-fn)
      (doall (map-indexed (fn [idx elt] (do-check-keys (first check-fn) elt (cons idx keyseq))) v))

      :else
      (when-not (or (nil? v) (check-fn v))
        (throw+ {::validation-failed (format "Invalid value for '%s': %s" (name k) (pr-str (get map k)))
                 ::check-fn          check-fn
                 ::path (reverse (cons k keyseq))})))))

(defn check-keys! [check-map map]
  (do-check-keys check-map map '()))

(defn string-with-max-length [n]
  (fn [s]
    (and (string? s) (<= (.length ^String s) n))))
