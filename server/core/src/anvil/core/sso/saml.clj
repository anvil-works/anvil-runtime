(ns anvil.core.sso.saml
  (:require [anvil.dispatcher.native-rpc-handlers.saml :as saml]
            [anvil.util :as util]
            [clojure.data.json :as json]
            [clojure.string :as str]
            [crypto.random :as random]
            [ring.util.codec])
  (:import (com.onelogin.saml2.authn AuthnRequest SamlResponse)
           (com.onelogin.saml2.util Constants)
           (java.nio.charset Charset)
           (java.util ArrayList Collection)
           (org.apache.http.client.utils URLEncodedUtils)))

(defn get-login-url [settings force-authentication]
  (let [authn-request (AuthnRequest. settings (boolean force-authentication) false true)
        sso-url (str (.getIdpSingleSignOnServiceUrl settings))

        safe-sso-url-params (->> (URLEncodedUtils/parse sso-url (Charset/forName "UTF-8"))
                                 (filter #(not (contains? #{"SAMLRequest" "RelayState" "SigAlg"} (.getName %)))))

        sso-url (str (first (str/split sso-url #"\?"))
                     (when (not-empty safe-sso-url-params)
                       (str "?" (URLEncodedUtils/format (ArrayList. ^Collection safe-sso-url-params) "UTF-8"))))

        saml-request (.getEncodedAuthnRequest authn-request)
        csrf-token (random/hex 60)
        query-string (str "SAMLRequest=" (util/real-actual-genuine-url-encoder saml-request)
                          "&RelayState=" (util/real-actual-genuine-url-encoder csrf-token)
                          "&SigAlg=" (util/real-actual-genuine-url-encoder (.getSignatureAlgorithm settings)))
        signature (saml/sign-request query-string settings)]

    [(str sso-url
          (if (not-empty safe-sso-url-params) "&" "?")
          query-string
          "&Signature=" (util/real-actual-genuine-url-encoder signature))
     ;; Caller is responsible for storing the CSRF token somewhere suitable.
     csrf-token]))

(defn process-callback [req csrf-token settings email-attribute redirect-uri]
  (let [{relay-state :RelayState saml-response :SAMLResponse} (:params req)]
    (if (not= relay-state csrf-token)
      (throw (Exception. "CSRF CHECK FAILED"))

      (let [saml-response (SamlResponse. settings redirect-uri saml-response)]
        (if-not (.isValid saml-response)
          (throw (Exception. "Invalid SAML response"))

          (let [attributes (into {} (.getAttributes saml-response))
                name-id (.getNameId saml-response)
                name-id-format (.getNameIdFormat saml-response)

                email (first (or (get attributes email-attribute)
                                 (and (= name-id-format Constants/NAMEID_EMAIL_ADDRESS)
                                      [name-id])
                                 (get attributes "urn:oid:0.9.2342.19200300.100.1.3")
                                 (get attributes "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")))]
            (if-not email
              (throw (Exception. (str "Login failed: SAML response did not contain a valid email address. "
                                      "NameID format was \"" name-id-format "\". "
                                      "You may need to configure the Email Attribute setting in the SAML Service configuration.")))

              ;; Useful reference for SAML attributes: https://edx.readthedocs.io/projects/edx-installing-configuring-and-running/en/named-release-dogwood.rc/configuration/tpa/tpa_SAML_IdP.html
              {:attributes (json/read-str (json/write-str attributes)) ;; This is silly, but gets rid of pesky ArrayLists that won't serialise.
               :email      email})))))))
