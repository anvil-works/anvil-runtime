(ns anvil.core.sso.facebook
  (:require [clojure.data.json :as json]
            [crypto.random :as random]
            [org.httpkit.client :as http]
            [ring.util.codec]))

(defn get-login-url [client-id redirect-uri scope]
  (let [csrf-token (random/hex 60)]
    [(str "https://www.facebook.com/v3.2/dialog/oauth?"
          (ring.util.codec/form-encode {:client_id client-id
                                        :redirect_uri redirect-uri
                                        :state csrf-token
                                        :scope scope
                                        ;:auth_type "reauthenticate" ; This causes Colette to land in an infinite loop being asked for her password
                                        :display "popup"}))
     ;; Caller is responsible for storing the CSRF token somewhere suitable.
     csrf-token]))

(defn process-callback [code state csrf-token client-id client-secret redirect-uri]
  (if (not= state csrf-token)
    (throw (Exception. "CSRF CHECK FAILED"))

    (let [body-json (:body @(http/post "https://graph.facebook.com/v3.2/oauth/access_token"
                                       {:keepalive   -1
                                        :form-params {:code          code
                                                      :client_id     client-id
                                                      :client_secret client-secret
                                                      :redirect_uri  redirect-uri
                                                      :grant_type    "authorization_code"}}))
          body (json/read-str body-json :key-fn keyword)]

      (if (:error body)
        (throw (Exception. (str "FAILED TO GET ACCESS TOKEN: " (get-in body [:error :message]))))

        (let [access-token (:access_token body)
              body-json (:body @(http/post "https://graph.facebook.com/v2.9/me?fields=email"
                                           {:keepalive   -1
                                            :form-params {:access_token access-token}}))
              body (json/read-str body-json :key-fn keyword)]

          (merge body {:access-token access-token}))))))
