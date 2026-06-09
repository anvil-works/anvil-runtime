(ns anvil.runtime.serve-app.block-util
  (:require [ring.util.response :as resp]
            [clojure.tools.logging :as log]
            [anvil.runtime.util :as runtime-util]
            [hiccup.util :as hiccup-util]
            [clojure.string :as string]
            [anvil.runtime.secrets :as secrets]
            ring.middleware.cookies))

(defn ip-to-long
  "Convert an IP address string (e.g., '192.168.1.1') to a long integer"
  [ip-str]
  (try
    (when ip-str
      (let [parts (mapv #(Long/parseLong %) (clojure.string/split ip-str #"\."))]
        (when  (and (= 4 (count parts))
                    (every? #(<= 0 % 255) parts))
          (reduce (fn [acc octet]
                    (+ (* acc 256) octet))
                  0
                  parts))))
    (catch Exception _ nil)))

(defn ip-matches-cidr?
  "Check if an IP address matches a CIDR block (e.g., '192.168.1.0/24')"
  [ip-str cidr-str]
  (try
    (let [[cidr-base prefix-len-str] (clojure.string/split cidr-str #"/")
          prefix-len (Long/parseLong prefix-len-str)
          ip-long (ip-to-long ip-str)
          cidr-long (ip-to-long cidr-base)]
      (when (and ip-long cidr-long (<= 0 prefix-len 32))
        (let [mask (bit-shift-left -1 (- 32 prefix-len))
              ip-masked (bit-and ip-long mask)
              cidr-masked (bit-and cidr-long mask)]
          (= ip-masked cidr-masked))))
    (catch Exception _ false)))

(defn ip-matches-whitelist-entry?
  "Check if an IP matches a whitelist entry (either exact IP or CIDR block)"
  [ip-str entry]
  (if (clojure.string/includes? entry "/")
    (ip-matches-cidr? ip-str entry)
    (= ip-str entry)))

;; Block util
(defn block-app [{:keys [app-id app-origin] :as req} message]
  (log/debug "Couldn't load app" app-id ":" message)
  (-> (resp/response (-> (slurp (runtime-util/runtime-client-resource req "/block-app.html"))
                         (.replace "{{canonical-url}}" (hiccup-util/escape-html app-origin))
                         (.replace "{{anvil-error}}" (hiccup-util/escape-html message))
                         (string/replace #"\{\{cdn\-origin\}\}" (runtime-util/get-static-origin req))))
      (resp/header "x-anvil-sig" (secrets/encrypt-str-with-global-key :anvil-sig-header ""))
      (resp/content-type "text/html")
      (resp/set-cookie "anvil-test-cookie" true)
      (resp/status 404)))                                 ;TODO maybe a different 4xx?