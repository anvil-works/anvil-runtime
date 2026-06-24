(ns anvil.html-form.raw
  #?(:cljs (:require ["parse5" :as parse5]))
  #?(:clj (:import (org.jsoup Jsoup)
                   (org.jsoup.nodes Attribute Comment Element Node TextNode))))

#?(:clj
   (defn parse-fragment
     ([html] (parse-fragment html nil))
     ([html _options]
      (.body (Jsoup/parseBodyFragment (or html "") "")))))

#?(:cljs
   (defn parse-fragment
     ([html] (parse-fragment html nil))
     ([html options]
      (parse5/parseFragment (or html "")
                            (clj->js (if (:source-locations? options)
                                       {:sourceCodeLocationInfo true}
                                       {}))))))

(defn child-nodes [node]
  #?(:clj (vec (.childNodes ^Node node))
     :cljs (or (.-childNodes node) #js [])))

(defn element? [node]
  #?(:clj (instance? Element node)
     :cljs (string? (.-tagName node))))

(defn node-name [node]
  #?(:clj (cond
            (instance? TextNode node) "#text"
            (instance? Comment node) "#comment"
            :else (.nodeName ^Node node))
     :cljs (.-nodeName node)))

(defn tag-name [element]
  #?(:clj (.tagName ^Element element)
     :cljs (.-tagName element)))

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
  #?(:clj (.getWholeText ^TextNode node)
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
