(ns anvil.dispatcher.native-rpc-handlers.users.core
  (:use slingshot.slingshot)
  (:require [anvil.dispatcher.native-rpc-handlers.util :as util]
            [anvil.dispatcher.native-rpc-handlers.users.util :as users-util :refer [add-new-user
                                                                                    get-and-create-columns
                                                                                    get-props-with-named-user-table
                                                                                    get-user-check-enabled-and-validate
                                                                                    validate-enabled-user!
                                                                                    get-user-row-by-id
                                                                                    is-valid-user-row?
                                                                                    user-row->table-id-row-id
                                                                                    user-row->v1-id-str
                                                                                    user-row->row-id-int
                                                                                    row-ref-to-row
                                                                                    row-to-map
                                                                                    set-values-creating-col-if-necessary
                                                                                    table-get
                                                                                    update-row!
                                                                                    update-row-values
                                                                                    record-login-failure!]]
            [anvil.dispatcher.native-rpc-handlers.google.auth :as google-auth]
            [anvil.dispatcher.native-rpc-handlers.facebook :as facebook-auth]
            [anvil.dispatcher.native-rpc-handlers.microsoft :as microsoft-auth]
            [anvil.dispatcher.native-rpc-handlers.saml :as saml-auth]
            [anvil.dispatcher.native-rpc-handlers.raven :as raven-auth]
            [anvil.dispatcher.native-rpc-handlers.email :as email]
            [anvil.runtime.tables.util :as tables-util]
            [clojure.data.json :as json]
            [crypto.random :as random]
            [anvil.runtime.app-data :as app-data]
            [clojure.tools.logging :as log]
            [anvil.util :as anvil-util]
            [anvil.runtime.util :as runtime-util]
            [ring.util.codec :as codec]
            [anvil.dispatcher.native-rpc-handlers.cookies :as cookies]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.runtime.secrets :as secrets]
            [anvil.dispatcher.native-rpc-handlers.users.fido :as fido]
            [anvil.dispatcher.native-rpc-handlers.users.totp :as totp]
            [anvil.dispatcher.native-rpc-handlers.users.twilio :as twilio]
            [anvil.runtime.sessions :as sessions]
            [anvil.runtime.conf :as runtime-conf]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.runtime.conf :as conf])
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
  (or util/*app-origin*
      (app-data/get-app-origin util/*environment*)
      (app-data/get-public-app-origin util/*environment*)
      (throw+ {:anvil/server-error "This app does not have a URL, so we can't send a confirmation email."})))

(defn- get-cookie-type [{:keys [share_login_status] :as _props}]
  (if share_login_status :shared :local))

(defn set-and-return-value-creating-col-if-necessary [table-id row-id col_name val]
  (set-values-creating-col-if-necessary table-id row-id {col_name val})
  val)

(defn logout [{:keys [invalidate_client_objects] :as kwargs}]
  (when invalidate_client_objects
    (util/invalidate-client-objects!))
  (let [{:keys [user_table] :as props} (get-props-with-named-user-table)
        cookie-type (get-cookie-type props)
        cookie-key-token (keyword (str "user-table-" user_table "-remember-me"))]
    (swap! util/*session-state* update-in [:users] dissoc :logged-in-id)
    (swap! util/*session-state* update-in [:users] dissoc :partial-logged-in-id)
    (try+
      (when-let [remember-token (cookies/get-cookie-val cookie-type cookie-key-token)]
        (let [token-hash (anvil-util/sha-256 (str remember-token "#" user_table))]
          (cookies/del-cookie! cookie-type (keyword (str "user-table-" user_table "-remember-me")))

          (binding [util/*client-request?* false]
            (try+
              (tables-util/with-table-transaction
                (when-let [row (table-get user_table {"remembered_logins" [{"token_hash" token-hash}]})]
                  (let [remembered-logins (->> (get (row-to-map row) "remembered_logins")
                                               (remove #(= (:token_hash %) token-hash))
                                               (vec))]

                    (update-row-values user_table (user-row->row-id-int row) {"remembered_logins" remembered-logins}))))
              ;; Tolerate (eg) collisisons in remember-me cookies
              (catch #(and (:anvil/server-error %) (= (:type %) "anvil.tables.TableError") %) e
                (util/*rpc-println* (str "WARNING: Cannot retrieve user record by remember-me state: " (:anvil/server-error e))))))))
      (catch :anvil/cookie-error _ nil)))
  nil)

(defn invalidate-all-session-logins [user-id]
  (let [except-session-id (sessions/get-id util/*session-state*)]
    (doseq [session-id (sessions/list-sessions-for-user-id user-id)
            :when (not= session-id except-session-id)
            :let [session (sessions/load-session-by-id-without-authentication session-id)]
            :when (= (get-in @session [:users :logged-in-id]) user-id)]
      (swap! session dissoc :users)
      (sessions/notify-session-update! session true))))

(defn login! [user-row remember?]
  (let [[table-id row-id] (user-row->table-id-row-id user-row)
        user-map (row-to-map user-row)
        {:keys [allow_remember_me remember_me_days] :as props} (get-props-with-named-user-table)
        cookie-type (get-cookie-type props)
        values-to-set (merge (when (let [last-login (get user-map "last_login")]
                                     (or (not last-login)
                                         (try
                                           (< (-> last-login
                                                  (tables-util/datetime->instant)
                                                  (.toEpochMilli))
                                              (- (System/currentTimeMillis) 5000))
                                           (catch Exception _ true))))
                               {"last_login" (now-as-table-date)})
                             (when (not= 0 (get user-map "n_password_failures" 0))
                               {"n_password_failures" 0}))]
    (swap! util/*session-state* assoc-in [:users :logged-in-id] (user-row->v1-id-str user-row))
    (swap! util/*session-state* update-in [:users] dissoc :partial-logged-in-id)

    (when-not
      (try+
        (cookies/set-cookie! cookie-type {(keyword (str "user-table-" table-id "-last-email")) (get user-map "email")} 30)
        (if (and remember? allow_remember_me)
          (let [new-token (random/base64 32)
                new-token-hash (anvil-util/sha-256 (str new-token "#" table-id))]

            (try+
              (cookies/set-cookie! cookie-type {(keyword (str "user-table-" table-id "-remember-me")) new-token}
                                   remember_me_days)

              (update-row! [table-id row-id] (fn [{remembered-logins "remembered_logins"}]
                                    (assoc values-to-set
                                      "remembered_logins" (->> remembered-logins
                                                               (filter #(is-in-date? % remember_me_days))
                                                               (cons {"login_time" (str (Instant/now)), "token_hash" new-token-hash})
                                                               (vec)))))

              true

              (catch :anvil/cookie-error e
                (util/*rpc-println* (str "WARNING: Cannot save login state to cookie: " (:anvil/server-error e)))
                false)))

          ;; else, no memory allowed
          (do
            (cookies/del-cookie! cookie-type (keyword (str "user-table-" table-id "-remember-me")))
            false))
        (catch :anvil/cookie-error _e
          nil))
      ;; false-y return from that big (try) means we didn't hit the (update-row!)
      (when (not-empty values-to-set)
        (set-values-creating-col-if-necessary table-id row-id values-to-set))))

  user-row)

(defn force-login [{:keys [remember] :as _kwargs} user-row]
  (util/require-server! "call force_login()")
  (cond
    (nil? user-row) (logout nil)
    (is-valid-user-row? user-row) (login! (row-ref-to-row user-row) remember)
    :else (throw+ {:anvil/server-error "force_login() must be passed a row from the users table"})))


; It only makes sense to call this from the client. On the server, you can edit the user row directly.
(defn add-mfa-method [_kwargs password mfa-method clear-existing]
  (binding [util/*client-request?* false]                   ; Safe, because we're loading the current user, and verifying their password.
    (let [{:keys [user_table]} (get-props-with-named-user-table)
          v1-id-str (or (get-in @util/*session-state* [:users :logged-in-id]) (get-in @util/*session-state* [:users :mfa-reset-user-id]))
          user (get-user-row-by-id user_table v1-id-str)]
      (when-not password
        (throw+ {:anvil/server-error "No password provided" :type "anvil.users.AuthenticationFailed"}))
      (let [pw-hash (when user (get (row-to-map user) "password_hash"))]
        (when-not (anvil.util/bcrypt-checkpw password pw-hash)
          (record-login-failure! user)
          (throw+ {:anvil/server-error "Incorrect password" :type "anvil.users.AuthenticationFailed"})))

      (swap! util/*session-state* assoc-in [:users :mfa-reset-user-id] nil)

      ;; Add the new MFA method to the end of the list, or to a new list if clear-existing is True
      (let [mfa-methods (if clear-existing [] (get (row-to-map user) "mfa"))
            new-mfa-methods (vec (conj mfa-methods mfa-method))]
        (set-and-return-value-creating-col-if-necessary user_table (user-row->row-id-int user) "mfa" new-mfa-methods)))))

(defn get-available-mfa-types [_kwargs email password]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table]} (get-props-with-named-user-table)
          user-row (get-user-check-enabled-and-validate user_table {:email (.trim ^String (or email ""))} :email)
          pw-hash (when user-row (get (row-to-map user-row) "password_hash"))]

      (if-not (anvil.util/bcrypt-checkpw password pw-hash)
        []
        (map :type (get (row-to-map user-row) "mfa" []))))))

(defn get-enabled-mfa-types [_kwargs]
  (concat (when true ["totp"])
          (when true ["fido"])
          (when runtime-conf/twilio-config ["twilio-verify"])))

; mfa: {:type, :...}
(defn login-with-email [{:keys [remember mfa] :as _kwargs} email password]
  (binding [util/*client-request?* false]
    (let [partial-logged-in-id (atom nil)]
      (try
        (let [{:keys [user_table use_email confirm_email require_mfa mfa_timeout_days max_password_failures] :as props} (get-props-with-named-user-table)
              cookie-type (get-cookie-type props)
              _ (when-not use_email (throw+ {:anvil/server-error "Email/password authentication is not enabled."}))
              user-row (get-user-check-enabled-and-validate user_table {:email (.trim ^String (or email ""))} :email)
              user-data (row-to-map user-row)

              n-password-failures (let [f (get user-data "n_password_failures")]
                                    (if (number? f) f 0))
              max_password_failures (or max_password_failures 10)
              pw-hash (get user-data "password_hash")]

          (when (and confirm_email user-row (not (get user-data "confirmed_email")))
            (throw+ {:anvil/server-error "You haven't confirmed your email address. Please check your email and click the confirmation link, or reset your password."
                     :type               "anvil.users.EmailNotConfirmed"}))

          (when (>= n-password-failures max_password_failures)
            (throw+ {:anvil/server-error "You have entered an incorrect password too many times. Please reset your password by email."
                     :type               "anvil.users.TooManyPasswordFailures"}))

          (when-not (anvil.util/bcrypt-checkpw password pw-hash)
            (record-login-failure! user-row)
            (throw+ {:anvil/server-error "Incorrect email address or password"
                     :type               (if (>= (inc n-password-failures) max_password_failures)
                                           "anvil.users.TooManyPasswordFailures"
                                           "anvil.users.AuthenticationFailed")}))

          (when require_mfa
            (let [mfa-methods (get (row-to-map user-row) "mfa")
                  mfa-cookie-key (keyword (str "user-table-" user_table "-user-" (.substring (anvil-util/sha-256 email) 0 8) "-mfa-validation"))

                  ;; TODO: We could unconditionally remember any MFA methods that are validated, allowing signup to carry over to login.
                  maybe-remember-mfa! (fn [{:keys [id serial]}]
                                        (when (and mfa_timeout_days
                                                   (> mfa_timeout_days 0))
                                          (try+
                                            (cookies/set-cookie! cookie-type {mfa-cookie-key (str id "#"
                                                                                                  serial "#"
                                                                                                  (System/currentTimeMillis))}
                                                                 mfa_timeout_days)
                                            (catch :anvil/cookie-error e (log/trace e)))))]
              (if mfa
                (let [mfa-type (:type mfa)
                      matching-mfa-methods (filter #(= mfa-type (get % :type)) mfa-methods)]
                  (if (empty? matching-mfa-methods)
                    (throw+ {:anvil/server-error "No matching MFA method available" :type "anvil.users.AuthenticationFailed"})
                    (condp = mfa-type
                      "totp"
                      (if-let [mfa-method (some #(when (totp/validate-totp-code nil % (:code mfa)) %) matching-mfa-methods)]
                        (maybe-remember-mfa! mfa-method)
                        (do
                          (record-login-failure! user-row)
                          (throw+ {:anvil/server-error "Incorrect authentication code" :type "anvil.users.AuthenticationFailed"})))

                      "fido"
                      (if-let [[mfa-method updated-mfa-method] (some #(when-let [updated-mfa-method (fido/validate-fido-assertion % (:result mfa))] [% updated-mfa-method]) matching-mfa-methods)]
                        ;; We have successfully validated against mfa-method, which has incremented its signCount. Save the updated method to the user object.
                        (let [new-mfa-methods (vec (map #(if (= % mfa-method) updated-mfa-method %) mfa-methods))]
                          (set-and-return-value-creating-col-if-necessary user_table (user-row->row-id-int user-row) "mfa" new-mfa-methods)
                          (maybe-remember-mfa! updated-mfa-method))
                        (do
                          (record-login-failure! user-row)
                          (throw+ {:anvil/server-error "Two-factor authentication failed" :type "anvil.users.AuthenticationFailed"})))

                      "twilio-verify"
                      (if-let [mfa-method (some #(when (twilio/check-verification-token nil % (:code mfa)) %) matching-mfa-methods)]
                        (maybe-remember-mfa! mfa-method)
                        (do
                          (record-login-failure! user-row)
                          (throw+ {:anvil/server-error "Incorrect authentication code" :type "anvil.users.AuthenticationFailed"})))

                      (throw+ {:anvil/server-error "MFA method not supported" :type "anvil.users.AuthenticationFailed"})))) ; We should never get here.
                (let [remembered-mfa (try+ (cookies/get-cookie-val cookie-type mfa-cookie-key) (catch :anvil/cookie-error _ nil))
                      [method-id method-serial validation-time] (.split (or remembered-mfa "") "#")]
                  ; We have remembered a previous MFA login. Check that it's still valid
                  (when-not (some #(and (= (:id %) method-id)
                                        (= (:serial %) (Integer/parseInt (or method-serial "0")))
                                        (< (- (System/currentTimeMillis) (Long/parseLong (or validation-time "0"))) (* (or mfa_timeout_days 0) 24 60 60 1000))) mfa-methods)
                    (reset! partial-logged-in-id (user-row->v1-id-str user-row))
                    (throw+ {:anvil/server-error "MFA authentication required." :type "anvil.users.MFARequired"}))))))

          (login! user-row remember))

        (finally
          ;; No matter what happens, set the partially-logged-in user ID or clear it explicitly.
          (if-let [partial-logged-in-id @partial-logged-in-id]
            (swap! util/*session-state* assoc-in [:users :partial-logged-in-id] partial-logged-in-id)
            (swap! util/*session-state* update-in [:users] dissoc :partial-logged-in-id)))))))

(defn generate-email-link-token [_kwargs email type]
  (let [token (str email "#" util/*app-id* "#" (System/currentTimeMillis) "#" type)]
    (secrets/encrypt-str-with-global-key :ut token)))

(defn do-login-with-token [app environment session-state token]
  (binding [util/*client-request?* false
            util/*app* (:content app)
            util/*app-id* (:id app)
            util/*environment* environment
            util/*rpc-print* #(log/info "Token login output:" %&)]

    (let [{:keys [user_table use_token] :as props} (get-props-with-named-user-table)]
      ; Is this a valid token?
      (when-let [decrypted-token (try (secrets/decrypt-str-with-global-key :ut token) (catch Exception _ nil))]
        (let [[email token-app-id token-time token-type] (.split (or decrypted-token "") "#")
              user-row (get-user-check-enabled-and-validate user_table {:email email} :email)]

          (when (and user-row                               ; Is this a valid user?
                     (= token-app-id (:id app))             ; Is the token for this app?
                     (< (- (System/currentTimeMillis) (Long/parseLong (or token-time "0"))) ; Is the token still valid?
                        (* 10 60 1000)))                    ; Ten minute timeout
            (cond
              (and use_token (= token-type "login"))
              ;; Token login is enabled in this app: Log in.
              (do
                (swap! session-state assoc-in [:users :logged-in-id] (user-row->v1-id-str user-row))
                ; Return the logged-in user
                user-row)

              (= token-type "mfa-reset")
              ;; This is an mfa-reset token, store it in the session so the client can find it.
              (do
                (swap! session-state assoc-in [:users :mfa-reset-user-id] (user-row->v1-id-str user-row))
                ; The user is still not logged in, so only reveal that this worked and nothing more
                true)

              (= token-type "pw-reset")
              (do
                (swap! session-state assoc-in [:users :password-reset-user-id] (user-row->v1-id-str user-row))
                ; The user is still not logged in, so only reveal that this worked and nothing more
                true)

              ;; TODO: Add token type for email verification
              )))))))

(defn login-with-token [_kwargs token]
  (do-login-with-token {:id util/*app-id* :content util/*app*} util/*environment* util/*session-state* token))

(defn signup-common [required-permission signup-method-name search-attributes new-user-attributes login-when-enabled? lowercase-column remember?]
  (let [{:keys [user_table allow_signup enable_automatically] :as props} (get-props-with-named-user-table)]
    (when (and util/*client-request?* (not allow_signup))
      (throw+ {:anvil/server-error "Signups from client code are not enabled."}))
    (when-not (get props required-permission)
      (throw+ {:anvil/server-error (str signup-method-name " authentication is not enabled.")}))
    (binding [util/*client-request?* false]
      (tables-util/with-table-transaction
        (if (get-and-create-columns user_table search-attributes lowercase-column)
          (throw+ {:anvil/server-error "This user already exists", :type "anvil.users.UserExists"})
          (let [attributes (merge {:signed_up (now-as-table-date)
                                   :enabled   (boolean enable_automatically)}
                                  search-attributes new-user-attributes)
                new-user (add-new-user user_table attributes)]
            (if (and enable_automatically login-when-enabled?)
              (do
                (validate-enabled-user! (row-to-map new-user))
                (login! new-user remember?))
              new-user)))))))

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
        email_content (when-not (app-data/abuse-caution? util/*session-state* util/*app-id*)
                        email_content)
        from-name (if (app-data/abuse-caution? util/*session-state* util/*app-id*)
                    "Accounts"
                    (str (or (:name util/*app-info*) (:name util/*app*)) " Accounts"))
        from-address (or email_from_address "accounts")
        subject (or (get-in email_content [email-name :subject])
                    (get-in default-emails [email-name :subject])
                    (str (:name util/*app*) " " (get-in default-emails [email-name :subject_suffix])))

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
    (if (get-in @util/*session-state* [:users :test-email-divert])
      (swap! util/*session-state* update-in [:users :test-email-divert] concat [{:to to, :from_name from-name, :from_address from-address, :subject subject, :text text}])
      (binding [email/*use-quota* false
                email/*require-service-config* false]
        (email/send! {:from_name    from-name
                      :from_address from-address
                      :to           to
                      :subject      subject
                      :text         text
                      :html         html})))))

(defn send-token-login-email [_kwargs email]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_token] :as props} (get-props-with-named-user-table)]
      ;; We're only allowed to call this from the client if logging in with a token is enabled. We can call this from the server either way.
      (when (not use_token)
        (throw+ {:anvil/server-error "Token login is not enabled." :type "anvil.users.AuthenticationFailed"}))

      (when (empty? email)
        (throw+ {:anvil/server-error "Please provide an email address." :type "anvil.users.AuthenticationFailed"}))

      (if (get-user-check-enabled-and-validate user_table {:email email} :email)
        (let [login-link (str (get-our-origin)
                              "/_/login/"
                              (anvil-util/real-actual-genuine-url-encoder (generate-email-link-token nil email "login")))]
          (send-email! props email :token_login {:email email :login_url login-link} {:login_link login-link})
          nil)
        (throw+ {:anvil/server-error "User disabled, or not found." :type "anvil.users.AuthenticationFailed"})))))

(defn send-mfa-reset-email [_kwargs email]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table require_mfa allow_mfa_email_reset] :as props} (get-props-with-named-user-table)]

      (when (empty? email)
        (throw+ {:anvil/server-error "Please provide an email address." :type "anvil.users.AuthenticationFailed"}))

      (if-let [user (get-user-check-enabled-and-validate user_table {:email email} :email)]
        (let [login-link (str (get-our-origin)
                              "/_/login/"
                              (anvil-util/real-actual-genuine-url-encoder (generate-email-link-token nil email "mfa-reset")))
              mfa-available-for-user? (not-empty (map :type (get (row-to-map user) "mfa" [])))]
          ;; Only send the email if reset is allowed, or if mfa is required and we have no methods available.
          (if (or allow_mfa_email_reset
                  (and require_mfa (not mfa-available-for-user?)))
            (do (send-email! props email :mfa_reset {:email email :login_url login-link} {:login_link login-link})
                nil)
            (throw+ {:anvil/server-error "Cannot reset two-factor authentication by email." :type "anvil.users.AuthenticationFailed"})))
        (throw+ {:anvil/server-error "User disabled, or not found." :type "anvil.users.AuthenticationFailed"})))))

(defn signup-with-email [{:keys [remember mfa_method] :as _kwargs} email password]
  (let [email (.trim (.toLowerCase ^String (or email "")))
        {:keys [confirm_email enable_automatically require_secure_passwords require_mfa] :as props} (get-props-with-named-user-table)
        _ (when (and require_secure_passwords
                     (< (.length (str password)) 7))
            (throw+ {:anvil/server-error "Passwords must be 8 characters or more" :type "anvil.users.PasswordNotAcceptable"}))
        _ (when (and require_secure_passwords
                     (or (< (.length password) 6) (runtime-util/is-password-pwned? password)))
            (throw+ {:anvil/server-error "This password is not safe to use: It has previously been leaked and posted on the internet." :type "anvil.users.PasswordNotAcceptable"}))

        _ (when (and require_mfa
                     (not mfa_method))
            (throw+ {:anvil/server-error "MFA authentication required" :type "anvil.users.MFARequired"}))

        _ (when (and require_mfa
                     (not ((set (get-enabled-mfa-types nil)) (:type mfa_method))))
            (throw+ {:anvil/server-error "MFA type not supported" :type "anvil.users.MFARequired"}))

        confirmation-key (random/url-part 10)
        new-user-row (signup-common :use_email "Email/password"
                                    {:email email} (merge {:password_hash (BCrypt/hashpw password (BCrypt/gensalt))}
                                                          (when confirm_email
                                                            {:confirmed_email false, :email_confirmation_key confirmation-key})
                                                          (when require_mfa
                                                            {:mfa [mfa_method]}))
                                    (not confirm_email) :email remember)
        confirm-url (format "%s/_/email-confirm/%s/%s"
                            (get-our-origin)
                            (codec/url-encode email)
                            (codec/url-encode confirmation-key))]
    (when confirm_email
      (send-email! props email :confirm_address {:email email :confirm_url confirm-url} {:confirm_link confirm-url}))
    new-user-row))

(defn send-password-reset-email [_kwargs email]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_email] :as props} (get-props-with-named-user-table)]

      (when (not use_email)
        (throw+ {:anvil/server-error "Email/password login is not enabled." :type "anvil.users.AuthenticationFailed"}))

      (when (empty? email)
        (throw+ {:anvil/server-error "Please provide an email address." :type "anvil.users.AuthenticationFailed"}))

      (if (get-user-check-enabled-and-validate user_table {:email email} :email)
        (let [reset-link (str (get-our-origin)
                              "/_/reset_password/"
                              (anvil-util/real-actual-genuine-url-encoder (generate-email-link-token nil email "pw-reset")))
              request util/*req*]

          (worker-pool/run-task! ::send-reset-email
            (util/with-basic-native-bindings-from-request request
              (send-email! props email :reset_password {:email email :reset_url reset-link} {:reset_link reset-link})))
          (when-not conf/dont-confirm-emails-during-auth?
            true))
        (when-not conf/dont-confirm-emails-during-auth?
          (throw+ {:anvil/server-error "This username does not exist or is disabled." :type "anvil.users.AuthenticationFailed"}))))))

(defn call-if-confirmation-key-correct [app environment email confirmation-key require-settings f]
  (binding [util/*client-request?* false
            util/*app* (:content app)
            util/*app-id* (:id app)
            util/*environment* environment
            util/*session-state* (or util/*session-state* (sessions/empty-dummy-session))
            util/*rpc-print* #(log/info "Email confirmation table output:" %&)]

    (let [{:keys [user_table use_email] :as props} (get-props-with-named-user-table)]
      (when (and use_email (every? props require-settings))
        (let [user-row (get-and-create-columns user_table {:email email} :email)
              real-confirmation-key (get (row-to-map user-row) "email_confirmation_key")]

          (when (and real-confirmation-key
                     (= (anvil-util/sha-256 real-confirmation-key) (anvil-util/sha-256 confirmation-key)))
            (f user_table user-row)))))))

(defn set-if-confirmation-key-correct [app environment email confirmation-key require-settings new-attributes]
  (call-if-confirmation-key-correct app environment email confirmation-key require-settings
                                      (fn [user_table user-row]
                                        (set-values-creating-col-if-necessary user_table (user-row->row-id-int user-row) new-attributes)
                                        true)))


(defn confirm-email [app environment email confirmation-key]
  (set-if-confirmation-key-correct app environment email confirmation-key #{:allow_signup :confirm_email}
                                   {:confirmed_email true, :email_confirmation_key nil}))


(defn email-password-reset-key-valid? [app environment email confirmation-key]
  (call-if-confirmation-key-correct app environment email confirmation-key #{} (constantly true)))

; To stop the password reset box from popping up multiple times if you cancel it.
(defn cancel-password-reset [_kwargs]
  (swap! util/*session-state* assoc-in [:users :password-reset-user-id] nil)
  nil)

(defn reset-password [_kwargs old-password new-password]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table require_secure_passwords confirm_email] :as _props} (get-props-with-named-user-table)
          email-reset-user (get-in @util/*session-state* [:users :password-reset-user-id])
          v1-row-id-str (or (get-in @util/*session-state* [:users :logged-in-id]) email-reset-user)
          user (get-user-row-by-id user_table v1-row-id-str)
          {pw-hash "password_hash"
           password-failures "n_password_failures"} (row-to-map user)]

      (when-not (or email-reset-user
                    (anvil.util/bcrypt-checkpw old-password pw-hash))
        ;; Don't require old password when resetting by token.
        (record-login-failure! user)
        (throw+ {:anvil/server-error "Incorrect password" :type "anvil.users.AuthenticationFailed"}))

      (when (and require_secure_passwords
                 (< (.length (str new-password)) 8))
        (throw+ {:anvil/server-error "Passwords must be 8 characters or more" :type "anvil.users.PasswordNotAcceptable"}))

      (when (and require_secure_passwords
                 (runtime-util/is-password-pwned? new-password))
        (throw+ {:anvil/server-error "This password is not safe to use: It has been previously leaked and posted on the internet." :type "anvil.users.PasswordNotAcceptable"}))

      (swap! util/*session-state* assoc-in [:users :password-reset-user-id] nil)
      (set-values-creating-col-if-necessary user_table (user-row->row-id-int user)
                                            (merge {"password_hash" (BCrypt/hashpw new-password (BCrypt/gensalt))}
                                                   (when (and confirm_email email-reset-user)
                                                     {:confirmed_email true})
                                                   (when (number? password-failures)
                                                     {"n_password_failures" 0})))
      (invalidate-all-session-logins v1-row-id-str)
      true)))

(defn reset-email-password! [app environment email confirmation-key password]
  (let [{:keys [require_secure_passwords confirm_email] :as _props} (get-props-with-named-user-table (tables-util/table-mapping-for-environment environment util/*session-state*) (:content app))
        _ (when (and require_secure_passwords
                     (< (.length (str password)) 7))
            (throw+ {:anvil/server-error "Passwords must be 8 characters or more" :type "anvil.users.PasswordNotAcceptable"}))
        _ (when (and require_secure_passwords
                     (or (< (.length password) 6) (runtime-util/is-password-pwned? password)))
            (throw+ {:anvil/server-error "This password is not safe to use: It has been previously leaked and posted on the internet." :type "anvil.users.PasswordNotAcceptable"}))]
    (set-if-confirmation-key-correct app environment email confirmation-key #{}
                                     (merge
                                       {:email_confirmation_key nil
                                        :password_hash          (BCrypt/hashpw password (BCrypt/gensalt))}
                                       (when confirm_email
                                         {:confirmed_email true})))))


(defn login-with-google [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_google enable_automatically allow_signup]} (get-props-with-named-user-table)
          current-google-user (google-auth/get-user-email {})
          _ (when-not use_google (throw+ {:anvil/server-error "Google authentication is not enabled."}))
          _ (when-not current-google-user (throw+ {:anvil/server-error "User is not logged in with Google"}))
          user-row (get-user-check-enabled-and-validate user_table {:email current-google-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_google "Google"
                         {:email (.toLowerCase current-google-user)} nil
                         true :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-google [{:keys [remember] :as _kwargs}]
  (if-let [current-google-user (google-auth/get-user-email {})]
    (signup-common :use_google "Google"
                   {:email (.toLowerCase current-google-user)} nil
                   true :email remember)
    (throw+ {:anvil/server-error "User is not logged in with Google"})))

(defn login-with-facebook [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_facebook enable_automatically allow_signup]} (get-props-with-named-user-table)
          current-facebook-user (facebook-auth/get-user-email {})
          _ (when-not use_facebook (throw+ {:anvil/server-error "Facebook authentication is not enabled."}))
          _ (when-not current-facebook-user (throw+ {:anvil/server-error "User is not logged in with Facebook"}))
          user-row (get-user-check-enabled-and-validate user_table {:email current-facebook-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_facebook "Facebook"
                         {:email (.toLowerCase current-facebook-user)} nil
                         true :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-facebook [{:keys [remember] :as _kwargs}]
  (if-let [current-facebook-user (facebook-auth/get-user-email {})]
    (signup-common :use_facebook "Facebook"
                   {:email (.toLowerCase current-facebook-user)} nil
                   true :email remember)
    (throw+ {:anvil/server-error "User is not logged in with Facebook"})))

(defn login-with-microsoft [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_microsoft enable_automatically allow_signup]} (get-props-with-named-user-table)
          current-microsoft-user (microsoft-auth/get-user-email {})
          _ (when-not use_microsoft (throw+ {:anvil/server-error "Microsoft authentication is not enabled."}))
          _ (when-not current-microsoft-user (throw+ {:anvil/server-error "User is not logged in with Microsoft"}))
          user-row (get-user-check-enabled-and-validate user_table {:email current-microsoft-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_microsoft "Microsoft"
                         {:email (.toLowerCase current-microsoft-user)} nil
                         true :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-microsoft [{:keys [remember] :as _kwargs}]
  (if-let [current-microsoft-user (microsoft-auth/get-user-email {})]
    (signup-common :use_microsoft "Microsoft"
                   {:email (.toLowerCase current-microsoft-user)} nil
                   true :email remember)
    (throw+ {:anvil/server-error "User is not logged in with Microsoft"})))

(defn login-with-saml [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_saml enable_automatically allow_signup]} (get-props-with-named-user-table)
          current-saml-user (saml-auth/get-user-email {})
          _ (when-not use_saml (throw+ {:anvil/server-error "SAML authentication is not enabled."}))
          _ (when-not current-saml-user (throw+ {:anvil/server-error "User is not logged in via SAML"}))
          user-row (get-user-check-enabled-and-validate user_table {:email current-saml-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_saml "SAML"
                         {:email (.toLowerCase current-saml-user)} nil
                         true :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-saml [{:keys [remember] :as _kwargs}]
  (if-let [current-saml-user (saml-auth/get-user-email {})]
    (signup-common :use_saml "SAML"
                   {:email (.toLowerCase current-saml-user)} nil
                   true :email remember)
    (throw+ {:anvil/server-error "User is not logged in via SAML"})))

(defn login-with-raven [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_raven enable_automatically allow_signup]} (get-props-with-named-user-table)
          current-raven-user (raven-auth/get-user-email {})
          _ (when-not use_raven (throw+ {:anvil/server-error "Raven authentication is not enabled."}))
          user-row (get-user-check-enabled-and-validate user_table {:email current-raven-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_raven "Raven"
                         {:email (.toLowerCase current-raven-user)} nil
                         true :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-raven [{:keys [remember] :as _kwargs}]
  (if-let [current-raven-user (raven-auth/get-user-email {})]
    (signup-common :use_raven "Raven"
                   {:email (.toLowerCase current-raven-user)} nil
                   true :email remember)
    (throw+ {:anvil/server-error "User is not logged in with Raven"})))


(defn get-current-user [{:keys [allow_remembered _anvil_test_tell_me_if_reset_requested] :as _kwargs}]
  (let [really-client-request? util/*client-request?*]
    (binding [util/*client-request?* false]
      (let [{:keys [user_table allow_remember_me remember_me_days require_mfa use_email] :as props} (get-props-with-named-user-table)
            cookie-key-token (keyword (str "user-table-" user_table "-remember-me"))
            cookie-type (get-cookie-type props)]
        (if (and use_email (or really-client-request? _anvil_test_tell_me_if_reset_requested) (get-in @util/*session-state* [:users :password-reset-user-id]))
          (throw+ {:anvil/server-error "Password reset requested" :type "anvil.users.PasswordResetRequested"})
          (if-let [v1-row-id-str (get-in @util/*session-state* [:users :logged-in-id])]
            (get-user-row-by-id user_table v1-row-id-str)
            (if (and require_mfa really-client-request? (get-in @util/*session-state* [:users :mfa-reset-user-id]))
              (throw+ {:anvil/server-error "MFA authentication required" :type "anvil.users.MFARequired"})
              (try+
                (when-let [remember-token (and allow_remembered
                                               allow_remember_me
                                               (cookies/get-cookie-val cookie-type cookie-key-token))]
                  (let [token-hash (anvil-util/sha-256 (str remember-token "#" user_table))
                        user-row (try+
                                   (table-get user_table {"remembered_logins" [{"token_hash" token-hash}]})
                                   (catch #(and (:anvil/server-error %) (= (:type %) "anvil.tables.TableError") %) e
                                     (util/*rpc-println* (str "WARNING: Cannot retrieve user record by remember-me state: " (:anvil/server-error e)))
                                     nil))
                        user-row-map (row-to-map user-row)]
                    (if (and user-row
                             (some #(is-in-date? % remember_me_days)
                                   (get user-row-map "remembered_logins"))
                             (get user-row-map "enabled"))
                      user-row
                      (do
                        (cookies/del-cookie! cookie-type cookie-key-token)
                        nil))))
                (catch :anvil/cookie-error _
                  ; We don't care if cookies fail in the users service.
                  nil)))))))))

(defn get-current-user-email [kwargs]
  (-> (get-current-user kwargs)
      (row-to-map)
      (get "email")))

(defn get-last-login-email [_kwargs]
  (let [{:keys [user_table] :as props} (get-props-with-named-user-table)
        cookie-type (get-cookie-type props)]
    (try+
      (cookies/get-cookie-val cookie-type (keyword (str "user-table-" user_table "-last-email")))
      (catch :anvil/cookie-error _
        ; We don't care if cookies didn't work.
        nil))))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.users.get_current_user"          (util/wrap-native-fn get-current-user)
        "anvil.private.users.get_current_user_email"    (util/wrap-native-fn get-current-user-email)
        "anvil.private.users.get_last_login_email"      (util/wrap-native-fn get-last-login-email)
        "anvil.private.users.logout"                    (util/wrap-native-fn logout)
        "anvil.private.users.login_with_token"          (util/wrap-native-fn login-with-token)
        "anvil.private.users.login_with_email"          (util/wrap-native-fn login-with-email)
        "anvil.private.users.login_with_google"         (util/wrap-native-fn login-with-google)
        "anvil.private.users.login_with_facebook"       (util/wrap-native-fn login-with-facebook)
        "anvil.private.users.login_with_microsoft"      (util/wrap-native-fn login-with-microsoft)
        "anvil.private.users.login_with_saml"           (util/wrap-native-fn login-with-saml)
        "anvil.private.users.login_with_raven"          (util/wrap-native-fn login-with-raven)
        "anvil.private.users.force_login"               (util/wrap-native-fn force-login)
        "anvil.private.users.signup_with_email"         (util/wrap-native-fn signup-with-email)
        "anvil.private.users.send_password_reset_email" (util/wrap-native-fn send-password-reset-email)
        "anvil.private.users.signup_with_google"        (util/wrap-native-fn signup-with-google)
        "anvil.private.users.signup_with_facebook"      (util/wrap-native-fn signup-with-facebook)
        "anvil.private.users.signup_with_microsoft"     (util/wrap-native-fn signup-with-microsoft)
        "anvil.private.users.signup_with_saml"          (util/wrap-native-fn signup-with-saml)
        "anvil.private.users.signup_with_raven"         (util/wrap-native-fn signup-with-raven)
        "anvil.private.users.reset_password"            (util/wrap-native-fn reset-password)
        "anvil.private.users.cancel_password_reset"     (util/wrap-native-fn cancel-password-reset)

        "anvil.private.users.send_token_login_email"    (util/wrap-native-fn send-token-login-email)
        "anvil.private.users.generate_email_link_token" (util/wrap-native-fn generate-email-link-token)

        "anvil.private.users.add_mfa_method"            (util/wrap-native-fn add-mfa-method)
        "anvil.private.users.get_available_mfa_types"   (util/wrap-native-fn get-available-mfa-types)
        "anvil.private.users.get_enabled_mfa_types"     (util/wrap-native-fn get-enabled-mfa-types)
        "anvil.private.users.send_mfa_reset_email"      (util/wrap-native-fn send-mfa-reset-email)})

(defn export-with-table [yaml app-id version-spec]
  (let [SERVICE-URL "/runtime/services/anvil/users.yml"
        app (app-data/get-app (app-data/get-app-info-insecure app-id) version-spec)]

    (update-in yaml [:services] (partial map #(if (= SERVICE-URL (:source %))
                                                (assoc % :server_config {:user_table (:user_table (users-util/get-props (:content app)))})
                                                %)))))


