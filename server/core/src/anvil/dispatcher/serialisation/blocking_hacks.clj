(ns anvil.dispatcher.serialisation.blocking-hacks
  (:require [anvil.dispatcher.types :as types]
            [slingshot.slingshot :refer :all]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media])
  (:import (java.io ByteArrayOutputStream)
           (anvil.dispatcher.types BlobMedia Media ChunkedStream LazyMedia)))

(defn ChunkedStream->Media [chunked-stream]
  (let [baos (atom (ByteArrayOutputStream.))
        consumed-bytes (promise)
        add-bytes (fn [_idx last? bs]
                    (when-let [os @baos] ;; In case it has already been dropped by a timeout.
                      (.write os ^bytes bs)
                      (when last?
                        (deliver consumed-bytes (.toByteArray os)))))]

    (types/consume chunked-stream add-bytes)

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
  [request bindata]
  (cond
    (instance? Media bindata)
    (.getInputStream bindata)

    (instance? ChunkedStream bindata)
    (.getInputStream (ChunkedStream->Media bindata))

    (instance? LazyMedia bindata)
    (.getInputStream (lazy-media/get-lazy-media request bindata))

    :else
    (throw (IllegalArgumentException. (str "'" (class bindata) "' object is neither Media, LazyMedia nor ChunkedStream")))))