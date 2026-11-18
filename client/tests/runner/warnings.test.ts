import { afterEach, expect, it, rstest } from "@rstest/core";
import { setWarningHandler, warn } from "@runtime/runner/warnings";
import { provideLoggingImpl, stdout } from "../../js/runner/logging";

afterEach(() => {
    rstest.unstubAllGlobals();
    setWarningHandler(undefined);
    provideLoggingImpl(console.log);
});

it("deduplicates by key while preserving repeated unkeyed warnings", () => {
    const print = rstest.fn();
    rstest.stubGlobal("Sk", { builtin: { print } });

    warn("First warning", { key: "first" });
    warn("Changed message with the same key", { key: "first" });
    warn("First warning", { key: "second" });
    warn("Warning: unkeyed");
    warn("Warning: unkeyed");

    expect(print.mock.calls).toEqual([
        [["Warning: First warning"]],
        [["Warning: First warning"]],
        [["Warning: unkeyed"]],
        [["Warning: unkeyed"]],
    ]);
});

it("prints the documentation URL outside the IDE", () => {
    const print = rstest.fn();
    rstest.stubGlobal("Sk", { builtin: { print } });

    warn("Update your map.", { docUrl: "/editor/common-errors#plotly-mapbox-warnings" });

    expect(print).toHaveBeenCalledWith([
        "Warning: Update your map. See https://anvil.works/docs/editor/common-errors#plotly-mapbox-warnings",
    ]);
});

it("sends a linked warning to the IDE once, retaining app logs without duplicate stdout", () => {
    const print = rstest.fn();
    const log = rstest.fn();
    const onWarning = rstest.fn();
    rstest.stubGlobal("Sk", { builtin: { print } });
    provideLoggingImpl(log);
    setWarningHandler((warning) => {
        // The IDE handler flushes buffered stdout before displaying the warning.
        stdout("Earlier output\n");
        onWarning(warning);
    });

    for (let i = 0; i < 2; i++) {
        warn("Update your map.", {
            key: "linked-map-warning",
            docUrl: "/editor/common-errors#plotly-mapbox-warnings",
            docLinkTitle: "How to update your map",
        });
    }

    expect(onWarning.mock.calls).toEqual([
        [
            {
                message: "Warning: Update your map.",
                docUrl: "/editor/common-errors#plotly-mapbox-warnings",
                docLinkTitle: "How to update your map",
            },
        ],
    ]);
    expect(log.mock.calls).toEqual([
        [{ print: "Earlier output\n" }],
        [
            {
                print: "Warning: Update your map. See https://anvil.works/docs/editor/common-errors#plotly-mapbox-warnings\n",
            },
        ],
    ]);
    expect(print).not.toHaveBeenCalled();
});
