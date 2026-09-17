(ns anvil.runtime.app-data-test
  (:require [anvil.runtime.app-data :as app-data]
            [anvil.runtime.html-form-template :as html-form-template]
            [clojure.string :as str]
            [clojure.test :refer [deftest is]]))

(def ^:private html-form-body
  (str "<h1>Title</h1>\n"
       "<anvil-component type=\"Button\" name=\"button_1\" prop:text=\"Go\"></anvil-component>"))

(def ^:private layout-html-form-body
  (str "<anvil-form layout=\"form:Form1\">\n"
       "  <anvil-block slot=\"main\">\n"
       "    <anvil-component type=\"Button\" name=\"button_1\" prop:text=\"button_1\"></anvil-component>\n"
       "  </anvil-block>\n"
       "</anvil-form>"))

(def ^:private slotted-html-form-body
  (str "<section>\n"
       "  <anvil-slot name=\"main\"></anvil-slot>\n"
       "</section>"))

(defn- html-form [class-name]
  {:class_name      class-name
   :code            ""
   :save_as_html    true
   :serialized_html html-form-body
   :container       {:type "HtmlComponent"}
   :components      [{:type "Button"
                      :name "button_1"
                      :properties {:text "Go"}}]
   :components_by_slot {"main" [{:type "Label"
                                 :name "label_1"
                                 :properties {:text "Slot"}}]}
   :slots           {"default" {:index 0}}})

(defn- app-content [forms dependency-code]
  {:name "Test App"
   :package_name "test_app"
   :forms forms
   :modules []
   :startup_form "Main"
   :services []
   :theme {:assets []
           :parameters {:color_scheme {:colors []}}}
   :dependency_code dependency-code
   :dependency_order (vec (keys dependency-code))
   :dependency_ids {}
   :runtime_options {:version 3}
   :config {:client {:enabled true}
            :server {:secret true}}})

(defn- sanitised-app-map [content]
  (with-redefs [app-data/get-app-info-insecure (fn [_] {:id "APP" :name "Test App"})
                app-data/get-app (fn [_ _ _]
                                   {:id "APP"
                                    :version "v1"
                                    :content content})]
    (second (app-data/sanitised-app-and-style-for-client "APP" {:branch "master"} nil {:allow-errors? true}))))

(deftest parse-html-template-string-preserves-layout-html-body
  (let [parsed (html-form-template/parse-html-template-string layout-html-form-body)]
    (is (:save_as_html parsed))
    (is (= layout-html-form-body (:serialized_html parsed)))
    (is (= {:type "form:Form1"} (:layout parsed)))
    (is (= [{:type "Button"
             :name "button_1"
             :properties {:text "button_1"}}]
           (get-in parsed [:components_by_slot "main"])))))

(deftest generate-html-template-does-not-write-slots-to-frontmatter
  (let [form-yaml {:save_as_html    true
                   :serialized_html slotted-html-form-body
                   :container       {:type "HtmlComponent"}
                   :components      []
                   :slots           {"main" {:index 0}}
                   :custom_component true}
        frontmatter (html-form-template/clean-html-frontmatter form-yaml)
        html-template (html-form-template/generate-html-template form-yaml)]
    (is (not (contains? frontmatter :slots)))
    (is (:custom_component frontmatter))
    (is (re-find #"(?m)^custom_component: true$" html-template))
    (is (not (re-find #"(?m)^slots:" html-template)))
    (is (re-find #"<anvil-slot name=\"main\"></anvil-slot>" html-template))))

(deftest generate-html-template-preserves-empty-slots-layout-marker
  (let [form-yaml {:save_as_html true
                   :serialized_html "<section></section>"
                   :container {:type "HtmlComponent"}
                   :components []
                   :slots {}}
        frontmatter (html-form-template/clean-html-frontmatter form-yaml)
        html-template (html-form-template/generate-html-template form-yaml)]
    (is (= {:slots {}} frontmatter))
    (is (re-find #"(?m)^slots: \{\}$" html-template))))

(deftest rename-package-qualified-form-specs-in-form-regenerates-html-body
  (let [form-yaml {:save_as_html true
                   :serialized_html (str "<anvil-form layout=\"Template_App.Layouts.BaseLayout\">\n"
                                         "  <anvil-block slot=\"content\">\n"
                                         "    <anvil-component type=\"RepeatingPanel\" name=\"repeating_panel_1\" prop:item_template=\"Template_App.RowTemplate\"></anvil-component>\n"
                                         "  </anvil-block>\n"
                                         "</anvil-form>")
                   :layout {:type "Template_App.Layouts.BaseLayout"}
                   :components_by_slot {"content" [{:type "RepeatingPanel"
                                                    :name "repeating_panel_1"
                                                    :properties {:item_template "Template_App.RowTemplate"}}]}}
        {:keys [form changed?]} (html-form-template/rename-package-qualified-form-specs-in-form
                                  form-yaml
                                  "Template_App"
                                  "Created_App_2")]
    (is changed?)
    (is (= "Created_App_2.Layouts.BaseLayout" (get-in form [:layout :type])))
    (is (= "Created_App_2.RowTemplate"
           (get-in form [:components_by_slot "content" 0 :properties :item_template])))
    (is (str/includes? (:serialized_html form) "layout=\"Created_App_2.Layouts.BaseLayout\""))
    (is (str/includes? (:serialized_html form) "prop:item_template=\"Created_App_2.RowTemplate\""))
    (is (not (str/includes? (:serialized_html form) "Template_App")))
    (is (not (str/includes? (:serialized_html form) "form:Layouts.BaseLayout")))))

(deftest rename-package-qualified-form-specs-in-form-leaves-legacy-local-form-specs
  (let [form-yaml {:save_as_html true
                   :serialized_html "<anvil-form layout=\"form:Layouts.BaseLayout\"></anvil-form>"
                   :layout {:type "form:Layouts.BaseLayout"}
                   :components_by_slot {}}
        {:keys [form changed?]} (html-form-template/rename-package-qualified-form-specs-in-form
                                  form-yaml
                                  "Template_App"
                                  "Created_App_2")]
    (is (not changed?))
    (is (= form-yaml form))))

(deftest rename-package-qualified-form-specs-in-app-yaml-uses-supplied-final-package
  (let [form-yaml {:save_as_html true
                   :serialized_html "<anvil-form layout=\"Template_App.Layouts.BaseLayout\"></anvil-form>"
                   :layout {:type "Template_App.Layouts.BaseLayout"}
                   :components_by_slot {}}
        app-yaml {:name "Created App 2"
                  :package_name "Created_App_2"
                  :forms [form-yaml]}
        renamed (html-form-template/rename-package-qualified-form-specs-in-app-yaml
                  app-yaml
                  "Template_App"
                  "Created_App_2")]
    (is (= "Created_App_2" (:package_name renamed)))
    (is (= "Created_App_2.Layouts.BaseLayout" (get-in renamed [:forms 0 :layout :type])))
    (is (str/includes? (get-in renamed [:forms 0 :serialized_html])
                       "layout=\"Created_App_2.Layouts.BaseLayout\""))))

(deftest sanitised-app-and-style-for-client-removes-html-storage-fields-from-runtime-forms
  (let [main-form (html-form "Main")
        dep-form (html-form "Dep")
        app-map (sanitised-app-map
                  (app-content [main-form]
                               {"DEP" {:forms [dep-form]
                                       :modules []
                                       :package_name "dep_app"
                                       :runtime_options {:version 3}
                                       :config {:client {:dep-enabled true}
                                                :server {:secret true}}}}))
        runtime-main-form (first (:forms app-map))
        runtime-dep-form (first (get-in app-map [:dependency_code "DEP" :forms]))]
    (is (not (contains? runtime-main-form :serialized_html)))
    (is (not (contains? runtime-main-form :save_as_html)))
    (is (not (contains? runtime-dep-form :serialized_html)))
    (is (not (contains? runtime-dep-form :save_as_html)))
    (doseq [[expected actual] [[main-form runtime-main-form]
                               [dep-form runtime-dep-form]]]
      (is (= (:container expected) (:container actual)))
      (is (= (:components expected) (:components actual)))
      (is (= (:components_by_slot expected) (:components_by_slot actual)))
      (is (= (:slots expected) (:slots actual))))))
