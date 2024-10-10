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
   ; README.md
   "README.md"
   ["# About This [Anvil](https://anvil.works/?utm_source=github:app_README) App

### Build web apps with nothing but Python.

The app in this repository is built with [Anvil](https://anvil.works?utm_source=github:app_README), the framework for building web apps with nothing but Python. You can clone this app into your own Anvil account to use and modify.

Below, you will find:
- [How to open this app](#opening-this-app-in-anvil-and-getting-it-online) in Anvil and deploy it online
- Information [about Anvil](#about-anvil)
- And links to some handy [documentation and tutorials](#tutorials-and-documentation)

## Opening this app in Anvil and getting it online

### Cloning the app

Go to the [Anvil Editor](https://anvil.works/build?utm_source=github:app_README) (you might need to sign up for a free account) and click on “Clone from GitHub” (underneath the “Blank App” option):

<img src=\"https://anvil.works/docs/version-control-new-ide/img/git/clone-from-github.png\" alt=\"Clone from GitHub\"/>

Enter the URL of this GitHub repository. If you're not yet logged in, choose \"GitHub credentials\" as the authentication method and click \"Connect to GitHub\".

<img src=\"https://anvil.works/docs/version-control-new-ide/img/git/clone-app-from-git.png\" alt=\"Clone App from Git modal\"/>

Finally, click \"Clone App\".

This app will then be in your Anvil account, ready for you to run it or start editing it! **Any changes you make will be automatically pushed back to this repository, if you have permission!** You might want to [make a new branch](https://anvil.works/docs/version-control-new-ide?utm_source=github:app_README).

### Running the app yourself:

Find the **Run** button at the top-right of the Anvil editor:

<img src=\"https://anvil.works/docs/img/run-button-new-ide.png\"/>


### Publishing the app on your own URL

Now you've cloned the app, you can [deploy it on the internet with two clicks](https://anvil.works/docs/deployment/quickstart?utm_source=github:app_README)! Find the **Publish** button at the top-right of the editor:

<img src=\"https://anvil.works/docs/deployment-new-ide/img/environments/publish-button.png\"/>

When you click it, you will see the Publish dialog:

<img src=\"https://anvil.works/docs/deployment-new-ide/img/quickstart/empty-environments-dialog.png\"/>

Click **Publish This App**, and you will see that your app has been deployed at a new, public URL:

<img src=\"https://anvil.works/docs/deployment-new-ide/img/quickstart/default-public-environment.png\"/>

That's it - **your app is now online**. Click the link and try it!

## About Anvil

If you’re new to Anvil, welcome! Anvil is a platform for building full-stack web apps with nothing but Python. No need to wrestle with JS, HTML, CSS, Python, SQL and all their frameworks – just build it all in Python.

<figure>
<figcaption><h3>Learn About Anvil In 80 Seconds👇</h3></figcaption>
<a href=\"https://www.youtube.com/watch?v=3V-3g1mQ5GY\" target=\"_blank\">
<img
  src=\"https://anvil-website-static.s3.eu-west-2.amazonaws.com/anvil-in-80-seconds-YouTube.png\"
  alt=\"Anvil In 80 Seconds\"
/>
</a>
</figure>
<br><br>

[![Try Anvil Free](https://anvil-website-static.s3.eu-west-2.amazonaws.com/mark-complete.png)](https://anvil.works?utm_source=github:app_README)

To learn more about Anvil, visit [https://anvil.works](https://anvil.works?utm_source=github:app_README).

## Tutorials and documentation

### Tutorials

If you are just starting out with Anvil, why not **[try the 10-minute Feedback Form tutorial](https://anvil.works/learn/tutorials/feedback-form?utm_source=github:app_README)**? It features step-by-step tutorials that will introduce you to the most important parts of Anvil.

Anvil has tutorials on:
- [Building Dashboards](https://anvil.works/learn/tutorials/data-science#dashboarding?utm_source=github:app_README)
- [Multi-User Applications](https://anvil.works/learn/tutorials/multi-user-apps?utm_source=github:app_README)
- [Building Web Apps with an External Database](https://anvil.works/learn/tutorials/external-database?utm_source=github:app_README)
- [Deploying Machine Learning Models](https://anvil.works/learn/tutorials/deploy-machine-learning-model?utm_source=github:app_README)
- [Taking Payments with Stripe](https://anvil.works/learn/tutorials/stripe?utm_source=github:app_README)
- And [much more....](https://anvil.works/learn/tutorials?utm_source=github:app_README)

### Reference Documentation

The Anvil reference documentation provides comprehensive information on how to use Anvil to build web applications. You can find the documentation [here](https://anvil.works/docs/overview?utm_source=github:app_README).

If you want to get to the basics as quickly as possible, each section of this documentation features a [Quick-Start Guide](https://anvil.works/docs/overview/quickstarts?utm_source=github:app_README).
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
        dir-entries (filter #(re-matches (re-pattern (str dir-name ".+")) (.getName %)) jar-entries)
        eager-map (reduce (fn [dir-map ^JarEntry entry]
                            (if (.isDirectory entry)
                              dir-map
                              (let [path-parts (str/split (.substring (.getName entry) (.length dir-name)) #"/")]
                                (assoc-in dir-map path-parts
                                          (let [file-size (.getSize entry)
                                                ary (byte-array file-size)
                                                is (.getInputStream jar-file entry)]
                                            (loop [start 0]
                                              (let [read-count (.read is ary start (util/$ file-size - start))
                                                    next-start (util/$ start + read-count)
                                                    remaining (- file-size next-start)]
                                                (when (util/$ remaining > 0)
                                                  (recur next-start))))
                                            (.close is)
                                            ary))))) {} dir-entries)
        eager->lazy-map (fn eager->lazy-map [m]
                          (into (lazy-map {})
                                (for [[k v] m] (if (map? v)
                                                 [k (eager->lazy-map v)]
                                                 [k (delay v)]))))]
    (eager->lazy-map eager-map)))

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
                form-yaml (util/parse-yaml-bytes form-yamlb)
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
                form-yaml (util/parse-yaml-bytes form-yamlb)]
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


(defn- add-extra-files-to-yaml [yaml tm path top-level? ignore-py? ignore-yaml? ignore-one-level-only?]
  (reduce (fn [yaml [^String name subtree]]
            (cond
              (or (and ignore-yaml? (.endsWith name ".yaml"))
                  (and ignore-py? (.endsWith name ".py"))
                  (and top-level? (#{"anvil.yaml" ".anvil_editor.yaml" "theme" "CONFLICTS.yaml" "anvil-server-requirements.txt"} name))
                  (and (= path [:extra_files "server_code"]) (= name "requirements.txt"))
                  (and top-level? (bytes? subtree)
                       (contains? default-file-contents name)
                       (some #(Arrays/equals ^bytes subtree (.getBytes ^String %)) (get default-file-contents name))))
              yaml

              (map? subtree)
              (add-extra-files-to-yaml yaml subtree (concat path [name]) false
                                       (or (and ignore-py? (not ignore-one-level-only?))
                                           (and top-level?
                                                (#{"server_code" "client_code" "server_modules" "modules" "forms" "scripts"} name)))
                                       (or (and ignore-yaml? (not ignore-one-level-only?))
                                           (and top-level?
                                                (#{"client_code" "forms"} name)))
                                       (and top-level? (#{"scripts"} name)))

              (bytes? subtree)
              (assoc-in yaml (concat path [name]) (Base64/encodeBase64String ^bytes subtree))

              :else
              yaml))
          yaml tm))

(def get-app-yaml-from-resource-directory)
(defn tree-map-to-yaml [tm ignore-extra-files? generate-item-uids?]
  (let [read-yaml #(-> (get-in tm %)
                       (util/parse-yaml-bytes))

        editor-yaml (read-yaml [".anvil_editor.yaml"])

        get-id (fn [item-key item-name]
                 (or (get-in editor-yaml [:unique_ids item-key (keyword item-name)])
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
                                          ^bytes yamlb (when form-name (get-in tm ["forms" (str form-name ".yaml")]))]
                                    :when yamlb]
                                (assoc (util/parse-yaml-bytes yamlb) :class_name form-name :code (String. ^bytes (deref src))
                                                                    :id (get-id :forms form-name)))
                              (sort-by :class_name))

                            :modules
                            (->>
                              (for [[src-name, src] (get tm "modules")
                                    :let [[_ mod-name] (re-matches #"(.+)\.py" src-name)]
                                    :when mod-name]
                                {:name mod-name, :code (String. ^bytes (deref src))
                                 :id   (get-id :modules mod-name)})
                              (sort-by :name))

                            :server_modules
                            (->> (for [[src-name, src] (get tm "server_modules")
                                       :let [[_ mod-name] (re-matches #"(.+)\.py" src-name)]
                                       :when mod-name]
                                   {:name mod-name, :code (String. ^bytes (deref src))
                                    :id   (get-id :server_modules mod-name)})
                                 (sort-by :name))

                            :scripts
                            (->> (for [[src-name, src] (get tm "scripts")
                                       :let [[_ mod-name] (re-matches #"(.+)\.py" src-name)]
                                       :when mod-name]
                                   {:name mod-name, :code (String. ^bytes (deref src))
                                    :id   (get-id :scripts mod-name)})
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
                         (update-in [:runtime_options] (fn [opts]
                                                         (if-let [reqs (or (get-in tm ["server_code" "requirements.txt"])
                                                                           (get-in tm ["anvil-server-requirements.txt"]))]
                                                           (assoc-in opts [:server_spec :requirements] (String. ^bytes reqs))
                                                           opts)))
                         (add-subtree-to-yaml [] (get tm "client_code") true get-id)
                         (add-subtree-to-yaml [] (get tm "server_code") false get-id))]
    (if ignore-extra-files?
      core-app-files
      (add-extra-files-to-yaml core-app-files tm [:extra_files] true false false false))))

; Directory can be a file URL or a JAR URL
(defn get-app-yaml-from-resource-directory
  ([^URL directory ignore-extra-files?] (get-app-yaml-from-resource-directory directory ignore-extra-files? true))
  ([^URL directory ignore-extra-files? generate-uids?]
   (let [dir-map (resource-directory-to-map directory)
         yaml (tree-map-to-yaml dir-map ignore-extra-files? generate-uids?)]
     yaml)))
