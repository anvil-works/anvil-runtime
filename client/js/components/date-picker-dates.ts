import { pyCall, pyCallable, pyObject, pyStr, pyType, toPy } from "@Sk";
import { datetimeMod, getModule, tzMod } from "@runtime/runner/py-util";
import { toPythonDateFormat } from "./date-picker-format";
import { datePickerWeekRules } from "./date-picker-week-rules";
import { warn } from "../runner/warnings";

interface TimeLocale {
    tag?: string;
    strftime(format: string, date: Date): string;
}
interface LocaleModule {
    $getLocale(): TimeLocale;
    $strftime(format: string, date: Date): string;
    LC_TIME: pyObject;
    setlocale: pyCallable;
}
export interface MomentLocaleOverrides {
    months?: string[];
    weekdays?: string[];
    weekdaysShort?: string[];
    weekdaysMin?: string[];
    monthsShort?: string[];
    longDateFormat?: Record<string, string>;
    week?: { dow?: number; doy?: number };
    preparse?: (text: string) => string;
    postformat?: (text: string) => string;
    ordinal?: string | ((number: number, period: string) => string);
}
interface DatePickerLocale {
    name: string;
    months: string[];
    daysOfWeek: string[];
    firstDay: number;
    minimalDays: number;
    formats: Record<string, string>;
    custom: MomentLocaleOverrides;
}
interface LegacyLocale {
    base?: MomentLocaleOverrides;
    current: MomentLocaleOverrides;
}
const overrides = new WeakMap<LocaleModule, Map<string, LegacyLocale>>();
// Legacy loaders poll moment.locale() until their definitions register. Let
// those loaders finish even if this browser must keep formatting in C.
// An explicit Python LC_TIME selection clears the reported legacy name.
const legacyLocaleNames = new WeakMap<TimeLocale, string>();
const localeCache = new WeakMap<TimeLocale, DatePickerLocale>();
const noOverrides: MomentLocaleOverrides = {};

function localeModule(): LocaleModule {
    return getModule("_locale").$d as unknown as LocaleModule;
}
export function momentLocaleName(): string {
    const locale = localeModule().$getLocale();
    return legacyLocaleNames.get(locale) ?? (locale.tag ?? "en").toLowerCase();
}
export function setDateLocale(name: string): string {
    const locale = localeModule();
    try {
        pyCall(locale.setlocale, [locale.LC_TIME, new pyStr(name === "en" ? "C" : name)]);
    } catch (error) {
        if (!(error instanceof Sk.builtin.NotImplementedError)) throw error;
        const key = localeKey(name);
        if (overrides.get(locale)?.has(key)) legacyLocaleNames.set(locale.$getLocale(), key);
        warn(
            `This browser cannot load locale ${name}. DatePicker will keep its default locale.`,
            {
                key: "moment:locale-unavailable:" + key,
                docUrl: "/editor/common-errors#moment-localisation-warnings",
                docLinkTitle: "How to update Moment date code",
            }
        );
    }
    return momentLocaleName();
}
function legacyLocales() {
    const mod = localeModule();
    let values = overrides.get(mod);
    if (!values) overrides.set(mod, (values = new Map()));
    return values;
}
function localeKey(name: string): string {
    return name.replaceAll("_", "-").split(".")[0].toLowerCase();
}
export function defineDateLocale(name: string, config: MomentLocaleOverrides | null) {
    if (config === null) legacyLocales().delete(localeKey(name));
    else legacyLocales().set(localeKey(name), { base: config, current: config });
}
export function updateDateLocale(name: string, config: MomentLocaleOverrides | null) {
    name = localeKey(name);
    const values = legacyLocales();
    const previous = values.get(name);
    if (config === null) {
        if (previous?.base) values.set(name, { base: previous.base, current: previous.base });
        else values.delete(name);
    } else {
        values.set(name, {
            base: previous?.base,
            current: {
                ...previous?.current,
                ...config,
                longDateFormat: { ...previous?.current.longDateFormat, ...config.longDateFormat },
                week: { ...previous?.current.week, ...config.week },
            },
        });
    }
}

// Intl provides field order and punctuation; Skulpt formats and parses the
// resulting Python pattern using the same LC_TIME as application Python.
function intlPattern(tag: string, fields: Intl.DateTimeFormatOptions): string {
    const fmt = new Intl.DateTimeFormat(tag, {
        calendar: "gregory",
        numberingSystem: "latn",
        timeZone: "UTC",
        ...fields,
    });
    const options = fmt.resolvedOptions();
    const directives: Record<string, string> = {
        year: "%Y",
        month:
            fields.month === "long"
                ? "%B"
                : fields.month === "short"
                  ? "%b"
                  : fields.month === "2-digit"
                    ? "%m"
                    : "%-m",
        day: fields.day === "2-digit" ? "%d" : "%-d",
        weekday: fields.weekday === "long" ? "%A" : "%a",
        hour: options.hour12 ? (options.hour === "2-digit" ? "%I" : "%-I") : options.hour === "2-digit" ? "%H" : "%-H",
        minute: "%M",
        second: "%S",
        dayPeriod: "%p",
        dayperiod: "%p", // Chrome before 71 used this spelling.
    };
    return fmt
        .formatToParts(new Date(Date.UTC(2001, 10, 22, 15, 44, 55)))
        .map((part) =>
            part.type === "literal" ? part.value.replaceAll("%", "%%").replaceAll("\u202f", " ") : directives[part.type]
        )
        .join("");
}

export function datePickerLocale(): DatePickerLocale {
    const mod = localeModule();
    const locale = mod.$getLocale();
    const values = overrides.get(mod);
    const name = (locale.tag ?? "en").toLowerCase();
    const custom = values?.get(name)?.current ?? values?.get(name.split("-")[0])?.current ?? noOverrides;
    const cached = localeCache.get(locale);
    if (cached?.custom === custom && cached.name === name) return cached;
    const names = (pattern: string, count: number, dates: (i: number) => Date) =>
        Array.from({ length: count }, (_, i) => locale.strftime(pattern, dates(i)));
    const months = Array.isArray(custom.months) ? custom.months : names("%B", 12, (i) => new Date(2001, i, 1));
    const daysOfWeek = Array.isArray(custom.weekdaysMin)
        ? custom.weekdaysMin
        : locale.tag
          ? names("%a", 7, (i) => new Date(2001, 0, 7 + i))
          : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const weekRules = name === "en" ? { firstDay: 0, minimalDays: 1 } : datePickerWeekRules(name);
    const firstDay = custom.week?.dow ?? weekRules.firstDay;
    const minimalDays = custom.week?.doy === undefined ? weekRules.minimalDays : 7 + firstDay - custom.week.doy;
    // English/C does not require browser locale APIs.
    const formats: Record<string, string> = {
        LT: "%-I:%M %p",
        LTS: "%-I:%M:%S %p",
        L: "%m/%d/%Y",
        l: "%-m/%-d/%Y",
        LL: "%B %-d, %Y",
        ll: "%b %-d, %Y",
        LLL: "%B %-d, %Y %-I:%M %p",
        lll: "%b %-d, %Y %-I:%M %p",
        LLLL: "%A, %B %-d, %Y %-I:%M %p",
        llll: "%a, %b %-d, %Y %-I:%M %p",
    };
    if (locale.tag) {
        const tag = locale.tag;
        Object.assign(formats, {
            LT: intlPattern(tag, { hour: "numeric", minute: "2-digit" }),
            LTS: intlPattern(tag, { hour: "numeric", minute: "2-digit", second: "2-digit" }),
            L: intlPattern(tag, { year: "numeric", month: "2-digit", day: "2-digit" }),
            l: intlPattern(tag, { year: "numeric", month: "numeric", day: "numeric" }),
        });
        for (const [alias, month, day] of [
            ["LL", "long", "numeric"],
            ["ll", "short", "numeric"],
        ] as const) {
            const fields: Intl.DateTimeFormatOptions = { year: "numeric", month, day };
            formats[alias] = intlPattern(tag, fields);
            formats[alias + alias[0]] = intlPattern(tag, { ...fields, hour: "numeric", minute: "2-digit" });
            formats[alias + alias] = intlPattern(tag, {
                ...fields,
                weekday: alias === "LL" ? "long" : "short",
                hour: "numeric",
                minute: "2-digit",
            });
        }
    }
    for (const [alias, pattern] of Object.entries(custom.longDateFormat ?? {})) {
        formats[alias] = toPythonDateFormat(pattern, formats);
    }
    for (const lower of ["l", "ll", "lll", "llll"]) {
        const upper = custom.longDateFormat?.[lower.toUpperCase()];
        if (upper && !custom.longDateFormat?.[lower]) {
            const shortened = upper.replace(/\[[^\]]*\]|MMMM|MM|DD|dddd/g, (token) =>
                token[0] === "[" ? token : token.slice(1)
            );
            formats[lower] = toPythonDateFormat(shortened, formats);
        }
    }
    const result = { name, months, daysOfWeek, firstDay, minimalDays, formats, custom };
    localeCache.set(locale, result);
    return result;
}

export function dateFormat(format: string): string {
    return toPythonDateFormat(format, datePickerLocale().formats);
}

function pythonDatetime(date: Date): pyObject {
    const fields = [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
        date.getMilliseconds() * 1000,
    ].map((x) => toPy(x));
    fields.push(pyCall(tzMod.tzoffset, [], ["minutes", toPy(-date.getTimezoneOffset())]));
    return pyCall(datetimeMod.datetime as pyType, fields);
}
export function pythonDateToDate(date: pyObject): Date {
    const iso = pyCall(date.tp$getattr<pyCallable>(new pyStr("isoformat"))).toString();
    return new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
}

export function formatPickerDate(date: Date, format: string): string {
    const locale = datePickerLocale();
    const custom = locale.custom;
    const substitutions: Record<string, string | undefined> = {
        a: custom.weekdaysShort?.[date.getDay()],
        A: custom.weekdays?.[date.getDay()],
        b: custom.monthsShort?.[date.getMonth()],
        B: custom.months?.[date.getMonth()],
    };
    const isoWeek = weekOfYear(date, { firstDay: 1, minimalDays: 4 });
    const isoFields: Record<string, number> = {
        G: isoWeek.year,
        g: isoWeek.year % 100,
        V: isoWeek.week,
        u: date.getDay() || 7,
    };
    const localWeek = weekOfYear(date, locale);
    const pattern = format.replace(
        /%%|%\{(week|weekYear|localeDay|ordinal|quarter)(:02)?\}|%([-_0]?)([GVgu])|%([123])f|%[aAbB]/g,
        (token, localField, padding, flag, field, fraction) => {
            if (token === "%%") return token;
            if (localField === "ordinal") return ordinal(date.getDate(), custom).replaceAll("%", "%%");
            if (localField === "quarter") return String(Math.floor(date.getMonth() / 3) + 1);
            if (localField) {
                const value =
                    localField === "localeDay"
                        ? (date.getDay() - locale.firstDay + 7) % 7
                        : localField === "week"
                          ? localWeek.week
                          : padding
                            ? localWeek.year % 100
                            : localWeek.year;
                return String(value).padStart(padding ? 2 : 1, "0");
            }
            if (fraction) return String(date.getMilliseconds()).padStart(3, "0").slice(0, Number(fraction));
            if (field)
                return String(isoFields[field]).padStart(
                    flag === "-" || field === "u" ? 1 : field === "G" ? 4 : 2,
                    "0"
                );
            return substitutions[token[1]]?.replaceAll("%", "%%") ?? token;
        }
    );
    const result = pyCall(pythonDatetime(date).tp$getattr<pyCallable>(new pyStr("strftime")), [
        new pyStr(pattern),
    ]).toString();
    return custom.postformat ? custom.postformat(result) : result;
}

export function parsePickerDate(input: string, format: string): Date {
    const locale = datePickerLocale();
    const custom = locale.custom;
    if (custom.preparse) input = custom.preparse(input);
    try {
        input = parseCustomNames(input, format, custom);
        const fields = localeWeekFields(matchDateFormat(input, format) ?? []);
        // strptime accepts padded and unpadded numeric input, but not strftime's flags.
        let parseFormat = format.replace(
            /%%|%\{(week|weekYear|localeDay)(:02)?\}|%[-_0]([A-Za-z])|%:z|%P|%[123]f|%L/g,
            (token, localField, padding, field) => {
                if (token === "%%") return token;
                if (localField)
                    return localField === "week" ? "%U" : localField === "localeDay" ? "%w" : padding ? "%y" : "%Y";
                if (field) return "%" + field;
                return token === "%P" ? "%p" : token === "%:z" ? "%z" : "%f";
            }
        );
        parseFormat = parseFormat.replace(/%\{ordinal\}/g, "%d").replace(/%\{quarter\}/g, "%m");
        // Moment accepts a calendar year with ISO week tokens and defaults a
        // missing weekday to the start of the week.
        if (/%V/.test(parseFormat) && !/%G/.test(parseFormat)) parseFormat = parseFormat.replace(/%Y/, "%G");
        let parseInput = input;
        const today = new Date();
        const parsedDirectives = (parseFormat.match(/%%|%[A-Za-z]/g) ?? []).filter((token) => token !== "%%");
        const directives = new Set(parsedDirectives);
        // Repeated fields would create duplicate named groups in strptime's regex.
        if (directives.size !== parsedDirectives.length) return parseIsoDate(input);
        const hasYear = directives.has("%Y") || directives.has("%y") || directives.has("%G");
        const hasMonth = ["%m", "%B", "%b"].some((field) => directives.has(field));
        const hasWeek = ["%U", "%V", "%W"].some((field) => directives.has(field));
        if (!hasYear) {
            parseInput += ` ${today.getFullYear()}`;
            parseFormat += hasWeek && directives.has("%V") ? " %G" : " %Y";
        }
        if (!hasWeek && !directives.has("%j")) {
            if (!hasMonth) {
                parseInput += ` ${hasYear ? 1 : today.getMonth() + 1}`;
                parseFormat += " %m";
            }
            if (!directives.has("%d")) {
                parseInput += ` ${hasYear || hasMonth ? 1 : today.getDate()}`;
                parseFormat += " %d";
            }
        }
        if (/%[UV]/.test(parseFormat) && !/%[wauA]/.test(parseFormat)) {
            parseInput += " 1";
            parseFormat += " %u";
        }
        const strptime = (datetimeMod.datetime as pyType).tp$getattr<pyCallable>(new pyStr("strptime"));
        let parsed = pyCall(strptime, [new pyStr(parseInput), new pyStr(parseFormat)]);
        if (fields.weekday) {
            const [token, expected] = fields.weekday;
            const actual = pyCall(parsed.tp$getattr<pyCallable>(new pyStr("strftime")), [new pyStr(token)]).toString();
            if (token === "%w" ? Number(actual) !== Number(expected) : actual.toLowerCase() !== expected.toLowerCase())
                return parseIsoDate(input);
        }
        if (directives.has("%V")) {
            const year = fields.year ?? today.getFullYear();
            const rule = { firstDay: 1, minimalDays: 4 };
            const count =
                (weekYearStart(year + 1, rule).getTime() - weekYearStart(year, rule).getTime()) / (7 * 86400000);
            if (fields.isoWeek !== undefined && (fields.isoWeek < 1 || fields.isoWeek > count)) return new Date(NaN);
        }
        if (format.includes("%{week") && !directives.has("%V")) {
            if (fields.week !== undefined) {
                const year = fields.year ?? Number(parsed.tp$getattr<pyObject>(new pyStr("year")).toString());
                const start = weekYearStart(year, locale);
                const weeksInYear = (weekYearStart(year + 1, locale).getTime() - start.getTime()) / (7 * 86400000);
                if (fields.week < 1 || fields.week > weeksInYear) return new Date(NaN);
                const hasDay = ["%w", "%a", "%A", "%u"].some((token) => directives.has(token));
                const weekday = Number(pyCall(parsed.tp$getattr<pyCallable>(new pyStr("weekday"))).toString());
                const dayFromDate = (weekday + 1 - locale.firstDay + 7) % 7;
                const day = fields.day ?? (hasDay ? dayFromDate : 0);
                start.setUTCDate(start.getUTCDate() + (fields.week - 1) * 7 + day);
                // Adjust the parsed calendar before converting its time zone.
                parsed = pyCall(parsed.tp$getattr<pyCallable>(new pyStr("replace")), [], [
                    "year", toPy(start.getUTCFullYear()),
                    "month", toPy(start.getUTCMonth() + 1),
                    "day", toPy(start.getUTCDate()),
                ]);
            }
        }
        return pythonDateToDate(parsed);
    } catch (e) {
        if (!(e instanceof Sk.builtin.ValueError)) throw e;
        return parseIsoDate(input);
    }
}

// Moment accepted ISO input independently of the displayed format. Normalise
// its date/offset/fraction spellings before asking Python to validate the value.
function parseIsoDate(input: string): Date {
    const datetime = datetimeMod.datetime as pyType;
    const strptime = datetime.tp$getattr<pyCallable>(new pyStr("strptime"));
    const fromIso = datetime.tp$getattr<pyCallable>(new pyStr("fromisoformat"));
    const parts = /^([^T ]+)([T ].*)?$/.exec(input);
    if (!parts) return new Date(NaN);
    let date = parts[1];
    let time = parts[2] ?? "T00:00:00";
    try {
        const week = /^(\d{4})-?W(\d\d)(?:-?([1-7]))?$/.exec(date);
        const ordinal = /^(\d{4})-?(\d{3})$/.exec(date);
        if (week || ordinal) {
            const value = week ? `${week[1]}-W${week[2]}-${week[3] ?? 1}` : `${ordinal![1]}-${ordinal![2]}`;
            const pattern = week ? "%G-W%V-%u" : "%Y-%j";
            date = pyCall(
                pyCall(strptime, [new pyStr(value), new pyStr(pattern)]).tp$getattr<pyCallable>(new pyStr("isoformat"))
            )
                .toString()
                .slice(0, 10);
        } else if (/^\d{8}$/.test(date)) date = date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6);
        else if (/^\d{4}(?:-\d\d)?$/.test(date)) date += date.length === 4 ? "-01-01" : "-01";
        if (!/^\d{4}-\d\d-\d\d$/.test(date)) return new Date(NaN);
        time = time
            .replace(/Z$/i, "+00:00")
            .replace(/([+-]\d\d)(\d\d)$/, "$1:$2")
            .replace(/([+-]\d\d)$/, "$1:00");
        time = time.replace(
            /^([T ])(\d\d)(\d\d)(\d\d)?(?=[.,+-]|$)/,
            (_match, separator, hour, minute, second) => `${separator}${hour}:${minute}${second ? ":" + second : ""}`
        );
        time = time.replace(/[.,](\d+)/, (_match, fraction: string) => "." + fraction.slice(0, 6).padEnd(6, "0"));
        if (/^[T ]24:00(?::00(?:\.0+)?)?(?:[+-].*)?$/.test(time)) {
            pyCall(fromIso, [new pyStr(date + "T00:00:00")]);
            const next = utcDate(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8)) + 1);
            date = next.toISOString().slice(0, 10);
            time = time.replace("24:00", "00:00");
        }
        return pythonDateToDate(pyCall(fromIso, [new pyStr(date + time)]));
    } catch (e) {
        if (!(e instanceof Sk.builtin.ValueError)) throw e;
        return new Date(NaN);
    }
}

function utcDate(year: number, month: number, day: number): Date {
    const date = new Date(0);
    date.setUTCFullYear(year, month, day);
    return date;
}
function weekYearStart(year: number, locale: Pick<DatePickerLocale, "firstDay" | "minimalDays">): Date {
    const start = utcDate(year, 0, 1);
    const precedingDays = (start.getUTCDay() - locale.firstDay + 7) % 7;
    start.setUTCDate(1 - precedingDays + (7 - precedingDays < locale.minimalDays ? 7 : 0));
    return start;
}
function weekOfYear(date: Date, locale: Pick<DatePickerLocale, "firstDay" | "minimalDays">) {
    const day = utcDate(date.getFullYear(), date.getMonth(), date.getDate());
    let year = date.getFullYear();
    if (day < weekYearStart(year, locale)) year--;
    else if (day >= weekYearStart(year + 1, locale)) year++;
    return { year, week: Math.floor((day.getTime() - weekYearStart(year, locale).getTime()) / (7 * 86400000)) + 1 };
}

// Capture Moment's week conventions and calendar weekday consistency checks
// that strptime does not implement.
function localeWeekFields(
    matched: Array<readonly [string, string]>
): { year?: number; week?: number; day?: number; isoWeek?: number; weekday?: readonly [string, string] } {
    const fields: { year?: number; week?: number; day?: number; isoWeek?: number; weekday?: readonly [string, string] } = {};
    for (const [token, value] of matched) {
        if (token === "%Y" || token === "%G" || token === "%{weekYear}") fields.year = Number(value);
        if (token === "%y" || token === "%{weekYear:02}")
            fields.year = Number(value) + (Number(value) > 68 ? 1900 : 2000);
        if (token === "%{week}" || token === "%{week:02}") fields.week = Number(value);
        if (token === "%{localeDay}") fields.day = Number(value);
        if (token === "%V" || token === "%-V") fields.isoWeek = Number(value);
        if (/^%[-_0]?[waA]$/.test(token)) fields.weekday = ["%" + token.slice(-1), value];
    }
    return fields;
}

function parseCustomNames(input: string, format: string, custom: MomentLocaleOverrides): string {
    const names: Record<string, string[] | undefined> = {
        a: custom.weekdaysShort,
        A: custom.weekdays,
        b: custom.monthsShort,
        B: custom.months,
    };
    if (!Object.values(names).some(Array.isArray) && !/%\{ordinal|%\{quarter/.test(format)) return input;
    names.ordinal = Array.from({ length: 31 }, (_, i) => ordinal(i + 1, custom));
    names.quarter = ["1", "2", "3", "4"];
    const patterns: Record<string, string> = {};
    for (const [field, values] of Object.entries(names)) {
        if (!Array.isArray(values)) continue;
        const token = field.length === 1 ? "%" + field : `%{${field}}`;
        patterns[token] = values
            .map(escapeDatePattern)
            .sort((a, b) => b.length - a.length)
            .join("|");
    }
    const matched = matchDateFormat(input, format, patterns);
    if (!matched) return input;
    return matched
        .map(([token, text]) => {
            const field = token[1] === "{" ? token.slice(2, -1) : token[1];
            const customNames = names[field];
            if (token[0] !== "%" || !Array.isArray(customNames)) return text;
            const index = customNames.findIndex((name) => name.toLowerCase() === text.toLowerCase());
            if (field === "ordinal") return String(index + 1);
            if (field === "quarter") return String(index * 3 + 1);
            const sample =
                token[1] === "a" || token[1] === "A" ? new Date(2001, 0, 7 + index) : new Date(2001, index, 1);
            return localeModule().$strftime(token, sample);
        })
        .join("");
}

function escapeDatePattern(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchDateFormat(
    input: string,
    format: string,
    patterns: Record<string, string> = {}
): Array<readonly [string, string]> | null {
    const tokens = dateFormatParts(format);
    const numeric: Record<string, string> = {
        "%Y": "\\d{4}",
        "%G": "\\d{4}",
        "%{weekYear}": "\\d{4}",
        "%y": "\\d{2}",
        "%{weekYear:02}": "\\d{2}",
        "%{week:02}": "\\d{2}",
        "%{week}": "\\d{1,2}",
        "%{localeDay}": "\\d{1,2}",
        "%V": "\\d{1,2}",
        "%-V": "\\d{1,2}",
    };
    const pattern = tokens
        .map((token) => {
            const part =
                patterns[token] ??
                numeric[token] ??
                (token === "%%" ? "%" : token[0] === "%" ? ".+?" : escapeDatePattern(token).replace(/\s+/g, "\\s+"));
            return `(${part})`;
        })
        .join("");
    const match = new RegExp(`^${pattern}$`, "iu").exec(input);
    return match ? tokens.map((token, i) => [token, match[i + 1]] as const) : null;
}

function dateFormatParts(format: string): string[] {
    return format.match(/%%|%\{[^}]+\}|%[123]f|%[-_0:]?[A-Za-z]|[^%]+|%/g) ?? [];
}

function ordinal(number: number, custom: MomentLocaleOverrides): string {
    if (typeof custom.ordinal === "function") return custom.ordinal(number, "D");
    if (typeof custom.ordinal === "string") return custom.ordinal.replace("%d", String(number));
    const tag = localeModule().$getLocale().tag;
    if (tag && !tag.startsWith("en")) return String(number);
    const lastTwo = number % 100;
    const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] ?? "th");
    return number + suffix;
}
