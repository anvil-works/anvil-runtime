(ns anvil.runtime.read-app-storage
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [anvil.util :as util]
            [clj-yaml.core :as yaml]
            [lazy-map.core :refer [lazy-map]]
            [crypto.random :as random])
  (:import (java.net URL JarURLConnection)
           (java.io File FileInputStream)
           (java.util.jar JarFile JarEntry)
           (org.apache.commons.codec.binary Base64)
           (java.util Arrays)))

;; Values here are a list of past default contents. Current version is head of the list.
(def default-file-contents
  {"__init__.py"
   ["#
# This repository is an Anvil app. Learn more at https://anvil.works/
# To run the server-side code on your own machine, run:
# pip install anvil-uplink
# python -m anvil.run_app_via_uplink YourAppPackageName

__path__ = [__path__[0]+\"/server_code\", __path__[0]+\"/client_code\"]
"]

   ;;; .gitignore
   ".gitignore"

   ; Current Version
   ["*.pyc
*.pyo
__pycache__
.anvil-data
"
    ; Previous versions

    "*.pyc
*.pyo
__pycache__
.anvil-data
"]
   })

(defn gen-item-uid []
  (random/base32 20))

(defmulti resource-directory-to-map #(keyword (.getProtocol %)))

(defmethod resource-directory-to-map :file [^URL path]
  (into (lazy-map {}) (concat
                        (for [^File f (.listFiles (io/as-file path))]
                          [(.getName f) (delay
                                          (if (.isDirectory f)
                                            (resource-directory-to-map (-> f (.toURI) (.toURL)))
                                            (let [ary (byte-array (.length f))
                                                  is (FileInputStream. f)]
                                              (.read is ary)
                                              (.close is)
                                              ary)))]))))

(defmethod resource-directory-to-map :jar [^URL path]
  (let [jar-conn ^JarURLConnection (.openConnection path)
        dir-name (.getEntryName jar-conn)
        dir-name (str dir-name (when-not (.endsWith dir-name "/") "/"))
        jar-file ^JarFile (.getJarFile jar-conn)
        jar-entries (-> jar-file
                        (.entries)
                        (enumeration-seq))
        dir-entries (filter #(re-matches (re-pattern (str dir-name ".+")) (.getName %)) jar-entries)]
    (reduce (fn [dir-map ^JarEntry entry] (if (.isDirectory entry)
                                            dir-map
                                            (let [path-parts (str/split (.substring (.getName entry) (.length dir-name)) #"/")]
                                              (assoc-in dir-map path-parts (let [file-size (.getSize entry)
                                                                                 ary (byte-array file-size)
                                                                                 is (.getInputStream jar-file entry)]
                                                                             (loop [start 0]
                                                                               (let [read-count (.read is ary start (util/$ file-size - start))
                                                                                     next-start (util/$ start + read-count)
                                                                                     remaining (- file-size next-start)]
                                                                                 (when (util/$ remaining > 0)
                                                                                   (recur next-start))))
                                                                             (.close is)
                                                                             ary))))) {} dir-entries)))

(defn- add-subtree-to-yaml [yaml package-path tree client? get-unique-id]
  (let [dotted-name #(clojure.string/join "." (concat package-path [%]))]
    (reduce
      (fn [yaml [^String name content]]
        (cond
          (map? content)
          ;; It's a directory
          (let [package-pyb (get content "__init__.py")
                package-py (when package-pyb (String. ^bytes package-pyb))
                form-yamlb (get content "form_template.yaml")
                form-yaml (when form-yamlb (yaml/parse-string (String. ^bytes form-yamlb)))
                yaml (cond
                       (and client? package-py form-yaml)
                       (update-in yaml [:forms] concat
                                  [(assoc form-yaml
                                     :code package-py
                                     :class_name (dotted-name name)
                                     :is_package true
                                     :id (get-unique-id :forms (dotted-name name)))])
                       package-py
                       (update-in yaml [(if client? :modules :server_modules)] concat
                                  [{:name       (dotted-name name)
                                    :code       package-py
                                    :is_package true
                                    :id         (get-unique-id (if client? :modules :server_modules) (dotted-name name))}])
                       :else
                       yaml)]
            (add-subtree-to-yaml yaml (concat package-path [name])
                                 (dissoc content "__init__.py" "form_template.yaml")
                                 client? get-unique-id))

          (.endsWith name ".py")
          ;; Is it a module or a module-style form?
          (let [module-py (String. ^bytes content)
                [_ module-name] (re-matches #"(.*)\.py" name)
                form-yamlb (get tree (str module-name ".yaml"))
                form-yaml (when form-yamlb (yaml/parse-string (String. ^bytes form-yamlb)))]
            (if (and client? form-yaml)
              (update-in yaml [:forms] concat
                         [(assoc form-yaml
                            :class_name (dotted-name module-name)
                            :code module-py
                            :id (get-unique-id :forms (dotted-name module-name)))])
              (update-in yaml [(if client? :modules :server_modules)] concat
                         [{:name (dotted-name module-name)
                           :code module-py
                           :id (get-unique-id (if client? :modules :server_modules) (dotted-name module-name))}])))

          :else
          ;; Ignore everything else
          yaml))
      yaml tree)))


(defn- add-extra-files-to-yaml [yaml tm path top-level? ignore-py-and-yaml?]
  (reduce (fn [yaml [name subtree]]
            (cond
              (or (and ignore-py-and-yaml? (re-matches #".*\.(py|yaml)" name))
                  (and top-level? (#{"anvil.yaml" ".anvil_editor.yaml" "theme" "CONFLICTS.yaml"} name))
                  (and top-level? (bytes? subtree)
                       (contains? default-file-contents name)
                       (some #(Arrays/equals ^bytes subtree (.getBytes ^String %)) (get default-file-contents name))))
              yaml

              (map? subtree)
              (add-extra-files-to-yaml yaml subtree (concat path [name]) false
                                       (or ignore-py-and-yaml?
                                           (and top-level?
                                                (#{"server_code" "client_code" "server_modules" "modules" "forms"} name))))

              (bytes? subtree)
              (assoc-in yaml (concat path [name]) (Base64/encodeBase64String ^bytes subtree))

              :else
              yaml))
          yaml tm))

(def get-app-yaml-from-resource-directory)
(defn tree-map-to-yaml [tm ignore-extra-files? generate-item-uids?]
  (let [read-yaml #(when-let [^bytes ymlb (get-in tm %)]
                    (yaml/parse-string (String. ymlb)))

        editor-yaml (read-yaml [".anvil_editor.yaml"])

        get-id (fn [item-key item-name]
                 (or (get-in editor-yaml [:unique-ids item-key (keyword item-name)])
                     (when generate-item-uids?
                       (gen-item-uid))))

        core-app-files (->
                         (merge
                           (when-let [parsed (read-yaml ["anvil.yaml"])]
                             (when (map? parsed) parsed))

                           {:forms
                            (->>
                              (for [[src-name, src] (get tm "forms")
                                    :let [[_ form-name] (re-matches #"(.+)\.py" src-name)
                                          ^bytes yaml (when form-name (get-in tm ["forms" (str form-name ".yaml")]))]
                                    :when yaml]
                                (assoc (yaml/parse-string (String. yaml)) :class_name form-name :code (String. ^bytes @src)
                                                                          :id (get-id :forms form-name)))
                              (sort-by :class_name))

                            :modules
                            (->>
                              (for [[src-name, src] (get tm "modules")
                                    :let [[_ mod-name] (re-matches #"(.+)\.py" src-name)]
                                    :when mod-name]
                                {:name mod-name, :code (String. ^bytes @src)
                                 :id (get-id :modules mod-name)})
                              (sort-by :name))

                            :server_modules
                            (->> (for [[src-name, src] (get tm "server_modules")
                                       :let [[_ mod-name] (re-matches #"(.+)\.py" src-name)]
                                       :when mod-name]
                                   {:name mod-name, :code (String. ^bytes @src)
                                    :id (get-id :server_modules mod-name)})
                                 (sort-by :name))}

                           (if (get tm "theme")
                             {:theme
                              {:templates
                               (read-yaml ["theme" "templates.yaml"])
                               :parameters
                               (or (read-yaml ["theme" "parameters.yaml"]) {})
                               :assets
                               (let [extract-assets (fn extract-assets [tree prefix]
                                                      (apply concat
                                                             (for [[name, src] tree :when (bytes? @src)]
                                                               {:name (str prefix name), :content (Base64/encodeBase64String ^bytes @src),
                                                                :id   (get-id :assets (str prefix name))})
                                                             (for [[name, dir] tree :when (map? @dir)]
                                                               (extract-assets @dir (str prefix name "/")))))]
                                 (extract-assets (get-in tm ["theme" "assets"]) ""))}}
                             ;; Else, fill it in blank!
                             {:theme (get (get-app-yaml-from-resource-directory (io/resource "app_templates/blank_theme") false) "theme")})

                           (when-let [conflicts (read-yaml ["CONFLICTS.yaml"])]
                             {:conflicts conflicts}))
                         (add-subtree-to-yaml [] (get tm "client_code") true get-id)
                         (add-subtree-to-yaml [] (get tm "server_code") false get-id))]
    (if ignore-extra-files?
      core-app-files
      (add-extra-files-to-yaml core-app-files tm [:extra_files] true false))))

; Directory can be a file URL or a JAR URL
(defn get-app-yaml-from-resource-directory
  ([^URL directory ignore-extra-files?] (get-app-yaml-from-resource-directory directory ignore-extra-files? true))
  ([^URL directory ignore-extra-files? generate-uids?]
   (let [dir-map (resource-directory-to-map directory)
         yaml (tree-map-to-yaml dir-map ignore-extra-files? generate-uids?)]
     yaml)))
