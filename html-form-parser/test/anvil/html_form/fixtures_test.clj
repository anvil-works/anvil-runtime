(ns anvil.html-form.fixtures-test
  (:require [anvil.html-form.core :as html-form]
            [clojure.data.json :as json]
            [clojure.java.io :as io]
            [clojure.test :as test :refer [deftest is testing]]))

(def fixture-root (io/file "test-fixtures/html-form"))

(defn- fixture-files [dir]
  (->> (file-seq dir)
       (filter #(and (.isFile %) (.endsWith (.getName %) ".json")))
       (sort-by #(.getPath %))))

(defn- read-fixture [file]
  (json/read-str (slurp file)))

(defn- json-shape [value]
  (json/read-str (json/write-str value)))

(defn- options->clj [value]
  (cond
    (map? value) (into {} (map (fn [[k v]] [(keyword k) (options->clj v)])) value)
    (vector? value) (mapv options->clj value)
    :else value))

(defn- reset-dropzone-generator! []
  (html-form/set-default-dropzone-name-generator
    (fn [] (html-form/create-deterministic-dropzone-name-generator))))

(defn- parse-fixture [{:strs [entrypoint html containerType options]}]
  (reset-dropzone-generator!)
  (let [options (some-> options options->clj)]
    (case entrypoint
      "parseContainerForm" (html-form/parse-container-form html (or containerType "HtmlComponent") options)
      "parseLayoutForm" (html-form/parse-layout-form html options)
      "parseSerializedHtml" (html-form/parse-serialized-html html options))))

(defn- serialize-fixture [{:strs [entrypoint serializerInput]} parsed]
  (let [serializer-input (or (some-> serializerInput options->clj) parsed)]
    (if (or (= entrypoint "parseLayoutForm") (:layout serializer-input))
      (html-form/serialize-form-layout serializer-input)
      (html-form/serialize-form-container serializer-input))))

(defn- fixture-result-shape [_ parsed]
  (json-shape parsed))

(deftest default-hash-dropzone-names-match-js
  (html-form/set-default-dropzone-name-generator nil)
  (let [parsed (html-form/parse-container-form
                 "<div><anvil-component type='Button' name='b'></anvil-component><anvil-slot name='s'></anvil-slot></div>")]
    (is (= "$dz_9iwv7k" (get-in parsed [:components 0 :layout_properties :dropzone])))
    (is (= "$dz_hfan0g" (get-in parsed [:slots "s" :set_layout_properties :dropzone])))))

(deftest skips-empty-slot-placeholder-text
  (let [parsed {:container {:type "HtmlComponent"
                            :properties {:html "<anvil-dropzone name=\"default\"></anvil-dropzone>"}}
                :components []
                :slots {"body" {:target {:type "container" :name ""}
                                :index 0
                                :set_layout_properties {:dropzone "default"}
                                :placeholder_text ""}}}]
    (is (= "<anvil-slot name=\"body\"></anvil-slot>"
           (html-form/serialize-form-container parsed)))))

(deftest form-spec-rewrites-only-treat-repeating-panel-item-template-as-form-property
  (let [form {:class_name "Form1"
              :code ""
              :container {:type "form:Container" :properties {}}
              :components [{:type "RepeatingPanel"
                            :name "repeating_panel_1"
                            :properties {:item_template "LocalRow"}}
                           {:type "RepeatingPanel"
                            :name "repeating_panel_2"
                            :properties {:item_template "dep_id:DepRow"}}
                           {:type "RepeatingPanel"
                            :name "repeating_panel_3"
                            :properties {:item_template "Folder.LocalRow"}}
                           {:type "RepeatingPanel"
                            :name "repeating_panel_4"
                            :properties {:item_template "DepPackage.AlreadyQualifiedRow"}}
                           {:type "RepeatingPanel"
                            :name "repeating_panel_5"
                            :properties {:item_template "AppPackage.AlreadyQualifiedRow"}}
                           {:type "CustomComponent"
                            :name "custom_component_1"
                            :properties {:item_template "NotAFormPropertySpec"}}]}
        result (html-form/canonicalize-form-specs-in-form-yaml
                 form
                 {:app-package-name "AppPackage"
                  :known-package-names ["DepPackage"]
                  :dependency-package-names-by-logical-dep-id {"dep_id" "DepPackage"}})]
    (is (:changed? result))
    (is (= "AppPackage.Container" (get-in result [:form :container :type])))
    (is (= "AppPackage.LocalRow" (get-in result [:form :components 0 :properties :item_template])))
    (is (= "DepPackage.DepRow" (get-in result [:form :components 1 :properties :item_template])))
    (is (= "AppPackage.Folder.LocalRow" (get-in result [:form :components 2 :properties :item_template])))
    (is (= "DepPackage.AlreadyQualifiedRow" (get-in result [:form :components 3 :properties :item_template])))
    (is (= "AppPackage.AlreadyQualifiedRow" (get-in result [:form :components 4 :properties :item_template])))
    (is (= "NotAFormPropertySpec" (get-in result [:form :components 5 :properties :item_template])))))

(deftest form-spec-rewriter-only-treats-configured-property-names-as-form-property-specs
  (let [form {:class_name "Form1"
              :code ""
              :layout {:type "OldPackage.Layout" :properties {}}
              :components_by_slot {"default" [{:type "RepeatingPanel"
                                               :name "repeating_panel_1"
                                               :properties {:item_template "old_dep:DepRow"
                                                            :form "old_dep:PanelForm"}}
                                              {:type "CustomComponent"
                                               :name "custom_component_1"
                                               :properties {:item_template "old_dep:NotAFormPropertySpec"}}
                                              {:type "m3._Components.NavLink"
                                               :name "nav_link_1"
                                               :properties {:form "old_dep:NavTarget"
                                                            :other "old_dep:NotAFormPropertySpec"}}
                                              {:type "OldPackage.CustomComponent"
                                               :name "custom_component_3"
                                               :properties {}}]}
              :slots {"main" {:target {:type "container" :name ""}
                              :template {:type "OldPackage.SlotTemplate"
                                         :name "slot_template"
                                         :properties {}
                                         :components [{:type "RepeatingPanel"
                                                       :name "slot_repeating_panel"
                                                       :properties {:item_template "old_dep:DepRow"}}]}}}}
        result (html-form/rewrite-form-specs-in-form-yaml
                 form
                 {:custom-component-spec (fn [custom-component-spec]
                                         ({"OldPackage.Layout" "NewPackage.Layout"
                                           "OldPackage.CustomComponent" "NewPackage.CustomComponent"
                                           "OldPackage.SlotTemplate" "NewPackage.SlotTemplate"}
                                          custom-component-spec))
                  :form-property-spec (fn [form-property-spec]
                                        ({"old_dep:DepRow" "NewPackage.DepRow"
                                          "old_dep:PanelForm" "NewPackage.PanelForm"
                                          "old_dep:NavTarget" "NewPackage.NavTarget"
                                          "old_dep:NotAFormPropertySpec" "WRONG"}
                                         form-property-spec))
                  :form-typed-property-names-by-component-type {"RepeatingPanel" [:form]
                                                                "m3._Components.NavLink" [:form]}})]
    (is (:changed? result))
    (is (= "NewPackage.Layout" (get-in result [:form :layout :type])))
    (is (= "NewPackage.DepRow" (get-in result [:form :components_by_slot "default" 0 :properties :item_template])))
    (is (= "NewPackage.PanelForm" (get-in result [:form :components_by_slot "default" 0 :properties :form])))
    (is (= "old_dep:NotAFormPropertySpec"
           (get-in result [:form :components_by_slot "default" 1 :properties :item_template])))
    (is (= "NewPackage.NavTarget" (get-in result [:form :components_by_slot "default" 2 :properties :form])))
    (is (= "old_dep:NotAFormPropertySpec"
           (get-in result [:form :components_by_slot "default" 2 :properties :other])))
    (is (= "NewPackage.CustomComponent" (get-in result [:form :components_by_slot "default" 3 :type])))
    (is (= "NewPackage.SlotTemplate" (get-in result [:form :slots "main" :template :type])))
    (is (= "NewPackage.DepRow"
           (get-in result [:form :slots "main" :template :components 0 :properties :item_template])))))

(deftest clean-html-frontmatter-omits-false-custom-component-flags
  (is (nil? (html-form/clean-html-frontmatter {:custom_component false
                                               :container {:type "ColumnPanel"}})))
  (is (= {:custom_component true}
         (html-form/clean-html-frontmatter {:custom_component true
                                            :container {:type "ColumnPanel"}})))
  (is (nil? (html-form/clean-html-frontmatter {:custom_component_container false
                                               :layout {:type "form:MainLayout"}}))))

(deftest serialize-html-template-wraps-frontmatter-and-body
  (let [form {:custom_component true
              :properties [{:name "title" :type "string"}]
              :container {:type "ColumnPanel"}
              :components []}
        html (html-form/serialize-html-template form)]
    (is (re-find #"^---\n" html))
    (is (re-find #"custom_component: true" html))
    (is (re-find #"<anvil-form container=\"ColumnPanel\"></anvil-form>\s*$" html))))

(deftest serialize-html-template-keeps-empty-layout-slots-in-frontmatter
  (let [form {:layout {:type "form:MainLayout"}
              :components_by_slot {}
              :slots {}}
        html (html-form/serialize-html-template form)]
    (is (re-find #"^---\n" html))
    (is (re-find #"slots: \{\}" html))
    (is (re-find #"<anvil-form layout=\"form:MainLayout\">" html))))

(deftest builds-yaml-form-template-save-payload
  (let [source (html-form/parse-form-template-source
                 (str "id: template-id\n"
                      "class_name: WrongName\n"
                      "code: wrong\n"
                      "is_package: false\n"
                      "container:\n"
                      "  type: ColumnPanel\n"
                      "components: []\n")
                 {:format "yaml"})
        payload (html-form/build-form-template-save-payload
                  source
                  {:class-name "RightName"
                   :code "# real code\n"
                   :is-package true})]
    (is (= {:format "yaml"
            :template {:id "template-id"
                       :class_name "WrongName"
                       :code "wrong"
                       :is_package false
                       :container {:type "ColumnPanel"}
                       :components []}}
           source))
    (is (= {:container {:type "ColumnPanel"}
            :components []
            :class_name "RightName"
            :code "# real code\n"
            :is_package true}
           payload))))

(deftest builds-html-form-template-save-payload
  (let [html (str "---\n"
                  "custom_component: true\n"
                  "class_name: WrongName\n"
                  "serialized_html: wrong\n"
                  "---\n"
                  "<anvil-form container=\"ColumnPanel\"></anvil-form>\n")
        source (html-form/parse-form-template-source html {:format "html"})
        payload (html-form/build-form-template-save-payload
                  source
                  {:class-name "HtmlForm"
                   :code "# html code\n"
                   :is-package false})]
    (is (= {:format "html"
            :template {:custom_component true
                       :class_name "WrongName"
                       :serialized_html "wrong"}
            :serialized-html "<anvil-form container=\"ColumnPanel\"></anvil-form>\n"}
           source))
    (is (= {:custom_component true
            :class_name "HtmlForm"
            :code "# html code\n"
            :is_package false
            :save_as_html true
            :serialized_html "<anvil-form container=\"ColumnPanel\"></anvil-form>\n"}
           payload))))

(deftest parses-html-form-template-without-frontmatter
  (let [html "<anvil-form container=\"ColumnPanel\"></anvil-form>"
        source (html-form/parse-form-template-source html {:format "html"})]
    (is (= {:format "html"
            :template {}
            :serialized-html html}
           source))))

(deftest rejects-unsavable-form-template-save-payloads
  (is (thrown-with-msg?
        IllegalArgumentException
        #"className must not be empty"
        (html-form/build-form-template-save-payload
          {:format "yaml" :template {}}
          {:class-name "" :code "" :is-package true})))
  (is (thrown-with-msg?
        IllegalArgumentException
        #"code must be a string"
        (html-form/build-form-template-save-payload
          {:format "yaml" :template {}}
          {:class-name "Form1" :is-package true})))
  (is (thrown-with-msg?
        IllegalArgumentException
        #"isPackage must be a boolean"
        (html-form/build-form-template-save-payload
          {:format "yaml" :template {}}
          {:class-name "Form1" :code ""})))
  (is (thrown-with-msg?
        IllegalArgumentException
        #"serializedHtml must be a string"
        (html-form/build-form-template-save-payload
          {:format "html" :template {}}
          {:class-name "Form1" :code "" :is-package true})))
  (is (thrown-with-msg?
        IllegalArgumentException
        #"must be a YAML object"
        (html-form/parse-form-template-source "not-an-object" {:format "yaml"}))))

(deftest shared-fixtures-against-jvm-parser
  (doseq [file (fixture-files fixture-root)]
    (let [{:strs [name expected expectedSerializedHtml] :as fixture} (read-fixture file)
          parsed (parse-fixture fixture)]
      (testing name
        (is (= expected (fixture-result-shape fixture parsed)))
        (when expectedSerializedHtml
          (is (= expectedSerializedHtml (serialize-fixture fixture parsed))))))))

(defn -main [& _args]
  (let [{:keys [fail error]} (test/run-tests 'anvil.html-form.fixtures-test)]
    (when (pos? (+ fail error))
      (System/exit 1))))
