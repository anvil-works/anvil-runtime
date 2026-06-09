(ns anvil.runtime.tables.v2.basic-ops-test
  (:require [clojure.test :refer :all]
            [anvil.runtime.tables.v2.basic-ops :refer :all]))

(def CAP "CAP")

(deftest test-clean-table-data-for-client
  ;; Table schemas
  (let [spec1 {:cols [{:name "a"}
                      {:name "b" :client_hidden true}
                      {:name "c"}
                      {:name "link_col" :type "link_single" :table_id "t2"}
                      {:name "d"}]
               :cache [1 0 1 1 1]}
        spec2 {:cols [{:name "x"}
                      {:name "y"}
                      {:name "z"}
                      {:name "hidden_link" :type "link_single" :client_hidden true :table_id "t3"}]
               :cache [1 1 1 1]}
        spec3 {:cols [{:name "foo"}
                      {:name "bar"}]
               :cache [1 1]}

        ;; Table data (all rows include capabilities as last element)
        t1-row1 [1 "visible" 2 "row1d" CAP]
        t1-rows {"1" t1-row1}
        t2-row2 ["x2" "y2" "z2" 3 CAP]
        t2-rows {"2" t2-row2}
        t3-row3 ["foo3" "bar3" CAP]
        t3-rows {"3" t3-row3}
        table-data {"{\"id\":\"t1\"}" {:spec spec1 :rows t1-rows}
                    "{\"id\":\"t2\"}" {:spec spec2 :rows t2-rows}
                    "{\"id\":\"t3\"}" {:spec spec3 :rows t3-rows}}

        ;; Run the cleaner from t1 row 1
        cleaned (clean-table-data-for-client table-data "t1" 1)]

    ;; t1 and t2 should be present, t3 should NOT (only reachable via client_hidden link)
    (is (contains? cleaned "{\"id\":\"t1\"}"))
    (is (contains? cleaned "{\"id\":\"t2\"}"))
    (is (not (contains? cleaned "{\"id\":\"t3\"}")))
    ;; t1 row 1's link_col should link to t2 row 2
    (is (= (get-in cleaned ["{\"id\":\"t1\"}" :rows "1" 2]) 2))
    ;; t2 row 2's hidden_link should NOT be present (column removed)
    (is (= (count (get-in cleaned ["{\"id\":\"t2\"}" :rows "2"])) 4))
    ;; Capabilities should be preserved in t1 row 1 and t2 row 2
    (is (= (last (get-in cleaned ["{\"id\":\"t1\"}" :rows "1"])) CAP))
    (is (= (last (get-in cleaned ["{\"id\":\"t2\"}" :rows "2"])) CAP))
    ;; t3's data is not included at all
    (is (nil? (get cleaned "{\"id\":\"t3\"}")))))

(deftest test-clean-table-data-client-hidden-cyclic-admin
  ;; Table 1: users (dict rows), Table 2: groups (admin client_hidden link back to users)
  (let [user-spec {:cols [{:name "name"}
                          {:name "group" :type "link_single" :table_id "groups"}]
                   :cache [1 1]}
        group-spec {:cols [{:name "group_name"}
                           {:name "admin" :type "link_single" :table_id "users" :client_hidden true}]
                    :cache [1 1]}
        ;; Users (dict rows)
        user-1 {"0" "alice" "1" 10 :c CAP} ; group 10
        user-2 {"0" "bob" "1" 20 :c CAP} ; group 20
        user-3 {"0" "carol" "1" 10 :c CAP} ; group 10
        users {"1" user-1 "2" user-2 "3" user-3}
        ;; Groups (admin is client_hidden)
        group-10 {"0" "admins" "1" 1 :c CAP} ; admin is user 1
        group-20 {"0" "users" "1" 2 :c CAP} ; admin is user 2
        groups {"10" group-10 "20" group-20}
        table-data {"{\"id\":\"users\"}" {:spec user-spec :rows users}
                    "{\"id\":\"groups\"}" {:spec group-spec :rows groups}}
        ;; Start cleaning from user 3 (carol, group 10)
        cleaned (clean-table-data-for-client table-data "users" 3)]
    ;; Only user 3 and group 10 should be present. User 1 (admin of group 10) should NOT be present (admin is client_hidden)
    (is (= (set (keys (get-in cleaned ["{\"id\":\"users\"}" :rows]))) #{"3"}))
    (is (= (set (keys (get-in cleaned ["{\"id\":\"groups\"}" :rows]))) #{"10"}))
    ;; Capabilities preserved
    (is (= (:c (get-in cleaned ["{\"id\":\"users\"}" :rows "3"])) CAP))
    (is (= (:c (get-in cleaned ["{\"id\":\"groups\"}" :rows "10"])) CAP))
    ;; Group 10 admin column should NOT be present (client_hidden)
    (is (nil? (get (get-in cleaned ["{\"id\":\"groups\"}" :rows "10"]) "1")))))

(deftest test-clean-table-data-for-client-multilink
  (let [spec1 {:cols [{:name "a"}
                      {:name "mlinks" :type "link_multiple" :table_id "t2"}
                      {:name "b"}]
               :cache [1 1 1]}
        spec2 {:cols [{:name "foo"}]
               :cache [1]}
        t1-row1 ["row1a" [2 3] "row1b" CAP]
        t1-rows {"1" t1-row1}
        t2-row2 ["foo2" CAP]
        t2-row3 ["foo3" CAP]
        t2-rows {"2" t2-row2 "3" t2-row3}
        table-data {"{\"id\":\"t1\"}" {:spec spec1 :rows t1-rows}
                    "{\"id\":\"t2\"}" {:spec spec2 :rows t2-rows}}
        cleaned (clean-table-data-for-client table-data "t1" 1)]
    ;; t2 rows 2 and 3 should be included and preserve capabilities
    (is (= (get-in cleaned ["{\"id\":\"t2\"}" :rows "2"]) ["foo2" CAP]))
    (is (= (get-in cleaned ["{\"id\":\"t2\"}" :rows "3"]) ["foo3" CAP]))))
