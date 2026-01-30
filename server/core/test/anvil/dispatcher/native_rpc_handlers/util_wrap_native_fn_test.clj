(ns anvil.dispatcher.native-rpc-handlers.util-wrap-native-fn-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.tools.logging.test :refer [with-log the-log]]
            [crypto.random :as random]
            [matcher-combinators.test]
            [matcher-combinators.matchers :as m]
            [clj-commons.slingshot :refer [throw+]]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.native-rpc-handlers.util :as u]
            [anvil.dispatcher.types :as types]))

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

(deftest test-wrap-native-fn
  (with-no-worker-pool
    (testing "with a function taking an arg and returning a string"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-native-fn
                              (fn [_kwargs message]
                                (str "Hello " message "!"))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (wrapped-fn request return-path)

        (is (= [{:response "Hello World!"}] @respond-calls))
        (is (= [] @update-calls))))

    (testing "with a function taking kwargs and returning a string"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-native-fn
                              (fn [kwargs]
                                (str "Hello " (:message kwargs) "!"))))
            request {:call {:func   "test_function"
                            :args   []
                            :kwargs {:message "World"}}}]

        (wrapped-fn request return-path)

        (is (= [{:response "Hello World!"}] @respond-calls))
        (is (= []  @update-calls))))

    (testing "with a function throwing an Anvil Error"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-native-fn
                              (fn [_kwargs _message]
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

    (testing "with a function throwing an Internal Server Error"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-native-fn
                              (fn [_kwargs _message]
                                (throw (Exception. "Error Message")))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (with-log
          (with-redefs [random/hex #(apply str (repeat % "ab"))]
            (wrapped-fn request return-path))

          (is (match? [{:level :error :message "Internal server error: abababababab at :anvil.dispatcher.native-rpc-handlers.util/wrap-native-fn(test_function)"}]
                      (the-log))))

        (is (= [{:error {:message "Internal server error: abababababab"
                         :type    "anvil.server.InternalError"}}]
               @respond-calls))
        (is (= [] @update-calls))))

    (testing "with an incorrect number of arguments"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-native-fn
                              (fn [_kwargs message]
                                (str "Hello " message "!"))))
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
            wrapped-fn (:fn (u/wrap-native-fn
                              (fn [_kwargs message]
                                (reset! u/*rpc-cookies-updated?* true)
                                (str "Hello " message "!"))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (wrapped-fn request return-path)

        (is (= [{:response "Hello World!"}] @respond-calls))
        (is (= [{:set-cookie true}] @update-calls))))

    (testing "with a function updating live object cache"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-native-fn
                              (fn [_kwargs _message]
                                (u/update-live-object-cache! "test-backend" "test-id"
                                                             {:prop1 "value1" :prop2 "value2"})
                                (types/mk-LiveObjectProxy "test-backend" "test-id" [] ["some_method"]))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}}]

        (wrapped-fn request return-path)

        (is (= [{:response     (types/mk-LiveObjectProxy "test-backend" "test-id" [] ["some_method"])
                 :cacheUpdates {"test-backend" {"test-id" {:prop1 "value1" :prop2 "value2"}}}}]
               @respond-calls))
        (is (= [] @update-calls))))

    (testing "with a function using profiling"
      (let [{:keys [respond-calls update-calls return-path]} (create-test-environment)
            wrapped-fn (:fn (u/wrap-native-fn
                              (fn [_kwargs message]
                                (swap! u/*profiles* conj {:description "Operation"
                                                          :start-time  1.0
                                                          :end-time    2.0})
                                (str "Hello " message "!"))))
            request {:call {:func   "test_function"
                            :args   ["World"]
                            :kwargs {}}
                     :session-state (atom {:anvil/enable-profiling true})}]

        (wrapped-fn request return-path)

        (is (match? [{:response "Hello World!"
                      :profile  {:description "Running native fn"
                                 :start-time  (any)
                                 :end-time    (any)
                                 :children    [{:description "Operation"
                                                :start-time  1.0
                                                :end-time    2.0}]}}]
                    @respond-calls))
        (is (= [] @update-calls))))))
