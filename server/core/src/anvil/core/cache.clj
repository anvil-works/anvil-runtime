(ns anvil.core.cache
  (:require [clojure.set :as set]
            [clojure.tools.logging :as log]
            [anvil.core.worker-pool :as worker-pool])
  (:import (clojure.lang IDeref)))

;; core.cache doesn't do quite what we want here.
;; To avoid the thundering herd, we want cache fills to be single-threaded (with any other readers waiting)
;; clojure.core.cache has not only thundering-herd but *also* data-losing race conditions!
;; Please consult Meredydd before using clojure.core.cache in any new code, so that he can beat you over a head with
;; an inflatable banana until you change your mind.

(defprotocol Cache
  (lookup [this key get-value] "Returns the value in the cache for 'key', if present. If not, calls (get-value)")
  (evict! [this key] "Removes the value for 'key' from the cache, if present")
  (clear! [this] "Clears this cache"))

(deftype TTLCache [ttl sweep-interval on-evict lookup-test state last-swept]
  Cache
  (lookup [this key get-value]
    (let [now (System/currentTimeMillis)
          {:keys [lookup computed-at]} (get @state key)
          {:keys [value error] :as lookup-val} (some-> lookup deref)
          value-is-valid? (delay (or (not lookup-test)
                                     (and (contains? lookup-val :value)
                                          (lookup-test value))))]
      (when (< (+ @last-swept sweep-interval) now)
        (reset! last-swept now)
        (let [[old-state swept-state] (swap-vals! state #(into {}
                                                               (for [[k v] %
                                                                     :when (> (+ (:computed-at v) ttl) now)]
                                                                 [k v])))]
          (when on-evict
            (let [removed-keys (set/difference (set (keys old-state)) (set (keys swept-state)))
                  removed-values (->> removed-keys
                                      (map #(some-> (get old-state %) :lookup deref))
                                      (filter #(contains? % :value))
                                      (map :value))]
              (doseq [v removed-values]
                (try
                  (on-evict v)
                  (catch Throwable e
                    (log/error e "Error in cache eviction callback for value:" (pr-str v)))))))))

      (if-not (or (not lookup) error (< (+ computed-at ttl) now) (not @value-is-valid?))
        value
        (let [my-lookup (promise)
              [old-state new-state] (swap-vals! state #(if (or (not (get % key))
                                                               (= (get-in % [key :computed-at]) computed-at))
                                                         (assoc % key {:computed-at now :lookup my-lookup})
                                                         %))
              lookup (get-in new-state [key :lookup])]

          (when (identical? lookup my-lookup)
            (let [old-lookup (some-> (get old-state key) :lookup deref)
                  new-lookup (try
                               {:value (get-value)}
                               (catch Throwable t {:error t}))]

              ;; If we have overwritten a value in the cache, make sure we call on-evict on the old value.
              (when (and on-evict
                         (contains? old-lookup :value)
                         (not= new-lookup old-lookup))
                (on-evict (:value old-lookup)))

              (deliver my-lookup new-lookup)))

          (if-let [err (:error @lookup)]
            (throw err)
            (:value @lookup))))))
  (evict! [this key]
    (let [[old-state _new-state] (swap-vals! state dissoc key)]
      (when on-evict
        (let [lookup-val (some-> old-state (get key) :lookup deref)]
          (when (contains? lookup-val :value)
            (on-evict (:value lookup-val)))))))
  (clear! [this] (reset! state {}) nil)
  IDeref
  (deref [this] @state))

(defn mk-ttl-cache
  ([ttl sweep-interval] (mk-ttl-cache ttl sweep-interval nil nil))
  ([ttl sweep-interval on-evict lookup-test]
   (->TTLCache ttl sweep-interval on-evict lookup-test (atom {}) (atom (System/currentTimeMillis)))))

(defmacro defn-with-ttl-memoization [func args ttl & body]
  `(def ~func
     (let [cache# (mk-ttl-cache ~ttl 30000)]
       (fn ~args
         (lookup cache# ~args (fn [] ~@body))))))

(deftype StaleWhileRevalidateCache [revalidate-after drop-after sweep-interval task-name state last-swept]
  Cache
  (lookup [this key get-value]
    ;; Do we need to sweep?
    (let [now (System/currentTimeMillis)]
      (when (and (< (+ @last-swept sweep-interval) now)
                 (= (swap! last-swept #(if (< (+ % sweep-interval) now) now %))
                    now))
        (swap! state #(into {} (for [[k {:keys [last-updated] :as v}] %
                                     :when (and last-updated (> last-updated (- now drop-after)))]
                                 [k v]))))

      (let [{:keys [last-updated value updating?]} (get @state key)
            age (when last-updated (- now last-updated))
            needs-revalidating? (or (nil? age) (> age revalidate-after))
            launch-revalidation? (when needs-revalidating?
                                   (let [[old-s new-s] (swap-vals! state assoc-in [key :updating?] true)]
                                     (not (get-in old-s [key :updating?]))))]
        (when launch-revalidation?
          (worker-pool/run-task! ::refill
            (worker-pool/set-task-info! "task" task-name)
            (try
              (let [value (get-value)]
                (swap! state assoc key {:value value :last-updated (System/currentTimeMillis)}))
              (catch Throwable t
                (swap! state assoc-in [key :updating?] false)
                (throw t)))))

        (when (and age (< age drop-after))
          value))))
  (evict! [this key]
    (swap! state dissoc key)
    nil)
  (clear! [this]
    (reset! state {})
    nil)
  IDeref
  (deref [this] @state))

(defn mk-stale-while-revalidate-cache [revalidate-after drop-after sweep-interval task-name]
  (->StaleWhileRevalidateCache revalidate-after drop-after sweep-interval task-name (atom {}) (atom (System/currentTimeMillis))))
