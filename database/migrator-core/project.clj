(defproject anvil-migrator-core "latest"

  :dependencies [[org.clojure/clojure "1.12.0"]
                 [org.clojure/data.json "0.2.5"]
                 [org.clojure/java.jdbc "0.7.10"]
                 [org.postgresql/postgresql "42.7.5"]
                 [digest "1.4.4"]
                 [org.clj-commons/slingshot "0.13.0"]]
  :aot :all
  :omit-source true)
