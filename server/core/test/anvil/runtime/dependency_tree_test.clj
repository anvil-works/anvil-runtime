(ns anvil.runtime.dependency-tree-test
  (:require [anvil.runtime.app-data :as app-data]
            [clojure.test :refer [deftest is testing]]
            [slingshot.slingshot :refer [try+]]))

(defn- with-dependency-apps [second-version check]
  (let [v1 {:version_tag "v1"}
        apps {"MAIN" {:dependencies [{:app_id "A" :version v1} {:app_id "B" :version v1}]}
              "A" {:dependencies [{:dep_id "shared-a" :version v1
                                   :resolution_hints {:name "Shared library"}
                                   :config {:server {:token {:value "private"}}}}]}
              "B" {:dependencies [{:dep_id "shared-b" :version second-version}]}
              "SHARED" {:package_name "shared"
                        :forms [{:class_name "Form1" :code "class Form1: pass"}]
                        :modules [{:name "Module1" :code "value = 1"}]
                        :server_modules [{:name "ServerModule1" :code "value = 2"}]
                        :config_schema {:server {:token {:default_value "default"}}}}}
        infos {"MAIN" {:id "MAIN" :name "Main"}
               "A" {:id "A" :name "A" :dep_ids {"shared-a" "SHARED"}}
               "B" {:id "B" :name "B" :dep_ids {"shared-b" "SHARED"}}
               "SHARED" {:id "SHARED" :name "Shared library"}}
        reads (atom [])]
    (with-redefs [app-data/get-app-info-with-can-depend
                  (fn [_ app-id _] (some-> (get infos app-id) (assoc :can_depend true)))
                  app-data/get-app-content
                  (fn [{:keys [id]} _]
                    (swap! reads conj id)
                    {:content (get apps id) :version (str id "-commit")})]
      (check (get infos "MAIN") reads))))

(deftest shared-dependencies-keep-each-parent-requirement
  (with-dependency-apps
    {:version_tag "v1"}
    (fn [main reads]
      (let [app (app-data/get-app main {:branch "master"})
            deps (get-in app [:content :dependency_code])
            graph (:dependency_graph app)]
        (is (= [{:dep_id "shared-a" :app_id "SHARED" :version {:version_tag "v1"}
                 :resolution_hints {:name "Shared library"}}]
               (get graph "A")))
        (is (= [{:dep_id "shared-b" :app_id "SHARED" :version {:version_tag "v1"}
                 :resolution_hints {:name "Shared library"}}]
               (get graph "B")))
        (testing "a successfully read leaf has an explicit empty dependency list"
          (is (= [] (get graph "SHARED"))))
        (testing "inspection metadata does not change dependency code or app content"
          (is (not-any? #(contains? % :dependencies) (vals deps)))
          (is (not (contains? (:content app) :dependency_graph)))
          (is (= {:version-spec {:version_tag "v1"}
                  :commit-id "SHARED-commit" :depending_app "A" :name "Shared library"
                  :package_name "shared"
                  :forms [{:class_name "Form1" :code "class Form1: pass"}]
                  :modules [{:name "Module1" :code "value = 1"}]
                  :server_modules [{:name "ServerModule1" :code "value = 2"}]
                  :config_schema {:server {:token {:default_value "default"}}}
                  :assets nil :overriden_assets '() :form_templates nil :color_scheme nil :roles nil
                  :config {:client {} :server {:token "private"}}}
                 (get deps "SHARED"))))
        (is (= 1 (count (filter #{"SHARED"} @reads))))))))

(deftest conflicting-transitive-versions-retain-paths-and-still-fail
  (with-dependency-apps
    {:version_tag "v2"}
    (fn [main _]
      (let [app (app-data/get-app main {:branch "master"})
            deps (get-in app [:content :dependency_code])
            graph (:dependency_graph app)]
        (is (= {:version_tag "v1"} (get-in graph ["A" 0 :version])))
        (is (= {:version_tag "v2"} (get-in graph ["B" 0 :version])))
        (is (= [] (get graph "SHARED")))
        (is (= #{:error :config} (set (keys (get deps "SHARED")))))
        (is (re-find #"Dependency version mismatch" (get-in deps ["SHARED" :error])))
        (is (try+
              (app-data/get-app main {:branch "master"} false)
              false
              (catch [:anvil/app-loading-error "SHARED"] _ true)))))))

(deftest a-version-conflict-keeps-previously-read-child-requirements
  (with-dependency-apps
    {:version_tag "v2"}
    (fn [main _]
      (let [read-content app-data/get-app-content
            child {:app_id "CHILD" :version {:version_tag "v1"}}]
        (with-redefs [app-data/get-app-content
                      (fn [info version]
                        (cond-> (read-content info version)
                          (= "SHARED" (:id info)) (assoc-in [:content :dependencies] [child])))]
          (let [app (app-data/get-app main {:branch "master"})]
            (is (re-find #"Dependency version mismatch" (get-in app [:content :dependency_code "SHARED" :error])))
            (is (= [(assoc child :dep_id "CHILD")] (get-in app [:dependency_graph "SHARED"])))
            (is (= "App dependency not found" (get-in app [:content :dependency_code "CHILD" :error])))))))))

(deftest missing-mapped-dependencies-keep-the-edge-without-claiming-to-be-leaves
  (let [main {:id "MAIN"}
        parent {:id "PARENT" :dep_ids {"missing-library" "MISSING"}}]
    (with-redefs [app-data/get-app-info-with-can-depend
                  (fn [_ app-id _]
                    (when (= app-id "PARENT") (assoc parent :can_depend true)))
                  app-data/get-app-content
                  (fn [{:keys [id]} _]
                    {:content {:dependencies (if (= id "MAIN")
                                               [{:app_id "PARENT" :version {:dev false}}]
                                               [{:dep_id "missing-library" :version {:dev false}}])}
                     :version "commit"})]
      (let [app (app-data/get-app main {:branch "master"})
            deps (get-in app [:content :dependency_code])
            graph (:dependency_graph app)]
        (is (= "MISSING" (get-in graph ["PARENT" 0 :app_id])))
        (is (= {:error "Unresolved dependency" :logical_dep_id "missing-library"}
               (select-keys (get deps "MISSING") [:error :logical_dep_id])))
        (is (not (contains? graph "MISSING")))))))
