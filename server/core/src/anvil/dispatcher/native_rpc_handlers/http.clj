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
            [anvil.dispatcher.core :as dispatcher])
  (:import
    (org.apache.commons.codec.binary Base64)
    (java.io InputStream ByteArrayOutputStream)
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

(defn request [kwargs]
  (let [url     (:url kwargs)
        method  (keyword (.toLowerCase (or (:method kwargs) "GET")))
        headers (reduce merge {} (for [[k v] (:headers kwargs)]
                                   {(.substring (.toLowerCase (str k)) 1) v}))
        headers (if (:username kwargs)
                  (assoc headers "authorization"
                                 (str "Basic " (Base64/encodeBase64String (.getBytes (str (:username kwargs) ":" (:password kwargs))))))
                  headers)

        data    (:data kwargs)

        [data c-type] (cond

                        (or (nil? data) (= data "")
                            (string? data)) [data]

                        (instance? MediaDescriptor data) [(types/?->InputStream data)
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

        headers (if c-type
                  (assoc headers "content-type" c-type)
                  headers)

        httpkit-map {:url       url
                     :method    method
                     :headers   headers
                     :body      (when (not= method :get) data)
                     :keepalive -1}

        {:keys [status headers body error] :as resp} @(http/request httpkit-map nil)]

    (log/trace resp)

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
                          nil)}))


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

