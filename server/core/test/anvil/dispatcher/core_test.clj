(ns anvil.dispatcher.core-test
  (:use clojure.test
        anvil.dispatcher.core
        org.senatehouse.expect-call)
  (:require [crypto.random :as random]
            [anvil.dispatcher.native-rpc-handlers.util :as nrpc]))


(clj-logging-config.log4j/set-logger! "anvil.dispatcher.core" :level :trace)
(clj-logging-config.log4j/set-logger! "anvil.dispatcher.quota" :level :trace)

#_(def update! (constantly nil))
#_(defn respond! [resp & args]
  (println "RESPONSE:" resp)
  nil)

(def return-path {:update! update, :respond! respond!})

(defn multiple-dispatch! [n app-ids & [func args]]
  (doseq [i (range n)]
    (dispatch! {:call          {:func (or func "anvil.private.echo"),
                                :args (or args [(nth (cycle app-ids) i)]) :kwargs {}}
                :app           {}, :app-id (nth (cycle app-ids) i), :app-origin ""
                :session-state nil
                :origin        :test
                :thread-id     (str "test-" (random/hex 16))
                :use-quota?    true}
               return-path)
    (Thread/sleep 50)))

(defn is-resp [resp s]
  (= (:response resp) s))

(defn is-output [out s]
  (= (:output out) s))

(def warning-msg "Warning: Close to rate-limit soft threshold: Test\n")
(defn app-warning-msg [app-id]
  (str "Warning: Close to rate-limit soft threshold: Test (" app-id ")\n"))

#_(deftest single-warning-bucket

  ; Scenario: One global warning bucket, allowing 3 requests per half-second.
  ;           Make 5 requests, check that final 2 generate warning.
  ;           Wait half a second for bucket to fully recover, make three new requests
  ;           without causing a warning.

  (binding [*test-rate-limit-override*
            {:global [{:name "Test"
                       :type :requests
                       :warn [3 0.5]}]}]
    (expect-call
      [; Respond three times directly
       (respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (is-resp r "Foo")))

       ; Respond twice with warning output
       (update! [u] (is (is-output u warning-msg)))
       (respond! [r] (is (is-resp r "Foo")))
       (update! [u] (is (is-output u warning-msg)))
       (respond! [r] (is (is-resp r "Foo")))

       ; Respond directly after delay.
       (respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (is-resp r "Foo")))]

      (clear-app-buckets!)
      (clear-global-buckets!)

      (multiple-dispatch! 5 ["Foo"])

      (Thread/sleep 500)
      (multiple-dispatch! 3 ["Foo"]))))

#_(deftest soft-threshold-delay

  ; Scenario: One global soft threshold.
  ;           Make three requests, check that responses 2 and 3 are delayed.
  ;           Wait for bucket to recover, check that subsequent response is ~instant.

  (binding [*test-rate-limit-override*
            {:global [{:name "Test"
                       :type :requests
                       ;; Throttle to 1 call per 0.5 seconds
                       :soft [1 0.5]}]}]

    ;; Check that requests get delayed correctly.
    (let [last-response (atom 0)
          last-call-time (atom nil)]
      (expect-call
        [(respond! [r]
                   (is (is-resp r "Foo"))
                   (reset! last-response (System/currentTimeMillis)))
         ;; Responses 2 and 3 should be delayed
         (respond! [r]
                   (is (> (- (System/currentTimeMillis) @last-response)
                          450))
                   (is (is-resp r "Bar"))
                   (reset! last-response (System/currentTimeMillis)))
         (respond! [r]
                   (is (> (- (System/currentTimeMillis) @last-response)
                          450))
                   (is (is-resp r "Foo"))
                   (reset! last-response (System/currentTimeMillis)))

         ;; Final response should be ~instant.
         (respond! [r]
                   (is (< (- (System/currentTimeMillis) @last-call-time)
                          50))
                   (is (is-resp r "Baz")))
         ]

        (clear-queues!)
        (clear-app-buckets!)
        (clear-global-buckets!)

        ; Give multiple app IDs to check we're obeying the global limit mocked above.
        (multiple-dispatch! 3 ["Foo" "Bar"])
        (Thread/sleep 1500)

        (reset! last-call-time (System/currentTimeMillis))
        (multiple-dispatch! 1 ["Baz"])))))

#_(deftest soft-threshold-delay-per-app

  ; Scenario: One soft threshold per app. Make two requests from each of two apps.
  ;           Check that first response from each is ~instant.
  ;           Check that second response from each is delayed, but that they arrive ~together.

  (binding [*test-rate-limit-override*
            {:per-app [{:name "Test"
                        :type :requests
                        ;; Throttle to 1 call per 0.5 seconds
                        :soft [1 0.5]}]}]

    ;; Check that requests get delayed correctly.
    (let [last-response (atom 0)]
      (expect-call
        [
         ; First two responses for the two apps should come ~together
         (respond! [r]
                   (is (is-resp r "Foo"))
                   (reset! last-response (System/currentTimeMillis)))
         (respond! [r]
                   (is (< (- (System/currentTimeMillis) @last-response)
                          70))
                   (is (is-resp r "Bar"))
                   (reset! last-response (System/currentTimeMillis)))

         ;; Next two should be delayed, but also together.
         (respond! [r]
                   (is (> (- (System/currentTimeMillis) @last-response)
                          430))
                   (is (is-resp r "Foo"))
                   (reset! last-response (System/currentTimeMillis)))
         (respond! [r]
                   (is (< (- (System/currentTimeMillis) @last-response)
                          70))
                   (is (is-resp r "Bar"))
                   )
         ]

        (clear-queues!)
        (clear-app-buckets!)
        (clear-global-buckets!)

        (multiple-dispatch! 4 ["Foo" "Bar"])
        (Thread/sleep 750)))))

#_(deftest per-app-independent-warnings

  ; Scenario: One per-app warning threshold, two apps. First app makes 2 requests, second makes one.
  ;           Check that first app gets warning, second doesn't.

  (binding [*test-rate-limit-override*
            {:per-app [{:name "Test"
                       :type :requests
                       ;; Warn at 1 call per 0.5 seconds
                       :warn [1 0.5]}]}]

    (expect-call
      [(respond! [r] (is (is-resp r "Foo")))
       (update! [u] (is (is-output u (app-warning-msg "Foo"))))
       (respond! [r] (is (is-resp r "Foo")))

       (respond! [r] (is (is-resp r "Bar")))]

      (clear-queues!)
      (clear-app-buckets!)
      (clear-global-buckets!)

      (multiple-dispatch! 3 ["Foo" "Foo" "Bar"]))))

#_(deftest single-hard-threshold

  ; Scenario: One global hard limit. Two apps.
  ;           Check that once the limit is reached, both apps hit it.
  ;           Wait 0.5 seconds for the bucket to fully recover. Check that
  ;           only 1 subsequent call succeeds.

  (binding [*test-rate-limit-override*
            {:global [{:name "Test"
                       :type :requests
                       ;; Die beyond 1 call per 0.5 seconds
                       :hard [1 0.5]}]}]

    (expect-call
      [(respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded")))
       (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded")))

       (respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded")))]

      (clear-queues!)
      (clear-app-buckets!)
      (clear-global-buckets!)

      (multiple-dispatch! 3 ["Foo" "Bar"])
      (Thread/sleep 500)
      (multiple-dispatch! 2 ["Foo"]))))

#_(deftest hard-limit-clears-queue

  ; Scenario: Soft and hard global limits.
  ;           Initial requests are serviced,
  ;           then some are throttled,
  ;           then hard limit clears queued requests.

  (binding [*test-rate-limit-override*
            {:global [{:name "Test"
                       :type :requests
                       ;; Throttle to 1 call per 0.5 seconds
                       :soft [1 0.5]
                       ;; Die beyond 4 calls per 10 seconds
                       :hard [3 10]}]}]
    (let [last-response (atom 0)]
      (expect-call
        [(respond! [r]
                   (is (is-resp r "Foo"))
                   (reset! last-response (System/currentTimeMillis)))

         ;; Second and third responses should be delayed by the throttle
         (respond! [r]
                   (is (> (- (System/currentTimeMillis) @last-response)
                          450))
                   (is (is-resp r "Foo"))
                   (reset! last-response (System/currentTimeMillis)))
         (respond! [r]
                   (is (> (- (System/currentTimeMillis) @last-response)
                          450))
                   (is (is-resp r "Foo"))
                   (reset! last-response (System/currentTimeMillis)))

         ;; Fourth response should be an error
         (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded"))
                   (is (> (- (System/currentTimeMillis) @last-response) 450))
                   (is (< (- (System/currentTimeMillis) @last-response) 550)))

         ;; Remaining queued requests should respond with error immediately.
         (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded"))
                   (is (< (- (System/currentTimeMillis) @last-response) 550)))
         (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded"))
                   (is (< (- (System/currentTimeMillis) @last-response) 550)))
         ]

        (clear-queues!)
        (clear-app-buckets!)
        (clear-global-buckets!)

        ; Make all the calls at once. First should respond, next two throttle, rest error.
        (multiple-dispatch! 6 ["Foo"])

        ; Wait long enough that if the queue-clearing failed, we would know about it.
        (Thread/sleep 3000)))))

#_(deftest cpu-time-limit

  ;; Scenario: 1 global CPU time limit, with very slow reset rate.
  ;;           Make 3 calls, first two use up >1s CPU in total. Third fails.

  (binding [*test-rate-limit-override*
            {:global [{:name "Test CPU"
                       :type :cpu-time
                       ;; Die beyond 1 in 100 seconds
                       :hard [1 100]}]}

            *test-native-rpc-handlers*
            {"test.sleep" (nrpc/wrap-native-fn (fn [_kwargs t]
                                                 (Thread/sleep t)
                                                 "Foo"))}]
    (clear-queues!)
    (clear-app-buckets!)
    (clear-global-buckets!)

    (expect-call
      [(respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded")))]

      (multiple-dispatch! 1 ["Foo"] "test.sleep" [510])
      (Thread/sleep 600)
      (multiple-dispatch! 1 ["Foo"] "test.sleep" [510])
      (Thread/sleep 600)
      (multiple-dispatch! 1 ["Foo"]))))

#_(deftest cpu-time-limit-concurrent

  ;; Scenario: 1 global CPU time limit, with very slow reset rate.
  ;;           Although concurrent calls will succeed, CPU quota should go negative
  ;;           and take a long time to recover.
  ;;           Make 5 calls, first three are concurrent and use up 3s CPU total
  ;;           Check that CPU quota takes long enough to recover.

  (binding [*test-rate-limit-override*
            {:global [{:name "Test CPU"
                       :type :cpu-time
                       ;; Die beyond 1 in 2 seconds
                       :hard [1 2]}]}

            *test-native-rpc-handlers*
            {"test.sleep" (nrpc/wrap-native-fn (fn [_kwargs t]
                                                 (Thread/sleep t)
                                                 "Foo"))}]
    (clear-queues!)
    (clear-app-buckets!)
    (clear-global-buckets!)

    (expect-call
      [(respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (is-resp r "Foo")))
       (respond! [r] (is (is-resp r "Foo")))
       ;; Next two calls are during CPU recovery period
       (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded")))
       (respond! [r] (is (= (:type (:error r)) "RateLimitExceeded")))
       ;; Bucket has recovered.
       (respond! [r] (is (is-resp r "Foo")))]

      (multiple-dispatch! 3 ["Foo"] "test.sleep" [1000])
      (Thread/sleep 1000)
      (multiple-dispatch! 1 ["Foo"])
      (println "Waiting 3.5s for CPU bucket to recover...")
      (Thread/sleep 3500)
      (multiple-dispatch! 1 ["Foo"])
      (Thread/sleep 500)
      (multiple-dispatch! 1 ["Foo"]))))