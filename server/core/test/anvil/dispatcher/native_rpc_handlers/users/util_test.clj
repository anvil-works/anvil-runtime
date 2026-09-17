(ns anvil.dispatcher.native-rpc-handlers.users.util-test
  (:require [anvil.dispatcher.native-rpc-handlers.users.util :as user-util]
            [anvil.runtime.tables.v2.util :as table-util]
            [clojure.test :refer :all]
            [slingshot.slingshot :refer [try+]]))

(defn- user-app [server-config]
  {:services [{:source "/runtime/services/anvil/users.yml"
               :client_config {:use_email true}
               :server_config server-config}]})

(defn- catch-server-error [f]
  (try+
    (f)
    (is false "Expected a server error")
    (catch :anvil/server-error e
      (:anvil/server-error e))))

;; Covers Users table config resolution before user handlers touch table RPC.
;; This matters because a missing user_table previously leaked nil into generic table
;; permission checks, producing a misleading PermissionDenied error.
(deftest get-user-props-validates-user-table-config
  (let [mapping {:table_mapping_id "debug"}
        tables {42 {:python_name "users"}
                84 {:python_name "accounts"}
                ::table-util/table-mapping mapping}]
    (with-redefs [table-util/get-tables (fn [m]
                                          (is (= mapping m))
                                          tables)]
      (is (= {:use_email true :user_table "users" :table_id 42}
             (user-util/get-user-props mapping (user-app {:user_table "users"}))))
      (is (= "Users service is configured with user table 'missing_users', but no table with that name was found."
             (catch-server-error
              #(user-util/get-user-props mapping (user-app {:user_table "missing_users"})))))))

  (let [called-get-tables? (atom false)]
    (with-redefs [table-util/get-tables (fn [_]
                                          (reset! called-get-tables? true)
                                          {})]
      (is (= "Users service is missing server_config.user_table. Set it to the Users table name, usually 'users'."
             (catch-server-error
              #(user-util/get-user-props {:table_mapping_id "debug"} (user-app {})))))
      (is (false? @called-get-tables?)))))
