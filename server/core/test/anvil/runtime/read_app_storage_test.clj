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

(deftest tree-map-to-yaml-prefers-html-template-when-both-template-formats-exist
  (let [[_ tmp-dir] (fixture-tree)]
    (try
      (write-text! tmp-dir "forms/Form1.html" "<anvil-component type=\"Button\" name=\"button_1\" prop:text=\"HTML\"></anvil-component>")
      (let [tm (read-app-storage/resource-directory-to-map (-> tmp-dir .toURI .toURL))
            yaml (read-app-storage/tree-map-to-yaml tm false true)
            form (first (:forms yaml))]
        (is (:save_as_html form))
        (is (= "button_1" (get-in form [:components 0 :name])))
        (is (= "HTML" (get-in form [:components 0 :properties :text]))))
      (finally
        (cleanup-tree! tmp-dir)))))

(deftest get-app-yaml-from-resource-directory-parses-html-form-templates
  (let [[_ tmp-dir] (fixture-tree)
        html (str "<h1>Title</h1>\n"
                  "<anvil-component type=\"Button\" name=\"button_1\" prop:text=\"Go\"></anvil-component>")]
    (try
      (write-text! tmp-dir "forms/HtmlForm.py" "x = 2\n")
      (write-text! tmp-dir "forms/HtmlForm.html" html)
      (let [yaml (read-app-storage/get-app-yaml-from-resource-directory (-> tmp-dir .toURI .toURL) false true)
            form (first (filter #(= "HtmlForm" (:class_name %)) (:forms yaml)))]
        (is (:save_as_html form))
        (is (= "x = 2\n" (:code form)))
        (is (= html (:serialized_html form)))
        (is (= "HtmlComponent" (get-in form [:container :type])))
        (is (= "Button" (get-in form [:components 0 :type])))
        (is (= "Go" (get-in form [:components 0 :properties :text]))))
      (finally
        (cleanup-tree! tmp-dir)))))

(deftest get-app-yaml-from-resource-directory-parses-html-package-form-templates
  (let [[_ tmp-dir] (fixture-tree)
        html-body (str "<section>\n"
                       "  <anvil-dropzone name=\"default\"></anvil-dropzone>\n"
                       "  <anvil-component type=\"Label\" name=\"owned_label\" prop:text=\"Owned\"></anvil-component>\n"
                       "</section>")
        html-template (str "---\n"
                           "custom_component: true\n"
                           "custom_component_container: true\n"
                           "---\n"
                           html-body)]
    (try
      (write-text! tmp-dir "client_code/HtmlPackage/__init__.py" "x = 3\n")
      (write-text! tmp-dir "client_code/HtmlPackage/form_template.html" html-template)
      (let [yaml (read-app-storage/get-app-yaml-from-resource-directory (-> tmp-dir .toURI .toURL) false true)
            form (first (filter #(= "HtmlPackage" (:class_name %)) (:forms yaml)))]
        (is (:save_as_html form))
        (is (:is_package form))
        (is (:custom_component form))
        (is (:custom_component_container form))
        (is (= "x = 3\n" (:code form)))
        (is (= html-body (:serialized_html form)))
        (is (= "HtmlComponent" (get-in form [:container :type])))
        (is (= "Label" (get-in form [:components 0 :type])))
        (is (= "owned_label" (get-in form [:components 0 :name])))
        (is (= "Owned" (get-in form [:components 0 :properties :text])))
        (is (string? (get-in form [:components 0 :layout_properties :dropzone]))))
      (finally
        (cleanup-tree! tmp-dir)))))
