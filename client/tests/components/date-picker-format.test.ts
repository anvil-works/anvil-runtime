import { expect, it } from "@rstest/core";
import { toPythonDateFormat } from "../../js/components/date-picker-format";

it("keeps both established date-format syntaxes, including mixed formats and literals", () => {
    for (const [input, expected] of [
        ["YYYY-MM-DD", "%Y-%m-%d"],
        ["YY-MMM-DD", "%y-%b-%d"],
        ["MMMM-ddd-hh", "%B-%a-%I"],
        ["%Y-%m-%d", "%Y-%m-%d"],
        ["%Y-MM-DD [at] HH:mm", "%Y-%m-%d at %H:%M"],
        ["YYYY [100%] \\M", "%Y 100%% M"],
    ])
        expect(toPythonDateFormat(input, {})).toBe(expected);
});

it("expands the historical locale aliases without retokenising their Python patterns", () => {
    const locale = { L: "%d.%m.%Y", LT: "%H:%M", llll: "%a, %-d %b %Y %H:%M" };
    expect(toPythonDateFormat("L LT", locale)).toBe("%d.%m.%Y %H:%M");
    expect(toPythonDateFormat("%x %X %c", locale)).toBe("%d.%m.%Y %H:%M %a, %-d %b %Y %H:%M");
});
