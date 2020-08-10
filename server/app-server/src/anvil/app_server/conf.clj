(ns anvil.app-server.conf
  (:require [slingshot.slingshot :refer :all]
            [anvil.runtime.conf :as runtime-conf])
  (:import (java.io File)))

(defonce ^:private config (atom {}))

(def DEFAULTS {:origin "http://localhost:3030" :data-dir ".anvil-data"})

(defmacro def-config-var [sym kw]
  `(defn ~sym [] (~kw @config)))

(def-config-var get-app-origin :origin)

(def-config-var get-main-app-id :app)

(defn get-app-package [app-id] (or (get (:dep-id @config) (keyword app-id)) app-id))

(defn get-secret-key-file [] (File. ^String (:data-dir @config) "secret.key"))
(defn get-secret-value [secret-name] (get (:secret @config) (keyword secret-name)))
(defn get-encryption-key [key-name] (get (:encryption-key @config) (keyword key-name)))

(def-config-var get-hostname :hostname)

(def-config-var get-app-path :app-path)

(def-config-var get-downlink-key :downlink-key)

(def-config-var get-uplink-key :uplink-key)

(def-config-var get-client-uplink-key :client-uplink-key)

(def-config-var is-proxied? :proxied?)

(defn set-config! [conf]
  (reset! config (-> (merge DEFAULTS conf)
                     (update-in [:hostname] #(or % (second (re-matches #".*://([^/:]+).*" (str (:url config)))) "localhost"))
                     (update-in [:app-path] #(or % "."))))

  (assert (:database conf))

  (when-not (.isDirectory (File. ^String (:data-dir @config)))
    (throw+ {::config-error (format "data-dir '%s' is not a directory" (:data-dir @config))}))

  (when-not (:app conf)
    (throw+ {::config-error "No app specified to run (use the --app command line option)"}))

  (let [data-path #(.getPath (File. ^String (:data-dir @config) ^String %))]
    (runtime-conf/set-config!
      {:static-root-url                     "/_/static"
       :runtime-common-url                  (:origin conf)
       :db                                  {:classname      "org.postgresql.Driver"
                                             :connection-uri (:database conf)}
       :force-data-table-views-for-everyone true
       :restrict-email-domains?             false
       :app-smtp-config                     (:app-smtp-config conf)
       :data-path                           (:data-dir @config)
       :error-log-path                      (data-path "error.log")
       :live-object-mac-path                (data-path "anvil-live-object-key.txt")
       :google-client-config                (when (:google-client-id conf)
                                              {:custom?       true
                                               :client-id     (:google-client-id conf)
                                               :client-secret (:google-client-secret conf)
                                               :maps-api-key  (:google-api-key conf)})
       :facebook-client-config              (when (:facebook-app-id conf)
                                              {:custom?    true
                                               :app-id     (:facebook-app-id conf)
                                               :app-secret (:facebook-app-secret conf)})
       :microsoft-client-config             (when (:microsoft-app-id conf)
                                              {:custom?            true
                                               :application-id     (:microsoft-app-id conf)
                                               :application-secret (:microsoft-app-secret conf)
                                               :tenant-id          (:microsoft-tenant-id conf)})})))

