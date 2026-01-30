(ns anvil.dispatcher.native-rpc-handlers.http-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.tools.logging.test :refer [with-log the-log]]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.native-rpc-handlers.http]
            [matcher-combinators.test]
            [matcher-combinators.matchers :as m]
            [org.senatehouse.expect-call :refer [expect-call]]
            [org.httpkit.client :as http]))

(defmacro with-no-worker-pool [& body]
  `(with-redefs [worker-pool/run-task!* (fn [f# _#] (f#))]
     ~@body))

(defn create-test-environment []
  (let [respond-calls (atom [])]
    {:respond-calls respond-calls
     :return-path {:respond! (fn [response] (swap! respond-calls conj response))}}))


(deftest test-http-request-async-success
  (with-no-worker-pool
    (testing "Successful HTTP request responds with the content"
      (let [{:keys [respond-calls return-path]} (create-test-environment)
            request {:call {:func   "anvil.private.http.request"
                            :kwargs {:url "https://example.com"}}}

            wrapped-fn (get-in @dispatcher/native-rpc-handlers
                               ["anvil.private.http.request" :fn])]

        (expect-call (http/request [req callback]
                                   (is (match? {:url "https://example.com"} req))
                                   (callback {:status 200
                                              :headers {"content-type" "text/plain"}
                                              :body "Hello, World!"}))
          (wrapped-fn request return-path))

        (is (match? [{:response {:status 200
                                 :headers {"content-type" "text/plain"}
                                 :content (m/via #(String. (.bytes %)) "Hello, World!")}}]
                    @respond-calls))))

    (testing "Asynchronous HTTP request failure responds with an HttpReqeustFailed error"
      (let [{:keys [respond-calls return-path]} (create-test-environment)
            request {:call {:func   "anvil.private.http.request"
                            :kwargs {:url "https://example.com"}}}

            wrapped-fn (get-in @dispatcher/native-rpc-handlers
                               ["anvil.private.http.request" :fn])]

        (expect-call (http/request [_ callback] (callback {:error (Exception. "An Error")}))
          (wrapped-fn request return-path))

        (is (match? [{:error {:message "An Error"
                              :type    "anvil.http.HttpRequestFailed"}}]
                    @respond-calls))))

    (testing "Synchronous HTTP request failure responds with an Internal Server Error"
      (let [{:keys [respond-calls return-path]} (create-test-environment)
            request {:call {:func   "anvil.private.http.request"
                            :kwargs {:url "https://example.com"}}}

            wrapped-fn (get-in @dispatcher/native-rpc-handlers
                               ["anvil.private.http.request" :fn])]

        (with-log
          (expect-call (http/request [_ _] (throw (Exception. "An Error")))
            (wrapped-fn request return-path))

          (is (match? (m/embeds [{:level :error}]) (the-log)))
          (is (match? [{:error {:type "anvil.server.InternalError"}}] @respond-calls)))))
    ))
