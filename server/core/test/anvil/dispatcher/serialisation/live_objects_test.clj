(ns anvil.dispatcher.serialisation.live-objects-test
  (:use [clojure.test]
        [anvil.dispatcher.serialisation.live-objects :as live-objects])
  (:require [anvil.dispatcher.types :as types]))

(deftest test-load-LiveObjectProxy

  (let [live-object-map {:backend "test"
                         :id 7}
        correct-mac (types/gen-live-object-mac live-object-map nil)]

    (is (thrown? Exception (live-objects/load-LiveObjectProxy live-object-map {})))

    (live-objects/load-LiveObjectProxy (assoc live-object-map :mac correct-mac) {})

    (println correct-mac)))