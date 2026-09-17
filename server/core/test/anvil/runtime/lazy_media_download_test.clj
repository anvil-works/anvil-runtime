(ns anvil.runtime.lazy-media-download-test
  (:require [anvil.runtime.server :as runtime-server]
            [clojure.test :refer [deftest is testing]]))

(defn- content-disposition [name]
  (#'runtime-server/content-disposition-for-lazy-media name))

(deftest lazy-media-download-content-disposition-quotes-filenames
  (testing "comma is preserved inside a quoted filename"
    (is (= "attachment; filename=\"Report, final.xlsx\""
           (content-disposition "Report, final.xlsx"))))

  (testing "spaces and semicolons stay inside the quoted filename"
    (is (= "attachment; filename=\"Quarterly report; final copy.pdf\""
           (content-disposition "Quarterly report; final copy.pdf")))))

(deftest lazy-media-download-content-disposition-sanitizes-header-unsafe-characters
  (is (= "attachment; filename=\"bad_name___.txt\""
         (content-disposition "bad\"name\r\n\u0000.txt"))))

(deftest lazy-media-download-content-disposition-without-filename
  (is (= "attachment"
         (content-disposition nil))))
