import { describe, it, expect } from "@rstest/core";
import { parseContainerForm, serializeFormContainer } from "@runtime/html-form/parser";
import type { ParsedFormYaml } from "@runtime/html-form/types";
import { normalizeDropzoneNames, normalizeMultiline, normalizedHtml, expectNormalizedComponents } from "./test-utils";

function expectHtmlEqual(actual: string, expected: string) {
    expect(normalizedHtml(actual)).toBe(normalizedHtml(expected));
}

function expectSlot(parsed: ParsedFormYaml, slotName: string) {
    const slots = parsed.slots ?? {};
    const slot = slots[slotName];
    expect(slot).toBeDefined();
    const result = { ...slot! };
    if (slot?.set_layout_properties) {
        result.set_layout_properties = {
            ...slot.set_layout_properties,
            ...(slot.set_layout_properties.dropzone ? { dropzone: "<dropzone>" } : {}),
        };
    }
    return result;
}

describe("slot parsing and serialization", () => {
    it("parses top-level slots and round-trips", () => {
        const html = `<div class="layout">
    <anvil-slot name="body"></anvil-slot>
    <anvil-slot name="header"></anvil-slot>
</div>`;

        const parsed = parseContainerForm(html);

        expectHtmlEqual(
            parsed.container.properties?.html ?? "",
            `<div class="layout">
    <anvil-dropzone name="<dropzone>" data-slot="body"></anvil-dropzone>
    <anvil-dropzone name="<dropzone>" data-slot="header"></anvil-dropzone>
</div>`
        );

        expect(expectSlot(parsed, "header")).toEqual({
            target: { type: "container", name: "" },
            index: 0,
            set_layout_properties: { dropzone: "<dropzone>" },
        });

        expect(expectSlot(parsed, "body")).toEqual({
            target: { type: "container", name: "" },
            index: 0,
            set_layout_properties: { dropzone: "<dropzone>" },
        });

        const expected = `<div class="layout">
    <anvil-slot name="body"></anvil-slot>
    <anvil-slot name="header"></anvil-slot>
</div>`;
        expectHtmlEqual(serializeFormContainer(parsed), expected);
    });

    it("round trips complex slot order", () => {
        const html = `<anvil-slot name="slot_3"></anvil-slot>
<anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>
<anvil-slot name="slot_1"></anvil-slot>
<anvil-component type="Button" name="button_2" prop:text="button_2"></anvil-component>
<anvil-slot name="slot_2"></anvil-slot>
<anvil-component type="Button" name="button_3" prop:text="button_3"></anvil-component>
<anvil-slot name="slot_4"></anvil-slot>
<anvil-slot name="slot_5"></anvil-slot>`;

        const parsed = parseContainerForm(html);
        expect(parsed.slots).toMatchObject({
            slot_1: { index: 1 },
            slot_2: { index: 2 },
            slot_3: { index: 0 },
            slot_4: { index: 3 },
            slot_5: { index: 3 },
        });
        expectHtmlEqual(serializeFormContainer(parsed), html);
    });

    it("generates anonymous slot names when missing", () => {
        const html = `<div class="layout">
    <anvil-slot></anvil-slot>
    <anvil-slot></anvil-slot>
</div>`;

        const parsed = parseContainerForm(html);
        const slotNames = Object.keys(parsed.slots || {});
        expect(slotNames).toEqual(["$slot_1", "$slot_2"]);

        const serialized = serializeFormContainer(parsed);
        expect(serialized).toContain('name="$slot_1"');
        expect(serialized).toContain('name="$slot_2"');
    });

    it("handles slots inside a named container", () => {
        const html = `<div>
    <anvil-component type="LinearPanel" name="content_panel">
    <anvil-slot name="main"></anvil-slot>
</anvil-component>
</div>`;

        const parsed = parseContainerForm(html);

        expect(parsed.components).toHaveLength(1);
        expect(parsed.components?.[0]).toMatchObject({
            type: "LinearPanel",
            name: "content_panel",
            layout_properties: { dropzone: expect.stringMatching(/^\$dz_/) },
        });

        expect(expectSlot(parsed, "main")).toMatchObject({
            target: { type: "container", name: "content_panel" },
            index: 0,
            set_layout_properties: {},
        });

        expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
    });

    it("preserves slot order relative to sibling components", () => {
        const html = `<div>
    <anvil-component type="LinearPanel" name="sidebar_panel">
    <anvil-slot name="sidebar"></anvil-slot>
    <anvil-component type="Label" name="extra_label" prop:text="Extra"></anvil-component>
</anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        expect(expectSlot(parsed, "sidebar")).toMatchObject({
            target: { type: "container", name: "sidebar_panel" },
            index: 0,
            set_layout_properties: {},
        });

        expect(parsed.components?.[0]?.components).toEqual([
            {
                type: "Label",
                name: "extra_label",
                properties: { text: "Extra" },
                layout_properties: undefined,
            },
        ]);

        expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
    });

    it("supports anonymous containers with slots", () => {
        const html = `<div>
    <anvil-component type="LinearPanel">
    <anvil-slot name="body"></anvil-slot>
</anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        expect(parsed.components).toHaveLength(1);
        const container = parsed.components![0];
        expect(container.name).toBe("$component_1");

        expect(expectSlot(parsed, "body")).toMatchObject({
            target: { type: "container", name: container.name },
            index: 0,
            set_layout_properties: {},
        });

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(html));
        expect(serialized).not.toContain(`name="${container.name}"`);
    });

    it("captures slots nested inside anonymous HTML fragments", () => {
        const html = `<div>
    <anvil-component type="LinearPanel" name="panel">
    <div class="wrapper">
        <anvil-slot name="inner"></anvil-slot>
    </div>
</anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        const slot = expectSlot(parsed, "inner");
        expect(slot.target).toMatchObject({ type: "container", name: "$component_1" });
        expect(slot.set_layout_properties).toMatchObject({ dropzone: "<dropzone>" });

        const fragment = parsed.components?.[0]?.components?.[0];
        expect(fragment?.type).toBe("HtmlComponent");
        expect(normalizeDropzoneNames(normalizeMultiline(fragment?.properties?.html ?? ""))).toContain(
            '<anvil-dropzone name="<dropzone>" data-slot="inner">'
        );

        expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
    });

    it("parses slot layout properties", () => {
        const html = `<div>
    <anvil-component type="FlowPanel" name="panel">
    <anvil-slot name="inner" container:expand="true"></anvil-slot>
</anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        const slot = expectSlot(parsed, "inner");
        expect(slot.index).toBe(0);
        expect(slot.set_layout_properties).toMatchObject({ expand: true });

        const serialized = serializeFormContainer(parsed);
        expect(serialized).toContain('container:expand="true"');
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(html));
    });

    it("serializes slots that target root dropzones alongside components", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div class="layout">
    <anvil-dropzone name="dz-slot"></anvil-dropzone>
    <anvil-dropzone name="dz-component"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "primary",
                    properties: { text: "Click" },
                    layout_properties: { dropzone: "dz-component" },
                },
            ],
            slots: {
                header: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "dz-slot" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<div class="layout">
    <anvil-slot name="header"></anvil-slot>
    <anvil-component type="Button" name="primary" prop:text="Click"></anvil-component>
</div>`)
        );
    });

    it("serializes slots that target anonymous html fragments", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div class="wrapper">
    <anvil-dropzone name="dz-root"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "HtmlComponent",
                    name: "$component_1",
                    properties: {
                        html: `<section>
    <anvil-dropzone name="dz-fragment"></anvil-dropzone>
</section>`,
                    },
                    layout_properties: { dropzone: "dz-root" },
                },
            ],
            slots: {
                fragment: {
                    target: { type: "container", name: "$component_1" },
                    index: 0,
                    set_layout_properties: { dropzone: "dz-fragment" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<div class="wrapper">
    <section>
        <anvil-slot name="fragment"></anvil-slot>
    </section>
</div>`)
        );
    });

    it("preserves dropzone assignments when slots for the same target are sorted by name", () => {
        const html = `<div class="layout">
        <anvil-slot name="slot_b"></anvil-slot>
        <anvil-slot name="slot_a"></anvil-slot>
    </div>`;

        const parsed = parseContainerForm(html);

        // Slots should be sorted by name in the parsed output
        const slots = parsed.slots ?? {};
        const slotNames = Object.keys(slots);
        expect(slotNames).toEqual(["slot_a", "slot_b"]);

        // Extract the dropzone names from the fragment HTML in DOM order
        const fragmentHtml = parsed.container.properties?.html ?? "";
        const dropzoneNamesInDomOrder: string[] = [];
        for (const match of fragmentHtml.matchAll(/<anvil-dropzone name="([^"]+)" data-slot="([^"]+)"/g)) {
            dropzoneNamesInDomOrder.push(match[1]);
        }

        // Map each slot name to its dropzone from the parsed slots
        const slotDropzonesByName = slotNames.map((name) => slots[name]?.set_layout_properties?.dropzone);

        expect(slotDropzonesByName[0]).toBeDefined();
        expect(slotDropzonesByName[1]).toBeDefined();

        // The slot→dropzone mapping should match what was in the DOM, even after sorting by name
        expect(dropzoneNamesInDomOrder).toEqual(slotDropzonesByName.toReversed());
    });

    it("orders slots sharing a dropzone by index then name when serializing", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<anvil-dropzone name="dz-shared"></anvil-dropzone>`,
                },
            },
            components: [],
            slots: {
                beta: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "dz-shared" },
                },
                alpha: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "dz-shared" },
                },
                gamma: {
                    target: { type: "container", name: "" },
                    index: 1,
                    set_layout_properties: { dropzone: "dz-shared" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed);
        expectHtmlEqual(
            serialized,
            `<anvil-slot name="alpha"></anvil-slot>
<anvil-slot name="beta"></anvil-slot>
<anvil-slot name="gamma"></anvil-slot>`
        );
    });
    it("serializes slots that target root dropzones alongside components that share a dropzone", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div class="layout">
    <anvil-dropzone name="dz-only-one"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "primary",
                    properties: { text: "Click" },
                    layout_properties: { dropzone: "dz-only-one" },
                },
            ],
            slots: {
                slot_0: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "dz-only-one" },
                },
                slot_1: {
                    target: { type: "container", name: "" },
                    index: 1,
                    set_layout_properties: { dropzone: "dz-only-one" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<div class="layout">
    <anvil-slot name="slot_0"></anvil-slot>
    <anvil-component type="Button" name="primary" prop:text="Click"></anvil-component>
    <anvil-slot name="slot_1"></anvil-slot>
</div>`)
        );
    });

    it("serializes slots that target anonymous html fragments", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div class="wrapper">
    <anvil-dropzone name="dz-root"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "HtmlComponent",
                    name: "$component_1",
                    properties: {
                        html: `<section>
    <anvil-dropzone name="dz-fragment"></anvil-dropzone>
</section>`,
                    },
                    layout_properties: { dropzone: "dz-root" },
                },
            ],
            slots: {
                fragment: {
                    target: { type: "container", name: "$component_1" },
                    index: 0,
                    set_layout_properties: { dropzone: "dz-fragment" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<div class="wrapper">
    <section>
        <anvil-slot name="fragment"></anvil-slot>
    </section>
</div>`)
        );
    });

    describe("slot index ordering", () => {
        it("keeps index 0 for consecutive slots before any components", () => {
            const html = `<div class="layout">
    <anvil-slot name="slot_1"></anvil-slot>
    <anvil-slot name="slot_2"></anvil-slot>
    <anvil-component type="Button" name="button_2" prop:text="button_2"></anvil-component>
</div>`;

            const parsed = parseContainerForm(html);
            expect(expectSlot(parsed, "slot_1")).toMatchObject({ index: 0 });
            expect(expectSlot(parsed, "slot_2")).toMatchObject({ index: 0 });

            expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
        });

        it("keeps index 0 for consecutive slots even when there is dom element in between", () => {
            const html = `<div class="layout">
    <div>
        <anvil-slot name="slot_1"></anvil-slot>
    </div>
    <div>
        <anvil-slot name="slot_2"></anvil-slot>
    </div>
</div>`;

            const parsed = parseContainerForm(html);
            expect(expectSlot(parsed, "slot_1")).toMatchObject({ index: 0 });
            expect(expectSlot(parsed, "slot_2")).toMatchObject({ index: 0 });

            expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
        });

        it("sets index 0 for the first slot before any components", () => {
            const html = `<div>
    <anvil-component type="FlowPanel" name="fp">
    <anvil-slot name="slot-1"></anvil-slot>
    <anvil-component type="Label" name="label-1"></anvil-component>
</anvil-component>
</div>`;

            const parsed = parseContainerForm(html);
            expect(expectSlot(parsed, "slot-1")).toMatchObject({ index: 0 });
            expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
        });

        it("increments the index after each component", () => {
            const html = `<div>
    <anvil-component type="FlowPanel" name="fp">
        <anvil-slot name="slot-1"></anvil-slot>
        <anvil-component type="Label" name="label-1"></anvil-component>
        <anvil-slot name="slot-2"></anvil-slot>
        <anvil-slot name="slot-3"></anvil-slot>
    </anvil-component>
</div>`;

            const parsed = parseContainerForm(html);
            expect(expectSlot(parsed, "slot-1")).toMatchObject({ index: 0 });
            expect(expectSlot(parsed, "slot-2")).toMatchObject({ index: 1 });
            expect(expectSlot(parsed, "slot-3")).toMatchObject({ index: 1 });
            expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
        });

        it("allows multiple slots to share the same index when contiguous", () => {
            const html = `<div>
    <anvil-component type="FlowPanel" name="fp">
        <anvil-slot name="slot-1"></anvil-slot>
        <anvil-component type="Label" name="label-1"></anvil-component>
        <anvil-slot name="slot-2"></anvil-slot>
        <anvil-slot name="slot-3"></anvil-slot>
    </anvil-component>
</div>`;

            const parsed = parseContainerForm(html);
            expect(expectSlot(parsed, "slot-1")).toMatchObject({ index: 0 });
            expect(expectSlot(parsed, "slot-2")).toMatchObject({ index: 1 });
            expect(expectSlot(parsed, "slot-3")).toMatchObject({ index: 1 });
            expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
        });

        it("continues counting when components follow later slots", () => {
            const html = `<div>
    <anvil-component type="FlowPanel" name="fp">
        <anvil-slot name="slot-1"></anvil-slot>
        <anvil-component type="Label" name="label-1"></anvil-component>
        <anvil-slot name="slot-2"></anvil-slot>
        <anvil-component type="Label" name="label-2"></anvil-component>
        <anvil-slot name="slot-3"></anvil-slot>
    </anvil-component>
</div>`;

            const parsed = parseContainerForm(html);
            expect(expectSlot(parsed, "slot-1")).toMatchObject({ index: 0 });
            expect(expectSlot(parsed, "slot-2")).toMatchObject({ index: 1 });
            expect(expectSlot(parsed, "slot-3")).toMatchObject({ index: 2 });
            expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
        });

        it("skips indices when multiple components precede a slot", () => {
            const html = `<div>
    <anvil-component type="FlowPanel" name="fp">
    <anvil-slot name="slot-1"></anvil-slot>
    <anvil-component type="Label" name="label-1"></anvil-component>
    <anvil-slot name="slot-2"></anvil-slot>
    <anvil-component type="Label" name="label-2"></anvil-component>
    <anvil-component type="Label" name="label-3"></anvil-component>
    <anvil-slot name="slot-3"></anvil-slot>
</anvil-component>
</div>`;

            const parsed = parseContainerForm(html);
            expect(expectSlot(parsed, "slot-1")).toMatchObject({ index: 0 });
            expect(expectSlot(parsed, "slot-2")).toMatchObject({ index: 1 });
            expect(expectSlot(parsed, "slot-3")).toMatchObject({ index: 3 });
            expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(normalizeMultiline(html));
        });
    });

    it("sorts slots with identical indices by name", () => {
        const html = `<div>
    <anvil-component type="Button" name="button_2" prop:text="button_2"></anvil-component>
    <anvil-component type="Button" name="button_3" prop:text="button_3"></anvil-component>
    <anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>
    <anvil-slot name="slot_1"></anvil-slot>
    <anvil-slot name="slot_2"></anvil-slot>
</div>`;
        const parsed = parseContainerForm(html);
        expect(Object.keys(parsed.slots || {})).toEqual(["slot_1", "slot_2"]);
        const dropzoneNames: string[] = [];
        for (const match of (parsed.container.properties?.html ?? "").matchAll(/name="([^"]+)"/g)) {
            if (match[1]) {
                dropzoneNames.push(match[1]);
            }
        }
        expect(parsed.slots?.slot_1?.index).toBe(parsed.slots?.slot_2?.index);
        const slot1Dropzone = parsed.slots?.slot_1?.set_layout_properties?.dropzone;
        const slot2Dropzone = parsed.slots?.slot_2?.set_layout_properties?.dropzone;
        expect(slot1Dropzone).toBeDefined();
        expect(slot2Dropzone).toBeDefined();
        const slot1Index = dropzoneNames.indexOf(slot1Dropzone!);
        const slot2Index = dropzoneNames.indexOf(slot2Dropzone!);
        expect(slot1Index).toBeGreaterThanOrEqual(0);
        expect(slot2Index).toBeGreaterThan(slot1Index);
    });
});
