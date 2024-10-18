(defproject anvil-app-server "latest"
  :min-lein-version "2.8.1"
  :repositories {"anvil" "file:../maven_repository"}
  :dependencies [[anvil-runtime "latest" :exclusions [[commons-io/commons-io]]]
                 [anvil-migrator-core "latest"]

                 [org.clojure/clojure "1.11.3"]
                 [compojure "1.6.1"]
                 [ring/ring-defaults "0.3.2"]
                 [ring/ring-core "1.8.0" :exclusions [[commons-io/commons-io]]]
                 [ring/ring-json "0.5.0"]

                 [crypto-random "1.1.0"]

                 [org.clojure/tools.logging "0.4.1"]
                 [org.slf4j/slf4j-reload4j "1.7.36"]
                 [ch.qos.reload4j/reload4j "1.2.19" :exclusions [javax.mail/mail javax.jms/jms com.sun.jdmk/jmxtools com.sun.jmx/jmxri]]
                 [clj-logging-config "1.9.12" :exclusions [log4j]]

                 [org.subethamail/subethasmtp "3.1.7"]

                 [org.clojure/tools.cli "1.0.194"]

                 [io.zonky.test/embedded-postgres "1.3.1" :exclusions [[io.zonky.test.postgres/embedded-postgres-binaries-linux-amd64-alpine] [commons-io/commons-io]]]
                 [io.zonky.test.postgres/embedded-postgres-binaries-linux-arm32v7] ;; Versions are specified by BOM below.
                 [io.zonky.test.postgres/embedded-postgres-binaries-linux-arm64v8]

                 [anvil/embedded-traefik "0.3.0"]

                 [org.bouncycastle/bcprov-jdk18on "1.78.1"]
                 [org.bouncycastle/bcpkix-jdk18on "1.78.1"]

                 ;; Hacks for Java 11 (#2334) - we shouldn't need this
                 [javax.xml.bind/jaxb-api "2.3.1"]
                 [org.glassfish.jaxb/jaxb-runtime "2.3.1"]

                 [commons-io/commons-io "2.16.1"]]
  :bom {:import [[io.zonky.test.postgres/embedded-postgres-binaries-bom "10.18.0"]]}
  :main anvil.app-server.run
  :repl-options {:init (do (use 'anvil.app-server.run) (-main "--config-file" "test-files/anvil.conf.yaml"))}
  :plugins [[lein-bom "0.2.0-SNAPSHOT"]]
  :uberjar-name "anvil-app-server.jar"
  :aot :all
  :omit-source true
  :profiles {:provided {:dependencies [[org.bouncycastle/bcprov-jdk18on "1.78.1"]
                                       [org.bouncycastle/bcpkix-jdk18on "1.78.1"]]}
             :uberjar {:exclusions [org.bouncycastle/bcprov-jdk18on
                                    org.bouncycastle/bcpkix-jdk18on]}}
  )
