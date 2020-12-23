(ns anvil.runtime.conf
  (:require clj-logging-config.log4j))

;; Configuration of the core Anvil runtime.
;; Services using the runtime should use (set-config!) to set any variables that should differ from their defaults.

(defonce data-path (or (System/getenv "ANVIL_DATA_DIRECTORY") "/data"))

(defonce error-log-path (str data-path "/error.log"))

(defonce live-object-mac-path (str data-path "/anvil-live-object-key.txt"))

(defonce saml-paths {:private-key (str data-path "/anvil-saml-private-key.pem")
                     :public-key  (str data-path "/anvil-saml-public-key.pem")
                     :certificate (str data-path "/anvil-saml-cert.pem")})

(defonce geoip-db-path nil)

;; Don't ask me why this (str) is required to keep Cursive happy
(defonce static-root-url (str "https://localhost:3000/_/static"))

(defonce runtime-common-url (str "https://localhost:3000"))

(defonce db nil)

(defonce db-pool-params {:driverClass              "org.postgresql.Driver"
                         :minPoolSize              0
                         :maxPoolSize              10
                         :maxConnectionAge         3600
                         :checkoutTimeout          5000
                         :maxIdleTime              3600
                         :breakAfterAcquireFailure false})

(defonce db-transaction-timeout 10000)

(defonce force-data-table-views-for-everyone false)

(defonce restrict-email-domains? true)

(defonce google-client-config nil)

(defonce facebook-client-config nil)

(defonce microsoft-client-config nil)

(defonce stripe-client-config nil)

(defonce app-smtp-config {})

(def max-websocket-payload 16777216)

(def max-http-body 16777216)

(def runtime-session-expire-seconds (* 30 60))

(def anvil-version "<unknown>")

(defonce app-cookie-names {:local  "anvilapp"
                           :shared "anvilapp-shared"})

(def force-secure-cookies? true)

(def permit-url-session-tokens? true)

(defn set-config! [hook-map]
  (let [vars (-> (ns-publics 'anvil.runtime.conf)
                 (dissoc 'set-config!))]
    (doseq [[kw val] hook-map]
      (if-let [var (get vars (symbol (name kw)))]
        (alter-var-root var (constantly val))
        (throw (Exception. (format "%s is not a runtime config var")))))))
