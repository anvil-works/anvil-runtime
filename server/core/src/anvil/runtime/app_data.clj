(ns anvil.runtime.app-data
  (:require [clojure.tools.logging :as log]
            [digest]
            [anvil.core.pg-json-handler]
            [anvil.util :as util]
            [clojure.data.json :as json]
            [crypto.random :as random]
            [medley.core :refer [assoc-some deep-merge map-kv-vals]]
            [clojure.string :as str])
  (:use clj-commons.slingshot)
  (:import (org.apache.commons.codec.binary Base64)))

(clj-logging-config.log4j/set-logger! :level :debug)

;; Hooks supplied by hosting code:

(defonce get-app-info-insecure (fn [id] nil))

(defonce get-app-info-with-can-depend (fn [depending-app-id app-id git-version-spec] (when-let [app-info (get-app-info-insecure app-id)]
                                                                                       (assoc app-info :can_depend true))))

(defonce get-app-content (fn [app-info version-spec] (throw (Exception. (str "No app storage backend registered")))))

(defonce get-app-environment-by-email-hostname (fn [hostname] nil))

(defonce get-version-spec-for-environment (fn [req] nil))

(defonce get-app-origin (fn [environment] (throw (UnsupportedOperationException.))))

(defonce get-public-app-origin (fn [environment] (get-app-origin environment)))

(defonce get-valid-origins (fn [environment] [(get-public-app-origin environment)]))

(defonce get-default-hostnames (fn [environment] []))

(defonce get-shared-cookie-key (fn [app-info] "SHARED"))

(defonce abuse-caution? (fn [session-state app-id] false))

(defonce should-app-be-blocked? (fn [app-id session-state environment] nil))

(defonce get-extra-rendering-info (fn [app-id session-state flags] nil))

(def set-app-storage-impl! (util/hook-setter #{get-app-info-insecure get-app-info-with-can-depend
                                               get-app-content get-app-environment-by-email-hostname get-version-spec-for-environment
                                               get-valid-origins get-app-origin get-public-app-origin
                                               get-default-hostnames
                                               get-shared-cookie-key abuse-caution?
                                               should-app-be-blocked?
                                               get-extra-rendering-info}))

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

(defn version-key-valid? [app-id access-key version key]
  (= (util/sha-256 key) (util/sha-256 (generate-version-key app-id access-key version))))

(defn get-app-info-by-clone-key [clone-key]
  (when-let [[_ app-id clone-key] (re-matches #"(.*)=(.*)" (or clone-key ""))]
    (when-let [app-info (get-app-info-insecure app-id)]
      (when (and (:clone_key app-info)
                 (= (util/sha-256 (:clone_key app-info)) (util/sha-256 clone-key)))
        app-info))))

(defn- is-branch? [{branch :branch}]
  (when (string? branch)
    branch))

(defn- is-vtag? [{vtag :version_tag}]
  (and (string? vtag)
       (re-matches #"v\d.*" vtag)
       vtag))

(defn- is-dev? [{dev :dev}] (boolean dev))
;; assumes is-vtag? has already been checked

(defn- clean-version-spec [dep-version-spec]
  (if-let [branch (is-branch? dep-version-spec)]
    {:branch branch}
    (if-let [vtag (is-vtag? dep-version-spec)]
      {:version_tag vtag}
      {:dev (is-dev? dep-version-spec)})))

(defn- report-version [dep-version-spec]
  (cond
    (is-branch? dep-version-spec) (str (:branch dep-version-spec) " branch")
    (is-vtag? dep-version-spec) (:version_tag dep-version-spec)
    (is-dev? dep-version-spec) "Development"
    :else "Published"))

(defn- version-spec->git-map [dep-version-spec]
  (cond (is-branch? dep-version-spec) {:branch (:branch dep-version-spec)}
        (is-vtag? dep-version-spec) {:ref (str "refs/tags/" (:version_tag dep-version-spec))}
        (is-dev? dep-version-spec) {:branch "master"}
        :else {:branch "published", :fallback-branch "master"}))

(defn get-all-assets [app-content]
  (apply concat (get-in app-content [:theme :assets])
         (for [id (reverse (:dependency_order app-content))]
           (->> (get-in app-content [:dependency_code id :assets])
                (map #(assoc % :dep-app-id id))))))

(defn get-asset [app-content asset-name]
  (->> (get-all-assets app-content)
       (filter #(= (:name %) asset-name))
       (first)))

;; Takes an app YAML config_schema and a list of config override maps, and returns a final config
(defn- calculate-config [schema config-overrides]
  (into {} (for [which [:client :server]
                 :let [configs (map #(get % which {}) config-overrides)
                       config (apply merge configs)
                       schema (get schema which {})]]
             [which (->> schema
                         (map-kv-vals (fn [k v]
                                        (if (contains? config k)
                                          (:value (get config k))
                                          (:default_value v)))))])))

(defn- apply-dep-config [loaded-deps overrides]
  (->> loaded-deps
       (map-kv-vals (fn [app-id {:keys [config_schema] :as dep}]
                      (-> dep
                          (assoc :config (calculate-config config_schema (get overrides app-id))))))))

;; Errors are keyed by selected app ID, which several YAML references can share.
;; Keep the reference that supplied these hints so the IDE can distinguish them
;; from hints for another reference to the same app.
(defn- broken-dependency-entry [dep-spec logical-dep-id error]
  (assoc-some {:error error :logical_dep_id logical-dep-id}
              :resolution_hints (:resolution_hints dep-spec)))

;; Right now, this merges app config with config schema as it goes. It doesn't cope with multiple dependencies on the same
;; app, and has no way to override config via environments.
;; TS types for :content: AppContentWithDeps (runtime/client/js/runner/data.ts)
;;                        IDEAppContentWithDeps (platform/editor/react/src/types/app.ts)
;; Dependency IDs in this loader:
;; - logical-dep-id: the YAML reference, under either dep_id or app_id. Even an
;;   app_id reference can be remapped without changing the YAML.
;; - resolved-app-id: the actual app selected for that reference.
;; - known-dependency-ids: root and discovered mappings, returned as dependency_ids.
;; - resolved-dependency-ids: selections already encountered in this traversal,
;;   returned as correct_dependency_ids (including failed selections).
(defn get-app-content-with-dependencies
  ([app-info version-spec]
   (get-app-content-with-dependencies app-info version-spec {}))
  ([app-info version-spec {:keys [include-extra-files?] :or {include-extra-files? false}}]
   ;; Do a recursive dependency lookup on the app
   (let [app (try+
               (get-app-content app-info version-spec)
               (catch :anvil/invalid-yaml e
                 (let [message (or (:anvil/server-error e) "This app contains invalid YAML and cannot be loaded.")]
                   ;; Also carry :anvil/invalid-yaml through, so callers that specifically care
                   ;; about "this is invalid YAML" (rather than "app failed to load" generally)
                   ;; can still catch on that key.
                   (throw+ {:anvil/app-loading-error (:id app-info)
                            :anvil/invalid-yaml true
                            :anvil/server-error message
                            :message message}))))]
     (loop [loaded-deps {}
            dependency-versions {}
            ;; Inspection relationships stay separate from executable dependency content.
            ;; Later load errors can replace dependency records without losing these edges.
            dependency-graph {}
            config-overrides {}
            dep-order '()
            known-dependency-ids (util/string-keys (:dep_ids app-info))
            resolved-dependency-ids {}
            seen-assets (into #{} (map :name (get-in app [:content :theme :assets])))
            [{:keys [depending-app-id dep_id version config] :as dep-spec} & more-deps-to-process :as deps-to-process]
            (->> (:dependencies (:content app))
                 (map #(assoc % :depending-app-id (:id app-info))))]
       (cond
         (empty? deps-to-process)
         (-> app
             (update :content assoc
                     :dependency_code (apply-dep-config loaded-deps config-overrides)
                     :dependency_order dep-order
                     :dependency_ids known-dependency-ids
                     :correct_dependency_ids resolved-dependency-ids)
             (update :content #(assoc % :config (calculate-config (:config_schema %) [])))
             (assoc :dependency-versions dependency-versions
                    :dependency_graph dependency-graph))

         :else
         (let [logical-dep-id (or dep_id (:app_id dep-spec))
               ;; Both dep_id and app_id reuse the reference's first selection, even
               ;; if loading failed. For a new reference, use a known mapping or
               ;; try the reference itself as an app ID.
               [resolved-dependency-ids known-dependency-ids]
               (if (contains? resolved-dependency-ids logical-dep-id)
                 [resolved-dependency-ids known-dependency-ids]
                 (if-let [dep-app-id (get known-dependency-ids logical-dep-id)]
                   [(assoc resolved-dependency-ids logical-dep-id dep-app-id) known-dependency-ids]
                   [(assoc resolved-dependency-ids logical-dep-id logical-dep-id) (assoc known-dependency-ids logical-dep-id logical-dep-id)]))
               resolved-app-id (get resolved-dependency-ids logical-dep-id)
               git-version-spec (version-spec->git-map version)
               dep-info (get-app-info-with-can-depend depending-app-id resolved-app-id git-version-spec)
               git-version-spec (if-let [commit-id (get-in version-spec [:dependency-commit-ids resolved-app-id])]
                                  {:commit-id commit-id}
                                  git-version-spec)
               already-loaded-dep (get loaded-deps resolved-app-id)
               ;; Keep every parent edge, including shared dependencies and version conflicts.
               ;; Omit configuration values: this metadata is only for dependency inspection.
               dependency-graph (update dependency-graph depending-app-id (fnil conj [])
                                        (cond-> (assoc (select-keys dep-spec [:version :resolution_hints])
                                                       :dep_id logical-dep-id :app_id resolved-app-id)
                                          (:can_depend dep-info)
                                          (assoc-in [:resolution_hints :name] (:name dep-info))))]
           (when-not (get dep-info :can_depend)
             (log/warn (str "Cannot depend on dependency before other checks " depending-app-id " " resolved-app-id " " git-version-spec ": " dep-info)))
           (cond
             ;; App doesn't exist? The platform hook adds :can_depend even to a nil
             ;; app lookup, so check :id. Report a missing app here; access to an
             ;; existing app is checked below.
             (not (:id dep-info))
             ;; Consumers look up dependency_code using dependency_ids. Keep the
             ;; logical reference in metadata, including when it points to a missing app.
             (recur (assoc loaded-deps resolved-app-id
                           (broken-dependency-entry dep-spec logical-dep-id
                                                    (if (:dep_id dep-spec)
                                                      "Unresolved dependency"
                                                      "App dependency not found")))
                    dependency-versions dependency-graph config-overrides dep-order known-dependency-ids resolved-dependency-ids seen-assets more-deps-to-process)

             ;; Already loaded a different version of this app?
             ;; Error entries have no :version-spec; don't replace their diagnostic
             ;; with a version mismatch.
             (and already-loaded-dep
                  (not (:error already-loaded-dep))
                  (not= (clean-version-spec version) (:version-spec already-loaded-dep)))
             (let [depending (if (= depending-app-id (:id app-info))
                               app-info
                               (get loaded-deps depending-app-id))
                   prev-depending (if (= (:depending_app already-loaded-dep) (:id app-info))
                                    app-info
                                    (get loaded-deps (:depending_app already-loaded-dep)))]
               (recur (assoc loaded-deps resolved-app-id
                             {:error (str "Dependency version mismatch: This app depends on more than one version of the same dependency."
                                          " (\"" (:name depending) "\" (" depending-app-id ") depends on the "
                                          (report-version version) " version of \"" (:name dep-info) "\" (" (when (not= logical-dep-id resolved-app-id) (str logical-dep-id "->")) resolved-app-id "), but"
                                          " \"" (:name prev-depending) "\" (" (:depending_app already-loaded-dep) ") depends on the "
                                          (report-version (:version-spec already-loaded-dep)) " version)")})
                      dependency-versions dependency-graph config-overrides dep-order known-dependency-ids resolved-dependency-ids seen-assets more-deps-to-process))

             ;; Already loaded the same version of this app?
             ;; Error entries reach this branch too because the version check skips them.
             already-loaded-dep
             (recur loaded-deps dependency-versions dependency-graph (update config-overrides resolved-app-id #(cons config %)) dep-order known-dependency-ids resolved-dependency-ids seen-assets more-deps-to-process)

             ;; Circular dependency on this main app. Don't allow config overrides in this case.
             (= resolved-app-id (:id app-info))
             (recur loaded-deps dependency-versions dependency-graph config-overrides dep-order known-dependency-ids resolved-dependency-ids seen-assets more-deps-to-process)

             ;; Not allowed to see this app?
             (not (:can_depend dep-info))
             (do
               (log/warn (str "Permission denied loading dependency: " depending-app-id " " resolved-app-id " " git-version-spec))
               (recur (assoc loaded-deps resolved-app-id (broken-dependency-entry dep-spec logical-dep-id "Permission denied")) dependency-versions dependency-graph config-overrides dep-order known-dependency-ids resolved-dependency-ids seen-assets more-deps-to-process))

             ;; All good - load the app!
             :else
             (let [{:keys [full-dep error]} (try+
                                              {:full-dep (get-app-content dep-info git-version-spec)}
                                              (catch :anvil/app-loading-error e
                                                {:error (:message e)})
                                              (catch :anvil/invalid-yaml e
                                                {:error (or (:anvil/server-error e) "Invalid YAML in dependency")})
                                              (catch Throwable e
                                                {:error (.getMessage e)})
                                              (catch Object e
                                                {:error (str e)}))]
               (if-not full-dep
                 (recur (assoc loaded-deps resolved-app-id (broken-dependency-entry dep-spec logical-dep-id error)) dependency-versions dependency-graph config-overrides dep-order known-dependency-ids resolved-dependency-ids seen-assets more-deps-to-process)
                 (let [{:keys [config_schema] :as dep-content} (:content full-dep)
                       {dep-assets false, overridden-dep-assets true} (->> (get-in dep-content [:theme :assets])
                                                                           (group-by #(and (contains? seen-assets (:name %)) (not= (:name %) "theme.css"))))]
                   ;;(println depending-app-id "(" (:name dep-info) ") -> " (:id dep-info) " (" (:name dep-info) ") version " version " / " version-sha "/" (:version full-dep))
                   (recur (assoc loaded-deps resolved-app-id
                                 (-> (select-keys dep-content
                                                  (cond-> [:forms :modules :server_modules :scripts :package_name :secrets :native_deps :runtime_options :toolbox_sections :toolbox :layouts :config_schema :client_init_module :code_prelude]
                                                    include-extra-files? (conj :extra_files)))
                                     (assoc :version-spec (clean-version-spec version)
                                            :commit-id (:version full-dep)
                                            :depending_app depending-app-id
                                            :name (:name dep-info)
                                            :assets dep-assets
                                            :overriden_assets (map :name overridden-dep-assets)
                                            :form_templates (get-in dep-content [:theme :templates])
                                            :color_scheme (get-in dep-content [:theme :parameters :color_scheme])
                                            :roles (get-in dep-content [:theme :parameters :roles]))))
                          (assoc dependency-versions resolved-app-id (:version full-dep))
                          (assoc dependency-graph resolved-app-id [])
                          (assoc config-overrides resolved-app-id (list config))
                          (cons resolved-app-id dep-order)
                          ;; Root and earlier discovered mappings win over this app's mappings.
                          (merge (util/string-keys (:dep_ids dep-info)) known-dependency-ids)
                          resolved-dependency-ids
                          (into seen-assets (map :name dep-assets))
                          (concat more-deps-to-process (map #(assoc % :depending-app-id resolved-app-id) (:dependencies dep-content))))))))))))))

(defn get-app
  ([app-info version-spec] (get-app app-info version-spec true))
  ([app-info version-spec allow-errors?]
   (let [app-content (get-app-content-with-dependencies app-info version-spec)]
     (when-not allow-errors?
       (doseq [[app-id dep] (-> app-content :content :dependency_code)]
         (when-let [err (:error dep)]
           (throw+ {:anvil/app-loading-error app-id :message (:error dep)})))
       (when (:conflicts (:content app-content))
         (throw+ {:anvil/app-loading-error (:id app-info) :message "This application has unresolved conflicts"})))

     (assoc app-content
            :info app-info
            :id (:id app-info)))))

; Shims required to apply to apps with runtime version < n
(def css-shims [{:version     1
                 :description "Add padding to ColumnPanels by default."
                 :shim        ".anvil-panel-section-container { padding: 0 15px; }"}])

(defn- make-var [name]
  (str "--anvil-color-" (str/replace name #"[^A-z0-9]" "-") "-" (random/hex 2)))

(defn- get-primary-color-name [theme-colors]
  (-> theme-colors
      first
      :name))

(defn- get-primary-color-name-from-deps [dep-colors]
  (->> (reverse dep-colors)
       (map get-primary-color-name)
       (filter identity)
       first))

(defn app->style [yaml app-id session-state flags]
  (when-let [css-assets (->> (get-all-assets yaml)
                             (filter #(and
                                        (= (:name %) "theme.css")
                                        (or (nil? (:dep-app-id %))
                                            (>= (or (get-in yaml [:dependency_code (:dep-app-id %) :runtime_options :version] 0)) 3))))
                             (reverse))]
    ;(prn "Css assets found" (count css-assets))
    ;(prn "Dep order" (:dependency_order yaml))
    (let [runtime-version (or (get-in yaml [:runtime_options :version]) 0)
          ;; Add colours from dependencies and then the app in dependency order,
          ;; so that later dependencies win and then the app wins.
          app-colors (get-in yaml [:theme :parameters :color_scheme :colors])
          dep-colors (for [dep-id (:dependency_order yaml)]
                       (get-in yaml [:dependency_code dep-id :color_scheme :colors]))
          all-colors (concat dep-colors [app-colors])
          theme-colors (reduce (fn [final-colors {:keys [name color]}]
                                 (assoc final-colors name color))
                               {}
                               (apply concat all-colors))
          primary-color (get theme-colors (get-primary-color-name-from-deps all-colors) "#2ab1eb")
          theme-var-map (into {} (for [theme-col (keys theme-colors)]
                                   [theme-col (make-var theme-col)]))
          css (apply str (map #(str "\n<style>\n" (String. (Base64/decodeBase64 ^String (:content %))) "\n</style>\n") css-assets))
          css (reduce (fn [css [name _]]
                        (.replace css (str "%color:" name "%") (str "var(" (theme-var-map name) ")")))
                      css theme-colors)
          css (.replace css "%anvil-banner-height%"
                        (or (:banner-height (get-extra-rendering-info app-id session-state flags)) "0px"))
          shims (reduce (fn [css {:keys [version description shim]}]
                          (str "/* Shim to runtime version " version ": " description " */\n"
                               shim "\n\n" css))
                        "" (reverse (sort-by :version (filter #(> (:version %) runtime-version) css-shims))))
          root-vars (reduce (fn [css [name color]]
                              (str css (theme-var-map name) ":" color ";\n"))
                            ""
                            theme-colors)
          root-vars (str ":root {\n" root-vars "}")]

      {:css           css
       :css-shims     shims
       :root-vars     root-vars
       :theme-colors  theme-colors
       :theme-vars    theme-var-map
       :primary-color primary-color})))

(defn get-from-native-deps [key yaml]
  (concat
    (for [dep-id (:dependency_order yaml)]
      (get-in yaml [:dependency_code dep-id :native_deps key] ""))
    [(get-in yaml [:native_deps key]) ""]))

(def get-all-head-html (partial get-from-native-deps :head_html))
(def get-all-import-maps (partial get-from-native-deps :import_map))

(defn read-json-safe-str [s]
  (try (json/read-str s :eof-error? false)
       ;; We could do something better here
       (catch Exception e nil)))

(defn sanitize-import-maps [import-map]
  (when (not-empty import-map)
    (str
      "<!-- Anvil merged import maps -->\n"
      "<script type=\"importmap\">\n"
      (json/write-str import-map)
      "\n</script>\n")))

(defn merge-import-maps [yaml]
  (->> yaml
       get-all-import-maps
       (map read-json-safe-str)
       (apply deep-merge)
       sanitize-import-maps))

(defn- clean-runtime-forms [forms]
  (mapv #(dissoc % :save_as_html :serialized_html) (or forms [])))

(defn- clean-runtime-dep [dep]
  (if (contains? dep :forms)
    (update dep :forms clean-runtime-forms)
    dep))

(defn- clean-runtime-app-map [app-map]
  (-> app-map
      (update :forms clean-runtime-forms)
      (update :dependency_code #(some->> % (map-kv-vals (fn [_ dep] (clean-runtime-dep dep)))))))

(defn sanitised-app-and-style-for-client
  ([id version-spec] (sanitised-app-and-style-for-client id version-spec nil {:allow-errors? true}))
  ([id version-spec app-session-state {:keys [allow-errors?] :as flags}]
   (let [app-info (get-app-info-insecure id)
         app (get-app app-info version-spec allow-errors?)
         yaml (:content app)
         only-version (fn [runtime-options] (merge {:version 0}
                                                   (select-keys runtime-options [:version :client_version :no_jquery :preview_v3 :legacy_features])))
         style (app->style yaml id app-session-state flags)]

     [app-info
      (-> (select-keys yaml [:name :package_name :forms :modules :startup :startup_form :services :theme :dependency_code :dependency_order :dependency_ids :allow_embedding :metadata :runtime_options :config :client_init_module])
          clean-runtime-app-map
          (update-in [:runtime_options] only-version)
          (update-in [:theme] (fn [theme]
                                {:html
                                 (into {}
                                       (for [{:keys [name content]} (get-all-assets yaml)
                                             :when (.endsWith ^String name ".html")]
                                         [name (String. (Base64/decodeBase64 ^String content))]))
                                 :color_scheme
                                 (:theme-colors style)}))
          (update-in [:dependency_code] (fn [deps] (into {} (for [[app-id dep] deps]
                                                              [app-id (-> (select-keys dep [:modules :forms :package_name :runtime_options :config :client_init_module])
                                                                          (update-in [:runtime_options] only-version)
                                                                          (update-in [:config] select-keys [:client]))]))))
          (update-in [:services] (fn [svcs]
                                   (map #(select-keys % [:source :client_config]) svcs)))
          (update-in [:config] select-keys [:client]))

      style
      (apply str (merge-import-maps yaml) (get-all-head-html yaml))
      (:version app)])))

(defn service-is-uplink? [service]
  (when (= (:source service) "/runtime/services/uplink.yml")
    service))

(defn get-app-content-for-any-version [app-info]
  (get-app-content app-info {:branch "master"}))
