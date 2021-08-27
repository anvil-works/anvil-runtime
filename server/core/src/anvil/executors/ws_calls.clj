(ns anvil.executors.ws-calls
  (:use [slingshot.slingshot :only [throw+ try+]])
  (:require anvil.dispatcher.core
            [anvil.dispatcher.serialisation.core :as serialisation]
            [clojure.data.json :as json]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.core :as dispatcher]
            [org.httpkit.server :as ws]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [anvil.util :as util]
            [crypto.random :as random]
            [anvil.runtime.app-data :as app-data]
            [anvil.runtime.sessions :as sessions]
            [anvil.runtime.util :as runtime-util]))

(clj-logging-config.log4j/set-logger! :level :info)

;; Hookable function to add metadata for this request that can be used to attribute it to an app/environment/etc.
;; This will be put on the call context as ::accounting-info
(defonce get-accounting-info (fn [request] nil))

;; Centralise translation between the `request` object (contains Atoms, pretty chunky)
;; and a "serialisable request" object suitable for putting on the wire

(defn stateful-request-to-serialisable-request [request return-path profiling-info]
  ;; Takes a (stateful) request+return-path, produces:
  ;;  - a serialisable request
  ;;  - a return path that understands :update-python-session
  ;;  - a precise specification of the app+dependencies version for (retrieve-exact-app) (currently the app itself, but we can make this more efficient)
  (let [{:keys [app-id app session-state environment call-stack stale-uplink? vt_global]} request
        blended-version (apply str (:commit-id environment) (for [[_ {:keys [commit-id]}] (sort-by first (:dependency_code app))] commit-id))
        n-responses (atom 0)
        current-session (atom session-state)
        python-session-state-at-send (atom (:pymods @session-state))
        start-time (System/nanoTime)
        return-path {:respond! (fn [resp]
                                 (when (= 1 (swap! n-responses inc))
                                   (dispatcher/respond!
                                     return-path
                                     (merge resp
                                            (when (and (:anvil/enable-profiling @session-state) profiling-info)
                                              {:profile (merge profiling-info
                                                               {:start-time (/ start-time 1000000.0)
                                                                :end-time   (/ (System/nanoTime) 1000000.0)}
                                                               (when-let [p (:profile resp)]
                                                                 {:children [p]}))})))))

                     :update!  (fn [update]
                                 (log/trace "Passing update:" update)
                                 (log/trace "to session:" session-state)
                                 (if-not (contains? update :update-python-session)
                                   (dispatcher/update! return-path update)
                                   (do
                                     (swap! session-state #(if (= (:pymods %) @python-session-state-at-send)
                                                             (do
                                                               (log/trace "Update OK")
                                                               (assoc % :pymods (sessions/map->UserData (:update-python-session update))))
                                                             (do
                                                               (log/trace "No match:" (:pymods %) @python-session-state-at-send)
                                                               %)))
                                     (reset! python-session-state-at-send (:update-python-session update)))))}

        call-context {::request request
                      ::accounting-info (get-accounting-info request)
                      ::current-session current-session
                      ::change-session! #(reset! current-session %)
                      ::upstream-return-path return-path}

        request-for-downlink nil #_{:id            req-id
                                    :call-stack-id req-id
                                    :func          func
                                    nil (when (or (not blended-version) (= blended-version ""))
                                      {:app (sanitise-app-for-downlink app)})}

        {:keys [args kwargs func live-object] :as _call} (:call request)

        request (-> {:call-stack       (map #(select-keys % [:type]) call-stack)
                     :client           (:client @session-state)
                     :sessionData      (or @python-session-state-at-send {})
                     :session-id       (sessions/persistent-id session-state)
                     :app-id           app-id
                     :app-info         (runtime-util/get-runtime-app-info environment)
                     :commit-id        (:commit-id environment)
                     :app-version      blended-version
                     :persist-key      (when (get-in app [:runtime_options :server_persist])
                                         (str (:env_id environment)))
                     :stale-uplink?    stale-uplink?
                     :args             args
                     :kwargs           kwargs
                     :enable-profiling (:anvil/enable-profiling @session-state)
                     :vt_global        vt_global}
                    (merge
                      (if live-object
                        {:liveObjectCall (assoc live-object :method func)}
                        {:command func})))
        ]
    {:request request, :return-path return-path, :call-context call-context}))

;; If we need to reinflate a request, but not already inside a dispatch context, you'll need one of these.
;; For example, BG task launches, calls from uplink code, etc.
;; Origin argument is only used to generate thread id.
(defn new-call-context [origin app-info environment app session-state]
  (let [current-session (atom (or session-state (sessions/new-session {})))]
    {::request              {:app-id      (:id app-info)
                             :app-info    app-info
                             :environment environment
                             :app         app
                             :thread-id (str (name origin) "-" (random/base64 18))}
     ::current-session      current-session
     ::change-session!      #(reset! current-session %)
     ::upstream-return-path nil}))

(defn retrieve-app [call-context]
  ;; cheat for now
  (:app (::request call-context)))

(defn reinflate-request [call-context {:keys [origin stack-frame-type] :as call-stack-info} deserialiser-config serialisable-request]
  (let [{:keys [call-stack environment]} (::request call-context)
        {:keys [args kwargs command liveObjectCall vt_global]} serialisable-request
        liveObjectCall (serialisation/loadLiveObject (serialisation/mk-Deserialiser deserialiser-config) liveObjectCall)]
    (-> (select-keys (::request call-context) [:app-id :app-info :app :environment])
        (assoc :call {:func        (or (:method liveObjectCall)
                                       command)
                      :args        args
                      :kwargs      kwargs
                      :live-object liveObjectCall}
               :vt_global vt_global
               :app-origin (or (:app-origin (::request call-context))
                               (app-data/get-default-app-origin environment))
               :session-state @(::current-session call-context)
               :anvil.dispatcher/change-session! (::change-session! call-context)
               :origin (keyword origin)
               :call-stack (cons {:type (keyword stack-frame-type)} {:type (keyword type)})
               :thread-id (:thread-id (::request call-context))))))


(defn dispatch-request! [call-context call-stack-info extra-request-params
                         deserialiser-config serialised-request return-path]
  (dispatcher/report-exceptions-to-return-path return-path
    (let [request (-> (reinflate-request call-context call-stack-info deserialiser-config serialised-request)
                      (merge extra-request-params))

          n-responses (atom 0)
          return-path (if-let [upstream (::upstream-return-path call-context)]
                        {:update!  #(do
                                      ;; Short circuit some updates straight to upstream, but also let downstream know.
                                      ;; (This is so Python executors don't need to waste time round-tripping these updates)
                                      (when (or (contains? % :update-python-session)
                                                (contains? % :set-cookie))
                                        (dispatcher/update! upstream %))
                                      (when-not (contains? % :set-cookie)
                                        (dispatcher/update! return-path %)))

                         :respond! #(when (= 1 (swap! n-responses inc))
                                      (dispatcher/respond! return-path %))}
                        return-path)]

      (dispatcher/dispatch! request return-path))))

#_(defn process-call-from-ws [channel deserialiser raw-data
                            {:keys [app-id app session-state environment app-origin thread-id origin call-stack use-quota?] :as req-template}
                            {:keys [extra-liveobject-key update-bypass!] :as options}]
  (let [n-responses (atom 0)
        return-path {:respond!
                     (fn [response]
                       (when (= 1 (swap! n-responses inc))
                         (serialisation/serialise-to-websocket! (assoc response :id (:id raw-data)) channel true extra-liveobject-key)))

                     :update!
                     (fn [obj]
                       (cond
                         (and (contains? obj :set-cookie) update-bypass!)
                         (update-bypass! obj)

                         :else
                         (ws/send! channel (util/write-json-str (assoc obj :id (:id raw-data))))))}

        data (serialisation/deserialise deserialiser raw-data)]

    (log/debug "Received server call:" (:command data))
    (log/trace "Raw request:" (pr-str raw-data))
    (log/trace "Deserialised request:" (pr-str raw-data))

    (dispatcher/report-exceptions-to-return-path return-path
      (dispatcher/dispatch! (assoc req-template
                              :call {:func        (or (:method (:liveObjectCall data))
                                                      (:command data))
                                     :args        (:args data)
                                     :kwargs      (:kwargs data)
                                     :live-object (serialisation/loadLiveObject deserialiser (:liveObjectCall data))
                                     :vt_global   (:vt_global data)})
                            return-path))))

#_(defn process-response-from-ws [deserialiser return-path raw-data]
  (let [data (serialisation/deserialise deserialiser raw-data)]
    (log/debug "Responding to server call")
    (log/trace "Raw response:" (pr-str raw-data))
    (log/trace "Deserialised response:" (pr-str data))
    (dispatcher/respond! return-path data)))

(defn process-update-from-ws [return-path raw-data]
  ;; N.B. We do not deserialise output for now.
  (log/debug "Update from server call")
  (log/trace "Update:" (pr-str raw-data))
  (dispatcher/update! return-path raw-data))

(def set-ws-calls-hooks! (util/hook-setter [get-accounting-info]))