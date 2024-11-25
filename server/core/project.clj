(defproject anvil-runtime "latest"
  :min-lein-version "2.8.1"
  :repositories {"anvil" "file:../maven_repository"}
  :managed-dependencies [[org.clojure/clojure "1.12.0"]

                         [com.fasterxml.jackson.core/jackson-core "2.18.0"]
                         [com.fasterxml.jackson.core/jackson-databind "2.18.0"]
                         [com.fasterxml.jackson.dataformat/jackson-dataformat-cbor "2.18.0"]
                         [com.fasterxml.jackson.dataformat/jackson-dataformat-smile "2.18.0"]

                         [dnsjava/dnsjava "3.6.0"]  ; 3.4.1 required by apache-jdkim is vulnerable.
                         [org.apache.james/apache-mime4j-core "0.8.10"]  ; 0.8.3 required by apache-jdkim is vulnerable.

                         [commons-io/commons-io "2.17.0"]]

  :exclusions [[log4j]]
  :dependencies [[org.clojure/clojure "1.12.0"]
                 [compojure "1.6.1"]

                 [commons-fileupload "1.5"] ; 1.4, used by ring-core, is vulnerable
                 [ring/ring-core "1.12.1"]
                 [ring/ring-defaults "0.3.2"]
                 ;[ring/ring-devel "1.12.1"]
                 [ring/ring-json "0.5.0"]
                 [ring-cors "0.1.13"]
                 [bk/ring-gzip "0.3.0"]

                 [clj-commons/friend "0.3.199"]

                 [clojusc/friend-oauth2 "0.2.0" :exclusions [clojusc/twig ring/ring-jetty-adapter ch.qos.logback/logback-classic]]
                 [org.clojure/data.json "0.2.5"]
                 [org.clojure/data.xml "0.0.8"]
                 [org.clojure/data.zip "0.1.1"]
                 [org.senatehouse/http-kit "2.5.0-httpsfix-1.1"]
                 [crypto-random "1.1.0"]
                 [clj-commons/clj-yaml "1.0.27"]
                 [digest "1.4.4"]

                 [org.clojure/data.codec "0.1.0"]

                 [org.clojure/java.jdbc "0.7.10"]
                 [org.postgresql/postgresql "42.2.28"]

                 [javax.mail/mail "1.4.4"]

                 [com.stripe/stripe-java "22.5.0"]

                 [org.clojure/tools.logging "0.4.1"]
                 [org.slf4j/slf4j-reload4j "1.7.36"]
                 [ch.qos.reload4j/reload4j "1.2.19" :exclusions [javax.mail/mail javax.jms/jms com.sun.jdmk/jmxtools com.sun.jmx/jmxri]]
                 [clj-logging-config "1.9.12"]

                 [slingshot "0.12.2"]

                 [org.clojure/core.async "1.5.648"]
                 [org.clojure/core.cache "0.8.2"]

                 [org.senatehouse/expect-call "0.3.0"]

                 [nrepl "0.8.3"]

                 [org.mindrot/jbcrypt "0.4"]
                 [com.maxmind.geoip2/geoip2 "2.16.0"]
                 [com.draines/postal "2.0.2"]

                 [com.google.guava/guava "33.3.1-jre"]

                 [org.apache.xmlgraphics/batik-dom "1.16"]  ; 1.15 required by one-time is vulnerable.
                 [one-time "0.8.0"]
                 [me.grison/cljwebauthn "0.1.2"]
                 [com.webauthn4j/webauthn4j-core "0.11.1.RELEASE" :exclusions [org.slf4j/slf4j-api org.bouncycastle/bcprov-jdk15on org.bouncycastle/bcpkix-jdk15on]]

                 [org.subethamail/subethasmtp "3.1.7"]
                 ;  Can't use v0.3 as it removes mailets, which we use in email_server.clj
                 [org.apache.james.jdkim/apache-jdkim "0.2" :extension "pom" :exclusions [org.apache.geronimo.javamail/geronimo-javamail_1.4_mail]]

                 [org.bouncycastle/bcprov-jdk18on "1.78.1"]
                 [org.bouncycastle/bcpkix-jdk18on "1.78.1"]
                 [buddy/buddy-core "1.6.0" :exclusions [org.bouncycastle/bcprov-jdk15on org.bouncycastle/bcpkix-jdk15on]]
                 [buddy/buddy-sign "3.1.0"]

                 [io.prometheus/simpleclient_hotspot "0.6.0"]
                 [clj-commons/iapetos "0.1.9"]
                 [net.ttddyy/datasource-proxy "1.5.1"]
                 [com.mchange/c3p0 "0.9.5.2"]

                 [malabarba/lazy-map "1.3"]

                 [org.apache.santuario/xmlsec "2.2.6"]  ; 2.2.3 required by java-saml is vulnerable.
                 [com.onelogin/java-saml "2.9.0" :exclusions [org.slf4j/slf4j-api]]
                 [medley "1.4.0"]
                 [olical/crawlers "0.2.0"]

                 [org.apache.commons/commons-compress "1.27.1"]
                 [org.apache.commons/commons-lang3 "3.14.0"]
                 [commons-codec/commons-codec "1.17.0"]     ; Override the very old version in cemerick/friend, which isn't compatible with java-saml

                 [io.opentelemetry/opentelemetry-sdk]]
  :bom {:import [[io.opentelemetry/opentelemetry-bom "1.7.0"]]}
  :jvm-opts ["-Dfile.encoding=UTF-8"]
  :plugins [[com.github.anvil-works/lein-aot-order "0.1.1-anvil"]
             [lein-bom "0.2.0-SNAPSHOT"]]
  :aot :order
  :auto-clean false
  :omit-source true
  :profiles {:provided {:dependencies [[org.bouncycastle/bcprov-jdk18on "1.78.1"]
                                       [org.bouncycastle/bcpkix-jdk18on "1.78.1"]]}
             :uberjar {:exclusions [org.bouncycastle/bcprov-jdk18on
                                    org.bouncycastle/bcpkix-jdk18on]}
             :dev {:jvm-opts ["-Dclojure.compiler.disable-locals-clearing=true"
                              ;"-Djavax.net.debug=all" ; Useful for debugging SSL issues
                              ]}}
  )
