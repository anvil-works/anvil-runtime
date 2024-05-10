(ns anvil.runtime.browser-http
  (:use [org.httpkit.server]
        [slingshot.slingshot :only [throw+ try+]]
        [anvil.runtime.util])
  (:require [clojure.data.json :as json]
            [crypto.random :as random]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.serialisation.core :as serialisation]
            [anvil.runtime.app-log :as app-log]
            [anvil.runtime.browser-ws :as browser-ws]
            [anvil.runtime.browser-ws :refer [process-log-data]]
            [clojure.java.io :as io]
            [medley.core :refer [filter-keys]]
            [clojure.string :as str]))

(defn- file->blob [{file :tempfile}]
  (with-open [input-stream (io/input-stream file)]
    (let [file-size (-> file .length int)
          byte-array (byte-array file-size)]
      (.read input-stream byte-array)
      byte-array)))

(defn- get-json-data [request] (json/read-str (get-in request [:multipart-params "json-data"]) :key-fn keyword))

(defn- extract-integers-from-key [k]
  (->> k
       (re-seq #"\d+")
       (map #(Integer/parseInt %))))

(defn- compare-keys [k1 k2]
  (let [[i1 j1] (extract-integers-from-key k1)
        [i2 j2] (extract-integers-from-key k2)]
    (compare [i1 j1] [i2 j2])))

(defn- clean-chunk-keys [k data]
  (->> data
       (filter-keys #(str/starts-with? % k))
       (into (sorted-map-by compare-keys))
       vals))


(comment
  (let [test-data {"chunk-json-1-1" "A"
                   "chunk-json-2-1" "D"
                   "chunk-json-1-2" "B"
                   "chunk-json-1-12" "C"
                   "other-key" "E"}
        expected-result ["A" "B" "C" "D"]]
    (= expected-result (clean-chunk-keys "chunk-json" test-data)))
  ;
  )

(defn- clean-chunk-headings [data]
  (->> data
       (clean-chunk-keys "chunk-json")
       (map #(json/read-str % :key-fn keyword))))

(defn- clean-chunk-data [data]
  (->> data
       (clean-chunk-keys "chunk-data")
       (map file->blob)))

(defn- process-chunk-data [request deserialiser]
  (let [data (dissoc (:multipart-params request) "json-data")
        chunk-headings (clean-chunk-headings data)
        chunk-data (clean-chunk-data data)]
    (doseq [[header data] (map vector chunk-headings chunk-data)]
      (serialisation/processBlobHeader deserialiser header)
      (serialisation/processBlob deserialiser data))))


(defn- send-headers [channel]
  (send! channel {:headers {"Content-Type" (str "multipart/x-mixed-replace;boundary=" serialisation/boundary)}} false))

(defn- get-session-liveobject-secret [app-session]
  (-> (swap! app-session
             (fn [x] (if-not (:liveobject-secret x)
                       (assoc x :liveobject-secret (random/base64 128))
                       x)))
      (:liveobject-secret)))

(defn- mk-serial-responder [channel session-liveobject-secret request-id]
  (fn [resp call-finished?]
    (serialisation/serialise-to-http!
      (assoc resp :id request-id) channel true session-liveobject-secret #(when call-finished? (close channel)))))

(defn- do-deserialization [deserialiser responder data]
  (try+
    (let [deserialised-data (serialisation/deserialise deserialiser data)
          live-object (serialisation/loadLiveObject deserialiser (:liveObjectCall deserialised-data))]
      [deserialised-data live-object])
    (catch :anvil/invalid-mac e
      (responder {:error {:type    "anvil.server.InvalidObjectError"
                          :message "Error processing object from expired session"
                          :trace   [["<rpc>", 0]]}}
                 true)
      nil)))


(defn- process-call-data [data {:keys [app-id app-session environment app-origin] :as request} app-yaml deserialiser serial-responder]
  (let [request-template {:app           app-yaml
                          :app-id        app-id
                          :environment   environment
                          :app-origin    app-origin
                          :origin        :client
                          :session-state app-session
                          :use-quota?    true
                          :call-stack    (list {:type :browser})}
        func (or (:command data) (:method (:liveObjectCall data)))
        request-id (:id data)
        responder (serial-responder request-id)
        ;; respond causes the dispatcher to return update doesn't (e.g. print output)
        return-path {:respond!
                     (fn [data]
                       (responder data true))
                     :update!
                     (fn [{:keys [output] :as r}]
                       (if (string? output)
                         (do
                           (app-log/record-event! app-session nil "print" output nil)
                           (when (browser-ws/share-server-logs-with-client? environment app-session)
                             (responder r false)))
                         (responder r false)))}]
    (when-let [[deserialised-data live-object] (do-deserialization deserialiser responder data)]
      (dispatcher/dispatch! (assoc request-template
                              :vt_global (:vt_global deserialised-data)
                              :call (assoc (select-keys deserialised-data [:args :kwargs])
                                      :func func
                                      :live-object live-object))
                            return-path))))


(defn- process-data [request app-yaml deserialiser serial-responder]
  (let [data (get-json-data request)]
    (case (:type data)
      "CALL" (do
               (process-call-data data request app-yaml deserialiser serial-responder)
               (process-chunk-data request deserialiser))
      "LOG" (process-log-data data request))))


(defn http-handler [{:keys [app-id app-session environment app-origin] :as request} app-yaml]
  (with-channel request channel
    (let [session-liveobject-secret (get-session-liveobject-secret app-session)
          deserialiser (serialisation/mk-Deserialiser {:origin :client, :get-session-liveobject-key (constantly session-liveobject-secret)})
          serial-responder (partial mk-serial-responder channel session-liveobject-secret)]
      (on-close channel (fn [reason]))
      (send-headers channel)
      (process-data request app-yaml deserialiser serial-responder))))


