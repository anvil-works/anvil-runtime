import { describe, expect, it } from "@rstest/core";
import { isOpaqueScriptError } from "@runtime/runner/py-util/error-utils";

describe("isOpaqueScriptError", () => {
    it("suppresses only empty opaque Script error reports", () => {
        expect(isOpaqueScriptError("Script error.", undefined, undefined, undefined, undefined)).toBe(true);
        expect(isOpaqueScriptError("Script error.", "", 0, 0, null)).toBe(true);
    });

    it("preserves Script error reports with useful debugging context", () => {
        expect(isOpaqueScriptError("Script error.", "https://example.com/native-lib.js", 12, 3, null)).toBe(false);
        expect(isOpaqueScriptError("Script error.", "", 0, 0, new Error("Native library failed"))).toBe(false);
    });

    it("preserves non-opaque errors", () => {
        expect(
            isOpaqueScriptError("ReferenceError: missingValue is not defined", undefined, undefined, undefined, null)
        ).toBe(false);
    });
});
