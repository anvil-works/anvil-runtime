import { describe, expect, it } from "@rstest/core";
import { columnResizeDelta, snapWidthDelta } from "../../../../platform/runtime-client/js/designer/geometry";

describe("designer resize compatibility", () => {
    it("snaps XY widths only within five pixels and preserves the first edge on a tie", () => {
        expect(snapWidthDelta(100, 20, [125, 115])).toBe(25);
        expect(snapWidthDelta(100, 20, [126, 114])).toBe(20);
        expect(snapWidthDelta(100, 20, [125, 121])).toBe(21);
        expect(snapWidthDelta(100, -20, [77])).toBe(-23);
    });
    it("snaps column boundaries relative to earlier columns, with fine control", () => {
        const options = { pixelsPerColumn: 10, offset: 13, weight: 17, nextWeight: 30, fine: false };
        expect(columnResizeDelta(30, options)).toBe(5);
        expect(columnResizeDelta(30, { ...options, fine: true })).toBe(3);
    });
    it("keeps both resized columns at least thirty pixels wide", () => {
        const options = { pixelsPerColumn: 10, offset: 0, weight: 20, nextWeight: 40, fine: true };
        expect(columnResizeDelta(-1000, options)).toBe(-17);
        expect(columnResizeDelta(1000, options)).toBe(37);
    });
});
