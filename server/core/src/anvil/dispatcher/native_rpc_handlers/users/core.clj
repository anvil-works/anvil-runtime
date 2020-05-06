(ns anvil.dispatcher.native-rpc-handlers.users.core
  (:use slingshot.slingshot)
  (:require [anvil.dispatcher.native-rpc-handlers.util :as util]
            [anvil.dispatcher.native-rpc-handlers.users.util :as users-util]
            [anvil.dispatcher.native-rpc-handlers.google.auth :as google-auth]
            [anvil.dispatcher.native-rpc-handlers.facebook :as facebook-auth]
            [anvil.dispatcher.native-rpc-handlers.microsoft :as microsoft-auth]
            [anvil.dispatcher.native-rpc-handlers.raven :as raven-auth]
            [anvil.dispatcher.native-rpc-handlers.email :as email]
            [anvil.runtime.tables.rpc :as tables]
            [anvil.runtime.tables.util :as tables-util]
            [clojure.data.json :as json]
            [crypto.random :as random]
            [anvil.runtime.app-data :as app-data]
            [clojure.tools.logging :as log]
            [anvil.util :as anvil-util]
            [anvil.runtime.util :as runtime-util]
            [ring.util.codec :as codec]
            [anvil.dispatcher.native-rpc-handlers.cookies :as cookies]
            [anvil.dispatcher.core :as dispatcher])
  (:import (anvil.dispatcher.types DateTime LiveObjectProxy)
           (java.text SimpleDateFormat)
           (java.util Date)
           (org.mindrot.jbcrypt BCrypt)
           (java.time Instant)
           (java.time.format DateTimeParseException)))

(defn get-props
  ([] (get-props (tables-util/db) util/*app-id*  util/*app*))
  ([app-id app] (get-props (tables-util/db-for-app app-id) app-id app))
  ([db-c app-id app]
   (let [{:keys [user_table] :as props} (users-util/get-props app)]
     (if (string? user_table)
       (assoc props :user_table (tables-util/get-table-id db-c app-id user_table))
       props))))

(defn row-id-str [r]
  (:id r))

(defn row-id [r]
  (when (:id r)
    (json/read-str (:id r))))

(defn row-to-map [r]
  (:itemCache r))

(defn search-to-row [search-result]
  (map :itemCache (:items (:iterItems search-result))))

(defn- now-as-table-date []
  (DateTime. (.format (SimpleDateFormat. "yyyy-MM-dd HH:mm:ss.SSSZ") (Date.))))

(defn- is-in-date? [remembered-login remember_me_days]
  (and (:login_time remembered-login)
       (try
         (.isBefore (Instant/now) (.plusSeconds (Instant/parse (:login_time remembered-login))
                                                (* 3600 24 (or remember_me_days 0))))
         (catch DateTimeParseException _
           false))))

(defn update-remembered-logins [row-id-str update-fn]
  (tables-util/with-table-transaction
    (let [row-id (json/read-str row-id-str)
          table-id (first row-id)
          remembered-logins (->>
                              (-> ((tables/Table "get_by_id") [table-id {}] {} row-id-str)
                                  (row-to-map)
                                  (get "remembered_logins"))
                              (update-fn)
                              (vec))
          update-remembered-logins! #((tables/TRow "update") row-id {"remembered_logins" remembered-logins})]
      (try+
        (update-remembered-logins!)
        (catch ::abort-update! _
          nil)
        (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumn" (:type %))) _
          (tables/ensure-columns-exist! table-id {"remembered_logins" remembered-logins})
          (update-remembered-logins!))))))

(defn- get-cookie-type [{:keys [share_login_status] :as _props}]
  (if share_login_status :shared :local))

(defn set-and-return-value-creating-col-if-necessary [table-id row-id col_name val]
  (try+
    ((tables/TRow "set") row-id {(keyword col_name) val})
    (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumn" (:type %))) _e
      (tables/ensure-columns-exist! table-id {col_name val})
      ((tables/TRow "set") row-id {(keyword col_name) val})))
  val)

(defn logout [_kwargs]
  (let [{:keys [user_table] :as props} (get-props)
        cookie-type (get-cookie-type props)
        cookie-key-token (keyword (str "user-table-" user_table "-remember-me"))]
    (swap! util/*session-state* update-in [:users] dissoc :logged-in-id)
    (try+
      (when-let [remember-token (cookies/get-cookie-val cookie-type cookie-key-token)]
        (let [token-hash (anvil-util/sha-256 (str remember-token "#" user_table))]
          (cookies/del-cookie! cookie-type (keyword (str "user-table-" user_table "-remember-me")))

          (binding [util/*client-request?* false]
            (try+
              (tables-util/with-table-transaction
                (when-let [row ((tables/Table "get") [user_table {}] {"remembered_logins" [{"token_hash" token-hash}]})]
                  (let [remembered-logins (->> (get (row-to-map row) "remembered_logins")
                                               (remove #(= (:token_hash %) token-hash))
                                               (vec))]

                    ((tables/TRow "update") (row-id row) {"remembered_logins" remembered-logins}))))
              ;; Tolerate (eg) collisisons in remember-me cookies
              (catch #(and (:anvil/server-error %) (= (:type %) "anvil.tables.TableError") %) e
                (util/*rpc-println* (str "WARNING: Cannot retrieve user record by remember-me state: " (:anvil/server-error e))))))))
      (catch :anvil/cookie-error _ nil)))

  nil)

(defn login! [user-row remember?]
  (let [row-id (row-id user-row)
        user-map (row-to-map user-row)
        table-id (first row-id)
        {:keys [allow_remember_me remember_me_days] :as props} (get-props)
        cookie-type (get-cookie-type props)]
    (swap! util/*session-state* assoc-in [:users :logged-in-id] (row-id-str user-row))

    (try+
      (cookies/set-cookie! cookie-type {(keyword (str "user-table-" table-id "-last-email")) (get user-map "email")} 30)
      (if (and remember? allow_remember_me)
        (let [new-token (random/base64 32)
              new-token-hash (anvil-util/sha-256 (str new-token "#" table-id))]

          (try+
            (cookies/set-cookie! cookie-type {(keyword (str "user-table-" table-id "-remember-me")) new-token}
                                 remember_me_days)

            (update-remembered-logins (row-id-str user-row)
                                      (fn [remembered-logins]
                                        (->> remembered-logins
                                             (filter #(is-in-date? % remember_me_days))
                                             (cons {"login_time" (str (Instant/now)), "token_hash" new-token-hash}))))

            (catch :anvil/cookie-error e (util/*rpc-println* (str "WARNING: Cannot save login state to cookie: " (:anvil/server-error e))))))

        ;; else, no memory allowed
        (cookies/del-cookie! cookie-type (keyword (str "user-table-" table-id "-remember-me"))))
      (catch :anvil/cookie-error _e
        nil))

    (set-and-return-value-creating-col-if-necessary table-id row-id "last_login" (now-as-table-date)))

  user-row)

(defn get-and-create-columns
  ([table-id query-map] (get-and-create-columns table-id query-map nil))
  ([table-id original-query-map lowercase-column]
   (let [val-to-lowercase (get original-query-map lowercase-column)
         applying-lowercase? (and lowercase-column (string? val-to-lowercase))
         query-map (if applying-lowercase?
                       (assoc original-query-map lowercase-column (.toLowerCase ^String val-to-lowercase))
                       original-query-map)]

     (or
       (try+
         ((tables/Table "get") [table-id {}] query-map)
         (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumn" (:type %))) _e
           (tables/ensure-columns-exist! table-id query-map)
           ((tables/Table "get") [table-id {}] query-map)))

       (when applying-lowercase?
         ;; If it didn't match, fall back to an exact-case match
         (get-and-create-columns table-id original-query-map))))))

(defn get-user-and-check-enabled
  ([table-id query-map] (get-user-and-check-enabled table-id query-map nil))
  ([table-id query-map lowercase-column]
   (let [u (get-and-create-columns table-id query-map lowercase-column)]
     (when (and u (not (get (row-to-map u) "enabled")))
       (throw+ {:anvil/server-error "This account has not been enabled by an administrator", :type "anvil.users.AccountIsNotEnabled"}))
     u)))

(defn force-login [{:keys [remember] :as _kwargs} user-row]
  (when util/*client-request?*
    (throw+ {:anvil/server-error "force_login() can only be used in server modules"}))
  (cond
    (nil? user-row)
    (logout nil)

    (not (and (instance? LiveObjectProxy user-row)
              (= (:backend user-row) "anvil.tables.Row")
              (= (first (row-id user-row)) (:user_table (get-props)))))
    (throw+ {:anvil/server-error "force_login() must be passed a row from the users table"})

    :else
    (login! user-row remember)))

(defn login-with-email [{:keys [remember] :as _kwargs} email password]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_email confirm_email]} (get-props)
          _ (when-not use_email (throw+ {:anvil/server-error "Email/password authentication is not enabled."}))
          user-row (get-user-and-check-enabled user_table {:email (.trim ^String (or email ""))} :email)
          pw-hash (when user-row (get (row-to-map user-row) "password_hash"))]

      (when (and confirm_email user-row (not (get (row-to-map user-row) "confirmed_email")))
        (throw+ {:anvil/server-error "You haven't confirmed your email address. Please check your email and click the confirmation link, or reset your password."
                 :type "anvil.users.EmailNotConfirmed"}))

      (if (anvil.util/bcrypt-checkpw password pw-hash)
        (login! user-row remember)
        (throw+ {:anvil/server-error "Incorrect email address or password" :type "anvil.users.AuthenticationFailed"})))))

(defn signup-common [required-permission signup-method-name search-attributes new-user-attributes login? lowercase-column remember?]
  (let [{:keys [user_table allow_signup enable_automatically] :as props} (get-props)]
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
                new-user (try+
                           ((tables/Table "add_row") [user_table {}] attributes)
                           (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumn" (:type %))) _e
                             (tables/ensure-columns-exist! user_table attributes)
                             ((tables/Table "add_row") [user_table {}] attributes)))]
            (if login?
              (login! new-user remember?)
              new-user)))))))

(defn send-email! [to subject text]
  (if (get-in @util/*session-state* [:users :test-email-divert])
    (swap! util/*session-state* update-in [:users :test-email-divert] concat [{:to to, :subject subject, :text text}])
    (binding [email/*use-quota* false
              email/*require-service-config* false]
      (email/send! {:from_name    (if (app-data/abuse-caution? util/*session-state* util/*app-id*)
                                    "Accounts"
                                    (str (:name util/*app*) " Accounts"))
                    :from_address "accounts"
                    :to           to
                    :subject      subject
                    :text         text}))))

(defn signup-with-email [{:keys [remember] :as _kwargs} email password]
  (let [email (.trim (.toLowerCase ^String (or email "")))
        {:keys [confirm_email enable_automatically require_secure_passwords]} (get-props)
        _ (when (and require_secure_passwords
                     (< (.length (str password)) 7))
            (throw+ {:anvil/server-error "Passwords must be 8 characters or more" :type "anvil.users.PasswordNotAcceptable"}))
        _ (when (and require_secure_passwords
                     (or (< (.length password) 6) (runtime-util/is-password-pwned? password)))
            (throw+ {:anvil/server-error "This password is not safe to use: It has previously been leaked and posted on the internet." :type "anvil.users.PasswordNotAcceptable"}))
        confirmation-key (random/url-part 10)
        new-user-row (signup-common :use_email "Email/password"
                                    {:email email} (merge {:password_hash (BCrypt/hashpw password (BCrypt/gensalt))}
                                                          (when confirm_email
                                                            {:confirmed_email false, :email_confirmation_key confirmation-key}))
                                    (and enable_automatically (not confirm_email)) :email remember)]
    (when confirm_email
      (send-email! email "Confirm your email address"
                   (str "Thanks for registering your account with us. Please click the following link to confirm that this is your account:\n\n"
                        (app-data/get-default-app-origin util/*app-info*)
                        "/_/email-confirm/" (codec/url-encode email) "/" (codec/url-encode confirmation-key)
                        "\n\n"
                        "Thanks,\n"
                        "The team"
                        )))
    new-user-row))

(defn send-password-reset-email [_kwargs email]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_email]} (get-props)
          _ (when-not use_email (throw+ {:anvil/server-error "Email/password authentication is not enabled."}))
          user-row (get-and-create-columns user_table {:email email} :email)
          row-id (row-id user-row)]
      (when (and user-row (get (row-to-map user-row) "enabled"))
        (let [confirmation-key (anvil.util/or-str (get (row-to-map user-row) "email_confirmation_key")
                                                  (let [ck (random/url-part 10)]
                                                    (set-and-return-value-creating-col-if-necessary user_table row-id "email_confirmation_key" ck)))]
          (send-email! email "Reset your password"
                       (str "You have requested a password reset for your account: " email "\n\nClick here to reset your password:\n"
                            (app-data/get-default-app-origin util/*app-info*)
                            "/_/email-pw-reset/" (codec/url-encode email) "/" (codec/url-encode confirmation-key)
                            "\n\n"
                            "Thanks,\n"
                            "The team"
                            ))
          nil)))))

(defn call-if-confirmation-key-correct [app email confirmation-key require-settings f]
  (binding [util/*client-request?* false
            util/*app* (:content app)
            util/*app-id* (:id app)
            util/*session-state* (or util/*session-state* (atom nil))
            util/*rpc-print* #(log/info "Email confirmation table output:" %&)]

    (let [{:keys [user_table use_email] :as props} (get-props)]
      (when (and use_email (every? props require-settings))
        (let [user-row (get-and-create-columns user_table {:email email} :email)
              real-confirmation-key (get (row-to-map user-row) "email_confirmation_key")
              row-id (row-id user-row)]

          (when (and real-confirmation-key
                     (= (anvil-util/sha-256 real-confirmation-key) (anvil-util/sha-256 confirmation-key)))
            (f user_table user-row)))))))

(defn set-if-confirmation-key-correct [app email confirmation-key require-settings new-attributes]
  (call-if-confirmation-key-correct app email confirmation-key require-settings
                                      (fn [user_table user-row]
                                        (try+
                                          ((tables/TRow "set") (row-id user-row) new-attributes)
                                          (catch #(and (:anvil/server-error %) (= "anvil.tables.NoSuchColumn" (:type %))) _e
                                            (tables/ensure-columns-exist! user_table new-attributes)
                                            ((tables/TRow "set") (row-id user-row) new-attributes)))
                                        true)))


(defn confirm-email [app email confirmation-key]
  (set-if-confirmation-key-correct app email confirmation-key #{:allow_signup :confirm_email}
                                   {:confirmed_email true, :email_confirmation_key nil}))


(defn email-password-reset-key-valid? [app email confirmation-key]
  (call-if-confirmation-key-correct app email confirmation-key #{} (constantly true)))


(defn reset-email-password! [app email confirmation-key password]
  (let [{:keys [require_secure_passwords] :as _props} (get-props (:id app) (:content app))
        _ (when (and require_secure_passwords
                     (< (.length (str password)) 7))
            (throw+ {:anvil/server-error "Passwords must be 8 characters or more" :type "anvil.users.PasswordNotAcceptable"}))
        _ (when (and require_secure_passwords
                     (or (< (.length password) 6) (runtime-util/is-password-pwned? password)))
            (throw+ {:anvil/server-error "This password is not safe to use: It has been previously leaked and posted on the internet." :type "anvil.users.PasswordNotAcceptable"}))]
    (set-if-confirmation-key-correct app email confirmation-key #{}
                                     (merge
                                       {:email_confirmation_key nil
                                        :password_hash          (BCrypt/hashpw password (BCrypt/gensalt))}
                                       (when confirm-email
                                         {:confirmed_email true})))))


(defn login-with-google [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_google enable_automatically allow_signup]} (get-props)
          current-google-user (google-auth/get-user-email {})
          _ (when-not use_google (throw+ {:anvil/server-error "Google authentication is not enabled."}))
          _ (when-not current-google-user (throw+ {:anvil/server-error "User is not logged in with Google"}))
          user-row (get-user-and-check-enabled user_table {:email current-google-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_google "Google"
                         {:email (.toLowerCase current-google-user)} nil
                         enable_automatically :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-google [{:keys [remember] :as _kwargs}]
  (if-let [current-google-user (google-auth/get-user-email {})]
    (signup-common :use_google "Google"
                   {:email (.toLowerCase current-google-user)} nil
                   (:enable_automatically (get-props)) :email remember)
    (throw+ {:anvil/server-error "User is not logged in with Google"})))

(defn login-with-facebook [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_facebook enable_automatically allow_signup]} (get-props)
          current-facebook-user (facebook-auth/get-user-email {})
          _ (when-not use_facebook (throw+ {:anvil/server-error "Facebook authentication is not enabled."}))
          _ (when-not current-facebook-user (throw+ {:anvil/server-error "User is not logged in with Facebook"}))
          user-row (get-user-and-check-enabled user_table {:email current-facebook-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_facebook "Facebook"
                         {:email (.toLowerCase current-facebook-user)} nil
                         enable_automatically :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-facebook [{:keys [remember] :as _kwargs}]
  (if-let [current-facebook-user (facebook-auth/get-user-email {})]
    (signup-common :use_facebook "Facebook"
                   {:email (.toLowerCase current-facebook-user)} nil
                   (:enable_automatically (get-props)) :email remember)
    (throw+ {:anvil/server-error "User is not logged in with Facebook"})))

(defn login-with-microsoft [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_microsoft enable_automatically allow_signup]} (get-props)
          current-microsoft-user (microsoft-auth/get-user-email {})
          _ (when-not use_microsoft (throw+ {:anvil/server-error "Microsoft authentication is not enabled."}))
          _ (when-not current-microsoft-user (throw+ {:anvil/server-error "User is not logged in with Microsoft"}))
          user-row (get-user-and-check-enabled user_table {:email current-microsoft-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_microsoft "Microsoft"
                         {:email (.toLowerCase current-microsoft-user)} nil
                         enable_automatically :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-microsoft [{:keys [remember] :as _kwargs}]
  (if-let [current-microsoft-user (microsoft-auth/get-user-email {})]
    (signup-common :use_microsoft "Microsoft"
                   {:email (.toLowerCase current-microsoft-user)} nil
                   (:enable_automatically (get-props)) :email remember)
    (throw+ {:anvil/server-error "User is not logged in with Microsoft"})))

(defn login-with-raven [{:keys [remember] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table use_raven enable_automatically allow_signup]} (get-props)
          current-raven-user (raven-auth/get-user-email {})
          _ (when-not use_raven (throw+ {:anvil/server-error "Raven authentication is not enabled."}))
          user-row (get-user-and-check-enabled user_table {:email current-raven-user} :email)]
      (if user-row
        (login! user-row remember)
        (if allow_signup
          (signup-common :use_raven "Raven"
                         {:email (.toLowerCase current-raven-user)} nil
                         enable_automatically :email remember)
          (throw+ {:anvil/server-error "Not a registered user" :type "anvil.users.AuthenticationFailed"}))))))

(defn signup-with-raven [{:keys [remember] :as _kwargs}]
  (if-let [current-raven-user (raven-auth/get-user-email {})]
    (signup-common :use_raven "Raven"
                   {:email (.toLowerCase current-raven-user)} nil
                   (:enable_automatically (get-props)) :email remember)
    (throw+ {:anvil/server-error "User is not logged in with Raven"})))

(defn get-current-user [{:keys [allow_remembered] :as _kwargs}]
  (binding [util/*client-request?* false]
    (let [{:keys [user_table allow_remember_me remember_me_days] :as props} (get-props)
          cookie-key-token (keyword (str "user-table-" user_table "-remember-me"))
          cookie-type (get-cookie-type props)]
      (if-let [row-id (get-in @util/*session-state* [:users :logged-in-id])]
        ((tables/Table "get_by_id") [user_table {}] {} row-id)
        (try+
          (when-let [remember-token (and allow_remembered
                                         allow_remember_me
                                         (cookies/get-cookie-val cookie-type cookie-key-token))]
            (let [token-hash (anvil-util/sha-256 (str remember-token "#" user_table))
                  user-row (try+
                             ((tables/Table "get") [user_table {}] {"remembered_logins" [{"token_hash" token-hash}]})
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
            nil))))))

(defn get-last-login-email [_kwargs]
  (let [{:keys [user_table] :as props} (get-props)
        cookie-type (get-cookie-type props)]
    (try+
      (cookies/get-cookie-val cookie-type (keyword (str "user-table-" user_table "-last-email")))
      (catch :anvil/cookie-error _
        ; We don't care if cookies didn't work.
        nil))))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.users.get_current_user"          (util/wrap-native-fn get-current-user)
        "anvil.private.users.get_last_login_email"      (util/wrap-native-fn get-last-login-email)
        "anvil.private.users.logout"                    (util/wrap-native-fn logout)
        "anvil.private.users.login_with_email"          (util/wrap-native-fn login-with-email)
        "anvil.private.users.login_with_google"         (util/wrap-native-fn login-with-google)
        "anvil.private.users.login_with_facebook"       (util/wrap-native-fn login-with-facebook)
        "anvil.private.users.login_with_microsoft"      (util/wrap-native-fn login-with-microsoft)
        "anvil.private.users.login_with_raven"          (util/wrap-native-fn login-with-raven)
        "anvil.private.users.force_login"               (util/wrap-native-fn force-login)
        "anvil.private.users.signup_with_email"         (util/wrap-native-fn signup-with-email)
        "anvil.private.users.send_password_reset_email" (util/wrap-native-fn send-password-reset-email)
        "anvil.private.users.signup_with_google"        (util/wrap-native-fn signup-with-google)
        "anvil.private.users.signup_with_facebook"      (util/wrap-native-fn signup-with-facebook)
        "anvil.private.users.signup_with_microsoft"     (util/wrap-native-fn signup-with-microsoft)
        "anvil.private.users.signup_with_raven"         (util/wrap-native-fn signup-with-raven)})

(defn export-with-table [yaml app-id]
  (let [SERVICE-URL "/runtime/services/anvil/users.yml"
        app (app-data/get-app (app-data/get-app-info-insecure app-id))]

    (update-in yaml [:services] (partial map #(if (= SERVICE-URL (:source %))
                                                (assoc % :server_config {:user_table (:user_table (users-util/get-props (:content app)))})
                                                %)))))


