(ns anvil.dispatcher.serialisation.lazy-media
  (:require [anvil.util :as util]
            [crypto.random :as random]
            [anvil.dispatcher.types]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util])
  (:import (anvil.dispatcher.types SerialisableForRpc Media MediaDescriptor)))

(defonce managers (atom {}))

(defn generate-mac [manager id session-state]
  (let [secret (-> (swap! session-state (fn [x] (if-not (:lazy-media-secret x)
                                                  (assoc x :lazy-media-secret (random/base64 32))
                                                  x)))
                   (:lazy-media-secret))]

    (.substring (util/sha-256 (str
                                secret
                                (pr-str [manager id])
                                secret))
                32)))

(defn- mac-matches? [candidate-val manager id session-state]
  (let [real-val (generate-mac manager id session-state)]
    (= (util/sha-256 real-val) (util/sha-256 candidate-val))))

(defn get-lazy-media [{:keys [app-id app session-state environment] :as request} manager-id media-key media-id]
  (if-not (mac-matches? media-key manager-id media-id session-state)
    (throw (Exception. "Invalid (Lazy) Media object"))
    (if-let [manager-handler (get @managers manager-id)]
      (manager-handler request media-id)
      (throw (Exception. (str "Invalid (Lazy) Media type " (pr-str manager-id)))))))

(defn mk-LazyMedia [{:keys [manager key id mime-type length name] :as o} request]
  (let [real-media (delay (get-lazy-media request manager key id))]
    (reify
      MediaDescriptor
      (getContentType [_this] (or mime-type (.getContentType @real-media)))
      (getName [_this] (or name (.getName @real-media)))
      Media
      (getLength [_this] (or length (.getLength @real-media)))
      (getInputStream [_this] (.getInputStream @real-media))
      SerialisableForRpc
      (serialiseForRpc [_this _lo-key] o))))

(defn mk-LazyMedia-with-correct-mac [{:keys [manager id type] :as o} request]
  (mk-LazyMedia (assoc o :key (generate-mac manager id (:session-state request))
                         :type (or type ["LazyMedia"]))
                request))
