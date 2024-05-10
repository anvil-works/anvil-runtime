(ns anvil.dispatcher.native-rpc-handlers.google.util
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [clojure.pprint]
        [slingshot.slingshot])
  (:require [anvil.runtime.conf :as conf]
            [anvil.core.sso.google :as google-sso]
            [org.httpkit.client :as http]
            [clojure.data.json :as json]
            [clojure.data.xml :as xml]
            [clojure.tools.logging :as log]
            [anvil.util :as util]
            [anvil.runtime.secrets :as secrets]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util])
  (:import (java.util Date)))

(defn get-google-service-props []
  (first (filter #(= (:source %) "/runtime/services/google.yml") (:services *app*))))

(defn has-own-client-id?
  ([] (has-own-client-id? nil))
  ([service] (let [client-id (or (get-in (or service (get-google-service-props)) [:server_config :client_id])
                                 (and (:custom? conf/google-client-config) (:client-id conf/google-client-config)))]
               (and client-id (not= "" client-id)))))

(defn get-delegation-refresh-token [app-info google-service-server-config]
  (let [{:keys [delegation_refresh_token enc_delegation_refresh_token]} google-service-server-config
        refresh-token (or delegation_refresh_token
                          (:value (secrets/get-global-app-secret-value app-info "google-service/delegation-refresh-token" enc_delegation_refresh_token)))]
    refresh-token))

(defonce apps-with-drive-scope (atom {}))

(defn add-credentials [httpkit-map creds]
  (condp = creds
    "google-user" (assoc-in httpkit-map [:headers "Authorization"]
                            (str "Bearer " (-> @*session-state* :google :user-tokens :access-token)))
    "google-delegated" (do
                         (when (or (not (-> @*session-state* :google :delegation-access-token))
                                   ;; Refresh access token if it's about to expire.
                                   (> (.getTime (Date.)) (+ 60000 (.getTime (-> @*session-state* :google :delegation-access-token :expires_at)))))
                           (let [refresh-token (get-delegation-refresh-token rpc-util/*app-info* (:server_config (get-google-service-props)))
                                 {:keys [scope] :as access-token} (google-sso/refresh-access-token refresh-token
                                                                               (:client-id conf/google-client-config)
                                                                               (:client-secret conf/google-client-config))
                                 scopes (set (.split scope " "))
                                 has-drive? (contains? scopes "https://www.googleapis.com/auth/drive")
                                 app-info (:app-info @*session-state*)]
                             (swap! *session-state* #(assoc-in % [:google :delegation-access-token] access-token))
                             (when has-drive?
                               (swap! apps-with-drive-scope assoc (:id app-info) (select-keys app-info [:name :user_id :user_organisation])))
                             (log/debug "Access token updated:" (-> @*session-state* :google :delegation-access-token))))

                         (assoc-in httpkit-map [:headers "Authorization"]
                                   (str "Bearer " (-> @*session-state* :google :delegation-access-token :access_token))))))

(defn request [httpkit-map creds]

  (let [authenticated-httpkit-map (add-credentials httpkit-map creds)
        resp                     @(http/request (assoc authenticated-httpkit-map :keepalive -1) nil)]

    (when (:error resp)
      ;; TODO: Check that we don't want to return this error message to the client.
      (throw (Exception. (str (:error resp)))))

    (when-not (<= 200 (:status resp) 299)
      (log/trace resp)
      (throw+ {:anvil/server-error (str "Google request failed: "
                                        (or (when (.startsWith (str (-> resp :headers :content-type)) "application/json")
                                              (when-let [j (try (json/read-str (:body resp)) (catch Exception _ nil))]
                                                (or (get j "message")
                                                    (get-in j ["error" "message"])
                                                    (get (first (get-in j ["error" "errors"])) "message"))))
                                            (when (.startsWith (str (-> resp :headers :content-type)) "text/html")
                                              (:body resp))
                                            (str "code " (:status resp))))
               :docId              "google"
               :docLinkTitle       "Learn more about Google integration"}))

    (condp (fn [a b] (.startsWith b a)) (or (-> resp :headers :content-type) "")
      "application/json" (json/read-str (if (empty? (:body resp)) "{}" (:body resp)))
      "application/atom+xml" (xml/parse-str (:body resp))
      "application/binary" (do (log/warn "Binary received. What?!")
                               (log/debug (with-out-str (pprint resp)))
                               (:body resp))
      "text/html" (do
                    (log/warn "Received html. Hmm:")
                    (log/debug (with-out-str (pprint resp)))
                    (:body resp))
      nil)))


(defn whitelist! [type id creds access]
  (when (= creds "google-delegated")
    (swap! *session-state* #(assoc-in % [:google :whitelist type id] access))))

(defn get-whitelist-access [type id creds]
  ;; File is valid if it is an app file, or whitelisted, or a user file.
  (let [google-service-props (get-google-service-props)
        app-files            (-> google-service-props :client_config :app_files)
        app-file             (first (filter #(= (:id %) id) app-files))
        app-permission       (when app-file
                               (if (:permission app-file)
                                 (keyword (:permission app-file))
                                 :rwclient))]

    (or (if (= creds "google-user") :rwclient)
        app-permission
        (get-in @*session-state* [:google :whitelist type id]))))


(defn whitelist-access-ok? [access writing?]
  (cond
    ;; If it's not on the whitelist, instant fail
    (not access) false
    ;; If this is a server request, we're allowed to do anything
    (not *client-request?*) true
    ;; If we're writing, must be an :rwclient file
    writing? (= access :rwclient)
    ;; Else, either :rwclient or :roclient is OK
    :else (#{:rwclient, :roclient} access)))

(defn ensure-whitelist-access-ok
  ([access writing?] (ensure-whitelist-access-ok access writing? nil))
  ([access writing? action]
   (when-not (whitelist-access-ok? access writing?)
     (throw+ {:anvil/server-error (str
                                    (when action
                                      (str "Cannot " action ": "))
                                    (condp = access
                                      :noclient "This app file can only be accessed by a server module"
                                      :roclient "This app file can only be written by a server module"
                                      "Permission denied"))
              :docId "drive_permissions"
              :docLinkTitle "Learn more about Google Drive permissions"}))))

(defn whitelist-ok? [type id creds writing?]
  (whitelist-access-ok? (get-whitelist-access type id creds) writing?))

(defn ensure-whitelist-ok
  ([type id creds writing?] (ensure-whitelist-ok type id creds writing? nil))
  ([type id creds writing? action] (ensure-whitelist-access-ok (get-whitelist-access type id creds) writing? action)))

(def set-google-token-hooks! (util/hook-setter [get-delegation-refresh-token]))
