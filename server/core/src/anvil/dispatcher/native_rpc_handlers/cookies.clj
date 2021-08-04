(ns anvil.dispatcher.native-rpc-handlers.cookies
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [slingshot.slingshot])
  (:require [clojure.data.json :as json]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.core :as serialiser]
            [anvil.dispatcher.native-rpc-handlers.util :as util]
            [anvil.runtime.secrets :as runtime-secrets]))

(clj-logging-config.log4j/set-logger! :level :info)

(defn serialise-cookie [new-map]
  (let [payload-json (promise)]
    (if new-map
      (try+
        (serialiser/serialise! {:c new-map :id "x"} (fn [json & [^bytes bytes]]
                                                      (when (or bytes (realized? payload-json))
                                                        (throw (Exception. "Cannot serialise Media into cookie.")))
                                                      (deliver payload-json json))
                               false nil false true true)
        (catch :anvil/media-serialisation-error e
          (throw+ {:anvil/server-error "Cannot store Media in cookies."})))
      (deliver payload-json nil))
    (runtime-secrets/encrypt-str-with-global-key :c @payload-json)))

(let [deserialiser (serialiser/mk-Deserialiser)]
  (defn deserialise-cookie [value]
    (try
      (when (not-empty value)
        (log/trace "Deserialise cookie:" value)
        (let [raw-map (json/read-str (runtime-secrets/decrypt-str-with-global-key :c value) :key-fn keyword)
              deserialised-map (serialiser/deserialise deserialiser raw-map)]
          (log/trace "Deserialised cookie:" (pr-str deserialised-map))
          (:c deserialised-map)))
      (catch Exception e
        (log/trace "Deserialise failed:" (str e))
        ;; Couldn't decode the cookie. Pretend there wasn't one.
        nil))))

(defn- expire-cookies [cookies-val]
  (let [now (System/currentTimeMillis)]
    (into {}
          (for [[type-key m] cookies-val]
            [type-key (into {}
                            (for [[k [_ expiry-time :as v]] m]
                              (when (> expiry-time now)
                                [k v])))]))))

(defn- get-raw-cookie-contents [type]
  (if-let [serialised-cookie (get-in @*session-state* [:cookies type])]
    (let [cookie (deserialise-cookie serialised-cookie)]
      (expire-cookies cookie))
    (throw+ {:anvil/server-error "This connection is not from a web browser - cannot access cookies."
             :type "anvil.server.CookieError"
             :anvil/cookie-error true})))

; session-state:
; :cookies -> :local|:shared -> serialised(<cookie-key> -> <user-key> -> [val, expiry])

(defn get-cookie-val
  ([type key] (get-cookie-val type key nil))
  ([type key default]
   (let [session *session-state*
         cookie-key-for-this-app (get-in @session [:cookie-keys type])
         cookie-map (some-> (get-raw-cookie-contents type)
                            (get cookie-key-for-this-app))]
     (if (contains? cookie-map key)
       (first (get cookie-map key))
       default))))

(defn- update-cookie! [type f & args]
  (let [session *session-state*
        cookie-key-for-this-app (get-in @session [:cookie-keys type])
        raw-cookie-value (get-raw-cookie-contents type)
        new-map (apply f (get raw-cookie-value cookie-key-for-this-app) args)
        new-map (into {} (filter (fn [[_ v]] (not (nil? v))) new-map))

        new-cookie-value (assoc raw-cookie-value cookie-key-for-this-app new-map)
        new-serialised-cookie-value (serialise-cookie new-cookie-value)]

    ;; We only serialise the cookie map here so we can work out how big it'll be. Oh well.
    (when (> (count new-serialised-cookie-value) 4000)
      (throw+ {:anvil/server-error "Cookie too big"
               :type "anvil.server.CookieError"
               :anvil/cookie-error true}))

    (reset! *rpc-cookies-updated?* true)
    (swap! session assoc-in [:cookies type] new-serialised-cookie-value)
    (log/trace "New cookie:" new-map)
    nil))

(defn set-cookie! [type keyvals timeout]
  "Merges keyvals into the specified cookie type (:local or :shared). Timeout is in days."
  (update-cookie! type merge (into {} (map (fn [[k v]] [k [v (+ (System/currentTimeMillis) (* 86400000 timeout))]]) keyvals))))

(defn del-cookie! [type key]
  "Deletes specified key from the specified cookie type (:local or :shared)."
  (update-cookie! type dissoc key))

(defn clear-cookie! [type]
  "Deletes specified cookie type (:local or :shared)."
  (update-cookie! type (constantly nil)))

