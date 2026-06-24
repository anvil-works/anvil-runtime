(ns anvil.html-form.shared
  (:require [anvil.html-form.raw :as raw]
            [clojure.string :as str]
            #?(:clj [clojure.data.json :as json])))

(def bind-prefix "bind:")
(def writeback-prefix "writeback:")
(def dropzone-counter-offset 0x7f3a2b1c)
(def base36-power-6 2176782336)
(def uint32-modulus 4294967296.0)

(def container-types
  #{"LinearPanel" "ColumnPanel" "FlowPanel" "GridPanel" "HtmlComponent"
    "RichText" "RepeatingPanel" "Card"})

(def void-elements
  #{"area" "base" "br" "col" "embed" "hr" "img" "input" "link" "meta"
    "param" "source" "track" "wbr"})

(defn state [value]
  #?(:clj (volatile! value)
     :cljs (volatile! value)))

(defn state-swap!
  ([state f]
   #?(:clj (vswap! state f)
      :cljs (vswap! state f)))
  ([state f x]
   #?(:clj (vswap! state f x)
      :cljs (vswap! state f x)))
  ([state f x y]
   #?(:clj (vswap! state f x y)
      :cljs (vswap! state f x y)))
  ([state f x y & args]
   #?(:clj (vreset! state (apply f @state x y args))
      :cljs (vreset! state (apply f @state x y args)))))

(defn state-reset! [state value]
  #?(:clj (vreset! state value)
     :cljs (vreset! state value)))

(defn mutable-list []
  #?(:clj (state [])
     :cljs (array)))

(defn append! [values value]
  #?(:clj (state-swap! values conj value)
     :cljs (.push values value))
  nil)

(defn append-all! [values more-values]
  #?(:clj (state-swap! values into more-values)
     :cljs (doseq [value more-values]
             (.push values value)))
  nil)

(defn mutable-list-value [values]
  #?(:clj @values
     :cljs values))

(defn string-list-value [values]
  #?(:clj (apply str @values)
     :cljs (.join values "")))

(defonce ^:private default-dropzone-name-generator-factory (atom nil))

(defn unsigned-shift [value]
  #?(:clj (let [number (double value)]
            (if (or (Double/isNaN number)
                    (Double/isInfinite number)
                    (zero? number))
              0
              (long (mod (if (neg? number)
                           (Math/ceil number)
                           (Math/floor number))
                         uint32-modulus))))
     :cljs (unsigned-bit-shift-right value 0)))

(defn set-default-dropzone-name-generator [factory]
  (reset! default-dropzone-name-generator-factory factory)
  nil)

;; Fast string hash used once per parse to seed deterministic dropzone names.
(defn html-hash-string [s]
  (let [^String value (or s "")]
    (loop [index 0
           hash 0]
      (if (= index (count value))
        (unsigned-shift hash)
        (let [code #?(:clj (int (.charAt value index))
                      :cljs (.charCodeAt value index))
              next-hash #?(:clj (unchecked-int
                                  (unchecked-add-int
                                    (unchecked-subtract-int
                                      (unchecked-int (unchecked-multiply-int hash 32))
                                      hash)
                                    code))
                           :cljs (bit-or (+ (- (bit-shift-left hash 5) hash) code) 0))]
          (recur (inc index) next-hash))))))

;; Convert a numeric hash into the short base36 suffix used by generated
;; dropzone names.
(defn hash-to-base36
  ([value] (hash-to-base36 value 6))
  ([value length]
   #?(:clj
      (let [chars "0123456789abcdefghijklmnopqrstuvwxyz"
            ;; Match JavaScript Number multiplication followed by >>> 0, not
            ;; exact integer multiplication. Generated CLJS and existing TS use
            ;; JS number semantics here, and dropzone names must match between
            ;; browser and JVM parses.
            initial (long (mod (unsigned-shift (* (double value) 2654435761.0))
                               base36-power-6))]
        (loop [index (dec length)
               hash initial
               result (vec (repeat length "0"))]
          (if (neg? index)
            (apply str result)
            (recur (dec index)
                   (quot hash 36)
                   (assoc result index (str (.charAt chars (mod hash 36))))))))
      :cljs
      (let [chars "0123456789abcdefghijklmnopqrstuvwxyz"
            initial (mod (unsigned-shift (* value 2654435761)) base36-power-6)
            result (make-array length)]
        (loop [index (dec length)
               hash initial]
          (if (neg? index)
            (.join result "")
            (do
              (aset result index (.charAt chars (mod hash 36)))
              (recur (dec index) (quot hash 36)))))))))

(defn create-hash-based-dropzone-name-generator
  ([] (create-hash-based-dropzone-name-generator nil))
  ([html-seed]
   ;; HTML seed makes names deterministic for the same input and different
   ;; when the input structure changes, which avoids colliding with old
   ;; generated dropzones.
   (let [counter (state 0)
         seed (or html-seed 0)]
     (fn []
       (let [current @counter
             _ (state-swap! counter inc)
             combined (unsigned-shift (+ seed current dropzone-counter-offset))]
         (str "$dz_" (hash-to-base36 combined)))))))

(defn create-deterministic-dropzone-name-generator
  ([] (create-deterministic-dropzone-name-generator 0))
  ([seed]
   (let [counter (state (unsigned-shift seed))]
     (fn []
       (str "$dz_" (let [current @counter]
                     (state-swap! counter inc)
                     current))))))

(defn call-factory [factory]
  #?(:clj (factory)
     :cljs (.call factory nil)))

(defn call-generator [generator]
  #?(:clj (generator)
     :cljs (.call generator nil)))

(defn default-dropzone-name-generator [html-seed]
  (if-let [factory @default-dropzone-name-generator-factory]
    (call-factory factory)
    (create-hash-based-dropzone-name-generator html-seed)))

(defn- dom-node-promotion-mode [options]
  (let [mode (get options :domNodePromotion (get options :dom-node-promotion))]
    (cond
      (or (= mode "all") (= mode :all)) :all
      (or (= mode "annotated") (= mode :annotated)) :annotated
      :else :metadata)))

(defn create-context [options deterministic-scope-ids? html]
  ;; Seed the default generator from the full HTML so parse results are stable
  ;; without requiring callers to provide their own generator.
  (let [html-seed (when (seq html) (html-hash-string html))
        generator (or (:dropzoneNameGenerator options)
                      (:dropzone-name-generator options)
                      (default-dropzone-name-generator html-seed))
        promotion-mode (dom-node-promotion-mode options)]
    {:slots (state {})
     :component-counts (state {})
     :anonymous-component-counter (state 0)
     :used-component-names (state (set (:reserved-component-names options)))
     :anonymous-slot-counter (state 0)
     :slot-state (state {})
     :dropzone-name-generator generator
     :slot-order (state [])
     :dropzone-counters (state {})
     :dropzone-hashes (state {})
     :deterministic-scope-ids deterministic-scope-ids?
     :normalize-html (not= false (get options :normalizeHtml (get options :normalize-html true)))
     :extract-root-styling (true? (get options :extractRootStyling (get options :extract-root-styling false)))
     :dom-node-promotion promotion-mode
     :promote-dom-nodes (contains? #{:annotated :all} promotion-mode)
     :promote-all-dom-nodes (= :all promotion-mode)
     :selection-name-maps (or (:selectionNameMaps options) (:selection-name-maps options))}))

(defn is-generated-dropzone-name? [value]
  (boolean (and (string? value)
                (re-matches #"\$dz_[a-z0-9]+" value))))

(defn lower-tag-name [element]
  #?(:clj (str/lower-case (raw/tag-name element))
     :cljs (raw/tag-name element)))

(defn attr [element name]
  (some (fn [attribute]
          (when (= (raw/attr-name attribute) name)
            (raw/attr-value attribute)))
        (raw/attrs element)))

(defn strip-anvil-prefix [value]
  (if (str/starts-with? value "anvil.")
    (subs value 6)
    value))

(defn strip-self-prefix [value]
  (let [trimmed (str/trim (or value ""))]
    (if (str/starts-with? trimmed "self.")
      (subs trimmed 5)
      trimmed)))

(defn anvil-slot? [element] (= "anvil-slot" (lower-tag-name element)))
(defn anvil-dropzone? [element] (= "anvil-dropzone" (lower-tag-name element)))
(defn anvil-component? [element] (= "anvil-component" (lower-tag-name element)))
(defn anvil-block? [element] (= "anvil-block" (lower-tag-name element)))
(defn anvil-form? [element] (= "anvil-form" (lower-tag-name element)))

(defn whitespace-text? [node]
  (and (= "#text" (raw/node-name node))
       (boolean (re-matches #"\s*" (or (raw/text-value node) "")))))

(defn whitespace-or-comment? [node]
  (or (= "#comment" (raw/node-name node))
      (whitespace-text? node)))

(defn has-renderable-content? [nodes]
  (some (complement whitespace-or-comment?) nodes))

(defn get-single-root-element [nodes]
  (loop [remaining nodes
         root nil]
    (if (empty? remaining)
      root
      (let [node (first remaining)]
        (cond
          (whitespace-or-comment? node)
          (recur (rest remaining) root)

          (raw/element? node)
          (if root
            nil
            (recur (rest remaining) node))

          :else
          nil)))))

(defn count-leading-whitespace [value]
  (count (or (second (re-find #"^([ \t]*)" value)) "")))

(defn normalize-newlines [value]
  (str/replace (or value "") #"\r\n?" "\n"))

(defn first-nonblank-line-index [lines]
  (let [line-count (count lines)]
    (loop [index 0]
      (if (and (< index line-count)
               (empty? (str/trim (lines index))))
        (recur (inc index))
        index))))

(defn last-nonblank-line-index [lines start]
  (loop [index (dec (count lines))]
    (if (and (>= index start)
             (empty? (str/trim (lines index))))
      (recur (dec index))
      index)))

(defn remove-indent-from-range [lines start end indent]
  (reduce (fn [acc index]
            (let [line (acc index)]
              (if (empty? (str/trim line))
                (assoc acc index "")
                (let [removal (min indent (count-leading-whitespace line))]
                  (assoc acc index (subs line removal))))))
          lines
          (range start (inc end))))

(defn minimum-leading-indent [lines start end]
  (reduce (fn [minimum index]
            (let [line (lines index)]
              (if (empty? line)
                minimum
                (let [leading (count-leading-whitespace line)]
                  (if (some? minimum)
                    (min minimum leading)
                    leading)))))
          nil
          (range start (inc end))))

(defn normalize-fragment-html [html]
  (if (empty? html)
    ""
    (let [lines (vec (str/split (normalize-newlines html) #"\n" -1))
          start (first-nonblank-line-index lines)
          end (last-nonblank-line-index lines start)]
      (if (> start end)
        ""
        (let [first-indent (count-leading-whitespace (lines start))
              baseline (remove-indent-from-range lines start end first-indent)
              additional-indent (minimum-leading-indent baseline (inc start) end)
              trimmed (if (and additional-indent (pos? additional-indent))
                        (remove-indent-from-range baseline (inc start) end additional-indent)
                        baseline)]
          (str/join "\n" (subvec trimmed start (inc end))))))))

(defn escape-double [value]
  (-> (str value)
      (str/replace "&" "&amp;")
      (str/replace "\"" "&quot;")))

(defn escape-single [value]
  (-> (str value)
      (str/replace "&" "&amp;")
      (str/replace "'" "&#39;")))

(defn escape-html-text [value]
  (str/escape (str value) {\& "&amp;" \< "&lt;" \> "&gt;"}))

(defn format-attribute [name value]
  (let [string-value (str value)]
    (if (= "" string-value)
      (if (or (str/starts-with? name "anvil:prop:")
              (str/starts-with? name "prop:")
              (str/starts-with? name "anvil:container:")
              (str/starts-with? name "container:"))
        (str name "=\"\"")
        name)
      (if-not (str/includes? string-value "\"")
        (str name "=\"" (escape-double string-value) "\"")
        (if-not (str/includes? string-value "'")
          (str name "='" (escape-single string-value) "'")
          (str name "=\"" (escape-double string-value) "\""))))))

(defn render-element [tag-name attrs inner-html]
  (let [attr-string (str/join " " (map (fn [attribute]
                                         (format-attribute (raw/attr-name attribute)
                                                           (or (raw/attr-value attribute) "")))
                                       attrs))
        open (if (seq attr-string)
               (str "<" tag-name " " attr-string)
               (str "<" tag-name))]
    (if (contains? void-elements tag-name)
      (str open " />")
      (str open ">" inner-html "</" tag-name ">"))))

(defn serialize-node [node]
  (cond
    (= "#text" (raw/node-name node))
    (escape-html-text (raw/text-value node))

    (= "#comment" (raw/node-name node))
    (str "<!--" (raw/comment-data node) "-->")

    (raw/element? node)
    (render-element (raw/tag-name node)
                    (raw/attrs node)
                    (apply str (map serialize-node (raw/child-nodes node))))

    :else
    ""))

(defn without-attrs [attrs names]
  (let [names (set names)]
    (filterv (fn [attribute]
               (not (contains? names (raw/attr-name attribute))))
             attrs)))

(defn with-attr [attrs name value]
  (conj (without-attrs attrs [name]) {:name name :value value}))

(defn json-literal? [value]
  (let [trimmed (str/trim (or value ""))]
    (when (seq trimmed)
      (let [first-code #?(:clj (int (.charAt trimmed 0))
                          :cljs (.charCodeAt trimmed 0))]
        (or (= first-code 123)
            (= first-code 91)
            (= first-code 34)
            (= first-code 45)
            (= first-code 116)
            (= first-code 102)
            (= first-code 110)
            (<= 48 first-code 57))))))

(defn json-parseable? [value]
  (try
    #?(:clj (json/read-str value)
       :cljs (js/JSON.parse value))
    true
    (catch #?(:clj Exception :cljs :default) _
      false)))

(defn parse-attribute-value [value]
  ;; Match the TS parser's permissive attribute handling: JSON-looking values
  ;; become structured values only when parsing succeeds; everything else stays
  ;; as the original string.
  (if-not (json-literal? value)
    value
    (try
      #?(:clj (json/read-str value)
         :cljs (js->clj (js/JSON.parse value)))
      (catch #?(:clj Exception :cljs :default) _
        value))))

(defn yaml-key [value]
  #?(:clj (keyword value)
     :cljs value))

(defn- indent-fragment-content [content indent]
  (str/join "\n"
            (map (fn [line]
                   (if (empty? line) "" (str indent line)))
                 (str/split (or content "") #"\n" -1))))

(defn- render-node-with-added-attrs [node attrs]
  (let [node-attrs (reduce (fn [current attr]
                             (with-attr current
                               (raw/attr-name attr)
                               (or (raw/attr-value attr) "")))
                           (raw/attrs node)
                           attrs)]
    (render-element (raw/tag-name node)
                    node-attrs
                    (apply str (map serialize-node (raw/child-nodes node))))))

(defn add-attrs-to-root-element
  ([html attrs] (add-attrs-to-root-element html attrs "    "))
  ([html attrs indent]
   ;; Fragment metadata is written onto the existing root element when possible,
   ;; preserving tags like button/input instead of wrapping unnecessarily.
   (if (or (empty? attrs) (not (seq (str/trim (or html "")))))
     html
     (let [fragment (raw/parse-fragment html)
           nodes (raw/child-nodes fragment)
           root (get-single-root-element nodes)]
       (if-not root
         (render-element "div" attrs (str "\n" (indent-fragment-content (str/trim html) indent) "\n"))
         (apply str
                (map #(if (identical? % root)
                        (render-node-with-added-attrs % attrs)
                        (serialize-node %))
                     nodes)))))))

(defn ensure-dom-node-attribute [html]
  ;; anvil:on-dom handlers require anvil:dom-node so the designer can locate
  ;; the underlying DOM node; add it only when absent.
  (if (or (str/includes? html "anvil:dom-node")
          (not (str/includes? html "anvil:on-dom:")))
    html
    (add-attrs-to-root-element html [{:name "anvil:dom-node" :value ""}])))
