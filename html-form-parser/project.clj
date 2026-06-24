(defproject anvil-form-template-parser "0.2.0"
  :min-lein-version "2.8.1"
  :source-paths ["src"]
  :test-paths ["test"]
  :profiles {:bench {:source-paths ["scripts"]}
             :cljs {:dependencies [[org.clojure/clojurescript "1.12.42"]
                                    [thheller/shadow-cljs "3.2.1"]]}}
  :dependencies [[org.clojure/clojure "1.12.0"]
                 [org.clojure/data.json "0.2.5"]
                 [org.jsoup/jsoup "1.22.2"]
                 [clj-commons/clj-yaml "1.0.27"]])
