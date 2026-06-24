import { describe, it, expect } from "@rstest/core";
import { parseLayoutForm, serializeFormLayout } from "@anvil-works/form-template-parser";
import {
    normalizeComponentsBySlot,
    normalizeDropzoneNames,
    normalizeMultiline,
    normalizeSlots,
    stripDropzoneIdsFromComponents,
} from "./test-utils";

describe("parseLayoutHtml recovery", () => {
    it("auto-wraps markup without an <anvil-form> root", () => {
        const html = `<section class="wrapper">
    <p>Hello</p>
</section>`;

        const parsed = parseLayoutForm(html);
        expect(parsed.layout).toEqual({ type: "UnknownLayout" });

        const blockNames = Object.keys(parsed.components_by_slot);
        expect(blockNames).toHaveLength(1);
        expect(blockNames[0]).toMatch(/^\$unknown-slot-/);

        const fallbackComponents = parsed.components_by_slot[blockNames[0]];
        expect(fallbackComponents).toHaveLength(1);
        const fragment = fallbackComponents[0];
        expect(fragment.type).toBe("HtmlComponent");
        expect(normalizeDropzoneNames(normalizeMultiline(fragment.properties?.html ?? "")))
            .toBe(`<section class="wrapper">
<p>Hello</p>
</section>`);
    });

    it("generates slot names for blocks without a name", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <anvil-block>
        <anvil-component type="Label" name="auto"></anvil-component>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);
        const blockNames = Object.keys(parsed.components_by_slot);
        expect(blockNames).toHaveLength(1);
        expect(blockNames[0]).toMatch(/^\$unknown-slot-/);

        const normalized = normalizeComponentsBySlot(stripDropzoneIdsFromComponents(parsed.components_by_slot));
        expect(normalized[blockNames[0]]?.[0]?.type).toBe("Label");
    });

    it("renames duplicate block names with a deterministic suffix", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <anvil-block slot="main">
        <anvil-component type="Label" name="first"></anvil-component>
    </anvil-block>
    <anvil-block slot="main">
        <anvil-component type="Label" name="second"></anvil-component>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);
        const blockNames = Object.keys(parsed.components_by_slot);
        expect(blockNames).toContain("main");
        expect(blockNames).toContain("main_copy_1");

        const normalized = normalizeComponentsBySlot(stripDropzoneIdsFromComponents(parsed.components_by_slot));
        expect(normalized.main?.[0]?.name).toBe("first");
        expect(normalized.main_copy_1?.[0]?.name).toBe("second");
    });

    it("converts unexpected direct children into fallback slots", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <header>Heading</header>
    <anvil-block slot="body">
        <p>Body</p>
    </anvil-block>
    <footer>Footer</footer>
</anvil-form>`;

        const parsed = parseLayoutForm(html);
        const blockNames = Object.keys(parsed.components_by_slot);
        expect(blockNames).toContain("body");

        const unknownBlocks = blockNames.filter((name) => name.startsWith("$unknown-slot-"));
        expect(unknownBlocks.length).toBe(2);

        const normalized = normalizeComponentsBySlot(stripDropzoneIdsFromComponents(parsed.components_by_slot));
        expect(
            normalizeDropzoneNames(normalizeMultiline(normalized[unknownBlocks[0]]?.[0]?.properties?.html ?? ""))
        ).toContain("Heading");
        expect(
            normalizeDropzoneNames(normalizeMultiline(normalized[unknownBlocks[1]]?.[0]?.properties?.html ?? ""))
        ).toContain("Footer");
    });

    it("demotes additional <anvil-form> roots to fallback slots", () => {
        const html = `<anvil-form layout="form:layouts.one">
    <anvil-block slot="main"></anvil-block>
</anvil-form>
<anvil-form layout="form:layouts.two">
    <anvil-block slot="secondary">
        <p>Secondary</p>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);
        const blockNames = Object.keys(parsed.components_by_slot);
        expect(blockNames).toContain("main");

        const fallbackName = blockNames.find((name) => name.startsWith("$unknown-slot-"));
        expect(fallbackName).toBeDefined();

        const normalized = normalizeComponentsBySlot(stripDropzoneIdsFromComponents(parsed.components_by_slot));
        expect(
            normalizeDropzoneNames(normalizeMultiline(normalized[fallbackName!]?.[0]?.properties?.html ?? ""))
        ).toContain("form:layouts.two");
    });

    it("captures content that precedes the <anvil-form> root", () => {
        const html = `<p class="lead">Intro</p>
<anvil-form layout="form:layouts.main">
    <anvil-block slot="main"></anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);
        const blockNames = Object.keys(parsed.components_by_slot);
        expect(blockNames).toContain("main");

        const fallbackName = blockNames.find((name) => name.startsWith("$unknown-slot-"));
        expect(fallbackName).toBeDefined();

        const normalized = normalizeComponentsBySlot(stripDropzoneIdsFromComponents(parsed.components_by_slot));
        expect(
            normalizeDropzoneNames(normalizeMultiline(normalized[fallbackName!]?.[0]?.properties?.html ?? ""))
        ).toContain("Intro");
    });

    it("preserves slot metadata when recovering from malformed blocks", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <div>
        <anvil-slot name="extra"></anvil-slot>
    </div>
</anvil-form>`;

        const parsed = parseLayoutForm(html);
        const blockNames = Object.keys(parsed.components_by_slot);
        expect(blockNames).toHaveLength(1);
        const fallbackName = blockNames[0];
        expect(fallbackName).toMatch(/^\$unknown-slot-/);

        const normalizedSlots = normalizeSlots(parsed.slots);
        expect(normalizedSlots.extra).toBeDefined();
        expect(normalizedSlots.extra.index).toBe(0);
        expect(normalizedSlots.extra.set_layout_properties).toEqual({ dropzone: "<dropzone>" });
        expect(normalizedSlots.extra.target.type).toBe("container");
        expect(normalizedSlots.extra.target.name).toMatch(/^\$component_/);
    });

    it("omits empty $unknown blocks from serialized HTML", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <p class="intro">Outside blocks</p>
    <anvil-block slot="main">
        <anvil-component type="Label" name="lbl"></anvil-component>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);

        const componentsBySlot = { ...parsed.components_by_slot };
        const unknownSlotName = Object.keys(componentsBySlot).find((name) => name.startsWith("$unknown-slot-"));
        expect(unknownSlotName).toBeDefined();
        componentsBySlot[unknownSlotName!] = [];

        const serialized = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: componentsBySlot,
            slots: parsed.slots,
        });

        expect(serialized).not.toContain(unknownSlotName!);
        expect(serialized).toContain('<anvil-block slot="main">');
        expect(serialized).not.toContain("Outside blocks");

        const reparsed = parseLayoutForm(serialized);
        expect(Object.keys(reparsed.components_by_slot)).not.toContain(unknownSlotName);
    });

    it("retains empty $unknown blocks when slots target them", () => {
        const serialized = serializeFormLayout({
            layout: { type: "form:layouts.main" },
            components_by_slot: {
                "$unknown-slot-1": [],
            },
            slots: {
                orphan: {
                    target: { type: "slot", name: "$unknown-slot-1" },
                    index: 0,
                    set_layout_properties: { dropzone: "dz-1" },
                },
            },
        });

        expect(serialized).toContain('<anvil-block slot="$unknown-slot-1">');
    });
});
