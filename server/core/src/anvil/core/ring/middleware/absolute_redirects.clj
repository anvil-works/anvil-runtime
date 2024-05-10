(ns anvil.core.ring.middleware.absolute-redirects
  "Middleware for replacing relative redirects with absolute redirects. Useful
  for clients that do not yet implement RFC 7231 (RFC 2616 does not allow
  relative redirects).

  This is a direct copy-paste of ring.middleware.absolute-redirects, but fixed
  to cope with lists of values in the Location header."
  (:require [ring.util.request :as req])
  (:import  [java.net URL MalformedURLException]))

(defn- redirect? [response]
  (#{201 301 302 303 307} (:status response)))

(defn- get-header-key [response ^String header-name]
  (->> response :headers keys
       (filter #(.equalsIgnoreCase header-name %))
       first))

(defn- update-header [response header f & args]
  (if-let [header (get-header-key response header)]
    (apply update-in response [:headers header] f args)
    response))

(defn- url? [^String s]
  (try (URL. s) true
       (catch MalformedURLException _ false)))

(defn- absolute-url [location request]
  (if (url? location)
    location
    (let [url (URL. (req/request-url request))]
      (str (URL. url location)))))

(defn absolute-redirects-response
  "Convert a response that redirects to a relative URLs into a response that
  redirects to an absolute URL. See: wrap-absolute-redirects."
  [response request]
  (if (redirect? response)
    (update-header response "location" (fn [location]
                                         (cond
                                           (string? location)
                                           (absolute-url location request)

                                           (coll? location)
                                           (for [loc location]
                                             (absolute-url loc request))

                                           :else
                                           (throw (Exception. (str "Invalid value for 'Location' header: " location))))))
    response))

(defn wrap-absolute-redirects
  "Middleware that converts redirects to relative URLs into redirects to
  absolute URLs. While many browsers can handle relative URLs in the Location
  header, RFC 2616 states that the Location header must contain an absolute
  URL."
  [handler]
  (fn
    ([request]
     (absolute-redirects-response (handler request) request))
    ([request respond raise]
     (handler request #(respond (absolute-redirects-response % request)) raise))))
