(ns anvil.logging
  (:use [clj-logging-config.log4j])
  (:require [anvil.runtime.conf :as conf])
  (:import [org.apache.log4j Logger RollingFileAppender EnhancedPatternLayout]))

; Disable all logging
(set-logger! (Logger/getRootLogger) :level :off)

(defn setup-logging! []

  ; Enable console logging for Anvil
  (set-logger! "anvil"
               :level :info
               :name "_default"
               :out :console
               :pattern "[%-5p %c] %m%n")

  ; Add an appender which will write messages at level :error and above to a file.
  (when conf/error-log-path
    (set-logger! "anvil"
                 :name "_error"
                 :threshold :error
                 :out (doto (RollingFileAppender. (EnhancedPatternLayout. "%d [%-5p %c] %m%n")
                                                  conf/error-log-path
                                                  true)
                        (.setMaximumFileSize 10000000)      ; Roll after 10 MB
                        (.setMaxBackupIndex 5)))))          ; Keep five previous rolled log files