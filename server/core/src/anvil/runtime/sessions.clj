(ns anvil.runtime.sessions
  (:require [crypto.random :as random]
            [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]
            [clojure.edn :as edn]
            [slingshot.slingshot :refer [try+]]
            [clojure.tools.logging :as log]
            [anvil.core.cache :as cache]
            [anvil.runtime.conf :as conf]
            [anvil.metrics :as metrics]
            [anvil.runtime.app-log :as app-log]
            [anvil.runtime.app-data :as app-data])
  (:import (clojure.lang IDeref IAtom Atom IAtom2)
           (java.sql SQLException)
           (java.util Date)
           (java.io Writer)
           (com.google.common.net InternetDomainName)))

;; Objects to represent an Anvil app session.
;; A session implements IAtom (so you can (swap!) and (deref) it, and you can still use atoms for ephemeral
;; sessions that will never touch the DB [although we may want to deprecate this].)
;;
;; If we get an HTTP request with no session token, we give it a "draft" session, which hasn't
;; actually hit the DB (in case we don't need it).
;; When we do something that means our session might outlive this request (eg serving an app),
;; we call (persist!) on it, which causes a draft session to write itself to the DB, and creates
;; a DBSession (to which it then forwards all subsequent operations)
;;
;; If we get an HTTP request with (a) session token(s), we look up a new DBSession for it, or
;; give it a draft session
;;
;; Whenever we (swap!) a backed session, we run that atomic change transactionally against the DB.
;;
;; When an HTTP request finishes, *if* the session is backed, then that request will get a session cookie.

;; You can authenticate to a session with a URL token, a temporary URL token, or a cookie token.
;; Cookie tokens take precedence over URL tokens, and if you ever successfully provide a cookie
;; token we stop accepting URL tokens for that session (except temporary URL tokens, which are used for PDF
;; rendering).

(clj-logging-config.log4j/set-logger! :level :info)

(defprotocol ISession
  (get-id [this] "Returns the ID of this session.")
  (ensure-logged! [this] "Log this session, if it's not been logged already")
  (persist! [this] "Persist this session to the DB, if it's not persisted already")
  (persisted? [this] "Returns whether this session has been persisted to the DB")
  (id-when-persisted [this] "Return this session's ID, or nil if it's not been persisted")

  (ephemeral-cache [this] "Returns an atom for cache (can disappear at any time, no coherence promised)")
  (url-token [this] "A token that can be used to construct a URL in this session (may be nil)")

  (delete! [this] "Delete this session if it's been persisted")
  (deref-db [this] "Get the latest value of the session from the DB, even if it's in the cache"))

(deftype ExtremelyFakeSession [id]

  ISession
  (get-id [this] id))

(def ^:private SESSION-RELOAD-AFTER 5000)
(def ^:private SESSION-TOUCH-AFTER 5000)

(def ^:dynamic *cas-succeeded?*)


;; A data type for safely serialising user-controlled data (eg anvil.server.session and cookies) in the app session
(defrecord UserData [])

(defmethod print-method UserData [data ^Writer w]
  (.write w "#anvil/UserData")
  (print-method (util/write-json-str data) w))

(def edn-options
  {:readers (merge *data-readers* ; Make sure we keep the default readers (clj-yaml adds ordered maps, for example)
                   {'anvil/UserData (fn [data] (map->UserData (util/read-json-str data)))})})

;; cached-state is an atom with keys:
;; {:val VALUE, :db-last-seen (last_seen from DB), :db-expires (expires from DB), :last-read (last read from DB), :deleted? true}

(def -edn-roundtrip-ok?)
(deftype DBSession [id cached-state ephemeral-cache]

  ISession
  (get-id [this] id)
  (persist! [this] nil)
  (persisted? [this] true)
  (id-when-persisted [this] (when-not (:deleted? @cached-state) id))
  (ensure-logged! [this] nil) ;; We're already persisted; too late
  (ephemeral-cache [this] ephemeral-cache)
  (url-token [this] (get-in @this [::tokens :url]))
  (delete! [this]
    (locking this
      (jdbc/execute! util/db ["DELETE FROM runtime_sessions WHERE session_id = ?" id])
      (swap! cached-state assoc :deleted? true)))
  (deref-db [this]
    (locking this
      ;; Return cached value, or update if we need to
      (let [{:keys [last-read val deleted?]} @cached-state
            now (System/currentTimeMillis)
            age (- now last-read)
            reload! (fn [query]
                      (if-let [{:keys [state last_seen expires]} (first (jdbc/query util/db query))]
                        (do
                          (reset! cached-state {:status :backed, :db-last-seen (.getTime last_seen), :db-expires (some-> expires (.getTime)), :last-read now, :val (edn/read-string edn-options state)})
                          (swap! ephemeral-cache dissoc ::dirty))
                        (do
                          (log/trace "Resurrecting session" id)
                          (.swap this (constantly val))))
                      (:val @cached-state))]
        (cond
          deleted?
          nil

          ;; TODO actually use last_seen to make this decision. Also below.
          (> age SESSION-TOUCH-AFTER)
          (let [expiry-timeout-mins (::expiry-timeout-mins val)]
            (metrics/inc! :api/runtime-session-deref-update-total)
            (reload! ["UPDATE runtime_sessions SET last_seen=NOW(), expires=CASE WHEN ?::boolean THEN NULL ELSE NOW() + ?::interval END WHERE session_id=? RETURNING state, last_seen, expires", (nil? expiry-timeout-mins), (str expiry-timeout-mins " minutes") id]))

          :else
          (do
            (metrics/inc! :api/runtime-session-deref-select-total)
            (reload! ["SELECT state, last_seen, expires FROM runtime_sessions WHERE session_id=?" id]))))))

  IDeref
  (deref [this]
    (let [{:keys [last-read val deleted?]} @cached-state
          age (- (System/currentTimeMillis) last-read)]
      (cond
        deleted?
        nil

        ;; TODO actually use last_seen to make this decision. Also above.
        (> age SESSION-RELOAD-AFTER)
        (deref-db this)

        :else
        (do
          (metrics/inc! :api/runtime-session-deref-cache-total)
          val))))

  IAtom
  (swap [this f]
    (locking this
      (when-not (:deleted? cached-state)
        (metrics/inc! :api/runtime-session-swap-total)
        (let [new-val (loop []
                        (or (try+
                              (jdbc/with-db-transaction [db-c util/db {:isolation :repeatable-read}]
                                (let [[found-in-db? old-v] (if-let [s (:state (first (jdbc/query db-c ["SELECT state FROM runtime_sessions WHERE session_id=?" id])))]
                                                             [true (edn/read-string edn-options s)]
                                                             [false (:val @cached-state)])
                                      new-v (f old-v)
                                      new-v-str (pr-str new-v)
                                      now (System/currentTimeMillis)
                                      user-id (get-in new-v [:users :logged-in-id])
                                      expiry-timeout-mins (::expiry-timeout-mins new-v)]
                                  (when-not (and found-in-db?
                                                 (or (= new-v old-v)
                                                     (= new-v ::no-change)))
                                    ;; Check it's still round-trippable *before* we write it back to the DB
                                    (assert (-edn-roundtrip-ok? new-v new-v-str))
                                    (metrics/inc! :api/runtime-session-update-total)
                                    (when-not (seq (jdbc/query db-c ["UPDATE runtime_sessions SET state=?, user_id=?, last_seen=NOW(), expires=CASE WHEN ?::boolean THEN NULL ELSE NOW() + ?::INTERVAL END WHERE session_id=? RETURNING 1" new-v-str user-id (nil? expiry-timeout-mins) (str expiry-timeout-mins " minutes") id]))
                                      (jdbc/execute! db-c ["INSERT INTO runtime_sessions (session_id,state,user_id,last_seen,expires) VALUES (?,?,?,NOW(),CASE WHEN ?::boolean THEN NULL ELSE NOW() + ?::INTERVAL END)" id new-v-str user-id (nil? expiry-timeout-mins) (str expiry-timeout-mins " minutes")]))
                                    (reset! cached-state {:db-last-seen now, :last-read now, :val new-v})
                                    (swap! ephemeral-cache assoc ::dirty true)) ;; This session has been modified since it was loaded.
                                  new-v))
                              (catch #(and (instance? SQLException %) (= "40001" (.getSQLState %))) _e
                                ;; Retry on conflict (can't recur from a (catch) block, so we do this silly (or) thing.)
                                nil))
                            (recur)))]
          (log/trace "Wrote session" (get-id this) "to DB")
          new-val))))
  (swap [this f var1] (.swap this #(f % var1)))
  (swap [this f var1 var2] (.swap this #(f % var1 var2)))
  (swap [this f var1 var2 more] (.swap this #(apply f % var1 var2 more)))
  (compareAndSet [this old-val new-val]
    ;; Inefficient but rarely (never?) used
    (binding [*cas-succeeded?* false]
      (.swap this #(if (= % old-val)
                     (do (set! *cas-succeeded?* true) new-val)
                     old-val))
      *cas-succeeded?*))
  (reset [this val] (.swap this (constantly val))))

(defn- -edn-roundtrip-ok? [value stringified]
  (metrics/inc! :api/runtime-session-edn-roundtrip-total)
  (let [check (fn check [v1 v2 path]
                (or
                  (cond
                    (or (string? v1) (number? v1) (nil? v1) (keyword? v1))
                    (= v1 v2)

                    (map? v1)
                    (and (map? v2)
                         (= (set (keys v1)) (set (keys v2)))
                         (every? (fn [[k v]] (check v (get v2 k) (cons k path))) v1))

                    (sequential? v1)
                    (and (sequential? v2)
                         (= (count v1) (count v2))
                         (->> v1
                              (map-indexed (fn [idx v] (check v (nth v2 idx) (cons idx path))))
                              (reduce #(and %1 %2) true)))

                    (instance? Date v1)
                    (and (instance? Date v2)
                         (= (.getTime v1) (.getTime v2)))

                    :else
                    (= v1 v2))
                  (do
                    (log/trace "Mismatch at" (reverse path) v1 v2 (some-> v1 .getClass) (some-> v2 .getClass))

                    nil)))]
    (check value (try
                   (edn/read-string edn-options stringified)
                   (catch RuntimeException e
                     (log/error e (str "Could not read EDN:" stringified)))) nil)))

(deftype DraftSession [id draft-state]

  ISession
  (get-id [this] id)
  (ephemeral-cache [this] (let [ds @draft-state]
                            (or (:ephemeral-cache ds)
                                (ephemeral-cache (:db-session ds)))))
  (url-token [this]
    (persist! this)
    (url-token (:db-session @draft-state)))
  (persist! [this]
    (locking this
      (let [{:keys [db-session val ephemeral-cache]} @draft-state]
        (when-not db-session
          (ensure-logged! this)
          (let [gen-token #(str id "=" (random/url-part 21))
                val (assoc val ::tokens {:cookie (gen-token), :url (gen-token), :tmp #{}, :burned nil})
                val-str (pr-str val)
                now (System/currentTimeMillis)
                user-id (get-in val [:users :logged-in-id])
                expiry-timeout-mins (::expiry-timeout-mins val)]

            (assert (-edn-roundtrip-ok? val val-str))
            (jdbc/execute! util/db ["INSERT INTO runtime_sessions (session_id,state,user_id,last_seen,expires) VALUES (?,?,?,NOW(),CASE WHEN ?::boolean THEN NULL ELSE NOW() + ?::INTERVAL END)" id val-str user-id (nil? expiry-timeout-mins) (str expiry-timeout-mins " minutes")])
            (reset! draft-state {:db-session (->DBSession id (atom {:val val, :db-last-seen now, :db-expires (when expiry-timeout-mins (+ now (* 60000 expiry-timeout-mins))) :last-read now}) ephemeral-cache)})
            (swap! ephemeral-cache dissoc ::dirty))))))
  (persisted? [this] (boolean (:db-session @draft-state)))
  (id-when-persisted [this] (when-let [s (:db-session @draft-state)]
                          (get-id s)))
  (delete! [this] (when-let [s (:db-session @draft-state)]
                    (delete! s)))
  (deref-db [this] (deref this))
  (ensure-logged! [this]
    (let [{:keys [logged? log-data db-session] {:keys [type]} :client} @draft-state]
      (when-not (or logged? db-session)
        (swap! draft-state assoc :logged? true)
        (app-log/record-session! this log-data))))

  IDeref
  (deref [this] (let [{:keys [db-session val]} @draft-state]
                  (if db-session @db-session val)))

  IAtom
  (swap [this f] (locking this
                   (let [{:keys [db-session val]} @draft-state]
                     (if db-session
                       (swap! db-session f)
                       (:val (swap! draft-state update-in [:val] f))))))
  (swap [this f v1] (.swap this #(f % v1)))
  (swap [this f v1 v2] (.swap this #(f % v1 v2)))
  (swap [this f v1 v2 more] (.swap this #(apply f % v1 v2 more)))
  (compareAndSet [this old-val new-val] (locking this
                                          (if-let [db-s (:db-session @draft-state)]
                                            (compare-and-set! db-s old-val new-val)
                                            (compare-and-set! draft-state (assoc @draft-state :val old-val) (assoc @draft-state :val new-val)))))
  (reset [this val] (.swap this (constantly val))))


;; This turned out to be less useful than we thought - we can eager-load then cache instead
#_(deftype DelaySession [d]
  ISession
  (ephemeral-cache [this] (ephemeral-cache (:session @d)))
  (persist! [this] (persist! (:session @d)))
  (get-tokens [this] (if (realized? d) (or (:tokens @d) (get-tokens (:session @d)))))
  IDeref
  (deref [this] @(:session @d))
  IAtom
  (swap [this f] (.swap ^IAtom (:session @d) f))
  (swap [this f v1] (.swap ^IAtom (:session @d) f v1))
  (swap [this f v1 v2] (.swap ^IAtom (:session @d) f v1 v2))
  (swap [this f v1 v2 more] (.swap ^IAtom (:session @d) f v1 v2 more))
  (compareAndSet [this old-val new-val] (.compareAndSet ^IAtom (:session @d) old-val new-val))
  (reset [this val] (.swap this (constantly val))))

(def session-cache (cache/mk-ttl-cache 1000 30000))

(defn load-session-by-id-without-authentication [id]
  (cache/lookup session-cache id
                #(when-let [{:keys [state last_seen expires]} (first (jdbc/query util/db ["SELECT state, last_seen, expires FROM runtime_sessions WHERE session_id = ?" id]))]
                   (log/trace "Loaded session" id "from DB")
                   (->DBSession id (atom {:val (edn/read-string edn-options state), :db-last-seen (.getTime last_seen), :db-expires (some-> expires (.getTime)) :last-read (System/currentTimeMillis)}) (atom {})))))

(defn load-session-by-token [token get-valid-tokens-from-session]
  (when token
    (when-let [[_ id] (re-matches #"(.+?)=.*" token)]
      (when-let [session (load-session-by-id-without-authentication id)]
        (let [token-sha (util/sha-256 token)]
          (when (some #(and % (= (util/sha-256 %) token-sha))
                      (get-valid-tokens-from-session @session))
            [session id]))))))


(defn new-unlogged-session-with-state [{:keys [app-id environment] :as state} log-data]
  (->DraftSession (random/base32 20)
                  (atom {:ephemeral-cache (atom {}),
                         :logged?         false
                         :log-data        log-data
                         :val             state})))

(defn new-session-with-state [state log-data]
  (doto (new-unlogged-session-with-state state log-data)
    (ensure-logged!)))

(defn new-unlogged-session-from-environment [environment client-type log-data]
  (new-unlogged-session-with-state {:app-id (:app_id environment)
                                    :client {:type client-type}
                                    :environment environment} log-data))

(defn empty-dummy-session []
  (new-unlogged-session-with-state {} nil))

(defn- session-matches-app-and-env? [{:keys [environment] :as req} existing-session]
  (and existing-session
       ; If we're using an existing session, make sure its app-id matches this request.
       (or (not (:app-id @existing-session))
           (not (:app-id req))
           (= (:app-id req) (:app-id @existing-session)))
       ; Also make sure we don't share debug and production sessions.
       (or (not environment) ; Some requests allegedly don't have an environment, e.g. OAuth callbacks
           (= (:env_id environment) (:env_id (:environment @existing-session))))))

(defn client-info-from-request [session-type req]
  {:type     session-type
   :ip       (:remote-addr req)
   :location (util/get-ip-location (:remote-addr req))})

(defonce get-shared-cookie-key (fn [app-info] "SHARED"))

(defonce session-setup-hooks (atom {}))

(defn resolve-ambiguous-client-type! [session type]
  (when-not (get-in @session [:client :type])
    (swap! session assoc-in [:client :type] type)))

(defn new-session-state-from-request
  ([req] (new-session-state-from-request req nil))
  ([req client-type]
   (apply merge
          {:app-origin           (:app-origin req)
           :app-id               (:app-id req)
           :app-info             (:app-info req)
           :environment          (:environment req)
           :cookie-keys          {:local  (keyword (.substring (util/sha-256 (:app-id req)) 0 16))
                                  :shared (keyword (.substring (util/sha-256 (get-shared-cookie-key (:app-info req))) 0 16))}

           :shared-cookie-domain (when (:app-origin req)    ;; There is no origin if we're, say, in a client_auth_callback. In that case we don't care.
                                   (let [[_ host] (re-find #"//([^/:]*)" (:app-origin req))
                                         idn (try (InternetDomainName/from host) (catch IllegalArgumentException e nil))]
                                     (if (and idn (.isUnderPublicSuffix idn))
                                       (str (.topPrivateDomain idn))
                                       host)))

           :cookies              {:local  {}
                                  :shared {}}

           :client               (client-info-from-request client-type req)

           ::last-accessed       (System/currentTimeMillis)
           ::expiry-timeout-mins (or (get conf/override-session-expiry-timeout-mins (:app-id req))
                                     conf/default-session-expiry-timeout-mins) ;; Yes, I did mean to use 'or', in case override is set to nil.
           ::remote-addr         (:remote-addr req)         ; Happily, Ring seems to magically use x-real-ip if behind proxy.
           ::user-agent          (get-in req [:headers "user-agent"])}

          (for [[_ hook] @session-setup-hooks]
            (hook req)))))


; Started with cookies always winning. But when running in an iframe everything had to use URL tokens. But then an oauth popup would open with old cookie tokens, so everything got confused.
; So we moved to URL sessions winning. But that made us vulnerable to session fixation.
; So we moved to URL sessions winning, but only once. Once a URL token had been used in a session with cookies, it was deleted. But this prevented a valid URL token being used twice before we worked out that cookies were available (e.g. client WS connections)
; So we moved to URL sessions winning, with tokens marked "burned" after we see valid cookies. Burned tokens remain valid as long as a cookie for the same session is presented.
(defn get-session-for-request [request cookie-name]
  (log/trace "Get session for" (:uri request) (pr-str (:params request)))
  (let [create-blank-session #(do
                                (log/trace "Creating blank session from:" (pr-str %))
                                ;; We create a lot of these. Don't log this until someone touches it
                                (new-unlogged-session-with-state (merge (new-session-state-from-request request)
                                                                        (when % {:anvil.runtime/replacement-session true}))
                                                                (app-log/log-data-from-ring-request request)))

        get-session-from-cookie-token-or-create-blank (fn []
                                                        (let [supplied-cookie-token (get-in request [:cookies cookie-name :value])]
                                                          (when supplied-cookie-token
                                                            (log/trace "Got a cookie token:" supplied-cookie-token))
                                                          (or (when-let [[session id] (load-session-by-token supplied-cookie-token #(cons (get-in % [::tokens :cookie]) (get-in % [::tokens :tmp])))]
                                                                (log/trace "Loaded session" id (.hashCode session))
                                                                (when (session-matches-app-and-env? request session)
                                                                  ;; If this was the main cookie token, this session's primary browser can do cookies. Great.
                                                                  ;; Disable URL tokens for this session. (Don't do this for temporary tokens - PDF renderers can always
                                                                  ;; do cookies, even if the user's browser can't.)
                                                                  (log/trace "App/env good!")
                                                                  (when (and (= supplied-cookie-token (get-in @session [::tokens :cookie]))
                                                                             (get-in @session [::tokens :url]))
                                                                    (log/trace "Burning URL tokens" (pr-str (get-in @session [::tokens])))
                                                                    (swap! session update-in [::tokens] #(if-let [url-token (get % :url)]
                                                                                                           (-> %
                                                                                                               (assoc :burned url-token)
                                                                                                               (dissoc :url))
                                                                                                           %))
                                                                    ;; Normally we would (notify-session-update!) after a swap, but in this case a
                                                                    ;; slightly stale session isn't a problem - it just means a burned URL token might
                                                                    ;; continue to work a little longer on another server. This doesn't matter.
                                                                    )
                                                                  {:session session, :cookie-token supplied-cookie-token})) ;; TODO: We should probably clear the URL token here. Maybe.
                                                              ;; Else, this is an invalid session
                                                              {:session (create-blank-session (and supplied-cookie-token (not= supplied-cookie-token "")))})))]
    ;; First look for a session token in the URL
    (if-let [supplied-url-token (not-empty (get-in request [:params :_anvil_session]))]
      ;; If we specified a valid URL token, load the session from it.
      (or (when-let [[session id] (load-session-by-token supplied-url-token #(do
                                                                               (log/trace "Looking through URL tokens on session" (.hashCode %) (pr-str (get-in % [::tokens])) "for" (pr-str supplied-url-token))
                                                                               (cons (get-in % [::tokens :url])
                                                                                       (get-in % [::tokens :tmp]))))]
            (log/trace "Found session" id)
            (when (session-matches-app-and-env? request session)
              (log/trace "Session matches" id)
              {:session      session, :url-token supplied-url-token
               ;; Special case: allow URL->Cookie fixation for temp tokens only (PDF rendering is weird)
               :cookie-token (when (contains? (get-in @session [::tokens :tmp]) supplied-url-token)
                               supplied-url-token)}))

          ;; If we specified a burned URL token, load the session from the cookie, but only if it is the same session.
          (do
            (when-let [[session id] (load-session-by-token supplied-url-token (fn [s]
                                                                                (log/trace "Looking through burned tokens on session" (.hashCode s) (pr-str (get-in s [::tokens])) "for" (pr-str supplied-url-token))
                                                                                [(get-in s [::tokens :burned])]))]
              (log/trace "Found session for cookie match" id)
              (let [cookie-session (get-session-from-cookie-token-or-create-blank)]
                (when (= (:session cookie-session) session)
                  (log/trace "Cookie session matches" id)
                  cookie-session))))

          ;; If we specified a non-empty url token, it's an invalid session; otherwise it's just blank
          (do (log/trace "No matches anywhere")
              {:session (create-blank-session (not= supplied-url-token ""))}))

      ;; No URL token? Look for a session from a cookie instead.
      (get-session-from-cookie-token-or-create-blank))))

(defn with-app-session [get-cookie-name]
  [(fn [req]
     (let [cookie-name (get-cookie-name req)
           {:keys [session cookie-token url-token]} (get-session-for-request req cookie-name)
           req (assoc req :app-session session :session-url-token url-token)
           _ (when-let [callback (::call-when-app-session-loaded! req)]
               (callback session))
           existing-session? (persisted? session)
           _ (when existing-session?
               (log/trace "Loaded session" (get-id session) "for request to" (:uri req)))]
       (assoc req ::info {:session           session
                          :existing-session? existing-session?
                          :cookie-token      cookie-token
                          :cookie-name       cookie-name})))
   (fn [req resp]
     (let [{:keys [session existing-session? cookie-token cookie-name]} (::info req)
           post-id (id-when-persisted session)]
       (when (and post-id (not existing-session?))
         (log/trace "Created session" post-id "for request to" (:uri req)))

       (if-let [cookie-token (or cookie-token
                                 (when post-id
                                   (get-in @session [::tokens :cookie])))]
         (assoc-in resp [:cookies cookie-name] (merge {:path      "/"
                                                       :value     cookie-token
                                                       :http-only true}
                                                      (when conf/force-secure-cookies?
                                                        {:same-site :none
                                                         :secure    true})))
         resp)))])


(defn generate-tmp-url-token! [session]
  (persist! session)                                        ;; TODO this will error out anywhere we use a bare atom. Using bare atoms needs to go away.

  (let [token (str (get-id session) "=" (random/base32 30))]
    (swap! session update-in [::tokens :tmp] #(conj (or % #{}) token))
    token))

(defn clear-temporary-url-token! [app-session combined-token]
  (swap! app-session update-in [::tokens :tmp] disj combined-token))

(defn cleanup-sessions! []
  (util/with-db-lock ::cleanup-sessions! false
    (jdbc/execute! util/db ["DELETE FROM runtime_sessions WHERE COALESCE(expires, last_seen + INTERVAL '30 minutes') < NOW()"])))


(defonce session-matches-environment? (fn [environment session] false))

(defn get-session-for-env [environment session-id]
  (when-let [session (load-session-by-id-without-authentication session-id)]
    (when (session-matches-environment? environment session)
      session)))

(defn get-session-data-for-env [environment session-id]
  (when-let [session (get-session-for-env environment session-id)]
    @session))

(defn get-python-session-data-for-env [environment session-id]
  (let [session-data (get-session-data-for-env environment session-id)]
    (get-in session-data [:pymods :session])))

;; TODO: Implement within-node session hooks for server-initiated events

; Map of session-id -> cookie -> {session, callbacks}
(defonce listeners (atom {}))
(defonce last-cookie (atom 0))

(defonce register-session-listener! (fn [session callbacks]
                                      (when-let [session-id (get-id session)]
                                        (let [cookie (swap! last-cookie inc)]
                                          (swap! listeners assoc-in [session-id cookie] {:session   session
                                                                                         :callbacks callbacks})
                                          cookie))))

(defonce unregister-session-listener! (fn [session cookie]
                                        (when-let [session-id (get-id session)]
                                          (swap! listeners util/dissoc-in-or-remove [session-id cookie]))))

;; TODO: Session invalidation should really be implemented directly in the runtime, without the need for listeners.
(defonce notify-session-update! (fn notify-session-update!
                                  ([session] (notify-session-update! session false))
                                  ([session async?]
                                   (when-let [session-id (get-id session)]
                                     (cache/evict! session-cache session-id) ;; So that new requests don't hit a stale cache
                                     (doseq [[_ {:keys [session _callbacks]}] (get @listeners session-id)]
                                       (deref-db session))))))

(defonce send-event! (fn [app-id env-id session-id event] nil))

(defonce list-sessions (fn [environment] nil))

;; This is a special-case thing for users. One day this will grow into an arbitrary tagging session with a JSONB
;; column
(defn list-sessions-for-user-id [user-row-id]
  (->> (jdbc/query util/db ["SELECT session_id FROM runtime_sessions WHERE user_id=?" user-row-id])
       (map :session_id)))

(def set-ws-hooks! (util/hook-setter [register-session-listener! unregister-session-listener! notify-session-update! send-event! list-sessions session-matches-environment? get-shared-cookie-key]))
