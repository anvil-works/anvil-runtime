(ns anvil.dispatcher.native-rpc-handlers.util-wrap-async-native-fn-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.tools.logging.test :refer [with-log the-log]]
            [crypto.random :as random]
            [matcher-combinators.test]
            [matcher-combinators.matchers :as m]
            [clj-commons.slingshot :refer [throw+]]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.native-rpc-handlers.util :as u]
            [anvil.dispatcher.core :as dispatcher]))

(defmacro with-no-worker-pool [& body]
  `(with-redefs [worker-pool/run-task!* (fn [f# _#] (f#))]
     ~@body))

(defn create-test-environment []
  (let [respond-calls (atom [])
        update-calls (atom [])]
    {:respond-calls respond-calls
     :update-calls update-calls
     :return-path {:respond! (fn [response] (swap! respond-calls conj response))
                   :update!  (fn [data] (swap! update-calls conj data))}}))

(defn any [] (m/pred some?))

(deftest test-wrap-async-native-fn
  (with-no-worker-pool
    (testing "with a function taking an arg and returning a string"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [return-path _context _kwargs message]
                                (dispatcher/respond! return-path {:response (str "Hello " message "!")}))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (wrapped-fn request return-path)

        (is (= [{:response "Hello World!"}] @respond-calls))
        (is (= [] @update-calls))))

    (testing "with a function taking kwargs and returning a string"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [return-path _context kwargs]
                                (dispatcher/respond! return-path {:response (str "Hello " (:message kwargs) "!")}))))
            request {:call {:func   "test_function"
                            :args   []
                            :kwargs {:message "World"}}}]

        (wrapped-fn request return-path)

        (is (= [{:response "Hello World!"}] @respond-calls))
        (is (= []  @update-calls))))

    (testing "with a function throwing an Anvil Error"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [_return-path _context _kwargs _message]
                                (throw+ {:anvil/server-error "Error Message"
                                         :type               "MyError"
                                         :foo                :bar}))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (wrapped-fn request return-path)

        (is (= [{:error {:message "Error Message"
                         :type    "MyError"
                         :foo     :bar
                         :trace   [["<rpc>" 0]]}}]
               @respond-calls))
        (is (= [] @update-calls))))

    (testing "with a function throwing an unexpected Slingshot Object"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [_return-path _context _kwargs _message]
                                (throw+ {:some-error "Foo"}))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (with-log
          (with-redefs [random/hex #(apply str (repeat % "ab"))]
            (wrapped-fn request return-path))

          (is (match? [{:level :error :message "Internal server error: abababababab at :anvil.dispatcher.native-rpc-handlers.util/wrap-async-native-fn(test_function)"}]
                      (the-log))))

        (is (= [{:error {:message "Internal server error: abababababab"
                         :type    "anvil.server.InternalError"}}]
               @respond-calls))
        (is (= [] @update-calls))))

    (testing "with a function throwing an Exception"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [_return-path _context _kwargs _message]
                                (throw (Exception. "Error Message")))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (with-log
          (with-redefs [random/hex #(apply str (repeat % "ab"))]
            (wrapped-fn request return-path))

          (is (match? [{:level :error :message "Internal server error: abababababab at :anvil.dispatcher.native-rpc-handlers.util/wrap-async-native-fn(test_function)"}]
                      (the-log))))

        (is (= [{:error {:message "Internal server error: abababababab"
                         :type    "anvil.server.InternalError"}}]
               @respond-calls))
        (is (= [] @update-calls))))

    (testing "with a function throwing a Throwable"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [_return-path _context _kwargs _message]
                                (throw (Throwable. "Error Message")))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        ;; We log and suppress the Throwable here. Should we re-raise instead?
        (with-log
          (with-redefs [random/hex #(apply str (repeat % "ab"))]
            (wrapped-fn request return-path))

          (is (match? [{:level :error :message "Internal server error: abababababab at :anvil.dispatcher.native-rpc-handlers.util/wrap-async-native-fn(test_function)"}]
                      (the-log))))

        (is (= [{:error {:message "Internal server error: abababababab"
                         :type    "anvil.server.InternalError"}}]
               @respond-calls))
        (is (= [] @update-calls))))

    (testing "with a function dispatching an error"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [return-path _context _kwargs _message]
                                (dispatcher/respond-with-error!
                                  return-path
                                  {:anvil/server-error "Error Message"
                                   :type               "MyError"
                                   :foo                :bar}))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (wrapped-fn request return-path)

        (is (= [{:error {:message "Error Message"
                         :type    "MyError"
                         :foo     :bar
                         :trace   [["<rpc>" 0]]}}]
               @respond-calls))
        (is (= [] @update-calls))))

    (testing "with an incorrect number of arguments"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [return-path _context _kwargs message]
                                (dispatcher/respond! return-path {:response (str "Hello " message "!")}))))

            request {:call {:func   "test_function"
                            :args   [1 2]
                            :kwargs {}}}]

        (wrapped-fn request return-path)

        (is (= [{:error {:message (str "Wrong number of arguments (2) passed to test_function(). "
                                       "Did you pass keyword arguments as positional arguments, or vice versa?")
                         :type    "TypeError"
                         :trace   [["<rpc>" 0]]}}]
               @respond-calls))
        (is (= [] @update-calls))))

    (testing "with a function updating rpc cookies"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [return-path context _kwargs message]
                                (reset! (:rpc-cookies-updated? context) true)
                                (dispatcher/respond! return-path {:response (str "Hello " message "!")}))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (wrapped-fn request return-path)

        (is (= [{:response "Hello World!"}] @respond-calls))
        (is (= [{:set-cookie true}] @update-calls))))

    (testing "with a function using profiling"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-async-native-fn
                              (fn [return-path context _kwargs message]
                                (swap! (:profiles context) conj {:description "Operation"
                                                                 :start-time  1.0
                                                                 :end-time    2.0})
                                (dispatcher/respond! return-path {:response (str "Hello " message "!")}))))
            request {:call          {:func   "test_function"
                                     :args   ["World"]
                                     :kwargs {}}
                     :session-state (atom {:anvil/enable-profiling true})}]

        (wrapped-fn request return-path)

        (is (match? [{:response "Hello World!"
                      :profile {:description "Running native fn"
                                :start-time (any)
                                :end-time (any)
                                :children [{:description "Operation"
                                            :start-time  1.0
                                            :end-time    2.0}]}}]
                    @respond-calls))
        (is (= [] @update-calls))))))
