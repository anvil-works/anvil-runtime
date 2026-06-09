(ns anvil.runtime.tables.schema-test
  (:require [clojure.test :refer :all]
            [anvil.runtime.tables.schema :refer :all]
            [clojure.pprint :refer [pprint]]))

(deftest test-schema-diff
  (let [tables {"people"    {:title   "People"
                            :server  "full"
                            :client  "none"
                            :columns [{:name     "full_name"
                                       :type     "string"
                                       :admin_ui {:width 100}}
                                      {:name     "age"
                                       :type     "string"}
                                      {:name     "to_remove"
                                       :type     "string"}]}

                "companies" {:title   "Companies"
                            :server  "full"
                            :client  "none"
                            :columns [{:name     "trading_name"
                                       :type     "string"
                                       :admin_ui {:width 100}}]}

                "users"     {:title   "Users"
                            :server  "full"
                            :client  "none"
                            :columns [{:name     "email"
                                       :type     "string"
                                       :admin_ui {:width 100}}]}

                "roles"     {:title "Roles"
                            :server "full"
                            :client "read"
                            :columns [{:name "name"
                                       :type "string"
                                       :admin_ui {:width 100}}]}

                "dummy"     {:title "Dummy"
                            :server "full"
                            :client "none"
                            :columns []}}

        src-schema (select-keys tables ["people" "companies" "roles" "dummy"])

        roles-column-to-add {:name "extra" :type "number"}
        renamed-roles-table {"permissions" (-> (get tables "roles")
                                                (assoc :title "Permissions")
                                                (update-in [:columns] conj roles-column-to-add))}

        renamed-companies-table {"companies_table" (-> (get tables "companies")
                                                       (assoc :title "Companies Table"))}
        people-column-to-add {:name "added"
                              :type "string"}
        tweaked-people-table {"people" (-> (get tables "people")
                                            (assoc :client "read")
                                            (update-in [:columns] butlast)
                                            (update-in [:columns] #(map (fn [col] (if (= (:name col) "age")
                                                                                    (assoc col :name "how_old")
                                                                                    col)) %))
                                            (update-in [:columns] conj people-column-to-add))}
        ;; Add users table
        ;; Rename companies table (identical content, not in hints)
        ;; Rename roles table (different content, will require ids)
        ;; Add column to renamed roles table
        ;; Delete dummy table
        target-schema (merge tweaked-people-table
                             (select-keys tables ["users"])
                             renamed-companies-table
                             renamed-roles-table)

        schema-hints {:people {:known_ids []
                               :columns {:age {:known_ids [42]}
                                         :how_old {:known_ids [42]}}}
                      :roles {:known_ids [1 2 3 4 5 6]}
                      :permissions {:known_ids [6 7 8 9]}}


        [rename-companies-table
         rename-roles-table
         create-tables
         delete-dummy-table
         & table-updates
         :as actions] (diff-schema src-schema target-schema schema-hints)

        table-col-updates (group-by :table table-updates)]
    (pprint actions)

    ;; Check that without schema hints the roles table is dropped and recreated as 'permissions' (col specs are different)
    (is (= [:CREATE_TABLES :DELETE_TABLE] (map :type (diff-schema (select-keys tables ["roles"])
                                                                  renamed-roles-table nil))))

    ;; Check that without schema hints the companies table is renamed to 'companies_table' (col specs are identical)
    (is (= [:UPDATE_TABLE] (map :type (diff-schema (select-keys tables ["companies"])
                                                                 renamed-companies-table nil))))

    ;; First we get table renames... [These could actually happen in reverse. We may need to make this test cleverer.]
    (is (= :UPDATE_TABLE (:type rename-companies-table)))
    (is (= :UPDATE_TABLE (:type rename-roles-table)))
    (is (= "roles" (:table rename-roles-table)))
    (is (= "permissions" (:new_python_name rename-roles-table)))
    ;; ... which include updates to renamed tables
    (is (= "read" (:client rename-roles-table)))

    ;; Then we get table creation
    (is (= :CREATE_TABLES (:type create-tables)))
    (is (= (select-keys tables ["users"]) (:tables create-tables)))

    ;; Then table deletion
    (is (= :DELETE_TABLE (:type delete-dummy-table)))
    (is (= "dummy" (:table delete-dummy-table)))

    ;; Then we get batches of updates for each table, which go update -> rename cols -> add cols -> delete cols.
    (is (= [{:type   :UPDATE_TABLE
             :table  "people"
             :client "read"}
            {:type            :RENAME_COLUMN
             :table           "people"
             :column_name     "age"
             :new_column_name "how_old"}
            {:type        :DELETE_COLUMN
             :table       "people"
             :column_name "to_remove"}
            {:type   :ADD_COLUMN,
             :table  "people",
             :column people-column-to-add}]
           (get table-col-updates "people") ))

    ;; N.B. These updates are on the 'permissions' table, which was renamed from 'roles' in an action above.
    (is (= [{:type   :ADD_COLUMN,
             :table  "permissions",
             :column roles-column-to-add}]
           (get table-col-updates "permissions")))

    ;; There should be no updates left.
    (is (empty? (dissoc table-col-updates "people" "permissions")))))

(deftest test-schema-diff-index-actions
  (let [src-schema {"people" {:title   "People"
                              :server  "full"
                              :client  "none"
                              :columns [{:name "full_name" :type "string"}
                                        {:name "age" :type "number"}]
                              :indexes [{:columns ["age"] :type "b_tree"}
                                        {:columns ["full_name"] :type "trigram"}]}}

        target-schema {"people" {:title   "People"
                                 :server  "full"
                                 :client  "none"
                                 :columns [{:name "full_name" :type "string"}
                                           {:name "how_old" :type "number"}]
                                 :indexes [{:columns ["how_old"] :type "b_tree"}
                                           {:columns ["full_name"] :type "full_text"}
                                           {:columns ["how_old" "full_name"] :type "b_tree"}]}}

        schema-hints {:people {:columns {:age {:known_ids [42]}
                                         :how_old {:known_ids [42]}}}}
        actions (diff-schema src-schema target-schema schema-hints)]
    (is (= [{:type :RENAME_COLUMN :table "people" :column_name "age" :new_column_name "how_old"}
            {:type :DELETE_INDEX
             :table "people"
             :index {:columns ["full_name"] :type "trigram"}}
            {:type :ADD_INDEX
             :table "people"
             :index {:columns ["full_name"] :type "full_text"}}
            {:type :ADD_INDEX
             :table "people"
             :index {:columns ["how_old" "full_name"] :type "b_tree"}}]
           actions))))

(deftest test-schema-diff-index-actions-rename-then-reuse-column-name
  (let [src-schema {"people" {:title   "People"
                              :server  "full"
                              :client  "none"
                              :columns [{:name "name" :type "string"}
                                        {:name "age" :type "number"}]
                              :indexes [{:columns ["age"] :type "b_tree"}]}}

        target-schema {"people" {:title   "People"
                                 :server  "full"
                                 :client  "none"
                                 :columns [{:name "name" :type "string"}
                                           {:name "how_old" :type "number"}
                                           {:name "age" :type "number"}]
                                 :indexes [{:columns ["how_old"] :type "b_tree"}
                                           {:columns ["age"] :type "b_tree"}]}}

        schema-hints {:people {:columns {:age {:known_ids [42]}
                                         :how_old {:known_ids [42]}}}}
        actions (diff-schema src-schema target-schema schema-hints)
        index-actions (filter #(contains? #{:ADD_INDEX :DELETE_INDEX} (:type %)) actions)]
    (is (= [{:type :ADD_INDEX
             :table "people"
             :index {:columns ["how_old"] :type "b_tree"}}]
           index-actions))))

(deftest test-schema-diff-client-hidden-false-does-not-replace-column
  (let [src-schema {"users" {:title   "Users"
                             :server  "full"
                             :client  "search"
                             :columns [{:name "email" :type "string"}
                                       {:name "password_hash" :type "string"}]}}

        target-schema {"users" {:title   "Users"
                                :server  "full"
                                :client  "search"
                                :columns [{:name "email" :type "string" :client_hidden false}
                                          {:name "password_hash" :type "string" :client_hidden false}]}}]
    (is (= [] (diff-schema src-schema target-schema nil)))))

(deftest test-schema-diff-client-hidden-true-updates-column
  (let [src-schema {"users" {:title   "Users"
                             :server  "full"
                             :client  "search"
                             :columns [{:name "email" :type "string"}
                                       {:name "password_hash" :type "string"}]}}

        target-schema {"users" {:title   "Users"
                                :server  "full"
                                :client  "search"
                                :columns [{:name "email" :type "string" :client_hidden false}
                                          {:name "password_hash" :type "string" :client_hidden true}]}}]
    (is (= [{:type :UPDATE_COLUMN
             :table "users"
             :column_name "password_hash"
             :changes {:client_hidden true}}]
           (diff-schema src-schema target-schema nil)))))

(deftest test-schema-diff-client-hidden-false-with-index-actions
  (let [src-schema {"people" {:title   "People"
                              :server  "full"
                              :client  "none"
                              :columns [{:name "name" :type "string"}
                                        {:name "age" :type "number"}]
                              :indexes [{:columns ["age"] :type "b_tree"}]}}

        target-schema {"people" {:title   "People"
                                 :server  "full"
                                 :client  "none"
                                 :columns [{:name "name" :type "string" :client_hidden false}
                                           {:name "age" :type "number" :client_hidden false}]
                                 :indexes [{:columns ["name"] :type "trigram"}]}}

        actions (diff-schema src-schema target-schema nil)]
    (is (= [{:type :DELETE_INDEX
             :table "people"
             :index {:columns ["age"] :type "b_tree"}}
            {:type :ADD_INDEX
             :table "people"
             :index {:columns ["name"] :type "trigram"}}]
           actions))
    (is (empty? (filter #(contains? #{:DELETE_COLUMN :ADD_COLUMN} (:type %)) actions)))))
