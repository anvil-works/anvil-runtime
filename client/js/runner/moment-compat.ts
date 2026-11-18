import {
    MomentLocaleOverrides,
    momentLocaleName,
    datePickerLocale,
    defineDateLocale,
    setDateLocale,
    updateDateLocale,
} from "@runtime/components/date-picker-dates";
import { warn } from "./warnings";

// Old apps used this global to localise DatePicker. Keep that route working
// while warning about removed Moment APIs; remove after their migration period.
export function installMomentCompatibility() {
    const target = window as Window & { moment?: unknown };
    if (target.moment != null) return;
    const warning = (path: string) =>
        warn(
            `${path} is deprecated: Anvil no longer includes Moment.js.`,
            {
                key: `moment:${path}`,
                docUrl: "/editor/common-errors#moment-localisation-warnings",
                docLinkTitle: "How to update Moment date code",
            }
        );
    const localeData = () => {
        const locale = datePickerLocale();
        return {
            firstDayOfWeek: () => locale.firstDay,
            weekdaysMin: () => locale.daysOfWeek,
            months: () => locale.months,
            longDateFormat: placeholder("moment.localeData.longDateFormat"),
        };
    };
    const methods = {
        locale(name?: string) {
            warning("moment.locale");
            return name === undefined ? momentLocaleName() : setDateLocale(name);
        },
        defineLocale(name: string, config: MomentLocaleOverrides | null) {
            warning("moment.defineLocale");
            defineDateLocale(name, config);
            if (config === null) return null;
            setDateLocale(name);
            return localeData();
        },
        updateLocale(name: string, config: MomentLocaleOverrides | null) {
            warning("moment.updateLocale");
            updateDateLocale(name, config);
            setDateLocale(name);
            return localeData();
        },
        localeData() {
            warning("moment.localeData");
            return localeData();
        },
    };
    const placeholder = (path: string): object =>
        new Proxy(function () {}, {
            get(_target, property) {
                // A placeholder must not become a thenable or obstruct JS/Python
                // inspection and primitive conversion.
                if (property === "then") return undefined;
                if (property === Symbol.toPrimitive) return () => "";
                if (typeof property === "symbol") return undefined;
                if (path === "moment" && Object.hasOwn(methods, property))
                    return methods[property as keyof typeof methods];
                return placeholder(`${path}.${property}`);
            },
            apply() {
                warning(path);
                return placeholder(path);
            },
            construct() {
                // anvil.js can classify wrapped functions as constructors.
                warning(path);
                return placeholder(path);
            },
        });
    target.moment = placeholder("moment");
}
