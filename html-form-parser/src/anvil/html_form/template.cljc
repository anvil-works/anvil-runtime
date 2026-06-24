(ns anvil.html-form.template
  (:require [anvil.html-form.serializer :as serializer]
            #?(:clj [clj-yaml.core :as yaml]
               :cljs ["yaml" :as yaml])))

(def ^:private structural-keys
  #{:components :components_by_slot :container :layout :serialized_html})

(def ^:private frontmatter-pattern #"(?s)^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$")

(defn clean-template-yaml
  "Remove fields that are inferred from app storage paths or HTML serialization."
  [form-yaml]
  (-> form-yaml
      (dissoc :save_as_html :code :class_name :id :is_package :serialized_html)))

(defn- invalid-template! [message]
  (throw #?(:clj (IllegalArgumentException. message)
            :cljs (js/Error. message))))

(defn- require-template-map [value label]
  (if (map? value)
    value
    (invalid-template! (str label " must be a YAML object"))))

(defn- parse-yaml [yaml-string]
  (let [parsed #?(:clj (yaml/parse-string (or yaml-string ""))
                  :cljs (js->clj (yaml/parse (or yaml-string "")) :keywordize-keys true))]
    (if (nil? parsed)
      {}
      (require-template-map parsed "form template YAML"))))

(defn split-frontmatter
  "Split an HTML form template into optional YAML frontmatter and HTML body."
  [html-template]
  (let [[_ yaml-str html-content] (re-matches frontmatter-pattern html-template)]
    {:frontmatter (when yaml-str (parse-yaml yaml-str))
     :html (if yaml-str html-content html-template)}))

(defn parse-form-template-source
  "Parse a YAML or HTML form template source into a format-tagged template object.

  This preserves HTML body text as-is; it does not structurally parse or
  normalize serialized HTML."
  [content {:keys [format]}]
  (case (name format)
    "html" (let [{:keys [frontmatter html]} (split-frontmatter content)]
             {:format "html"
              :template (or frontmatter {})
              :serialized-html html})
    "yaml" {:format "yaml"
            :template (parse-yaml content)}
    (let [message (str "Unsupported form template format: " format)]
      (throw #?(:clj (IllegalArgumentException. message)
                :cljs (js/Error. message))))))

(defn- identity-value [identity kebab-key camel-key snake-key]
  (get identity kebab-key (get identity camel-key (get identity snake-key))))

(defn- require-string [value label]
  (when-not (string? value)
    (invalid-template! (str label " must be a string")))
  value)

(defn- require-non-empty-string [value label]
  (require-string value label)
  (when (empty? value)
    (invalid-template! (str label " must not be empty")))
  value)

(defn- require-boolean [value label]
  (when-not (or (true? value) (false? value))
    (invalid-template! (str label " must be a boolean")))
  value)

(defn build-form-template-save-payload
  "Build the form object sent to Anvil's save API for a parsed template source.

  Path-derived identity fields are authoritative and template-supplied managed
  fields are stripped before the identity is overlaid."
  [source identity]
  (let [template (require-template-map (:template source) "form template source.template")
        html (get source :serialized-html (:serializedHtml source))
        format (:format source)
        class-name (require-non-empty-string
                     (identity-value identity :class-name :className :class_name)
                     "form template save identity className")
        code (require-string (:code identity) "form template save identity code")
        is-package (require-boolean
                     (identity-value identity :is-package :isPackage :is_package)
                     "form template save identity isPackage")
        payload (assoc (clean-template-yaml template)
                       :class_name class-name
                       :code code
                       :is_package is-package)]
    (case (name format)
      "html" (assoc payload
                    :save_as_html true
                    :serialized_html (require-string html "HTML form template serializedHtml"))
      "yaml" payload
      (invalid-template! (str "Unsupported form template format: " format)))))

(defn clean-html-frontmatter
  "Return the form metadata that should be written as HTML template frontmatter."
  [form-yaml]
  (let [cleaned (cond-> (apply dissoc (clean-template-yaml form-yaml) structural-keys)
                  (empty? (:components form-yaml)) (dissoc :components)
                  (empty? (:events form-yaml)) (dissoc :events)
                  (empty? (:properties form-yaml)) (dissoc :properties)
                  (not= {} (:slots form-yaml)) (dissoc :slots)
                  (= false (:custom_component form-yaml)) (dissoc :custom_component)
                  (= false (:custom_component_container form-yaml)) (dissoc :custom_component_container))]
    (when (seq cleaned)
      cleaned)))

(defn serialize-html-body
  ([form-yaml] (serialize-html-body form-yaml nil))
  ([form-yaml options]
   (if (:layout form-yaml)
     (serializer/serialize-form-layout form-yaml options)
     (serializer/serialize-form-container form-yaml options))))

#?(:cljs
   (defn- object-key [key]
     (if (keyword? key) (name key) key)))

#?(:cljs
   (declare clj-value->js))

#?(:cljs
   (defn- clj-value->js [value]
     (cond
       (map? value) (reduce-kv (fn [result key val]
                                 (unchecked-set result (object-key key) (clj-value->js val))
                                 result)
                               #js {}
                               value)
       (sequential? value) (let [result (array)]
                             (doseq [item value]
                               (.push result (clj-value->js item)))
                             result)
       :else value)))

(defn- stringify-frontmatter [frontmatter]
  #?(:clj
     (yaml/generate-string frontmatter :dumper-options {:flow-style :block})
     :cljs
     (let [yaml-string (yaml/stringify (clj-value->js frontmatter) #js {:lineWidth 0})]
       (if (.endsWith yaml-string "\n")
         yaml-string
         (str yaml-string "\n")))))

(defn with-frontmatter [html-body frontmatter]
  (if (seq frontmatter)
    (str "---\n" (stringify-frontmatter frontmatter) "---\n" html-body)
    html-body))

(defn generate-html-template
  ([form-yaml html-body]
   (with-frontmatter html-body (clean-html-frontmatter form-yaml)))
  ([form-yaml]
   (generate-html-template form-yaml (serialize-html-body form-yaml nil))))

(defn serialize-html-template
  ([form-yaml] (serialize-html-template form-yaml nil))
  ([form-yaml options]
   (generate-html-template form-yaml (serialize-html-body form-yaml options))))
