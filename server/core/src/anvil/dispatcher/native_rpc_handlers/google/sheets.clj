(ns anvil.dispatcher.native-rpc-handlers.google.sheets
  (:use [anvil.dispatcher.native-rpc-handlers.util]
        [anvil.dispatcher.native-rpc-handlers.google.util]
        [clojure.data.zip.xml]
        [slingshot.slingshot])
  (:require [clojure.zip :as zip]
            [clojure.string :as string]
            [clojure.data.json :as json]
            [clojure.tools.logging :as log]
            [anvil.dispatcher.serialisation.live-objects :as live-objects]
            [ring.util.codec :as codec]
            [anvil.util :as util]
            [anvil.core.worker-pool :as worker-pool]
            [anvil.dispatcher.core :as dispatcher]
            [medley.core :refer [indexed]]
            [anvil.dispatcher.types :as types])
  (:import (anvil.dispatcher.types Capability)))

(defn- feed [url start-index map-fn creds]
  (let [resp (request {:url (str url (if (.contains url "?") "&" "?") "start-index=" (or start-index 1) "&alt=json")} creds)
;        z (zip/xml-zip resp)

        results {:total_results (Integer/parseInt (get-in resp ["feed" "openSearch$totalResults" "$t"]))
                 :start_index   (Integer/parseInt (get-in resp ["feed" "openSearch$startIndex" "$t"]))
                 :post_url      (get (first
                                       (filter #(= (get % "rel") "http://schemas.google.com/g/2005#post")
                                               (get-in resp ["feed" "link"])))
                                     "href")
                 :items         (doall (map map-fn (get-in resp ["feed" "entry"])))}]
    (log/trace resp)
    results))

(defn- row->json [creds row wl-access]
  (let [r {:id (get-in row ["id" "$t"])
           :edit-url (get (first
                            (filter #(= (get % "rel") "edit")
                                    (get row "link")))
                          "href")
           :title  (get-in row ["title" "$t"])
           :values (apply merge (for [[k v] row
                                      :when (.startsWith k "gsx$")]
                                  {(.substring k 4) (get v "$t")}))}]
    (whitelist! ::worksheet-row-id (:id r) creds wl-access)
    r))

(defn- row->live-object [creds row wl-access]
  (let [j (row->json creds row wl-access)
        id (util/write-json-str {:id (:id j)
                            ;:edit-url (:edit-url j)
                            :creds   creds})]
    (live-objects/mk-LiveObjectProxy "anvil.private.google.sheets.Row" id [] ["__getitem__" "__setitem__" "delete"]
                                     (:values j))))

(defn- cell->json [creds cell wl-access]
  (let [c {:id          (get-in cell ["id" "$t"])
               :edit_url    (get (first
                                   (filter #(= (get % "rel") "edit")
                                           (get cell "link")))
                                 "href")
               :value       (get-in cell ["gs$cell" "$t"])
               :input_value (get-in cell ["gs$cell" "inputValue"])
               :row         (Integer/parseInt (get-in cell ["gs$cell" "row"]))
               :col         (Integer/parseInt (get-in cell ["gs$cell" "col"]))}]
    (whitelist! ::worksheet-cell-edit-url (:edit_url c) creds wl-access)
    c))

(defn sanitize-xml [s]
  (-> s
      (string/replace "&" "&amp;")
      (string/replace  ">" "&gt;")
      (string/replace "<" "&lt;")))

(defn get-sheet-v4 [_kwargs id creds]
  (let [access (get-whitelist-access :anvil.dispatcher.native-rpc-handlers.google.drive/file id creds)
        _ (ensure-whitelist-access-ok access false "get sheet")

        resp (request {:url (str "https://sheets.googleapis.com/v4/spreadsheets/" id)} creds)]
    {:obj   {:id     id
             :title  (get-in resp ["properties" "title"])
             :author {:name  ""
                      :email ""}}
     :other {:worksheets (map #(select-keys (get % "properties") ["sheetId" "title" "index" "gridProperties"]) (get-in resp ["sheets"]))
             :capability (Capability. ["_" "google-sheets" creds id access])}}))

(defn get-sheet [_kwargs id creds]
  (let [wl-access (get-whitelist-access :anvil.dispatcher.native-rpc-handlers.google.drive/file id creds)
        _ (ensure-whitelist-access-ok wl-access false "get sheet")

        resp (request {:url (str "https://spreadsheets.google.com/feeds/spreadsheets/private/full/" id)
                       :method :get} creds)

        z (zip/xml-zip resp)
        sheet {:id (xml1-> z :id text)
               :title (xml1-> z :title text)
               :author {:name  (xml1-> z :author :name text)
                        :email (xml1-> z :author :email text)}
               :worksheets_feed_url (xml1-> z
                                            :link
                                            (attr= :rel "http://schemas.google.com/spreadsheets/2006#worksheetsfeed")
                                            (attr :href))}]



    (whitelist! ::worksheets-feed-url (:worksheets_feed_url sheet) creds wl-access)

    sheet))

(defn list-worksheets [kwargs worksheets-feed-url creds]

  (let [wl-access (get-whitelist-access ::worksheets-feed-url worksheets-feed-url creds)
        _ (ensure-whitelist-access-ok wl-access false "list worksheets")
        results (feed worksheets-feed-url
                      (:start-index kwargs)
                      (fn [worksheet]
                        (let [r {:title         (get-in worksheet ["title" "$t"])
                                 :col_count     (Integer/parseInt (get-in worksheet ["gs$colCount" "$t"]))
                                 :row_count     (Integer/parseInt (get-in worksheet ["gs$rowCount" "$t"]))
                                 :list_feed_url (get (first
                                                       (filter #(= (get % "rel")
                                                                   "http://schemas.google.com/spreadsheets/2006#listfeed")
                                                               (get worksheet "link")))
                                                     "href")
                                 :cells_feed_url (get (first
                                                       (filter #(= (get % "rel")
                                                                   "http://schemas.google.com/spreadsheets/2006#cellsfeed")
                                                               (get worksheet "link")))
                                                     "href")}]
                          (whitelist! ::worksheet-list-feed-url (:list_feed_url r) creds wl-access)
                          (whitelist! ::worksheet-cells-feed-url (:cells_feed_url r) creds wl-access)
                          r))
                      creds)]

    results))

(defn list-rows [kwargs list-feed-url query _limit creds]
  ;; TODO: Implement limit.
  (worker-pool/with-expanding-threadpool-when-slow
    (let [wl-access (get-whitelist-access ::worksheet-list-feed-url list-feed-url creds)
          _ (ensure-whitelist-access-ok wl-access false "list rows")
          results (feed (str list-feed-url (when (not-empty query)
                                             (str "?sq=" (codec/url-encode query))))
                        (:start_index kwargs)
                        #(row->live-object creds % wl-access)
                        creds)]
      (whitelist! ::worksheet-list-feed-post-url (:post_url results) creds wl-access)

      results)))

(defn- escape-sheet-title [title]
  (str "'" (.replace title "'" "''") "'"))

(defn to-old-field-name [field]
  (.toLowerCase (.replaceAll (or field "") "[^A-Za-z0-9\\\\-]" "")))

(def ROWS-PAGE-SIZE 200)

(defn list-initial-rows-v4 [_kwargs capability query-map]
  (worker-pool/with-expanding-threadpool-when-slow
    (let [[creds spreadsheet-id access [sheet-title _sheet-id]] (types/unwrap-capability capability ["_" "google-sheets"] 4)
          range-str (str (escape-sheet-title sheet-title) "!1:" (+ ROWS-PAGE-SIZE 1))
          resp (request {:url (str "https://sheets.googleapis.com/v4/spreadsheets/" spreadsheet-id "/values/" (util/real-actual-genuine-url-encoder range-str))} creds)
          [fields & rows] (get resp "values")
          done? (< (count rows) ROWS-PAGE-SIZE)
          indexed-rows (filter (fn [[_i vals]]
                                 (let [val-map (zipmap (map to-old-field-name fields) vals)]
                                   (every? (fn [[q v]]
                                             (= (str (get val-map (to-old-field-name (name q)))) (str v)))
                                           query-map)))
                               (indexed rows))]
      [fields (map (fn [[i vals]]
                     {:row  (+ i 2)
                      :data vals}) indexed-rows) (+ ROWS-PAGE-SIZE 2) done?])))

(defn list-more-rows-v4 [_kwargs capability query-list start]
  (worker-pool/with-expanding-threadpool-when-slow
    (let [[creds spreadsheet-id access [sheet-title _sheet-id]] (types/unwrap-capability capability ["_" "google-sheets"] 4)
          range-str (str (escape-sheet-title sheet-title) "!" start ":" (+ start ROWS-PAGE-SIZE))
          resp (request {:url (str "https://sheets.googleapis.com/v4/spreadsheets/" spreadsheet-id "/values/" (util/real-actual-genuine-url-encoder range-str))} creds)
          rows (get resp "values")
          done? (< (count rows) ROWS-PAGE-SIZE)
          indexed-rows (filter (fn [[_i vals]]
                                 (every? (fn [[q v]] (or (nil? q) (= q v))) (map vector query-list vals)))
                               (indexed rows))]
      [(map (fn [[i vals]]
              {:row  (+ i start)
               :data vals}) indexed-rows) (+ start ROWS-PAGE-SIZE 1) done?])))

(defn add-row [_kwargs list-feed-url values creds]
  (let [wl-access (get-whitelist-access ::worksheet-list-feed-url list-feed-url creds)
        _ (ensure-whitelist-access-ok wl-access true "add row")

        rows     (list-rows nil list-feed-url "" 0 creds)
        post-url (:post_url rows)

        entry (apply str "<entry xmlns='http://www.w3.org/2005/Atom' xmlns:gsx='http://schemas.google.com/spreadsheets/2006/extended'>"
                     (map (fn [[k v]] (str "<gsx" (sanitize-xml k) ">" (sanitize-xml v) "</gsx" (sanitize-xml k) ">")) values))
        entry (str entry "</entry>")

        resp (request {:url (str post-url "?alt=json")
                       :method :post
                       :headers {"Content-Type" "application/atom+xml"}
                       :body entry} creds)]

    (when-let [entry (get resp "entry")]
      (row->live-object creds entry wl-access))))


(defn get-cell [_kwargs cells-feed-url row col creds]
  (when-not (and (number? row) (number? col))
    (throw+ {:anvil/server-error "Row and column must be numbers"
             :docId "drive_sheets"
             :docLinkTitle "Learn more about Google Sheets integration"}))

  (let [wl-access (get-whitelist-access ::worksheet-cells-feed-url cells-feed-url creds)
        _ (ensure-whitelist-access-ok wl-access false "read cell")

        resp (request {:url    (str cells-feed-url "/R" (int row) "C" (int col) "?alt=json")
                       :method :get} creds)

        cell (cell->json creds (get resp "entry") wl-access)]

    cell))

(defn list-cells [kwargs cells-feed-url query creds]

  (let [wl-access (get-whitelist-access ::worksheet-cells-feed-url cells-feed-url creds)
        _ (ensure-whitelist-access-ok wl-access false "list cells")

        results (feed (str cells-feed-url (when (not-empty query)
                                            (str "?" query)))
                      (:start_index kwargs)
                      #(cell->json creds % wl-access)
                      creds)]

    results))

(defn list-cells-v4 [_kwargs capability range-str [row-min, col-min, row-max, col-max]]
  (let [[creds spreadsheet-id _access [sheet-title _sheet-id]] (types/unwrap-capability capability ["_" "google-sheets"] 4)
        range (str (escape-sheet-title sheet-title) (if (empty? range-str) "" "!") range-str)
        real-range (util/real-actual-genuine-url-encoder range)
        url (str "https://sheets.googleapis.com/v4/spreadsheets/" spreadsheet-id "/values/" real-range)
        formula-param "?valueRenderOption=FORMULA"
        formatted-values (get (request {:url url} creds) "values")
        input-values (get (request {:url (str url formula-param)} creds) "values")
        row-data (map vector formatted-values input-values)]
    (if (and (empty? row-data) (not-empty range-str) (= row-min row-max) (= col-min col-max))
      [{:value "" :input_value "" :row row-min :col col-min}]
      (flatten (map-indexed (fn [r [v-row i-row]]
                              (map-indexed (fn [c [val i-val]]
                                             {:value       val
                                              :input_value (str i-val)
                                              :row         (+ r row-min)
                                              :col         (+ c col-min)}) (map vector v-row i-row))) row-data)))))

(defn update-cell [_kwargs cell-id edit-url row col value creds]
  (let [wl-access (get-whitelist-access ::worksheet-cell-edit-url edit-url creds)
        _ (ensure-whitelist-access-ok wl-access true "edit cell")

        entry    (str "<entry xmlns='http://www.w3.org/2005/Atom' xmlns:gs='http://schemas.google.com/spreadsheets/2006'><id>" cell-id "</id>"
                      "<gs:cell row=\"" (int row) "\" col=\"" (int col) "\" inputValue=\"" (sanitize-xml value) "\"></gs:cell>"
                      "</entry>")

        resp     (request {:url     (str edit-url "?alt=json")
                           :method  :put
                           :headers {"Content-Type" "application/atom+xml"}
                           :body    entry} creds)

        new-cell (cell->json creds (get resp "entry") wl-access)]
    new-cell))

(defn update-cell-v4 [_kwargs capability value]
  (let [[creds spreadsheet-id access [sheet-title _sheet-id] row col] (types/unwrap-capability capability ["_" "google-sheets"] 6)
        _ (ensure-whitelist-access-ok (keyword access) true "update cell")
        range (str (escape-sheet-title sheet-title) "!" col row)
        params "?valueInputOption=USER_ENTERED&includeValuesInResponse=true"
        resp (request {:url (str "https://sheets.googleapis.com/v4/spreadsheets/" spreadsheet-id "/values/" range params)
                       :method :put
                       :headers {"Content-Type" "application/json"}
                       :body (json/write-str {:values [[value]]})} creds)
        values (get-in resp ["updatedData" "values" 0])]
    (first values)))


(defn delete-row-v4 [_kwargs capability]
  (let [[creds spreadsheet-id access [_sheet-title sheet-id] row] (types/unwrap-capability capability ["_" "google-sheets"] 5)
        _ (ensure-whitelist-access-ok (keyword access) true "delete row")
        resp (request {:url     (str "https://sheets.googleapis.com/v4/spreadsheets/" spreadsheet-id ":batchUpdate")
                       :method  :post
                       :headers {"Content-Type" "application/json"}
                       :body    (json/write-str {"requests"
                                                 [{"deleteDimension"
                                                   {"range" {"sheetId"    sheet-id
                                                             "dimension"  "ROWS"
                                                             "startIndex" (dec row)
                                                             "endIndex"   row}}}]})}
                      creds)]
    ;; TODO: Perhaps return some kind of success?
    ))

(defn add-row-v4 [_kwargs capability data]
  (let [[creds spreadsheet-id access [sheet-title _sheet-id]] (types/unwrap-capability capability ["_" "google-sheets"] 4)
        _ (ensure-whitelist-access-ok (keyword access) true "add row")
        resp (request {:url     (str "https://sheets.googleapis.com/v4/spreadsheets/" spreadsheet-id "/values/" (escape-sheet-title sheet-title) "!A1:append"
                                     "?valueInputOption=USER_ENTERED"
                                     "&insertDataOption=INSERT_ROWS")
                       :method  :post
                       :headers {"Content-Type" "application/json"}
                       :body    (json/write-str {"values" [data]
                                                 ;;"valueInputOption" "USER_ENTERED"
                                                 ;;"insertDataOption" "INSERT_ROWS"
                                                 })}
                      creds)
        ; updatedRange is something like "Sheet1!A6:B6". Just get the final number
        [_ added-row-index] (re-matches #".*?([0-9]*)$" (get-in resp ["updates" "updatedRange"]))]
    added-row-index))

(def live-row
  {"__getitem__" (fn [id _kwargs field-name]

                   (let [wl-access (get-whitelist-access ::worksheet-row-id (:id id) (:creds id))
                         _ (ensure-whitelist-access-ok wl-access false "read row")
                         row (get (request {:url    (str (:id id) "?alt=json")
                                            :method :get} (:creds id)) "entry")


                         values (apply merge (for [[k v] row
                                                   :when (.startsWith k "gsx$")]
                                               {(.substring k 4) (get v "$t")}))]
                     (get values field-name)))

   "__setitem__" (fn [id _kwargs field-name val]

                   ;; Load the row first, to get its most recent editUrl
                   (let [wl-access (get-whitelist-access ::worksheet-row-id (:id id) (:creds id))
                         _ (ensure-whitelist-access-ok wl-access true "update row")
                         row (get (request {:url    (str (:id id) "?alt=json")
                                            :method :get} (:creds id)) "entry")

                         j (row->json (:creds id) row wl-access)

                         entry (apply str "<entry xmlns='http://www.w3.org/2005/Atom' xmlns:gsx='http://schemas.google.com/spreadsheets/2006/extended'><id>" (:id id) "</id>"
                                      (map (fn [[k v]] (str "<gsx:" (sanitize-xml k) ">" (sanitize-xml v) "</gsx:" (sanitize-xml k) ">")) {field-name val}))
                         entry (str entry "</entry>")
                         resp (request {:url     (str (:edit-url j) "?alt=json")
                                        :method  :put
                                        :headers {"Content-Type" "application/atom+xml"}
                                        :body    entry} (:creds id))

                         new-row (row->live-object (:creds id) (get resp "entry") wl-access)]

                     new-row))

   "delete"      (fn [id _kwargs]
                   ;; Load the row first, to get its most recent editUrl
                   (let [wl-access (get-whitelist-access ::worksheet-row-id (:id id) (:creds id))
                         _ (ensure-whitelist-access-ok wl-access true "delete row")
                         row (get (request {:url    (str (:id id) "?alt=json")
                                            :method :get} (:creds id)) "entry")

                         _ (log/debug row)

                         j (row->json (:creds id) row wl-access)

                         resp (if row
                                (request {:url    (:edit-url j)
                                          :method :delete} (:creds id))
                                (log/warn "Tried to delete nonexistent row:" id))]

                     ;; TODO: Return some kind of success indication.
                     (log/trace resp)))})

(swap! dispatcher/native-rpc-handlers merge
       {"anvil.private.google.sheets.get_sheet"            (wrap-native-fn get-sheet)
        "anvil.private.google.sheets.list_worksheets"      (wrap-native-fn list-worksheets)
        "anvil.private.google.sheets.list_rows"            (wrap-native-fn list-rows)
        "anvil.private.google.sheets.add_row"              (wrap-native-fn add-row)
        "anvil.private.google.sheets.get_cell"             (wrap-native-fn get-cell)
        "anvil.private.google.sheets.list_cells"           (wrap-native-fn list-cells)
        "anvil.private.google.sheets.update_cell"          (wrap-native-fn update-cell)

        "anvil.private.google.sheets.v4.get_sheet"         (wrap-native-fn get-sheet-v4)
        "anvil.private.google.sheets.v4.list_cells"        (wrap-native-fn list-cells-v4)
        "anvil.private.google.sheets.v4.update_cell"       (wrap-native-fn update-cell-v4)
        "anvil.private.google.sheets.v4.list_initial_rows" (wrap-native-fn list-initial-rows-v4)
        "anvil.private.google.sheets.v4.list_more_rows"    (wrap-native-fn list-more-rows-v4)
        "anvil.private.google.sheets.v4.delete_row"        (wrap-native-fn delete-row-v4)
        "anvil.private.google.sheets.v4.add_row"           (wrap-native-fn add-row-v4)})

(swap! dispatcher/native-live-object-backends merge
       {"anvil.private.google.sheets.Row" (wrap-live-object-backend live-row)})