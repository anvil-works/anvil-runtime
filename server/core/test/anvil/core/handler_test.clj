(ns anvil.core.handler-test
  (:require [clojure.test :refer :all]
            [ring.mock.request :as mock]
            #_[anvil.core.routes :refer :all]
            [clojure.java.io :as io])
  (:import (java.io File)))

#_(deftest test-app
  (testing "main route"
    (let [response (app (mock/request :get "/"))]
      (is (= (:status response) 200))
      (is (= (:body response) (io/resource "website/index.html")))))
  
  (testing "not-found route"
    (let [response (app (mock/request :get "/invalid"))]
      (is (= (:status response) 404)))))
