(ns anvil.core.contact-test
  (:use clojure.test anvil.works.contact org.senatehouse.expect-call))

;; Test the new filtering system

(def DAY (* 24 3600 1000))
(def NOWISH (System/currentTimeMillis))

(def DRIP-ENABLE {:verified true, :preferences {:mailing-list {:drip-enabled true}}})

(def f)
(def f2)

(deftest test-get-next-email
  (testing "Simple priority"
    (is (= "foo" (:name (get-next-email DRIP-ENABLE [{:name "foo"} {:name "bar"}]))))

    (is (= "foo" (:name (get-next-email DRIP-ENABLE [{:name "foo" :priority 101} {:name "bar"}]))))

    (is (= "bar" (:name (get-next-email DRIP-ENABLE [{:name "foo" :priority 99} {:name "bar"}])))))

  (testing "Opt-outs honoured"
    (is (nil? (get-next-email {} [{:name "foo"}]))))


  (testing "Don't resend"
    (let [user {:verified true, :preferences {:mailing-list {:drip-enabled true, :sent {:foo NOWISH}}}}]

      (is (= "bar" (:name (get-next-email
                            user
                            [{:name "foo"} {:name "bar"}]))))

      (is (= "foo" (:name (get-next-email
                            user
                            [{:name "foo" :resendable true} {:name "bar"}]))))))

  (testing "Honour send_interval"
    (let [user {:verified true, :preferences {:mailing-list {:last-email (- (System/currentTimeMillis) DAY)
                                             :drip-enabled true}}}]

      (is (nil? (get-next-email user [{:name "foo"}])))
      (is (= "foo" (:name (get-next-email user [{:name "foo" :send_interval 1}]))))))

  (testing "Tag conditions"
    (let [user (assoc-in DRIP-ENABLE [:preferences :tags :tig] 42)]
      ;; ~tig is not a sensible tag name; it's just to demonstrate that ~tig is negation

      (testing "Inclusion"
        (is (= "foo" (:name (get-next-email user [{:name "foo", :if ["tig"]}]))))

        (is (nil? (get-next-email user [{:name "foo", :if ["tog"]}]))))

      (testing "Exclusion"
        (is (nil? (get-next-email user [{:name "foo", :if ["~tig"]}])))

        (is (= "foo" (:name (get-next-email DRIP-ENABLE [{:name "foo", :if ["~tig"]}])))))

      (testing "Comparison"
        (is (= "foo" (:name (get-next-email user [{:name "foo", :if ["tig=42"]}]))))
        (is (nil? (get-next-email user [{:name "foo", :if ["tig=43"]}])))
        (is (= "foo" (:name (get-next-email user [{:name "foo", :if ["tig!=43"]}]))))
        (is (nil? (get-next-email user [{:name "foo", :if ["tig!=42"]}])))

        (is (= "foo" (:name (get-next-email user [{:name "foo", :if ["tig<100"]}]))))
        (is (nil? (get-next-email user [{:name "foo", :if ["tig>100"]}])))

        (is (= "foo" (:name (get-next-email user [{:name "foo", :if ["tig>10"]}]))))
        (is (nil? (get-next-email user [{:name "foo", :if ["tig<10"]}])))))

    (testing "Queries get called"
      (let [user (merge DRIP-ENABLE {:xxx 123})]
        (expect-call [(f [{:xxx 123}] 42) (f [{:xxx 123}] 42)]
                     (is (= "foo" (:name (get-next-email user [{:name "foo", :if ["q/foo=42"]}]
                                                         {"foo" f})))))

        (expect-call [(f [{:xxx 123}] nil)]
                     (is (nil? (get-next-email user [{:name "foo", :if ["q/foo"]}]
                                               {"foo" f}))))))

    (testing "Expensive queries get called last"
      (let [user (merge DRIP-ENABLE {:xxx 123})]

        (expect-call [(f [{:xxx 123}] 42)
                      (:more f [_] 42)
                      (f2 [{:xxx 123}] true)]

          (is (= "foo" (:name (get-next-email user [{:name "foo", :if ["q/bar", "q/foo=42"]}]
                                              {"foo" f} {"bar" f2})))))

        (expect-call [(f [{:xxx 123}] 42)
                      (:never f2)]

          (is (nil? (get-next-email user [{:name "foo", :if ["q/bar", "~q/foo"]}]
                                    {"foo" f} {"bar" f2}))))))))
