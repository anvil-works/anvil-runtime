(ns anvil.dispatcher.native-rpc-handlers.util
  (:use [clj-commons.slingshot])
  (:require [clojure.data.json :as json]
            [digest]
            [crypto.random :as random]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [anvil.dispatcher.types :as types]
            [anvil.runtime.quota :as quota]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.core.tracing :as tracing]
            [anvil.util :as util])
  (:import (java.util Timer)))

;(clj-logging-config.log4j/set-logger! :level :trace)

(def ^:dynamic *app* nil)
(def ^:dynamic *app-info* nil)
(def ^:dynamic *app-id* nil)
(def ^:dynamic *environment* nil)
(def ^:dynamic *app-origin* nil)
(def ^:dynamic *req* nil)
(def ^:dynamic *thread-id* nil)
(def ^:dynamic *session-state* nil)
(def ^:dynamic *rpc-print* (fn [& args] nil))
(def ^:dynamic *rpc-println* (fn [& args] nil))
(def ^:dynamic *rpc-update!* (fn [update-message] nil))
(def ^:dynamic *rpc-cookies-updated?* nil)
(def ^:dynamic *request-origin* nil)
(def ^:dynamic *client-request?* nil)
(def ^:dynamic *profiles* nil)
(def ^:dynamic *lo-cache-updates* nil)
(def ^:dynamic *live-object-id* nil)
(def ^:dynamic *trace-id* nil)

(defn log-ctx []
  {:app-session *session-state*, :app-id (:id *app-info*), :environment (assoc *environment* :commit-id (:version *app*))})

(defn update-live-object-cache! [backend id new-item-cache]
  (when *lo-cache-updates*
    (let [new-item-cache (into {}
                               (for [[_k v :as kv] new-item-cache :when (types/serialisable-in-item-cache? v)]
                                 kv))]
      (swap! *lo-cache-updates* assoc-in [backend id] new-item-cache))))

(defn invalidate-live-object-cache!
  ([backend] (when *lo-cache-updates*
               (swap! *lo-cache-updates* assoc backend nil)))
  ([backend id] (update-live-object-cache! backend id nil)))

(defn context-from-request
  ([request] (context-from-request request nil))
  ([request return-path]
   (merge {:app-id               (:app-id request)
           :app                  (:app request)
           :app-info             (:app-info request)
           :environment          (:environment request)
           :app-origin           (:app-origin request)
           :req                  request
           :thread-id            (:thread-id request)
           :trace-id             (tracing/get-trace-id (:tracing-span request))
           :session-state        (:session-state request)
           :request-origin       (:origin request)
           :client-request?      (= (:origin request) :client)}

          (when return-path
            (let [rpc-update! (fn [update]
                                (dispatcher/update! return-path update))
                  rpc-print (fn [& args]
                              (rpc-update! {:output (with-out-str (apply print args))}))
                  rpc-println (fn [& args]
                                (apply rpc-print args)
                                (*rpc-print* "\n"))]
              {:rpc-print            rpc-print
               :rpc-println          rpc-println
               :rpc-update!          rpc-update!
               :rpc-cookies-updated? (atom false)})))))

(defmacro with-basic-native-bindings-from-context [context & body]
  `(binding [*app-id* (:app-id ~context)
             *app* (:app ~context)
             *app-info* (:app-info ~context)
             *environment* (:environment ~context)
             *app-origin* (:app-origin ~context)
             *req* (:req ~context)
             *thread-id* (:thread-id ~context)
             *trace-id* (:trace-id ~context)
             *session-state* (:session-state ~context)
             *request-origin* (:request-origin ~context)
             *client-request?* (:client-request? ~context)]
     ~@body))

(defmacro with-native-bindings-from-context [context & body]
  `(binding [*rpc-print* (:rpc-print ~context)
             *rpc-println* (:rpc-println ~context)
             *rpc-update!* (:rpc-update! ~context)
             *rpc-cookies-updated?* (:rpc-cookies-updated? ~context)]
     (with-basic-native-bindings-from-context ~context
       ~@body)))

(defmacro with-basic-native-bindings-from-request [request & body]
  `(with-basic-native-bindings-from-context (context-from-request ~request)
     ~@body))

(defmacro with-native-bindings-from-request [request return-path & body]
  `(with-native-bindings-from-context (context-from-request ~request ~return-path)
     ~@body))

(defonce ^:private delayed-task-timer (Timer. true))
(def ^:private orgs-to-delay {1 50})

(defn- respond-with-incorrect-arity-error! [return-path args-count func-name]
  (let [msg (str "Wrong number of arguments (" args-count ") passed to " func-name "(). "
                 "Did you pass keyword arguments as positional arguments, or vice versa?")]
    (dispatcher/respond-with-error! return-path
                                    {:type "TypeError" :anvil/server-error msg})))

(defn wrap-async-native-fn
  "Turns an (optionally asynchronous) function into an RPC handler.

   The supplied function takes the following parameters:
     `return-path` used to dispatch responses
     `context` map of additional context for the function call
     `kwargs` map of keyword arguments
     `args` list of positional arguments

   The supplied function can either block or return immediately. While executing it can:
     `dispatcher/respond!` when it has a result
     `dispatcher/respond-with-error!` for :anvil/server-error errors that should be exposed to the user
     `dispatcher/respond-with-internal-sever-error!` for other Exceptions

   Dynamic bindings are per-thread, so can cause problems when multiple threads are in play.
   Prefer to use the `context` map instead (e.g. `(:req context)` instead of `*req*`).
  "
  ([f] (wrap-async-native-fn f nil))
  ([f time-quota-key]
   {:fn
    (fn [{{:keys [live-object args kwargs func]} :call
          :keys [session-state environment tracing-span] :as request}
         return-path]
      (let [func-name (if live-object (format "%s.%s" (:backend live-object) func) func)
            tags (worker-pool/get-task-tags-for-dispatch-request request)
            delay (worker-pool/get-delay-for-dispatch-request request)
            launch-task! (fn []
                           (worker-pool/run-task! {:type :native-rpc,
                                                   :name func-name
                                                   :tags tags}
                             (binding [*profiles* (atom [])
                                       *lo-cache-updates* (atom nil)]
                               (let [context (assoc (context-from-request request return-path)
                                               :profiles *profiles*
                                               :lo-cache-updates *lo-cache-updates*)]
                                 (with-native-bindings-from-context context
                                   (tracing/with-parent-span tracing-span
                                     (worker-pool/set-task-tracing-span! tracing-span)
                                     (let [start-time (double (System/currentTimeMillis))
                                           update-quota! (fn []
                                                           (when time-quota-key
                                                             (quota/decrement! session-state environment nil
                                                                               time-quota-key
                                                                               (/ (- (double (System/currentTimeMillis)) start-time) 1000))))
                                           return-path {:respond!
                                                        (fn [response]
                                                          (update-quota!)
                                                          (when @(:rpc-cookies-updated? context)
                                                            (dispatcher/update! return-path {:set-cookie true}))

                                                          (dispatcher/respond!
                                                            return-path
                                                            (merge response
                                                                   (when @(:lo-cache-updates context)
                                                                     {:cacheUpdates (live-objects/filter-cache-updates
                                                                                      @(:lo-cache-updates context)
                                                                                      (live-objects/get-seen-liveobjects args kwargs live-object (:response response)))})
                                                                   (when (and (:session-state context)
                                                                              (:anvil/enable-profiling @(:session-state context)))
                                                                     {:profile (merge {:description "Running native fn"
                                                                                       :start-time  start-time
                                                                                       :end-time    (double (System/currentTimeMillis))}
                                                                                      (when (:profiles context)
                                                                                        {:children @(:profiles context)}))}))))
                                                        :update!
                                                        #(dispatcher/update! return-path %)}]
                                       (try+
                                         (apply f return-path context kwargs args)

                                         (catch clojure.lang.ArityException e
                                           (update-quota!)
                                           (log/trace "ArityException:" e)
                                           (respond-with-incorrect-arity-error! return-path (count args) func))
                                         (catch :anvil/server-error e
                                           (update-quota!)
                                           (dispatcher/respond-with-error! return-path e))
                                         (catch Object e
                                           (update-quota!)
                                           (dispatcher/respond-with-internal-server-error!
                                             return-path (:throwable &throw-context) (str ::wrap-async-native-fn "(" func-name ")")))))))))))]

        (if (and delay (not= delay 0))
          (.schedule delayed-task-timer
                     (util/timer-task "Delaying native RPC launch"
                       (launch-task!))
                     delay)
          (launch-task!))))}))

(defn wrap-native-fn
  ([f] (wrap-native-fn f nil))
  ([f time-quota-key]
   (let [async-fn (fn [return-path context kwargs & args]
                    (let [func-name (get-in context [:req :call :func])]
                      (try+
                        (let [result (apply f kwargs args)]
                          (dispatcher/respond! return-path {:response result}))

                        (catch :anvil/server-error e
                          (dispatcher/respond-with-error! return-path e))
                        (catch clojure.lang.ArityException e
                          (log/trace "ArityException:" e)
                          (respond-with-incorrect-arity-error! return-path (count args) func-name))
                        (catch Object e
                          (dispatcher/respond-with-internal-server-error!
                            return-path (:throwable &throw-context) (str ::wrap-native-fn "(" func-name ")"))))))]

     (wrap-async-native-fn async-fn time-quota-key))))

(defn wrap-lazy-media-server [f]
  (fn [{:keys [app-id environment app session-state] :as request} media-id]
    (binding [*app-id* app-id
              *environment* environment
              *app* app
              *session-state* session-state
              *client-request?* true]
      (f media-id))))

(def ^:dynamic *permissions* [])

(defn have-live-object-permission? [pname]
  (boolean (some #{pname} *permissions*)))

(defn wrap-live-object-backend
  ([obj] (wrap-live-object-backend obj nil))
  ([obj time-quota-key]
   (wrap-native-fn (fn [kwargs & args]
                     (let [{:keys [id permissions _mac]} (:live-object (:call *req*))
                           method (:func (:call *req*))
                           id-decoded (json/read-str id :key-fn keyword)]
                       (try+
                         (if-let [method-fn (get obj method)]
                           (binding [*permissions* permissions
                                     *live-object-id* id]
                             (log/trace "Calling LiveObject method:" (pr-str {:method method :args args :kwargs kwargs}))
                             (apply method-fn id-decoded kwargs args))
                           (throw+ {:anvil/server-error (str "Unsupported live object method: " method)}))
                         (catch clojure.lang.ArityException e
                           (log/trace e "Probably incorrect arity from user code")
                           (throw+ {:anvil/server-error (str "Wrong number of arguments (" (- (.actual e) 2) ") passed to " method "(). Did you pass keyword arguments as positional arguments, or vice versa?")
                                    :type               "TypeError"})))))
                   time-quota-key)))

(defn decode-python-args [fn-name arg-spec keyword-args positional-args]
  (loop [arg-values []
         pargs positional-args
         kwargs keyword-args
         [arg & more-spec] arg-spec
         seen-stars? false]
    (let [has-default-value? (contains? (meta arg) :default)
          arg-name (when arg (name arg))]
      (cond
        (nil? arg)
        (cond
          (not (empty? pargs))
          (throw+ {:anvil/server-error (format "Too many parameters passed to function %s()" fn-name)})

          (not (empty? kwargs))
          (throw+ {:anvil/server-error (format "Invalid keyword parameter '%s' passed to function %s()" (name (first (keys kwargs))) fn-name)})

          :else
          arg-values)

        (.startsWith arg-name "**")
        (recur (conj arg-values kwargs)
               pargs
               {}
               more-spec
               true)

        (.startsWith arg-name "*")
        (recur (conj arg-values pargs)
               []
               kwargs
               more-spec
               true)

        seen-stars?
        (throw (Exception. (format "Invalid argument spec for %s: argument '" arg "' comes after *args or **kwargs" fn-name)))

        (empty? pargs)
        (cond
          (contains? kwargs (keyword arg))
          (recur (conj arg-values (get kwargs (keyword arg)))
                 pargs
                 (dissoc kwargs (keyword arg))
                 more-spec
                 false)

          has-default-value?
          (recur (conj arg-values (:default (meta arg)))
                 pargs
                 kwargs
                 more-spec
                 false)

          :else
          (throw+ {:anvil/server-error (format "Too few parameters passed to function %s (missing %s)" fn-name arg)
                   :type               "TypeError"}))


        (contains? kwargs (keyword arg))
        (throw+ {:anvil/server-error (format "Parameter '%s' of function %s() specifed twice (by position and keyword)" arg fn-name)
                 :type               "TypeError"})

        :else
        (recur (conj arg-values (first pargs))
               (rest pargs)
               kwargs
               more-spec
               false)))))

(defmacro py-fn [fn-name arg-spec & body]
  `(fn ~fn-name [kwargs# & args#]
     (let [~arg-spec (decode-python-args ~(name fn-name) (quote ~arg-spec) kwargs# args#)]
       ~@body)))

(defmacro def-py-fn [fn-name arg-spec & body]
  `(def ~fn-name (py-fn ~fn-name ~arg-spec ~@body)))

(defmacro py-method [fn-name [id-var & arg-spec] & body]
  `(fn ~fn-name [lo-id# kwargs# & args#]
     (let [~id-var lo-id#
           ~(vec arg-spec) (decode-python-args ~(name fn-name) (quote ~arg-spec) kwargs# args#)]
       ~@body)))

(defn require-server!
  ([] (require-server! nil))
  ([operation]
   (when *client-request?*
     (throw+ {:anvil/server-error (str "Permission denied. Cannot " (or operation "call this function") " from client code.")}))))

(defn invalidate-client-objects-without-notify! [app-session]
  (swap! app-session assoc :liveobject-secret (random/base64 128) :lazy-media-secret (random/base64 32)))

(defn invalidate-client-objects! []
  (invalidate-client-objects-without-notify! *session-state*)
  (*rpc-update!* {:invalidate-macs true}))
