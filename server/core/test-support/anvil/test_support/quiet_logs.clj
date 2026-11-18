(ns anvil.test-support.quiet-logs
  "Kaocha hook that silences logging during unit test runs.
  Set ANVIL_TEST_LOGS=1 to keep logging on, e.g. when debugging a failing test."
  (:import (org.apache.log4j Level LogManager)))

(defn pre-load [config]
  (when-not (System/getenv "ANVIL_TEST_LOGS")
    (.setThreshold (LogManager/getLoggerRepository) Level/OFF))
  config)
