(ns anvil.dispatcher.native-rpc-handlers.saml
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [slingshot.slingshot])
  (:require [anvil.dispatcher.core :as dispatcher]
            [anvil.runtime.conf :as conf]
            [anvil.util :as util]
            [anvil.core.db-config :as db-config]
            [clojure.tools.logging :as log])
  (:import (com.onelogin.saml2.settings SettingsBuilder)
           (com.onelogin.saml2.util Constants Util)
           (java.security KeyPairGenerator)
           (java.io StringWriter File)
           (org.bouncycastle.util.io.pem PemObject PemWriter)
           (org.bouncycastle.cert X509v3CertificateBuilder)
           (org.bouncycastle.asn1.x500 X500Name)
           (java.util Date Calendar)
           (org.bouncycastle.asn1.x509 SubjectPublicKeyInfo)
           (org.bouncycastle.operator.jcajce JcaContentSignerBuilder)
           (org.bouncycastle.openssl PEMParser)
           (org.bouncycastle.openssl.jcajce JcaPEMKeyConverter)))

(clj-logging-config.log4j/set-logger! :level :info)

(defn generate-key-pair []
  (-> (doto (KeyPairGenerator/getInstance "RSA")
        (.initialize 4096))
      (.generateKeyPair)))

(defn generate-x509-cert
  ([key-pair] (generate-x509-cert (.getPublic key-pair) (.getPrivate key-pair)))
  ([public-key private-key]
   (let [expires (.getTime (doto (Calendar/getInstance)
                             (.setTime (Date.))
                             (.add Calendar/YEAR 10)))

         name (X500Name. "CN=anvil-saml")
         cert-builder (-> (doto (X509v3CertificateBuilder. ^X500Name name
                                                           (BigInteger/valueOf 0)
                                                           ^Date (Date.)
                                                           ^Date expires
                                                           ^X500Name name
                                                           ^SubjectPublicKeyInfo (SubjectPublicKeyInfo/getInstance (.getEncoded public-key)))))

         signer (-> (JcaContentSignerBuilder. "SHA256withRSA")
                    (.build private-key))]
     (.build cert-builder signer))))

(defn ->pem [obj description]
  (let [writer (StringWriter.)
        pem-writer (PemWriter. writer)]
    (.writeObject pem-writer (PemObject. description (.getEncoded obj)))
    (.close pem-writer)
    (.toString writer)))

(defn get-cert-and-key []
  (let [{:keys [private-key public-key]} (or (db-config/get-val ::keys)
                                             (db-config/set-val ::keys (or (when (.exists (File. ^String (:private-key conf/saml-paths)))
                                                                             (log/info "Loading legacy SAML key pair into DB")
                                                                             {:private-key (slurp (:private-key conf/saml-paths))
                                                                              :public-key  (slurp (:public-key conf/saml-paths))})
                                                                           (let [key-pair (generate-key-pair)]
                                                                             (log/info "Generated SAML key pair")
                                                                             {:private-key (->pem (.getPrivate key-pair) "PRIVATE KEY")
                                                                              :public-key  (->pem (.getPublic key-pair) "PUBLIC KEY")}))))

        certificate (or (db-config/get-val ::certificate)
                        (db-config/set-val ::certificate (or (when (.exists (File. ^String (:certificate conf/saml-paths)))
                                                               (log/info "Loading legacy SAML certificate into DB")
                                                               (slurp (:certificate conf/saml-paths)))
                                                             (let [private-key-info (.readObject (PEMParser. (clojure.java.io/reader (char-array private-key))))
                                                                   public-key-info (.readObject (PEMParser. (clojure.java.io/reader (char-array public-key))))
                                                                   certificate (generate-x509-cert public-key-info (.getPrivateKey (JcaPEMKeyConverter.) private-key-info))
                                                                   cert-pem (->pem certificate "CERTIFICATE")]
                                                               (log/info "Generated SAML certificate")
                                                               cert-pem))))]
    [private-key certificate]))

(defn get-sp-entity-ids [app-info]
  (log/debug "Getting SP entity ID for app" (:id app-info))
  {:app    (str conf/runtime-common-url "/_/saml-app/" (util/sha-256 (:id app-info)))
   :shared (str conf/runtime-common-url "/_/saml-org/" (util/sha-256 (str (or (:user_organisation app-info) (:id app-info)))))})

(defn get-settings [saml-service-server-config app-info]
  (let [[private-key-pem cert-pem] (get-cert-and-key)
        {:keys [shared idp_entity_id idp_sso_url idp_signing_cert email_attribute signature_algorithm]} saml-service-server-config

        entity-id (get (get-sp-entity-ids app-info) (if shared :shared :app))

        general-settings {"onelogin.saml2.strict" true
                          "onelogin.saml2.debug" false
                          "onelogin.saml2.unique_id_prefix" "ANVIL_"}

        sp-settings (merge {"onelogin.saml2.sp.entityid"                       entity-id
                            "onelogin.saml2.sp.assertion_consumer_service.url" (str conf/runtime-common-url "/_/saml_auth_login")
                            ;"onelogin.saml2.sp.single_logout_service.url"      (str conf/runtime-common-url "/_/saml_auth_logout")
                            "onelogin.saml2.sp.x509cert"                       cert-pem
                            "onelogin.saml2.sp.privatekey"                     private-key-pem
                            "onelogin.saml2.security.authnrequest_signed"      true
                            "onelogin.saml2.security.signature_algorithm"      (util/or-str signature_algorithm Constants/RSA_SHA256)}

                           ;; If we have specified the attribute containing email address, don't bother requiring a particular nameId format.
                           (when (empty? email_attribute)
                             {"onelogin.saml2.sp.nameidformat" Constants/NAMEID_EMAIL_ADDRESS})

                           (when-not shared
                             {"onelogin.saml2.organization.name" (:name app-info)
                              "onelogin.saml2.organization.displayname" (:name app-info)}))

        idp-settings {"onelogin.saml2.idp.entityid" idp_entity_id
                      "onelogin.saml2.idp.single_sign_on_service.url" idp_sso_url
                      ;"onelogin.saml2.idp.single_logout_service.url" idp_sls_url
                      "onelogin.saml2.idp.x509cert" idp_signing_cert
                      "onelogin.saml2.security.want_assertions_signed"   true
                      }

        settings (-> (SettingsBuilder.)
                     (.fromValues (merge general-settings sp-settings idp-settings))
                     (.build))]
    settings))

(defn sign-request [query-string settings]
  (Util/base64encoder (Util/sign query-string (.getSPkey settings) (.getSignatureAlgorithm settings))))

(defn get-user-email [_]
  (get-in @*session-state* [:saml :email]))

(defn get-user-attributes [_]
  (get-in @*session-state* [:saml :attributes]))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.saml.auth.get_user_email"      (wrap-native-fn get-user-email)
        "anvil.private.saml.auth.get_user_attributes" (wrap-native-fn get-user-attributes)})