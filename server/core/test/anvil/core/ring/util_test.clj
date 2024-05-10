(ns anvil.core.ring.util-test
  (:require [clojure.test :refer :all]
            [anvil.core.ring.util :as ring-util :refer :all]
            [org.httpkit.server :as http-kit]
            [anvil.core.worker-pool :as worker-pool])
  (:import (org.httpkit.server Channel)))

(def test-sync-handler (fn [req]
                         (println "Inner sync handler got" req)
                         {:respond-to-request (dissoc req :async-channel ::ring-util/request-snapshots)}))

(def test-async-handler (fn [req]
                          (http-kit/with-channel req chan
                            (worker-pool/spawn-thread!
                              (Thread/sleep 1000)
                              (http-kit/send! chan {:respond-to-request (dissoc req :async-channel ::ring-util/request-snapshots)})))))

(def test-sync-middleware
  (fn [name] (fn [f]
               (fn smw-handler [req]
                 (println "Middleware" name "got" (dissoc req :async-channel))
                 (let [req (update req :in-order #(conj (or % []) (keyword name)))
                       resp (-> (f req)
                                (update :out-order #(conj (or % []) (keyword name))))]
                   (println "Middleware" name " responding" resp)
                   resp)))))

(def test-async-middleware (fn [name] [(fn amw-handle-req [req]
                                         (println "Async" name "got" (dissoc req :async-channel ::ring-util/request-snapshots))
                                         (update req :in-order #(conj (or % []) (keyword name))))
                                       (fn amw-handle-resp [req resp]
                                         (let [resp (update resp :out-order #(conj (or % []) (keyword name)))]
                                           (println "Async" name "responding" resp "to" (dissoc req :async-channel ::ring-util/request-snapshots))
                                           resp))]))

(def test-stack
  [(test-sync-middleware "foo")
   (test-sync-middleware "bar")
   (test-async-middleware "baz")
   (test-sync-middleware "qux")])

(def sync-stack (wrap-async test-sync-handler test-stack))
(def async-stack (wrap-async test-async-handler test-stack))

(deftest test-sync-stack
  (is (= (sync-stack {})
         {:respond-to-request {:in-order [:qux :baz :bar :foo]}
          :out-order [:foo :bar :baz :qux]})))

(deftest test-async-stack
  (let [response-promise (promise)
        chan (reify Channel
               (send! [_this data close?]
                 (deliver response-promise data)))]
    (is (instance? Channel (:body (async-stack {:async-channel chan}))))
    (is (= @response-promise
           {:respond-to-request {:in-order [:qux :baz :bar :foo]}
            :out-order          [:foo :bar :baz :qux]}))))

