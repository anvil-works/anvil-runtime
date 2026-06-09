(ns anvil.dispatcher.native-rpc-handlers.users.util-test
  (:require [anvil.dispatcher.native-rpc-handlers.users.util :as users-util]
            [anvil.runtime.tables.util :as tables-util]
            [clojure.test :refer :all]))

;; Covers DB selection for explicit table mappings so user lookups hit the mapped database.
;; This matters because a wrong DB handle breaks named user table resolution, and it's better
;; covered in Clojure because Python tests can't observe this internal helper arity or which DB it picks.
(deftest get-props-with-named-user-table-uses-db-for-mapping
  (let [explicit-mapping {:table_mapping_id "explicit"}
        mapping-db ::mapping-db
        ambient-db ::ambient-db
        used-db (atom nil)]
    (with-redefs [tables-util/db (constantly ambient-db)
                  tables-util/db-for-mapping (fn [m] (when (= m explicit-mapping) mapping-db))
                  tables-util/get-table-id-by-name (fn [db-c _mapping _python-name]
                                                     (reset! used-db db-c)
                                                     42)
                  users-util/get-props (fn [_app] {:user_table "users"})]
      (let [result (users-util/get-props-with-named-user-table explicit-mapping :some-app)]
        (is (= mapping-db @used-db)
            "2-arity should resolve DB via db-for-mapping, not the ambient db")
        (is (= 42 (:user_table result)))))))
