(ns anvil.dispatcher.native-rpc-handlers.core
  (:use [slingshot.slingshot])
  (:require [anvil.dispatcher.native-rpc-handlers.http :as native-http]
            [anvil.dispatcher.native-rpc-handlers.google.drive :as native-google-drive]
            [anvil.dispatcher.native-rpc-handlers.google.sheets]
            [anvil.dispatcher.native-rpc-handlers.google.auth :as native-google-auth]
            [anvil.dispatcher.native-rpc-handlers.google.mail :as native-google-mail]
            [anvil.dispatcher.native-rpc-handlers.airtable :as native-airtable]
            [anvil.dispatcher.native-rpc-handlers.bcrypt :as native-bcrypt]
            [anvil.dispatcher.native-rpc-handlers.raven :as native-raven]
            [anvil.dispatcher.native-rpc-handlers.facebook :as native-facebook]
            [anvil.dispatcher.native-rpc-handlers.microsoft :as native-microsoft]
            [anvil.dispatcher.native-rpc-handlers.saml :as native-saml]
            [anvil.dispatcher.native-rpc-handlers.stripe :as native-stripe]
            [anvil.dispatcher.native-rpc-handlers.time :as native-time]
            [anvil.dispatcher.native-rpc-handlers.util :as native-util]
            [anvil.dispatcher.native-rpc-handlers.users.core :as native-users]
            [anvil.dispatcher.native-rpc-handlers.cookies :as native-cookies]
            [anvil.dispatcher.native-rpc-handlers.email :as native-email]
            [anvil.dispatcher.native-rpc-handlers.pdf]
            [anvil.dispatcher.background-tasks]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [anvil.runtime.util :as runtime-util]
            [anvil.util :as util]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.runtime.app-data :as app-data]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.dispatcher.background-tasks :as background-tasks]
            [anvil.runtime.sessions :as sessions]
            [anvil.dispatcher.native-rpc-handlers.users.util :as users-util]
            [anvil.runtime.tables.rpc :as tables]
            [clojure.data.json :as json]))


(def debug-rpc-handlers
  {"anvil.private.dummy_echo"           (native-util/wrap-native-fn (fn [& _]
                                                                      (native-util/*rpc-print* "Hello, world!")
                                                                      "Hello"))

   "anvil.private.echo"                 (native-util/wrap-native-fn (fn [_ x] x))

   "anvil.private.fail"                 (native-util/wrap-native-fn (fn [_] (throw+ {:anvil/server-error "This native RPC function failed."
                                                                                     :type               "anvil.server._FailError"
                                                                                     :docId              "anvil"
                                                                                     :docLinkTitle       "View some documentation"})))

   "anvil.private._sleep"               (native-util/wrap-native-fn (fn [_ t] (min (max t 2) 0) (Thread/sleep (* 1000 t))))

   "anvil.private.dummy_liveobject"     {:fn (fn [_ return-path]
                                               (dispatcher/respond! return-path {:response (live-objects/mk-LiveObjectProxy "anvil.private.DummyLiveObject" "123" ["foo"] ["call_me"])}))}

   ;"anvil.private.test_native_bg_task"  (native-util/wrap-native-fn (fn [_] (background-tasks/launch-native-background-task!
   ;                                                                           (println "Starting task")
   ;                                                                           (doseq [i (range 10)]
   ;                                                                             (swap! background-tasks/*native-bg-task-state* assoc :progress i)
   ;                                                                             (Thread/sleep 1000))
   ;                                                                           (println "Finished task")
   ;                                                                           42)))
   ;
   "anvil.private.iter_test"            (native-util/wrap-native-fn
                                          (fn [_kwargs]
                                            (live-objects/mk-LiveObjectProxy "anvil.private.TestLiveObjectIteration" "123" [] ["__anvil_iter_page__"])))

   "anvil.private.mk_LazyMedia"         (native-util/wrap-native-fn
                                          (fn [kwargs mime-type func & args]
                                            (lazy-media/mk-LazyMedia-with-correct-mac {:manager   "py", :id (util/write-json-str [func args kwargs]),
                                                                                       :mime-type mime-type, :name func}
                                                                                      native-util/*req*)))


   "anvil.private.fetch_lazy_media"     (native-util/wrap-native-fn
                                          (fn [_kwargs {:keys [id manager key]}]
                                            (lazy-media/get-lazy-media native-util/*req* manager key id)))

   "anvil.private.fake_session_expired" (native-util/wrap-native-fn
                                          (fn [_kwargs]
                                            (throw+ {:anvil/server-error "Session expired."
                                                     :type               "anvil.server.SessionExpiredError"})))

   ;; You might expect "anvil.private.reset_session" to be here. It isn't. It's in anvil.runtime.ws because it uses low-level request stuff.

   "anvil.private.get_app_origin"       (native-util/wrap-native-fn
                                          (fn [_kwargs & [env-spec]]
                                            (if (= env-spec "published")
                                              (app-data/get-default-app-origin native-util/*environment*)
                                              native-util/*app-origin*)))

   "anvil.private.get_api_origin"       (native-util/wrap-native-fn
                                          (fn [_kwargs & [env-spec]]
                                            (if (= env-spec "published")
                                              (app-data/get-default-api-origin native-util/*environment*)
                                              (when-let [origin rpc-util/*app-origin*]
                                                (str origin "/_/api")))))

   "anvil.private.get_lazy_media_url"   (native-util/wrap-native-fn
                                          (fn [_kwargs lm is-download?]
                                            (let [{:keys [manager key id name]} (.serialiseForRpc lm nil)
                                                  enc util/real-actual-genuine-url-encoder]
                                              (str native-util/*app-origin* "/_/lm/" (enc manager) "/" (enc key) "/" (enc id) "/" (enc (or name "")) "?s="
                                                   (sessions/url-token native-util/*session-state*)
                                                   (if is-download? "" "&nodl=1")))))

   "anvil.private.enable_profiling"     (native-util/wrap-native-fn
                                          (fn [_kwargs]
                                            (native-util/require-server! "profile")
                                            (swap! native-util/*session-state* assoc :anvil/enable-profiling true)
                                            nil))

   "anvil.private.disable_profiling"    (native-util/wrap-native-fn
                                          (fn [_kwargs]
                                            (native-util/require-server! "profile")
                                            (swap! native-util/*session-state* assoc :anvil/enable-profiling false)
                                            nil))

   "anvil.private.set_cookie"           (native-util/wrap-native-fn
                                          (fn [kwargs type timeout]
                                            (native-util/require-server! "set cookies")
                                            (native-cookies/set-cookie! (keyword type) kwargs timeout)))

   "anvil.private.del_cookie"           (native-util/wrap-native-fn
                                          (fn [_kwargs type key]
                                            (native-util/require-server! "delete cookies")
                                            (native-cookies/del-cookie! (keyword type) (keyword key))))

   "anvil.private.get_cookie"           (native-util/wrap-native-fn
                                          (fn [_kwargs type key]
                                            (native-util/require-server! "read cookies")
                                            (let [val (native-cookies/get-cookie-val (keyword type) (keyword key) :not-found)]
                                              (when (= val :not-found)
                                                (throw+ {:type "KeyError" :anvil/server-error key}))
                                              val)))


   "anvil.private.clear_cookie"         (native-util/wrap-native-fn
                                          (fn [_kwargs type]
                                            (native-util/require-server! "clear cookies")
                                            (native-cookies/clear-cookie! (keyword type))))

   "anvil.private.switch_session!"      {:fn (fn [req return-path]
                                               (dispatcher/synchronous-return-path
                                                 return-path
                                                 (let [alternate-session (:anvil.dispatcher/alternate-session req)
                                                       change-session! (:anvil.dispatcher/change-session! req)]
                                                   (if (and alternate-session change-session!)
                                                     (do
                                                       (change-session! alternate-session)
                                                       (sessions/ensure-logged! alternate-session)
                                                       (:pymods @alternate-session))
                                                     (:pymods @(:session-state req))))))}

   "anvil.private.raise_event"          (native-util/wrap-native-fn
                                          ;; Specify at most one of session_id, session_ids, and channel.
                                          (fn [{:keys [session_id session_ids channel]} name payload]
                                            (native-util/require-server! "raise server events")
                                            ;; If none of session_id, session_ids or channel are specified, raise on current session.
                                            (let [session_id (if (and (not session_id)
                                                                      (empty? session_ids)
                                                                      (not channel))
                                                               (sessions/get-id native-util/*session-state*)
                                                               session_id)
                                                  evt {:name    name
                                                       :payload payload}
                                                  send-to-session-id! #(sessions/send-event! native-util/*app-id*
                                                                                             (:env_id native-util/*environment*)
                                                                                             %
                                                                                             evt)]
                                              ;; TODO: Check only one kwarg provided (or support all of them at once, I suppose)
                                              (cond
                                                session_id
                                                (send-to-session-id! session_id)

                                                session_ids
                                                (doseq [session-id session_ids]
                                                  (send-to-session-id! session-id))

                                                channel
                                                (let [all-sessions (sessions/list-sessions native-util/*app-id* (:env_id native-util/*environment*))
                                                      subscribed-sessions (filter #(let [session-state (sessions/get-session-data-for-env native-util/*app-id* (:env_id native-util/*environment*) %)]
                                                                                     (contains? (:channel-subscriptions session-state) channel)) all-sessions)]
                                                  (doseq [session-id subscribed-sessions]
                                                    (send-to-session-id! session-id)))))))

   "anvil.private.subscribe"            (native-util/wrap-native-fn
                                          (fn [_ channel]
                                            (native-util/require-server! "subscribe to a channel")
                                            (swap! native-util/*session-state* update-in [:channel-subscriptions] clojure.set/union #{channel})
                                            (sessions/notify-session-update! native-util/*session-state*)))

   "anvil.private.unsubscribe"          (native-util/wrap-native-fn
                                          (fn [_ channel]
                                            (native-util/require-server! "unsubscribe from a channel")
                                            (swap! native-util/*session-state* update-in [:channel-subscriptions] disj channel)
                                            (sessions/notify-session-update! native-util/*session-state*)))

   "anvil.private.get_subscriptions"    (native-util/wrap-native-fn
                                          (fn [_]
                                            (native-util/require-server! "get subscriptions")
                                            (vec (get @native-util/*session-state* :channel-subscriptions))))

   "anvil.private.get_session_id"       (native-util/wrap-native-fn
                                          (fn [_kwargs]
                                            (native-util/require-server! "get the current session ID")
                                            (sessions/persist! native-util/*session-state*)
                                            (sessions/get-id native-util/*session-state*)))

   "anvil.private.list_sessions"        (native-util/wrap-native-fn
                                          ;; Returns all the sessions in the current environment, or just the ones where a particular user is logged in.
                                          (fn [{:keys [user] :as _kwargs}]
                                            (native-util/require-server! "list sessions")
                                            (let [all-sessions (sessions/list-sessions native-util/*app-id* (:env_id native-util/*environment*))]
                                              (if user
                                                (let [user-id ((tables/TRow "get_id") (json/read-str (:id user)) {})]
                                                  (filter #(let [session-state (sessions/get-session-data-for-env native-util/*app-id* (:env_id native-util/*environment*) %)]
                                                             (let [user-in-session (get-in session-state [:users :logged-in-id])]
                                                               (= user-in-session user-id))) all-sessions))
                                                all-sessions))))

   "anvil.private.get_session_data"     (native-util/wrap-native-fn
                                          (fn [_kwargs session-id]
                                            (native-util/require-server! "get session data")
                                            (sessions/get-python-session-data-for-env native-util/*app-id* (:env_id native-util/*environment*) session-id)))})


(def debug-live-object-backends
  {"anvil.private.DummyLiveObject" {:fn (fn [request return-path]
                                          (let [{:keys [id method]} (:live-object request)]
                                            (log/debug "Call" method "() on dummy obj #" id)
                                            (dispatcher/respond! return-path {:response "Hi, bob"})))}

   "anvil.private.TestLiveObjectIteration"
                                   (native-util/wrap-live-object-backend
                                     {"__anvil_iter_page__"
                                      (fn [_kwargs _id next-page-key]
                                        (let [next-page-key (or next-page-key 0)
                                              items (take 10 (drop (or next-page-key 0)
                                                                   [1 2 3 4 5 6 7 8 9 10 11]))
                                              n (+ next-page-key 10)]
                                          {:items    items
                                           :nextPage (when (< n 11) n)}))})})

(swap! dispatcher/native-rpc-handlers merge
       debug-rpc-handlers
       native-google-drive/handlers
       native-google-auth/handlers
       native-google-mail/handlers
       native-airtable/handlers
       native-bcrypt/handlers
       native-raven/handlers
       native-facebook/handlers
       native-stripe/handlers
       native-time/handlers
       native-email/handlers)

(swap! dispatcher/native-live-object-backends merge
       debug-live-object-backends
       native-airtable/live-object-backends
       native-stripe/live-object-backends)
