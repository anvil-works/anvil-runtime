(ns anvil.dispatcher.serialisation.live-objects
  (:use clojure.set
        slingshot.slingshot)
  (:require [anvil.util :as util]
            [anvil.dispatcher.types :as types]
            [clojure.tools.logging :as log]))

(def mk-LiveObjectProxy types/mk-LiveObjectProxy)

(defn valid-mac? [{:keys [mac backend id permissions] :as live-object} extra-liveobject-key]
  (log/trace "Testing mac for" backend id permissions extra-liveobject-key "(" mac ")")
  (= (util/sha-256 mac)
     (util/sha-256 (types/gen-live-object-mac live-object extra-liveobject-key))))

(defn load-LiveObjectProxy [live-object-map {:keys [permitted-live-object-backends get-session-liveobject-key] :as _config}]
  (let [live-object-proxy (types/map->LiveObjectProxy live-object-map)]
    (if (or (some #(.startsWith (:backend live-object-map) %) permitted-live-object-backends)
            (valid-mac? live-object-map (when get-session-liveobject-key (get-session-liveobject-key))))
      live-object-proxy

      (do
        (log/info "Invalid LiveObject MAC" (pr-str live-object-map))
        (throw+ {:anvil/invalid-mac "Invalid LiveObject MAC"})))))


;; Utility function, might want to go elsewhere
(defn get-seen-liveobjects
  ([data]
   (cond
     (instance? anvil.dispatcher.types.LiveObjectProxy data)
     (merge-with union
                 {(:backend data) #{(:id data)}}
                 (get-seen-liveobjects (:itemCache data)))

     (vector? data)
     (apply merge-with union (map get-seen-liveobjects data))

     (map? data)
     (into {}
           (for [[k v] data]
             [k (get-seen-liveobjects v)]))

     :else
     {}))
  ([data & more-data] (apply merge-with union (map get-seen-liveobjects (cons data more-data)))))

(defn filter-cache-updates [cache-updates seen-liveobjects]
  (into {}
        (for [[backend updates] cache-updates :let [seen-ids (get seen-liveobjects backend)] :when seen-ids]
          [backend (select-keys updates seen-ids)])))
