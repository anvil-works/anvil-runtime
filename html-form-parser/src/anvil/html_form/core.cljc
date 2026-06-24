(ns anvil.html-form.core
  (:require [anvil.html-form.parser :as parser]
            [anvil.html-form.form-specs :as form-specs]
            [anvil.html-form.serializer :as serializer]
            [anvil.html-form.shared :as shared]
            [anvil.html-form.template :as template]))

(def set-default-dropzone-name-generator shared/set-default-dropzone-name-generator)
(def html-hash-string shared/html-hash-string)
(def create-hash-based-dropzone-name-generator shared/create-hash-based-dropzone-name-generator)
(def create-deterministic-dropzone-name-generator shared/create-deterministic-dropzone-name-generator)

(def parse-container-form parser/parse-container-form)
(def parse-layout-form parser/parse-layout-form)
(def parse-serialized-html parser/parse-serialized-html)
(def build-selection-name-maps parser/build-selection-name-maps)
(def extract-dom-node-refs parser/extract-dom-node-refs)
(def extract-dom-node-names parser/extract-dom-node-names)

(def serialize-component serializer/serialize-component)
(def serialize-component-with-slots serializer/serialize-component-with-slots)
(def serialize-form-container-result serializer/serialize-form-container-result)
(def serialize-form-container serializer/serialize-form-container)
(def serialize-form-layout-result serializer/serialize-form-layout-result)
(def serialize-form-layout serializer/serialize-form-layout)

(def rewrite-form-specs-in-form-yaml form-specs/rewrite-form-specs-in-form-yaml)
(def canonicalize-form-specs-in-form-yaml form-specs/canonicalize-form-specs-in-form-yaml)

(def clean-template-yaml template/clean-template-yaml)
(def clean-html-frontmatter template/clean-html-frontmatter)
(def split-frontmatter template/split-frontmatter)
(def parse-form-template-source template/parse-form-template-source)
(def build-form-template-save-payload template/build-form-template-save-payload)
(def serialize-html-body template/serialize-html-body)
(def generate-html-template template/generate-html-template)
(def serialize-html-template template/serialize-html-template)
