(ns anvil.runtime.html-form-template
  (:require [anvil.html-form.core :as html-form]
            [clj-yaml.core :as yaml]))

(def ^:private frontmatter-pattern #"(?s)^---\s*\n(.*?)\n---\s*\n(.*)$")

(def ^:private structural-keys
  #{:components :components_by_slot :container :layout :serialized_html})

(defn split-frontmatter
  "Split an HTML form template into optional YAML frontmatter and HTML body."
  [^String html-template]
  (let [[_ yaml-str html-content] (re-matches frontmatter-pattern html-template)]
    {:frontmatter (when yaml-str (yaml/parse-string yaml-str))
     :html        (if yaml-str html-content html-template)}))

(defn clean-template-yaml
  "Remove fields that are inferred from app storage paths or HTML serialization."
  [form-yaml]
  (html-form/clean-template-yaml form-yaml))

(defn clean-html-frontmatter
  "Return the form metadata that should be written as HTML template frontmatter."
  [form-yaml]
  (html-form/clean-html-frontmatter form-yaml))

(defn parse-html-template-string
  "Parse an HTML form template into normal form YAML."
  ([html-template] (parse-html-template-string html-template nil))
  ([html-template {:keys [include-serialized-html?]
                   :or   {include-serialized-html? true}
                   :as   options}]
   (let [{:keys [frontmatter html]} (split-frontmatter html-template)
         parse-options (cond-> (dissoc options :include-serialized-html? :stable-dropzones?)
                         (:stable-dropzones? options)
                         (assoc :dropzone-name-generator
                                (html-form/create-deterministic-dropzone-name-generator)))
         parsed (html-form/parse-serialized-html html parse-options)
         parsed (cond-> parsed
                  include-serialized-html? (assoc :serialized_html (or (:serialized_html parsed) html))
                  (not include-serialized-html?) (dissoc :serialized_html))
         frontmatter (or frontmatter {})]
     (cond-> (-> (merge (apply dissoc frontmatter (conj structural-keys :slots))
                        parsed)
                 (assoc :save_as_html true))
       (and (contains? frontmatter :slots) (not (:slots parsed)))
       (assoc :slots {})))))

(defn parse-html-template-bytes
  ([html-bytes] (parse-html-template-bytes html-bytes nil))
  ([^bytes html-bytes options]
   (parse-html-template-string (String. html-bytes) options)))

(defn serialize-html-body
  "Serialize normal form YAML into an HTML form template body."
  ([form-yaml] (html-form/serialize-html-body form-yaml))
  ([form-yaml options] (html-form/serialize-html-body form-yaml options)))

(defn generate-html-template
  "Generate a complete HTML form template with optional YAML frontmatter."
  ([form-yaml]
   (generate-html-template form-yaml (or (:serialized_html form-yaml)
                                         (serialize-html-body form-yaml))))
  ([form-yaml html-body]
   (html-form/generate-html-template form-yaml html-body)))

(defn serialize-html-template
  "Serialize form YAML structurally, then add frontmatter."
  ([form-yaml] (html-form/serialize-html-template form-yaml))
  ([form-yaml options] (html-form/serialize-html-template form-yaml options)))
