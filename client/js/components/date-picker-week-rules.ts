interface WeekRule {
    firstDay: number;
    minimalDays: number;
}
interface NativeWeekInfo {
    firstDay: number;
    minimalDays?: number;
}
const englishWeekRules = { firstDay: 0, minimalDays: 1 };

export function datePickerWeekRules(tag: string): WeekRule {
    if (typeof Intl === "undefined" || typeof Intl.Locale !== "function") return englishWeekRules;
    const locale = new Intl.Locale(tag) as {
        getWeekInfo?: () => NativeWeekInfo;
        weekInfo?: NativeWeekInfo;
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    return info ? { firstDay: info.firstDay % 7, minimalDays: info.minimalDays ?? 1 } : englishWeekRules;
}
