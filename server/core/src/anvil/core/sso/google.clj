(ns anvil.core.sso.google
  (:use [slingshot.slingshot])
  (:require [clojure.set :as set]
            [compojure.response]
            [ring.util.response]
            [clojure.data.json :as json]
            [org.httpkit.client :as http]
            [crypto.random :as random]
            [ring.util.codec])
  (:import (java.util Date)))

(defn get-login-url [state client-id redirect-uri scope request-offline]
  (let [csrf-token   (random/hex 60)
        state (str state "G" csrf-token)]

     ;; Generate a redirect to Google, including our app info
     [(str "https://accounts.google.com/o/oauth2/auth?"
           (ring.util.codec/form-encode {:redirect_uri  redirect-uri
                                         :response_type "code"
                                         :access_type   (if request-offline "offline" "online")
                                         ;:approval_prompt (if request-offline "force" "auto") ;; This isn't valid for Google any more, apparently. We should replace it with 'prompt=' https://developers.google.com/identity/protocols/oauth2/openid-connect#authenticationuriparameters
                                         :prompt        (if request-offline "consent select_account" "")
                                         :scope         scope
                                         :state         state
                                         :client_id     client-id}))

      ;; Caller is responsible for storing the CSRF token somewhere suitable.
      csrf-token]))

(defn process-callback [code state required-csrf-token required-scopes client-id client-secret redirect-uri]
  (let [provided-csrf-token (last (.split ^String state "G"))]

    ;; First, check the CSRF token matches the one we put in the session
    (if (not= provided-csrf-token required-csrf-token)

      ;; CSRF does not match. Fail.
      (throw (Exception. "CSRF CHECK FAILED"))

      ;; CSRF matches. Start by exchanging the auth code for an access token
      (let [body-json     (:body @(http/post "https://accounts.google.com/o/oauth2/token"
                                             {:keepalive -1
                                              :form-params {:code          code
                                                            :client_id     client-id
                                                            :client_secret client-secret
                                                            :redirect_uri  redirect-uri
                                                            :grant_type    "authorization_code"}}))
            body          (json/read-str body-json :key-fn keyword)
            scopes        (some-> body (:scope) (.split " ") (set))]

        (if (:error body)

          ;; Something went wrong.
          (throw (Exception. (str "FAILED TO GET ACCESS TOKEN: " body-json)))

          (if (and required-scopes
                   (contains? body :scope)
                   (not (set/superset? scopes required-scopes)))
            (throw (Exception. (str "ALL CONSENTS NOT GRANTED")))

            ;; There was no error, so we should be able to find the access token
            (let [access-token (:access_token body)
                  refresh-token (:refresh_token body)

                  ;; Decrypt the ID token.
                  id-token-json (:body @(http/get "https://www.googleapis.com/oauth2/v1/tokeninfo"
                                                  {:keepalive    -1
                                                   :query-params {:id_token (:id_token body)}}))
                  id-token (json/read-str id-token-json :key-fn keyword)]

              (if (:error id-token)

                ;; Something went wrong.
                (throw (Exception. (str "FAILED TO VERIFY ID TOKEN: " id-token-json)))

                ;; There was no error, so we have our credentials. Return an auth map so that friend can do its thing.
                (merge {:access-token  access-token
                        :refresh-token refresh-token
                        :id-token      id-token}
                       (select-keys body [:scope]))))))))))

(defn refresh-access-token [refresh-token client-id client-secret]
  (let [params {:keepalive -1
                :form-params {:refresh_token refresh-token
                               :client_id     client-id
                               :client_secret client-secret
                               :grant_type    "refresh_token"}}
        response @(http/post "https://accounts.google.com/o/oauth2/token" params)
        body (json/read-str (:body response) :key-fn keyword)
        body (assoc body :expires_at (Date. ^Long (+ (.getTime (Date.)) (* 1000 (or (:expires_in body) 0)))))]

    (when (or (:error body) (not= 200 (:status response)))
      (throw+ {:anvil/server-error (str "Could not retrieve app files from Google. Try renewing your app file permissions in the Anvil IDE."
                                        (when (:error body)
                                          (str " (" (:error body) "; " (:error_description body) ")")))}))

    body))


