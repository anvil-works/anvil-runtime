(ns anvil.runtime.secrets
  (:require [anvil.util :as util]
            [crypto.random :as random]
            [slingshot.slingshot :refer :all]
            [clojure.data.codec.base64 :as b64])
  (:import (javax.crypto SecretKey Cipher)
           (javax.crypto.spec GCMParameterSpec)
           (java.util Arrays)
           (java.security GeneralSecurityException)))

;; Hookables

(defonce get-global-app-secret-value (fn [app-info secret-id encrypted-value] (throw (UnsupportedOperationException.))))

(defonce encrypt-str-with-global-key (fn [key-specialisation plaintext] (throw (UnsupportedOperationException.))))

(defonce decrypt-str-with-global-key (fn [key-specialisation ciphertext] (throw (UnsupportedOperationException.))))

(defonce decrypt-str-with-app-key (fn [app-info key-specialisation ciphertext] (throw (UnsupportedOperationException.))))

(def set-secret-hooks! (util/hook-setter [get-global-app-secret-value encrypt-str-with-global-key decrypt-str-with-app-key decrypt-str-with-global-key]))


;; Constants and utility functions for AES-GCM crypto

(def SECRET-KEY-NBITS 128)
(def GCM-IV-LENGTH 12)

(defn generic-secret-error [& msg]
  {:anvil/server-error (apply str msg), :type "anvil.secrets.SecretError"})

(defn encrypt-bin [^SecretKey k ^bytes v]
  (let [iv (random/bytes GCM-IV-LENGTH)
        params (GCMParameterSpec. SECRET-KEY-NBITS iv)
        cipher (doto (Cipher/getInstance "AES/GCM/NoPadding", "SunJCE")
                 (.init Cipher/ENCRYPT_MODE k params))
        output-len (.getOutputSize cipher (alength v))
        output (Arrays/copyOf ^bytes iv (+ output-len GCM-IV-LENGTH))]

    (.doFinal cipher v 0 (alength v) output GCM-IV-LENGTH)

    output))

(defn decrypt-bin [^SecretKey k ^bytes v]
  (try+
    (let [iv (Arrays/copyOf v ^Integer GCM-IV-LENGTH)
          params (GCMParameterSpec. SECRET-KEY-NBITS iv)
          cipher (doto (Cipher/getInstance "AES/GCM/NoPadding" "SunJCE")
                   (.init Cipher/DECRYPT_MODE k params))
          output (byte-array (.getOutputSize cipher (- (alength v) GCM-IV-LENGTH)))]

      (.doFinal cipher v GCM-IV-LENGTH (- (alength v) GCM-IV-LENGTH) output)
      output)

    (catch GeneralSecurityException _e
      (throw+ (generic-secret-error "This is not a valid encrypted value. It may have been tampered with.")))))

(defn encrypt-str [^SecretKey k ^String s]
  (String. ^bytes (b64/encode (encrypt-bin k (.getBytes s)))))

(defn decrypt-str [^SecretKey k ^String s]
  (let [key (try (b64/decode (.getBytes s))
                 (catch Exception e
                   (throw+ (generic-secret-error "This is not a valid key"))))]
    (String. ^bytes (decrypt-bin k key))))
