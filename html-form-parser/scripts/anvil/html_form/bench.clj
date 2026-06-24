(ns anvil.html-form.bench
  (:require [anvil.html-form.core :as parser]
            [clojure.string :as str]))

(def promotion-options
  {:none {}
   :annotated {:dom-node-promotion "annotated"}
   :all {:dom-node-promotion "all"}})

(def promotion-modes [:none :annotated :all])
(def warmup-runs 1)
(def measured-runs 5)

(defn- make-rows
  ([count] (make-rows count {}))
  ([count {:keys [dom-node-every]}]
   (apply str
          (for [index (range count)]
            (let [slot (if (zero? (mod index 20)) (str "<anvil-slot name=\"slot_" index "\"></anvil-slot>") "")
                  component (if (zero? (mod index 10))
                              (str "<anvil-component type=\"Button\" name=\"button_" index
                                   "\" prop:text=\"Action " index "\"></anvil-component>")
                              "")
                  has-dom-node? (and dom-node-every (zero? (mod index dom-node-every)))
                  section-attrs (if has-dom-node?
                                  (str " class=\"bench-row row-" index "\" anvil:dom-node=\"row_" index "\"")
                                  (str " class=\"bench-row row-" index "\""))
                  button-attrs (if has-dom-node?
                                 (str " type=\"button\" anvil:dom-node=\"local_button_" index "\"")
                                 " type=\"button\"")]
              (str "\n"
                   "            <section" section-attrs ">\n"
                   "                <header>\n"
                   "                    <h2>Item " index "</h2>\n"
                   "                    <p>Status <strong>" (if (zero? (mod index 3)) "active" "idle") "</strong></p>\n"
                   "                </header>\n"
                   "                <div class=\"content\">\n"
                   "                    <article>\n"
                   "                        <span class=\"label\">Name</span>\n"
                   "                        <span class=\"value\">Bench item " index "</span>\n"
                   "                    </article>\n"
                   "                    <nav>\n"
                   "                        <a href=\"#" index "\">Inspect</a>\n"
                   "                        <button" button-attrs ">Local button " index "</button>\n"
                   "                    </nav>\n"
                   "                    " component "\n"
                   "                    " slot "\n"
                   "                </div>\n"
                   "            </section>"))))))

(defn- make-anvil-components [count]
  (apply str
         (for [index (range count)]
           (let [type (case (mod index 3) 0 "Button" 1 "Label" "TextBox")]
             (str "<anvil-component type=\"" type "\" name=\"component_" index
                  "\" prop:text=\"Component " index "\"></anvil-component>")))))

(def raw-cases
  [{:name "small form"
    :html (str "<main class=\"bench small\">" (make-rows 4) "</main>")
    :kind :container}
   {:name "small dom-node form"
    :html (str "<main class=\"bench small annotated\">" (make-rows 4 {:dom-node-every 1}) "</main>")
    :kind :container}
   {:name "small component-only form"
    :html (make-anvil-components 8)
    :kind :container}
   {:name "medium form"
    :html (str "<main class=\"bench medium\">" (make-rows 40) "</main>")
    :kind :container}
   {:name "medium dom-node form"
    :html (str "<main class=\"bench medium annotated\">" (make-rows 40 {:dom-node-every 4}) "</main>")
    :kind :container}
   {:name "medium component-only form"
    :html (make-anvil-components 80)
    :kind :container}
   {:name "large mixed form"
    :html (str "<main class=\"bench large annotated\">" (make-rows 80 {:dom-node-every 10}) "</main>")
    :kind :container}])

(defn- canonicalize-case [test-case]
  (if (= (:kind test-case) :layout)
    (let [parsed (parser/parse-layout-form (:html test-case) (:none promotion-options))]
      (assoc test-case :html (parser/serialize-form-layout parsed)))
    (let [parsed (parser/parse-container-form (:html test-case) "HtmlComponent" (:none promotion-options))]
      (assoc test-case :html (parser/serialize-form-container parsed)))))

(def cases (mapv canonicalize-case raw-cases))

(defn- percentile [values p]
  (let [sorted (vec (sort values))
        index (min (dec (count sorted)) (long (Math/floor (* (dec (count sorted)) p))))]
    (get sorted index 0)))

(defn- median [values]
  (percentile values 0.5))

(defn- component-stats
  ([components] (component-stats components 1))
  ([components depth]
   (reduce
    (fn [stats component]
      (let [children (:components component)
            child-stats (component-stats children (inc depth))]
        {:component-count (+ (:component-count stats) 1 (:component-count child-stats))
         :html-component-count (+ (:html-component-count stats)
                                  (if (= (:type component) "HtmlComponent") 1 0)
                                  (:html-component-count child-stats))
         :max-depth (max (:max-depth stats) depth (:max-depth child-stats))}))
    {:component-count 0 :html-component-count 0 :max-depth 0}
    components)))

(defn- parsed-stats [parsed serialized-length]
  (let [roots (vec (concat (:components parsed)
                           (mapcat identity (vals (:components-by-slot parsed)))))
        stats (component-stats roots)
        root-is-html? (or (= (get-in parsed [:container :type]) "HtmlComponent")
                          (= (get-in parsed [:layout :type]) "HtmlComponent"))]
    {:component-count (+ (:component-count stats) (if root-is-html? 1 0))
     :html-component-count (+ (:html-component-count stats) (if root-is-html? 1 0))
     :max-depth (+ (:max-depth stats) (if (and root-is-html? (pos? (:max-depth stats))) 1 0))
     :serialized-length serialized-length}))

(defn- run-parser [test-case promotion-mode round-trip?]
  (let [options (promotion-options promotion-mode)]
    (if (= (:kind test-case) :layout)
      (let [parsed (parser/parse-layout-form (:html test-case) options)
            serialized (if round-trip? (parser/serialize-form-layout parsed) "")]
        (when (and round-trip? (not= serialized (:html test-case)))
          (throw (ex-info "Layout serialization did not match input HTML"
                          {:case (:name test-case) :promotion-mode promotion-mode})))
        (parsed-stats parsed (count serialized)))
      (let [parsed (parser/parse-container-form (:html test-case) "HtmlComponent" options)
            serialized (if round-trip? (parser/serialize-form-container parsed) "")]
        (when (and round-trip? (not= serialized (:html test-case)))
          (throw (ex-info "Container serialization did not match input HTML"
                          {:case (:name test-case) :promotion-mode promotion-mode})))
        (parsed-stats parsed (count serialized))))))

(defn- measure [test-case promotion-mode round-trip?]
  (dotimes [_ warmup-runs]
    (run-parser test-case promotion-mode round-trip?))
  (let [stats (atom nil)
        samples (vec
                 (for [_ (range measured-runs)]
                   (let [start (System/nanoTime)
                         result (run-parser test-case promotion-mode round-trip?)]
                     (reset! stats result)
                     (/ (double (- (System/nanoTime) start)) 1000000.0))))]
    {:samples samples :stats @stats}))

(defn- format-ms [value]
  (format "%.3fms" value))

(defn- print-table [title results]
  (let [columns [{:header "Case" :value :case-name}
                 {:header "Parse method" :value #(name (:promotion-mode %))}
                 {:header "Components" :value #(str (:component-count %))}
                 {:header "Median" :value #(format-ms (:median %))}
                 {:header "p95" :value #(format-ms (:p95 %))}
                 {:header "HtmlComponents" :value #(str (:html-component-count %))}
                 {:header "MaxDepth" :value #(str (:max-depth %))}
                 {:header "RoundTrip" :value #(if (= (:mode %) :parse+serialize) "same" "-")}]
        widths (mapv (fn [{:keys [header value]}]
                       (apply max (count header) (map #(count (str (value %))) results)))
                     columns)
        print-cells (fn [cells]
                      (println (str/join "  "
                                         (map-indexed (fn [index cell]
                                                        (format (str "%-" (widths index) "s") cell))
                                                      cells))))]
    (println)
    (println title)
    (print-cells (map :header columns))
    (print-cells (map #(apply str (repeat % "-")) widths))
    (doseq [result results]
      (print-cells (map #((:value %) result) columns)))))

(defn -main [& _args]
  (let [results (vec
                 (for [test-case cases
                       promotion-mode promotion-modes
                       round-trip? [false true]
                       :let [{:keys [samples stats]} (measure test-case promotion-mode round-trip?)]]
                   (merge {:case-name (:name test-case)
                           :mode (if round-trip? :parse+serialize :parse)
                           :promotion-mode promotion-mode
                           :median (median samples)
                           :p95 (percentile samples 0.95)}
                          stats)))]
    (println "HTML form parser JVM DOM promotion benchmark")
    (println (str measured-runs " measured samples after " warmup-runs " warmup runs."))
    (println "Parse + serialize rows assert exact serialized HTML equality with the input HTML.")
    (print-table "Parse only" (filter #(= (:mode %) :parse) results))
    (print-table "Parse + serialize" (filter #(= (:mode %) :parse+serialize) results))))
