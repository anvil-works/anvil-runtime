(ns anvil.runtime.tables.manager-test
  (:require [clojure.test :refer :all]
            [clojure.java.jdbc :as jdbc]
            [anvil.util :as util]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.runtime.tables.manager :as manager]
            [anvil.runtime.tables.schema :as schema]
            [anvil.runtime.tables.split.manager :as split-manager]
            [anvil.runtime.tables.util :as tables-util]))

(def ^:private failing-table-id 666)

(defmacro with-fake-split-index-updates
  "Run body with an in-memory store of table records (`saved-tables`, keyed by table ID) in place of the database.
  Worker tasks are captured in `tasks` instead of running. Each table record passed to update-indexes! is recorded
  in `updated`. Updating the indexes of `failing-table-id` throws."
  [[saved-tables tasks updated] & body]
  `(let [~saved-tables (atom {})
         ~tasks (atom [])
         ~updated (atom [])]
     (with-redefs [worker-pool/run-task!* (fn [f# _tags#] (swap! ~tasks conj f#))
                   util/-with-db-transaction (fn [db# _isolation# f#] (f# db#))
                   tables-util/db (constantly nil)
                   tables-util/db-for-current-app (constantly {:anvil/pool-info {:allow-admin-actions? true}})
                   tables-util/load-table-record (fn [_db# table-id#] (tables-util/normalise-indexes (get @~saved-tables table-id#)))
                   tables-util/save-table-record! (fn [_db# table-record#] (swap! ~saved-tables assoc (:id table-record#) table-record#))
                   tables-util/get-cols (fn [table-id#] (:columns (get @~saved-tables table-id#)))
                   tables-util/update-table-views! (fn [& _#])
                   split-manager/do-add-column! (fn [_db# table-record# _col-id#] table-record#)
                   split-manager/update-indexes! (fn [_db# table-record#]
                                                   (when (= failing-table-id (:id table-record#))
                                                     (throw (Exception. "Index build failed")))
                                                   (swap! ~updated conj table-record#))]
       (binding [tables-util/*environment-for-admin-call* {:app_id "test-app"}]
         ~@body))))

(defn- save-split-table! [saved-tables table-id]
  (swap! saved-tables assoc table-id {:id table-id :storage {:split true} :columns {}})
  (get @saved-tables table-id))

(defn- run-tasks! [tasks]
  (doseq [task @tasks] (task)))

(deftest schema-deletion-removes-all-stale-indexes-represented-by-a-row
  (with-fake-split-index-updates [saved-tables tasks updated]
    (let [columns {:a-id {:name "a" :type "string"}}
          single-1 {:type "b_tree" :columns ["missing-1"]}
          single-2 {:type "b_tree" :columns ["missing-2"]}
          composite-1 {:type "b_tree" :columns ["missing-1" "a-id"]}
          composite-2 {:type "b_tree" :columns ["missing-2" "a-id"]}
          valid-index {:type "b_tree" :columns ["a-id"]}
          other-type {:type "trigram" :columns ["missing-1"]}
          delete-row!
          (fn [index]
            (schema/apply-changes!
              {}
              [{:python_name "things" :id 1}]
              [{:type "DELETE_INDEX" :table "things" :index index}]
              {:allow-index? (constantly true)}))]
      (swap! saved-tables assoc 1
             {:id 1
              :storage {:split true}
              :columns columns
              :indexes [single-1 single-2
                        composite-1 composite-2
                        valid-index other-type]})

      ;; Both missing single-column indexes share the [nil] lookup row.
      (delete-row! {:type "b_tree" :columns [nil]})
      (is (= #{composite-1 composite-2 valid-index other-type}
             (set (:indexes (get @saved-tables 1)))))

      ;; The composite row is distinct, and removes both of its matches.
      (delete-row! {:type "b_tree" :columns [nil "a"]})
      (is (= #{valid-index other-type}
             (set (:indexes (get @saved-tables 1)))))

      ;; Index type is part of the match.
      (delete-row! {:type "trigram" :columns [nil]})
      (is (= [valid-index] (:indexes (get @saved-tables 1))))
      (is (= columns (:columns (get @saved-tables 1)))
          "Deleting stale indexes must not recreate missing columns")

      ;; Repeating an already completed deletion preserves valid indexes.
      (delete-row! {:type "b_tree" :columns [nil]})
      (is (= [valid-index] (:indexes (get @saved-tables 1)))))

    (run-tasks! tasks)
    (is (seq @updated))
    (is (every? #(= [{:type "b_tree" :columns ["a-id"]}]
                    (:all_indexes %))
                @updated)
        "Background updates reload the cleaned metadata")))

(deftest schema-deletion-removes-a-valid-index-without-removing-its-column
  (with-fake-split-index-updates [saved-tables tasks updated]
    (let [columns {:a-id {:name "a" :type "string"}}
          lookup-index {:type "b_tree" :columns ["a-id"]}
          text-index {:type "trigram" :columns ["a-id"]}]
      (swap! saved-tables assoc 1
             {:id 1
              :storage {:split true}
              :columns columns
              :indexes [lookup-index text-index]})

      (schema/apply-changes!
        {}
        [{:python_name "things" :id 1}]
        [{:type "DELETE_INDEX"
          :table "things"
          :index {:type "b_tree" :columns ["a"]}}]
        {:allow-index? (constantly true)})

      (is (= {:a-id {:name "a" :type "string" :indexes []}}
             (:columns (get @saved-tables 1))))
      (is (= [text-index] (:indexes (get @saved-tables 1)))))))

(deftest deleting-a-column-removes-its-single-and-multi-column-indexes
  (with-fake-split-index-updates [saved-tables tasks updated]
    (let [index-a {:type "b_tree" :columns ["a-id"]}
          index-b {:type "b_tree" :columns ["b-id"]}
          index-ab {:type "b_tree" :columns ["a-id" "b-id"]}]
      (swap! saved-tables assoc 1
             {:id 1
              :storage {:split true}
              :columns {:a-id {:name "a" :type "string"}
                        :b-id {:name "b" :type "string"}}
              :indexes [index-a index-b index-ab]})
      ;; Test metadata cleanup without performing PostgreSQL column removal.
      (with-redefs [split-manager/do-remove-column! (fn [& _])]
        (manager/table-delete-column! nil 1 :a-id))
      (is (= {:b-id {:name "b" :type "string"}}
             (:columns (get @saved-tables 1))))
      (is (= [index-b] (:indexes (get @saved-tables 1))))
      (is (= [index-b] (:all_indexes (get @saved-tables 1)))))))

(deftest deleting-a-unified-table-column-removes-its-nested-indexes
  (with-fake-split-index-updates [saved-tables tasks updated]
    (let [column-b {:name "b" :type "string" :indexes [{:type "b_tree"}]}]
      (swap! saved-tables assoc 1
             {:id 1 :storage {:split false}
              :columns {:a {:name "a" :type "string" :indexes [{:type "b_tree"}]}
                        :b column-b}})
      (manager/table-delete-column! nil 1 :a)
      (is (= {:b column-b} (:columns (get @saved-tables 1))))
      (is (= [{:type "b_tree" :columns ["b"]}] (:all_indexes (get @saved-tables 1)))))))

(deftest deleting-a-stale-index-does-not-recreate-its-missing-column
  (with-fake-split-index-updates [saved-tables tasks updated]
    (let [stale-index {:type "b_tree" :columns ["missing"]}
          valid-index {:type "b_tree" :columns ["b"]}
          columns {:b {:name "b" :type "string"}}
          table {:id 1 :storage {:split true} :columns columns :indexes [stale-index valid-index]}]
      (manager/table-delete-index! nil table stale-index)
      (is (= columns (:columns (get @saved-tables 1))))
      (is (= [valid-index] (:indexes (get @saved-tables 1))))
      (is (= [valid-index] (:all_indexes (tables-util/load-table-record nil 1)))))))

(deftest deleting-a-column-index-preserves-the-existing-column
  (with-fake-split-index-updates [saved-tables tasks updated]
    (let [index {:type "b_tree" :columns ["a"]}
          table {:id 1 :storage {:split false}
                 :columns {:a {:name "a" :type "string"
                               :indexes [{:type "b_tree"} {:type "trigram"}]}}}]
      ;; Unified index DDL is outside this metadata regression test.
      (with-redefs [manager/update-col-indexes! (fn [& _])]
        (manager/table-delete-index! nil table index))
      (is (= {:a {:name "a" :type "string" :indexes [{:type "trigram"}]}}
             (:columns (get @saved-tables 1)))))))

(deftest migration-builds-split-table-indexes-in-one-task
  (with-fake-split-index-updates [saved-tables tasks updated]
    (save-split-table! saved-tables 1)
    (save-split-table! saved-tables 2)
    (schema/apply-changes! {}
                           [{:python_name "people" :id 1} {:python_name "places" :id 2}]
                           [{:type "ADD_COLUMN" :table "people" :column {:name "name" :type "string"}}
                            {:type "ADD_COLUMN" :table "people" :column {:name "age" :type "number"}}
                            {:type "ADD_INDEX" :table "people" :index {:type "b_tree" :columns ["name"]}}
                            {:type "ADD_INDEX" :table "people" :index {:type "b_tree" :columns ["age"]}}
                            {:type "ADD_COLUMN" :table "places" :column {:name "city" :type "string"}}
                            {:type "ADD_INDEX" :table "places" :index {:type "trigram" :columns ["city"]}}]
                           {:allow-index? (constantly true)})

    (is (= 1 (count @tasks)))
    (run-tasks! tasks)
    (is (= [1 2] (map :id @updated)) "Each table is updated once")
    (is (= [2 1] (map (comp count :all_indexes) @updated)) "Each update sees all of the migration's indexes")))

(deftest batched-split-index-updates-use-the-saved-table-record
  (with-fake-split-index-updates [saved-tables tasks updated]
    (let [stale-record (save-split-table! saved-tables 1)]
      (manager/with-split-table-index-updates-batched nil
        (manager/update-col-indexes! nil stale-record)
        (swap! saved-tables assoc-in [1 :indexes] [{:type "b_tree" :columns ["name"]}])
        (manager/update-col-indexes! nil stale-record)
        (is (empty? @tasks) "No task starts before the batch ends"))

      (is (= 1 (count @tasks)))
      (run-tasks! tasks)
      (is (= [[{:type "b_tree" :columns ["name"]}]] (map :all_indexes @updated))))))

(deftest unbatched-split-index-update-starts-its-own-task
  (with-fake-split-index-updates [saved-tables tasks updated]
    (manager/update-col-indexes! nil (save-split-table! saved-tables 1))
    (manager/update-col-indexes! nil (save-split-table! saved-tables 2))
    (is (= 2 (count @tasks)))
    (run-tasks! tasks)
    (is (= [1 2] (map :id @updated)))))

(deftest batched-split-index-updates-wait-for-commit
  (with-fake-split-index-updates [saved-tables tasks updated]
    (let [txn-state (atom {:on-commit nil})
          db-in-transaction {:anvil-txn-state txn-state}]
      (manager/with-split-table-index-updates-batched db-in-transaction
        (manager/update-col-indexes! db-in-transaction (save-split-table! saved-tables 1)))
      (is (empty? @tasks) "No task starts before the transaction commits")

      ;; Commit, as anvil.util/-with-db-transaction does.
      (doseq [f (:on-commit @txn-state)] (f))
      (is (= 1 (count @tasks)))
      (run-tasks! tasks)
      (is (= [1] (map :id @updated))))))

(deftest batched-split-index-updates-start-after-a-failed-change
  ;; Outside a transaction, changes before the failure have already committed, so their indexes still need building.
  (with-fake-split-index-updates [saved-tables tasks updated]
    (is (thrown-with-msg? Exception #"Bad change"
          (manager/with-split-table-index-updates-batched nil
            (manager/update-col-indexes! nil (save-split-table! saved-tables 1))
            (throw (Exception. "Bad change")))))
    (is (= 1 (count @tasks)))
    (run-tasks! tasks)
    (is (= [1] (map :id @updated)))))

(deftest failed-split-index-update-does-not-stop-the-rest-of-the-batch
  (with-fake-split-index-updates [saved-tables tasks updated]
    (manager/with-split-table-index-updates-batched nil
      (doseq [table-id [1 failing-table-id 2]]
        (manager/update-col-indexes! nil (save-split-table! saved-tables table-id))))
    (run-tasks! tasks)
    (is (= [1 2] (map :id @updated)))))

(deftest invalid-split-table-indexes-are-rebuilt-unless-still-building
  (let [table-record {:id          42
                      :all_indexes [{:type "b_tree" :columns ["valid"]}
                                    {:type "b_tree" :columns ["failed"]}
                                    {:type "b_tree" :columns ["building"]}
                                    {:type "b_tree" :columns ["missing"]}]}
        index (fn [col-name valid? maybe-being-built?]
                {:indexname    (str "data_tables.table_42_midx_b_tree_" col-name)
                 :indisvalid   valid?
                 :maybe_being_built maybe-being-built?})
        existing-indexes [(index "valid" true false)
                          (index "failed" false false)
                          (index "building" false true)
                          (index "unwanted" true false)
                          (index "unwanted_failed" false false)
                          (index "unwanted_building" false true)
                          {:indexname "data_tables.table_42_pkey" :indisvalid true :maybe_being_built false}]]
    (with-redefs [jdbc/query (constantly existing-indexes)]
      (let [{:keys [TO-REMOVE to-create]} (#'split-manager/get-index-changes-needed :fake-db table-record)]
        (is (= #{"data_tables.table_42_midx_b_tree_failed"
                 "data_tables.table_42_midx_b_tree_unwanted"
                 "data_tables.table_42_midx_b_tree_unwanted_failed"
                 "data_tables.table_42_midx_b_tree_unwanted_building"}
               TO-REMOVE))
        (is (= ["table_42_midx_b_tree_failed" "table_42_midx_b_tree_missing"]
               (map :SQL-NAME to-create)))))))
