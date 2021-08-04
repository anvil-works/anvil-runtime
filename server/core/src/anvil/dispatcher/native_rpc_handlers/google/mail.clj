(ns anvil.dispatcher.native-rpc-handlers.google.mail
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [anvil.dispatcher.native-rpc-handlers.google.util]
        [slingshot.slingshot])
  (:require [clojure.tools.logging :as log])
  (:import (javax.mail Address Session Message$RecipientType)
           (javax.mail.internet AddressException InternetAddress MimeMessage
                                MimeMultipart MimeBodyPart)
           (java.util Properties)
           (java.io ByteArrayOutputStream)
           (java.nio ByteBuffer)))

(defn general-gmail-error [message]
  {:anvil/server-error message
   :docId "google_mail"
   :docLinkTitle "Learn more about GMail integration"})

(def jm-session (Session/getInstance (Properties.)))

(defn send-mail [{:keys [to from_address cc bcc subject text html draft _attachments]}]
  (require-server! "send email")
  (let [msg (MimeMessage. ^Session jm-session)
        multipart (MimeMultipart. "alternative")
        baos (ByteArrayOutputStream.)

        parse-address #(try (InternetAddress. (str %))
                            (catch AddressException _
                              (throw+ (general-gmail-error (str "Invalid email address: '" % "'")))))]

    (doseq [[type rcpts] {Message$RecipientType/TO to,
                          Message$RecipientType/CC cc,
                          Message$RecipientType/BCC bcc}]
      (.addRecipients msg type (into-array Address (map parse-address rcpts))))

    (when from_address
      (.setFrom msg (parse-address from_address)))

    (.setSubject msg (str subject))

    (when text
      (.addBodyPart multipart (doto (MimeBodyPart.)
                                (.setText text "utf-8"))))
    (when html
      (.addBodyPart multipart (doto (MimeBodyPart.)
                                (.setContent html "text/html; charset=utf-8"))))

    (.setContent msg multipart)

    (.writeTo msg baos (into-array String (if from_address [] ["From"])))

    (let [r (request {:url     (if draft
                                 "https://www.googleapis.com/upload/gmail/v1/users/me/drafts?uploadtype=media"
                                 "https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadtype=media")
                      :method  :post
                      :headers {"Content-type" "message/rfc822"}
                      :body    (ByteBuffer/wrap (.toByteArray baos))}
                     "google-delegated")]
      (log/debug r)
      (when (and (map? r) (get r "error"))
        (throw+ (general-gmail-error (or (get r "message") "Message sending failed")))))
    nil))


(def handlers {"anvil.private.google.mail.send" (wrap-native-fn send-mail)})
