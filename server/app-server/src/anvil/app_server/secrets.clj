(ns anvil.app-server.secrets
  (:require [slingshot.slingshot :refer :all]
            [anvil.dispatcher.native-rpc-handlers.util :as rpc-util]
            [anvil.runtime.secrets :as runtime-secrets]
            [anvil.dispatcher.core :as dispatcher]
            [anvil.app-server.conf :as conf]
            [clojure.data.codec.base64 :as b64]
            [anvil.util :as util])
  (:import (javax.crypto.spec SecretKeySpec)
           (java.io FileInputStream File FileOutputStream)
           (javax.crypto KeyGenerator)
           (java.security SecureRandom)))

;; Implement the Secrets Service backend

(defn wrap-no-uplink [f]
  (rpc-util/wrap-native-fn (fn [& args]
                             (when rpc-util/*client-request?*
                               (throw+ (runtime-secrets/generic-secret-error "Client code cannot access app secrets.")))
                             (when (= rpc-util/*request-origin* :uplink)
                               (throw+ (runtime-secrets/generic-secret-error "Uplink code cannot access secrets for this app.")))
                             (apply f args))))

(defn get-secret [_kwargs secret-name]
  (or (conf/get-secret-value secret-name)
      (throw+ (runtime-secrets/generic-secret-error "No such secret '" secret-name "'"))))

(defn- get-encryption-key [key-name]
  (if-let [key (conf/get-encryption-key key-name)]
    (SecretKeySpec. (b64/decode (.getBytes ^String key)) 0 (/ runtime-secrets/SECRET-KEY-NBITS 8) "AES")
    (throw+ (runtime-secrets/generic-secret-error "No such encryption key '" key-name "'"))))

(defn encrypt-with-secret [_kwargs key-name plaintext]
  (runtime-secrets/encrypt-str (get-encryption-key key-name) plaintext))

(defn decrypt-with-secret [_kwargs key-name ciphertext]
  (runtime-secrets/decrypt-str (get-encryption-key key-name) ciphertext))

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.secrets.get_secret"       (wrap-no-uplink get-secret)
        "anvil.private.secrets.encrypt_with_key" (wrap-no-uplink encrypt-with-secret)
        "anvil.private.secrets.decrypt_with_key" (wrap-no-uplink decrypt-with-secret)})


;; Backend for other secret storage

(def ^:private secret-key (delay (let [secret-key-file ^File (conf/get-secret-key-file)]
                                   (if (.exists secret-key-file)
                                     (with-open [i (FileInputStream. secret-key-file)]
                                       (let [b (byte-array (.length secret-key-file))]
                                         (.read i b)
                                         (SecretKeySpec. b "AES")))

                                     (let [gen (doto (KeyGenerator/getInstance "AES")
                                                 (.init 128 (SecureRandom.)))
                                           key (.generateKey gen)
                                           a (.getEncoded key)]

                                       (with-open [o (FileOutputStream. ^File secret-key-file)]
                                         (.write o a))
                                       key)))))


(defn get-global-app-secret-value [app-info secret-id encrypted-value]
  ;; This is used for things that aren't user-visible App Secrets, but are stored per-app in the YAML
  ;; (eg Custom SMTP passwords). In the app server you should never try to call this function;
  ;; there should be nice config flags for providing the required information instead.
  (throw (UnsupportedOperationException.)))

(defn encrypt-str-with-global-key [key-specialisation plaintext]
  (runtime-secrets/encrypt-str @secret-key (str key-specialisation ":" plaintext)))

(defn decrypt-str-with-global-key [key-specialisation ciphertext]
  (let [key-specialisation (str key-specialisation)
        pt ^String (runtime-secrets/decrypt-str @secret-key ciphertext)]
    (if (.startsWith pt (str key-specialisation ":"))
      (.substring pt (inc (.length key-specialisation)))
      (throw+ (runtime-secrets/generic-secret-error "This encrypted value cannot be used for " key-specialisation)))))


(runtime-secrets/set-secret-hooks! (util/hooks [get-global-app-secret-value encrypt-str-with-global-key decrypt-str-with-global-key]))
