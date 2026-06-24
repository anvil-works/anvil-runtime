(ns anvil.html-form.form-specs
  (:require [clojure.string :as str]))

(def legacy-custom-component-spec-prefix "form:")
(def legacy-custom-component-spec-regex
  (re-pattern (str "^" legacy-custom-component-spec-prefix "(?:([^:]+):)?(.+)$")))
(def legacy-dependency-form-property-spec-regex #"^([^:]+):(.+)$")
(def package-qualified-form-name-regex #"^([^.]+)\.(.+)$")

;; Rewrite helpers for persisted Form YAML, not runtime import resolution.
;;
;; customComponentSpec: a component/layout :type value that may identify a
;; form-backed component, such as "form:Form1" or "AppPackage.Form1".
;; formPropertySpec: a form-typed component property value, such as
;; "Form1", "dep_abc:Form1", or "AppPackage.Form1".
;; appLocalFormName: a value from forms[*].class_name, such as "Form1" or
;; "Folder.Form1". packageQualifiedFormName: package name plus appLocalFormName.
;; logicalDepId: legacy dependency alias used in specs, such as "dep_abc".
;;
;; The parser owns this property-name map so canonicalisation and IDE rewrites
;; agree on which component properties have metadata type "form". In YAML, the
;; string values of those properties are formPropertySpecs.
(def default-form-typed-property-names-by-component-type {"RepeatingPanel" #{:item_template}})

(defn- normalize-form-typed-property-names-by-component-type [property-names-by-component-type]
  (into {}
        (map (fn [[component-type properties]]
               [component-type (set (map keyword properties))]))
        property-names-by-component-type))

(defn- known-package-names [{:keys [app-package-name known-package-names]}]
  (set (filter some? (cons app-package-name known-package-names))))

(defn- canonicalize-custom-component-spec [custom-component-spec {:keys [app-package-name dependency-package-names-by-logical-dep-id]}]
  (when-let [[_ logical-dep-id app-local-form-name] (and custom-component-spec
                                                         (re-matches legacy-custom-component-spec-regex
                                                                     custom-component-spec))]
    (when-let [package-name (if logical-dep-id
                              (get dependency-package-names-by-logical-dep-id logical-dep-id)
                              app-package-name)]
      (str package-name "." app-local-form-name))))

(defn- canonicalize-form-property-spec [form-property-spec context]
  (when (and form-property-spec (not (str/starts-with? form-property-spec legacy-custom-component-spec-prefix)))
    (or
      (when-let [[_ logical-dep-id app-local-form-name] (re-matches legacy-dependency-form-property-spec-regex
                                                                    form-property-spec)]
        (when-let [package-name (get-in context [:dependency-package-names-by-logical-dep-id logical-dep-id])]
          (str package-name "." app-local-form-name)))
      (when-let [[_ package-name] (re-matches package-qualified-form-name-regex form-property-spec)]
        (when-not (contains? (known-package-names context) package-name)
          (when-not (str/includes? form-property-spec ":")
            (when-let [app-package-name (:app-package-name context)]
              (str app-package-name "." form-property-spec)))))
      ;; Preserve the runtime parser rule for undotted app-local form names.
      (when-not (or (str/includes? form-property-spec ":")
                    (re-matches package-qualified-form-name-regex form-property-spec))
        (when-let [app-package-name (:app-package-name context)]
          (str app-package-name "." form-property-spec))))))

(defn- no-rewrite [_] nil)

(defn rewrite-form-specs-in-form-yaml [form {:keys [custom-component-spec
                                                    form-property-spec
                                                    form-typed-property-names-by-component-type]}]
  (let [changed? (volatile! false)
        form-typed-property-names-by-component-type
        (merge-with
          into
          default-form-typed-property-names-by-component-type
          (normalize-form-typed-property-names-by-component-type
            form-typed-property-names-by-component-type))
        rewrite-custom-component-spec (or custom-component-spec no-rewrite)
        rewrite-form-property-spec (or form-property-spec no-rewrite)]
    (letfn [(rewrite-owner [owner]
              (if-let [rewritten (rewrite-custom-component-spec (:type owner))]
                (if (= rewritten (:type owner))
                  owner
                  (do
                    (vreset! changed? true)
                    (assoc owner :type rewritten)))
                owner))
            (rewrite-form-property-spec-value [component property-name]
              (let [value (get-in component [:properties property-name])]
                (if-let [rewritten (and (string? value)
                                        (rewrite-form-property-spec value))]
                  (if (= rewritten value)
                    component
                    (do
                      (vreset! changed? true)
                      (assoc-in component [:properties property-name] rewritten)))
                  component)))
            (rewrite-form-property-spec-values [component]
              (reduce
                rewrite-form-property-spec-value
                component
                (get form-typed-property-names-by-component-type (:type component) #{})))
            (walk-component [component]
              (cond-> component
                (:type component) (rewrite-owner)
                (:type component) (rewrite-form-property-spec-values)
                (:components component) (update :components #(mapv walk-component %))))
            (walk-components-by-slot [components-by-slot]
              (reduce-kv
                (fn [result slot-name components]
                  (assoc result slot-name (mapv walk-component components)))
                {}
                components-by-slot))
            (walk-slots [slots]
              (reduce-kv
                (fn [result slot-name slot-def]
                  (assoc result
                         slot-name
                         (cond-> slot-def
                           (:template slot-def) (update :template walk-component))))
                {}
                slots))]
      {:form (cond-> form
               (:container form) (update :container rewrite-owner)
               (:layout form) (update :layout rewrite-owner)
               (:components form) (update :components #(mapv walk-component %))
               (:components_by_slot form) (update :components_by_slot walk-components-by-slot)
               (:slots form) (update :slots walk-slots))
       :changed? @changed?})))

(defn canonicalize-form-specs-in-form-yaml [form context]
  (rewrite-form-specs-in-form-yaml
    form
    {:custom-component-spec #(canonicalize-custom-component-spec % context)
     :form-property-spec #(canonicalize-form-property-spec % context)}))
