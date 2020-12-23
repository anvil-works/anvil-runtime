(ns anvil.runtime.app-data
  (:require [digest]
            [anvil.runtime.conf :as conf]
            [anvil.core.pg-json-handler]
            [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]
            [crypto.random :as random]
            [org.httpkit.client :as http]
            [clojure.data.json :as json])
  (:use     slingshot.slingshot)
  (:import (org.apache.commons.codec.binary Base64)))

(clj-logging-config.log4j/set-logger! :level :debug)

;; Hooks supplied by hosting code:

(defonce get-app-info-insecure (fn [id] nil))

(defonce get-app-info-with-can-depend (fn [depending-app-id app-id] (when-let [app-info (get-app-info-insecure app-id)]
                                                                      (assoc app-info :can_depend true))))

(defonce get-app-content (fn [app-info version-spec] (throw (Exception. (str "No app storage backend registered")))))

(defonce get-app-environment-by-email-hostname (fn [hostname] nil))

(defonce get-version-spec-for-environment (fn [req] nil))

(defonce get-default-app-origin (fn [environment] (throw (UnsupportedOperationException.))))

(defonce get-valid-origins (fn [environment] [(get-default-app-origin environment)]))

(defonce get-default-api-origin (fn [environment] (str (get-default-app-origin environment) "/_/api")))

(defonce get-default-hostnames (fn [environment] []))

(defonce get-shared-cookie-key (fn [app-info] "SHARED"))

(defonce abuse-caution? (fn [session-state app-id] false))

(defonce get-extra-rendering-info (fn [app-id session-state flags] nil))

(def set-app-storage-impl! (util/hook-setter #{get-app-info-insecure get-app-info-with-can-depend
                                               get-app-content get-app-environment-by-email-hostname get-version-spec-for-environment
                                               get-valid-origins  get-default-app-origin get-default-api-origin
                                               get-default-hostnames
                                               get-shared-cookie-key abuse-caution? get-extra-rendering-info}))


(defonce version-key-secret (random/base64 32))

(defn access-key-valid? [app-info access-key]
  (when-let [correct-key (:access_key app-info)]
    (= (util/sha-256 correct-key) (util/sha-256 access-key))))

(defn generate-version-key [app-id access-key version]
  (-> (util/sha-256 (str version-key-secret ";"
                         app-id ";"
                         access-key ";"
                         version ";"
                         version-key-secret))
      (.substring 0 16)))

(defn version-key-valid? [app-id  access-key version key]
  (= (util/sha-256 key) (util/sha-256 (generate-version-key app-id access-key version))))


(defn get-app-info-by-clone-key [clone-key]
  (when-let [[_ app-id clone-key] (re-matches #"(.*)=(.*)" (or clone-key ""))]
    (when-let [app-info (get-app-info-insecure app-id)]
      (when (and (:clone_key app-info)
                 (= (util/sha-256 (:clone_key app-info)) (util/sha-256 clone-key)))
        app-info))))

(defn get-app-content-with-dependencies [app-info version-spec]
  ;; Do a recursive dependency lookup on the app
  (let [app (get-app-content app-info version-spec)
        is-dev? (fn [version-spec] (or (nil? version-spec) (:dev version-spec)))]
    (loop [loaded-deps {}
           dep-order '()
           [{:keys [depending-app app_id version]} & more-deps-to-process :as deps-to-process]
           (->> (:dependencies (:content app))
                (map #(assoc % :depending-app (:id app-info))))]
      (cond
        ;; Done?
        (empty? deps-to-process)
        (-> app
          (assoc-in [:content :dependency_code] loaded-deps)
          (assoc-in [:content :dependency_order] dep-order))

        :else
        (let [dep-info (get-app-info-with-can-depend depending-app app_id)]
          (cond
            ;; App doesn't exist?
            (not dep-info)
            (recur (assoc loaded-deps app_id {:error "App dependency not found"}) dep-order more-deps-to-process)

            ;; Already loaded a different version of this app?
            (when-let [prev (get loaded-deps app_id)]
              (not= (is-dev? version) (:dev-version? prev)))
            (let [prev (get loaded-deps app_id)
                  depending (if (= depending-app (:id app-info))
                              app-info
                              (get loaded-deps depending-app))
                  prev-depending (if (= (:depending_app prev) (:id app-info))
                                   app-info
                                   (get loaded-deps (:depending_app prev)))
                  dev-or-published #(if % "Published" "Development")]
              ;;(println "Mismatch: " version " vs " (:version prev))
              (recur (assoc loaded-deps app_id
                                        {:error (str "Dependency version mismatch: This app depends on more than one version of the same dependency."
                                                     " (\"" (:name depending) "\" (" depending-app ") depends on the " (if (is-dev? version) "Development" "Published") " version of \"" (:name dep-info) "\" (" app_id "), but"
                                                     " \"" (:name prev-depending) "\" (" (:depending_app prev) ") depends on the " (if (:dev-version? prev) "Published" "Development") " version)")})
                     dep-order more-deps-to-process))

            ;; Already loaded the same version of this app?
            (or (get loaded-deps app_id) (= app_id (:id app-info)))
            (recur loaded-deps dep-order more-deps-to-process)

            ;; Not allowed to see this app?
            (not (:can_depend dep-info))
            (recur (assoc loaded-deps app_id {:error "Permission denied when loading app dependency"}) dep-order more-deps-to-process)

            ;; All good - load the app!
            :else
            (let [full-app (get-app-content dep-info (if (is-dev? version) {:branch "master"}
                                                                           {:branch "published", :fallback-branch "master"}))
                  dep-content (:content full-app)]
              ;;(println depending-app "(" (:name dep-info) ") -> " (:id dep-info) " (" (:name dep-info) ") version " version " / " version-sha "/" (:version full-app))
              (recur (assoc loaded-deps app_id
                                        (-> (select-keys dep-content [:forms :modules :server_modules :package_name :secrets :native_deps :runtime_options])
                                            (assoc :dev-version? (is-dev? version)
                                                   :commit-id (:version full-app)
                                                   :depending_app depending-app
                                                   :name (:name dep-info))))
                     (cons app_id dep-order)
                     (concat more-deps-to-process (map #(assoc % :depending-app app_id) (:dependencies dep-content)))))))))))


(defn get-app
  ([app-info version-spec] (get-app app-info version-spec true))
  ([app-info version-spec allow-broken-deps?]
   (let [app-content (get-app-content-with-dependencies app-info version-spec)]
     (when-not allow-broken-deps?
       (doseq [[app-id dep] (-> app-content :content :dependency_code)]
         (when-let [err (:error dep)]
           (throw+ {:anvil/app-dependency-error app-id :message (:error dep)}))))

     (assoc app-content
       :info app-info
       :id (:id app-info)))))

; Shims required to apply to apps with runtime version < n
(def css-shims [{:version 1
                 :description "Add padding to ColumnPanels by default."
                 :shim ".anvil-panel-section-container { padding: 0 15px; }"}])


(defn app->style [{{runtime-version :version :or {runtime-version 0}} :runtime_options
                   {:keys [assets] :as theme}                           :theme
                   :as                                                  _yaml}
                  app-id session-state flags]
  (when-let [css-b64 (->> assets
                          (filter #(= (:name %) "theme.css"))
                          (first)
                          (:content))]
    (let [css (String. (Base64/decodeBase64 ^String css-b64))
          css (reduce (fn [css {:keys [name color]}]
                        (.replace css (str "%color:" name "%") color))
                      css (get-in theme [:parameters :color_scheme :colors]))
          css (.replace css "%anvil-banner-height%"
                        (or (:banner-height (get-extra-rendering-info app-id session-state flags)) "0"))
          shims (reduce (fn [css {:keys [version description shim]}]
                          (str "/* Shim to runtime version " version ": " description " */\n"
                               shim "\n\n" css))
                        "" (reverse (sort-by :version (filter #(> (:version %) runtime-version) css-shims))))]

      {:css           css
       :css-shims     shims
       :primary-color (or (:color (first (filter #(not (.startsWith (:name %) "A")) (get-in theme [:parameters :color_scheme :colors]))))
                          "#2ab1eb")})))

(defn sanitised-app-and-style-for-client
  ([id version-spec] (sanitised-app-and-style-for-client id version-spec nil {:allow-broken-deps? true}))
  ([id version-spec app-session-state {:keys [allow-broken-deps?] :as flags}]
   (let [app-info (get-app-info-insecure id)
         app (get-app app-info version-spec allow-broken-deps?)
         yaml (:content app)
         only-version (fn [runtime-options] (merge {:version 0}
                                                   (select-keys runtime-options [:version :client_version])))]

     [app-info
      (-> (select-keys yaml [:name :package_name :forms :modules :startup :startup_form :services :theme :dependency_code :dependency_order :allow_embedding :metadata :runtime_options])
          (update-in [:runtime_options] only-version)
          (update-in [:theme] (fn [theme]
                                {:html
                                 (into {}
                                       (for [{:keys [name content]} (:assets theme)
                                             :when (.endsWith ^String name ".html")]
                                         [name (String. (Base64/decodeBase64 ^String content))]))
                                 :color_scheme
                                 (into {}
                                       (for [{:keys [name color]} (get-in theme [:parameters :color_scheme :colors])]
                                         [name color]))}))
          (update-in [:dependency_code] (fn [deps] (into {} (for [[app-id dep] deps]
                                                              [app-id (-> (select-keys dep [:modules :forms :package_name :runtime_options])
                                                                          (update-in [:runtime_options] only-version))]))))
          (update-in [:services] (fn [svcs]
                                   (map #(select-keys % [:source :client_config]) svcs))))

      (app->style yaml id app-session-state flags)
      (apply str
             (reverse
               (cons
                 (get-in yaml [:native_deps :head_html])
                 (for [dep-id (:dependency_order yaml)]
                   (get-in yaml [:dependency_code dep-id :native_deps :head_html])))))
      (:version app)])))


(defn service-is-uplink? [service]
  (when (= (:source service) "/runtime/services/uplink.yml")
    service))
