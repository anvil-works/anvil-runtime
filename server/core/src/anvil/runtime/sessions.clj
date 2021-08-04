(ns anvil.runtime.sessions
  (:require [crypto.random :as random]
            [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]
            [clojure.edn :as edn]
            [slingshot.slingshot :refer [try+]]
            [anvil.runtime.util :as runtime-util]
            [clojure.tools.logging :as log]
            [anvil.core.cache :as cache]
            [anvil.runtime.conf :as conf])
  (:import (clojure.lang IDeref IAtom Atom IAtom2)
           (java.sql SQLException)
           (java.util Date)
           (java.io Writer)))

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

(defprotocol AnySession
  (ephemeral-cache [this] "Returns an atom for cache (can disappear at any time, no coherence promised)")
  (url-token [this] "A token that can be used to construct a URL in this session (may be nil)"))

(extend Atom
  AnySession
  {:ephemeral-cache (fn [this] this)
   :url-token (constantly nil)})

(defprotocol IPersistableSession
  (persist! [this] "Persist this session, if it's not persisted already")
  (persistent-id [this] "Return this session's persistent ID, or nil if it's not been persisted")
  (delete! [this] "Delete this session if it's been persisted")
  (deref-db [this] "Get the latest value of the session from the DB, even if it's in the cache"))

(def ^:private SESSION-RELOAD-AFTER 5000)
(def ^:private SESSION-TOUCH-AFTER 5000)

(def ^:dynamic *cas-succeeded?*)


;; A data type for safely serialising user-controlled data (eg anvil.server.session and cookies) in the app session
(defrecord UserData [])

(defmethod print-method UserData [data ^Writer w]
  (.write w "#anvil/UserData")
  (print-method (util/write-json-str data) w))

(def edn-options
  {:readers {'anvil/UserData (fn [data] (map->UserData (util/read-json-str data)))}})

;; cached-state is an atom with keys:
;; {:val VALUE, :db-last-seen (last_seen from DB), :last-read (last read from DB), :deleted? true}

(def -edn-roundtrip-ok?)
(deftype DBSession [id cached-state ephemeral-cache]
  AnySession
  (ephemeral-cache [this] ephemeral-cache)
  (url-token [this] (get-in @this [::tokens :url]))

  IPersistableSession
  (persist! [this] nil)
  (persistent-id [this] (when-not (:deleted? @cached-state) id))
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
                      (if-let [{:keys [state last_seen]} (first (jdbc/query util/db query))]
                        (do
                          (reset! cached-state {:status :backed, :db-last-seen (.getTime last_seen), :last-read now, :val (edn/read-string edn-options state)})
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
          (reload! ["UPDATE runtime_sessions SET last_seen=NOW() WHERE session_id=? RETURNING state, last_seen" id])

          :else
          (reload! ["SELECT state, last_seen FROM runtime_sessions WHERE session_id=?" id])))))

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
        val)))

  IAtom
  (swap [this f]
    (locking this
      (when-not (:deleted? cached-state)
        (loop []
          (or (try+
                (jdbc/with-db-transaction [db-c util/db {:isolation :repeatable-read}]
                  (let [old-v (if-let [s (:state (first (jdbc/query db-c ["SELECT state FROM runtime_sessions WHERE session_id=?" id])))]
                                (edn/read-string edn-options s)
                                (:val @cached-state))
                        new-v (f old-v)
                        new-v-str (pr-str new-v)
                        now (System/currentTimeMillis)]
                    (when-not (or (= new-v old-v)
                                  (= new-v ::no-change))
                      ;; Check it's still round-trippable *before* we write it back to the DB
                      (assert (-edn-roundtrip-ok? new-v new-v-str))
                      (when-not (seq (jdbc/query db-c ["UPDATE runtime_sessions SET state=?, last_seen=NOW() WHERE session_id=? RETURNING 1" new-v-str id]))
                        (jdbc/execute! db-c ["INSERT INTO runtime_sessions (session_id,state,last_seen) VALUES (?,?,NOW())" id new-v-str]))
                      (reset! cached-state {:db-last-seen now, :last-read now, :val new-v})
                      (swap! ephemeral-cache assoc ::dirty true)) ;; This session has been modified since it was loaded.
                    new-v))
                (catch #(and (instance? SQLException %) (= "40001" (.getSQLState %))) _e
                  ;; Retry on conflict (can't recur from a (catch) block, so we do this silly (or) thing.)
                  nil))
              (recur))))))
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

(deftype DraftSession [draft-state]
  AnySession
  (ephemeral-cache [this] (let [ds @draft-state]
                            (or (:ephemeral-cache ds)
                                (ephemeral-cache (:db-session ds)))))
  (url-token [this]
    (persist! this)
    (url-token (:db-session @draft-state)))

  IPersistableSession
  (persist! [this]
    (locking this
      (let [{:keys [db-session val ephemeral-cache]} @draft-state]
        (when-not db-session
          (let [new-id (random/url-part 18)
                gen-token #(str new-id "=" (random/url-part 21))
                val (assoc val ::tokens {:cookie (gen-token), :url (gen-token), :tmp #{}, :burned nil})
                val-str (pr-str val)
                now (System/currentTimeMillis)]

            (assert (-edn-roundtrip-ok? val val-str))
            (jdbc/execute! util/db ["INSERT INTO runtime_sessions (session_id,state,last_seen) VALUES (?,?,NOW())" new-id val-str])
            (reset! draft-state {:db-session (->DBSession new-id (atom {:val val, :db-last-seen now, :last-read now}) ephemeral-cache)})
            (swap! ephemeral-cache dissoc ::dirty))))))
  (persistent-id [this] (when-let [s (:db-session @draft-state)]
                          (persistent-id s)))
  (delete! [this] (when-let [s (:db-session @draft-state)]
                    (delete! s)))
  (deref-db [this] (deref this))

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
  AnySession
  (ephemeral-cache [this] (ephemeral-cache (:session @d)))
  IPersistableSession
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
                #(when-let [{:keys [state last_seen]} (first (jdbc/query util/db ["SELECT state, last_seen FROM runtime_sessions WHERE session_id = ?" id]))]
                   (->DBSession id (atom {:val (edn/read-string edn-options state), :db-last-seen (.getTime last_seen) :last-read (System/currentTimeMillis)}) (atom {})))))

(defn load-session-by-token [token get-valid-tokens-from-session]
  (when token
    (when-let [[_ id] (re-matches #"(.+?)=.*" token)]
      (when-let [session (load-session-by-id-without-authentication id)]
        (let [token-sha (util/sha-256 token)]
          (when (some #(and % (= (util/sha-256 %) token-sha))
                      (get-valid-tokens-from-session @session))
            [session id]))))))

(defn new-session [{:keys [app-id environment] :as state}]
  (->DraftSession (atom {:ephemeral-cache (atom {}),
                         :val             state})))

(defn mk-session [environment]
  (new-session {:app-id (:app_id environment), :environment environment}))

(defn- session-matches-app-and-env? [{:keys [environment] :as req} existing-session]
  (and existing-session
       ; If we're using an existing session, make sure its app-id matches this request.
       (or (not (:app-id @existing-session))
           (not (:app-id req))
           (= (:app-id req) (:app-id @existing-session)))
       ; Also make sure we don't share debug and production sessions.
       (or (not environment) ; Some requests allegedly don't have an environment, e.g. OAuth callbacks
           (= (:env_id environment) (:env_id (:environment @existing-session))))))

; Started with cookies always winning. But when running in an iframe everything had to use URL tokens. But then an oauth popup would open with old cookie tokens, so everything got confused.
; So we moved to URL sessions winning. But that made us vulnerable to session fixation.
; So we moved to URL sessions winning, but only once. Once a URL token had been used in a session with cookies, it was deleted. But this prevented a valid URL token being used twice before we worked out that cookies were available (e.g. client WS connections)
; So we moved to URL sessions winning, with tokens marked "burned" after we see valid cookies. Burned tokens remain valid as long as a cookie for the same session is presented.
(defn get-session-for-request [request cookie-name get-blank-session-val]
  (log/trace "Get session for" (:uri request) (pr-str (:params request)))
  (let [create-blank-session #(new-session (merge (get-blank-session-val)
                                                  (when % {:anvil.runtime/replacement-session true})))

        get-session-from-cookie-token-or-create-blank (fn []
                                                        (let [supplied-cookie-token (get-in request [:cookies cookie-name :value])]
                                                          (when supplied-cookie-token
                                                            (log/trace "Got a cookie token:" supplied-cookie-token))
                                                          (or (when-let [[session id] (load-session-by-token supplied-cookie-token #(cons (get-in % [::tokens :cookie]) (get-in % [::tokens :tmp])))]
                                                                (log/trace "Loaded session" id)
                                                                (when (session-matches-app-and-env? request session)
                                                                  ;; If this was the main cookie token, this session's primary browser can do cookies. Great.
                                                                  ;; Disable URL tokens for this session. (Don't do this for temporary tokens - PDF renderers can always
                                                                  ;; do cookies, even if the user's browser can't.)
                                                                  (log/trace "App/env good!")
                                                                  (when (and (= supplied-cookie-token (get-in @session [::tokens :cookie]))
                                                                             (get-in @session [::tokens :url]))
                                                                    (swap! session update-in [::tokens] #(-> %
                                                                                                             (assoc :burned (get % :url))
                                                                                                             (dissoc :url))))
                                                                  {:session session, :cookie-token supplied-cookie-token})) ;; TODO: We should probably clear the URL token here. Maybe.
                                                              ;; Else, this is an invalid session
                                                              {:session (create-blank-session (and supplied-cookie-token (not= supplied-cookie-token "")))})))]
    ;; First look for a session token in the URL
    (if-let [supplied-url-token (not-empty (get-in request [:params :s]))]
      ;; If we specified a valid URL token, load the session from it.
      (or (when-let [[session id] (load-session-by-token supplied-url-token #(cons (get-in % [::tokens :url])
                                                                                   (get-in % [::tokens :tmp])))]
            (when (session-matches-app-and-env? request session)
              {:session      session, :url-token supplied-url-token
               ;; Special case: allow URL->Cookie fixation for temp tokens only (PDF rendering is weird)
               :cookie-token (when (contains? (get-in @session [::tokens :tmp]) supplied-url-token)
                               supplied-url-token)}))

          ;; If we specified a burned URL token, load the session from the cookie, but only if it is the same session.
          (when-let [[session id] (load-session-by-token supplied-url-token (fn [s] [(get-in s [::tokens :burned])]))]
            (let [cookie-session (get-session-from-cookie-token-or-create-blank)]
              (when (= (:session cookie-session) session)
                cookie-session)))

          ;; If we specified a non-empty url token, it's an invalid session; otherwise it's just blank
          {:session (create-blank-session (not= supplied-url-token ""))})

      ;; No URL token? Look for a session from a cookie instead.
      (get-session-from-cookie-token-or-create-blank))))

(defn with-app-session [ring-handler get-cookie-name]
  (fn [req]
    (let [cookie-name (get-cookie-name req)
          {:keys [session cookie-token url-token]} (get-session-for-request req cookie-name #(runtime-util/blank-app-session-state req))
          req (assoc req :app-session session :session-url-token url-token)
          _ (when-let [callback (::call-when-app-session-loaded! req)]
              (callback session))
          pre-id (persistent-id session)
          _ (when pre-id
              (log/trace "Loaded session" (persistent-id session) "for request to" (:uri req)))]

      (when-let [resp (ring-handler req)]
        (let [post-id (persistent-id session)]
          (when (and post-id (not pre-id))
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
            resp))))))

(defn generate-tmp-url-token! [session]
  (persist! session)                                        ;; TODO this will error out anywhere we use a bare atom. Using bare atoms needs to go away.

  (let [token (str (persistent-id session) "=" (random/base32 30))]
    (swap! session update-in [::tokens :tmp] #(conj (or % #{}) token))
    token))

(defn clear-temporary-url-token! [app-session combined-token]
  (swap! app-session update-in [::tokens :tmp] disj combined-token))

(defn cleanup-sessions! []
  (jdbc/execute! util/db ["DELETE FROM runtime_sessions WHERE last_seen < NOW() - INTERVAL '30 minutes'"]))

(defn get-session-data-for-env [app-id env-id session-id]
  (let [session (load-session-by-id-without-authentication session-id)]
    (when (and (= app-id (:app-id @session))
               (= env-id (:env_id (:environment @session))))
      @session)))

(defn get-python-session-data-for-env [app-id env-id session-id]
  (let [session-data (get-session-data-for-env app-id env-id session-id)]
    (get-in session-data [:pymods :session])))

;; TODO: Implement within-node session hooks for server-initiated events

(defonce register-session-listener! (fn [session callbacks] nil))

(defonce unregister-session-listener! (fn [session cookie] nil))

(defonce notify-session-update! (fn [session] nil))

(defonce send-event! (fn [app-id env-id session-id event] nil))

(defonce list-sessions (fn [app-id env-id] nil))

(def set-ws-hooks! (util/hook-setter [register-session-listener! unregister-session-listener! notify-session-update! send-event! list-sessions]))
