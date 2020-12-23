(ns anvil.core.hrr-queue-test
  (:require [clojure.test :refer :all]
            [anvil.core.hrr-queue :refer :all]
            [anvil.core.worker-pool :as worker-pool]))

(defn pop-all-hrr [q]
  (loop [results [], q q]
    (if-not q
      results
      (let [[q item tags] (hrr-pop q)]
        (when q
          (hrr-assert-queue-invariants q))
        (recur (conj results [item tags]) q)))))

(deftest testall-straight-hrr
  (let [q (-> (mk-round-robin-queue)
              (hrr-push :foo [])
              (hrr-push :bar []))]
    (is (= (pop-all-hrr q)
           [[:foo []]
            [:bar []]])))

  (let [q (-> (mk-round-robin-queue)
              (hrr-push 1 [])
              (hrr-push 2 [:x])
              (hrr-push 3 [])
              (hrr-push 4 [:x])
              (hrr-push 5 [:x :y])
              (hrr-push 6 [:x :y])
              (hrr-push 7 [:x])
              (hrr-push 8 [])
              (hrr-push 9 [:z]))]
    (is (= (pop-all-hrr q)
           [[1 ()]
            [2 [:x]]
            [9 [:z]]
            [3 []]
            [5 [:x :y]]
            [8 []]
            [4 [:x]]
            [6 [:x :y]]
            [7 [:x]]]))))

(defn pop-n [q n]
  (loop [q q, n n, results #{}]
    (if (zero? n)
      [q results]
      (let [[new-q result _tags] (hrr-pop q)]
        (recur new-q (dec n) (conj results result))))))

(deftest testall-penalty-hrr
  (let [q (-> (->HierarchicalPenaltyQueue {} 0)
              (hrr-push :foo [])
              (hrr-push :bar []))

        _ (hrr-assert-queue-invariants q)

        [q results] (pop-n q 2)]
    (is (= results #{:foo :bar}))
    (is (nil? (hrr-pop q))))

  (let [start-q (-> (->HierarchicalPenaltyQueue {} 0)
                    (hrr-push 1 [:x])
                    (hrr-push 2 [:y])
                    (hrr-push 3 [:x])
                    (hrr-push 4 [:y])
                    (hrr-push 5 [:x])
                    (hrr-push 6 [:y])
                    (hrr-push 7 [:x])
                    (hrr-push 8 [:y])
                    (hrr-push 9 [:x])
                    (hrr-push 10 [:y]))
        _ (hrr-assert-queue-invariants start-q)

        q (hrr-penalise start-q [:x] 10)
        [q first-5] (pop-n q 5)
        [q second-5] (pop-n q 5)
        _ (is (= first-5 #{2 4 6 8 10}))
        _ (is (= second-5 #{1 3 5 7 9}))

        q (hrr-penalise start-q [:x] 10)
        [q first-2] (pop-n q 2)

        _ (is (every? even? first-2))
        q (hrr-penalise q [:y] 20)
        [q next-5] (pop-n q 5)
        _ (is (= #{1 3 5 7 9} next-5))
        [q next-3] (pop-n q 3)
        _ (is (every? even? next-3))

        start-q (-> (->HierarchicalPenaltyQueue {} 0)
                    (hrr-push 1 [:x :a])
                    (hrr-push 2 [:y])
                    (hrr-push 3 [:x :a])
                    (hrr-push 4 [:y])
                    (hrr-push 5 [:x :a])
                    (hrr-push 6 [:y])
                    (hrr-push 7 [:x :b])
                    (hrr-push 8 [:y])
                    (hrr-push 9 [:x :b])
                    (hrr-push 10 [:y])
                    (hrr-push 11 [:z]))
        q (-> start-q
              (hrr-penalise [:y :c] 5)
              (hrr-penalise [:x :a] 6)
              (hrr-penalise [:x :b] 4))
        [q- first-1] (pop-n q 1)
        _ (is (= #{11} first-1))
        [q- next-5] (pop-n q- 5)
        _ (is (= next-5 #{2 4 6 8 10}))
        [q- next-2] (pop-n q- 2)
        _ (is (= #{7 9} next-2))
        [q- next-3] (pop-n q- 3)
        _ (is (= #{1 3 5} next-3))


        ;; Now test that removed queues are reset.
        ;; Add x. Penalise x to 10, then pop all of x
        ;; Add y and z. Penalise y to 1
        ;; Add x and pop all of x+z, verify that they're on a fair footing
        start-q (-> (->HierarchicalPenaltyQueue {} 0)
                    (hrr-push 1 [:x])
                    (hrr-push 1000 [:w])
                    (hrr-penalise [:x] 10)
                    (hrr-penalise [:w] 1000))
        [q elt] (hrr-pop start-q)
        _ (is (= elt 1))

        ;; Now, the queue has w with a huge penalty and no x queue at all,
        ;; so when X gets added again it will be on an even footing with everything else

        q (-> q
              (hrr-push 2 [:y])
              (hrr-push 3 [:z])
              (hrr-penalise [:y] 1)
              (hrr-push 4 [:x]))

        freqs (frequencies (repeatedly 1000 #(let [[_ _ [tag]] (hrr-pop q)] tag)))
        _ (is (nil? (:y freqs)))
        _ (is (and (:x freqs) (> (:x freqs) 0)))
        _ (is (and (:z freqs) (> (:z freqs) 0)))

        ;; Test pushing nil tags. Not blowing up is sufficient here.
        start-q (-> (->HierarchicalPenaltyQueue {} 0)
                    (hrr-push 1 [:x nil :w])
                    (hrr-push 2 [:x :y :v])
                    (hrr-push 3 [:z]))

        [q- next-3] (pop-n start-q 3)
        _ (is (= next-3 #{1 2 3}))]))


;; This is a test

(def vis-running? (atom true))
(def vis-q (atom [nil]))

(defn start-visualisation! []
  (reset! vis-running? true)
  (reset! vis-q [nil])
  (worker-pool/spawn-thread!
    (while @vis-running?
      (hpq-summary (first @vis-q) 1)
      (println)
      (Thread/sleep 1000)))

  (worker-pool/spawn-thread!
    (while @vis-running?
      (let [[_q value tags] (swap! vis-q #(hrr-pop (first %)))]
        (swap! vis-q (fn [[q]] [(hrr-penalise q tags (if (= [:x] tags) 4 1))]))
        (Thread/sleep 100))))

  (worker-pool/spawn-thread!
    (while @vis-running?
      (swap! vis-q (fn [[q]] [(hrr-push q :foo (rand-nth [[:w] [:w] [:x] [:y] [:z] [:y] [:z]]))]))
      (Thread/sleep 100))))


(defn time-insertions! []
  (let [started (System/nanoTime)
        q (atom [nil #_(mk-round-robin-queue)])
        _ (dotimes [n 1000000]
            (swap! q (fn [[q]] [(hrr-push q :foo (rand-nth [[:w] [:w] [:x] [:y] [:z] [:y] [:z]]))])))
        inserted (System/nanoTime)
        _ (while (first (swap! q (fn [[q]] (hrr-pop q)))))
        removed (System/nanoTime)]
    (println "Inserts:" (/ (- inserted started) 1e9))
    (println "Removals:" (/ (- removed inserted) 1e9))))

(defn stop-visualisation! []
  (reset! vis-running? false))