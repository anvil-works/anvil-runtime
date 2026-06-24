(ns anvil.html-form.api
  (:require [anvil.html-form.core :as core]))

(defn- js-options->clj [options]
  (if options
    (js->clj options :keywordize-keys true)
    nil))

(declare js-value->clj)

(defn- plain-js-object? [value]
  (and (some? value)
       (identical? (.-constructor value) js/Object)))

(defn- js-array->clj [value]
  (let [length (.-length value)]
    (loop [index 0
           result []]
      (if (= index length)
        result
        (recur (inc index)
               (conj result (js-value->clj (aget value index))))))))

(defn- js-object->clj [value]
  (let [keys (js/Object.keys value)
        length (.-length keys)]
    (loop [index 0
           result {}]
      (if (= index length)
        result
        (let [key (aget keys index)]
          (recur (inc index)
                 (assoc result (keyword key) (js-value->clj (unchecked-get value key)))))))))

(defn- js-value->clj [value]
  (cond
    (array? value) (js-array->clj value)
    (plain-js-object? value) (js-object->clj value)
    :else value))

(declare value->js component->js)

(defn- object-key [key]
  (if (keyword? key) (name key) key))

(defn- map->js [m]
  (let [result #js {}]
    (reduce-kv (fn [_ key value]
                 (unchecked-set result (object-key key) (value->js value))
                 nil)
               nil
               m)
    result))

(defn- seq->js-array [values item->js]
  (let [result (array)]
    (doseq [value values]
      (.push result (item->js value)))
    result))

(defn- value->js [value]
  (cond
    (map? value) (map->js value)
    (sequential? value) (seq->js-array value value->js)
    :else value))

(defn- target->js [{:keys [type name]}]
  #js {:type type
       :name name})

(defn- data-binding->js [{:keys [property code writeback]}]
  (let [result #js {:property property
                    :code code}]
    (when writeback
      (unchecked-set result "writeback" true))
    result))

(defn- component->js [component]
  (let [result #js {:type (:type component)
                    :name (:name component)
                    :properties (value->js (:properties component))}]
    (when-let [layout-properties (:layout_properties component)]
      (unchecked-set result "layout_properties" (value->js layout-properties)))
    (when-let [components (seq (:components component))]
      (unchecked-set result "components" (seq->js-array components component->js)))
    (when (seq (:event_bindings component))
      (unchecked-set result "event_bindings" (value->js (:event_bindings component))))
    (when-let [data-bindings (seq (:data_bindings component))]
      (unchecked-set result "data_bindings" (seq->js-array data-bindings data-binding->js)))
    result))

(defn- slot-def->js [slot-def]
  (let [result #js {:target (target->js (:target slot-def))
                    :index (:index slot-def)}]
    (when (contains? slot-def :set_layout_properties)
      (unchecked-set result "set_layout_properties" (value->js (:set_layout_properties slot-def))))
    (when (:one_component slot-def)
      (unchecked-set result "one_component" true))
    (when (seq (:placeholder_text slot-def))
      (unchecked-set result "placeholder_text" (:placeholder_text slot-def)))
    result))

(defn- slots->js [slots]
  (let [result #js {}]
    (doseq [[slot-name slot-def] slots]
      (unchecked-set result slot-name (slot-def->js slot-def)))
    result))

(defn- container->js [container]
  (let [result #js {:type (:type container)
                    :properties (value->js (:properties container))}]
    (when (seq (:event_bindings container))
      (unchecked-set result "event_bindings" (value->js (:event_bindings container))))
    (when-let [data-bindings (seq (:data_bindings container))]
      (unchecked-set result "data_bindings" (seq->js-array data-bindings data-binding->js)))
    (when (seq (:layout_properties container))
      (unchecked-set result "layout_properties" (value->js (:layout_properties container))))
    result))

(defn- parsed-container->js [parsed]
  (let [result #js {:container (container->js (:container parsed))
                    :components (seq->js-array (:components parsed) component->js)
                    :serialized_html (:serialized_html parsed)}]
    (when-let [slots (seq (:slots parsed))]
      (unchecked-set result "slots" (slots->js slots)))
    result))

(defn- layout->js [layout]
  (let [result #js {:type (:type layout)}]
    (when (seq (:properties layout))
      (unchecked-set result "properties" (value->js (:properties layout))))
    (when (seq (:event_bindings layout))
      (unchecked-set result "event_bindings" (value->js (:event_bindings layout))))
    (when (seq (:form_event_bindings layout))
      (unchecked-set result "form_event_bindings" (value->js (:form_event_bindings layout))))
    (when-let [data-bindings (seq (:data_bindings layout))]
      (unchecked-set result "data_bindings" (seq->js-array data-bindings data-binding->js)))
    result))

(defn- components-by-slot->js [components-by-slot]
  (let [result #js {}]
    (doseq [[slot-name components] components-by-slot]
      (unchecked-set result slot-name (seq->js-array components component->js)))
    result))

(defn- parsed-layout->js [parsed]
  (let [result #js {:layout (layout->js (:layout parsed))
                    :components_by_slot (components-by-slot->js (:components_by_slot parsed))}]
    (when-let [slots (seq (:slots parsed))]
      (unchecked-set result "slots" (slots->js slots)))
    result))

(defn- parsed-serialized->js [parsed]
  (let [layout? (:layout parsed)
        result (if layout?
                 (parsed-layout->js parsed)
                 (parsed-container->js parsed))]
    result))

(defn- option-value [options camel-key kebab-key]
  (get options kebab-key (get options camel-key)))

(defn- allow-reparse? [options]
  (true? (option-value options :allowReparse :allow-reparse)))

(defn- parser-options [options]
  (option-value options :parserOptions :parser-options))

(defn- serialize-result->js [{:keys [html structural-html-changed?]}]
  #js {:html html
       :structuralHtmlChanged (boolean structural-html-changed?)})

(defn- js-string-key-map [value]
  (if value
    (let [keys (js/Object.keys value)]
      (loop [index 0
             result {}]
        (if (= index (.-length keys))
          result
          (let [key (aget keys index)]
            (recur (inc index)
                   (assoc result key (unchecked-get value key)))))))
    {}))

(defn- package-context [context]
  {:app-package-name (some-> context (unchecked-get "appPackageName"))
   :known-package-names (some-> context (unchecked-get "knownPackageNames") js-array->clj)
   :dependency-package-names-by-logical-dep-id (js-string-key-map
                                                (some-> context
                                                        (unchecked-get "dependencyPackageNamesByLogicalDepId")))})

(defn- js-rewrite-fn [rewriters key]
  (let [rewrite-fn (some-> rewriters (unchecked-get key))]
    (when-not (or (nil? rewrite-fn) (undefined? rewrite-fn))
      (fn [value]
        (let [rewritten (rewrite-fn value)]
          (when-not (or (nil? rewritten) (undefined? rewritten))
            rewritten))))))

(defn- js-form-typed-property-names-by-component-type [value]
  ;; JS object mapping component YAML type -> property names whose component
  ;; metadata type is "form", for example {"RepeatingPanel": ["item_template"]}.
  (when-not (or (nil? value) (undefined? value))
    (let [keys (js/Object.keys value)]
      (loop [index 0
             result {}]
        (if (= index (.-length keys))
          result
          (let [component-type (aget keys index)
                properties (unchecked-get value component-type)]
            (recur (inc index)
                   (assoc result
                          component-type
                          (mapv keyword (array-seq (or properties #js [])))))))))))

(defn- form-spec-rewriters [rewriters]
  {:custom-component-spec (js-rewrite-fn rewriters "customComponentSpec")
   :form-property-spec (js-rewrite-fn rewriters "formPropertySpec")
   :form-typed-property-names-by-component-type
   (js-form-typed-property-names-by-component-type
     (some-> rewriters (unchecked-get "formTypedPropertyNamesByComponentType")))})

(defn- form-spec-rewrite-result->js [{:keys [form changed?]}]
  #js {:form (value->js form)
       :changed (boolean changed?)})

(defn- parsed-template-source->js [{:keys [format template serialized-html]}]
  (let [result #js {:format format
                    :template (value->js template)}]
    (when (some? serialized-html)
      (unchecked-set result "serializedHtml" serialized-html))
    result))

(defn ^:export setDefaultDropzoneNameGenerator [factory]
  (core/set-default-dropzone-name-generator factory))

(defn ^:export hashString [value]
  (core/html-hash-string value))

(defn ^:export createHashBasedDropzoneNameGenerator
  ([] (core/create-hash-based-dropzone-name-generator))
  ([seed] (core/create-hash-based-dropzone-name-generator seed)))

(defn ^:export createDeterministicDropzoneNameGenerator
  ([] (core/create-deterministic-dropzone-name-generator))
  ([seed] (core/create-deterministic-dropzone-name-generator seed)))

(defn ^:export parseSerializedHtml [html options]
  (parsed-serialized->js (core/parse-serialized-html html (js-options->clj options))))

(defn ^:export parseLayoutForm [html options]
  (parsed-layout->js (core/parse-layout-form html (js-options->clj options))))

(defn ^:export parseContainerForm
  ([html] (parseContainerForm html "HtmlComponent" nil))
  ([html container-type] (parseContainerForm html container-type nil))
  ([html container-type options]
   (parsed-container->js (core/parse-container-form html container-type (js-options->clj options)))))

(defn ^:export buildSelectionNameMaps
  ([html] (buildSelectionNameMaps html nil))
  ([html options]
  (let [{:keys [components slots]} (core/build-selection-name-maps html (js-options->clj options))
        component-map (js/Map.)
        slot-map (js/Map.)]
    (doseq [[offset name] components]
      (.set component-map offset name))
    (doseq [[offset name] slots]
      (.set slot-map offset name))
    #js {:components component-map
         :slots slot-map})))

(defn ^:export extractDomNodeNames [html]
  (seq->js-array (core/extract-dom-node-names html) identity))

(defn- dom-node-ref->js [{:keys [name tag-name]}]
  #js {:name name
       :tagName tag-name})

(defn ^:export extractDomNodeRefs [html]
  (seq->js-array (core/extract-dom-node-refs html) dom-node-ref->js))

(defn- apply-container-result! [parsed {:keys [html reparsed]}]
  (when parsed
    (when reparsed
      (unchecked-set parsed "container" (container->js (:container reparsed)))
      (unchecked-set parsed "components" (seq->js-array (:components reparsed) component->js))
      (if-let [slots (seq (:slots reparsed))]
        (unchecked-set parsed "slots" (slots->js slots))
        (js-delete parsed "slots")))
    (unchecked-set parsed "serialized_html" html)))

(defn- apply-layout-result! [parsed {:keys [html reparsed]}]
  (when parsed
    (when reparsed
      (unchecked-set parsed "layout" (layout->js (:layout reparsed)))
      (unchecked-set parsed "components_by_slot" (components-by-slot->js (:components_by_slot reparsed)))
      (if-let [slots (seq (:slots reparsed))]
        (unchecked-set parsed "slots" (slots->js slots))
        (js-delete parsed "slots")))
    (unchecked-set parsed "serialized_html" html)))

(defn ^:export serializeFormContainerWithResult
  ([parsed] (serializeFormContainerWithResult parsed nil))
  ([parsed options]
   (let [result (core/serialize-form-container-result
                  (js-value->clj parsed)
                  (js-options->clj options))]
     (apply-container-result! parsed result)
     (serialize-result->js result))))

(defn ^:export serializeFormContainer
  ([parsed] (serializeFormContainer parsed nil))
  ([parsed options]
   (.-html (serializeFormContainerWithResult parsed options))))

(defn ^:export serializeFormLayoutWithResult
  ([parsed] (serializeFormLayoutWithResult parsed nil))
  ([parsed options]
   (let [result (core/serialize-form-layout-result
                  (js-value->clj parsed)
                  (js-options->clj options))]
     (apply-layout-result! parsed result)
     (serialize-result->js result))))

(defn ^:export serializeFormLayout
  ([parsed] (serializeFormLayout parsed nil))
  ([parsed options]
   (.-html (serializeFormLayoutWithResult parsed options))))

(defn ^:export copyFormYamlWithCanonicalizedFormSpecs [form context]
  (form-spec-rewrite-result->js
    (core/canonicalize-form-specs-in-form-yaml
      (js-value->clj form)
      (package-context context))))

(defn ^:export copyFormYamlWithRewrittenFormSpecs [form rewriters]
  (form-spec-rewrite-result->js
    (core/rewrite-form-specs-in-form-yaml
      (js-value->clj form)
      (form-spec-rewriters rewriters))))

(defn ^:export parseFormTemplateSource [content options]
  (parsed-template-source->js
    (core/parse-form-template-source content (js-options->clj options))))

(defn ^:export buildFormTemplateSavePayload [source identity]
  (value->js
    (core/build-form-template-save-payload
      (js-value->clj source)
      (js-value->clj identity))))

(defn ^:export serializeFormTemplateHtml
  ([parsed] (serializeFormTemplateHtml parsed nil))
  ([parsed options]
   (let [template (js-value->clj parsed)]
     (when (and (not (:container template)) (not (:layout template)))
       (throw (js/Error. "Form template must define either container or layout")))
     (core/serialize-html-template template (js-options->clj options)))))
