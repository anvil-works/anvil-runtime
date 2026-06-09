(ns anvil.runtime.read-app-storage-test
  (:require [anvil.runtime.read-app-storage :as read-app-storage]
            [clojure.java.io :as io]
            [clojure.test :refer [deftest is]]
            [lazy-map.core :refer [lazy-map]])
  (:import (java.nio.file Files)
           (java.nio.file.attribute FileAttribute)
           (org.apache.commons.io FileUtils)))

(defn- write-text! [root path content]
  (let [file (io/file root path)]
    (io/make-parents file)
    (spit file content)))

(defn- fixture-tree []
  (let [tmp-dir (.toFile (Files/createTempDirectory "read-app-storage-test-" (make-array FileAttribute 0)))]
    (try
      (write-text! tmp-dir "anvil.yaml" "name: Test App\nruntime_options:\n  version: 3\n")
      (write-text! tmp-dir "theme/parameters.yaml" "version: v1\n")
      (write-text! tmp-dir "theme/templates.yaml" "Standard: {html: ok}\n")
      (write-text! tmp-dir "theme/assets/style.css" "body {}")
      (write-text! tmp-dir "forms/Form1.py" "x = 1\n")
      (write-text! tmp-dir "forms/Form1.yaml" "container: {type: ColumnPanel}\ncomponents: []\n")
      [(read-app-storage/resource-directory-to-map (-> tmp-dir .toURI .toURL)) tmp-dir]
      (catch Throwable e
        (FileUtils/deleteDirectory tmp-dir)
        (throw e)))))

(defn- cleanup-tree! [tmp-dir]
  (FileUtils/deleteDirectory tmp-dir))

(defn- assoc-tree-entry [tree [segment & more] entry]
  (if more
    (let [next-entry (get tree segment)
          next-tree (if (instance? clojure.lang.IDeref next-entry) @next-entry next-entry)]
      (assoc tree segment (delay (assoc-tree-entry next-tree more entry))))
    (assoc tree segment (delay entry))))

(deftest tree-map-to-yaml-supports-filesystem-tree-file-leaves
  (let [[tm tmp-dir] (fixture-tree)]
    (try
      (let [yaml (read-app-storage/tree-map-to-yaml tm false true)
            form (first (:forms yaml))
            asset (first (get-in yaml [:theme :assets]))]
        (is (= "Test App" (:name yaml)))
        (is (= 3 (get-in yaml [:runtime_options :version])))
        (is (= "Form1" (:class_name form)))
        (is (= "v1" (get-in yaml [:theme :parameters :version])))
        (is (string? (:hash asset))))
      (finally
        (cleanup-tree! tmp-dir)))))

(deftest tree-map-to-yaml-supports-record-git-file-leaves
  (let [[tm tmp-dir] (fixture-tree)]
    (try
      (let [tm (assoc-tree-entry tm ["theme" "assets" "style.css"]
                                 (read-app-storage/->TreeFile (.getBytes "body {}") "abc123oid"))
            yaml (read-app-storage/tree-map-to-yaml tm false true)
            form (first (:forms yaml))
            asset (first (get-in yaml [:theme :assets]))]
        (is (= "Test App" (:name yaml)))
        (is (= "Form1" (:class_name form)))
        (is (= "v1" (get-in yaml [:theme :parameters :version])))
        (is (= "abc123oid" (:hash asset))))
      (finally
        (cleanup-tree! tmp-dir)))))

(deftest get-app-yaml-from-resource-directory-supports-filesystem-resources
  (let [[_ tmp-dir] (fixture-tree)]
    (try
      (let [yaml (read-app-storage/get-app-yaml-from-resource-directory (-> tmp-dir .toURI .toURL) false true)
            form (first (:forms yaml))
            asset (first (get-in yaml [:theme :assets]))]
        (is (= "Test App" (:name yaml)))
        (is (= 3 (get-in yaml [:runtime_options :version])))
        (is (= "Form1" (:class_name form)))
        (is (= "v1" (get-in yaml [:theme :parameters :version])))
        (is (= "style.css" (:name asset)))
        (is (string? (:hash asset))))
      (finally
        (cleanup-tree! tmp-dir)))))
