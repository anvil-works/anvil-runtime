(ns anvil.dispatcher.native-rpc-handlers.users.v2.core
  (:require [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.runtime.tables.v2.rpc :as table-rpc]
            [anvil.dispatcher.native-rpc-handlers.google.auth :as google-auth]
            [anvil.dispatcher.native-rpc-handlers.facebook :as facebook-auth]
            [anvil.dispatcher.native-rpc-handlers.microsoft :as microsoft-auth]
            [anvil.dispatcher.native-rpc-handlers.saml :as saml-auth]
            [anvil.dispatcher.native-rpc-handlers.email :as email]
            [slingshot.slingshot :refer [throw+ try+]]
            [anvil.dispatcher.native-rpc-handlers.cookies :as cookies]
            [anvil.util :as anvil-util]
            [anvil.runtime.util :as runtime-util]
            [ring.util.codec :as codec]
            [anvil.runtime.secrets :as secrets]
            [anvil.dispatcher.native-rpc-handlers.users.v2.fido :as fido]
            [anvil.dispatcher.native-rpc-handlers.users.v2.totp :as totp]
            [anvil.dispatcher.native-rpc-handlers.users.v2.twilio :as twilio]
            [crypto.random :as random]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.sessions :as sessions]
            [anvil.runtime.conf :as runtime-conf]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.native-rpc-handlers.users.v2.util :as user-util :refer [record-login-failure!]]
            [anvil.runtime.tables.util :as table-v1-util]
            [anvil.runtime.tables.rpc :as table-v1-rpc]
            [anvil.runtime.tables.v2.util :as table-util]
            [anvil.runtime.tables.v2.basic-ops :as table-basic-ops]
            [anvil.core.worker-pool :as worker-pool])
  (:import (anvil.dispatcher.types DateTime)
           (java.text SimpleDateFormat)
           (java.util Date)
           (org.mindrot.jbcrypt BCrypt)
           (java.time Instant)
           (java.time.format DateTimeParseException)))


(defn- now-as-table-date []
  (DateTime. (.format (SimpleDateFormat. "yyyy-MM-dd HH:mm:ss.SSSZ") (Date.))))

(defn- is-in-date? [remembered-login remember_me_days]
  (and (:login_time remembered-login)
       (try
         (.isBefore (Instant/now) (.plusSeconds (Instant/parse (:login_time remembered-login))
                                                (* 3600 24 (or remember_me_days 0))))
         (catch DateTimeParseException _
           false))))

(defn- html-link [url]
  (format "<a href=\"%s\">%s</a>" (.replace url "\"" "&quot;") url))

(defn- get-our-origin []
  (or rpc-util/*app-origin*
      (app-data/get-app-origin rpc-util/*environment*)
      (app-data/get-public-app-origin rpc-util/*environment*)
      (throw+ {:anvil/server-error "This app does not have a URL, so we can't send a confirmation email."})))

(defn- get-cookie-type [{:keys [share_login_status] :as _props}]
  (if share_login_status :shared :local))


(defn- get-remember-me-cookie-key [table-id]
  (keyword (str "user-table-" table-id "-remember-me")))


(defn- get-remember-me-token-hash-from-cookie [user-props]
  (let [{:keys [table_id]} user-props
        cookie-key-token (get-remember-me-cookie-key table_id)
        cookie-type (get-cookie-type user-props)]
    (try+
      (when-let [remember-token (cookies/get-cookie-val cookie-type cookie-key-token)]
        (anvil-util/sha-256 (str remember-token "#" table_id)))
      (catch :anvil/cookie-error _ nil))))


(defn- remove-remember-me-cookie [user-props]
  (let [{:keys [table_id]} user-props
        cookie-key-token (get-remember-me-cookie-key table_id)
        cookie-type (get-cookie-type user-props)]
    (try+
      (cookies/del-cookie! cookie-type cookie-key-token)
      (catch :anvil/cookie-error _ nil))))

(defn remove-remember-me-token-hash [{:keys [table_id] :as user-props} token-hash]
  (try+
    (table-v1-util/with-table-transaction
      (when-let [user-row (user-util/table-get-row-from-query table_id {"remembered_logins" [{"token_hash" token-hash}]})]
        (let [remembered-logins (->> (user-util/get-in-user-row user-row :remembered_logins)
                                     (remove #(= (:token_hash %) token-hash))
                                     (vec))]
          (user-util/update-user-row user-row {"remembered_logins" remembered-logins}))))
    ;; Tolerate (eg) collisions in remember-me cookies
    (catch #(and (:anvil/server-error %) (= (:type %) "anvil.tables.TableError") %) e
      (rpc-util/*rpc-println* (str "WARNING: Cannot retrieve user record by remember-me state: " (:anvil/server-error e))))))


(defn- add-login-session-data [user-row]
  (swap! rpc-util/*session-state*
         (fn [state]
           (-> state
               (assoc-in [:users :logged-in-id] (user-util/user-row->v1-id-str user-row))
               (update-in [:users] dissoc :partial-logged-in-id)))))

(defn- remove-login-session-data []
  (swap! rpc-util/*session-state* update-in [:users] dissoc :logged-in-id :partial-logged-in-id))


(defn logout [{:keys [invalidate_client_objects] :as _kws}]
  (when invalidate_client_objects (rpc-util/invalidate-client-objects!))
  (let [user-props (user-util/get-user-props)]
    (remove-login-session-data)
    (when-let [token-hash (get-remember-me-token-hash-from-cookie user-props)]
      (remove-remember-me-cookie user-props)
      (remove-remember-me-token-hash user-props token-hash)))
  nil)


(defn invalidate-all-session-logins [user-id]
  (let [except-session-id (sessions/get-id rpc-util/*session-state*)]
    (doseq [session-id (sessions/list-sessions-for-user-id user-id)
            :when (not= session-id except-session-id)
            :let [session (sessions/load-session-by-id-without-authentication session-id)]
            :when (= (get-in @session [:users :logged-in-id]) user-id)]
      (swap! session dissoc :users)
      (sessions/notify-session-update! session true))))


(defn- set-last-email-cookie [{:keys [table_id] :as user-props} user-row]
  (let [cookie-type (get-cookie-type user-props)
        email (user-util/get-in-user-row user-row :email)]
    (try+
      (cookies/set-cookie! cookie-type {(keyword (str "user-table-" table_id "-last-email")) email} 30)
      (catch :anvil/cookie-error _e
        nil))))


(defn- get-and-set-remember-me-token-hash [{:keys [table_id remember_me_days] :as user-props}]
  (let [new-token (random/base64 32)
        new-token-hash (anvil-util/sha-256 (str new-token "#" table_id))
        cookie-type (get-cookie-type user-props)]
    (try+
      (cookies/set-cookie! cookie-type {(keyword (str "user-table-" table_id "-remember-me")) new-token}
                           remember_me_days)
      new-token-hash
      (catch :anvil/cookie-error e
        (rpc-util/*rpc-println* (str "WARNING: Cannot save login state to cookie: " (:anvil/server-error e)))
        nil))))


(defn- get-remembered-logins-update [{:keys [remember_me_days] :as _user-props} user-row token-hash]
  (->> (user-util/get-in-user-row user-row :remembered_logins)
       (filter #(is-in-date? % remember_me_days))
       (cons {"login_time" (str (Instant/now)), "token_hash" token-hash})
       (vec)))


(defn- set-remember-me-cookie-and-update-row [{ :keys [allow_remember_me] :as user-props} user-row updates remember?]
  (if (and remember? allow_remember_me)
    (when-let [token-hash (get-and-set-remember-me-token-hash user-props)]
      (->> {:remembered_logins (get-remembered-logins-update user-props user-row token-hash)}
           (merge updates)
           (user-util/update-user-row-creating-cols-as-necessary user-row))
      true)
    ;; else, no memory allowed
    (do
      (remove-remember-me-cookie user-props)
      false)))



(defn- last-login-is-too-old? [last-login]
  (try
    (< (-> last-login
           (table-v1-util/datetime->instant)
           (.toEpochMilli))
       (- (System/currentTimeMillis) 5000))
    (catch Exception _ true)))


(defn- should-update-last-login [user-row]
  (let [last-login (user-util/get-in-user-row user-row :last_login)]
    (or (not last-login)
        (last-login-is-too-old? last-login))))


(defn- calculate-login-updates [user-row]
  (merge (when (should-update-last-login user-row)
           {:last_login (now-as-table-date)})
         (when (not= 0 (user-util/get-in-user-row user-row :n_password_failures 0))
           {:n_password_failures 0})))


(defn login! [user-row remember?]
  (let [user-props (user-util/get-user-props)
        updates (calculate-login-updates user-row)]
    (add-login-session-data user-row)
    (set-last-email-cookie user-props user-row)
    ;; false-y value means we didn't do the update
    (when-not (set-remember-me-cookie-and-update-row user-props user-row updates remember?)
      (user-util/update-user-row-creating-cols-as-necessary user-row updates))
    ;; TODO check is this ok - we won't have the updates here
    user-row))


(defn force-login [{:keys [remember fetch] :as _kws} serialized-user-row]
  (rpc-util/require-server! "call force_login()")
  (cond
    (nil? serialized-user-row)
    (logout nil)

    (user-util/is-valid-serialized-user-row? serialized-user-row)
    (-> serialized-user-row
        (user-util/serialized-row->user-row (table-rpc/validate-fetch-request fetch))
        (login! remember))

    :else
    (throw+ {:anvil/server-error "force_login() must be passed a row from the users table"})))


(defn check-password-hash [user-row password]
  (when-not password
     (throw+ {:anvil/server-error "No password provided" :type "anvil.users.AuthenticationFailed"}))
  (let [pw-hash (user-util/get-in-user-row user-row :password_hash)]
    (when-not (anvil.util/bcrypt-checkpw password pw-hash)
      (record-login-failure! user-row)
      (throw+ {:anvil/server-error "Incorrect password" :type "anvil.users.AuthenticationFailed"}))))

(defn get-enabled-mfa-types
  ([] (get-enabled-mfa-types nil))
  ([_kws]
   (concat (when true ["totp"])
           (when true ["fido"])
           (when runtime-conf/twilio-config ["twilio-verify"]))))

; It only makes sense to call this from the client. On the server, you can edit the user row directly.
(defn add-mfa-method [_kws password mfa-method clear-existing]
  (let [{:keys [table_id] :as user-props} (user-util/get-user-props)
        v1-id-str (or (get-in @rpc-util/*session-state* [:users :logged-in-id]) (get-in @rpc-util/*session-state* [:users :mfa-reset-user-id]))
        user-row (user-util/table-get-row-by-id table_id v1-id-str)]
    (check-password-hash user-row password)
    (swap! rpc-util/*session-state* assoc-in [:users :mfa-reset-user-id] nil)
    ;; Add the new MFA method to the end of the list, or to a new list if clear-existing is True
    (let [mfa-methods (if clear-existing [] (user-util/get-in-user-row user-row :mfa))
          mfa-type (:type mfa-method)
          enabled-mfa-types (set (get-enabled-mfa-types))
          _ (when-not (enabled-mfa-types mfa-type)
              (throw+ {:anvil/server-error "MFA method not supported" :type "anvil.users.AuthenticationFailed"}))
          _ (when (some #(= (:id %) (:id mfa-method)) mfa-methods)
              (throw+ {:anvil/server-error "MFA method already exists" :type "anvil.users.AuthenticationFailed"}))
          new-mfa-methods (vec (conj mfa-methods mfa-method))]
      (user-util/update-user-row-creating-cols-as-necessary user-row {:mfa new-mfa-methods})
      new-mfa-methods)))

(defn get-available-mfa-types [_kws email password]
  (let [{:keys [table_id]} (user-util/get-user-props)
        email (.trim ^String (or email ""))
        user-row (user-util/table-get-from-email-check-enabled-and-validate table_id email)
        pw-hash (user-util/get-in-user-row user-row :password_hash)]
    (if-not (anvil.util/bcrypt-checkpw password pw-hash)
      []
      (map :type (user-util/get-in-user-row user-row :mfa [])))))


(defn- check-can-use-email [{:keys [use_email] :as _user-props}]
  (when-not use_email (throw+ {:anvil/server-error "Email/password authentication is not enabled."})))


(defn- check-confirmed-email [{:keys [confirm_email] :as _user-props} user-row]
  (when (and confirm_email user-row (not (user-util/get-in-user-row user-row :confirmed_email)))
    (throw+ {:anvil/server-error "You haven't confirmed your email address. Please check your email and click the confirmation link, or reset your password."
             :type               "anvil.users.EmailNotConfirmed"})))

(defn- check-password-failures [{:keys [max_password_failures] :as _user-props} user-row]
  (let [n-password-failures (let [f (user-util/get-in-user-row user-row :n_password_failures)]
                              (if (number? f) f 0))]
    (when (>= n-password-failures (or max_password_failures 10))
      (throw+ {:anvil/server-error "You have entered an incorrect password too many times. Please reset your password by email."
               :type               "anvil.users.TooManyPasswordFailures"}))))


(defn- check-password [{:keys [max_password_failures] :as _user-props} user-row password]
  (let [pw-hash (user-util/get-in-user-row user-row :password_hash)
        n-password-failures (let [f (user-util/get-in-user-row user-row :n_password_failures)]
                              (if (number? f) f 0))]

    (when-not (anvil.util/bcrypt-checkpw password pw-hash)
      (record-login-failure! user-row)
      (throw+ {:anvil/server-error "Incorrect email address or password"
               :type               (if (>= (inc n-password-failures) (or max_password_failures 10))
                                     "anvil.users.TooManyPasswordFailures"
                                     "anvil.users.AuthenticationFailed")}))))


;; TODO: We could unconditionally remember any MFA methods that are validated, allowing signup to carry over to login.
(defn- maybe-remember-mfa! [{:keys [mfa_timeout_days] :as user-props} {:keys [mfa-cookie-key]} {:keys [id serial]}]
  (when (and mfa_timeout_days (> mfa_timeout_days 0))
    (let [cookie-type (get-cookie-type user-props)
          cookie {mfa-cookie-key (str id "#" serial "#" (System/currentTimeMillis))}]
      (try+
        (cookies/set-cookie! cookie-type cookie mfa_timeout_days)
        (catch :anvil/cookie-error e (log/trace e))))))


(defn- check-mfa-totp [user-props user-row {:keys [matching-mfa-methods mfa] :as mfa-props}]
  (if-let [mfa-method (some #(when (totp/validate-totp-code nil % (:code mfa)) %) matching-mfa-methods)]
    (maybe-remember-mfa! user-props mfa-props mfa-method)
    (do
      (record-login-failure! user-row)
      (throw+ {:anvil/server-error "Incorrect authentication code" :type "anvil.users.AuthenticationFailed"}))))


(defn- find-and-validate-fido-method [{:keys [matching-mfa-methods mfa] :as _mfa-props}]
  (some
    #(when-let [updated-mfa-method (fido/validate-fido-assertion % (:result mfa))]
       [% updated-mfa-method]) matching-mfa-methods))


(defn- check-mfa-fido [{:keys [table_id] :as user-props} user-row {:keys [mfa-methods] :as mfa-props}]
  (if-let [[mfa-method updated-mfa-method] (find-and-validate-fido-method mfa-props)]
    ;; We have successfully validated against mfa-method, which has incremented its signCount. Save the updated method to the user object.
    (let [new-mfa-methods (vec (map #(if (= % mfa-method) updated-mfa-method %) mfa-methods))]
      (user-util/update-user-row-creating-cols-as-necessary user-row {:mfa new-mfa-methods})
      (maybe-remember-mfa! user-props mfa-props updated-mfa-method))
    (do
      (record-login-failure! user-row)
      (throw+ {:anvil/server-error "Two-factor authentication failed" :type "anvil.users.AuthenticationFailed"}))))

(defn- check-mfa-twilio-verify [user-props user-row {:keys [mfa matching-mfa-methods] :as mfa-props}]
  (if-let [mfa-method (some #(when (twilio/check-verification-token nil % (:code mfa)) %) matching-mfa-methods)]
    (maybe-remember-mfa! user-props mfa-props mfa-method)
    (do
      (record-login-failure! user-row)
      (throw+ {:anvil/server-error "Incorrect authentication code" :type "anvil.users.AuthenticationFailed"}))))


(defn- check-mfa-methods [user-props user-row {:keys [mfa-type matching-mfa-methods] :as mfa-props}]
  (if (empty? matching-mfa-methods)
    (throw+ {:anvil/server-error "No matching MFA method available" :type "anvil.users.AuthenticationFailed"})
    (case mfa-type
      "totp" (check-mfa-totp user-props user-row mfa-props)
      "fido" (check-mfa-fido user-props user-row mfa-props)
      "twilio-verify" (check-mfa-twilio-verify user-props user-row mfa-props)
      ; We should never get here.
      (throw+ {:anvil/server-error "MFA method not supported" :type "anvil.users.AuthenticationFailed"}))))


(defn- get-remembered-mfa-cookie [user-props mfa-cookie-key]
  (let [cookie-type (get-cookie-type user-props)]
    (try+
      (cookies/get-cookie-val cookie-type mfa-cookie-key)
      (catch :anvil/cookie-error _ nil))))


(defn check-remembered-mfa [{:keys [mfa_timeout_days] :as user-props} user-row {:keys [mfa-cookie-key mfa-methods] :as mfa-props} partial-logged-in-id]
  (let [remembered-mfa (get-remembered-mfa-cookie user-props mfa-cookie-key)
        [method-id method-serial validation-time] (.split (or remembered-mfa "") "#")]
    ; We have remembered a previous MFA login. Check that it's still valid
    (when-not (some #(and (= (:id %) method-id)
                          (= (:serial %) (Integer/parseInt (or method-serial "0")))
                          (< (- (System/currentTimeMillis) (Long/parseLong (or validation-time "0"))) (* (or mfa_timeout_days 0) 24 60 60 1000))) mfa-methods)
      (reset! partial-logged-in-id (user-util/user-row->v1-id-str user-row))
      (throw+ {:anvil/server-error "MFA authentication required." :type "anvil.users.MFARequired"}))))


(defn- get-mfa-props [mfa {:keys [table_id] :as _user-props} user-row email]
  (let [mfa-methods (user-util/get-in-user-row user-row :mfa)
        mfa-cookie-key (keyword (str "user-table-" table_id "-user-" (.substring (anvil-util/sha-256 email) 0 8) "-mfa-validation"))
        mfa-type (:type mfa)]
    {
     :mfa                  mfa
     :mfa-type             (:type mfa)
     :mfa-cookie-key       mfa-cookie-key
     :mfa-methods          mfa-methods
     :matching-mfa-methods (filter #(= mfa-type (get % :type)) mfa-methods)}))


(defn- check-mfa [mfa {:keys [require_mfa] :as user-props} user-row email partial-logged-in-id]
  (when require_mfa
    (let [mfa-props (get-mfa-props mfa user-props user-row email)]
      (if mfa
        (check-mfa-methods user-props user-row mfa-props)
        (check-remembered-mfa user-props user-row mfa-props partial-logged-in-id)))))


(defn login-with-email [{:keys [remember mfa fetch] :as _kws} email password]
  (let [partial-logged-in-id (atom nil)
        fetch-spec (table-rpc/validate-fetch-request fetch)]
    (try
      (let [{:keys [table_id] :as user-props} (user-util/get-user-props)
            _ (check-can-use-email user-props)
            user-row (user-util/table-get-from-email-check-enabled-and-validate table_id (.trim ^String (or email "")) fetch-spec)]
        (check-confirmed-email user-props user-row)
        (check-password-failures user-props user-row)
        (check-password user-props user-row password)
        (check-mfa mfa user-props user-row email partial-logged-in-id)
        (login! user-row remember))
      (finally
        ;; No matter what happens, set the partially-logged-in user ID or clear it explicitly.
        (if-let [partial-logged-in-id @partial-logged-in-id]
          (swap! rpc-util/*session-state* assoc-in [:users :partial-logged-in-id] partial-logged-in-id)
          (swap! rpc-util/*session-state* update-in [:users] dissoc :partial-logged-in-id))))))


(defn generate-email-link-token [_kwargs email type]
  (let [token (str email "#" rpc-util/*app-id* "#" (System/currentTimeMillis) "#" type)]
    (secrets/encrypt-str-with-global-key :ut token)))


(defn- parse-decrypted-token [decrypted-token]
  (when decrypted-token
    (let [[email token-app-id token-time token-type] (.split (or decrypted-token "") "#")]
      {:email email :token-app-id token-app-id :token-time token-time :token-type token-type})))


(defn- get-decrypted-token [token]
  (try (-> (secrets/decrypt-str-with-global-key :ut token)
           parse-decrypted-token) (catch Exception _ nil)))

(defn- is-valid-token? [user-row app { :keys [token-app-id token-time] :as decrypted-token}]
  (and user-row                                 ; Is this a valid user?
       (= token-app-id (:id app))               ; Is the token for this app?
       (< (- (System/currentTimeMillis) (Long/parseLong (or token-time "0"))) ; Is the token still valid?
          (* 10 60 1000)))) ; Ten minute timeout


(defn do-login-with-token [app environment session-state token fetch-spec]
  (binding [rpc-util/*app* (:content app)
            rpc-util/*app-id* (:id app)
            rpc-util/*environment* environment
            rpc-util/*rpc-print* #(log/info "Token login output:" %&)]

    (when-let [{:keys [email token-type] :as decrypted-token} (get-decrypted-token token)]
      (let [{:keys [table_id use_token]} (user-util/get-user-props)
            user-row (user-util/table-get-from-email-check-enabled-and-validate table_id email fetch-spec)]
        (when (is-valid-token? user-row app decrypted-token)
          (cond
            (and use_token (= token-type "login"))
            ;; Token login is enabled in this app: Log in.
            (do
              (swap! session-state assoc-in [:users :logged-in-id] (user-util/user-row->v1-id-str user-row))
              ; Return the logged-in user
              user-row)

            (= token-type "mfa-reset")
            ;; This is an mfa-reset token, store it in the session so the client can find it.
            (do
              (swap! session-state assoc-in [:users :mfa-reset-user-id] (user-util/user-row->v1-id-str user-row))
              ; The user is still not logged in, so only reveal that this worked and nothing more
              true)

            (= token-type "pw-reset")
            (do
              (swap! session-state assoc-in [:users :password-reset-user-id] (user-util/user-row->v1-id-str user-row))
              ; The user is still not logged in, so only reveal that this worked and nothing more
              true)))))))

              ;; TODO: Add token type for email verification


(defn login-with-token [{:keys [fetch] :as _kws} token]
  (let [fetch-spec (table-rpc/validate-fetch-request fetch)]
    (do-login-with-token {:id rpc-util/*app-id* :content rpc-util/*app*} rpc-util/*environment* rpc-util/*session-state* token fetch-spec)))



(def required-permission->email-getter
  {:use_google    google-auth/get-user-email
   :use_facebook  facebook-auth/get-user-email
   :use_microsoft microsoft-auth/get-user-email
   :use_saml      saml-auth/get-user-email})

(def required-permission->auth-name
  {:use_google "Google"
   :use_facebook "Facebook"
   :use_microsoft "Microsoft"
   :use_saml "SAML"
   :use_email "Email/password"})


(def default-automatic-login-keys [:enable_automatically])

(def required-permission->automatic-login-preds
  {:use_google default-automatic-login-keys
   :use_facebook default-automatic-login-keys
   :use_microsoft default-automatic-login-keys
   :use_saml default-automatic-login-keys
   :use_email [:enable_automatically (complement :confirm_email)]})


(defn required-permission->can-login-automatically? [required-permission user-props]
  (as-> required-permission m
        (required-permission->automatic-login-preds m)
        (apply every-pred m)
        (m user-props)))



(defn check-client-can-signup [{:keys [table_id allow_signup enable_automatically] :as user-props}]
  (when (and rpc-util/*client-request?* (not allow_signup))
    (throw+ {:anvil/server-error "Signups from client code are not enabled."})))


(defn check-can-use-authentication-method [user-props required-permission]
  (when-not (get user-props required-permission)
    (throw+ {:anvil/server-error (str (required-permission->auth-name required-permission) " authentication is not enabled.")})))


(defn get-and-check-current-user-email-from-required-permission [required-permission]
  (let [email-getter (required-permission->email-getter required-permission)
        current-user-email (email-getter {})]
    (when-not current-user-email
      (throw+ {:anvil/server-error (str "User is not logged in with " (required-permission->auth-name required-permission))}))
    current-user-email))


(defn add-new-user-from-signup [required-permission user-props email {:keys [fetch remember]} {:keys [attrs] :as opts}]
  (let [{:keys [table_id enable_automatically] :as _user-props} user-props
        ;; Include :last_login nil to ensure the column exists (login! reads it later),
        ;; but don't set a date — the user may not be auto-logged-in (e.g. email confirmation required).
        attributes (merge attrs {:signed_up   (now-as-table-date)
                                 :last_login  nil
                                 :enabled     (boolean enable_automatically)
                                 :email       (.toLowerCase email)})
        new-user (user-util/add-new-user table_id attributes (table-rpc/validate-fetch-request fetch))]
    (if (required-permission->can-login-automatically? required-permission user-props)
      (do
        (user-util/validate-enabled-user! (user-util/row-to-map new-user))
        (login! new-user remember))
      new-user)))


(defn signup-common-from-email [required-permission email {:keys [table_id] :as user-props} kws & {:keys [attrs] :as opts}]
  (check-client-can-signup user-props)
  (check-can-use-authentication-method user-props required-permission)
  (table-v1-util/with-table-transaction
    (if-let [user-row (user-util/table-get-from-email-check-enabled-and-validate table_id email)]
      (throw+ {:anvil/server-error "This user already exists", :type "anvil.users.UserExists"})
      (add-new-user-from-signup required-permission user-props email kws opts))))



(defn signup-common [required-permission kws]
  (let [current-user-email (get-and-check-current-user-email-from-required-permission required-permission)
        user-props (user-util/get-user-props)]
    (signup-common-from-email required-permission current-user-email user-props kws)))


(defn login-common [required-permission {:keys [remember fetch] :as kws}]
  (let [{:keys [table_id allow_signup] :as user-props} (user-util/get-user-props)
        _ (check-can-use-authentication-method user-props required-permission)
        current-user-email (get-and-check-current-user-email-from-required-permission required-permission)
        fetch-spec (table-rpc/validate-fetch-request fetch)
        user-row (user-util/table-get-from-email-check-enabled-and-validate table_id current-user-email fetch-spec)]
    (cond
      user-row (login! user-row remember)
      allow_signup (signup-common-from-email required-permission current-user-email user-props kws)
      :else (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))


(def login-with-google (partial login-common :use_google))

(def signup-with-google (partial signup-common :use_google))

(def login-with-facebook (partial login-common :use_facebook))

(def signup-with-facebook (partial signup-common :use_facebook))

(def login-with-microsoft (partial login-common :use_microsoft))

(def signup-with-microsoft (partial signup-common :use_microsoft))

(def login-with-saml (partial login-common :use_saml))

(def signup-with-saml (partial signup-common :use_saml))

(def default-emails
  {:token_login     {:subject_suffix "Login"
                     :html           "<p>Hi there,</p>\n\n<p>A login request was received for your account ({{email}}). To log in, click the link below:</p>\n\n<p>{{login_link}}</p>\n\n<p>This link will expire in ten minutes.</p>"}

   :mfa_reset       {:subject_suffix "Authentication Reset"
                     :html           "<p>Hi there,</p>\n\n<p>A two-factor authentication reset request was received for your account {{email}}. To continue, click the link below.</p>\n\n<p>{{login_link}}</p>\n\n<p>This link will expire in ten minutes.</p>"}

   :confirm_address {:subject "Confirm your email address"
                     :html    (str "<p>Thanks for registering your account with us. Please click the following link to confirm that this is your account:</p>\n\n"
                                   "<p>{{confirm_link}}</p>\n\n"
                                   "<p>Thanks,</p>\n"
                                   "<p>The team</p>")}

   :reset_password  {:subject "Reset your password"
                     :html    (str "<p>Hi there,</p>\n\n<p>You have requested a password reset for your account {{email}}. To reset your password, click the link below:</p>\n\n<p>{{reset_link}}</p>\n\n<p>This link will expire in ten minutes.</p>")}})

(defn send-email! [service-props to email-name text-subs link-subs]
  (let [{:keys [email_content email_from_address]} service-props
        ;; only allow overriding email content for trusted apps; otherwise could become a spam free-for-all
        email_content (when-not (app-data/abuse-caution? rpc-util/*session-state* rpc-util/*app-id*)
                        email_content)
        from-name (if (app-data/abuse-caution? rpc-util/*session-state* rpc-util/*app-id*)
                    "Accounts"
                    (str (or (:name rpc-util/*app-info*) (:name rpc-util/*app*)) " Accounts"))
        from-address (or email_from_address "accounts")
        subject (or (get-in email_content [email-name :subject])
                    (get-in default-emails [email-name :subject])
                    (str (:name rpc-util/*app*) " " (get-in default-emails [email-name :subject_suffix])))

        replace-subs (fn [html subs f]
                       (reduce (fn [^String html [sub-name sub]]
                                 (.replace html (str "{{" (name sub-name) "}}") ^String (f sub)))
                               html subs))
        html (-> (or (get-in email_content [email-name :html])
                     (get-in default-emails [email-name :html]))
                 (replace-subs text-subs identity)
                 (replace-subs link-subs html-link))
        text (-> html
                 (.replaceAll "\n" "")
                 (.replaceAll "^<p>" "")
                 (.replace "<p>" "\n\n")
                 (.replace "<br>" "\n")
                 (.replaceAll "<[^>]*>" "")
                 (.replace "&lt;" "<")
                 (.replace "&gt;" ">")
                 (.replace "&amp;" "&")
                 (.replace "&quot;" "\""))]
    (if (get-in @rpc-util/*session-state* [:users :test-email-divert])
      (swap! rpc-util/*session-state* update-in [:users :test-email-divert] concat [{:to to, :from_name from-name, :from_address from-address, :subject subject, :text text}])
      (binding [email/*use-quota* false
                email/*require-service-config* false]
        (email/send! {:from_name    from-name
                      :from_address from-address
                      :to           to
                      :subject      subject
                      :text         text
                      :html         html})))))


(defn- check-can-use-token [{:keys [use_token] :as user-props}]
  (when (not use_token)
    (throw+ {:anvil/server-error "Token login is not enabled." :type "anvil.users.AuthenticationFailed"})))

(defn- check-non-empty-email [email]
  (when (empty? email)
    (throw+ {:anvil/server-error "Please provide an email address." :type "anvil.users.AuthenticationFailed"})))

(defn- check-user-exists [user-row]
  (when-not user-row
    (throw+ {:anvil/server-error "User disabled, or not found." :type "anvil.users.AuthenticationFailed"})))


(defn- send-login-token-link [user-props email]
  (let [login-link (str (get-our-origin)
                        "/_/login/"
                        (anvil-util/real-actual-genuine-url-encoder (generate-email-link-token nil email "login")))]
    (send-email! user-props email :token_login {:email email :login_url login-link} {:login_link login-link})
    nil))


(defn send-token-login-email [_kws email]
  (let [{:keys [table_id ] :as user-props} (user-util/get-user-props)]
    ;; We're only allowed to call this from the client if logging in with a token is enabled. We can call this from the server either way.
    (check-can-use-token user-props)
    (check-non-empty-email email)
    (let [user-row (user-util/table-get-from-email-check-enabled-and-validate table_id email)]
      (check-user-exists user-row)
      (send-login-token-link user-props email))))


(defn- can-send-mfa-reset-email-to-user? [{:keys [require_mfa allow_mfa_email_reset] :as _user-props} user-row]
  ;; Only send the email if reset is allowed, or if mfa is required, and we have no methods available.
  ;; user-row must have mfa in the fetch-spec
  (cond
    allow_mfa_email_reset true
    (and require_mfa (empty? (user-util/get-in-user-row user-row :mfa))) true
    :else false))

(defn- check-can-send-mfa-reset-email-to-user [user-props user-row]
  ;; user-row must have mfa in the fetch-spec
  (when-not (can-send-mfa-reset-email-to-user? user-props user-row)
    (throw+ {:anvil/server-error "Cannot reset two-factor authentication by email." :type "anvil.users.AuthenticationFailed"})))


(defn- send-mfa-reset-link [user-props email]
  (let [login-link (str (get-our-origin)
                        "/_/login/"
                        (anvil-util/real-actual-genuine-url-encoder (generate-email-link-token nil email "mfa-reset")))]
    (send-email! user-props email :mfa_reset {:email email :login_url login-link} {:login_link login-link})
    nil))


(defn send-mfa-reset-email [_kws email]
  (let [{:keys [table_id] :as user-props} (user-util/get-user-props)]
    (check-non-empty-email email)
    (let [user-row (try+
                     (user-util/table-get-from-email-check-enabled-and-validate table_id email)
                     (catch #(= "anvil.users.AccountIsNotEnabled" (:type %)) _
                       nil))]
      (if user-row
        (do
          (check-can-send-mfa-reset-email-to-user user-props user-row)
          (send-mfa-reset-link user-props email))
        (when-not runtime-conf/dont-confirm-emails-during-auth?
          (throw+ {:anvil/server-error "User disabled, or not found." :type "anvil.users.AuthenticationFailed"}))))))


(defn- check-secure-password [{:keys [require_secure_passwords] :as _user-props} password]
  (when (and require_secure_passwords
             (< (.length (str password)) 7))
    (throw+ {:anvil/server-error "Passwords must be 8 characters or more" :type "anvil.users.PasswordNotAcceptable"}))
  (when (and require_secure_passwords
             (or (< (.length password) 6) (runtime-util/is-password-pwned? password)))
    (throw+ {:anvil/server-error "This password is not safe to use: It has previously been leaked and posted on the internet." :type "anvil.users.PasswordNotAcceptable"})))


(defn- check-mfa-requirements [{:keys [require_mfa] :as _user-props} {:keys [mfa_method] :as _kws}]
  (when (and require_mfa
             (not mfa_method))
    (throw+ {:anvil/server-error "MFA authentication required" :type "anvil.users.MFARequired"}))

  (when (and require_mfa
             (not ((set (get-enabled-mfa-types)) (:type mfa_method))))
    (throw+ {:anvil/server-error "MFA type not supported" :type "anvil.users.MFARequired"})))


(defn- maybe-send-confirmation-email [{:keys [confirm_email] :as user-props} email confirmation-key]
  (when confirm_email
    (let [confirm-url (format "%s/_/email-confirm/%s/%s"
                              (get-our-origin)
                              (codec/url-encode email)
                              (codec/url-encode confirmation-key))]
      (send-email! user-props email :confirm_address {:email email :confirm_url confirm-url} {:confirm_link confirm-url}))))


(defn get-new-user-signup-with-email [{:keys [confirm_email require_mfa] :as user-props} {:keys [mfa_method] :as kws} email password confirmation-key]
  (let [attrs (cond-> {:password_hash (BCrypt/hashpw password (BCrypt/gensalt))}
                confirm_email (assoc :confirmed_email false, :email_confirmation_key confirmation-key)
                require_mfa (assoc :mfa [mfa_method]))]
    (signup-common-from-email :use_email email user-props kws {:attrs attrs})))


(defn signup-with-email [kws email password]
  (let [user-props (user-util/get-user-props)]
    (check-mfa-requirements user-props kws)
    (check-secure-password user-props password)
    (let [email (.trim (.toLowerCase ^String (or email "")))
          confirmation-key (random/url-part 10)
          new-user (get-new-user-signup-with-email user-props kws email password confirmation-key)]
      (maybe-send-confirmation-email user-props email confirmation-key)
      new-user)))

(defn- do-send-password-reset-email! [user-props email]
  (let [reset-link (str (get-our-origin)
                        "/_/reset_password/"
                        (anvil-util/real-actual-genuine-url-encoder (generate-email-link-token nil email "pw-reset")))
        request rpc-util/*req*]
    (worker-pool/run-task! ::send-reset-email
                           (rpc-util/with-basic-native-bindings-from-request
                             request
                             (send-email! user-props email :reset_password {:email email :reset_url reset-link} {:reset_link reset-link})))
    (when-not runtime-conf/dont-confirm-emails-during-auth?
      true)))

(defn send-password-reset-email [_kws email]
  (let [{:keys [table_id] :as user-props} (user-util/get-user-props)]
    (check-can-use-email user-props)
    (check-non-empty-email email)
    (if (user-util/table-get-from-email-check-enabled-and-validate table_id email)
      (do-send-password-reset-email! user-props email)
      (when-not runtime-conf/dont-confirm-emails-during-auth?
        (throw+ {:anvil/server-error "This username does not exist or is disabled." :type "anvil.users.AuthenticationFailed"})))))

(defn call-if-confirmation-key-correct [app environment email confirmation-key require-settings f]
  (binding [rpc-util/*app* (:content app)
            rpc-util/*app-id* (:id app)
            rpc-util/*environment* environment
            rpc-util/*session-state* (or rpc-util/*session-state* (sessions/empty-dummy-session))
            rpc-util/*rpc-print* #(log/info "Email confirmation table output:" %&)]
    (let [{:keys [table_id use_email] :as props} (user-util/get-user-props)]
      (when (and use_email (every? props require-settings))
        (let [user-row (user-util/table-get-row-from-query table_id {:email email})
              real-confirmation-key (user-util/get-in-user-row user-row :email_confirmation_key)]

          (when (and real-confirmation-key
                     (= (anvil-util/sha-256 real-confirmation-key) (anvil-util/sha-256 confirmation-key)))
            (f user-row)))))))

(defn set-if-confirmation-key-correct [app environment email confirmation-key require-settings new-attributes]
  (call-if-confirmation-key-correct app environment email confirmation-key require-settings
                                    (fn [user-row]
                                      (user-util/update-user-row-creating-cols-as-necessary user-row new-attributes)
                                      true)))


(defn confirm-email [app environment email confirmation-key]
  (set-if-confirmation-key-correct app environment email confirmation-key #{:allow_signup :confirm_email}
                                   {:confirmed_email true, :email_confirmation_key nil}))


(defn email-password-reset-key-valid? [app environment email confirmation-key]
  (call-if-confirmation-key-correct app environment email confirmation-key #{} (constantly true)))

; To stop the password reset box from popping up multiple times if you cancel it.
(defn cancel-password-reset [_kws]
  (swap! rpc-util/*session-state* assoc-in [:users :password-reset-user-id] nil)
  nil)

(defn- check-old-password [user-row old-password]
  (let [pw-hash (user-util/get-in-user-row user-row :password_hash)]
    (when-not (anvil.util/bcrypt-checkpw old-password pw-hash)
      (record-login-failure! user-row)
      (throw+ {:anvil/server-error "Incorrect password" :type "anvil.users.AuthenticationFailed"}))))


(defn- update-user-row-after-password-reset [{:keys [confirm_email] :as _user-props} user-row new-password email-reset-user]
  (let [password-failures (user-util/get-in-user-row user-row :n_password_failures)
        updated-attrs (cond-> {:password_hash (BCrypt/hashpw new-password (BCrypt/gensalt))}
                        (and confirm_email email-reset-user) (assoc :confirmed_email true)
                        (number? password-failures) (assoc :n_password_failures 0))]
    (user-util/update-user-row-creating-cols-as-necessary user-row  updated-attrs)))


(defn reset-password [_kwargs old-password new-password]
  (let [{:keys [table_id confirm_email] :as user-props} (user-util/get-user-props)
        email-reset-user (get-in @rpc-util/*session-state* [:users :password-reset-user-id])
        v1-row-id-str (or (get-in @rpc-util/*session-state* [:users :logged-in-id]) email-reset-user)
        user-row (user-util/table-get-row-by-id table_id v1-row-id-str)
        password-failures (user-util/get-in-user-row user-row :n_password_failures)]

    (when-not email-reset-user
      ;; Don't require old password when resetting by token.
      (check-old-password user-row old-password))
    (check-secure-password user-props new-password)

    (swap! rpc-util/*session-state* assoc-in [:users :password-reset-user-id] nil)
    (update-user-row-after-password-reset user-props user-row new-password email-reset-user)
    (invalidate-all-session-logins v1-row-id-str)
    true))


(defn reset-email-password! [app environment email confirmation-key password]
  (let [mapping (table-v1-util/table-mapping-for-environment environment rpc-util/*session-state*)
        {:keys [confirm_email] :as user-props} (user-util/get-user-props mapping (:content app))]
    (check-secure-password user-props password)
    (set-if-confirmation-key-correct app environment email confirmation-key #{}
                                     (merge
                                       {:email_confirmation_key nil
                                        :password_hash          (BCrypt/hashpw password (BCrypt/gensalt))}
                                       (when confirm_email
                                         {:confirmed_email true})))))


(defn- get-user-from-session [{:keys [table_id] :as _user-props} fetch-spec]
  (when-let [user-id (get-in @rpc-util/*session-state* [:users :logged-in-id])]
    (user-util/table-get-row-by-id table_id user-id fetch-spec)))


(defn- is-valid-remembered-user? [user-row remember-me-days]
  (and user-row
       (user-util/get-in-user-row user-row :enabled)
       (some #(is-in-date? % remember-me-days)
             (user-util/get-in-user-row user-row :remembered_logins))))


(defn- fetch-user-by-remember-token-hash [{:keys [table_id] :as user-props} fetch-spec]
  (when-let [token-hash (get-remember-me-token-hash-from-cookie user-props)]
    (try+
      (user-util/table-get-row-from-query table_id {"remembered_logins" [{"token_hash" token-hash}]} fetch-spec)
      (catch #(and (:anvil/server-error %) (= (:type %) "anvil.tables.TableError") %) e
        (rpc-util/*rpc-println* (str "WARNING: Cannot retrieve user record by remember-me state: " (:anvil/server-error e)))
        nil))))


(defn- get-user-from-remember-me [{:keys [remember_me_days] :as user-props} fetch-spec]
  (when-let [user-row (fetch-user-by-remember-token-hash user-props fetch-spec)]
    (if (is-valid-remembered-user? user-row remember_me_days)
      user-row
      (do
        ;; User found but invalid, remove token and return nil
        (remove-remember-me-cookie user-props)
        nil))))


(defn- check-whether-reset-requested [user-props _testing-reset-request]
  (let [{:keys [use_email]} user-props]
    (when (and use_email
               (or rpc-util/*client-request?* _testing-reset-request)
               (get-in @rpc-util/*session-state* [:users :password-reset-user-id]))
      (throw+ {:anvil/server-error "Password reset requested" :type "anvil.users.PasswordResetRequested"}))))


(defn- check-whether-mfa-required [user-props]
  (let [{:keys [require_mfa]} user-props]
    (when (and require_mfa
               rpc-util/*client-request?*
               (get-in @rpc-util/*session-state* [:users :mfa-reset-user-id]))
      (throw+ {:anvil/server-error "MFA authentication required" :type "anvil.users.MFARequired"}))))


(defn get-current-user [{:keys [fetch allow_remembered _anvil_test_tell_me_if_reset_requested]} & args]
  (let [user-props (user-util/get-user-props)
        fetch-spec (table-rpc/validate-fetch-request fetch)]
    (check-whether-reset-requested user-props _anvil_test_tell_me_if_reset_requested)
    (or
      (get-user-from-session user-props fetch-spec)
      (do
        (check-whether-mfa-required user-props)
        (when (and allow_remembered (:allow_remember_me user-props))
          (get-user-from-remember-me user-props fetch-spec))))))


(defn get-current-user-email [kws]
  (-> (get-current-user kws)
      (user-util/get-in-user-row :email)))


(defn get-last-login-email [_kws]
  (let [{:keys [table_id] :as user-props} (user-util/get-user-props)
        cookie-type (get-cookie-type user-props)]
    (try+
      (cookies/get-cookie-val cookie-type (keyword (str "user-table-" table_id "-last-email")))
      (catch :anvil/cookie-error _
        ; We don't care if cookies didn't work.
        nil))))

(defn sanitize-row-for-client [user-row]
  (if-not rpc-util/*client-request?*
    user-row
    (let [[view-key, table-id, row-id, table-data] user-row]
     [view-key table-id row-id (table-basic-ops/clean-table-data-for-client table-data table-id row-id)])))


(defn convert-to-live-object-if-necessary [user-row]
  (if (user-util/is-v2-tables-enabled?)
    user-row
    (let [[_ table-id _ _] user-row]
      (binding [rpc-util/*client-request?* false]
        ((table-v1-rpc/Table "get_by_id") [table-id {}] {} (user-util/user-row->v1-id-str user-row))))))

(defn- is-user-row? [user-row]
  (vector? user-row))

(defn sanitize-row-wrapper [handler]
  (fn [& args]
    (let [maybe-user-row (apply handler args)]
      (if (is-user-row? maybe-user-row)
        (-> maybe-user-row
            sanitize-row-for-client
            convert-to-live-object-if-necessary)
        maybe-user-row))))

;; --- Handler switching utilities for v2/v1 ---
(ns-unmap *ns* 'switch-to-users-v2-impl!)
(ns-unmap *ns* 'switch-to-users-v1-impl!)

(defn v2-users-handlers []
  {"anvil.private.users.get_current_user"          (rpc-util/wrap-native-fn (sanitize-row-wrapper get-current-user))
   "anvil.private.users.get_current_user_email"    (rpc-util/wrap-native-fn get-current-user-email)
   "anvil.private.users.get_last_login_email"      (rpc-util/wrap-native-fn get-last-login-email)
   "anvil.private.users.logout"                    (rpc-util/wrap-native-fn logout)
   "anvil.private.users.login_with_token"          (rpc-util/wrap-native-fn (sanitize-row-wrapper login-with-token))
   "anvil.private.users.login_with_email"          (rpc-util/wrap-native-fn (sanitize-row-wrapper login-with-email))
   "anvil.private.users.login_with_google"         (rpc-util/wrap-native-fn (sanitize-row-wrapper login-with-google))
   "anvil.private.users.login_with_facebook"       (rpc-util/wrap-native-fn (sanitize-row-wrapper login-with-facebook))
   "anvil.private.users.login_with_microsoft"      (rpc-util/wrap-native-fn (sanitize-row-wrapper login-with-microsoft))
   "anvil.private.users.login_with_saml"           (rpc-util/wrap-native-fn (sanitize-row-wrapper login-with-saml))
   "anvil.private.users.force_login"               (rpc-util/wrap-native-fn (sanitize-row-wrapper force-login))
   "anvil.private.users.signup_with_email"         (rpc-util/wrap-native-fn (sanitize-row-wrapper signup-with-email))
   "anvil.private.users.send_password_reset_email" (rpc-util/wrap-native-fn send-password-reset-email)
   "anvil.private.users.signup_with_google"        (rpc-util/wrap-native-fn (sanitize-row-wrapper signup-with-google))
   "anvil.private.users.signup_with_facebook"      (rpc-util/wrap-native-fn (sanitize-row-wrapper signup-with-facebook))
   "anvil.private.users.signup_with_microsoft"     (rpc-util/wrap-native-fn (sanitize-row-wrapper signup-with-microsoft))
   "anvil.private.users.signup_with_saml"          (rpc-util/wrap-native-fn (sanitize-row-wrapper signup-with-saml))
   "anvil.private.users.reset_password"            (rpc-util/wrap-native-fn reset-password)
   "anvil.private.users.cancel_password_reset"     (rpc-util/wrap-native-fn cancel-password-reset)
   "anvil.private.users.send_token_login_email"    (rpc-util/wrap-native-fn send-token-login-email)
   "anvil.private.users.generate_email_link_token" (rpc-util/wrap-native-fn generate-email-link-token)
   "anvil.private.users.add_mfa_method"            (rpc-util/wrap-native-fn add-mfa-method)
   "anvil.private.users.get_available_mfa_types"   (rpc-util/wrap-native-fn get-available-mfa-types)
   "anvil.private.users.get_enabled_mfa_types"     (rpc-util/wrap-native-fn get-enabled-mfa-types)
   "anvil.private.users.send_mfa_reset_email"      (rpc-util/wrap-native-fn send-mfa-reset-email)})

(defn v1-users-handlers []
  (require 'anvil.dispatcher.native-rpc-handlers.users.core)
  ((resolve 'anvil.dispatcher.native-rpc-handlers.users.core/v1-users-handlers)))

(defn switch-to-users-v2-impl! []
  (swap! dispatcher/native-rpc-handlers merge (v2-users-handlers))
  (log/debug "[users] Switched to v2 implementation"))

(defn switch-to-users-v1-impl! []
  (swap! dispatcher/native-rpc-handlers merge (v1-users-handlers))
  (log/debug "[users] Switched to v1 implementation"))

;; Default: install v2 handlers on load.
(switch-to-users-v2-impl!)


(defn export-with-table [yaml app-id version-spec]
  (let [SERVICE-URL "/runtime/services/anvil/users.yml"
        app (app-data/get-app (app-data/get-app-info-insecure app-id) version-spec)]

    (update-in yaml [:services] (partial map #(if (= SERVICE-URL (:source %))
                                                (assoc % :server_config {:user_table (:table_id (user-util/get-user-props (:content app)))})
                                                %)))))
