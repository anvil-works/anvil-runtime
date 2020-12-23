(ns anvil.dispatcher.types
  (:use [slingshot.slingshot])
  (:require [anvil.runtime.conf :as conf]
            [crypto.random :as random]
            [anvil.util :as util]
            [anvil.core.worker-pool :as worker-pool])
  (:import (java.io File FileOutputStream ByteArrayInputStream ByteArrayOutputStream)))

(defprotocol SerialisableForRpc
  (serialiseForRpc [this extra-liveobject-key] "Return a JSONable object that represents this one"))

(defprotocol MediaDescriptor
  (getContentType [this] "Get the content type of this Media object (a string)")
  (getName [this] "Return a name for this Media object if there is one (or nil)"))

(defprotocol Media
  (getLength [this] "Get the number of bytes in this Media object")
  (getInputStream [this] "Get the data of this Media object (as an InputStream)"))

(defprotocol ChunkedStream
  (consume [this f] "Call (f chunk-idx last-chunk data) for each byte-array chunk in this stream"))

; Dates are formatted "YYYY-MM-DD"
(defrecord Date [date-string]
  SerialisableForRpc
  (serialiseForRpc [this _k]
    {:type  ["Date"]
     :value (:date-string this)}))

; Datetimes are formatted "YYYY-mm-dd HH:MM:SS.fff[fff]+1234"
(defrecord DateTime [datetime-string]
  SerialisableForRpc
  (serialiseForRpc [this _k]
    {:type  ["DateTime"]
     :value (:datetime-string this)}))

(defrecord SerializedPythonObject [type value])

(def gen-live-object-mac)
(def gen-cap-mac)

(defrecord Capability [scope]
  SerialisableForRpc
  (serialiseForRpc [this extra-liveobject-key]
    {:type ["Capability"]
     :scope scope
     :mac (gen-cap-mac this extra-liveobject-key)}))

(defn serialise-for-item-cache [val extra-liveobject-key]
  (cond
    (or (string? val)
        (number? val)
        (contains? #{true false} val)
        (nil? val))
    {:type ["Primitive"] :value val}

    (satisfies? SerialisableForRpc val)
    (serialiseForRpc val extra-liveobject-key)))

(defn serialisable-in-item-cache? [val]
  (or (string? val)
      (number? val)
      (contains? #{true false} val)
      (nil? val)
      (satisfies? SerialisableForRpc val)))

(defrecord LiveObjectProxy [backend id permissions mac methods itemCache iterItems]
  SerialisableForRpc
  (serialiseForRpc [this extra-liveobject-key]
    ;; TODO: Recursively serialise any liveobjects in our itemCache and iterItems
    ;; The serialised form of LiveObjects have a map for every item in itemCache
    ;; and iterItems, e.g. {:type ["Primitive"] :value 42}

    (merge this {:type      ["LiveObject"]
                 :mac       (gen-live-object-mac this extra-liveobject-key)
                 :itemCache (reduce (fn [cache [name val]]
                                      (if-let [serialised (serialise-for-item-cache val extra-liveobject-key)]
                                        (assoc cache name serialised)
                                        cache)) {} itemCache)
                 :iterItems (when-let [iterItems (:iterItems this)]
                              (update-in iterItems [:items] (fn [items]
                                                              (map #(or (serialise-for-item-cache % extra-liveobject-key)
                                                                        (throw (Exception. (str "Could not serialise value: " %)))) items))))})))




(deftype BlobMedia [content-type bytes name]
  MediaDescriptor
  (getContentType [_] content-type)
  (getName [_] name)

  Media
  (getLength [_] (alength bytes))
  (getInputStream [_] (ByteArrayInputStream. bytes)))

(deftype InputStreamMedia [content-type input-stream name content-length]
  MediaDescriptor
  (getContentType [_] content-type)
  (getName [_] name)

  Media
  (getLength [_] content-length)
  (getInputStream [_] input-stream))

(defn ChunkedStream->Media [chunked-stream]
  (let [baos (atom (ByteArrayOutputStream.))
        consumed-bytes (promise)
        add-bytes (fn [_idx last? bs]
                    (when-let [os @baos] ;; In case it has already been dropped by a timeout.
                      (.write os ^bytes bs)
                      (when last?
                        (deliver consumed-bytes (.toByteArray os)))))]

    (consume chunked-stream add-bytes)

    (worker-pool/with-expanding-threadpool-when-slow
      (let [bytes (deref consumed-bytes (* 5 60000) ::timeout)] ;; 5 min timeout
        (if (= bytes ::timeout)
          (do
            (reset! baos nil)
            (throw+ {:anvil/server-error "Timeout while assembling BlobMedia"}))
          (BlobMedia. (.getContentType chunked-stream)
                      bytes
                      (.getName chunked-stream)))))))

(defn ?->InputStream
  "Turn ChunkedStream or Media into an InputStream. Use of this function is a code smell,
   because it causes the whole Media to be buffered in memory at the same time. We should
   invent ways not to have to use it."
  [bindata]
  (cond
    (satisfies? Media bindata)
    (.getInputStream bindata)

    (satisfies? ChunkedStream bindata)
    (.getInputStream (ChunkedStream->Media bindata))

    :else
    (throw (IllegalArgumentException. (str "'" (class bindata) "' object is neither Media nor ChunkedStream")))))

(defn mk-ChunkedStream [name mime-type content]
  (reify
    MediaDescriptor
    (getContentType [_this] mime-type)
    (getName [_this] name)
    ChunkedStream
    (consume [_this f]
      (f 0 true content))))

(def ^:private secret (delay (if (.exists (File. ^String conf/live-object-mac-path))
                               (slurp conf/live-object-mac-path)
                               (let [^String r (random/base64 33)]
                                 (with-open [o (FileOutputStream. ^String conf/live-object-mac-path)]
                                   (.write o (.getBytes r)))
                                 r))))

(defn gen-live-object-mac [{:keys [backend id permissions] :as _live-object} extra-liveobject-key]
  (let [mac (util/sha-256 (str
                            @secret
                            (binding [*print-readably* true]
                              (pr-str (vec (concat
                                             (when extra-liveobject-key ["EK=" extra-liveobject-key])
                                             ["BACKEND=" backend ";ID=" id ";PERMS=" permissions]))))
                            @secret))]

    #_(log/trace "Generating mac for" (pr-str (vec (concat (when extra-liveobject-key ["EK=" extra-liveobject-key])
                                                           ["BACKEND=" backend ";ID=" id ";PERMS=" permissions]))) ": " mac)
    #_(log/trace "Generating mac for" backend id permissions extra-liveobject-key "-->" mac)
    mac))

(defn gen-cap-mac [{:keys [scope] :as _capability} extra-liveobject-key]
  (util/sha-256 (str @secret (util/write-json-str scope) (util/write-json-str extra-liveobject-key) @secret)))

(defn mk-LiveObjectProxy [backend id permissions methods & [itemCache iterItems]]
  (LiveObjectProxy. backend id permissions nil methods itemCache iterItems))

