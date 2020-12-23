(ns anvil.core.hrr-queue
  (:require [clojure.tools.logging :as log])
  (:import (clojure.lang PersistentQueue)))

(defprotocol Queue
  (hrr-pop [this] "Extract an element from the queue [queue-with-element-removed next-element next-element-tags]")
  (hrr-push [this item tags] "Add an item to the queue, grouped by the specified tags (returns new queue value)")
  (hrr-penalise [this tags amount] "Penalise activity with the specified tags by this amount")
  (hrr-assert-queue-invariants [this] "Assert queue invariants")
  (hrr-size [this] "How many elements are queued?"))

(defrecord SimpleQueue [^PersistentQueue q]
  Queue
  (hrr-pop [this]
    (let [rest (.pop q)]
      [(when-not (empty? rest)
         (SimpleQueue. rest))
       (.peek q) nil]))

  (hrr-push [this item tags]
    (assert (empty? tags))
    (SimpleQueue. (conj q item)))

  (hrr-penalise [this tags amount]
    this)

  (hrr-size [this]
    (count q))

  (hrr-assert-queue-invariants [this] (count q)))

(defn get-min-penalty [hpq-subqueues]
  (loop [mp nil, [[_tag [penalty _subqueue] :as subqueue] & more-subqueues] hpq-subqueues]
    (cond
      (nil? subqueue)
      (or mp 0)

      (or (nil? mp) (< penalty mp))
      (recur penalty more-subqueues)

      :else
      (recur mp more-subqueues))))

(defrecord HierarchicalPenaltyQueue [subqueues, size]
  Queue
  (hrr-pop [this]
    ;; Naive: Gather all the subqueues that are currently eligible to run (ie below the eligibility threshold),
    ;; and choose randomly between them. This is O(N) in number of children because of the naive search.
    ;; If there are none eligible, we advance our eligibility threshold
    (let [[tags-at-minimum-penalty minimum-penalty]
          (reduce (fn [[tags-at-minimum minimum] [child-tag [penalty subqueue]]]
                    (cond
                      ;; Ignore empty subqueues
                      (= 0 (hrr-size subqueue))
                      [tags-at-minimum minimum]

                      (or (nil? minimum) (< penalty minimum))
                      [[child-tag] penalty]

                      (= penalty minimum)
                      [(conj tags-at-minimum child-tag) minimum]

                      :else
                      [tags-at-minimum minimum]))
                  [[] nil]
                  subqueues)

          tags-to-hoover (reduce (fn [tags-to-hoover [child-tag [penalty subqueue]]]
                                   (if (< penalty minimum-penalty)
                                     (conj tags-to-hoover child-tag)
                                     tags-to-hoover))
                                 #{} subqueues)
          subqueues (apply dissoc subqueues tags-to-hoover)]

      (assert minimum-penalty)                              ;; We should have something inside us!

      (let [next-tag (rand-nth tags-at-minimum-penalty)
            [penalty subqueue] (get subqueues next-tag)
            [subqueue element tags] (hrr-pop subqueue)
            size (dec size)]
        [(when-not (zero? size)
           (HierarchicalPenaltyQueue. (if subqueue
                                        (assoc subqueues next-tag [penalty subqueue])
                                        (dissoc subqueues next-tag))
                                      size))
         element
         (if next-tag (cons next-tag tags) tags)])))

  (hrr-push [this item [tag & more-tags]]
    (let [tag (if (and (nil? tag)
                       more-tags)
                (do (log/warn (Exception. (str "Got unexpected nil tag. More tags:" (pr-str more-tags))))
                    ::nil-tag)
                tag)
          [penalty subqueue] (or (get subqueues tag)
                                 [(get-min-penalty subqueues)
                                  (if (nil? tag) (SimpleQueue. PersistentQueue/EMPTY) (HierarchicalPenaltyQueue. {} 0))])
          subqueue (hrr-push subqueue item more-tags)]
      (HierarchicalPenaltyQueue. (assoc subqueues tag [penalty subqueue])
                                 (inc size))))

  (hrr-penalise [this [tag & more-tags] amount]
    (let [[penalty subqueue] (or (get subqueues tag)
                                 [(get-min-penalty subqueues)
                                  (if (nil? tag) (SimpleQueue. PersistentQueue/EMPTY) (HierarchicalPenaltyQueue. {} 0))])
          penalty (+ penalty amount)
          subqueue (hrr-penalise subqueue more-tags amount)]

      (HierarchicalPenaltyQueue. (assoc subqueues tag [penalty subqueue]) size)))

  (hrr-size [this] size)
  (hrr-assert-queue-invariants [this]
    (assert (= size (reduce + (for [[tag [penalty subqueue]] subqueues]
                                (hrr-assert-queue-invariants subqueue)))))
    size))

(defrecord HierarchicalRoundRobinQueue [subqueues, ^PersistentQueue order, size]
  Queue
  (hrr-pop [this]
    (let [next-key (.peek order)
          ^Queue subqueue (get subqueues next-key)
          [subqueue next-element tags] (hrr-pop subqueue)
          tags (if next-key (cons next-key tags) '())]
      [(if subqueue
         (HierarchicalRoundRobinQueue. (assoc subqueues next-key subqueue) (conj (.pop order) next-key) (dec size))
         (let [subqueues (dissoc subqueues next-key)]
           (when-not (empty? subqueues)
             (HierarchicalRoundRobinQueue. subqueues (.pop order) (dec size)))))
       next-element tags]))

  (hrr-push [this item [tag & more-tags]]
    (if-let [q (get subqueues tag)]
      (HierarchicalRoundRobinQueue. (assoc subqueues tag (hrr-push q item more-tags)) order (inc size))
      (HierarchicalRoundRobinQueue. (assoc subqueues tag (if tag
                                                           (hrr-push (HierarchicalRoundRobinQueue. {} PersistentQueue/EMPTY 0) item more-tags)
                                                           (hrr-push (SimpleQueue. PersistentQueue/EMPTY) item nil)))
                                    (conj order tag) (inc size))))
  (hrr-size [this] size)

  (hrr-penalise [this tags amount] this)

  (hrr-assert-queue-invariants [this]
    (assert (= (set (seq order)) (set (keys subqueues))))
    (assert (= size (reduce + (for [[_ q] subqueues] (hrr-assert-queue-invariants q)))))
    size))

(defn mk-round-robin-queue []
  (HierarchicalRoundRobinQueue. {} PersistentQueue/EMPTY 0))

(defn mk-penalty-queue []
  (HierarchicalPenaltyQueue. {} 0))

;; Switch this to change queue implementations in flight
(def mk-queue mk-penalty-queue)

(extend-protocol Queue nil
  (hrr-pop [this] nil)
  (hrr-push [this item tags]
    (hrr-push (mk-queue) item tags))
  ;;(hrr-assert-queue-invariants [this] 0)
  (hrr-penalise [this tags amount] nil)
  (hrr-size [this] 0))

(defn to-structure [q]
  (if (:subqueues q)
    (assoc (into {} (for [[k v] (:subqueues q)
                          :let [v (if (vector? v) (second v) v)]]
                      [k (to-structure v)]))
      :_size (hrr-size q))
    {:_size (hrr-size q)}))

(defn max-size-merger [v1 v2]
  (if (map? v2)
    (merge-with max-size-merger v1 v2)
    (max v1 v2)))

(defn hpq-summary
  ([q] (hpq-summary q nil ""))
  ([q n-levels] (hpq-summary q n-levels ""))
  ([q n-levels indent]
   (let [max-len (reduce max 0 (map (fn [[tag _]] (if tag (.length (str tag)) 1)) (:subqueues q)))
         format-string (str "%-" max-len "s")]
     (doseq [[tag [penalty subqueue]] (sort-by #(str (first %)) (:subqueues q))]
       (println (str indent (format format-string (or tag "-")) " " penalty " [" (apply str (interpose " " (repeat (hrr-size subqueue) "x"))) "]"))
       (when-not (= 1 n-levels)
         (hpq-summary subqueue (when n-levels
                                 (dec n-levels))
                      (str indent (apply str (repeat max-len " ")))))))))

