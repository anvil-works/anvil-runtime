(ns anvil.dispatcher.native-rpc-handlers.stripe
  (:use [slingshot.slingshot])
  (:require [anvil.runtime.conf :as conf]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.types :as types]
            [anvil.util :as util]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util])
  (:import (com.stripe.model Charge Customer Subscription Card HasId)
           (com.stripe.net RequestOptions)
           (java.util Map HashMap)
           (com.stripe.exception StripeException)
           (com.google.gson Gson)))

(defmacro with-transform-stripe-err [& body]
  `(try
     (do ~@body)
     (catch StripeException e#
       (throw+ {:anvil/server-error (.getMessage e#) :type (str (type e#))}))))

(defn- wrap-native-fn [f]
  (rpc-util/wrap-native-fn #(with-transform-stripe-err
                              (apply f %&))))

(defn- add-stripe-error-transformation-to-live-object-backend [method-map]
  (into {}
        (for [[name f] method-map]
          [name #(with-transform-stripe-err (apply f %&))])))

(defn- wrap-live-object-backend [method-map]
  (rpc-util/wrap-live-object-backend (add-stripe-error-transformation-to-live-object-backend method-map)))

(defn get-stripe-service-props []
  (first (filter #(= (:source %) "/runtime/services/stripe.yml") (:services rpc-util/*app*))))

(defn- get-request-options []
  (let [service-config (get-stripe-service-props)

        live-mode? (get-in service-config [:client_config :live_mode])

        stripe-user-id (get-in service-config [:server_config :stripe_user_id])]
    (if (nil? stripe-user-id)
      (throw+ {:anvil/server-error "To use the Stripe API, you need to connect your own stripe account"
               :docId              "stripe"
               :docLinkTitle       "Learn more about Stripe Integration"})
      (let [request-options (-> (RequestOptions/builder)
                                (.setStripeAccount stripe-user-id)
                                (.setApiKey (if live-mode?
                                              (:live-secret-key conf/stripe-client-config)
                                              (:test-secret-key conf/stripe-client-config)))
                                (.build))]
        [request-options live-mode? stripe-user-id]))))

(defn charge [_kwargs token amount currency]

  (let [amount (cond
                 (not (number? amount)) (throw+ {:anvil/server-error "Stripe amount must be a number"})
                 (integer? amount) amount
                 :else (Math/round (double amount)))
        [request-options live-mode? _stripe-user-id] (get-request-options)
        charge (worker-pool/with-expanding-threadpool-when-slow
                 (Charge/create ^Map (merge {"amount"   amount
                                             "currency" currency
                                             "source"   token})
                                ^RequestOptions request-options))]
    (when live-mode?
      (log/info "STRIPE PAY:" (float (/ amount 100)) currency "(Token:" token ")"))

    {"result"    (.getStatus charge)
     "charge_id" (.getId charge)
     "source"    (let [s ^Card (.getSource charge)]
                   {"exp_month" (.getExpMonth s)
                    "exp_year"  (.getExpYear s)
                    "last4"     (.getLast4 s)
                    "address"   {"line_1"    (.getAddressLine1 s)
                                 "line_2"    (.getAddressLine2 s)
                                 "zip"       (.getAddressZip s)
                                 "city"      (.getAddressCity s)
                                 "country"   (.getAddressCountry s)
                                 "zip_check" (.getAddressZipCheck s)}
                    "cvc_check" (.getCvcCheck s)})
     "url"       (str "https://dashboard.stripe.com/" (if live-mode? "" "test/") "payments/" (.getId charge))}))

(defn subscribe [_kwargs token email plan quantity]
  (let [[^RequestOptions request-options live-mode? stripe-user-id] (get-request-options)]
    (try+
      (let [customer (Customer/create {"email"  email
                                       "source" token}
                                      request-options)

            subscription (try
                           (worker-pool/with-expanding-threadpool-when-slow
                             (Subscription/create ^Map (merge {"items"    [{"plan"     plan
                                                                            "quantity" quantity}]
                                                               "customer" (.getId customer)})
                                                  ^RequestOptions request-options))
                           (catch Exception e
                             (.delete customer request-options)
                             (throw e)))]

        (when live-mode?
          (log/info "STRIPE SUBSCRIBE PLAN:" plan "(Token:" token ")"))

        {"result"          (.getStatus subscription)
         "subscription_id" (.getId subscription)
         "source"          (let [s ^Card (first (.getData (.getSources ^Customer customer)))]
                             {"exp_month" (.getExpMonth s)
                              "exp_year"  (.getExpYear s)
                              "last4"     (.getLast4 s)
                              "address"   {"line_1"    (.getAddressLine1 s)
                                           "line_2"    (.getAddressLine2 s)
                                           "zip"       (.getAddressZip s)
                                           "city"      (.getAddressCity s)
                                           "country"   (.getAddressCountry s)
                                           "zip_check" (.getAddressZipCheck s)}
                              "cvc_check" (.getCvcCheck s)})
         "url"             (str "https://dashboard.stripe.com/" (if live-mode? "" "test/") "subscriptions/" (.getId subscription))})

      (catch Throwable e
        (throw+ {:anvil/server-error (.getMessage e)
                 :docId "stripe_service"
                 :docLinkTitle "Learn more about the Stripe service"}))
      (catch Object e
        (throw+ {:anvil/server-error (str e)
                 :docId "stripe_service"
                 :docLinkTitle "Learn more about the Stripe service"})))))


(defmacro retrieve [cls id]
  `(let [[request-options#] (get-request-options)]
     (~(symbol (pr-str cls) "retrieve") ^String ~id ^RequestOptions request-options#)))


(defmacro getitem-for [cls]
  `(fn [[id#] _kwargs# item-name#]
     (let [walk# (fn walk# [m#] (into {} (for [[k# v#] m#]
                                    [k# (if (instance? Map v#) (walk# v#) v#)])))
           obj-from-deprecated-raw-json# (walk# (.fromJson (Gson.) ^String (.toJson (retrieve ~cls id#)) ^Class (.getClass (HashMap.))))] ; Ew, ew, EW. No.
       (if (contains? obj-from-deprecated-raw-json# item-name#)
         (get obj-from-deprecated-raw-json# item-name#)
         (throw+ {:type "KeyError" :anvil/server-error (str "No such Stripe attribute '" item-name# "'")})))))

;; N.B. entries in cache-keys must have primitive values, or everything will explode.
(defn liveobject-for [backend method-map cache-keys ^HasId o]
  (types/mk-LiveObjectProxy backend (util/write-json-str [(.getId o)]) [] (keys method-map)
                            (when cache-keys
                              (let [obj (bean o)]
                                (into {} (for [k cache-keys]
                                           [k (get obj k)]))))))


(def ChargeLO {"__getitem__" (getitem-for Charge)})
(def mk-Charge (partial liveobject-for "anvil.stripe.Charge" ChargeLO [:id]))

(def mk-Subscription)

(defn sub-is-live? [^Subscription sub]
  (boolean (#{"trialling" "active" "past_due"} (.getStatus sub))))

(defn get-subs-for-customer [^String id live-only?]
  (worker-pool/with-expanding-threadpool-when-slow
    (let [request-options ^RequestOptions (first (get-request-options))
          customer (Customer/retrieve id {"expand" ["subscriptions"]} request-options)]
      (->> (-> customer
               (.getSubscriptions)
               (.autoPagingIterable {} request-options))
           (filter #(or (not live-only?)
                        (sub-is-live? %)))))))

(defn first-bool [& s]
  (first (filter #(contains? #{true false} %) s)))

(def CustomerLO {"__getitem__"          (getitem-for Customer)

                 "get_subscriptions"    (rpc-util/py-method get_subscriptions [[id] ^{:default true} live_only]
                                          (map mk-Subscription
                                               (get-subs-for-customer id live_only)))

                 "get_subscription_ids" (rpc-util/py-method get_subscription_ids [[id] ^{:default true} live_only]
                                          (let [subs (get-subs-for-customer id live_only)
                                                sub-items (apply concat (for [sub subs] (.getData (.getItems sub))))]
                                            (for [item sub-items]
                                              (-> item .getPlan .getId))))

                 "new_subscription"     (rpc-util/py-method new_subscription [[id] plan_id ^{:default 1} quantity]
                                          (rpc-util/require-server!)
                                          (let [[request-options _live-mode? _stripe-user-id] (get-request-options)
                                                sub (Subscription/create ^Map (merge {"items"    [{"plan"     plan_id
                                                                                                   "quantity" quantity}]
                                                                                      "customer" id})
                                                                         ^RequestOptions request-options)]
                                            (mk-Subscription sub)))

                 "add_token"            (rpc-util/py-method add_token [[id] token]
                                          (rpc-util/require-server!)
                                          (let [[^RequestOptions request-options] (get-request-options)
                                                customer (Customer/retrieve ^String id {"expand" ["sources"]} request-options)]
                                            (.create (.getSources customer) {"source" token} request-options)
                                            nil))

                 "charge"               (rpc-util/py-method charge [[id] ^double amount currency]
                                          (rpc-util/require-server!)
                                          (let [[^RequestOptions request-options _ stripe-user-id] (get-request-options)
                                                amount (Math/round amount)]
                                            (try (-> (Charge/create ^Map (merge {"amount"   amount
                                                                                 "currency" currency
                                                                                 "customer" id})
                                                                    request-options)
                                                     (mk-Charge))
                                                 (catch StripeException e
                                                   (throw+ {:anvil/server-error (.getMessage e)})))))})

(def mk-Customer (partial liveobject-for "anvil.stripe.Customer" CustomerLO [:id :email :delinquent :livemode]))

(def SubscriptionLO {"__getitem__" (getitem-for Subscription)
                     "is_live"     (rpc-util/py-method is_live [[id]]
                                     (sub-is-live? (retrieve Subscription id)))
                     "cancel"      (rpc-util/py-method cancel [[id] ^{:default true} at_period_end]
                                     (rpc-util/require-server!)
                                     (let [[^RequestOptions request-options] (get-request-options)]
                                       (if at_period_end
                                         (.update (Subscription/retrieve ^String id request-options) {"cancel_at_period_end" true} request-options)
                                         (.cancel (Subscription/retrieve ^String id request-options) ^Map {} ^RequestOptions request-options))
                                       nil))
                     "set_plan"    (rpc-util/py-method set_plan [[id] plan_id]
                                     (rpc-util/require-server!)
                                     (let [[^RequestOptions request-options] (get-request-options)
                                           s ^Subscription (Subscription/retrieve ^String id request-options)]
                                       (.update s {"items" (cons {"plan" plan_id}
                                                                 (map (fn [item] {"id"      (.getId item)
                                                                                  "deleted" true})
                                                                      (.getData (.getItems s))))} request-options)

                                       nil))})

(def mk-Subscription (partial liveobject-for "anvil.stripe.Subscription" SubscriptionLO [:id :status]))

(defn get-customer [_kwargs id]
  (rpc-util/require-server!)
  (let [[request-options] (get-request-options)]
    (mk-Customer (Customer/retrieve ^String id, {"expand" ["subscriptions"]} ^RequestOptions request-options))))

(defn new-customer [_kwargs email token]
  (rpc-util/require-server!)
  (worker-pool/with-expanding-threadpool-when-slow
    (let [[^RequestOptions request-options] (get-request-options)
          customer (Customer/create ^Map (merge {"email" email}
                                                (when token {"source" token}))
                                    request-options)]
      (mk-Customer customer))))

(def handlers {"anvil.private.stripe.charge" (wrap-native-fn charge)
               "anvil.private.stripe.subscribe" (wrap-native-fn subscribe)
               "anvil.private.stripe.get_customer" (wrap-native-fn get-customer)
               "anvil.private.stripe.new_customer" (wrap-native-fn new-customer)})
(swap! dispatcher/native-rpc-handlers merge handlers)

(def live-object-backends {"anvil.stripe.Customer"     (wrap-live-object-backend CustomerLO)
                           "anvil.stripe.Charge"       (wrap-live-object-backend ChargeLO)
                           "anvil.stripe.Subscription" (wrap-live-object-backend SubscriptionLO)})
(swap! dispatcher/native-live-object-backends merge live-object-backends)

#_(comment
    TODO
    * Subscription LiveObject permitting cancellation & changing quantity
    * Some way to test subscription liveness
    * get_subscriptions() working
    * Subscribe () should return customer
    * Customer should allow new subscription
    * Customer should allow new token
    * Return LiveObjects from existing Stripe stuff eg charge () ?
    * Link to Stripe dashboard from data table editor
    * Autocomplete all the things
    )
