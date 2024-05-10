(ns anvil.dispatcher.native-rpc-handlers.google.drive
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [anvil.dispatcher.native-rpc-handlers.google.util]
        [slingshot.slingshot])
  (:require [org.httpkit.client :as http]
            [clojure.data.json :as json]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.lazy-media :as lazy-media]
            [anvil.dispatcher.types]
            [anvil.dispatcher.types :as types]
            [ring.util.codec :as codec]
            [anvil.util :as util]
            [anvil.dispatcher.serialisation.blocking-hacks :as blocking-hacks])
  (:import (java.io ByteArrayInputStream SequenceInputStream)
           (java.util Collections)
           (anvil.dispatcher.types SerialisableForRpc BlobMedia MediaDescriptor Media)))

(defn general-drive-error [message]
  {:anvil/server-error message
   :docId "google_drive"
   :docLinkTitle "Learn more about Google Drive integration"})

(defn gen-lm [{id "id" title "title" :as file-item} creds]
  (let [lm-key (lazy-media/generate-mac "gdrive" (str creds "." id) *session-state*)]
    (assoc file-item "anvil_LazyMedia"
                     (reify
                       SerialisableForRpc
                       (serialiseForRpc [_this _lo-key]
                         {:type      ["LazyMedia"]
                          :manager   "gdrive"
                          :id        (str creds "." id)
                          :name      title
                          :mime-type (get file-item "mimeType")
                          :length    (get file-item "fileSize")
                          :key       lm-key})))))

(defn whitelist!-and-lazy-media [creds wl-access {id "id" :as file-item}]
  (whitelist! ::file id creds wl-access)
  (whitelist! ::file-download-url (get file-item "downloadUrl") creds wl-access)
  (gen-lm file-item creds))

(defn multi-whitelist!-and-lazy-media [items creds wl-access]
  (doall (for [i items] (whitelist!-and-lazy-media creds wl-access i))))

(defonce apps-needing-drive-scope (atom {}))

(defn get-app-file [_kwargs id]
  (let [wl-access (get-whitelist-access ::file id "google-delegated")
        _ (ensure-whitelist-access-ok wl-access false "read this app file")

        resp (request {:url    (str "https://www.googleapis.com/drive/v2/files/" id)
                       :method :get} "google-delegated")
        {:keys [scope] :as _access-token} (get-in @*session-state* [:google :delegation-access-token])
        scopes (set (.split scope " "))
        has-drive? (contains? scopes "https://www.googleapis.com/auth/drive")]
    (when has-drive?
      (swap! apps-needing-drive-scope assoc *app-id* (select-keys *app-info* [:name :user_id :user_organisation])))
    (whitelist!-and-lazy-media "google-delegated" wl-access resp)))

(defn get-user-files [_kwargs]
  (let [resp (request {:url    (str "https://www.googleapis.com/drive/v2/files/root")
                       :method :get} "google-user")]
    resp))

(defn list-files [kwargs parent-id creds]
  ;; This is slightly hair-raising, but 'parent-id' must be on the whitelist
  ;; so we already know it's a file we're allowed to access.
  (let [q-str (str "'" parent-id "' in parents")

        q-str (if-let [mime-type (:mime_type kwargs)]
                (let [negate (.startsWith mime-type "!")
                      mime-type (.replace mime-type "!" "")]
                  (str q-str " and mimeType " (when negate "!") "= '" (clojure.string/replace mime-type #"'" "\\\\'") "'"))
                q-str)

        q-str (if (contains? kwargs :trashed)
                (str q-str " and trashed = " (boolean (:trashed kwargs)))
                q-str)

        q-str (if-let [title (:title kwargs)]
                (str q-str " and title = '" (clojure.string/replace title #"'" "\\\\'") "'")
                q-str)

        wl-access (get-whitelist-access ::file parent-id creds)]

    (ensure-whitelist-access-ok wl-access false "list files")

    (let [resp (request {:url    (str "https://www.googleapis.com/drive/v2/files/"
                                      "?maxResults=" (or (:max_results kwargs) 100)
                                      "&pageToken=" (if (:page_token kwargs)
                                                      (codec/url-encode (:page_token kwargs))
                                                      "")
                                      "&q=" (codec/url-encode q-str))
                         :method :get} creds)]

      (update-in resp ["items"] multi-whitelist!-and-lazy-media creds wl-access))))

(defn list-file-revisions [_kwargs file-id creds page-token]
  (let [wl-access (get-whitelist-access ::file file-id creds)]
    (ensure-whitelist-access-ok wl-access false)

    (let [resp (request {:url    (str "https://www.googleapis.com/drive/v2/files/"
                                      file-id
                                      "/revisions"
                                      (when (not-empty page-token) (str "?pageToken=" (codec/url-encode page-token))))
                         :method :get} creds)]

      (update-in resp ["items"] multi-whitelist!-and-lazy-media creds wl-access))))


(defn get-file-by-id [_kwargs parent-id id creds]
  (let [wl-access (get-whitelist-access ::file parent-id creds)
        _ (ensure-whitelist-access-ok wl-access false)

        resp    (request {:url    (str "https://www.googleapis.com/drive/v2/files/" id)
                          :method :get} creds)

        parents (set (map #(get % "id") (get resp "parents")))]

    (when-not (contains? parents parent-id)
      (throw+ (general-drive-error "Cannot get file in different folder.")))

    (whitelist!-and-lazy-media creds wl-access resp)))


(defn trash [_kwargs id creds]
  ;; TODO: Work out whether we really want to allow app files to be deleted.
  (ensure-whitelist-ok ::file id creds true "trash file")

  (let [resp (request {:url    (str "https://www.googleapis.com/drive/v2/files/" id "/trash")
                       :method :post} creds)]

    ;; TODO: Respond to this properly, with success or fail
    resp))

(defn delete [_kwargs id creds]
  ;; TODO: Work out whether we really want to allow app files to be deleted.
  (ensure-whitelist-ok ::file id creds true "delete file")

  (let [resp (request {:url    (str "https://www.googleapis.com/drive/v2/files/" id)
                       :method :delete} creds)]

    ;; TODO: Respond to this properly, with success or fail
    (log/trace resp)
    resp))

(defn create-item-simple [_kwargs title parent-id mime-type creds]

  (let [wl-access (get-whitelist-access ::file parent-id creds)

        _ (ensure-whitelist-access-ok wl-access true "create file")

        metadata {"mimeType" (str mime-type)
                  "title"    (str title)
                  "parents"  [{"id" parent-id}]}

        resp (request {:url     "https://www.googleapis.com/drive/v2/files"
                       :method  :post
                       :headers {"Content-Type" "application/json"}
                       :body    (util/write-json-str metadata)} creds)]

    (whitelist!-and-lazy-media creds wl-access resp)))


(defmulti create-item-multipart (fn [& args] (class (nth args 3))))

(defmethod create-item-multipart String [kwargs title parent-id content creds]
  (create-item-multipart kwargs title parent-id (types/mk-ChunkedStream title (or (:content_type kwargs) "text/plain") (.getBytes content)) creds))

(defmethod create-item-multipart :default [_kwargs title parent-id content creds]

  (let [wl-access (get-whitelist-access ::file parent-id creds)
        _ (ensure-whitelist-access-ok wl-access true "create file")

        mime-type     (.getContentType content)
        metadata {"mimeType" (str mime-type)
                  "title"    (str title)
                  "parents"  [{"id" parent-id}]}

        body-header (str "--eo1bee8ahChoh3sahjah9laViv0AetiebahH7ahc\nContent-Type: application/json; charset=UTF-8\n\n "
                      (util/write-json-str metadata)
                      "\n\n"
                      "--eo1bee8ahChoh3sahjah9laViv0AetiebahH7ahc\nContent-Type: "
                      mime-type
                      "\n\n")

        body      (SequenceInputStream.
                    (Collections/enumeration [(ByteArrayInputStream. (.getBytes body-header))
                                              (blocking-hacks/?->InputStream *req* content)
                                              (ByteArrayInputStream. (.getBytes "\n--eo1bee8ahChoh3sahjah9laViv0AetiebahH7ahc--"))]))

        resp (request {:url     "https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart"
                       :method  :post
                       :headers {"Content-Type" "multipart/related; boundary=\"eo1bee8ahChoh3sahjah9laViv0AetiebahH7ahc\""}
                       :body    body} creds)]

    (whitelist!-and-lazy-media creds wl-access resp)))

(defn update-metadata [_kwargs id metadata creds]
  (ensure-whitelist-ok ::file id creds true "update file")

  (let [[{new-parent :id old-parent :old_id}] (:parents metadata)

        _ (when new-parent (ensure-whitelist-ok ::file new-parent creds true "move file to this folder"))

        sanitized-metadata {"title" (:title metadata)}      ;; Cannot set parents in metadata any more. Must use query string

        qs (if new-parent
             (str "?addParents=" new-parent "&removeParents=" old-parent)
             "")

        resp (request {:url     (str "https://www.googleapis.com/drive/v2/files/" id qs)
                       :method  :put
                       :headers {"Content-Type" "application/json"}
                       :body    (util/write-json-str sanitized-metadata)} creds)]

    resp))

(defn get-content [_kwargs ^String download-url creds]
  (ensure-whitelist-ok ::file-download-url download-url creds false "download file")

  (let [resp @(http/request (add-credentials {:keepalive -1
                                              :url       download-url
                                              :method    :get
                                              :as        :byte-array} creds) nil)

        arr (:body resp)]

    (BlobMedia. (get-in resp [:headers :content-type]) arr (second (re-matches #".*/([^/]+)" download-url)))))

(def mk-http-media)

(defmulti set-content (fn [& args] (class (nth args 2))))

(defmethod set-content String [_kwargs id content creds]
  (set-content _kwargs id (BlobMedia. "text/plain" (.getBytes content) nil) creds))

(defmethod set-content :default [_kwargs id content creds]
  (ensure-whitelist-ok ::file id creds true "upload file content")

  (let [mime-type (.getContentType content)
        resp (request {:url     (str "https://www.googleapis.com/upload/drive/v2/files/" id "?uploadType=media")
                       :method  :put
                       :headers {"Content-Type" mime-type}
                       :body    (blocking-hacks/?->InputStream *req* content)} creds)]

    (gen-lm resp creds)))


(def handlers {"anvil.private.google.drive.get_app_file" (wrap-native-fn get-app-file)
               "anvil.private.google.drive.get_user_files" (wrap-native-fn get-user-files)
               "anvil.private.google.drive.list_files" (wrap-native-fn list-files)
               "anvil.private.google.drive.get_file_by_id" (wrap-native-fn get-file-by-id)
               "anvil.private.google.drive.list_file_revisions" (wrap-native-fn list-file-revisions)
               "anvil.private.google.drive.delete" (wrap-native-fn delete)
               "anvil.private.google.drive.trash" (wrap-native-fn trash)
               "anvil.private.google.drive.create_item_simple" (wrap-native-fn create-item-simple)
               "anvil.private.google.drive.create_item_multipart" (wrap-native-fn create-item-multipart)
               "anvil.private.google.drive.update_metadata" (wrap-native-fn update-metadata)
               "anvil.private.google.drive.get_content" (wrap-native-fn get-content)
               "anvil.private.google.drive.set_content" (wrap-native-fn set-content)})

;; When getting media from HTTP and we don't know the content type,
;; we lazily get a HEAD
(defn mk-http-media [request-map]
  (let [content-info (atom nil)
        get-it #(let [r @(http/request (assoc request-map :method % :as :stream :keepalive -1) nil)]
                 (when-not (= (:status r) 200)
                   (throw+ {:anvil/server-error (str "Google Drive download failed (code " (:status r) ")")}))
                 (log/trace r)
                 (reset! content-info {:content-type (get-in r [:headers :content-type])
                                       :length       (when-let [len-s (get-in r [:headers :content-length])]
                                                       (Long/parseLong len-s))
                                       :file-name    (second (re-matches #"attachment;\s*filename=\"(.*)\"\s*"
                                                                         (get-in r [:headers :content-disposition])))})
                 r)
        get-content-info #(do (when-not @content-info (get-it :head)) @content-info)]
    (reify
      MediaDescriptor
      (getName [_this] (:file-name (get-content-info)))
      (getContentType [_this] (:content-type (get-content-info)))
      Media
      (getLength [_this] (:length (get-content-info)))
      (getInputStream [_this] (:body (get-it :get))))))

(defn serve-lazy-media [media-id]
  (if-let [[_ creds id] (re-matches #"([^\.]*)\.(.*)" media-id)]
    ;; *any* whitelist access is OK (the MAC is checking that the client is allowed to see this;
    ;; we just need to check that the *app* is allowed to see it)
    (if (get-whitelist-access ::file id creds)
      (mk-http-media (add-credentials
                       {:url (str "https://www.googleapis.com/drive/v2/files/" id "?alt=media")}
                       creds))
      (throw+ {:anvil/server-error "You do not have permission to access this file"}))

    (throw+ {:anvil/server-error "Not a valid Google Drive media ID"})))

(swap! lazy-media/managers assoc "gdrive" (wrap-lazy-media-server serve-lazy-media))