(ns anvil.dispatcher.serialisation.core-test
  (:use clojure.test
       anvil.dispatcher.serialisation.core
       org.senatehouse.expect-call)
  (:require [clojure.data.json :as json]
            [anvil.dispatcher.serialisation.core])
  (:import (java.io ByteArrayInputStream)
           (anvil.dispatcher.types SerialisableForRpc ChunkedStream MediaDescriptor Media)))

;; TODO test serialising multiple Media objects

(def send!)

(defn serialises-to [x]
  (reify SerialisableForRpc
    (serialiseForRpc [_this _extra-liveobject-key] x)))

(defn json-is= [json obj]
  (is (= obj (json/read-str json :key-fn keyword))))

(deftest test-serialise
  (expect-call (send! [x] (json-is= x {:id "x", :objects []}))
    (serialise! {:id "x"} send! false))

  (expect-call (send! [x] (json-is= x {:id "x", :baz nil :objects [{:path ["baz"], :foo "bar"}]}))
    (serialise! {:id "x", :baz (serialises-to {:foo "bar"})} send! false))

  (let [cs (reify
             ChunkedStream
             (consume [_this on-chunk _on-error]
               (let [b (byte-array 10)]
                 (on-chunk 0 false b)
                 (on-chunk 1 true b)))
             MediaDescriptor
             (getContentType [_this] "text/plain")
             (getName [_this] nil))]

    (expect-call [(crypto.random/base64 [_] "XYZ")
                  (send! [x] (json-is= x {:id "x" :baz nil :objects [{:path ["baz"], :type ["DataMedia"],
                                                                      :id   "XYZ", :mime-type "text/plain",
                                                                      :name nil}]}))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 0, :lastChunk false})
                         (is (= 10 (alength b))))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 1, :lastChunk true})
                         (is (= 10 (alength b))))]
      (serialise! {:id "x" :baz cs} send! false)))


  (let [m (reify
            Media
            (getLength [_this] 64001)
            (getInputStream [_this] (ByteArrayInputStream. (byte-array 64001)))
            MediaDescriptor
            (getContentType [_this] "text/plain")
            (getName [_this] nil))]

    (expect-call [(crypto.random/base64 [_] "XYZ")
                  (send! [x] (json-is= x {:id "x" :baz nil :objects [{:path ["baz"], :type ["DataMedia"],
                                                                      :id   "XYZ", :mime-type "text/plain",
                                                                      :name nil}]}))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 0, :lastChunk false})
                         (is (= 64000 (alength b))))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 1, :lastChunk false})
                         (is (= 1 (alength b))))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 2, :lastChunk true})
                         (is (= 0 (alength b))))]
      (serialise! {:id "x" :baz m} send! false))))

(def f)
