(ns anvil.dispatcher.types
  (:use [slingshot.slingshot :only [throw+ try+]])
  (:require [anvil.runtime.conf :as conf]
            [crypto.random :as random]
            [anvil.util :as util]
            [anvil.core.worker-pool :as worker-pool]
            [clojure.tools.logging :as log])
  (:import (java.io File FileOutputStream ByteArrayInputStream ByteArrayOutputStream)))

(clj-logging-config.log4j/set-logger! :level :trace)

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

(defrecord LazyMedia [manager key id mime-type length name]
  MediaDescriptor
  (getContentType [_this] mime-type)
  (getName [_this] name)
  SerialisableForRpc
  (serialiseForRpc [this _lo-key]
    (-> (select-keys this [:manager :key :id :mime-type :length :name])
        (assoc :type ["LazyMedia"]))))

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

(defrecord SerializedPythonClass [type])

(def gen-live-object-mac)
(def gen-cap-mac)

(defrecord Capability [scope]
  SerialisableForRpc
  (serialiseForRpc [this extra-liveobject-key]
    {:type ["Capability"]
     :scope scope
     :mac (gen-cap-mac this extra-liveobject-key)}))

(defn unwrap-capability
  ([{:keys [scope] :as capability} pattern]
   (when-not (instance? anvil.dispatcher.types.Capability capability)
     (log/info "Fake Capability rejected. Wanted pattern:\n" pattern "\nGot object:\n" capability)
     (throw+ {:anvil/server-error "Invalid capability"}))
   (when-not (<= (count scope) (count pattern))
     (throw+ {:anvil/server-error "Invalid capability scope. Provided capability scope is too narrow."}))

   (let [m (map vector pattern scope)]
     (when-not (every? (fn [[p s]]
                         (or
                           (= p s)
                           (= p :ANY)
                           (and (map? p)
                                (= (set (keys p)) (set (keys s)))
                                (every? (fn [[k v]] (= v :ANY)) p))))
                       m)
       (log/info "Capability test failed. Wanted pattern:\n" pattern "\nGot scope:\n" scope)
       (throw+ {:anvil/server-error "Invalid capability scope."})))
   scope)

  ([capability require-scope-prefix max-specialisation-depth]
   (when-not (instance? anvil.dispatcher.types.Capability capability)
     (throw+ {:anvil/server-error "Invalid capability"}))

   (let [scope (:scope capability)
         [scope-prefix scope-rest] (split-at (count require-scope-prefix) scope)]
     (when-not (= scope-prefix require-scope-prefix)
       (throw+ {:anvil/server-error (str "Invalid capability scope. Required prefix: " (pr-str require-scope-prefix) ", got prefix: " (pr-str scope-prefix))}))
     (when-not (<= (count scope-rest) max-specialisation-depth)
       (throw+ {:anvil/server-error (str "Invalid capability scope. Provided capability scope is too narrow.")}))

     (drop (count scope-prefix) scope))))

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

(defn mk-ChunkedStream [name mime-type ^bytes content]
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

(defn- sort-maps [element]
  (cond
    (map? element)
    (into (sorted-map) (for [[k v] element] [k (sort-maps v)]))

    (sequential? element)
    (map sort-maps element)

    :else
    element))

(defn new-gen-cap-mac [{:keys [scope] :as _capability} extra-liveobject-key]
  (let [scope (map sort-maps scope)]
    (util/sha-256 (str @secret (util/write-json-str scope) (util/write-json-str extra-liveobject-key) @secret))))

(defn old-gen-cap-mac [{:keys [scope] :as _capability} extra-liveobject-key]
  (let [scope (for [element scope]
                (if (map? element)
                  (into (sorted-map) element)
                  element))]
    (util/sha-256 (str @secret (util/write-json-str scope) (util/write-json-str extra-liveobject-key) @secret))))

(defn logging-gen-cap-mac [{:keys [scope] :as _capability} extra-liveobject-key]
  (let [scope (for [element scope]
                (if (map? element)
                  (into (sorted-map) element)
                  element))
        new-scope (map sort-maps scope)]
    (when (not= (util/write-json-str scope) (util/write-json-str new-scope))
      (log/info "MAC algorithms differ:" (util/write-json-str scope) "vs" (util/write-json-str new-scope)))
    (util/sha-256 (str @secret (util/write-json-str scope) (util/write-json-str extra-liveobject-key) @secret))))

(defn gen-cap-mac [capability extra-liveobject-key]
  (new-gen-cap-mac capability extra-liveobject-key))


(defn mk-LiveObjectProxy [backend id permissions methods & [itemCache iterItems]]
  (LiveObjectProxy. backend id permissions nil methods itemCache iterItems))

