(defproject anvil-migrator-core "latest"

  :dependencies [[org.clojure/clojure "1.8.0"]
                 [org.clojure/data.json "0.2.5"]
                 [org.clojure/java.jdbc "0.7.10"]
                 [org.postgresql/postgresql "42.2.8"]
                 [digest "1.4.4"]
                 [slingshot "0.12.2"]]
  :aot :all
  :omit-source true)
