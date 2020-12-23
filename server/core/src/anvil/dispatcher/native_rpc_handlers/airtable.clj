(ns anvil.dispatcher.native-rpc-handlers.airtable
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [clojure.pprint]
        [slingshot.slingshot])
  (:require [clojure.data.json :as json]
            [org.httpkit.client :as http]
            [clojure.data.xml :as xml]
            [clojure.string :as string]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [ring.util.codec :as codec]
            [anvil.util :as util])
  (:import (anvil.dispatcher.types LiveObjectProxy)))

(defn request [httpkit-map key]

  (let [authenticated-httpkit-map (assoc-in httpkit-map [:headers "Authorization"]
                                            (str "Bearer " key))
        resp                     @(http/request (assoc authenticated-httpkit-map :keepalive -1) nil)]

    (when (:error resp)
      ;; TODO: Decide whether we want to return this error message to the user
      (throw (Exception. (str (:error resp)))))

    (condp (fn [a b] (.startsWith b a)) (or (-> resp :headers :content-type) "")
      "application/json" (json/read-str (if (empty? (:body resp)) "{}" (:body resp)))
      "application/atom+xml" (xml/parse-str (:body resp))
      "application/binary" (do (log/warn "Binary received. What?!")
                               (log/debug (with-out-str (pprint resp)))
                               (:body resp))
      "text/html" (do
                    (log/warn "Received html. Hmm:")
                    (log/debug (with-out-str (pprint resp)))
                    (:body resp))
      nil)))

(defn open [_kwargs id key client-permission]
  (live-objects/mk-LiveObjectProxy "anvil.private.airtable.Base" (util/write-json-str {:base-id id
                                                                                       :key     key}) [client-permission] ["__getitem__"]))

(defn ensure-allowed
  ([writing?]
    (ensure-allowed writing? nil))
  ([writing? action]
   (when-not (or (not *client-request?*)
                 (= "w" (first *permissions*))
                 (and (= "r" (first *permissions*))
                      (not writing?)))
     (throw+ {:anvil/server-error (str "Permission denied." (when action (str " Cannot " action " from client.")))}))))

(def record-cache (atom {}))

(defn record-ref? [v]
  (and (instance? String v)
       (.startsWith v "rec")
       (= 17 (.length v))))

(defn keep-cacheable-fields [fields]
  (select-keys fields (map (fn [[k v]] (when-not (or (record-ref? v)
                                                     (sequential? v))
                                         k)) fields)))

(defn mk-RecordProxy [id fields]
  (live-objects/mk-LiveObjectProxy "anvil.private.airtable.Record" (util/write-json-str id) *permissions* ["__getitem__" "__setitem__"] (keep-cacheable-fields fields)))

(defn- get-table-rows [id]
  (let [resp (request {:url    (str "https://api.airtable.com/v0/" (:base-id id) "/" (:table-name id))
                       :method :get} (:key id))
        records (get resp "records")]

    (if-not records
      (throw+ {:anvil/server-error (str "Something went wrong retrieving records for " (codec/url-decode (:table-name id)))})

      ; Need to realise this seq now, otherwise *permissions* will be wrong.
      (doall (map (fn [r]
                    (swap! record-cache #(assoc % (get r "id") (get r "fields")))
                    (mk-RecordProxy (assoc id :record-id (get r "id")) (r "fields"))) records)))))


(def Record
  {"__getitem__" (fn [id _kwargs name]
                   (ensure-allowed false "read field value")
                   (let [fields (or (get @record-cache (:record-id id))
                                    (request {:url    (str "https://api.airtable.com/v0/" (:base-id id) "/" (:table-name id) "/" (:record-id id))
                                              :method :get} (:key id)))
                         val (get fields name)

                         populate-if-cached (fn [possible-record-id]
                                              (or (when-let [fields (get @record-cache possible-record-id)]
                                                    (mk-RecordProxy (assoc id :record-id possible-record-id) fields))
                                                  possible-record-id))]
                     (if (sequential? val)
                       ; Need to realise this seq now, otherwise *permissions* will be wrong.
                       (doall (map populate-if-cached val))
                       (populate-if-cached val))))

   "__setitem__" (fn [id _kwargs name val]
                   (ensure-allowed true "write field value")
                   (let [maybe-proxy-to-id #(if (instance? LiveObjectProxy %)
                                             (:record-id (json/read-str (:id %) :key-fn keyword))
                                             %)
                         val (if (sequential? val)
                               ; Need to realise this seq now, otherwise *permissions* will be wrong.
                               (doall (map maybe-proxy-to-id val))
                               (maybe-proxy-to-id val))

                         resp (request {:url     (str "https://api.airtable.com/v0/" (:base-id id) "/" (:table-name id) "/" (:record-id id))
                                        :method  :patch
                                        :headers {"Content-Type" "application/json"}
                                        :body    (util/write-json-str {"fields" {name val}})} (:key id))]
                     (swap! record-cache #(assoc % (:record-id id) (get resp "fields")))))})

(def Table
  {"add_row"             (fn [id kwargs]
                           (ensure-allowed true "add record")
                           (let [maybe-proxy-to-id #(if (instance? LiveObjectProxy %)
                                                     (:record-id (json/read-str (:id %) :key-fn keyword))
                                                     %)
                                 kwargs (reduce (fn [new-kwargs [k v]] (assoc new-kwargs k (if (sequential? v)
                                                                                             (map maybe-proxy-to-id v)
                                                                                             (maybe-proxy-to-id v)))) {} kwargs)


                                 resp (request {:url     (str "https://api.airtable.com/v0/" (:base-id id) "/" (:table-name id))
                                                :method  :post
                                                :headers {"Content-Type" "application/json"}
                                                :body    (util/write-json-str {"fields" kwargs})} (:key id))]
                             (if-let [new-id (get resp "id")]
                               (do (swap! record-cache #(assoc % new-id (get resp "fields")))
                                   (mk-RecordProxy (assoc id :record-id new-id) (get resp "fields")))
                               (throw+ {:anvil/server-error (str ((resp "error") "type") ": " ((resp "error") "message"))}))))

   "__anvil_iter_page__" (fn [id _kwargs _nextPageKey]
                           (ensure-allowed false "read table")
                           (let [items (get-table-rows id)]
                             {:finished true, :items items}))})

(def Base
  {"__getitem__" (fn [id _kwargs name]
                   (ensure-allowed false "read database")
                   (live-objects/mk-LiveObjectProxy "anvil.private.airtable.Table"
                                                    (util/write-json-str (assoc id :table-name (string/replace (codec/url-encode name) #"\+" "%20")))
                                                    *permissions*
                                                    (keys Table)))})


(def handlers {"anvil.private.airtable.open" (wrap-native-fn open)})

(def live-object-backends {"anvil.private.airtable.Base"   (wrap-live-object-backend Base)
                           "anvil.private.airtable.Table"  (wrap-live-object-backend Table)
                           "anvil.private.airtable.Record" (wrap-live-object-backend Record)})