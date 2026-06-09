(ns anvil.runtime.theme-asset-etag-test
  (:require [anvil.runtime.app-data :as app-data]
            [anvil.runtime.server :as runtime-server]
            [clojure.test :refer [deftest is testing]]))

(defn- theme-response
  [asset & [headers]]
  (with-redefs [runtime-server/get-app-from-request (fn [_] {:content {}})
                app-data/get-asset (fn [_ asset-name]
                                     (when (= "theme.css" asset-name)
                                       asset))]
    (runtime-server/app-routes {:request-method :get
                                :uri "/_/theme/theme.css"
                                :headers (or headers {})})))

(deftest theme-asset-route-returns-etag-on-200
  (let [response (theme-response {:name "theme.css" :content "Ym9keQ=="})]
    (is (= 200 (:status response)))
    (is (= "body" (slurp (:body response))))
    (is (string? (get-in response [:headers "ETag"])))
    (is (= "true" (get-in response [:headers "X-Anvil-Cacheable"])))))

(deftest theme-asset-route-returns-304-when-if-none-match-matches
  (let [initial (theme-response {:name "theme.css" :content "Ym9keQ=="})
        etag (get-in initial [:headers "ETag"])
        response (theme-response {:name "theme.css" :content "Ym9keQ=="} {"if-none-match" etag})]
    (is (= 304 (:status response)))
    (is (= etag (get-in response [:headers "ETag"])))
    (is (= "true" (get-in response [:headers "X-Anvil-Cacheable"])))))

(deftest theme-asset-route-does-not-match-unquoted-if-none-match
  (let [initial (theme-response {:name "theme.css" :content "Ym9keQ=="})
        etag (get-in initial [:headers "ETag"])
        unquoted (subs etag 1 (dec (count etag)))
        response (theme-response {:name "theme.css" :content "Ym9keQ=="} {"if-none-match" unquoted})]
    (is (= 200 (:status response)))))

(deftest theme-asset-route-etag-changes-when-content-changes
  (let [response-a (theme-response {:name "theme.css" :content "Ym9keQ=="})
        response-b (theme-response {:name "theme.css" :content "cGFkZGluZzow"})
        etag-a (get-in response-a [:headers "ETag"])
        etag-b (get-in response-b [:headers "ETag"])]
    (is (not= etag-a etag-b))))

(deftest theme-asset-route-etag-prefers-hash
  (let [response (theme-response {:name "theme.css" :content "Ym9keQ==" :hash "abc123oid"})]
    (is (= "\"abc123oid\"" (get-in response [:headers "ETag"])))))
