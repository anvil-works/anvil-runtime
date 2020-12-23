(ns anvil.dispatcher.native-rpc-handlers.users.fido
  (:use slingshot.slingshot)
  (:require [anvil.runtime.app-data :as app-data]
            [clojure.data.codec.base64 :as b64]
            [anvil.dispatcher.native-rpc-handlers.util :as util]
            [crypto.random :as random]
            [anvil.runtime.secrets :as secrets]
            [anvil.dispatcher.native-rpc-handlers.users.util :as users-util :refer [get-props-with-named-user-table
                                                                                    get-user-and-check-enabled
                                                                                    get-and-create-columns
                                                                                    row-to-map]]
            [anvil.runtime.tables.rpc :as tables]
            [clojure.tools.logging :as log])
  (:import (com.webauthn4j.data.client.challenge DefaultChallenge)
           (com.webauthn4j.server ServerProperty)
           (com.webauthn4j.authenticator AuthenticatorImpl)
           (com.webauthn4j.data AuthenticationParameters AuthenticationRequest RegistrationRequest RegistrationParameters)
           (com.webauthn4j WebAuthnManager)
           (com.webauthn4j.data.attestation AttestationObject)
           (com.webauthn4j.converter.util ObjectConverter)
           (java.net URI)
           (com.webauthn4j.data.attestation.authenticator AuthenticatorData)))


(defn valid-app-domain? [effective-domain environment]
  (some #(= (.toLowerCase effective-domain) (.toLowerCase (-> % (URI.) .getHost))) (app-data/get-valid-origins environment)))

(defn begin-fido-attestation [_kwargs email]
  (let [email (or email
                  (binding [util/*client-request?* false]
                    (let [{:keys [user_table]} (get-props-with-named-user-table)
                          user-row-id (or (get-in @util/*session-state* [:users :logged-in-id]) (get-in @util/*session-state* [:users :mfa-reset-user-id]))
                          user-row ((tables/Table "get_by_id") [user_table {}] {} user-row-id)]
                      (get (row-to-map user-row) "email")))
                  (throw+ {:anvil/server-error "Email address not provided and could not be inferred"}))
        challenge (String. ^bytes (b64/encode (random/bytes 32)))]

    (swap! util/*session-state* assoc-in [:users :fido-attestation-challenge] challenge)
    {:publicKey {:rp                     {:name (:name util/*app*)}
                 :user                   {:id          (String. ^bytes (b64/encode (.getBytes email)))
                                          :name        email
                                          :displayName email}
                 :authenticatorSelection {:requireResidentKey false
                                          :userVerification   "discouraged"}
                 :challenge              challenge
                 :pubKeyCredParams       [{:type "public-key" :alg -7}]}}))
;cose_alg_ECDSA_w_SHA512 = -36;
;cose_alg_ECDSA_w_SHA256 = -7;
;cose_alg_RSASSA_PSS_w_SHA512 = -39;
;cose_alg_RSASSA_PSS_w_SHA256 = -37;


;; Returns an mfa-method object, which can be passed to add-mfa-method, or added directly to the user row.
(defn validate-fido-attestation [_kwargs webauthn-registration-response]
  (let [manager (WebAuthnManager/createNonStrictWebAuthnManager)

        registration-data (.parse manager (RegistrationRequest.
                                            (b64/decode (.getBytes (:attestationObject webauthn-registration-response)))
                                            (b64/decode (.getBytes (:clientDataJSON webauthn-registration-response)))))

        registered-origin (-> registration-data .getCollectedClientData .getOrigin)

        effective-domain (.getHost registered-origin)]

    (when-not (valid-app-domain? effective-domain util/*environment*)
      (throw+ {:anvil/server-error (str "Invalid app origin: " effective-domain) :type "anvil.users.AuthenticationFailed"}))

    (let [registration-params (RegistrationParameters. (ServerProperty.
                                                         registered-origin
                                                         effective-domain
                                                         (DefaultChallenge. ^bytes (b64/decode (.getBytes (get-in @util/*session-state* [:users :fido-attestation-challenge]))))
                                                         nil)
                                                       false)]

      (swap! util/*session-state* update-in [:users] dissoc :fido-attestation-challenge)
      (.validate manager registration-data registration-params))

    {:type "fido" :id (random/base32 5) :serial 1 :attestation-object (secrets/encrypt-str-with-global-key :u (:attestationObject webauthn-registration-response))}))

(defn fido-mfa-method->attestation-object [mfa-method]
  (let [attestation-object-bytes (b64/decode (.getBytes (secrets/decrypt-str-with-global-key :u (:attestation-object mfa-method))))]
    (.readValue (.getCborConverter (ObjectConverter.)) ^bytes attestation-object-bytes ^Class AttestationObject)))

(defn encrypt-attestation-object [attestation-object]
  (let [attestation-object-bytes (.writeValueAsBytes (.getCborConverter (ObjectConverter.)) attestation-object)]
    (secrets/encrypt-str-with-global-key :u (String. ^bytes (b64/encode attestation-object-bytes)))))

(defn begin-fido-assertion [_kwargs email password]
  (binding [util/*client-request?* false]                   ; Safe, because we're loading the current user, and verifying their password.
    (let [{:keys [user_table]} (get-props-with-named-user-table)
          user (get-user-and-check-enabled user_table {:email (.trim ^String (or email ""))} :email)]

      (when-not password
        (throw+ {:anvil/server-error "No password provided" :type "anvil.users.AuthenticationFailed"}))
      (let [pw-hash (when user (get (row-to-map user) "password_hash"))]
        (when-not (anvil.util/bcrypt-checkpw password pw-hash)
          (throw+ {:anvil/server-error "Incorrect password" :type "anvil.users.AuthenticationFailed"})))

      (let [challenge (String. ^bytes (b64/encode (random/bytes 32)))]
        (swap! util/*session-state* assoc-in [:users :fido-assertion-challenge] challenge)
        {:publicKey {:challenge        challenge
                     :userVerification "discouraged"
                     :allowCredentials (for [mfa-method (get (row-to-map user) "mfa" [])
                                             :when (= (:type mfa-method) "fido")
                                             :let [attestation-object (fido-mfa-method->attestation-object mfa-method)
                                                   credential-id (-> attestation-object .getAuthenticatorData .getAttestedCredentialData .getCredentialId)]]
                                         {:type "public-key" :id (String. ^bytes (b64/encode credential-id))})}}))))

(defn validate-fido-assertion [mfa-method webauthn-assertion-response]
  (let [attestation-object ^AttestationObject (fido-mfa-method->attestation-object mfa-method)

        manager (WebAuthnManager/createNonStrictWebAuthnManager)

        authentication-data (.parse manager (AuthenticationRequest.
                                              (-> attestation-object .getAuthenticatorData .getAttestedCredentialData .getCredentialId)
                                              (b64/decode (.getBytes (:authenticatorData webauthn-assertion-response)))
                                              (b64/decode (.getBytes (:clientDataJSON webauthn-assertion-response)))
                                              (b64/decode (.getBytes (:signature webauthn-assertion-response)))))

        authentication-origin (-> authentication-data .getCollectedClientData .getOrigin)
        effective-domain (.getHost authentication-origin)]

    (when-not (valid-app-domain? effective-domain util/*environment*)
      (throw+ {:anvil/server-error (str "Invalid app origin: " effective-domain) :type "anvil.users.AuthenticationFailed"}))

    (let [authenticator (AuthenticatorImpl. (-> attestation-object .getAuthenticatorData .getAttestedCredentialData)
                                            (-> attestation-object .getAttestationStatement)
                                            (-> attestation-object .getAuthenticatorData .getSignCount))

          authentication-params (AuthenticationParameters. (ServerProperty.
                                                             authentication-origin
                                                             effective-domain
                                                             (DefaultChallenge. ^bytes (b64/decode (.getBytes (get-in @util/*session-state* [:users :fido-assertion-challenge]))))
                                                             nil)
                                                           authenticator
                                                           false)]

      (try
        (.validate manager authentication-data authentication-params)
        (swap! util/*session-state* update-in [:users] dissoc :fido-assertion-challenge)
        ;; Update signCount in auth data
        (let [old-auth-data (-> attestation-object .getAuthenticatorData)
              updated-attestation-object (AttestationObject. (AuthenticatorData. (.getRpIdHash old-auth-data)
                                                                                 (.getFlags old-auth-data)
                                                                                 (.getCounter authenticator)
                                                                                 (.getAttestedCredentialData old-auth-data)
                                                                                 (.getExtensions old-auth-data))
                                                             (.getAttestationStatement attestation-object))]
          ;; Return the new mfa method, with its sign counter incremented, to be stored with the user object.
          (assoc mfa-method :attestation-object (encrypt-attestation-object updated-attestation-object)))
        (catch Exception e
          (log/trace (str "Fido assertion validation failed. This could be because a different MFA method matched on the same user.\n" (.getMessage e)))
          false)))))
