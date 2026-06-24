(ns anvil.html-form.serializer
  (:require [anvil.html-form.raw :as raw]
            [anvil.html-form.parser :as parser]
            [anvil.html-form.shared
             :refer [add-attrs-to-root-element anvil-component? anvil-dropzone?
                     append! attr ensure-dom-node-attribute escape-html-text format-attribute
                     get-single-root-element is-generated-dropzone-name?
                     json-literal? json-parseable? mutable-list
                     mutable-list-value normalize-fragment-html render-element
                     serialize-node state state-reset! state-swap! string-list-value
                     whitespace-or-comment? with-attr without-attrs]]
            [clojure.string :as str]
            #?(:clj [clojure.data.json :as json])))

(def default-indent-step "    ")

(defn- option-value [options camel-key kebab-key]
  (get options kebab-key (get options camel-key)))

(defn- generated-component-name? [value]
  (boolean (and (string? value)
                (re-matches #"\$component_[0-9]+" value))))

(defn- resolve-indent-step [options]
  (let [size (option-value options :indentSize :indent-size)]
    (if (and (number? size) (pos? size))
      (apply str (repeat (max 1 (long (Math/round (double size)))) " "))
      default-indent-step)))

(defn- escape-prop-value [value]
  (cond
    ;; String values that already parse as JSON must be quoted so they round
    ;; trip as strings instead of becoming numbers/booleans/objects.
    (string? value) (if (and (json-literal? value) (json-parseable? value))
                      #?(:clj (json/write-str value)
                         :cljs (js/JSON.stringify value))
                      value)
    (nil? value) "null"
    :else #?(:clj (json/write-str value)
             :cljs (js/JSON.stringify (clj->js value)))))

(defn- split-class-names [value]
  (->> (str/split (str/trim (str value)) #"\s+")
       (remove empty?)
       vec))

(defn- dedupe-preserving-order [values]
  (first (reduce (fn [[result seen] value]
                   (if (contains? seen value)
                     [result seen]
                     [(conj result value) (conj seen value)]))
                 [[] #{}]
                 values)))

(defn- normalize-classes-for-attribute [value]
  (cond
    (nil? value)
    nil

    (string? value)
    (let [classes (dedupe-preserving-order (split-class-names value))]
      (when (seq classes) (str/join " " classes)))

    (sequential? value)
    (let [classes (dedupe-preserving-order (mapcat split-class-names value))]
      (when (seq classes) (str/join " " classes)))

    (map? value)
    (let [classes (reduce (fn [result [class-name enabled?]]
                            (let [tokens (split-class-names (if (keyword? class-name)
                                                              (name class-name)
                                                              class-name))]
                              (if enabled?
                                (into result tokens)
                                (reduce (fn [current token]
                                          (vec (remove #(= token %) current)))
                                        result
                                        tokens))))
                          []
                          value)
          classes (dedupe-preserving-order classes)]
      (when (seq classes) (str/join " " classes)))

    :else
    (let [classes (dedupe-preserving-order (split-class-names value))]
      (when (seq classes) (str/join " " classes)))))

(def ^:private unitless-css-properties
  #{"animation-iteration-count" "aspect-ratio" "border-image-outset"
    "border-image-slice" "border-image-width" "box-flex" "box-flex-group"
    "box-ordinal-group" "column-count" "columns" "flex" "flex-grow"
    "flex-positive" "flex-shrink" "flex-negative" "flex-order" "grid-area"
    "grid-row" "grid-row-end" "grid-row-span" "grid-row-start" "grid-column"
    "grid-column-end" "grid-column-span" "grid-column-start" "font-weight"
    "line-clamp" "line-height" "opacity" "order" "orphans" "scale"
    "tab-size" "widows" "z-index" "zoom" "fill-opacity" "flood-opacity"
    "stop-opacity" "stroke-dasharray" "stroke-dashoffset"
    "stroke-miterlimit" "stroke-opacity" "stroke-width"})

(defn- css-property-name [key]
  (let [value (if (keyword? key) (name key) (str key))]
    (if (str/starts-with? value "--")
      value
      (-> value
          (str/replace "_" "-")
          (str/replace #"([a-z])([A-Z])" "$1-$2")
          str/lower-case))))

(defn- unitless-css-property? [property]
  (let [property (css-property-name property)
        unprefixed (str/replace property #"^-(webkit|moz|ms|o)-" "")]
    (or (str/starts-with? property "--")
        (contains? unitless-css-properties property)
        (contains? unitless-css-properties unprefixed))))

(declare normalize-style-value)

(defn- normalize-style-value [value property]
  (cond
    (sequential? value)
    (str/join " " (map #(normalize-style-value % property) value))

    (number? value)
    (if (unitless-css-property? property)
      (str value)
      (str value "px"))

    :else
    (str value)))

(defn- normalize-style-for-attribute [value]
  (cond
    (nil? value)
    nil

    (string? value)
    (let [trimmed (str/trim value)]
      (when (seq trimmed) trimmed))

    (and (map? value) (not (sequential? value)))
    (let [declarations (keep (fn [[property css-value]]
                               (when (some? css-value)
                                 (let [property-name (css-property-name property)
                                       rendered (normalize-style-value css-value property-name)]
                                   (when (seq rendered)
                                     (str property-name ": " rendered)))))
                             value)]
      (when (seq declarations) (str/join "; " declarations)))

    :else
    (let [rendered (str/trim (normalize-style-value value ""))]
      (when (seq rendered) rendered))))

(declare indent-preserving-relative-whitespace)

(defn- root-html-attributes [properties]
  (let [has-classes? (contains? properties :classes)
        has-style? (contains? properties :style)]
    {:class-value (when has-classes? (normalize-classes-for-attribute (:classes properties)))
     :style-value (when has-style? (normalize-style-for-attribute (:style properties)))
     :has-classes? has-classes?
     :has-style? has-style?}))

(defn- root-attr-list [{:keys [class-value style-value]}]
  (cond-> []
    (some? class-value) (conj {:name "class" :value class-value})
    (some? style-value) (conj {:name "style" :value style-value})))

(defn- apply-root-attrs-to-node [node attrs]
  (let [node-attrs (cond-> (raw/attrs node)
                     (:has-classes? attrs)
                     (as-> current
                       (if (some? (:class-value attrs))
                         (with-attr current "class" (:class-value attrs))
                         (without-attrs current ["class"])))

                     (:has-style? attrs)
                     (as-> current
                       (if (some? (:style-value attrs))
                         (with-attr current "style" (:style-value attrs))
                         (without-attrs current ["style"]))))]
    (render-element (raw/tag-name node)
                    node-attrs
                    (apply str (map serialize-node (raw/child-nodes node))))))

(defn- apply-root-html-attributes
  ([html attrs] (apply-root-html-attributes html attrs default-indent-step))
  ([html attrs indent-step]
   (let [has-attrs? (or (some? (:class-value attrs))
                        (some? (:style-value attrs)))]
     (cond
       (empty? (str/trim (or html "")))
       (if has-attrs?
         (render-element "div" (root-attr-list attrs) "")
         html)

       :else
       (let [fragment (raw/parse-fragment html)
             nodes (raw/child-nodes fragment)
             root (get-single-root-element nodes)]
         (cond
           root
           (apply str (map #(if (identical? % root)
                              (apply-root-attrs-to-node % attrs)
                              (serialize-node %))
                           nodes))

           (not has-attrs?)
           html

           :else
           (render-element "div"
                           (root-attr-list attrs)
                           (str "\n" (indent-preserving-relative-whitespace
                                       (str/trim html)
                                       indent-step)
                                "\n"))))))))

(defn- component-attrs
  ([component include-layout?] (component-attrs component include-layout? true false))
  ([component include-layout? include-dropzone?] (component-attrs component include-layout? include-dropzone? false))
  ([component include-layout? include-dropzone? preserve-generated-component-names?]
   (let [base [{:name "type" :value (:type component)}]
         base (if (and (seq (:name component))
                       (or (and preserve-generated-component-names?
                                (generated-component-name? (:name component)))
                           (not (str/starts-with? (:name component) "$"))))
                (conj base {:name "name" :value (:name component)})
                base)
         prop-attrs (mapv (fn [[k v]]
                            {:name (str "prop:" (name k))
                             :value (escape-prop-value v)})
                          (:properties component))
         event-attrs (mapv (fn [[k v]]
                             {:name (str "on:" (name k))
                              :value (str "self." v)})
                           (:event_bindings component))
         binding-attrs (mapv (fn [{:keys [property code writeback]}]
                               {:name (str (if writeback "writeback:" "bind:") property)
                                :value code})
                             (:data_bindings component))
         layout-attrs (if include-layout?
                        (mapv (fn [[k v]]
                                {:name (str "container:" (name k))
                                 :value (escape-prop-value v)})
                              ;; Generated dropzones are parser bookkeeping
                              ;; inside fragments; omit them from serialized
                              ;; fragment metadata.
                              (if include-dropzone?
                                (:layout_properties component)
                                (dissoc (:layout_properties component) :dropzone)))
                        [])]
     (vec (concat base prop-attrs event-attrs binding-attrs layout-attrs)))))

(declare serialize-component serialize-component-with-slots serialize-slot slot-name-value indent-lines)

(defn- count-leading-whitespace-string [value]
  (count (or (second (re-find #"^([ \t]*)" (or value ""))) "")))

(defn- indent-preserving-relative-whitespace
  ([content indent] (indent-preserving-relative-whitespace content indent false))
  ([content indent skip-first-line-indent?]
   ;; Fragments often already include meaningful internal indentation. Prefix
   ;; serialized indentation while preserving relative whitespace inside them.
   (if (empty? content)
     content
     (let [lines (str/split content #"\n" -1)]
       (if (= 1 (count lines))
         (if skip-first-line-indent?
           (first lines)
           (str indent (first lines)))
         (let [base-indent (reduce (fn [minimum line]
                                     (if (empty? (str/trim line))
                                       minimum
                                       (let [leading (count-leading-whitespace-string line)]
                                         (if (zero? leading)
                                           (reduced 0)
                                           (min minimum leading)))))
                                   ##Inf
                                   (rest lines))
               base-indent (if (or (not (number? base-indent))
                                   (infinite? base-indent))
                             0
                             base-indent)]
           (str/join "\n"
                     (map-indexed
                       (fn [index line]
                         (if (empty? line)
                           ""
                           (let [adjusted (if (and (not= index 0) (pos? base-indent))
                                            (subs line (min base-indent
                                                            (count-leading-whitespace-string line)))
                                            line)]
                             (if (and skip-first-line-indent? (= index 0))
                               adjusted
                               (str indent adjusted)))))
                       lines))))))))

(defn- prefix-lines [value prefix]
  (str/join "\n"
            (map (fn [line]
                   (if (empty? line) "" (str prefix line)))
                 (str/split (or value "") #"\n" -1))))

(defn- components-by-dropzone [components]
  ;; HtmlComponent treats the default dropzone as implicit, so components with
  ;; no explicit dropzone fill an existing default placeholder before appending.
  (reduce (fn [by-dropzone component]
            (let [dropzone (or (get-in component [:layout_properties :dropzone])
                               "default")]
              (update by-dropzone dropzone (fnil conj []) component)))
          {}
          components))

(defn- sorted-slot-entries [entries]
  (sort-by (fn [[slot-name slot]]
             [(:index slot 0) (slot-name-value slot-name)])
           entries))

(defn- sorted-layout-block-entries [components-by-slot slots]
  (let [components-by-slot (or components-by-slot {})
        explicit-slot-names (set (map slot-name-value (keys components-by-slot)))
        slot-target-names (keep (fn [[_ slot]]
                                  (let [target (:target slot)
                                        slot-name (some-> (get target :name) slot-name-value)]
                                    (when (and (= "slot" (get target :type))
                                               (seq slot-name)
                                               (not (contains? explicit-slot-names slot-name)))
                                      slot-name)))
                                slots)]
    (concat components-by-slot
            (map (fn [slot-name] [slot-name []])
                 (sort (distinct slot-target-names))))))

(defn- target-key [target]
  (str (:type target) ":" (:name target)))

(defn- update-map-values [m f]
  (reduce-kv (fn [result k v]
               (assoc result k (f v)))
             {}
             m))

(defn- create-serializer-context
  ([parsed] (create-serializer-context parsed nil))
  ([parsed options]
  (let [slots (into (sorted-map) (or (:slots parsed) {}))
        entries (seq slots)
        slots-by-dropzone-id
        (reduce (fn [by-dropzone [slot-name slot]]
                  (if-let [dropzone (get-in slot [:set_layout_properties :dropzone])]
                    (update by-dropzone dropzone (fnil conj []) [slot-name slot])
                    by-dropzone))
                {}
                entries)
        slots-by-target
        (reduce (fn [by-target [slot-name slot]]
                  (if-let [target (:target slot)]
                    (update by-target (target-key target) (fnil conj []) [slot-name slot])
                    by-target))
                {}
                entries)]
    ;; Pre-index slots once per serialize call. Large forms often have many
    ;; components and slots; rebuilding these views for every nested component
    ;; turns serialization into repeated full-map scans.
    ;; Each indexed list is sorted by slot index, then name, so callers can walk
    ;; slots and components together without re-sorting at every boundary.
    {:slots slots
     :slots-by-dropzone-id (update-map-values slots-by-dropzone-id sorted-slot-entries)
     :slots-by-target (update-map-values slots-by-target sorted-slot-entries)
     :emitted-slot-names (state #{})
     :needs-reparse (state false)
     :preserve-generated-component-names? (true? (:preserve-generated-component-names options))
     :indent-step (resolve-indent-step options)})))

(defn- serializer-context? [value]
  (and (map? value)
       (contains? value :slots-by-target)
       (contains? value :slots-by-dropzone-id)))

(defn- ensure-serializer-context [context-or-slots]
  (if (serializer-context? context-or-slots)
    context-or-slots
    (create-serializer-context {:slots context-or-slots})))

(defn- slots-for-target [context target]
  (get (:slots-by-target context) (target-key target)))

(defn- slots-for-target-without-dropzone [context target]
  ;; HtmlComponent omits layout_properties.dropzone for its implicit default
  ;; dropzone, so only the default placeholder may receive these slots.
  (filterv (fn [[_ slot]]
             (not (seq (get-in slot [:set_layout_properties :dropzone]))))
           (slots-for-target context target)))

(defn- unemitted-slots-with-dropzone-for-target [context target]
  (let [emitted @(:emitted-slot-names context)]
    (filterv (fn [[slot-name slot]]
               (let [dropzone (get-in slot [:set_layout_properties :dropzone])]
                 (and (not (contains? emitted (slot-name-value slot-name)))
                      (string? dropzone)
                      (seq dropzone))))
             (slots-for-target context target))))

(defn- slots-for-dropzone [context dropzone]
  (get (:slots-by-dropzone-id context) dropzone))

(defn- mark-needs-reparse! [context]
  (when-let [needs-reparse (:needs-reparse context)]
    (state-reset! needs-reparse true)))

(defn- dropzone-name [element]
  (attr element "name"))

(defn- trailing-indent-before [nodes index fallback]
  (loop [position (dec index)]
    (if (neg? position)
      fallback
      (let [node (nth nodes position)]
        (cond
          (= "#text" (raw/node-name node))
          (if-let [match (re-find #"(?:\n|\r)([ \t]*)$" (or (raw/text-value node) ""))]
            (second match)
            fallback)

          (= "#comment" (raw/node-name node))
          (recur (dec position))

          :else
          fallback)))))

(defn- adjacent-element [nodes start step]
  (loop [index start]
    (when (and (>= index 0) (< index (count nodes)))
      (let [node (nth nodes index)]
        (cond
          (whitespace-or-comment? node)
          (recur (+ index step))

          (raw/element? node)
          node

          :else
          nil)))))

(defn- pending-dropzone-replacement? [element component-dropzones replaced-dropzones slot-dropzones]
  (and (anvil-dropzone? element)
       (let [name (dropzone-name element)]
         (and (seq name)
              (or (contains? component-dropzones name)
                  (contains? replaced-dropzones name)
                  (contains? slot-dropzones name))))))

(defn- generated-dropzone-adjacent-to-user-dropzone? [element adjacent-element]
  (and (anvil-dropzone? adjacent-element)
       (let [name (dropzone-name element)
             adjacent-name (dropzone-name adjacent-element)]
         (and (seq name)
              (seq adjacent-name)
              (is-generated-dropzone-name? name)
              (not (is-generated-dropzone-name? adjacent-name))))))

(defn- prune-dropzone-adjacent-to-replacement? [element adjacent-element]
  (let [name (dropzone-name element)
        adjacent-name (dropzone-name adjacent-element)]
    (not (and (seq name)
              (seq adjacent-name)
              (not (is-generated-dropzone-name? name))
              (is-generated-dropzone-name? adjacent-name)))))

;; Serialized forms can accumulate stale dropzones as components move or are
;; deleted. Remove placeholders nested inside another dropzone, adjacent to a
;; component/dropzone that will replace them, or superseded earlier in the pass.
(defn- should-remove-dropzone? [element nodes index parent-dropzone? component-dropzones replaced-dropzones slot-dropzones]
  (or parent-dropzone?
      (let [prev-element (adjacent-element nodes (dec index) -1)
            next-element (adjacent-element nodes (inc index) 1)]
        (or (and prev-element
                 (or (generated-dropzone-adjacent-to-user-dropzone? element prev-element)
                     (anvil-component? prev-element)
                     (and (pending-dropzone-replacement? prev-element component-dropzones replaced-dropzones slot-dropzones)
                          (prune-dropzone-adjacent-to-replacement? element prev-element))))
            (and next-element
                 (or (generated-dropzone-adjacent-to-user-dropzone? element next-element)
                     (anvil-component? next-element)
                     (and (pending-dropzone-replacement? next-element component-dropzones replaced-dropzones slot-dropzones)
                          (prune-dropzone-adjacent-to-replacement? element next-element))))))))

(declare serialize-html-component)

(defn- serialize-component-in-fragment [component context indent prepend-indent?]
  ;; Components inserted into fragment HTML need fragment-aware indentation.
  ;; HtmlComponent children already own their inner HTML; other components are
  ;; emitted as anvil-component tags.
  (let [html (if (= "HtmlComponent" (:type component))
               (serialize-html-component component context true)
               (serialize-component-with-slots component context false))]
    (if (= "HtmlComponent" (:type component))
      (indent-preserving-relative-whitespace html indent (not prepend-indent?))
      (if prepend-indent?
        (prefix-lines html indent)
        html))))

(defn- dropzone-replacement-chunks [dropzone components context target indent]
  ;; Build the replacement content for one dropzone by walking component counts
  ;; and slot indexes together. Slots at index N are emitted before component N.
  (let [component-items (vec (get components dropzone))
        slot-items (vec (concat (slots-for-dropzone context dropzone)
                                (when (= dropzone "default")
                                  (slots-for-target-without-dropzone context target))))
        component-count (count component-items)
        slot-count (count slot-items)
        chunks (mutable-list)]
    (loop [index 0
           slot-index 0
           chunk-count 0]
      (if (and (> index component-count) (= slot-index slot-count))
        (mutable-list-value chunks)
        (let [[slot-index chunk-count]
              (loop [slot-index slot-index
                     chunk-count chunk-count]
                (if (and (< slot-index slot-count)
                         (= index (:index (second (slot-items slot-index)) 0)))
                  (let [[slot-name slot] (slot-items slot-index)
                        html (serialize-slot slot-name slot false context)]
                    (append! chunks (if (pos? chunk-count)
                                      (prefix-lines html indent)
                                      html))
                    (recur (inc slot-index) (inc chunk-count)))
                  [slot-index chunk-count]))
              chunk-count (if (< index component-count)
                            (do
                              (append! chunks
                                       (serialize-component-in-fragment (component-items index)
                                                                        context
                                                                        indent
                                                                        (pos? chunk-count)))
                              (inc chunk-count))
                            chunk-count)]
          (recur (inc index) (long slot-index) (long chunk-count)))))))

(declare serialize-replacement-nodes)

(defn- pop-last-whitespace! [parts]
  (when (and (seq (mutable-list-value parts))
             (re-matches #"\s*" (last (mutable-list-value parts))))
    #?(:clj (state-swap! parts pop)
       :cljs (.pop parts))))

(defn- append-unreplaced-dropzone! [parts element parent-indent replacement-state]
  (append! parts
           (render-element (raw/tag-name element)
                           (raw/attrs element)
                           (serialize-replacement-nodes (raw/child-nodes element)
                                                        (str parent-indent (:indent-step replacement-state default-indent-step))
                                                        true
                                                        replacement-state))))

(defn- append-dropzone-node! [parts element nodes index parent-indent parent-dropzone? replacement-state]
  ;; A dropzone is either replaced with matching components/slots, pruned as a
  ;; stale placeholder, or preserved recursively if it still represents a target.
  (let [{:keys [context target remaining-dropzones replaced-dropzones slot-dropzones]} replacement-state
        name (dropzone-name element)
        indent (trailing-indent-before nodes index parent-indent)
        chunks (when (seq name)
                 ;; Replace matching dropzones with components and slots in
                 ;; slot-index order, preserving local indentation.
                 (dropzone-replacement-chunks name @remaining-dropzones context target indent))]
    (cond
      (seq chunks)
      (do
        (append! parts (str/join "\n" chunks))
        (state-swap! replaced-dropzones conj name)
        (when (is-generated-dropzone-name? name)
          (mark-needs-reparse! context))
        (state-swap! remaining-dropzones dissoc name))

      (should-remove-dropzone? element
                               nodes
                               index
                               parent-dropzone?
                               @remaining-dropzones
                               @replaced-dropzones
                               slot-dropzones)
      (do
        (mark-needs-reparse! context)
        (pop-last-whitespace! parts))

      :else
      (append-unreplaced-dropzone! parts element parent-indent replacement-state))))

(defn- append-element-node! [parts element parent-indent replacement-state]
  (append! parts
           (render-element (raw/tag-name element)
                           (raw/attrs element)
                           (serialize-replacement-nodes (raw/child-nodes element)
                                                        (str parent-indent (:indent-step replacement-state default-indent-step))
                                                        false
                                                        replacement-state))))

(defn- append-replacement-node! [parts node nodes index parent-indent parent-dropzone? replacement-state]
  (cond
    (= "#text" (raw/node-name node))
    (append! parts (escape-html-text (raw/text-value node)))

    (= "#comment" (raw/node-name node))
    (append! parts (str "<!--" (raw/comment-data node) "-->"))

    (not (raw/element? node))
    nil

    (anvil-dropzone? node)
    (append-dropzone-node! parts node nodes index parent-indent parent-dropzone? replacement-state)

    :else
    (append-element-node! parts node parent-indent replacement-state)))

(defn- serialize-replacement-nodes
  ([nodes parent-indent parent-dropzone?]
   (serialize-replacement-nodes nodes parent-indent parent-dropzone? nil))
  ([nodes parent-indent parent-dropzone? replacement-state]
   (let [nodes (vec nodes)
         parts (mutable-list)]
     (doseq [index (range (count nodes))]
       (append-replacement-node! parts
                                 (nodes index)
                                 nodes
                                 index
                                 parent-indent
                                 parent-dropzone?
                                 replacement-state))
     (string-list-value parts))))

(defn- replace-dropzones-result
  ([html components] (replace-dropzones-result html components nil {:type "container" :name ""}))
  ([html components context-or-slots target]
   ;; Return both rewritten HTML and components that could not be placed. The
   ;; caller appends those remaining components after the fragment content.
   (if (empty? html)
     {:html ""
      :remaining components
      :needs-reparse? false
      :had-single-root-before-append? false}
     (let [context (ensure-serializer-context context-or-slots)
           fragment (raw/parse-fragment html)
           nodes (raw/child-nodes fragment)
           component-dropzones (components-by-dropzone components)
           remaining-dropzones (state component-dropzones)
           replacement-state {:context context
                              :target target
                              :indent-step (:indent-step context default-indent-step)
                              :remaining-dropzones remaining-dropzones
                              :replaced-dropzones (state #{})
                              :slot-dropzones (set (keys (:slots-by-dropzone-id context)))
                              :needs-reparse (:needs-reparse context)}]
       {:html (serialize-replacement-nodes nodes "" false replacement-state)
        :remaining (vec (mapcat second @remaining-dropzones))
        :needs-reparse? @(:needs-reparse context)
        :had-single-root-before-append? (some? (get-single-root-element nodes))}))))

(defn- remaining-fragment-chunks [components slots context]
  (let [components (vec components)
        slots (vec slots)
        component-count (count components)
        slot-count (count slots)
        chunks (mutable-list)]
    (loop [index 0
           slot-index 0
           chunk-count 0]
      (if (and (> index component-count) (= slot-index slot-count))
        (mutable-list-value chunks)
        (let [[slot-index chunk-count]
              (loop [slot-index slot-index
                     chunk-count chunk-count]
                (if (and (< slot-index slot-count)
                         (= index (:index (second (slots slot-index)) 0)))
                  (let [[slot-name slot] (slots slot-index)]
                    (append! chunks (serialize-slot slot-name slot false context))
                    (recur (inc slot-index) (inc chunk-count)))
                  [slot-index chunk-count]))
              chunk-count (if (< index component-count)
                            (do
                              (append! chunks
                                       (serialize-component-in-fragment (components index)
                                                                        context
                                                                        ""
                                                                        (pos? chunk-count)))
                              (inc chunk-count))
                            chunk-count)]
          (recur (inc index) (long slot-index) (long chunk-count)))))))

(defn- fill-dropzones-and-append-remaining [html components context target]
  (let [{filled-html :html
         remaining :remaining
         needs-reparse? :needs-reparse?
         had-single-root-before-append? :had-single-root-before-append?}
        (replace-dropzones-result html components context target)
        remaining-slots (unemitted-slots-with-dropzone-for-target context target)
        chunks (remaining-fragment-chunks remaining remaining-slots context)
        appended? (seq chunks)
        html (if appended?
               (do
                 (mark-needs-reparse! context)
                 (if (seq filled-html)
                   (str filled-html "\n" (str/join "\n" chunks))
                   (str/join "\n" chunks)))
               filled-html)]
    {:html html
     :appended? (boolean appended?)
     :needs-reparse? (boolean (or needs-reparse? appended? @(:needs-reparse context)))
     :had-single-root-before-append? had-single-root-before-append?}))

(defn- replace-dropzones
  ([html components] (:html (replace-dropzones-result html components nil {:type "container" :name ""})))
  ([html components context-or-slots]
   (:html (replace-dropzones-result html components context-or-slots {:type "container" :name ""}))))

(defn- fragment-metadata-attrs
  ([component] (fragment-metadata-attrs component false false))
  ([component parent-is-fragment?] (fragment-metadata-attrs component parent-is-fragment? false))
  ([component parent-is-fragment? preserve-generated-component-names?]
   (let [name-attrs (if (and (seq (:name component))
                             (or (and preserve-generated-component-names?
                                      (generated-component-name? (:name component)))
                                 (not (str/starts-with? (:name component) "$"))))
                      [{:name "anvil:name" :value (:name component)}]
                      [])
         prop-attrs (mapv (fn [[k v]]
                            {:name (str "anvil:prop:" (name k))
                             :value (escape-prop-value v)})
                          (remove (fn [[k v]]
                                    (or (= k :html)
                                        (= k :classes)
                                        (= k :style)
                                        (and (= k :visible) (= true v))))
                                  (:properties component)))
         event-attrs (mapv (fn [[k v]]
                             {:name (str "anvil:on:" (name k))
                              :value (str "self." v)})
                           (:event_bindings component))
         binding-attrs (mapv (fn [{:keys [property code writeback]}]
                               {:name (str "anvil:" (if writeback "writeback:" "bind:") property)
                                :value code})
                             (:data_bindings component))
         layout-attrs (mapv (fn [[k v]]
                              {:name (str "anvil:container:" (name k))
                               :value (escape-prop-value v)})
                            ;; Generated fragment dropzones are emitted in the
                            ;; parsed model only; keep user-provided non-$dz_
                            ;; dropzones at top level.
                            (remove (fn [[k v]]
                                      (and (= k :dropzone)
                                           (or parent-is-fragment?
                                               (and (string? v)
                                                    (str/starts-with? v "$dz_")))))
                                    (:layout_properties component)))]
     (vec (concat name-attrs prop-attrs event-attrs binding-attrs layout-attrs)))))

(defn- serialize-html-component
  ([component context-or-slots] (serialize-html-component component context-or-slots false))
  ([component context-or-slots parent-is-fragment?]
   (let [context (ensure-serializer-context context-or-slots)
         html (normalize-fragment-html (or (get-in component [:properties :html]) ""))
         ;; Fill fragment dropzones without reparsing the fragment itself;
         ;; top-level serialization is responsible for any model sync.
         html (:html (fill-dropzones-and-append-remaining
                       html
                       (:components component)
                       context
                       {:type "container" :name (:name component)}))
         html (apply-root-html-attributes html
                                          (root-html-attributes (:properties component))
                                          (:indent-step context default-indent-step))
         html (ensure-dom-node-attribute html)]
     (add-attrs-to-root-element
       html
       (fragment-metadata-attrs component parent-is-fragment? (:preserve-generated-component-names? context))
       (:indent-step context default-indent-step)))))

(defn serialize-component
  ([component] (serialize-component component true))
  ([component include-dropzone?]
   (serialize-component-with-slots component nil include-dropzone?)))

(defn- slot-name-value [slot-name]
  (if (keyword? slot-name) (name slot-name) slot-name))

(defn- slot-attrs [slot-name slot include-dropzone?]
  (let [base (cond-> [{:name "name" :value (slot-name-value slot-name)}]
               (:one_component slot) (conj {:name "one-component" :value ""})
               (seq (:placeholder_text slot)) (conj {:name "placeholder" :value (:placeholder_text slot)}))
        layout-attrs (mapv (fn [[k v]]
                             {:name (str "container:" (name k))
                              :value (escape-prop-value v)})
                           (if include-dropzone?
                             (:set_layout_properties slot)
                             (dissoc (:set_layout_properties slot) :dropzone)))]
    (vec (concat base layout-attrs))))

(defn- serialize-slot
  ([slot-name slot] (serialize-slot slot-name slot true nil))
  ([slot-name slot include-dropzone?] (serialize-slot slot-name slot include-dropzone? nil))
  ([slot-name slot include-dropzone? context]
   (when-let [emitted-slot-names (:emitted-slot-names context)]
     (state-swap! emitted-slot-names conj (slot-name-value slot-name)))
   (render-element "anvil-slot" (slot-attrs slot-name slot include-dropzone?) "")))

(defn- child-items [components context target include-slot-dropzone?]
  (let [components (vec components)
        slot-items (vec (slots-for-target context target))
        component-count (count components)
        slot-count (count slot-items)
        result (mutable-list)]
    (loop [index 0
           slot-index 0]
      (if (> index component-count)
        (mutable-list-value result)
        (let [slot-index
              (loop [slot-index slot-index]
                (if (and (< slot-index slot-count)
                         (= index (:index (second (slot-items slot-index)))))
                  (let [[slot-name slot] (slot-items slot-index)]
                    (append! result (serialize-slot slot-name slot include-slot-dropzone? context))
                    (recur (inc slot-index)))
                  slot-index))]
          (when (< index component-count)
            (append! result (serialize-component-with-slots (components index) context true)))
          (recur (inc index) (long slot-index)))))))

(defn serialize-component-with-slots [component context-or-slots include-dropzone?]
  (let [context (ensure-serializer-context context-or-slots)]
    (if (= "HtmlComponent" (:type component))
      ;; Fragment components serialize their stored HTML directly; non-fragment
      ;; components emit anvil-component tags with child components/slots.
      (serialize-html-component component context)
      (let [children (child-items (:components component) context {:type "container" :name (:name component)} true)
            children-html (when (seq children)
                            (str "\n" (indent-lines (str/join "\n" children)
                                                   (:indent-step context default-indent-step)) "\n"))]
        (render-element "anvil-component"
                        (component-attrs component
                                         true
                                         include-dropzone?
                                         (:preserve-generated-component-names? context))
                        children-html)))))

(defn- form-container-attrs [container]
  (let [base [{:name "container" :value (:type container)}]
        prop-attrs (mapv (fn [[k v]]
                           {:name (str "prop:" (name k))
                            :value (escape-prop-value v)})
                         (:properties container))
        event-attrs (mapv (fn [[k v]]
                            {:name (str "on:" (name k))
                             :value (str "self." v)})
                          (:event_bindings container))
        binding-attrs (mapv (fn [{:keys [property code writeback]}]
                              {:name (str (if writeback "writeback:" "bind:") property)
                               :value code})
                            (:data_bindings container))
        layout-attrs (mapv (fn [[k v]]
                             {:name (str "container:" (name k))
                              :value (escape-prop-value v)})
                           (:layout_properties container))]
    (vec (concat base prop-attrs event-attrs binding-attrs layout-attrs))))

(defn- layout-attrs [layout]
  (let [base [{:name "layout" :value (:type layout)}]
        prop-attrs (mapv (fn [[k v]]
                           {:name (str "prop:" (name k))
                            :value (escape-prop-value v)})
                         (:properties layout))
        form-event-attrs (mapv (fn [[k v]]
                                 {:name (str "on:" (name k))
                                  :value (str "self." v)})
                               (:form_event_bindings layout))
        layout-event-attrs (mapv (fn [[k v]]
                                   {:name (str "on:layout:" (name k))
                                    :value (str "self." v)})
                                 (:event_bindings layout))
        binding-attrs (mapv (fn [{:keys [property code writeback]}]
                              {:name (str (if writeback "writeback:" "bind:") property)
                               :value code})
                            (:data_bindings layout))]
    (vec (concat base prop-attrs form-event-attrs layout-event-attrs binding-attrs))))

(defn- indent-lines [value indent]
  (let [prefix (if (number? indent)
                 (apply str (repeat indent " "))
                 indent)]
    (str/join "\n" (map #(str prefix %) (str/split (or value "") #"\n" -1)))))

(defn- serialize-root-slot [slot-name slot context]
  (serialize-slot slot-name slot false context))

(defn- root-container-children [parsed context]
  (let [components (vec (:components parsed))
        slots (vec (slots-for-target context {:type "container" :name ""}))
        component-count (count components)
        slot-count (count slots)
        result (mutable-list)]
    (loop [index 0
           slot-index 0]
      (if (> index component-count)
        (mutable-list-value result)
        (let [slot-index
              (loop [slot-index slot-index]
                (if (and (< slot-index slot-count)
                         (= index (:index (second (slots slot-index)))))
                  (let [[slot-name slot] (slots slot-index)]
                    (append! result (serialize-root-slot slot-name slot context))
                    (recur (inc slot-index)))
                  slot-index))]
          (when (< index component-count)
            (append! result (serialize-component-with-slots (components index) context true)))
          (recur (inc index) (long slot-index)))))))

(defn- container-metadata-attrs [container]
  (fragment-metadata-attrs {:name nil
                            :properties (:properties container)
                            :event_bindings (:event_bindings container)
                            :data_bindings (:data_bindings container)
                            :layout_properties (:layout_properties container)}))

(defn- single-root-element? [html]
  (let [fragment (raw/parse-fragment html)]
    (some? (get-single-root-element (raw/child-nodes fragment)))))

(defn- parser-options [options]
  (option-value options :parserOptions :parser-options))

(defn- allow-reparse? [options]
  (true? (option-value options :allowReparse :allow-reparse)))

(defn- preserve-generated-component-names? [options]
  (true? (:preserve-generated-component-names options)))

(defn- reparse-initial-options [options]
  ;; The first pass can be parser-facing when allowReparse is enabled, so emit
  ;; generated component names there to preserve internal YAML identities.
  (if (allow-reparse? options)
    (assoc options :preserve-generated-component-names true)
    options))

(defn- clean-serialize-options [options]
  ;; Public serialized HTML must not expose generated $component_* names after
  ;; a successful structural reparse.
  (assoc options
         :allowReparse false
         :allow-reparse false
         :preserve-generated-component-names false))

(defn- strip-generated-component-name-attrs [html]
  (str/replace html #"\s(?:name|anvil:name)=\"\$component_[0-9]+\"" ""))

(defn- extract-root-styling? [options]
  (true? (option-value (parser-options options) :extractRootStyling :extract-root-styling)))

(defn- without-root-styling [container]
  (update container :properties dissoc :classes :style))

(defn- add-container-metadata [html container context]
  (let [attrs (container-metadata-attrs container)
        root-attrs (root-html-attributes (:properties container))
        html (if (empty? attrs)
               html
               (let [trimmed (str/trim html)]
                 ;; Container-level HtmlComponent metadata goes on the single
                 ;; root when possible; mixed root content is wrapped so
                 ;; metadata has a host node.
                 (cond
                   (empty? trimmed)
                   (render-element "div" attrs "")

                   (single-root-element? trimmed)
                   (add-attrs-to-root-element html attrs (:indent-step context default-indent-step))

                   :else
                   (render-element "div" attrs (str "\n" html "\n")))))]
    (apply-root-html-attributes html root-attrs (:indent-step context default-indent-step))))

(declare serialize-form-container serialize-form-layout)

(defn- serialize-form-container-initial-result
  ([parsed] (serialize-form-container-initial-result parsed nil))
  ([parsed options]
   (let [context (create-serializer-context parsed options)]
     (if (not= "HtmlComponent" (get-in parsed [:container :type]))
       {:html (let [children (root-container-children parsed context)]
                (render-element "anvil-form"
                                (form-container-attrs (:container parsed))
                                (if (seq children)
                                  (str "\n" (indent-lines (str/join "\n" children)
                                                         (:indent-step context default-indent-step)) "\n")
                                  "")))
        :needs-reparse? false
        :appended? false
        :had-single-root-before-append? false}
       (let [{:keys [html appended? needs-reparse? had-single-root-before-append?]}
             (fill-dropzones-and-append-remaining
               (or (get-in parsed [:container :properties :html]) "")
               (:components parsed)
               context
               {:type "container" :name ""})
             ;; Remaining components get appended beside the old root. If the
             ;; root styling was only mirrored from that old single root, do not
             ;; add it again as wrapper metadata before the reparse sync.
             container (if (and (allow-reparse? options)
                                (extract-root-styling? options)
                                appended?
                                had-single-root-before-append?)
                         (without-root-styling (:container parsed))
                         (:container parsed))]
         {:html (add-container-metadata (normalize-fragment-html html) container context)
          :needs-reparse? (boolean needs-reparse?)
          :appended? appended?
          :had-single-root-before-append? had-single-root-before-append?})))))

(defn- merge-reparsed-container-metadata [reparsed original-container appended? had-single-root-before-append?]
  (if-not original-container
    reparsed
    (let [other-props (dissoc (:properties original-container) :html)
          other-props (if (and appended? had-single-root-before-append?)
                        (dissoc other-props :classes :style)
                        other-props)
          container (cond-> (:container reparsed)
                      (seq other-props)
                      (update :properties merge other-props)

                      (seq (:event_bindings original-container))
                      (assoc :event_bindings (:event_bindings original-container))

                      (seq (:data_bindings original-container))
                      (assoc :data_bindings (:data_bindings original-container)))]
      (assoc reparsed :container container))))

(defn serialize-form-container-result
  ([parsed] (serialize-form-container-result parsed nil))
  ([parsed options]
   (let [initial-options (reparse-initial-options options)
         {:keys [html needs-reparse? appended? had-single-root-before-append?] :as initial}
         (serialize-form-container-initial-result parsed initial-options)
         clean-initial #(assoc initial
                               :html (strip-generated-component-name-attrs html)
                               :structural-html-changed? false)]
     (if (and (allow-reparse? options) needs-reparse?)
       (try
         (let [reparsed (parser/parse-serialized-html html (parser-options options))]
           (if (:container reparsed)
             (let [reparsed (merge-reparsed-container-metadata
                              reparsed
                              (:container parsed)
                              appended?
                              had-single-root-before-append?)
                   serialized (serialize-form-container
                                reparsed
                                (clean-serialize-options options))]
               {:html serialized
                :structural-html-changed? true
                :reparsed reparsed})
             (clean-initial)))
         (catch #?(:clj Exception :cljs :default) _
           (clean-initial)))
       (if (preserve-generated-component-names? initial-options)
         (clean-initial)
         (assoc initial :structural-html-changed? false))))))

(defn serialize-form-container
  ([parsed] (serialize-form-container parsed nil))
  ([parsed options]
   (:html (serialize-form-container-result parsed options))))

(defn- serialize-form-layout-initial-result
  ([parsed] (serialize-form-layout-initial-result parsed nil))
  ([parsed options]
  (let [layout (:layout parsed)
        context (create-serializer-context parsed options)
        indent-step (:indent-step context default-indent-step)
        child-indent (str indent-step indent-step)
        slots (:slots parsed)
        keep-block? (fn [slot-name components]
                      (or (not (str/starts-with? slot-name "$unknown-slot-"))
                          (seq components)
                          (some (fn [[_ slot]]
                                  (and (= "slot" (get-in slot [:target :type]))
                                       (= slot-name (get-in slot [:target :name]))))
                                slots)))
        block-html (str/join
                     "\n"
                     (keep (fn [[slot components]]
                             (let [slot-name (slot-name-value slot)
                                   target {:type "slot" :name slot-name}
                                   children (child-items components context target true)]
                               (when (keep-block? slot-name components)
                                 (str indent-step
                                      (render-element "anvil-block"
                                                      [{:name "slot" :value slot-name}]
                                                      (if (seq children)
                                                        (str "\n" (indent-lines (str/join "\n" children) child-indent) "\n" indent-step)
                                                        ""))))))
                           (sorted-layout-block-entries (:components_by_slot parsed) slots)))
        html (render-element "anvil-form"
                             (layout-attrs layout)
                             (if (seq block-html)
                               (str "\n" block-html "\n")
                               ""))]
    {:html html
     :needs-reparse? @(:needs-reparse context)})))

(defn serialize-form-layout-result
  ([parsed] (serialize-form-layout-result parsed nil))
  ([parsed options]
   (let [initial-options (reparse-initial-options options)
         {:keys [html needs-reparse?] :as initial}
         (serialize-form-layout-initial-result parsed initial-options)
         clean-initial #(assoc initial
                               :html (strip-generated-component-name-attrs html)
                               :structural-html-changed? false)]
     (if (and (allow-reparse? options) needs-reparse?)
       (try
         (let [reparsed (parser/parse-serialized-html html (parser-options options))]
           (if (:layout reparsed)
             (let [serialized (serialize-form-layout
                                reparsed
                                (clean-serialize-options options))]
               {:html serialized
                :structural-html-changed? true
                :reparsed reparsed})
             (clean-initial)))
         (catch #?(:clj Exception :cljs :default) _
           (clean-initial)))
       (if (preserve-generated-component-names? initial-options)
         (clean-initial)
         (assoc initial :structural-html-changed? false))))))

(defn serialize-form-layout
  ([parsed] (serialize-form-layout parsed nil))
  ([parsed options]
   (:html (serialize-form-layout-result parsed options))))
