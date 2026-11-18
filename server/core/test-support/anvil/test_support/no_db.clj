(ns anvil.test-support.no-db
  "Kaocha hook that makes unit tests fail fast when they try to open a database connection.
  This means they fail even if a real DB is running on the dev machine."
  (:require [clojure.java.jdbc :as jdbc]
            [clojure.test :as t]))

(defn- refuse-connection
  ;; Don't include the db spec in the message: it may hold credentials.
  [& _]
  (let [e (ex-info (str "Unit test tried to open a database connection. "
                        "Stub the data-layer call (e.g. with with-redefs) instead.")
                   {:anvil.test-support/db-access-in-unit-test true})]
    ;; Reporting first means the test fails even if the code under test catches the exception.
    (t/do-report {:type :error, :message (ex-message e), :expected nil, :actual e})
    (throw e)))

(defn pre-load [config]
  (alter-var-root #'jdbc/get-connection (constantly refuse-connection))
  config)
