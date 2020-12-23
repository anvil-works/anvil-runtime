(ns anvil.dispatcher.serialisation.core
  (:require [digest]
            [crypto.random :as random]
            [clojure.data.json :as json]
            [clojure.tools.logging :as log]
            [org.httpkit.server :as ws]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [anvil.dispatcher.types]
            [anvil.util :as util]
            [anvil.dispatcher.types :as types])
  (:use [clojure.core.async :only [<! <!! >! >!! go go-loop chan close!]]
        [clojure.pprint]
        [slingshot.slingshot])
  (:import (java.util LinkedList Arrays)
           (clojure.lang Counted)
           (anvil.dispatcher.types MediaDescriptor Media SerialisableForRpc ChunkedStream Date DateTime SerializedPythonObject)
           (java.io InputStream)
           (java.time.format DateTimeFormatter)
           (java.time ZoneOffset)))

;;(clj-logging-config.log4j/set-logger! :level :trace)

;; You'll need one of these per incoming websocket
(defprotocol Deserialiser
  (deserialise [this payload request] "Returns a deserialised version of the payload map, with LiveObjects and Media reconstructed")
  (processBlobHeader [this hdr] "Tells the deserialiser that the next blob is described by this header map")
  (processBlob [this blob] "A blob has arrived; deliver it to the appropriate Media object")
  (loadLiveObject [this lo-map] "Load a LiveObject (or nil) and check for validity"))


(deftype InfiniteBuffer [^LinkedList buf]
  clojure.core.async.impl.protocols/Buffer
  (full? [_this] false)
  (remove! [_this] (.removeLast buf))
  (add!* [_this item] (.addFirst buf item))
  (close-buf! [_this])
  Counted
  (count [_this] (.size buf)))

(defn infinite-buffer [] (InfiniteBuffer. (LinkedList.)))

(defn disassemble-objects
  ([data do-these-keys-first] (disassemble-objects data '() nil do-these-keys-first))
  ([data path extra-liveobject-key do-these-keys-first]
   (cond
     (instance? SerialisableForRpc data) [nil [(assoc (.serialiseForRpc data extra-liveobject-key) :path path)]]

     (or (instance? ChunkedStream data)
         (instance? Media data))
     [nil [{:path         path, :type ["DataMedia"], :id (random/base64 10),
            :mime-type    (.getContentType data), :name (.getName data),
            :binary-media data}]]

     (instance? SerializedPythonObject data)
     (let [[disassembled-dict dict-objects] (disassemble-objects (:value data) path extra-liveobject-key nil)]
       [disassembled-dict (doall (concat dict-objects [{:path     path
                                                        :type     ["ValueType"]
                                                        :typeName (:type data)}]))])

     (map? data)
     (reduce (fn [[json data] [k v]]
               (let [[new-v new-data] (disassemble-objects v (concat path [(util/preserve-slashes k)]) extra-liveobject-key nil)]
                 [(assoc json k new-v) (doall (concat data new-data))]))
             [{} []]
             (if do-these-keys-first
               (concat (select-keys data do-these-keys-first)
                       (apply dissoc data do-these-keys-first))
               data))

     (sequential? data)
     (let [rets (map-indexed (fn [idx v] (disassemble-objects v (concat path [idx]) extra-liveobject-key nil)) data)]
       [(apply vector (map first rets)) (doall (mapcat second rets))])

     (instance? BigInteger data)
     [nil [{:path path
            :type ["Long"]
            :value (str data)}]]

     (and (instance? Number data)
          (or (Double/isNaN (double data))
              (= Double/POSITIVE_INFINITY data)
              (= Double/NEGATIVE_INFINITY data)))
     [nil [{:path path
            :type ["Float"]
            :value (str data)}]]

     (or (number? data) (string? data) (= false data) (= true data) (nil? data))
     [data '()]

     (keyword? data)
     [(name data) '()]

     (instance? java.util.Date data)
     [nil [(-> (DateTime.
                 (-> (DateTimeFormatter/ofPattern (str "yyyy-MM-dd HH:mm:ss.SSSSSS'Z'"))
                     (.withZone (ZoneOffset/UTC))
                     (.format (.toInstant ^java.util.Date data))))
               (.serialiseForRpc extra-liveobject-key)
               (assoc :path path))]]

     :else
     (throw (Exception. (str "Cannot return a " (.getClass data) " object at " (pr-str path)))))))

(defn prune-liveobject-methods [objects]
  (loop [[obj & more-objs :as objects] objects
         known-liveobject-methods {}
         pruned-objects '()]
    (cond
      (empty? objects)
      (reverse pruned-objects)

      (some #{"LiveObject"} (:type obj))
      (if (= (:methods obj) (known-liveobject-methods (:backend obj)))
        (recur more-objs
               known-liveobject-methods
               (cons (dissoc obj :methods) pruned-objects))
        (recur more-objs
               (assoc known-liveobject-methods (:backend obj) (:methods obj))
               (cons obj pruned-objects)))

      :else
      (recur more-objs
             known-liveobject-methods
             (cons obj pruned-objects)))))


(defn assemble-object [outstanding-media message-id {:keys [app-id app session-state origin] :as request} {:keys [permitted-live-object-backends session-liveobject-key] :as serialisation-config} known-liveobject-methods {:keys [type] :as obj}]
  (let [mk-chunk-stream (fn [request-id {:keys [id name mime-type]}]
                          (let [c (chan (infinite-buffer))
                                have-consumed? (atom false)]
                            (log/trace "Storing channel" c " for " (pr-str [request-id id]))
                            (swap! outstanding-media assoc-in [request-id id] c)
                            (reify
                              MediaDescriptor
                              (getContentType [_this] mime-type)
                              (getName [_this] name)
                              ChunkedStream
                              (consume [_this f]
                                (when-not (compare-and-set! have-consumed? false true)
                                  (throw (IllegalStateException. "Cannot consume a ChunkedStream twice")))
                                (go-loop []
                                  (when-let [chunk-args (<! c)]
                                    (log/trace "Providing chunk" (pr-str chunk-args))
                                    (apply f chunk-args)
                                    (recur)))))))


        handlers {"Primitive"  #(:value obj)
                  "DataMedia"  #(mk-chunk-stream message-id obj)
                  "LazyMedia"  #(lazy-media/mk-LazyMedia obj request)
                  "LiveObject" (fn [] (let [o (if (not= origin :client)
                                                obj
                                                (dissoc obj :itemCache :iterItems))

                                            o (if (:methods o)
                                                (do
                                                  (swap! known-liveobject-methods assoc (:backend o) (:methods o))
                                                  o)
                                                (assoc o :methods (get @known-liveobject-methods (:backend o))))

                                            o (-> (dissoc o :path :type)
                                                  (update-in [:itemCache]
                                                             #(reduce (fn [cache [name val]]
                                                                        (assoc cache name (assemble-object outstanding-media message-id request serialisation-config known-liveobject-methods val)))
                                                                      {} %)))

                                            o (if (:iterItems o)
                                                (update-in o [:iterItems :items] (fn [items]
                                                                                   (doall (map #(assemble-object outstanding-media message-id request serialisation-config known-liveobject-methods %) items))))
                                                o)]
                                        (live-objects/load-LiveObjectProxy (dissoc o :path :type) serialisation-config)))
                  "Capability" (fn [] (let [{:keys [scope narrow mac]} obj]
                                        (when-not (or
                                                    ;; Server code may generate non-Anvil-scoped capabilities
                                                    (and (nil? mac) (not= origin :client)
                                                         (first scope) (not= (first scope) "_"))
                                                    ;; Everything else has to match
                                                    (and mac (= (util/sha-256 (types/gen-cap-mac obj session-liveobject-key))
                                                                (util/sha-256 mac))))
                                          (do
                                            (log/info "Invalid Capability MAC" (pr-str mac))
                                            (throw (Exception. "Invalid Capability"))))
                                        (types/->Capability (concat scope narrow))))
                  "Date"       #(Date. (:value obj))
                  "DateTime"   #(DateTime. (:value obj))
                  "Long"       #(BigInteger. ^String (:value obj))
                  "Float"      #(Double/parseDouble (:value obj))
                  "ValueType"  #(:typeName obj)}]

    (if-let [handler (some handlers type)]
      (let [deserialised-obj (handler)]
        (log/trace (:origin request))
        (log/trace "Deserialised\n" (with-out-str (pprint obj)))
        (log/trace "into\n" (with-out-str (pprint deserialised-obj)))
        deserialised-obj)
      (throw (Exception. (str "Cannot deserialise an object of type '" (first type) "'"))))))


(defn serialise!
  "Asynchronously serialise a given payload down a websocket-shaped thing.
  The payload map may contain LiveObjects and Media.
  send! will be called with one parameter for string-shaped things, and two parameters
  for string header + byte[] payload."
  [payload send! serialise-errors? & [extra-liveobject-key no-live-object-pruning strip-item-caches? disallow-media?]]

  (log/trace "Serialising" payload)

  (when-not (:id payload)
    (throw (Exception. "Any serialised payload needs an ID")))
  (let [request-id (:id payload)
        [payload-json objects] (try
                                 (disassemble-objects payload nil extra-liveobject-key [:vt_global])
                                 (catch Exception e
                                   (if serialise-errors?
                                     (let [error-id (random/hex 6)]
                                       (log/error e "Error in disassemble objects:" error-id)
                                       [{:id request-id, :error {:type "anvil.server.InternalError" :message (str "Internal server error: " error-id)}} []])
                                     (throw e))))

        objects (if no-live-object-pruning objects (prune-liveobject-methods objects))
        objects (if strip-item-caches? (map #(dissoc % :itemCache) objects) objects)

        payload-json (assoc payload-json :objects
                                         (map #(dissoc % :binary-media) objects))

        media-objects (filter :binary-media objects)]

    (log/trace "Payload disassembled into json:\n" (with-out-str (pprint (dissoc payload-json :objects))))
    (log/trace "and objects:\n" (with-out-str (pprint objects)))

    (send! (util/write-json-str payload-json))

    (doseq [{:keys [_type id binary-media]} media-objects]
      (when disallow-media?
        (throw+ {:anvil/media-serialisation-error true}))
      (if (instance? ChunkedStream binary-media)
        (.consume binary-media (fn [chunk-idx last-chunk? data]
                                 (send! (util/write-json-str {:type       "CHUNK_HEADER", :requestId request-id, :mediaId id,
                                                              :chunkIndex chunk-idx, :lastChunk last-chunk?})
                                        data)))

        ;; It's Media, not a ChunkedStream. All we have is an InputStream, so we soldier on...
        (let [^InputStream is (.getInputStream binary-media)
              ^bytes b (byte-array 64000)]

          (loop [idx 0]
            (let [nb (max (.read is b) 0)
                  last-chunk? (<= nb 0)
                  buf (if (= nb (alength b)) b (Arrays/copyOf b (int nb)))]

              (send! (util/write-json-str {:type       "CHUNK_HEADER", :requestId request-id, :mediaId id
                                           :chunkIndex idx, :lastChunk last-chunk?})
                     buf)

              (if last-chunk?
                (.close is)
                (recur (inc idx))))))))))

(defn serialise-to-websocket! [payload channel serialise-errors? session-liveobject-key prune-liveobjects?]
  (serialise! payload (fn [json & [^bytes bytes]]
                        (locking channel
                          (ws/send! channel json)
                          (when bytes
                            (ws/send! channel bytes)))) serialise-errors? session-liveobject-key (not prune-liveobjects?)))

;; Serialise something to a map for storage
(defn serialise-to-map [payload]
  (let [r (atom nil)
        p (if (contains? payload :id) payload (assoc payload :id "DUMMY"))]
    (serialise! p (fn [json & _] (reset! r (json/read-str json, :key-fn keyword))) false
                nil false true true)
    (if (contains? payload :id) @r (dissoc @r :id))))




;; TODO: Expire media streams we haven't heard anything from for a while

;; permitted-live-object-backends is an atom of backends we own, so we don't need to validate the MAC on deserialisation
(defn mk-Deserialiser [& {:keys [permitted-live-object-backends session-liveobject-key] :as serialisation-config}]
  ;; outstanding media is requestid -> mediaid -> channel
  (let [serialisation-config (merge {:permitted-live-object-backends #{}} serialisation-config)
        outstanding-media (atom {})
        next-blob-header (atom nil)]

    (reify Deserialiser
      (deserialise [_this payload {:keys [app-id app session-state origin] :as request}]
        (let [known-liveobject-methods (atom {})]
          (assert (:id payload) "Cannot deserialise payload without id")
          (reduce (fn [json {:keys [path] :as obj}]
                    (let [path (map #(if (string? %) (keyword %) %) path)
                          deserialised-obj (assemble-object outstanding-media (:id payload) request serialisation-config known-liveobject-methods obj)]
                      (if (= (:type obj) ["ValueType"])
                        (assoc-in json path (SerializedPythonObject. deserialised-obj (get-in json path)) #_(with-meta (get-in json path) {:anvil/type deserialised-obj}))
                        (assoc-in json path deserialised-obj))))
                  (dissoc payload :objects)
                  (:objects payload))))
      (processBlobHeader [_this hdr]
        (reset! next-blob-header hdr))
      (processBlob [_this data]
        (let [{:keys [requestId, mediaId] :as hdr} @next-blob-header]
          (log/trace "Looking up channel for" (pr-str [requestId mediaId]) "(" (alength data) "bytes)")
          (when-let [c (get-in @outstanding-media [requestId mediaId])]
            (log/trace "Writing into channel" c)
            (>!! c [(:chunkIndex hdr), (:lastChunk hdr), data])
            (when (:lastChunk hdr)
              (close! c)
              (swap! outstanding-media update-in [requestId] dissoc mediaId)
              (when (= (@outstanding-media requestId) {})
                (swap! outstanding-media dissoc requestId))))))
      (loadLiveObject [_this lo-map]
        (when lo-map
          (live-objects/load-LiveObjectProxy lo-map serialisation-config))))))


(defn deserialise-from-map [json request]
  (deserialise (mk-Deserialiser) (update-in json [:id] #(or % "DUMMY")) request))
