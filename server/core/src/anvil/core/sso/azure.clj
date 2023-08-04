(ns anvil.core.sso.azure
  (:require [anvil.util :as util]
            [clojure.data.codec.base64 :as b64]
            [clojure.data.json :as json]
            [crypto.random :as random]
            [org.httpkit.client :as http]
            [buddy.sign.jwt]
            [buddy.core.keys]
            [ring.util.response :as resp]))

(defn get-login-url [state tenant-id application-id response-type scope redirect-uri]
  (let [nonce (random/hex 60)] ;; No CSRF token needed - the nonce takes care of that for us.
    [(str "https://login.microsoftonline.com/" (util/real-actual-genuine-url-encoder (util/or-str tenant-id "common")) "/oauth2/v2.0/authorize?"
          "&client_id=" application-id
          "&response_type=" response-type
          "&redirect_uri=" (util/real-actual-genuine-url-encoder redirect-uri)
          "&response_mode=form_post"
          "&state=" (util/real-actual-genuine-url-encoder state)
          "&nonce=" nonce
          "&scope=" (util/real-actual-genuine-url-encoder scope))
     ;; It is the responsibility of the caller to store the nonce somewhere suitable.
     nonce]))

(defn- load-id-token [nonce tenant-id id-token]
  (let [{:keys [kid alg]} (json/read-str (String. ^bytes (b64/decode (.getBytes ^String id-token))) :key-fn keyword)

        ; Only allow some algorithms, so we're not vulnerable to attacks that involve switching e.g. rs256 to hs256. See https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/
        allowed-algs #{:rs256}

        alg (some #{(keyword (.toLowerCase alg))} allowed-algs)

        openid-config (json/read-str (:body @(http/get (str "https://login.microsoftonline.com/" (util/real-actual-genuine-url-encoder (or tenant-id "common")) "/v2.0/.well-known/openid-configuration") {:keepalive -1})) :key-fn keyword)
        jwks (:keys (json/read-str (:body @(http/get (:jwks_uri openid-config) {:keepalive -1})) :key-fn keyword))
        jwk (first (filter #(= (:kid %) kid) jwks))

        public-key (buddy.core.keys/jwk->public-key jwk)

        verified-claims (buddy.sign.jwt/unsign id-token public-key {:alg alg})]

    (if (not= (:nonce verified-claims) nonce)
      (throw (Exception. "NONCE CHECK FAILED"))
      verified-claims)))

(defn process-callback [req nonce tenant-id application-id application-secret redirect-uri]
  (if-let [id-token (-> req :params :id_token)]
    ; OpenID flow
    {:id-token (load-id-token nonce tenant-id id-token)}

    ;; There was no ID token, so we must be using the full auth code flow.
    (let [body-json (:body @(http/post (str "https://login.microsoftonline.com/" (util/real-actual-genuine-url-encoder (util/or-str tenant-id "common")) "/oauth2/v2.0/token")
                                       {:keepalive   -1
                                        :form-params {:code          (-> req :params :code)
                                                      :client_id     application-id
                                                      :client_secret application-secret
                                                      :redirect_uri  redirect-uri
                                                      :grant_type    "authorization_code"}}))
          body (json/read-str body-json :key-fn keyword)]

      (if (:error body)

        ;; Something went wrong.
        (throw (Exception. (str "FAILED TO GET ACCESS TOKEN: " body-json)))

        ;; There was no error, so we should be able to find the tokens
        {:id-token (load-id-token nonce tenant-id (:id_token body))
         :refresh-token  (:refresh_token body)
         :access-token   (:access_token body)
         :application-id application-id}))))