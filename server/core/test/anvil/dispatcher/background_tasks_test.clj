(ns anvil.dispatcher.background-tasks-test
  (:require [clojure.test :refer :all]
            [anvil.dispatcher.background-tasks :as background-tasks]
            [anvil.dispatcher.native-rpc-handlers.users.core :as users]
            [anvil.runtime.app-log :as app-log]
            [clojure.java.jdbc :as jdbc]
            [clj-commons.slingshot.test :refer [thrown+?]]))

;; ---------------------------------------------------------------------------
;; launch-request-watch-key
;;
;; BG task launches inherit the watch key from the launching session:
;;   1. an explicit :bg-task-watch-key on the request always wins,
;;   2. else a session that watches everything it launches
;;      (:watch-key-for-any-tasks-we-launch, eg an IDE runner debug session),
;;   3. else the launching session's own :bg-task-watch-key
;;      (a BG task passing its key on to nested launches).
;; Plain atoms stand in for sessions (only @ is used).
;; ---------------------------------------------------------------------------

(deftest test-launch-request-watch-key
  (testing "explicit request key wins over everything"
    (is (= "req-key"
           (background-tasks/launch-request-watch-key
             {:bg-task-watch-key "req-key"}
             (atom {:watch-key-for-any-tasks-we-launch "session-key"
                    :bg-task-watch-key "task-key"})))))

  (testing "inherited from a debug session's launcher key"
    (is (= "session-key"
           (background-tasks/launch-request-watch-key
             {}
             (atom {:watch-key-for-any-tasks-we-launch "session-key"})))))

  (testing "nested launch: inherited from a BG task session's own key"
    (is (= "task-key"
           (background-tasks/launch-request-watch-key
             {}
             (atom {:bg-task-watch-key "task-key"})))))

  (testing "launcher key takes precedence over the session's own task key"
    ;; Shouldn't happen in practice, but the precedence should be deterministic
    (is (= "session-key"
           (background-tasks/launch-request-watch-key
             {}
             (atom {:watch-key-for-any-tasks-we-launch "session-key"
                    :bg-task-watch-key "task-key"})))))

  (testing "no key anywhere"
    (is (nil? (background-tasks/launch-request-watch-key {} (atom {})))))

  (testing "nil session-state is tolerated"
    (is (nil? (background-tasks/launch-request-watch-key {} nil)))
    (is (= "req-key" (background-tasks/launch-request-watch-key {:bg-task-watch-key "req-key"} nil)))))

;; ---------------------------------------------------------------------------
;; record-bg-task-launch-event!
;;
;; The durable "this session launched task <name>" app-log event, recorded on
;; the node that dispatched the launch (which holds the real launcher session -
;; a crosslinked spawn node only has a placeholder). Every launch with a
;; launcher session records, watched or not, and the launcher is never
;; force-logged.
;; ---------------------------------------------------------------------------

(deftest test-record-bg-task-launch-event!
  (let [log-events (atom [])]
    (with-redefs [app-log/record-event! (fn [session trace-id type log-text data & [opts]]
                                          (swap! log-events conj {:session session :type type :data data :opts opts}))]

      (testing "no launcher session -> nothing recorded"
        (background-tasks/record-bg-task-launch-event! nil "t0" "sess-0" "foo")
        (is (empty? @log-events)))

      (testing "any launch records the event without force-logging the launcher"
        (let [session (atom {})]
          (background-tasks/record-bg-task-launch-event! session "t1" "sess-1" "foo")
          (is (= [{:session session
                   :type    "background_task_launched"
                   :data    {:task_id "t1" :session_id "sess-1" :task_name "task:foo"}
                   :opts    {:ensure-logged? false}}]
                 @log-events))))

      (testing "a throwing log impl never breaks the launch response path"
        (with-redefs [app-log/record-event! (fn [& _] (throw (Exception. "log DB down")))]
          (is (nil? (background-tasks/record-bg-task-launch-event! (atom {}) "t2" "sess-2" "foo"))))))))

;; ---------------------------------------------------------------------------
;; check-client-script-launch! - the script_config allow-list gate for
;; client-origin (browser / client uplink) background task launches.
;; The logged_in_user check is stubbed; its table/cookie machinery is
;; exercised by the integration tests.
;; ---------------------------------------------------------------------------

(def ^:private check-client-script-launch! #'background-tasks/check-client-script-launch!)

(defn- request-for [script-config]
  {:app {:script_config script-config}})

(deftest test-check-client-script-launch!
  (testing "non-script background tasks are rejected outright"
    (is (thrown+? [:type "anvil.server.BackgroundTaskError"]
                  (check-client-script-launch! (request-for {}) "my_task")))
    (is (thrown+? [:type "anvil.server.BackgroundTaskError"]
                  (check-client-script-launch! (request-for {}) nil))))

  (testing "client_callable: true allows anyone"
    (is (nil? (check-client-script-launch! (request-for {:my_script {:client_callable true}})
                                           "script:my_script"))))

  (testing "absent config means server code only"
    (is (thrown+? [:type "anvil.server.PermissionDenied"]
                  (check-client-script-launch! (request-for {}) "script:my_script")))
    (is (thrown+? [:type "anvil.server.PermissionDenied"]
                  (check-client-script-launch! (request-for nil) "script:my_script"))))

  (testing "explicit null and unrecognised values mean server code only"
    (is (thrown+? [:type "anvil.server.PermissionDenied"]
                  (check-client-script-launch! (request-for {:my_script {:client_callable nil}})
                                               "script:my_script")))
    (is (thrown+? [:type "anvil.server.PermissionDenied"]
                  (check-client-script-launch! (request-for {:my_script {:client_callable "sometimes"}})
                                               "script:my_script"))))

  (testing "config for one script does not open up another"
    (is (thrown+? [:type "anvil.server.PermissionDenied"]
                  (check-client-script-launch! (request-for {:my_script {:client_callable true}})
                                               "script:other_script"))))

  (testing "logged_in_user requires a login, and returns the verified user id"
    (with-redefs [users/get-logged-in-user-id (constantly "user-1")]
      (is (= "user-1" (check-client-script-launch!
                        (request-for {:my_script {:client_callable "logged_in_user"}})
                        "script:my_script"))))
    (with-redefs [users/get-logged-in-user-id (constantly nil)]
      (is (thrown+? [:type "anvil.users.AuthenticationFailed"]
                    (check-client-script-launch!
                      (request-for {:my_script {:client_callable "logged_in_user"}})
                      "script:my_script"))))))

;; ---------------------------------------------------------------------------
;; record-final-state!
;;
;; handle-task-ended! is called with the task's row and its final state, but only
;; by whichever call gives the task its completion status.
;; ---------------------------------------------------------------------------

(deftest test-record-final-state-calls-task-ended-hook
  (let [ended (atom [])
        row {:id "task-1" :session_id "session-1" :task_name "task:foo" :completion_status "threw"}
        updated-row (atom row)]
    (with-redefs [jdbc/query (fn [& _] (when-let [r @updated-row] [r]))
                  app-log/record-event! (fn [& _])
                  background-tasks/handle-task-ended! (fn [task final-state] (swap! ended conj [task final-state]))]

      (testing "the hook gets the row and the task's error"
        (background-tasks/record-final-state! nil {:id "task-1"} {:error {:message "oops" :type "ValueError"}} true)
        (is (= [[row {:error {:message "oops" :type "ValueError"}}]]
               (map (fn [[task final-state]] [task (select-keys final-state [:error])]) @ended))))

      (testing "the hook isn't called if the task already had a completion status"
        (reset! ended [])
        (reset! updated-row nil)
        (background-tasks/record-final-state! nil {:id "task-1"} {} :killed)
        (is (empty? @ended)))

      (testing "an error from the hook doesn't stop the task's end being recorded"
        (reset! updated-row row)
        (with-redefs [background-tasks/handle-task-ended! (fn [& _] (throw (Exception. "hook failed")))]
          (is (nil? (background-tasks/record-final-state! nil {:id "task-1"} {:error {:message "oops"}} true))))))))

;; ---------------------------------------------------------------------------
;; list-app-background-tasks
;;
;; App code's list_background_tasks() doesn't include the tasks get-internal-background-tasks returns
;; ---------------------------------------------------------------------------

(deftest test-list-app-background-tasks-hides-internal-tasks
  (let [tasks [{:id "internal" :task_name "task:anvil.private.internal_task"}
               {:id "app" :task_name "task:send_receipt"}
               {:id "script" :task_name "task:script:import"}]
        listed (atom nil)]
    (with-redefs [background-tasks/list-background-tasks (fn [environment all-environments?]
                                                           (reset! listed [environment all-environments?])
                                                           tasks)]
      (testing "with no internal tasks, every task is listed"
        (with-redefs [background-tasks/get-internal-background-tasks (constantly #{})]
          (is (= ["internal" "app" "script"] (map :id (background-tasks/list-app-background-tasks {:env_id 1} true))))))

      (testing "internal tasks are left out"
        (with-redefs [background-tasks/get-internal-background-tasks (constantly #{"anvil.private.internal_task"})]
          (is (= ["app" "script"] (map :id (background-tasks/list-app-background-tasks {:env_id 1} true))))
          (is (= [{:env_id 1} true] @listed)))))))
