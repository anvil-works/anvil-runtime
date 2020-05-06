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
  (is (= (json/read-str json :key-fn keyword) obj)))

(deftest test-serialise
  (expect-call (send! [x] (json-is= x {:id "x", :objects []}))
    (serialise! {:id "x"} send! false))

  (expect-call (send! [x] (json-is= x {:id "x", :baz nil :objects [{:path ["baz"], :foo "bar"}]}))
    (serialise! {:id "x", :baz (serialises-to {:foo "bar"})} send! false))

  (let [cs (reify
             ChunkedStream
             (consume [_this f]
               (let [b (byte-array 10)]
                 (f 0 false b)
                 (f 1 true b)))
             MediaDescriptor
             (getContentType [_this] "text/plain")
             (getName [_this] nil))]

    (expect-call [(crypto.random/base64 [_] "XYZ")
                  (send! [x] (json-is= x {:id "x" :baz nil :objects [{:path ["baz"], :type ["DataMedia"],
                                                                      :id   "XYZ", :mime-type "text/plain",
                                                                      :name nil}]}))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 0, :lastChunk false})
                         (is (= (alength b) 10)))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 1, :lastChunk true})
                         (is (= (alength b) 10)))]
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
                         (is (= (alength b) 64000)))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 1, :lastChunk false})
                         (is (= (alength b) 1)))
                  (send! [x b] (json-is= x {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 2, :lastChunk true})
                         (is (= (alength b) 0)))]
      (serialise! {:id "x" :baz m} send! false))))

(def f)

#_ (deftest test-deserialise
  (let [ds (mk-Deserialiser)]
    (is (= (deserialise ds {:id "x"} nil nil nil nil) {:id "x"}))


    (let [r (deserialise ds {:id "x", :baz nil, :objects [{:path ["baz"], :type ["DataMedia"],
                                                           :id   "XYZ", :mime-type "text/plain",
                                                           :name nil}]} nil nil nil nil)

          chunks (atom [])
          add-chunk! #(swap! chunks conj %&)]

      (is (instance? ChunkedStream (:baz r)))

      (processBlobHeader ds {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 0, :lastChunk false})
      (processBlob ds (byte-array 10))

      (.consume (:baz r) add-chunk!)
      (Thread/sleep 100)
      (is (= (count @chunks) 1))
      (is (= (take 2 (first @chunks)) [0 false]))
      (is (= 10 (alength (nth (first @chunks) 2))))

      (processBlobHeader ds {:type "CHUNK_HEADER", :requestId "x", :mediaId "XYZ", :chunkIndex 1, :lastChunk true})
      (processBlob ds (byte-array 10))
      (Thread/sleep 100)

      (is (= (count @chunks) 2))
      (is (= (take 2 (second @chunks)) [1 true])))))
