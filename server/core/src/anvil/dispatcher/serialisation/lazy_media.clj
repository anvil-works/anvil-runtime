(ns anvil.dispatcher.serialisation.lazy-media
  (:require [slingshot.slingshot :refer [throw+ try+]]
            [anvil.util :as util]
            [crypto.random :as random]
            [anvil.dispatcher.types :refer [map->LazyMedia]]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]))

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

(defn get-lazy-media
  ([request {:keys [manager key id] :as lazy-media}] (get-lazy-media request manager key id))
  ([{:keys [session-state] :as request} manager-id media-key media-id]
   (if-not (mac-matches? media-key manager-id media-id session-state)
     (throw+ {:anvil/lazy-media-error "Invalid (Lazy) Media object"})
     (if-let [manager-handler (get @managers manager-id)]
       (manager-handler request media-id)
       (throw+ {:anvil/lazy-media-error (str "Invalid (Lazy) Media type " (pr-str manager-id))})))))

(defn mk-LazyMedia-with-correct-mac [{:keys [manager id] :as o} request]
  (map->LazyMedia (assoc o :key (generate-mac manager id (:session-state request)))))
