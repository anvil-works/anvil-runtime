(ns anvil.dispatcher.native-rpc-handlers.util
  (:use [slingshot.slingshot])
  (:require [clojure.data.json :as json]
            [digest]
            [crypto.random :as random]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [anvil.dispatcher.types :as types]
            [anvil.runtime.quota :as quota]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.core.worker-pool :as worker-pool]))

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
(def ^:dynamic *rpc-cookies-updated?* nil)
(def ^:dynamic *request-origin* nil)
(def ^:dynamic *client-request?* nil)
(def ^:dynamic *profiles* nil)
(def ^:dynamic *lo-cache-updates* nil)
(def ^:dynamic *live-object-id* nil)


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


(defn wrap-native-fn
  ([f] (wrap-native-fn f nil))
  ([f time-quota-key]
   {:fn
    (fn [{{:keys [live-object args kwargs func] :as call} :call
          :keys                                           [app app-id app-info app-origin session-state origin thread-id environment]
          :as                                             request}
         return-path]
      (worker-pool/run-task! {:type :native-rpc,
                              :name (if live-object (format "%s.%s" (:backend live-object) func) func)
                              :tags (worker-pool/get-task-tags-for-dispatch-request request)}
        (binding [*app-id* app-id
                  *app* app
                  *app-info* app-info
                  *environment* environment
                  *app-origin* app-origin
                  *req* request
                  *thread-id* thread-id
                  *session-state* session-state
                  *rpc-print* (fn [& args]
                                (dispatcher/update! return-path {:output (with-out-str (apply print args))}))
                  *rpc-println* (fn [& args]
                                  (do (apply *rpc-print* args)
                                      (*rpc-print* "\n")))
                  *rpc-cookies-updated?* (atom false)
                  *request-origin* origin
                  *client-request?* (= origin :client)
                  *profiles* (atom [])
                  *lo-cache-updates* (atom nil)]



          (try
            (let [start-time (double (System/currentTimeMillis))
                  stop-time (atom nil)]
              (try+
                (let [resp (try
                             (apply f kwargs args)
                             (finally
                               (reset! stop-time (double (System/currentTimeMillis)))))]

                  (when @*rpc-cookies-updated?*
                    (dispatcher/update! return-path {:set-cookie true}))

                  (dispatcher/respond! return-path
                                       (merge {:response resp}
                                              (when @*lo-cache-updates*
                                                {:cacheUpdates (live-objects/filter-cache-updates
                                                                 @*lo-cache-updates*
                                                                 (live-objects/get-seen-liveobjects args kwargs live-object resp))})
                                              (when (and *session-state*
                                                         (:anvil/enable-profiling @*session-state*))
                                                {:profile (merge {:description "Running native fn"
                                                                  :start-time  start-time
                                                                  :end-time    (double (System/currentTimeMillis))}
                                                                 (when *profiles*
                                                                   {:children @*profiles*}))}))))
                (catch :anvil/server-error e
                  (log/trace (:throwable &throw-context) "Server error")
                  (dispatcher/respond! return-path
                                       {:error (-> e
                                                   (assoc :type (or (:type e) "anvil.server.InternalError"))
                                                   (assoc :message (:anvil/server-error e))
                                                   (assoc :trace [["<rpc>", 0]])
                                                   (dissoc :anvil/server-error))}))
                (finally
                  (when time-quota-key
                    (quota/decrement! session-state environment
                                      time-quota-key
                                      (/ (- @stop-time start-time) 1000))))))
            (catch clojure.lang.ArityException e
              (dispatcher/respond! return-path
                                   {:error {:type    "TypeError"
                                            :message (str "Wrong number of arguments (" (dec (.actual e)) ") passed to " func "(). Did you pass keyword arguments as positional arguments, or vice versa?")
                                            :trace   [["<rpc>", 0]]}}))
            (catch Exception e
              (let [error-id (random/hex 6)]
                (log/error e "Internal server error:" error-id)
                (dispatcher/respond! return-path
                                     {:error {:type "anvil.server.InternalError" :message (str "Internal server error: " error-id)}})))))))}))

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
