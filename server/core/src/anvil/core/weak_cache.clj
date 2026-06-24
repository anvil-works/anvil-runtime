(ns anvil.core.weak-cache
  (:require [anvil.core.worker-pool :as worker-pool]
            [clojure.tools.logging :as log])
  (:import (java.lang.ref WeakReference ReferenceQueue SoftReference)))

;(clj-logging-config.log4j/set-logger! :level :trace)

;; Implement a self-clearing cache using SoftReferences.
;; To mitigate the thundering herd, we want cache fills to be single-threaded (with any other readers waiting),
;; so the cache itself contains (promise) objects, with only one thread succeeding

(defprotocol Cache
  (cache-get [this key do-get-value])
  (cache-size [this])
  (cache-peek [this]))

(defn mk-cache! [ttl]
  ;; This cache is currently used only for truly immutable data (keyed by git SHA), so we don't care about dropping
  ;; data just because it's old.
  ;; We keep everything in SoftReferences, so anything *can* be GCed, but we want to encourage the GC to clean stuff we
  ;; haven't used in a while, so after ttl from last fill or refresh-below-ttl
  ;; from last read of this key, we remove the SoftReference
  ;; TODO: a smarter way of doing this would be to convert refs to WeakReferences on expiry, and back to SoftReferences
  ;; on next read, but this is probably too clever.
  (let [CLEAN-INTERVAL 30000
        refresh-below-ttl (when ttl (max (/ ttl 2) (- ttl 1000))) ;; How close does expiry have to be before we refresh it on read?
        ref-queue (ReferenceQueue.)
        ;; contents atom contains [{key1 {:ref SOFTREF1, :expires TIMESTAMP}, key2 ...}
        ;;                         {SOFTREF1 key1, ...}]
        ;; Each SoftReference contains a future, which resolves to {:error ^Throwable t} or {:value val}
        contents-atom (atom [{} {}])
        contents-ref (WeakReference. contents-atom ref-queue)

        remove-ref! (fn [dead-ref contents]
                      (log/trace "Removing dead ref" dead-ref "from" contents)
                      (swap! contents (fn [[values-by-key keys-by-ref]]
                                        (let [key (get keys-by-ref dead-ref ::not-found)]
                                          (if (not= key ::not-found)
                                            (do
                                              (log/trace "GC key:" key)
                                              [(dissoc values-by-key key) (dissoc keys-by-ref dead-ref)])
                                            (do
                                              (log/trace "Key already removed:" key)
                                              [values-by-key keys-by-ref]))))))]
    (worker-pool/spawn-thread! ::tidy
      (while
        (try
          (loop [next-clean (+ (System/currentTimeMillis) CLEAN-INTERVAL)]
            (let [now (System/currentTimeMillis)
                  time-to-next-clean (- next-clean now)
                  dead-ref (when (> time-to-next-clean 0)
                             (.remove ref-queue time-to-next-clean))
                  contents (delay (.get contents-ref))]
              (cond
                (or (= dead-ref contents-ref) (nil? @contents))
                (do
                  (log/debug "Cache garbage collected, tidy thread dying")
                  nil)

                (nil? dead-ref)
                ;; Time to clean up!
                (do
                  (log/trace "Cleaning up")
                  (swap! @contents (fn [cache-contents]
                                     (reduce (fn [[values-by-key keys-by-ref :as unmodified-contents]
                                                  [key {:keys [ref expires]}]]
                                               (if (> now expires)
                                                 [(dissoc values-by-key key) (dissoc keys-by-ref ref)]
                                                 unmodified-contents))
                                             cache-contents
                                             (first cache-contents))))
                  (recur (+ (System/currentTimeMillis) CLEAN-INTERVAL)))

                :else
                (do
                  (log/trace "GCed a ref:" dead-ref)
                  (remove-ref! dead-ref @contents)
                  (recur next-clean)))))
          (catch Exception e
            (log/error e)
            true))))

    (reify Cache
      (cache-get [_this key do-get-value]
        (log/trace "Read-through for" key "in" (.hashCode contents-atom) "reading through to" do-get-value)
        ;; Cache stores futures of {:error ^Throwable err} or {:value val}
        (loop []
          ;; Try to get the ref for this key.
          (if-let [{:keys [ref expires]} (get (first @contents-atom) key)]
            ;; If it's there, get its contents promise
            (if-let [their-promise (.get ref)]
              ;; If it's not been collected:
              ;;     Read error/value from promise
              (let [_ (log/trace "Existing ref for" key ":" their-promise)
                    {:keys [error value]} (worker-pool/with-expanding-threadpool-when-slow
                                            @their-promise)]
                (log/trace "Found answer" @their-promise)
                ;; We don't bump the TTL every time, only if there's less than refresh-below-ttl ms remaining
                (when (and ttl (< expires (+ (System/currentTimeMillis) refresh-below-ttl)))
                  (log/trace "Bumping expiry for" key)
                  (swap! contents-atom (fn [[values-by-key keys-by-ref :as original-values]]
                                         (if (= (get-in values-by-key [key :expires]) expires)
                                           [(assoc-in values-by-key [key :expires] (+ (System/currentTimeMillis) ttl))
                                            keys-by-ref]
                                           original-values))))
                ;;     If there's an error, throw it. If there's a value, return it.
                (if error
                  (throw error)
                  value))
              ;; If it's been collected:
              (do
                ;;     Remove this ref specifically it from values-by-key and keys-by-ref
                (log/trace "Removing expired ref for" key ":" ref)
                (remove-ref! ref contents-atom)
                ;;     Restart the read attempt
                (recur)))
            ;; If the key isn't there:
            ;;     Atomically attempt to insert a ref to a new future.
            (let [my-promise (promise)
                  my-ref (SoftReference. my-promise ref-queue)
                  _ (log/trace "For" key ", racing to insert" my-ref "into" @contents-atom)
                  [new-values-by-key _] (swap! contents-atom (fn [[values-by-key keys-by-ref :as original-values]]
                                                               (log/trace "Looking for" key "in" values-by-key)
                                                               (if (contains? values-by-key key)
                                                                 (do
                                                                   (log/trace "Lost" my-ref "to" (get values-by-key key))
                                                                   original-values)
                                                                 (do
                                                                   (log/trace "Won")
                                                                   [(assoc values-by-key key {:ref my-ref :expires (when ttl (+ (System/currentTimeMillis) ttl))})
                                                                    (assoc keys-by-ref my-ref key)]))))
                  _ (log/trace "new contents atom value is" @contents-atom)
                  _ (log/trace "Check for win:" new-values-by-key "vs" my-ref)
                  we-won? (identical? (get-in new-values-by-key [key :ref]) my-ref)]
              (log/trace "Raced to insert for" key ":" my-ref "-> won?" we-won?)
              ;; If successfully inserted (aka we won):
              (if we-won?
                ;;     Run (do-get-value). If error:
                ;;        Deliver error to promise, throw error
                ;;     If completes:
                ;;        Deliver return value to promise, return value
                (let [success-value (try
                                      (do-get-value)
                                      (catch Throwable t
                                        (log/trace "Exploding:" t)
                                        ;; If (do-get-value) errors, deliver the error to
                                        ;; [everyone waiting on] the promise, but then remove it
                                        ;; so the next fetch can land
                                        (deliver my-promise {:error t})
                                        (remove-ref! my-ref contents-atom)
                                        (throw t)))]
                  (log/trace "Delivering to promise for" key ":" success-value)
                  (deliver my-promise {:value success-value})
                  (log/trace "Returning success")
                  success-value)
                ;; If not successful (ie someone else inserted):
                ;;     Restart the read attempt
                (recur))))))
      (cache-size [_this]
        (count (first @contents-atom)))
      (cache-peek [_this]
        @contents-atom))))


