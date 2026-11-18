import { expect, it } from "@rstest/core";
import { datePickerWeekRules } from "../../js/components/date-picker-week-rules";

it("uses complete native week information directly", () => {
    const original = Intl.Locale;
    try {
        class CompleteLocale extends original {
            getWeekInfo() {
                return { firstDay: 2, minimalDays: 3, weekend: [6, 7] };
            }
        }
        Object.defineProperty(Intl, "Locale", { value: CompleteLocale, configurable: true });
        expect(datePickerWeekRules("en-US")).toEqual({ firstDay: 2, minimalDays: 3 });
    } finally {
        Object.defineProperty(Intl, "Locale", { value: original, configurable: true });
    }
});

it("uses English week defaults without browser locale APIs", () => {
    const original = globalThis.Intl;
    try {
        Object.defineProperty(globalThis, "Intl", { value: undefined, configurable: true });
        expect(datePickerWeekRules("de-DE")).toEqual({ firstDay: 0, minimalDays: 1 });
        Object.defineProperty(globalThis, "Intl", { value: { ...original, Locale: undefined }, configurable: true });
        expect(datePickerWeekRules("de-DE")).toEqual({ firstDay: 0, minimalDays: 1 });
    } finally {
        Object.defineProperty(globalThis, "Intl", { value: original, configurable: true });
    }
});

it("uses native first weekdays and defaults for missing week-number information", () => {
    const original = Intl.Locale;
    try {
        class PartialLocale extends original {
            getWeekInfo() {
                return { firstDay: 7, weekend: [6, 7] };
            }
        }
        Object.defineProperty(Intl, "Locale", { value: PartialLocale, configurable: true });
        expect(datePickerWeekRules("pt-PT")).toEqual({ firstDay: 0, minimalDays: 1 });
    } finally {
        Object.defineProperty(Intl, "Locale", { value: original, configurable: true });
    }
});
