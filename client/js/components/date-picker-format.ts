// Accept both the historical Moment syntax and Python directives. Scan once so
// translated directives and escaped literal text cannot be interpreted again.
// %{...} markers retain Moment-only conventions for date-picker-dates to handle.
const momentTokens: Record<string, string> = {
    YYYY: "%Y",
    YY: "%y",
    MMMM: "%B",
    MMM: "%b",
    MM: "%m",
    M: "%-m",
    DDDD: "%j",
    DDD: "%-j",
    DD: "%d",
    Do: "%{ordinal}",
    D: "%-d",
    Q: "%{quarter}",
    dddd: "%A",
    ddd: "%a",
    d: "%w",
    e: "%{localeDay}",
    E: "%u",
    HH: "%H",
    H: "%-H",
    hh: "%I",
    h: "%-I",
    mm: "%M",
    m: "%-M",
    ss: "%S",
    s: "%-S",
    A: "%p",
    a: "%P",
    SSS: "%3f",
    SS: "%2f",
    S: "%1f",
    ZZ: "%z",
    Z: "%:z",
    ww: "%{week:02}",
    w: "%{week}",
    WW: "%V",
    W: "%-V",
    GGGG: "%G",
    GG: "%g",
    gggg: "%{weekYear}",
    gg: "%{weekYear:02}",
};
const aliases = ["LTS", "LT", "LLLL", "LLL", "LL", "L", "llll", "lll", "ll", "l"];
const tokens = [...Object.keys(momentTokens), ...aliases].sort((a, b) => b.length - a.length);
const tokenPattern = new RegExp(`\\[[^\\]]*\\]|\\\\[\\s\\S]|%[-_0]?[a-zA-Z%]|${tokens.join("|")}|[\\s\\S]`, "g");

export function toPythonDateFormat(format: string, localeFormats: Record<string, string>): string {
    return (format.match(tokenPattern) ?? [])
        .map((token) => {
            if (token.startsWith("[")) return token.slice(1, -1).replaceAll("%", "%%");
            if (token.startsWith("\\")) return token.slice(1).replaceAll("%", "%%");
            if (token.startsWith("%")) {
                // These aliases have always meant Moment's locale formats in DatePicker.
                const alias = { "%x": "L", "%X": "LT", "%c": "llll" }[token];
                return (
                    localeFormats[alias ?? ""] ??
                    { "%U": "%{week:02}", "%W": "%V", "%w": "%{localeDay}" }[token] ??
                    token
                );
            }
            return localeFormats[token] ?? momentTokens[token] ?? token.replaceAll("%", "%%");
        })
        .join("");
}
