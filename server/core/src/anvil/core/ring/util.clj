(ns anvil.core.ring.util
  (:require [org.httpkit.server :as hks])
  (:import (org.httpkit.server Channel)))

;; Utils for working with Ring middleware in async contexts

(defn- sync-middleware? [m]
  (and m (not (vector? m))))

(defn- chunk-sync-middleware [middlewares sync-handler]
  (let [sync-middlewares (take-while sync-middleware? middlewares)
        more-middlewares (drop-while sync-middleware? middlewares)
        composed-handler (reduce #(%2 %1) sync-handler sync-middlewares)]
    [composed-handler more-middlewares]))

(defn wrap-async
  "Wrap a Ring handler in middleware that works even if the handler produces an http-kit async channel.

  'middleware is a sequence, innermost first. Each element of this sequence may be either:
    - Async middleware: a 2-element vector.
        The first element is a function that takes a request and produces a request. This is called at request time.
        The second element is a function that takes two arguments: the request (as returned from the first function), and
            the response (as returned from the handler or inner layers of middleware)

    - Synchronous middleware: Standard Ring middleware

    *** NB THIS WRAPPER IS KNOWN TO BE BUGGY WITH CERTAIN ORDERINGS OF SYNC AND ASYNC WRAPPERS; TAKE CARE ***
"
  [handler middlewares]
  (let [inner-response-transformer (fn [reqs resp] resp)
        ;; Build up the function to call on the response when we finally get it
        async-response-transformer (loop [response-handler inner-response-transformer [middleware & more-middlewares :as middlewares] middlewares]
                                     (cond
                                       (empty? middlewares)
                                       response-handler

                                       (vector? middleware)
                                       (let [[_req-transformer resp-transformer] middleware
                                             new-resp-transformer (fn [[req & more-reqs] resp]
                                                                    (resp-transformer req (response-handler more-reqs resp)))]
                                         (recur new-resp-transformer more-middlewares))

                                       :else
                                       (let [[composed-handler more-middlewares] (chunk-sync-middleware middlewares #(::constant-response %))]
                                         (recur (fn [[req & more-reqs] resp]
                                                  (let [resp (response-handler more-reqs resp)]
                                                    (composed-handler (assoc req ::constant-response resp))))
                                                more-middlewares))))

        inner-handler (fn [req]
                        ;; Call the inner handler
                        (let [ch (:async-channel req)
                              request-snapshots (::request-snapshots req)
                              first-response? (atom true)
                              send! (fn send! [data close-after-send?]
                                      (if (first (swap-vals! first-response? (constantly false)))
                                        (hks/send! ch (async-response-transformer request-snapshots data) close-after-send?)
                                        (hks/send! ch data close-after-send?)))
                              req (cond-> req
                                          (and ch (not (:websocket? req)))
                                          (assoc :async-channel
                                                 (reify Channel
                                                   (open? [_this] (hks/open? ch))
                                                   (websocket? [_this] false)
                                                   (close [_this] (hks/close ch))
                                                   (send! [_this data] (send! data true))
                                                   (send! [_this data close-after-send?] (send! data close-after-send?))
                                                   (on-receive [_this cb] (hks/on-receive ch cb))
                                                   (on-ping [_this cb] (hks/on-ping ch cb))
                                                   (on-close [_this cb] (hks/on-close ch cb)))))

                              resp (handler req)]
                          (cond-> resp
                                  (and (:body resp)
                                       (instance? Channel (:body resp)))
                                  (assoc ::async? true))))

        sync-handler (loop [sync-handler inner-handler [middleware & more-middlewares :as middlewares] middlewares]
                       (cond
                         (empty? middlewares)
                         sync-handler

                         (vector? middleware)
                         (let [[transform-request transform-response] middleware]
                           (recur (fn [req]
                                    (let [req (transform-request req)
                                          req (update req ::request-snapshots conj req)
                                          resp (sync-handler req)]
                                      (when resp
                                        (if (::async? resp)
                                          resp
                                          (transform-response req resp)))))
                                  more-middlewares))

                         :else
                         (let [[composed-handler more-middlewares] (chunk-sync-middleware middlewares sync-handler)]
                           (recur (fn [req]
                                    (let [req (update req ::request-snapshots conj req)]
                                      (composed-handler req)))
                                  more-middlewares))))]
    sync-handler))

(defn as-sync-middleware [middleware]
  (if (vector? middleware)
    (let [[request-transformer response-transformer] middleware]
      (fn [f]
        (fn [req]
          (let [req (request-transformer req)]
            (response-transformer req (f req))))))
    middleware))