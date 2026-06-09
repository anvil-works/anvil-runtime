(ns anvil.runtime.tables.v2.util-test
  (:require [clojure.test :refer :all]
            [anvil.runtime.tables.util :as table-util]
            [anvil.runtime.tables.v2.util :as util-v2]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]))

(deftest get-tables-uses-admin-environment-when-rpc-environment-missing
  (let [seen-environment (atom ::unset)
        marker {:from-cache true}]
    (util-v2/clear-global-schema-cache-test-only!)
    (with-redefs [table-util/table-mapping-for-environment (fn [environment]
                                                             (reset! seen-environment environment)
                                                             {:app_id "app-from-mapping"})
                  table-util/db (fn [] :fake-db)
                  anvil.runtime.tables.v2.util/do-get-tables (fn [_db _mapping] marker)]
      (binding [rpc-util/*environment* nil
                table-util/*environment-for-admin-call* {:app_id "app-from-admin-route"}]
        (is (= marker (util-v2/get-tables)))
        (is (= {:app_id "app-from-admin-route"} @seen-environment))))
    (util-v2/clear-global-schema-cache-test-only!)))
