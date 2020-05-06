(ns anvil.dispatcher.serialisation.lazy-media-test
  (:use [clojure.test]
        [anvil.dispatcher.serialisation.lazy-media :as lazy-media])
  (:import (anvil.dispatcher.types MediaDescriptor Media BlobMedia)))

(defn dummy-manager [request media-id _session-state app-id app]
  (is (= media-id "x"))
  (is (= app :app))
  (is (= request nil))
  (BlobMedia. "mimeType" (byte-array 3) "dummyMedia"))

(deftest test-mk-LazyMedia

  (reset! lazy-media/managers {"test" dummy-manager})

  (let [session-state (atom {:lazy-media-secret "bop"})
        correct-key (lazy-media/generate-mac "test" "x" session-state)
        lm (lazy-media/mk-LazyMedia {:manager "test"
                                     :key     correct-key
                                     :id      "x"} "MYAPP" :app session-state)]

    (is (= (.getName ^MediaDescriptor lm) "dummyMedia"))
    (is (= (.getLength ^Media lm) 3))
    (is (= (.getContentType ^MediaDescriptor lm) "mimeType")))

  (let [session-state (atom {:lazy-media-secret "bop"})
        incorrect-key "foo"
        lm (lazy-media/mk-LazyMedia {:manager "test"
                                     :key     incorrect-key
                                     :id      "x"} "MYAPP" :app session-state)]


    (is (thrown? Exception (.getName ^MediaDescriptor lm)))))