(ns anvil.html-form.raw
  #?(:cljs (:require ["parse5" :as parse5]))
  #?(:clj (:import (org.jsoup.nodes Attribute Comment DataNode Document Element Node TextNode)
                   (org.jsoup.parser Parser Tag))))

#?(:clj
   (defn parse-fragment
     ([html] (parse-fragment html nil))
     ([html _options]
      (let [parser (Parser/htmlParser)
            body (.body (Document/createShell ""))]
        ;; SVG script uses normal foreign-content parsing, including entity
        ;; decoding. jsoup defaults to HTML-style raw text for this tag.
        (.clear (.get (.tagSet parser) "script" Parser/NamespaceSvg) Tag/Data)
        (.appendChildren body (.parseFragmentInput parser (or html "") body ""))
        body))))

#?(:cljs
   (defn parse-fragment
     ([html] (parse-fragment html nil))
     ([html options]
      ;; Match HtmlComponent's innerHTML parsing in a scripting-enabled document.
      (parse5/parseFragment (or html "")
                            (clj->js (cond-> {:scriptingEnabled true}
                                       (:source-locations? options)
                                       (assoc :sourceCodeLocationInfo true)))))))

(defn child-nodes [node]
  #?(:clj (vec (.childNodes ^Node node))
     :cljs (or (some-> node .-content .-childNodes)
               (.-childNodes node)
               #js [])))

(defn element? [node]
  #?(:clj (instance? Element node)
     :cljs (string? (.-tagName node))))

(defn node-name [node]
  #?(:clj (cond
            (or (instance? TextNode node) (instance? DataNode node)) "#text"
            (instance? Comment node) "#comment"
            :else (.nodeName ^Node node))
     :cljs (.-nodeName node)))

(defn tag-name [element]
  #?(:clj (.tagName ^Element element)
     :cljs (.-tagName element)))

(defn inert-element? [node]
  (and (element? node)
       (contains? #{"template" "noscript"} (tag-name node))
       (= "http://www.w3.org/1999/xhtml"
          #?(:clj (.namespace (.tag ^Element node)) :cljs (.-namespaceURI node)))))

(defn active-child-nodes [node]
  ;; Neither template contents nor noscript fallback markup belongs to the live
  ;; DOM. jsoup parses noscript children even though parse5 keeps them as text.
  (when-not (inert-element? node)
    (child-nodes node)))

(defn attrs [element]
  #?(:clj (mapv (fn [^Attribute attr]
                  {:name (.getKey attr)
                   :value (.getValue attr)})
                (.attributes ^Element element))
     :cljs (or (.-attrs element) #js [])))

(defn attr-name [attr]
  #?(:clj (:name attr)
     :cljs (if (map? attr) (:name attr) (.-name attr))))

(defn attr-value [attr]
  #?(:clj (:value attr)
     :cljs (if (map? attr) (:value attr) (.-value attr))))

(defn text-value [node]
  #?(:clj (if (instance? DataNode node)
            (.getWholeData ^DataNode node)
            (.getWholeText ^TextNode node))
     :cljs (.-value node)))

(defn comment-data [node]
  #?(:clj (.getData ^Comment node)
     :cljs (.-data node)))

(defn source-start-offset [element]
  #?(:clj nil
     :cljs (some-> element
                   .-sourceCodeLocation
                   .-startTag
                   .-startOffset)))

(defn attr-source-range [element attr-name]
  #?(:clj nil
     :cljs (when-let [attrs-location (some-> element
                                             .-sourceCodeLocation
                                             .-attrs)]
              (when-let [attr-location (aget attrs-location attr-name)]
                (let [from (.-startOffset attr-location)
                      to (.-endOffset attr-location)]
                  (when (and (some? from) (some? to))
                    {:from from
                     :to to}))))))

(defn raw-text-node? [node]
  ;; Raw-text rules belong to the HTML parent, not to the node representation:
  ;; jsoup uses DataNode for script/style, while parse5 uses ordinary text nodes.
  (let [parent #?(:clj (.parent ^Node node) :cljs (.-parentNode node))]
    (and (= "#text" (node-name node))
         (some? parent)
         (element? parent)
         (= "http://www.w3.org/1999/xhtml"
            #?(:clj (.namespace (.tag ^Element parent)) :cljs (.-namespaceURI parent)))
         (or (contains? #{"script" "style" "iframe" "xmp" "noembed" "noframes"} (tag-name parent))
             ;; jsoup parses noscript fallback HTML; its text nodes need normal
             ;; escaping when that opaque subtree is serialized again.
             #?(:clj false :cljs (= "noscript" (tag-name parent)))))))
