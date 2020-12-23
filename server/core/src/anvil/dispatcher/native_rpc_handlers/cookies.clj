(ns anvil.dispatcher.native-rpc-handlers.cookies
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [slingshot.slingshot])
  (:require [clojure.data.json :as json]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.core :as serialiser]
            [anvil.dispatcher.native-rpc-handlers.util :as util]
            [anvil.runtime.secrets :as runtime-secrets]))

(clj-logging-config.log4j/set-logger! :level :debug)

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
  (defn deserialise-cookie [{:keys [value]}]
    (try
      (when value
        (log/trace "Deserialise cookie:" value)
        (let [raw-map (json/read-str (runtime-secrets/decrypt-str-with-global-key :c value) :key-fn keyword)
              deserialised-map (serialiser/deserialise deserialiser raw-map util/*req*)]
          (log/trace "Deserialised cookie:" (pr-str deserialised-map))
          (:c deserialised-map)))
      (catch Exception e
        (log/trace "Deserialise failed:" (str e))
        ;; Couldn't decode the cookie. Pretend there wasn't one.
        nil))))

(defn- get-cookie-atom [type]
  (if-let [cookie (get-in @*session-state* [:cookies type])]
    (do (doseq [[type-key m] @cookie]
          (doseq [[k [_ expiry-time]] m]
            (when (< expiry-time (System/currentTimeMillis))
              (swap! cookie update-in [type-key] dissoc k))))
        cookie)
    (throw+ {:anvil/server-error "This connection is not from a web browser - cannot access cookies."
             :type "anvil.server.CookieError"
             :anvil/cookie-error true})))

(defn get-cookie-val
  ([type key] (get-cookie-val type key nil))
  ([type key default]
   (let [cookie-map (get @(get-cookie-atom type) (get-in @*session-state* [:cookie-keys type]))]
     (if (contains? cookie-map key)
       (first (get cookie-map key))
       default))))

(defn- update-cookie! [type f & args]
  (let [cookie-atom (get-cookie-atom type)
        new-map (apply update-in @cookie-atom [(get-in @*session-state* [:cookie-keys type])] f args)
        new-map (into {} (filter (fn [[_ v]] (not (nil? v))) new-map))]

    ;; We only serialise the cookie map here so we can work out how big it'll be. Oh well.
    (when (> (count (serialise-cookie new-map)) 4000)
      (throw+ {:anvil/server-error "Cookie too big"
               :type "anvil.server.CookieError"
               :anvil/cookie-error true}))

    (reset! *rpc-cookies-updated?* true)
    (reset! cookie-atom new-map)
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

