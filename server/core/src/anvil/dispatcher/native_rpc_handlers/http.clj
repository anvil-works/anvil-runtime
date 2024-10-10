(ns anvil.dispatcher.native-rpc-handlers.http
  (:use [slingshot.slingshot])
  (:require [anvil.dispatcher.native-rpc-handlers.util :as u]
            [org.httpkit.client :as http]
            [clojure.data.json :as json]
            [clojure.string :as string]
            [clojure.java.io]
            [clojure.tools.logging :as log]
            [ring.util.codec :as codec]
            [anvil.util :as util]
            [anvil.dispatcher.types :as types]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks]
            [anvil.core.tracing :as tracing]
            [anvil.core.worker-pool :as worker-pool])
  (:import
    (org.apache.commons.codec.binary Base64)
    (java.io InputStream ByteArrayOutputStream)
    (java.net URI)
    (anvil.dispatcher.types Media BlobMedia MediaDescriptor)
    (java.nio.charset Charset)))

(defn general-http-error
  ([message]
   {:anvil/server-error message
    :docId              "http_module"
    :docLinkTitle       "Learn more about the HTTP module"})
  ([type message]
    (assoc (general-http-error message)
      :type type)))

(defn echo [kwargs x]
  (u/*rpc-print* "Session state:" @u/*session-state* "\n")
  (u/*rpc-print* "Kwargs:" kwargs)
  (swap! u/*session-state* #(assoc % :http-echo-counter (inc (or (:http-echo-counter %) 0))))
  x)

(defn- slurp-bytes [^InputStream in]
  (with-open [out (ByteArrayOutputStream.)]
    (clojure.java.io/copy in out)
    (.toByteArray out)))

(defn- replace-query [url data]
  (try
    (let [uri (URI/create url)]
      (if (or (.getQuery uri) (not (string? data)))
        url
        (str (URI. (.getScheme uri) (.getAuthority uri) (.getPath uri) nil) "?" data (when-let [hash (.getRawFragment uri)]
                                                                                       (str "#" hash)))))
    (catch Exception _e
      url)))

(
  comment
  ;; the data is already encoded - want to ensure this doesn't get double encoded
  ;; https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMax=2024-04-01T00%3A00%3A00Z
  (replace-query "https://www.googleapis.com/calendar/v3/calendars/primary/events" "timeMax=2024-04-01T00%3A00%3A00Z")
  ;; and hash is preserved
  ;; https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMax=2024-04-01T00%3A00%3A00Z#foo
  (replace-query "https://www.googleapis.com/calendar/v3/calendars/primary/events#foo" "timeMax=2024-04-01T00%3A00%3A00Z")
  )

(defn- has-content [method]
  (and (not= method :get) (not= method :head)))

(defn request [{:keys [url timeout method headers data username password] :as kwargs}]
  (when u/*client-request?*
    (throw+ {:anvil/server-error "Cannot call this function from client code", :type "anvil.server.PermissionDenied"}))
  (worker-pool/with-expanding-threadpool-when-slow
    (let [start-time (System/currentTimeMillis)
          method (keyword (.toLowerCase (or method "GET")))
          headers (reduce merge {} (for [[k v] headers]
                                     {(.substring (.toLowerCase (str k)) 1) v}))
          headers (if username
                    (assoc headers "authorization" (util/basic-auth-header username password))
                    headers)

          [data c-type] (cond

                          (or (nil? data) (= data "")
                              (string? data)) [data]

                          (instance? MediaDescriptor data) [(blocking-hacks/?->InputStream u/*req* data)
                                                            (.getContentType ^MediaDescriptor data)]

                          (map? data) (if (headers "content-type")
                                        [(util/write-json-str data)]
                                        [(->> data
                                              (map #(str (codec/url-encode (.substring (str (first %)) 1))
                                                         "=" (codec/url-encode (str (second %)))))
                                              (string/join "&"))
                                         "application/x-www-form-urlencoded"])

                          (vector? data) (throw+ (general-http-error "Cannot use a list as the body of an HTTP request"))

                          :else (throw+ (general-http-error (str "Cannot use '" (.getClass data) "' as the body of an HTTP request"))))

          url (if (has-content method) url (replace-query url data))

          headers (if c-type
                    (assoc headers "content-type" c-type)
                    headers)

          httpkit-map {:url       url
                       :timeout   timeout
                       :method    method
                       :headers   headers
                       :body      (when (has-content method) data)
                       :keepalive -1}


          {:keys [status headers body error] :as resp} (tracing/with-span ["HTTP Request" {:url url :method (name method)}]
                                                         @(http/request httpkit-map nil))]

      (log/trace resp)
      (log/debug (str "anvil.private.http.request from app " u/*app-id* " to " url " took " (- (System/currentTimeMillis) start-time) "ms"))

      (when error
        (throw+ (general-http-error "anvil.http.HttpRequestFailed"
                                    (if (instance? javax.net.ssl.SSLException error)
                                      (str "SSL error: " (.getMessage error))
                                      (.getMessage error)))))

      {:status  status
       :headers headers
       :content (BlobMedia. (:content-type headers)
                            (cond
                              (string? body) (.getBytes body (Charset/forName "utf-8"))
                              (instance? InputStream body) (slurp-bytes body)
                              :else (throw+ (general-http-error (str "Don't know how to handle a response of " (if (nil? body) "null" (.getClass body)) " (status " (pr-str status) ")"))))
                            nil)})))


(defn url-encode [_kwargs s]
  (util/real-actual-genuine-url-encoder s))

(defn url-decode [_kwargs s]
  (try
    (codec/url-decode s)
    (catch Exception _e
      (throw+ (general-http-error "anvil.http.UrlEncodingError" "This is not a valid URL-encoded string")))))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.http.echo"       (u/wrap-native-fn echo)
        "anvil.private.http.request"    (u/wrap-native-fn request)
        "anvil.private.http.url_encode" (u/wrap-native-fn url-encode)
        "anvil.private.http.url_decode" (u/wrap-native-fn url-decode)})

