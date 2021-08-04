(ns anvil.core.cache
  (:import (clojure.lang IDeref)))

;; core.cache doesn't do quite what we want here
;; To avoid the thundering herd, we want cache fills to be single-threaded (with any other readers waiting)

(defprotocol Cache
  (lookup [this key get-value] "Returns the value in the cache for 'key' if present. If not, calls (get-value)")
  (clear! [this] "Clears this cache"))

(deftype TTLCache [ttl sweep-interval state last-swept]
  Cache
  (lookup [this key get-value]
    (let [now (System/currentTimeMillis)
          {:keys [lookup computed-at]} (get @state key)
          {:keys [value error]} (some-> lookup deref)]
      (when (< (+ @last-swept sweep-interval) now)
        (reset! last-swept now)
        (swap! state #(into {}
                            (for [[k v] %
                                  :when (> (+ (:computed-at v) ttl) now)]
                              [k v]))))

      (if-not (or (not lookup) error (< (+ computed-at ttl) now))
        value
        (let [my-lookup (promise)
              new-state (swap! state #(if (or (not (get % key))
                                              (= (get-in % [key :computed-at]) computed-at))
                                        (assoc % key {:computed-at now :lookup my-lookup})
                                        %))
              lookup (get-in new-state [key :lookup])]
          (when (identical? lookup my-lookup)
            (deliver my-lookup
                     (try
                       {:value (get-value)}
                       (catch Throwable t {:error t}))))
          (if-let [err (:error @lookup)]
            (throw err)
            (:value @lookup))))))
  (clear! [this] (reset! state {}) nil)
  IDeref
  (deref [this] @state))

(defn mk-ttl-cache [ttl sweep-interval]
  (->TTLCache ttl sweep-interval (atom {}) (atom (System/currentTimeMillis))))
