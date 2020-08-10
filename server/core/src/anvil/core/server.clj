(ns anvil.core.server
  (:require [org.httpkit.server :as http-kit]
            [anvil.runtime.conf :as conf]
            [clojure.tools.logging :as log]
            [anvil.util :as util]
            [anvil.metrics :as metrics]
            [anvil.core.worker-pool :as worker-pool]))

(clj-logging-config.log4j/set-logger! :level :info)

(defn run-server [ip port handler]
  (http-kit/run-server handler
                       {:ip           ip
                        :port         port
                        :max-ws       conf/max-websocket-payload
                        :max-body     conf/max-http-body
                        :worker-pool  worker-pool/pool
                        :error-logger util/report-uncaught-exception
                        :warn-logger  util/report-uncaught-exception})

  (log/info "HTTP Server running on port" port))