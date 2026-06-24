(ns anvil.html-form.parser
  (:require [anvil.html-form.raw :as raw]
            [anvil.html-form.shared
             :refer [anvil-block? anvil-component? anvil-dropzone? anvil-form?
                     anvil-slot? append! append-all! attr bind-prefix
                     call-generator container-types create-context
                     ensure-dom-node-attribute escape-html-text format-attribute
                     get-single-root-element has-renderable-content?
                     lower-tag-name mutable-list mutable-list-value
                     normalize-fragment-html parse-attribute-value
                     render-element state state-reset! state-swap!
                     string-list-value strip-anvil-prefix strip-self-prefix
                     whitespace-or-comment? writeback-prefix yaml-key]]
            [clojure.string :as str]))

(defn- normalize-binding-code [value]
  (str/replace (or value "") "&quot;" "\""))

(defn- process-data-binding-attribute [attr-name value bindings-by-property ordered-bindings]
  (let [bind? (str/starts-with? attr-name bind-prefix)
        writeback? (str/starts-with? attr-name writeback-prefix)
        prefix-length (cond
                        bind? (count bind-prefix)
                        writeback? (count writeback-prefix)
                        :else nil)]
    (when prefix-length
      (let [property (subs attr-name prefix-length)]
        (when (seq property)
          (let [existing (get @bindings-by-property property)
                binding (or existing {:property property :code ""})]
            (when-not existing
              (state-swap! ordered-bindings conj binding))
            (let [updated (cond-> (assoc binding :code (normalize-binding-code value))
                            writeback? (assoc :writeback true)
                            (not writeback?) (dissoc :writeback))]
              (state-swap! bindings-by-property assoc property updated)
              (state-swap! ordered-bindings
                           (fn [bindings]
                             (mapv #(if (= (:property %) property) updated %) bindings))))))))))

(defn- extract-component-data [element]
  (let [type (state "")
        component-name (state "")
        properties (state {})
        event-bindings (state {})
        layout-event-bindings (state {})
        bindings-by-property (state {})
        ordered-bindings (state [])
        layout-properties (state {})
        one-component? (state false)]
    (doseq [attribute (raw/attrs element)]
      (let [name (raw/attr-name attribute)
            value (raw/attr-value attribute)]
        (cond
          (= name "type")
          (state-reset! type value)

          (= name "name")
          (state-reset! component-name value)

          (str/starts-with? name "prop:")
          (state-swap! properties assoc (yaml-key (subs name 5)) (parse-attribute-value value))

          (str/starts-with? name "on:layout:")
          (state-swap! layout-event-bindings assoc (yaml-key (subs name 10)) (strip-self-prefix value))

          (str/starts-with? name "on:")
          (state-swap! event-bindings assoc (yaml-key (subs name 3)) (strip-self-prefix value))

          (str/starts-with? name "container:")
          (state-swap! layout-properties assoc (yaml-key (subs name 10)) (parse-attribute-value value))

          (or (= name "one-component") (= name "one_component"))
          (when (or (= value "") (= "true" (str/lower-case value)))
            (state-reset! one-component? true))

          :else
          (process-data-binding-attribute name value bindings-by-property ordered-bindings))))
    {:type @type
     :name @component-name
     :properties @properties
     :event-bindings @event-bindings
     :data-bindings @ordered-bindings
     :layout-event-bindings @layout-event-bindings
     :layout-properties @layout-properties
     :one-component @one-component?}))

(defn- extract-slot-data [element]
  (let [slot-name (state "")
        placeholder-text (state nil)
        layout-properties (state {})
        one-component? (state false)]
    (doseq [attribute (raw/attrs element)]
      (let [attr-name (raw/attr-name attribute)
            value (raw/attr-value attribute)]
        (cond
          (= attr-name "name")
          (state-reset! slot-name value)

          (= attr-name "placeholder")
          (state-reset! placeholder-text value)

          (str/starts-with? attr-name "container:")
          (state-swap! layout-properties assoc (yaml-key (subs attr-name 10)) (parse-attribute-value value))

          (or (= attr-name "one-component") (= attr-name "one_component"))
          (when (or (= value "") (= "true" (str/lower-case value)))
            (state-reset! one-component? true)))))
    {:name @slot-name
     :placeholder-text @placeholder-text
     :layout-properties @layout-properties
     :one-component @one-component?}))

(defn- has-promotable-attributes? [element promote-dom-nodes?]
  (some (fn [attribute]
          (let [attr-name (raw/attr-name attribute)]
            (or (= attr-name "anvil:name")
                (str/starts-with? attr-name "anvil:prop:")
                (str/starts-with? attr-name "anvil:on:")
                (and promote-dom-nodes? (str/starts-with? attr-name "anvil:on-dom:"))
                (and promote-dom-nodes? (= attr-name "anvil:dom-node"))
                (str/starts-with? attr-name "anvil:bind:")
                (str/starts-with? attr-name "anvil:writeback:")
                (str/starts-with? attr-name "anvil:container:"))))
        (raw/attrs element)))

(defn- promotable-element? [element context]
  (or (and (:promote-all-dom-nodes context)
           (not (anvil-dropzone? element)))
      (has-promotable-attributes? element (:promote-dom-nodes context))))

(defn- extract-promoted-fragment-data
  ([element] (extract-promoted-fragment-data element (raw/attrs element)))
  ([_element element-attrs]
  ;; Ordinary DOM nodes with anvil:* attributes are promoted into HtmlComponent
  ;; metadata while their original element remains in the component's html.
  (let [properties (state {})
        event-bindings (state {})
        bindings-by-property (state {})
        ordered-bindings (state [])
        layout-properties (state {})
        fragment-name (state nil)]
    (doseq [attribute element-attrs]
      (let [attr-name (raw/attr-name attribute)
            value (raw/attr-value attribute)]
        (cond
          (= attr-name "anvil:name")
          (state-reset! fragment-name value)

          (str/starts-with? attr-name "anvil:prop:")
          (state-swap! properties assoc (yaml-key (subs attr-name 11)) (parse-attribute-value value))

          (str/starts-with? attr-name "anvil:on:")
          (state-swap! event-bindings assoc (yaml-key (subs attr-name 9)) (strip-self-prefix value))

          (str/starts-with? attr-name "anvil:container:")
          (state-swap! layout-properties assoc (yaml-key (subs attr-name 16)) (parse-attribute-value value))

          (or (str/starts-with? attr-name "anvil:bind:")
              (str/starts-with? attr-name "anvil:writeback:"))
          ;; Strip only the anvil: namespace; process-data-binding-attribute
          ;; handles bind:/writeback: exactly like anvil-component attributes.
          (process-data-binding-attribute (subs attr-name 6)
                                          value
                                          bindings-by-property
                                          ordered-bindings))))
    {:name @fragment-name
     :properties @properties
     :event-bindings @event-bindings
     :data-bindings @ordered-bindings
     :layout-properties @layout-properties})))

(defn- filter-anvil-attributes [attrs]
  ;; Parser metadata is lifted into YAML, but DOM-event attributes still need
  ;; to remain in the rendered HTML for the designer/runtime.
  (filterv (fn [attribute]
             (let [attr-name (raw/attr-name attribute)]
               (or (not (str/starts-with? attr-name "anvil:"))
                   (= attr-name "anvil:dom-node")
                   (= attr-name "anvil:designer-editable-text")
                   (str/starts-with? attr-name "anvil:on-dom:"))))
           attrs))

(declare parse-component parse-container-children render-nodes)

(defn- target-key [target]
  (str (:type target) ":" (:name target)))

(defn- generate-dropzone-name [context _scope]
  ;; Always use the configured generator. The default generator is already
  ;; HTML-seeded and deterministic.
  (call-generator (:dropzone-name-generator context)))

(defn- mark-component-name-used! [context component-name]
  (when (seq component-name)
    (state-swap! (:used-component-names context) conj component-name)))

(defn- generate-anonymous-component-name [context]
  (loop []
    (let [candidate (str "$component_" (state-swap! (:anonymous-component-counter context) inc))]
      (if (contains? @(:used-component-names context) candidate)
        (recur)
        (do
          (mark-component-name-used! context candidate)
          candidate)))))

(defn- generate-anonymous-slot-name [context]
  (str "$slot_" (state-swap! (:anonymous-slot-counter context) inc)))

(defn- record-selection-name! [context kind element effective-name]
  (when-let [maps (:selection-name-maps context)]
    (when-let [offset (and element (raw/source-start-offset element))]
      (when-let [target (get maps kind)]
        (state-swap! target assoc offset effective-name)))))

(defn- record-component-selection-name! [context element effective-name]
  (record-selection-name! context :components element effective-name))

(defn- record-slot-selection-name! [context element effective-name]
  (record-selection-name! context :slots element effective-name))

(defn extract-dom-node-refs [html]
  (let [seen (state #{})
        refs (mutable-list)]
    (letfn [(walk [node]
              (when (raw/element? node)
                (doseq [attribute (raw/attrs node)]
                  (when (= "anvil:dom-node" (raw/attr-name attribute))
                    (let [name (raw/attr-value attribute)]
                      (when (and (seq name) (not (contains? @seen name)))
                        (state-swap! seen conj name)
                        (append! refs {:name name
                                       :tag-name (lower-tag-name node)}))))))
              (doseq [child (raw/child-nodes node)]
                (walk child)))]
      (walk (raw/parse-fragment html))
      (mutable-list-value refs))))

(defn extract-dom-node-names [html]
  (mapv :name (extract-dom-node-refs html)))

(defn- first-source-element [nodes]
  (some (fn [node]
          (when (raw/element? node)
            node))
        nodes))

(defn- extract-root-classes-and-style [properties]
  (let [html (:html properties)]
    (if-not (and (string? html) (seq html))
      properties
      (let [fragment (raw/parse-fragment html)
            root (get-single-root-element (raw/child-nodes fragment))]
        (if-not root
          properties
          (let [class-value (attr root "class")
                style-value (attr root "style")]
            (cond-> properties
              (some? class-value)
              (assoc :classes (let [trimmed (str/trim class-value)]
                                (if (empty? trimmed)
                                  []
                                  (str/split trimmed #"\s+"))))
              (some? style-value)
              (assoc :style style-value))))))))

(defn- maybe-extract-root-styling [context properties]
  (if (:extract-root-styling context)
    (extract-root-classes-and-style properties)
    properties))

(defn- get-component-count [context target]
  (get @(:component-counts context) (target-key target) 0))

(defn- increment-component-count [context target]
  (state-swap! (:component-counts context) update (target-key target) (fnil inc 0)))

(defn- get-slot-state [context target]
  (let [key (target-key target)]
    (get (state-swap! (:slot-state context)
                      #(if (contains? % key)
                         %
                         (assoc % key {:slot-counter 0 :last-component-count nil :last-index nil})))
         key)))

(defn- compute-slot-index [context target]
  ;; Slot indices describe the component boundary they sit at. Consecutive
  ;; slots before another component share the same current component count.
  (let [component-count (get-component-count context target)
        state (get-slot-state context target)
        index (cond
                (= component-count 0) 0
                (and (= (:last-component-count state) component-count)
                     (some? (:last-index state))) (:last-index state)
                :else component-count)]
    (state-swap! (:slot-state context)
                 assoc
                 (target-key target)
                 {:slot-counter (inc (:slot-counter state))
                  :last-component-count component-count
                  :last-index index})
    index))

(defn- record-slot [context slot-name target options]
  ;; Keep generated dropzone names in parsed slot data. Serializers can omit
  ;; generated fragment dropzones later, but the parsed model needs them to
  ;; reconnect slots with placeholder dropzones during this parse.
  (let [layout-properties (merge {} (:layout-properties options))
        layout-properties (if (and (:dropzone-name options)
                                   (not (contains? (:layout-properties options) :dropzone))
                                   (:parent-is-fragment options))
                            (assoc layout-properties :dropzone (:dropzone-name options))
                            layout-properties)
        slot-def (cond-> {:target target
                          :index (:index options)}
                   (seq layout-properties) (assoc :set_layout_properties layout-properties)
                   (and (empty? layout-properties) (:include-empty-layout options))
                   (assoc :set_layout_properties {})
                   (:one-component options) (assoc :one_component true)
                   (seq (:placeholder-text options)) (assoc :placeholder_text (:placeholder-text options)))]
    (state-swap! (:slots context) assoc slot-name slot-def)
    (state-swap! (:slot-order context) conj {:target-key (target-key target) :slot-name slot-name})
    slot-def))

(defn- parse-promoted-fragment [element context slot-target options]
  (let [element-attrs (raw/attrs element)
        metadata (extract-promoted-fragment-data element element-attrs)
        fragment-name (or (:name metadata) (generate-anonymous-component-name context))
        _ (mark-component-name-used! context fragment-name)
        _ (record-component-selection-name! context element fragment-name)
        fragment-target {:type "container" :name fragment-name}
        ;; Children of promoted DOM nodes are parsed in fragment context so
        ;; nested anvil components/slots become YAML components and dropzones.
        child-result (render-nodes (raw/child-nodes element) context fragment-target {:parent-is-fragment true})
        ;; Render the original DOM element back without parser-only anvil:*
        ;; metadata; the metadata now lives on the HtmlComponent.
        element-html (render-element (raw/tag-name element)
                                     (filter-anvil-attributes element-attrs)
                                     (:html child-result))
        fragment-properties (maybe-extract-root-styling
                              context
                              (assoc (:properties metadata)
                                     :html (if (:normalize-html context)
                                             (normalize-fragment-html element-html)
                                             element-html)))
        layout-props (merge {} (:layout-properties metadata))
        ;; Nested fragment components need a dropzone so they can be replaced
        ;; when their parent fragment HTML is serialized.
        dropzone-name (when (:parent-is-fragment options)
                        (or (:dropzone layout-props)
                            (generate-dropzone-name context slot-target)))
        layout-props (if (and (:parent-is-fragment options)
                              (not (:dropzone layout-props)))
                       (assoc layout-props :dropzone dropzone-name)
                       layout-props)
        component (cond-> {:type "HtmlComponent"
                           :name fragment-name
                           :properties fragment-properties}
                    (seq (:components child-result)) (assoc :components (:components child-result))
                    (seq (:event-bindings metadata)) (assoc :event_bindings (:event-bindings metadata))
                    (seq (:data-bindings metadata)) (assoc :data_bindings (:data-bindings metadata))
                    (seq layout-props) (assoc :layout_properties layout-props))]
    {:component component
     :dropzone-name dropzone-name}))

(defn render-nodes [nodes context slot-target options]
  ;; Render fragment HTML while lifting anvil-component/anvil-slot and promoted
  ;; DOM elements into component/slot YAML, replacing them with dropzones.
  (let [parts (mutable-list)
        components (mutable-list)
        parent-is-fragment (:parent-is-fragment options)]
    (doseq [node nodes]
      (cond
        (= "#text" (raw/node-name node))
        (append! parts (escape-html-text (raw/text-value node)))

        (= "#comment" (raw/node-name node))
        (append! parts (str "<!--" (raw/comment-data node) "-->"))

        (not (raw/element? node))
        nil

        :else
        (let [element node]
          (cond
            (anvil-slot? element)
            (let [{:keys [name placeholder-text layout-properties one-component]} (extract-slot-data element)
                  slot-name (if (seq name) name (generate-anonymous-slot-name context))
                  dropzone-name (generate-dropzone-name context slot-target)]
              (record-slot-selection-name! context element slot-name)
              ;; Declarative slots become recorded slot definitions plus
              ;; placeholder dropzones in the surrounding fragment HTML.
              (record-slot context slot-name slot-target
                           {:layout-properties layout-properties
                            :dropzone-name dropzone-name
                            :one-component one-component
                            :placeholder-text placeholder-text
                            :index (compute-slot-index context slot-target)
                            :parent-is-fragment parent-is-fragment})
              (append! parts (str "<anvil-dropzone name=\"" dropzone-name "\"></anvil-dropzone>")))

            (anvil-component? element)
            (let [{:keys [component dropzone-name]} (parse-component element context slot-target
                                                                     {:parent-is-fragment parent-is-fragment})]
              ;; Components are lifted out of fragment HTML and leave a
              ;; dropzone marker behind so serialization can put them back.
              (append! components component)
              (increment-component-count context slot-target)
              (append! parts (str "<anvil-dropzone name=\"" dropzone-name "\"></anvil-dropzone>")))

            (promotable-element? element context)
            (let [{:keys [component dropzone-name]} (parse-promoted-fragment element context slot-target
                                                                             {:parent-is-fragment parent-is-fragment})
                  resolved-name (or dropzone-name (generate-dropzone-name context slot-target))
                  component (if dropzone-name
                              component
                              (assoc component :layout_properties {:dropzone resolved-name}))]
              (append! components component)
              (increment-component-count context slot-target)
              (append! parts (str "<anvil-dropzone name=\"" resolved-name "\"></anvil-dropzone>")))

            :else
            ;; Ordinary DOM stays in the fragment, but its children may contain
            ;; liftable parser elements.
            (let [child-result (render-nodes (raw/child-nodes element) context slot-target
                                             {:parent-is-fragment parent-is-fragment})]
              (append-all! components (:components child-result))
              (append! parts (ensure-dom-node-attribute
                               (render-element (raw/tag-name element)
                                               (raw/attrs element)
                                               (:html child-result)))))))))
    {:html (string-list-value parts)
     :components (mutable-list-value components)}))

(defn- boundary-element? [context element]
  (or (anvil-slot? element)
      (anvil-component? element)
      (promotable-element? element context)))

(defn- capture-fragment-segment [children-vec start context]
  ;; Non-fragment containers treat each ordinary DOM element plus surrounding
  ;; whitespace as one HtmlComponent fragment, stopping before parser elements.
  (let [fragment-nodes (state [])
        index (state start)
        captured-element? (state false)
        stop? (state false)]
    (while (and (< @index (count children-vec)) (not @stop?))
      (let [current (children-vec @index)]
        (cond
          (and (raw/element? current) (boundary-element? context current))
          (state-reset! stop? true)

          (raw/element? current)
          (if @captured-element?
            (state-reset! stop? true)
            (do (state-swap! fragment-nodes conj current)
                (state-swap! index inc)
                (state-reset! captured-element? true)))

          (and @captured-element?
               (= "#text" (raw/node-name current))
               (seq (str/trim (or (raw/text-value current) ""))))
          (state-reset! stop? true)

          (and @captured-element? (= "#comment" (raw/node-name current)))
          (state-reset! stop? true)

          :else
          (do (state-swap! fragment-nodes conj current)
              (state-swap! index inc)))))
    {:nodes @fragment-nodes
     :next-index @index}))

(defn- append-fragment-component! [result context container-target fragment-nodes]
  (when (seq fragment-nodes)
    ;; Plain DOM segments in container children become anonymous HtmlComponent
    ;; components, preserving any nested lifted components.
    (let [fragment-name (generate-anonymous-component-name context)
          fragment-source-element (first-source-element fragment-nodes)
          fragment-target {:type "container" :name fragment-name}
          rendered (render-nodes fragment-nodes context fragment-target {:parent-is-fragment true})
          fragment-html (if (:normalize-html context)
                          (normalize-fragment-html (:html rendered))
                          (:html rendered))]
      ;; Whitespace-only fragments are layout noise. Anonymous names may already
      ;; have advanced, but no component should be emitted for empty content.
      (when (or (seq (str/trim fragment-html)) (seq (:components rendered)))
        (record-component-selection-name! context fragment-source-element fragment-name)
        (append! result (cond-> {:type "HtmlComponent"
                                 :name fragment-name
                                 :properties (maybe-extract-root-styling context {:html fragment-html})}
                          (seq (:components rendered)) (assoc :components (:components rendered))))
        (increment-component-count context container-target)))))

(defn- parse-container-children [children context container-target options]
  ;; Non-fragment containers hold components, slots, and ordinary DOM segments
  ;; as sibling YAML items. Ordinary DOM is grouped into HtmlComponent fragments
  ;; so the serializer can round-trip its relative order with anvil components.
  (if (empty? children)
    []
    (let [result (mutable-list)
          index (state 0)
          children-vec (vec children)
          parent-is-fragment (:parent-is-fragment options)]
      (while (< @index (count children-vec))
        (let [child (children-vec @index)]
          (if (raw/element? child)
            (let [element child]
              (cond
                (anvil-slot? element)
                (let [{:keys [name placeholder-text layout-properties one-component]} (extract-slot-data element)
                      slot-name (if (seq name) name (generate-anonymous-slot-name context))]
                  (record-slot-selection-name! context element slot-name)
                  (record-slot context slot-name container-target
                               {:layout-properties layout-properties
                                :one-component one-component
                                :placeholder-text placeholder-text
                                :include-empty-layout true
                                :dropzone-name (generate-dropzone-name context container-target)
                                :index (compute-slot-index context container-target)
                                :parent-is-fragment parent-is-fragment})
                  (state-swap! index inc))

                (anvil-component? element)
                (let [{:keys [component]} (parse-component element context container-target
                                                           {:parent-is-fragment parent-is-fragment})]
                  (append! result component)
                  (increment-component-count context container-target)
                  (state-swap! index inc))

                (promotable-element? element context)
                (let [{:keys [component]} (parse-promoted-fragment element context container-target
                                                                   {:parent-is-fragment parent-is-fragment})]
                  (append! result component)
                  (increment-component-count context container-target)
                  (state-swap! index inc))

                :else
                (let [{fragment-nodes :nodes next-index :next-index}
                      (capture-fragment-segment children-vec @index context)]
                  (append-fragment-component! result context container-target fragment-nodes)
                  (state-reset! index (if (= next-index @index) (inc @index) next-index)))))
            (let [{fragment-nodes :nodes next-index :next-index}
                  (capture-fragment-segment children-vec @index context)]
              (append-fragment-component! result context container-target fragment-nodes)
              (state-reset! index (if (= next-index @index) (inc @index) next-index))))))
      (mutable-list-value result))))

(defn parse-component [element context target options]
  (let [parent-is-fragment (:parent-is-fragment options)
        dropzone-name (generate-dropzone-name context target)
        child-nodes (raw/child-nodes element)
        {:keys [type name properties event-bindings data-bindings layout-properties]} (extract-component-data element)
        normalized-type (strip-anvil-prefix type)
        effective-name (if (seq name) name (generate-anonymous-component-name context))
        _ (mark-component-name-used! context effective-name)
        _ (record-component-selection-name! context element effective-name)
        container-type (if (seq normalized-type) normalized-type type)
        child-components (when (or (and (seq normalized-type) (contains? container-types normalized-type))
                                   (seq child-nodes))
                           (seq (parse-container-children child-nodes
                                                          context
                                                          {:type "container" :name effective-name}
                                                          {:parent-is-fragment (= container-type "HtmlComponent")})))
        layout-props (if (and (not (:dropzone layout-properties)) parent-is-fragment)
                       (assoc layout-properties :dropzone dropzone-name)
                       layout-properties)
        component (cond-> {:type (if (seq normalized-type) normalized-type type)
                           :name effective-name
                           :properties properties}
                    (seq layout-props) (assoc :layout_properties layout-props)
                    child-components (assoc :components (vec child-components))
                    (seq event-bindings) (assoc :event_bindings event-bindings)
                    (seq data-bindings) (assoc :data_bindings data-bindings))]
    {:component component :dropzone-name dropzone-name}))

(defn- detect-canonical-form [nodes]
  ;; Use the first top-level anvil-form as the canonical container wrapper.
  ;; Renderable siblings are kept as leading/trailing stray segments.
  (let [canonical (state nil)
        leading (state [])
        trailing (state [])
        current-stray (state nil)
        flush-current (fn [target]
                        (when (and @current-stray (has-renderable-content? @current-stray))
                          (state-swap! target conj @current-stray))
                        (state-reset! current-stray nil))]
    (doseq [node nodes]
      (cond
        (whitespace-or-comment? node)
        (when @current-stray
          (state-swap! current-stray conj node))

        (and (raw/element? node) (anvil-form? node))
        (if-not @canonical
          (do (flush-current leading)
              (state-reset! canonical node))
          (do (when-not @current-stray (state-reset! current-stray []))
              (state-swap! current-stray conj node)))

        :else
        (do (when-not @current-stray (state-reset! current-stray []))
            (state-swap! current-stray conj node))))
    (if @canonical
      (do (flush-current trailing)
          {:element @canonical :leading @leading :trailing @trailing})
      (do (flush-current leading) nil))))

(defn- resolve-anvil-form-type [element explicit-type fallback]
  (let [candidate (or (when (seq explicit-type) explicit-type)
                      (attr element "container")
                      "")
        normalized (strip-anvil-prefix candidate)]
    (or (when (seq normalized) normalized)
        (when (seq candidate) candidate)
        fallback)))

(defn- explicit-component-name [element]
  (cond
    (anvil-component? element) (attr element "name")
    :else (attr element "anvil:name")))

;; Internal serializer reparses may include generated $component_* names in
;; temporary HTML. Reserve every explicit name before parsing so newly anonymous
;; components cannot claim a preserved name that appears later in the document.
(defn- collect-explicit-component-names [nodes]
  (let [names (state #{})]
    (letfn [(walk [node]
              (when (raw/element? node)
                (when-let [component-name (explicit-component-name node)]
                  (when (seq component-name)
                    (state-swap! names conj component-name)))
                (doseq [child (raw/child-nodes node)]
                  (walk child))))]
      (doseq [node nodes]
        (walk node)))
    @names))

(defn- reserve-explicit-component-names [options nodes]
  (let [reserved (set (:reserved-component-names options))]
    (assoc (or options {})
           :reserved-component-names
           (into reserved (collect-explicit-component-names nodes)))))

(defn- parse-container-form-nodes
  [html nodes container-type options]
  (let [options (reserve-explicit-component-names options nodes)
        context (create-context options false html)
        root-target {:type "container" :name ""}
        significant-nodes (filterv (complement whitespace-or-comment?) nodes)
        canonical-form (detect-canonical-form nodes)
        components (state [])
        container-type-override (state container-type)
        container-properties (state {})
        container-event-bindings (state nil)
        container-data-bindings (state nil)
        container-layout-properties (state nil)
        flatten-segments (fn [segments] (vec (mapcat identity segments)))
        append-segments (fn [segments]
                          (doseq [segment segments]
                            (state-swap! components into
                                         (parse-container-children segment context root-target
                                                                   {:parent-is-fragment false}))))
        apply-metadata (fn [metadata]
                         (state-swap! container-properties merge (:properties metadata))
                         (when (seq (:event-bindings metadata))
                           (state-reset! container-event-bindings (:event-bindings metadata)))
                         (when (seq (:data-bindings metadata))
                           (state-reset! container-data-bindings (:data-bindings metadata)))
                         (when (seq (:layout-properties metadata))
                           (state-reset! container-layout-properties (:layout-properties metadata))))]
    (if canonical-form
      (let [element (:element canonical-form)
            metadata (extract-component-data element)
            normalized-type (resolve-anvil-form-type element (:type metadata) container-type)]
        (if (= normalized-type "HtmlComponent")
          ;; HtmlComponent containers store leading/trailing stray DOM
          ;; together with the form contents in container.properties.html.
          (let [merged-nodes (vec (concat (flatten-segments (:leading canonical-form))
                                          (raw/child-nodes element)
                                          (flatten-segments (:trailing canonical-form))))
                rendered (render-nodes merged-nodes context root-target {:parent-is-fragment true})]
            (state-reset! components (:components rendered))
            (state-swap! container-properties assoc
                         :html (if (:normalize-html context)
                                 (normalize-fragment-html (:html rendered))
                                 (:html rendered)))
            (apply-metadata metadata)
            (state-reset! container-type-override "HtmlComponent"))
          (do
            ;; Structured containers keep canonical form metadata on the
            ;; container and parse stray DOM as sibling components.
            (append-segments (:leading canonical-form))
            (state-swap! components into
                         (parse-container-children (raw/child-nodes element) context root-target
                                                   {:parent-is-fragment false}))
            (append-segments (:trailing canonical-form))
            (apply-metadata metadata)
            (state-reset! container-type-override normalized-type))))
      (if (and (= 1 (count significant-nodes))
               (raw/element? (first significant-nodes))
               (promotable-element? (first significant-nodes) context))
        ;; A single promoted root element becomes the HtmlComponent container
        ;; itself, not a child component, so root metadata stays on the form.
        (let [element (first significant-nodes)
              metadata (extract-promoted-fragment-data element)
              rendered (render-nodes (raw/child-nodes element) context root-target {:parent-is-fragment true})
              element-html (render-element (lower-tag-name element)
                                           (filter-anvil-attributes (raw/attrs element))
                                           (:html rendered))]
          (state-reset! components (:components rendered))
          (state-swap! container-properties assoc
                       :html (if (:normalize-html context)
                               (normalize-fragment-html element-html)
                               element-html))
          (state-swap! container-properties merge (:properties metadata))
          (when (seq (:event-bindings metadata))
            (state-reset! container-event-bindings (:event-bindings metadata)))
          (when (seq (:data-bindings metadata))
            (state-reset! container-data-bindings (:data-bindings metadata)))
          (state-reset! container-type-override "HtmlComponent"))
        (let [rendered (render-nodes nodes context root-target {:parent-is-fragment true})]
          (state-reset! components (:components rendered))
          (state-swap! container-properties assoc
                       :html (if (:normalize-html context)
                               (normalize-fragment-html (:html rendered))
                               (:html rendered)))
          (state-reset! container-type-override container-type))))
    (let [container-properties (if (= "HtmlComponent" @container-type-override)
                                 (maybe-extract-root-styling context @container-properties)
                                 @container-properties)
          container (cond-> {:type @container-type-override
                             :properties container-properties}
                      @container-event-bindings (assoc :event_bindings @container-event-bindings)
                      @container-data-bindings (assoc :data_bindings @container-data-bindings)
                      @container-layout-properties (assoc :layout_properties @container-layout-properties))
          slots @(:slots context)]
      (cond-> {:container container
               :components @components
               :serialized_html (if (:normalize-html context)
                                  (normalize-fragment-html html)
                                  html)}
        (seq slots) (assoc :slots (into (sorted-map) slots))))))

(defn parse-container-form
  ([html] (parse-container-form html "HtmlComponent" nil))
  ([html container-type] (parse-container-form html container-type nil))
  ([html container-type options]
   (let [fragment (raw/parse-fragment html (when (:selection-name-maps options)
                                             {:source-locations? true}))]
     (parse-container-form-nodes html (raw/child-nodes fragment) container-type options))))

(defn- layout-root? [element]
  (and (= "anvil-form" (lower-tag-name element))
       (some? (attr element "layout"))))

(defn- layout-type-attribute [element]
  (or (attr element "layout") (attr element "type")))

(declare parse-layout-form)

(defn- raw-parse-options [options]
  (when (:selection-name-maps options)
    {:source-locations? true}))

(defn- parse-layout-form-nodes
  [html nodes options]
  (let [options (reserve-explicit-component-names options nodes)
        layout-element (state nil)
        stray-blocks (state [])
        current-stray (state nil)
        flush-current (fn []
                        (when (and @current-stray (has-renderable-content? @current-stray))
                          (state-swap! stray-blocks conj @current-stray))
                        (state-reset! current-stray nil))]
    (doseq [node nodes]
      (cond
        (whitespace-or-comment? node)
        (when @current-stray
          (state-swap! current-stray conj node))

        (and (raw/element? node) (layout-root? node))
        (if-not @layout-element
          (do (flush-current)
              (state-reset! layout-element node))
          (do (when-not @current-stray (state-reset! current-stray []))
              (state-swap! current-stray conj node)))

        :else
        (do (when-not @current-stray (state-reset! current-stray []))
            (state-swap! current-stray conj node))))
    (flush-current)
    (if-not @layout-element
      ;; If a layout parse is requested without a layout root, recover by
      ;; wrapping the input in an UnknownLayout anvil-form.
      (parse-layout-form (str "<anvil-form layout=\"UnknownLayout\">" html "</anvil-form>") options)
      (let [{:keys [properties layout-event-bindings data-bindings event-bindings]} (extract-component-data @layout-element)
            layout-type (or (layout-type-attribute @layout-element) "UnknownLayout")
            context (create-context options true html)
            components-by-slot (state {})
            block-names (state #{})
            duplicate-counts (state {})
            unknown-block-counter (state 1)
            generate-unknown-block-name (fn []
                                          (loop []
                                            (let [candidate (str "$unknown-slot-" (let [current @unknown-block-counter]
                                                                                    (state-swap! unknown-block-counter inc)
                                                                                    current))]
                                              (if (contains? @block-names candidate)
                                                (recur)
                                                (do (state-swap! block-names conj candidate)
                                                    candidate)))))
            ;; Layout block names are serialized as map keys, so missing and
            ;; duplicate slot names need stable synthetic names instead of
            ;; overwriting earlier blocks.
            allocate-block-name (fn [raw-name]
                                  (let [trimmed (some-> raw-name str/trim)]
                                    (if (empty? trimmed)
                                      (generate-unknown-block-name)
                                      (if-not (contains? @block-names trimmed)
                                        (do (state-swap! block-names conj trimmed)
                                            trimmed)
                                        (loop [suffix (get @duplicate-counts trimmed 1)]
                                          (let [candidate (str trimmed "_copy_" suffix)]
                                            (if (contains? @block-names candidate)
                                              (recur (inc suffix))
                                              (do (state-swap! duplicate-counts assoc trimmed (inc suffix))
                                                  (state-swap! block-names conj candidate)
                                                  candidate))))))))
            register-block (fn [block-name block-nodes]
                             (state-swap! components-by-slot assoc
                                          block-name
                                          (parse-container-children block-nodes context
                                                                    {:type "slot" :name block-name}
                                                                    {:parent-is-fragment false})))]
        ;; Find anvil-block children inside the layout root. Non-block layout
        ;; content is preserved in generated unknown blocks instead of dropped.
        (doseq [child (raw/child-nodes @layout-element)]
          (cond
            (whitespace-or-comment? child) nil
            (and (raw/element? child) (anvil-block? child))
            (register-block (allocate-block-name (attr child "slot"))
                            (raw/child-nodes child))
            :else
            (register-block (generate-unknown-block-name) [child])))
        (doseq [stray @stray-blocks]
          (register-block (generate-unknown-block-name) stray))
        (let [layout (cond-> {:type layout-type}
                       (seq properties) (assoc :properties properties)
                       (seq layout-event-bindings) (assoc :event_bindings layout-event-bindings)
                       (seq event-bindings) (assoc :form_event_bindings event-bindings)
                       (seq data-bindings) (assoc :data_bindings data-bindings))
              slots @(:slots context)]
          (cond-> {:layout layout
                   :components_by_slot @components-by-slot}
            (seq slots) (assoc :slots slots)))))))

(defn parse-layout-form
  ([html] (parse-layout-form html nil))
  ([html options]
   (let [fragment (raw/parse-fragment html (raw-parse-options options))]
     (parse-layout-form-nodes html (raw/child-nodes fragment) options))))

(defn- top-level-layout-element? [nodes]
  (some (fn [node]
          (when-not (whitespace-or-comment? node)
            (and (raw/element? node)
                 (anvil-form? node)
                 (some? (attr node "layout")))))
        nodes))

(defn parse-serialized-html
  ([html] (parse-serialized-html html nil))
  ([html options]
   (let [fragment (raw/parse-fragment html (raw-parse-options options))
         nodes (raw/child-nodes fragment)]
     (if (top-level-layout-element? nodes)
       (parse-layout-form-nodes html nodes options)
       (parse-container-form-nodes html nodes "HtmlComponent" options)))))

(defn build-selection-name-maps
  ([html] (build-selection-name-maps html nil))
  ([html options]
   ;; The editor needs source offsets mapped to the same names the parser would
   ;; assign, including promoted DOM fragments and anonymous container children.
   (let [components (state {})
         slots (state {})
         options (assoc (or options {})
                        :selection-name-maps {:components components :slots slots}
                        :source-locations? true)]
     (parse-serialized-html html options)
     {:components @components
      :slots @slots})))
