(ns anvil.logging
  (:use [clj-logging-config.log4j])
  (:require [anvil.runtime.conf :as conf])
  (:import [org.apache.log4j Logger RollingFileAppender EnhancedPatternLayout]))

;; This is a sensible default:
(set-logger! (Logger/getRootLogger) :level :warn)

;; ...however, a bunch of our libraries are *really* noisy, so we should turn them off.
;; Do something like this:
;; (clj-logging-config.log4j/set-logger! "com.onelogin.saml2" :level :off)

;; Configure console logging as early as possible on startup.
(defn setup-logging! []

  ; Enable console logging for Anvil
  (set-logger! "anvil"
               :level :info
               :name "_default"
               :out :console
               :pattern "[%-5p %c] %m%n")

  (set-logger! "marshal-py"
               :level :info
               :name "_default_marshal"
               :out :console
               :pattern "[%-5p %c] %m%n"))

;; Do this separately, because the app server won't have initialised its data directory until later.
(defn setup-file-logging! []
  (when conf/error-log-path
    ; Add an appender which will write messages at level :error and above to a file.
    (set-logger! "anvil"
                 :name "_error"
                 :threshold :error
                 :out (doto (RollingFileAppender. (EnhancedPatternLayout. "%d [%-5p %c] %m%n")
                                                  conf/error-log-path
                                                  true)
                        (.setMaximumFileSize 10000000)      ; Roll after 10 MB
                        (.setMaxBackupIndex 5))))) ; Keep five previous rolled log files