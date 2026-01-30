(ns anvil.dispatcher.native-rpc-handlers.http
  (:use [clj-commons.slingshot])
  (:require [anvil.dispatcher.native-rpc-handlers.util :as u]
            [org.httpkit.client :as http]
            [clojure.string :as string]
            [clojure.java.io]
            [clojure.tools.logging :as log]
            [ring.util.codec :as codec]
            [anvil.util :as util]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks]
            [anvil.core.tracing :as tracing])
  (:import
    (java.io InputStream ByteArrayOutputStream)
    (java.net URI)
    (anvil.dispatcher.types BlobMedia MediaDescriptor)
    (java.nio.charset Charset)))

(clj-logging-config.log4j/set-logger! :level :warn)

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

(defn request [return-path context {:keys [url timeout method headers data username password]}]
  (when (:client-request? context)
    (throw+ {:anvil/server-error "Cannot call this function from client code", :type "anvil.server.PermissionDenied"}))

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

                        (instance? MediaDescriptor data) [(blocking-hacks/?->InputStream (:req context) data)
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

        tracing-span (tracing/start-span "HTTP Request" {:url url :internal false :method (name method)})]

    (try
      (http/request httpkit-map
                    (fn [{:keys [status headers body error] :as resp}]
                      (try+
                        (log/trace resp)
                        (log/debug (str "anvil.private.http.request from app " (:app-id context) " to " url
                                        " took " (- (System/currentTimeMillis) start-time) "ms"))
                        (when error
                          (throw+ (general-http-error "anvil.http.HttpRequestFailed"
                                                      (if (instance? javax.net.ssl.SSLException error)
                                                        (str "SSL error: " (.getMessage error))
                                                        (.getMessage error)))))
                        (dispatcher/respond!
                          return-path
                          {:response
                           {:status  status
                            :headers headers
                            :content (BlobMedia. (:content-type headers)
                                                 (cond
                                                   (string? body) (.getBytes body (Charset/forName "utf-8"))
                                                   (instance? InputStream body) (slurp-bytes body)
                                                   :else (throw+ (general-http-error (str "Don't know how to handle a response of "
                                                                                          (if (nil? body) "null" (.getClass body))
                                                                                          " (status " (pr-str status) ")"))))
                                                 nil)}})

                        (catch :anvil/server-error e
                          (dispatcher/respond-with-error! return-path e))
                        (catch Object e
                          (dispatcher/respond-with-internal-server-error! return-path (:throwable &throw-context) ::request))
                        (finally
                          (tracing/end-span! tracing-span)))))
      (catch Throwable e
        (tracing/end-span! tracing-span)
        (throw e)))))


(defn url-encode [_kwargs s]
  (util/real-actual-genuine-url-encoder s))

(defn url-decode [_kwargs s]
  (try
    (codec/url-decode s)
    (catch Exception _e
      (throw+ (general-http-error "anvil.http.UrlEncodingError" "This is not a valid URL-encoded string")))))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.http.echo"       (u/wrap-native-fn echo)
        "anvil.private.http.request"    (u/wrap-async-native-fn request)
        "anvil.private.http.url_encode" (u/wrap-native-fn url-encode)
        "anvil.private.http.url_decode" (u/wrap-native-fn url-decode)})

