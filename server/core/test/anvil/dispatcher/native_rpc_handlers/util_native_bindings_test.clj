(ns anvil.dispatcher.native-rpc-handlers.util-native-bindings-test
  (:require [clojure.test :refer [deftest is testing]]
            [matcher-combinators.test]
            [anvil.core.tracing :refer [get-current-span get-trace-id with-span]]
            [anvil.dispatcher.native-rpc-handlers.util :as u]))

(defn create-test-environment []
  (let [update-calls (atom [])]
    {:update-calls update-calls
     :return-path {:update!  (fn [data] (swap! update-calls conj data))}}))

(deftest test-native-bindings-from-request
  (testing "native bindings are created from a request"
    (with-span ["test-span"]
      (let [req {:app-id        1
                 :app           2
                 :app-info      3
                 :environment   4
                 :app-origin    5
                 :thread-id     6
                 :tracing-span  (get-current-span)
                 :session-state 7
                 :origin        :client}]

        (u/with-basic-native-bindings-from-request req
          (is (= 1 u/*app-id*))
          (is (= 2 u/*app*))
          (is (= 3 u/*app-info*))
          (is (= 4 u/*environment*))
          (is (= 5 u/*app-origin*))
          (is (= req u/*req*))
          (is (= 6 u/*thread-id*))
          (is (= (get-trace-id) u/*trace-id*))
          (is (= 7 u/*session-state*))
          (is (= :client u/*request-origin*))
          (is (true? u/*client-request?*)))

        (u/with-native-bindings-from-request req nil
          (is (= 1 u/*app-id*))
          (is (= 2 u/*app*))
          (is (= 3 u/*app-info*))
          (is (= 4 u/*environment*))
          (is (= 5 u/*app-origin*))
          (is (= req u/*req*))
          (is (= 6 u/*thread-id*))
          (is (= (get-trace-id) u/*trace-id*))
          (is (= 7 u/*session-state*))
          (is (= :client u/*request-origin*))
          (is (true? u/*client-request?*))))))

  (testing "*rpc-print* binding dispatches an update"
    (let [{:keys [update-calls return-path]} (create-test-environment)]
      (u/with-native-bindings-from-request nil return-path
        (u/*rpc-print* "Hello" "World"))

      (is (= [{:output "Hello World"}] @update-calls))))

  (testing "*rpc-println* binding dispatches an update"
    (let [{:keys [update-calls return-path]} (create-test-environment)]
      (u/with-native-bindings-from-request nil return-path
        (u/*rpc-println* "Hello" "World"))

      (is (= [{:output "Hello World"}
              {:output "\n"}]
             @update-calls))))

  (testing "*rpc-update!* binding dispatches an update"
    (let [{:keys [update-calls return-path]} (create-test-environment)]
      (u/with-native-bindings-from-request nil return-path
        (u/*rpc-update!* {:output "Hi"}))

      (is (= [{:output "Hi"}] @update-calls))))

  (testing "*rpc-cookies-updated?* is bound to an atom"
    (let [{:keys [return-path]} (create-test-environment)]
      (u/with-native-bindings-from-request nil return-path
        (is (false? @u/*rpc-cookies-updated?*))))))