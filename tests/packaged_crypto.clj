;; Run with only the packaged App Server JAR on the classpath, not through Leiningen.
(require '[anvil.util :as util]
         '[anvil.runtime.secrets :as secrets]
         '[anvil.core.sso.saml :as saml-callback]
         '[anvil.dispatcher.native-rpc-handlers.saml :as saml]
         '[buddy.core.keys :as keys]
         '[buddy.sign.jwt :as jwt]
         '[clojure.java.io :as io]
         '[clojure.string :as str])
(import '(com.onelogin.saml2.settings SettingsBuilder)
        '(com.onelogin.saml2.util Util)
        '(java.time Instant)
        '(java.util Base64)
        '(javax.crypto KeyGenerator)
        '(org.apache.log4j Logger Level)
        '(org.apache.xml.security.encryption XMLCipher)
        '(org.apache.xml.security.keys KeyInfo)
        '(org.apache.xml.security.signature XMLSignature)
        '(org.apache.xml.security.transforms Transforms))

(def response-template
  (slurp (io/file (.getParentFile (io/file *file*)) "fixtures" "saml-response.xml")))

;; Generate a local IdP response. Sign before encrypting, as an IdP does; let the
;; production callback choose its providers rather than forcing Bouncy Castle.
(defn signed-response [idp certificate]
  (let [now (Instant/now)
        doc (Util/loadXML (-> response-template
                              (str/replace "{{now}}" (str now))
                              (str/replace "{{before}}" (str (.minusSeconds now 60)))
                              (str/replace "{{after}}" (str (.plusSeconds now 300)))))
        assertion (.item (.getElementsByTagNameNS doc "urn:oasis:names:tc:SAML:2.0:assertion" "Assertion") 0)
        issuer (.item (.getElementsByTagNameNS assertion "urn:oasis:names:tc:SAML:2.0:assertion" "Issuer") 0)
        signature (XMLSignature. doc "" XMLSignature/ALGO_ID_SIGNATURE_RSA_SHA256
                                 Transforms/TRANSFORM_C14N_EXCL_OMIT_COMMENTS)
        transforms (doto (Transforms. doc)
                     (.addTransform Transforms/TRANSFORM_ENVELOPED_SIGNATURE)
                     (.addTransform Transforms/TRANSFORM_C14N_EXCL_OMIT_COMMENTS))]
    (.setIdAttribute assertion "ID" true)
    (.insertBefore assertion (.getElement signature) (.getNextSibling issuer))
    (.addDocument signature "#_assertion" transforms "http://www.w3.org/2001/04/xmlenc#sha256")
    (.addKeyInfo signature certificate)
    (.sign signature (.getPrivate idp))
    doc))

(defn encrypt-assertion! [doc public-key algorithm]
  (let [assertion (.item (.getElementsByTagNameNS doc "urn:oasis:names:tc:SAML:2.0:assertion" "Assertion") 0)
        key (.generateKey (doto (KeyGenerator/getInstance "AES") (.init 128)))
        wrapper (.createElementNS doc "urn:oasis:names:tc:SAML:2.0:assertion" "saml:EncryptedAssertion")
        cipher (doto (XMLCipher/getInstance algorithm) (.init XMLCipher/ENCRYPT_MODE key))
        key-cipher (doto (XMLCipher/getInstance XMLCipher/RSA_OAEP)
                     (.init XMLCipher/WRAP_MODE public-key))
        key-info (doto (KeyInfo. doc) (.add (.encryptKey key-cipher doc key)))]
    (.replaceChild (.getDocumentElement doc) wrapper assertion)
    (.appendChild wrapper assertion)
    (.setKeyInfo (.getEncryptedData cipher) key-info)
    (.doFinal cipher doc assertion false)))

;; These libraries otherwise log entire assertions at DEBUG in this standalone JVM.
(doseq [logger ["org.apache.xml.security" "com.onelogin.saml2"]]
  (.setLevel (Logger/getLogger logger) Level/WARN))
(org.apache.xml.security.Init/init)
(let [sp (util/generate-key-pair)
      private-key (util/pem->private-key (util/->pem (.getPrivate sp) "PRIVATE KEY"))
      public-key (util/pem->public-key (util/->pem (.getPublic sp) "PUBLIC KEY"))
      sp-cert-pem (util/->pem (saml/generate-x509-cert public-key private-key) "CERTIFICATE")
      sp-cert (Util/loadCert sp-cert-pem)
      idp (util/generate-key-pair)
      idp-cert (Util/loadCert (util/->pem (saml/generate-x509-cert idp) "CERTIFICATE"))
      claims {:sub "packaged-crypto-check" :nonce "test-nonce"}
      token (jwt/sign claims private-key {:alg :rs256})
      settings (-> (SettingsBuilder.)
                   (.fromValues {"onelogin.saml2.strict" true
                                 "onelogin.saml2.sp.entityid" "https://sp.example.test/metadata"
                                 "onelogin.saml2.sp.assertion_consumer_service.url" "https://sp.example.test/acs"
                                 "onelogin.saml2.sp.x509cert" sp-cert-pem
                                 "onelogin.saml2.sp.privatekey" (util/->pem private-key "PRIVATE KEY")
                                 "onelogin.saml2.idp.entityid" "https://idp.example.test/metadata"
                                 "onelogin.saml2.idp.single_sign_on_service.url" "https://idp.example.test/sso"
                                 "onelogin.saml2.idp.x509cert" (Util/convertToPem idp-cert)
                                 "onelogin.saml2.security.want_assertions_signed" true})
                   (.build))
      callback (fn [xml]
                 (saml-callback/process-callback
                   {:params {:RelayState "test-csrf"
                             :SAMLResponse (.encodeToString (Base64/getEncoder) (.getBytes xml "UTF-8"))}}
                   "test-csrf" settings nil "https://sp.example.test/acs"))]
  ;; Protect packaged PEM conversion and certificate construction, not just loading.
  (assert (= (seq (.getEncoded (.getPrivate sp))) (seq (.getEncoded private-key))))
  (assert (= (seq (.getEncoded (.getPublic sp))) (seq (.getEncoded public-key))))
  (.verify sp-cert public-key)
  (.checkValidity sp-cert)
  (println "PASS: production PEM helpers and SAML certificate generation")

  ;; Azure SSO uses Buddy's JWK conversion and RS256 verification.
  (assert (= claims (jwt/unsign token (keys/jwk->public-key (keys/public-key->jwk public-key)) {:alg :rs256})))
  (println "PASS: Buddy RS256 JWT verification with JWK conversion")

  ;; These are the implementation functions behind encrypt_with_key/decrypt_with_key.
  (let [key (.generateKey (doto (KeyGenerator/getInstance "AES") (.init secrets/SECRET-KEY-NBITS)))]
    (doseq [plaintext ["" "Packaged crypto: café 日本語"]]
      (assert (= plaintext (secrets/decrypt-str key (secrets/encrypt-str key plaintext))))))
  (println "PASS: production secrets encryption and decryption")

  ;; Exercise OneLogin/XMLSec decryption, signature validation and Anvil's extraction
  ;; of identity. This is the real callback, without an external IdP or database.
  (doseq [[label algorithm] [["AES-128-CBC" XMLCipher/AES_128] ["AES-128-GCM" XMLCipher/AES_128_GCM]]]
    (let [doc (signed-response idp idp-cert)]
      (encrypt-assertion! doc public-key algorithm)
      (assert (= {:email "review@example.test" :attributes {"department" ["Engineering"]}}
                 (callback (Util/convertDocumentToString doc))))
      (println "PASS: production SAML callback with" label "and RSA-OAEP")))

  ;; Reject a modified claim even when it arrives inside valid encrypted XML.
  (println "Checking tampered assertion; signature-validation warnings below are expected.")
  (let [doc (signed-response idp idp-cert)
        attribute (.item (.getElementsByTagNameNS doc "urn:oasis:names:tc:SAML:2.0:assertion" "AttributeValue") 0)]
    (.setTextContent attribute "Tampered")
    (encrypt-assertion! doc public-key XMLCipher/AES_128_GCM)
    (assert (try
              (callback (Util/convertDocumentToString doc))
              false
              (catch Exception e
                (= "Invalid SAML response" (.getMessage e))))))
  (println "PASS: production SAML callback rejects a tampered signed assertion"))

(shutdown-agents)
