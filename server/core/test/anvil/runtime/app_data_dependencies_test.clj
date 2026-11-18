(ns anvil.runtime.app-data-dependencies-test
  (:require [anvil.runtime.app-data :as app-data]
            [clojure.test :refer [deftest is testing]]
            [clj-commons.slingshot :refer [throw+]]))

;; Each registry entry describes a stored app. Dependencies and dep_ids use the
;; same shapes as app YAML and database mappings. Only storage lookups are replaced;
;; selection, traversal, permissions and error handling run through the real loader.
(defn- load-dependencies [apps]
  (let [content-loads (atom [])
        app-info (fn [app-id]
                   (when-let [app (get apps app-id)]
                     (merge {:id app-id :name app-id :dep_ids {} :can_depend true}
                            (select-keys app [:dep_ids :can_depend]))))]
    (with-redefs [app-data/get-app-info-with-can-depend (fn [_depending-app-id app-id _version]
                                                       (app-info app-id))
                  app-data/get-app-content (fn [{:keys [id]} _version]
                                             (when-not (contains? apps id)
                                               (throw (ex-info "Unexpected app content lookup" {:app-id id})))
                                             (swap! content-loads conj id)
                                             (when (:invalid-yaml (get apps id))
                                               (throw+ {:anvil/invalid-yaml true :anvil/server-error "Invalid YAML in Widgets"}))
                                             (when-let [message (:load-error (get apps id))]
                                               (throw (ex-info message {:anvil/app-loading-error id :message message})))
                                             {:version "commit-1"
                                              :content (merge {:dependencies [] :theme {:assets []}
                                                               :config_schema {} :forms [] :modules []
                                                               :server_modules [] :package_name id}
                                                              (dissoc (get apps id) :dep_ids :can_depend :load-error))})]
      {:content (:content (app-data/get-app-content-with-dependencies (app-info "Main") {:branch "master"}))
       :content-loads @content-loads})))

;; These tests characterize master before changing error reporting. The expected
;; app names are intentional examples, not outputs calculated by another resolver.
(deftest stored-remapping-wins-for-either-reference-field
  (testing "Master loads ReplacementWidgets even when YAML still names OriginalWidgets."
    (doseq [reference-key [:app_id :dep_id]]
      (testing (name reference-key)
        (let [{:keys [content content-loads]}
              (load-dependencies
                {"Main" {:dep_ids {"OriginalWidgets" "ReplacementWidgets"}
                         :dependencies [{reference-key "OriginalWidgets" :version {:dev true}}]}
                 "OriginalWidgets" {}
                 "ReplacementWidgets" {}})]
          (is (= ["Main" "ReplacementWidgets"] content-loads))
          (is (= ["ReplacementWidgets"] (:dependency_order content)))
          (is (= {"OriginalWidgets" "ReplacementWidgets"}
                 (:dependency_ids content) (:correct_dependency_ids content))))))))

(deftest an-unmapped-reference-can-name-an-existing-app
  (testing "Without a mapping, master tries the reference itself as an app ID for both dep_id and app_id."
    (doseq [reference-key [:app_id :dep_id]]
      (testing (name reference-key)
        (let [{:keys [content content-loads]}
              (load-dependencies
                {"Main" {:dependencies [{reference-key "Widgets" :version {:dev true}}]}
                 "Widgets" {}})]
          (is (= ["Main" "Widgets"] content-loads))
          (is (= ["Widgets"] (:dependency_order content)))
          (is (= {"Widgets" "Widgets"} (:dependency_ids content) (:correct_dependency_ids content)))
          (is (nil? (get-in content [:dependency_code "Widgets" :error]))))))))

(deftest mixed-reference-fields-share-one-selection-in-either-order
  (testing "Master loads ReplacementWidgets once when dep_id and app_id name the same remapped reference."
    (doseq [reference-keys [[:dep_id :app_id] [:app_id :dep_id]]]
      (testing (str reference-keys)
        (let [{:keys [content content-loads]}
              (load-dependencies
                {"Main" {:dep_ids {"OriginalWidgets" "ReplacementWidgets"}
                         :dependencies (mapv #(hash-map % "OriginalWidgets" :version {:dev true}) reference-keys)}
                 "OriginalWidgets" {}
                 "ReplacementWidgets" {}})]
          (is (= ["Main" "ReplacementWidgets"] content-loads))
          (is (= #{"ReplacementWidgets"} (set (keys (:dependency_code content)))))
          (is (= ["ReplacementWidgets"] (:dependency_order content)))
          (is (= {"OriginalWidgets" "ReplacementWidgets"}
                 (:dependency_ids content) (:correct_dependency_ids content))))))))

(deftest root-mapping-wins-over-a-dependencys-conflicting-mapping
  (testing "Master uses Main's ChosenWidgets, even though Reports suggests OtherWidgets for the same reference."
    (let [{:keys [content content-loads]}
          (load-dependencies
            {"Main" {:dep_ids {"widgets" "ChosenWidgets"}
                     :dependencies [{:app_id "Reports" :version {:dev true}}]}
             "Reports" {:dep_ids {"widgets" "OtherWidgets"}
                        :dependencies [{:dep_id "widgets" :version {:dev true}}]}
             "ChosenWidgets" {}
             "OtherWidgets" {}})]
      (is (= ["Main" "Reports" "ChosenWidgets"] content-loads))
      (is (= ["ChosenWidgets" "Reports"] (:dependency_order content)))
      (is (= {"Reports" "Reports" "widgets" "ChosenWidgets"}
             (:dependency_ids content) (:correct_dependency_ids content))))))

(deftest first-discovered-mapping-wins-across-subtrees
  (testing "Master keeps the first dependency's mapping; reversing the root dependency order changes which mapping wins."
    (doseq [[parent-order chosen-widgets]
            [[["Reports" "Charts"] "ReportWidgets"]
             [["Charts" "Reports"] "ChartWidgets"]]]
      (testing (str parent-order)
        (let [{:keys [content content-loads]}
              (load-dependencies
                {"Main" {:dependencies (mapv #(hash-map :app_id % :version {:dev true}) parent-order)}
                 "Reports" {:dep_ids {"widgets" "ReportWidgets"}
                            :dependencies [{:dep_id "widgets" :version {:dev true}}]}
                 "Charts" {:dep_ids {"widgets" "ChartWidgets"}
                           :dependencies [{:dep_id "widgets" :version {:dev true}}]}
                 "ReportWidgets" {}
                 "ChartWidgets" {}})]
          (is (= (into ["Main"] (conj parent-order chosen-widgets)) content-loads))
          (is (= chosen-widgets (get-in content [:dependency_ids "widgets"])
                 (get-in content [:correct_dependency_ids "widgets"]))))))))

(deftest a-mapping-discovered-before-a-reference-is-processed-can-resolve-it
  (testing "Master loads Reports and Charts before their children, so Reports can supply the mapping Charts needs."
    (let [{:keys [content content-loads]}
          (load-dependencies
            {"Main" {:dependencies [{:app_id "Reports" :version {:dev true}}
                                   {:app_id "Charts" :version {:dev true}}]}
             "Reports" {:dep_ids {"widgets" "SharedWidgets"}}
             "Charts" {:dependencies [{:dep_id "widgets" :version {:dev true}}]}
             "SharedWidgets" {}})]
      (is (= ["Main" "Reports" "Charts" "SharedWidgets"] content-loads))
      (is (= ["SharedWidgets" "Charts" "Reports"] (:dependency_order content)))
      (is (= {"Reports" "Reports" "Charts" "Charts" "widgets" "SharedWidgets"}
             (:dependency_ids content) (:correct_dependency_ids content))))))

(deftest a-failed-first-selection-is-not-rescued-by-a-later-mapping
  (testing "Master first fails to find widgets; a later app offering SharedWidgets does not rescue that reference."
    (let [{:keys [content content-loads]}
          (load-dependencies
            {"Main" {:dependencies [{:app_id "Reports" :version {:dev true}}
                                   {:app_id "Charts" :version {:dev true}}]}
             "Reports" {:dependencies [{:dep_id "widgets" :version {:dev true}}]}
             "Charts" {:dependencies [{:app_id "WidgetCatalogue" :version {:dev true}}
                                      {:dep_id "widgets" :version {:dev true}}]}
             "WidgetCatalogue" {:dep_ids {"widgets" "SharedWidgets"}}
             "SharedWidgets" {}})]
      (is (= ["Main" "Reports" "Charts" "WidgetCatalogue"] content-loads))
      (is (= ["WidgetCatalogue" "Charts" "Reports"] (:dependency_order content)))
      (is (= "widgets" (get-in content [:dependency_ids "widgets"])
             (get-in content [:correct_dependency_ids "widgets"])))
      (is (some? (get-in content [:dependency_code "widgets" :error])))
      (is (not (contains? (:dependency_code content) "SharedWidgets"))))))

(deftest duplicate-references-to-the-same-version-load-content-once
  (testing "Master reads Widgets once even when both Reports and Charts request it."
    (let [{:keys [content content-loads]}
          (load-dependencies
            {"Main" {:dep_ids {"widgets" "Widgets"}
                     :dependencies [{:app_id "Reports" :version {:dev true}}
                                    {:app_id "Charts" :version {:dev true}}]}
             "Reports" {:dependencies [{:dep_id "widgets" :version {:dev true}}]}
             "Charts" {:dependencies [{:dep_id "widgets" :version {:dev true}}]}
             "Widgets" {}})]
      (is (= ["Main" "Reports" "Charts" "Widgets"] content-loads))
      (is (= ["Widgets" "Charts" "Reports"] (:dependency_order content)))
      (is (nil? (get-in content [:dependency_code "Widgets" :error]))))))

(deftest different-requested-versions-of-one-app-report-a-conflict
  (testing "Master reports a version mismatch when Reports wants development Widgets and Charts wants its published version."
    (let [{:keys [content content-loads]}
          (load-dependencies
            {"Main" {:dep_ids {"widgets" "Widgets"}
                     :dependencies [{:app_id "Reports" :version {:dev true}}
                                    {:app_id "Charts" :version {:dev true}}]}
             "Reports" {:dependencies [{:dep_id "widgets" :version {:dev true}}]}
             "Charts" {:dependencies [{:dep_id "widgets" :version {}}]}
             "Widgets" {}})]
      (is (= ["Main" "Reports" "Charts" "Widgets"] content-loads))
      (is (= ["Widgets" "Charts" "Reports"] (:dependency_order content)))
      (is (re-find #"Dependency version mismatch" (get-in content [:dependency_code "Widgets" :error]))))))

(deftest missing-app-errors-identify-the-reference-and-selected-app
  (testing "Missing dep_id targets are unresolved; app_id keeps its legacy error. Remapped errors belong under the selected app ID."
    (doseq [[reference-key expected-error] [[:dep_id "Unresolved dependency"]
                                          [:app_id "App dependency not found"]]
            [mappings error-key] [[{} "widgets"]
                                  [{"widgets" "MissingWidgets"} "MissingWidgets"]]]
      (testing (str reference-key " with mappings " mappings)
        (let [hints {:app_id "OriginalWidgets" :name "Widgets"}
              {:keys [content content-loads]}
              (load-dependencies
                {"Main" {:dep_ids mappings
                         :dependencies [{reference-key "widgets" :version {:dev true}
                                         :resolution_hints hints}]}})]
          (is (= ["Main"] content-loads))
          (is (= #{error-key} (set (keys (:dependency_code content)))))
          (is (= {:error expected-error :logical_dep_id "widgets" :resolution_hints hints}
                 (dissoc (get-in content [:dependency_code error-key]) :config)))
          (is (= error-key (get-in content [:dependency_ids "widgets"])
                 (get-in content [:correct_dependency_ids "widgets"]))))))))

(deftest an-inaccessible-app-reports-permission-denied-without-loading-its-content
  (testing "A resolved but forbidden app is a permission failure, not a missing dependency."
    (let [{:keys [content content-loads]}
          (load-dependencies
            {"Main" {:dep_ids {"widgets" "PrivateWidgets"}
                     :dependencies [{:dep_id "widgets" :version {:dev true}}]}
             "PrivateWidgets" {:can_depend false}})]
      (is (= ["Main"] content-loads))
      (is (= {:error "Permission denied" :logical_dep_id "widgets"}
             (dissoc (get-in content [:dependency_code "PrivateWidgets"]) :config)))
      (is (empty? (:dependency_order content))))))

(deftest invalid-yaml-errors-belong-to-the-remapped-app
  (testing "Widgets resolves to BrokenWidgets, so its invalid-YAML error uses that app's key and retains the logical reference."
    (let [{:keys [content content-loads]}
          (load-dependencies
            {"Main" {:dep_ids {"widgets" "BrokenWidgets"}
                     :dependencies [{:dep_id "widgets" :version {:dev true}}]}
             "BrokenWidgets" {:invalid-yaml true}})]
      (is (= ["Main" "BrokenWidgets"] content-loads))
      (is (= #{"BrokenWidgets"} (set (keys (:dependency_code content)))))
      (is (= {:error "Invalid YAML in Widgets" :logical_dep_id "widgets"}
             (dissoc (get-in content [:dependency_code "BrokenWidgets"]) :config))))))

(deftest content-loading-failures-retain-the-error-and-reference-metadata
  (testing "When storage cannot load the selected version, callers get its error plus the reference needed to repair it."
    (let [hints {:name "Widgets"}
          {:keys [content content-loads]}
          (load-dependencies
            {"Main" {:dep_ids {"widgets" "Widgets"}
                     :dependencies [{:dep_id "widgets" :version {:dev true} :resolution_hints hints}]}
             "Widgets" {:load-error "App version not found"}})]
      (is (= ["Main" "Widgets"] content-loads))
      (is (= {:error "App version not found" :logical_dep_id "widgets" :resolution_hints hints}
             (dissoc (get-in content [:dependency_code "Widgets"]) :config))))))

(deftest repeated-references-to-an-invalid-app-keep-the-original-error
  (testing "Two references requesting the same version of BrokenWidgets must not turn its YAML error into a version mismatch."
    (let [hints {:name "Widgets"}
          {:keys [content]}
          (load-dependencies
            {"Main" {:dep_ids {"widgets" "BrokenWidgets"}
                     :dependencies [{:dep_id "widgets" :version {:dev true} :resolution_hints hints}
                                    {:app_id "widgets" :version {:dev true}}]}
             "BrokenWidgets" {:invalid-yaml true}})]
      (is (= {:error "Invalid YAML in Widgets" :logical_dep_id "widgets" :resolution_hints hints}
             (dissoc (get-in content [:dependency_code "BrokenWidgets"]) :config))))))
