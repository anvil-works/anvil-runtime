(ns anvil.dispatcher.native-rpc-handlers.time
  (:use [slingshot.slingshot])
  (:import [java.util Calendar GregorianCalendar TimeZone]
           [java.util.regex Pattern])
  (:require [anvil.dispatcher.native-rpc-handlers.util :as native-util]))

(defn- ^Calendar mk-calendar []
  (GregorianCalendar. (TimeZone/getTimeZone "UTC")))

(defn- ^Calendar mk-calendar-secs [secs]
  (doto (mk-calendar)
    (.setTimeInMillis (if secs (* secs 1000) (System/currentTimeMillis)))))

(defn- to-struct-time [^Calendar cal]
  (let [g #(.get cal %)
        day-of-week ({Calendar/SUNDAY 0, Calendar/MONDAY 1, Calendar/TUESDAY 2, Calendar/WEDNESDAY 3, Calendar/THURSDAY 4, Calendar/FRIDAY 5, Calendar/SATURDAY 6} (g Calendar/DAY_OF_WEEK))]
    [(g Calendar/YEAR), (inc (g Calendar/MONTH)), (g Calendar/DAY_OF_MONTH),
     (g Calendar/HOUR_OF_DAY), (g Calendar/MINUTE), (g Calendar/SECOND), day-of-week, (g Calendar/DAY_OF_YEAR), 0]))


(defn- ^Calendar to-calendar [[tm_year tm_mon tm_mday tm_hour tm_min tm_sec _tm_wday _tm_yday _tm_isdst]]
  ;; TODO time zones; currently all UTC
  (doto (mk-calendar)
    (.set Calendar/YEAR tm_year)
    (.set Calendar/MONTH (dec tm_mon))
    (.set Calendar/DAY_OF_MONTH tm_mday)
    (.set Calendar/HOUR_OF_DAY tm_hour)
    (.set Calendar/MINUTE tm_min)
    (.set Calendar/SECOND tm_sec)
    (.set Calendar/MILLISECOND 0)))


(defn gmtime [_kwargs secs]
  (to-struct-time (mk-calendar-secs secs)))


(defn mktime [_kwargs t]
  (/ (.getTimeInMillis (to-calendar t)) 1000.0))


(defn get_time [_kwargs] (/ (System/currentTimeMillis) 1000.0))

(defprotocol Format
  (render [_this ^Calendar cal] "Get a string representing this format substitution")
  (parse [_this ^String s, ^Calendar cal] "Update the calendar with information from this format. Return chars consumed, or nil on failure."))

(deftype LiteralStringFormat [ls] Format
  (render [_this _cal] ls)
  (parse [_this s _cal]
    (when (.startsWith (.toLowerCase s) (.toLowerCase ls))
      (.length ls))))

(deftype EnumFormat [options cal-field] Format
  (render [_this cal] (nth options (.get cal cal-field)))
  (parse [_this s cal]
    (loop [i 0 [o & more-options] options]
      (cond
        (and (not o) (not more-options))
        nil

        (and o (.startsWith s o))
        (do
          (.set cal cal-field i)
          (.length o))

        :else
        (recur (inc i) more-options)))))

(deftype NumberFormat [ndigits field struct-time-offset] Format
  (render [_this cal] (format (str "%0" ndigits "d") (+ (.get cal field) struct-time-offset)))
  (parse [_this s cal]
    (when-let [[_ ns] (re-matches (Pattern/compile (str "(\\d{1,"ndigits"}).*")) s)]
      (.set cal field (- (Integer/parseInt ns) struct-time-offset))
      (.length ns))))

(deftype TwelveHourFormat [] Format
  (render [_this cal]
    (format "%02d" (let [h (.get cal Calendar/HOUR)] (if (= h 0) 12 h))))
  (parse [_this s cal]
    (when-let [[_ ns] (re-matches #"(\d{1,2}).*" s)]
      (let [h (Integer/parseInt ns)]
        (.set cal Calendar/HOUR (if (= h 12) 0 h))
        (.length ns)))))

(deftype TwoDayYearFormat [] Format
  (render [_this cal]
    (format "%02d" (mod (.get cal Calendar/YEAR) 100)))
  (parse [_this s cal]
    (when-let [[_ ns] (re-matches #"(\d{2}).*" s)]
      (let [y (Integer/parseInt ns)]
        (.set cal Calendar/YEAR (+ y (if (< y 50) 2000 1900)))))))

(def parse-formats)
(def strptime-to-cal-and-leftovers)

(deftype DefaultDateFormat [format] Format
  (render [_this cal] (apply str (map #(render % cal) (parse-formats format))))
  (parse [_this s cal]
    (when-let [[_cal leftover-string] (try (strptime-to-cal-and-leftovers cal format s)
                                           (catch Exception _e nil))]
      (- (.length s) (.length leftover-string)))))

(def escape-handlers
  {"a" (EnumFormat. [nil "Sun" "Mon" "Tue" "Wed" "Thu" "Fri" "Sat"] Calendar/DAY_OF_WEEK)
   "A" (EnumFormat. [nil "Sunday" "Monday" "Tuesday" "Wednesday" "Thursday" "Friday" "Saturday"] Calendar/DAY_OF_WEEK)
   "b" (EnumFormat. ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] Calendar/MONTH)
   "B" (EnumFormat. ["January", "February", "March", "Apr", "May", "June", "July", "August", "September", "October", "November", "December"] Calendar/MONTH)
   "c" (DefaultDateFormat. "%a %b %d %H:%M:%S %Y")
   "d" (NumberFormat. 2 Calendar/DAY_OF_MONTH 0)
   "H" (NumberFormat. 2 Calendar/HOUR_OF_DAY 0)
   "I" (TwelveHourFormat.)
   "j" (NumberFormat. 3 Calendar/DAY_OF_YEAR 0)
   "m" (NumberFormat. 2 Calendar/MONTH 1)
   "M" (NumberFormat. 2 Calendar/MINUTE 0)
   "p" (EnumFormat. ["AM" "PM"] Calendar/AM_PM)
   "S" (NumberFormat. 2 Calendar/SECOND 0)
   "U" (NumberFormat. 2 Calendar/WEEK_OF_YEAR 0)            ; possibly WRONG
   "w" (NumberFormat. 1 Calendar/DAY_OF_WEEK -1)
   "W" (NumberFormat. 2 Calendar/WEEK_OF_YEAR 0)            ; possibly WRONG
   "x" (DefaultDateFormat. "%d %b %Y")
   "X" (DefaultDateFormat. "%H:%M:%S")
   "y" (TwoDayYearFormat.)
   "Y" (NumberFormat. 4 Calendar/YEAR 0)
   ;; TODO "Z" time zone.
   "%" (LiteralStringFormat. "%")})

(defn parse-formats [^String format]
  (for [[_ escape esc-char literal-string] (re-seq #"(%\d*(.|$))|([^%]+)" format)]
    (if escape
      (or (escape-handlers esc-char) (LiteralStringFormat. (str escape)))
      (LiteralStringFormat. literal-string))))

(defn strftime [_kwargs format t]
  (let [cal (if t (to-calendar t) (mk-calendar-secs nil))

        formats (parse-formats format)]

    (apply str (map #(render % cal) formats))))

(defn strptime-to-cal-and-leftovers [^Calendar cal, format-o s-o]
  (let [s (.replaceAll s-o "\\s+" " ")
        format-string (.replaceAll format-o "\\s+" " ")
        do-throw #(throw+ {:anvil/server-error (str "Time data '" s-o "' does not match format '" format-o "'")})]

    (loop [s s [^Format f & more-f] (parse-formats format-string)]
      (if f
        (if-let [^Number l (parse f s cal)]
          (recur (.substring s l) more-f)
          (do-throw))
        [cal s]))))

(defn strptime [_kwargs s-o format-o]
  (let [[cal leftover-string] (strptime-to-cal-and-leftovers (mk-calendar) format-o s-o)]
    (if (= leftover-string "")
      (to-struct-time cal)
      (throw+ {:anvil/server-error (str "Time data '" s-o "' does not match format '" format-o "'")}))))

(defmacro wrap-handlers [& namesyms]
  (into {}
        (for [n namesyms]
          [(str "anvil.private.time." n) `(native-util/wrap-native-fn ~n)])))

(def handlers (wrap-handlers gmtime mktime get_time strftime strptime))
