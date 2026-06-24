import { describe, it, expect } from "@rstest/core";
import {
    parseContainerForm,
    serializeFormContainer,
    serializeFormContainerWithResult,
} from "@anvil-works/form-template-parser";
import type { ParsedFormYaml } from "@anvil-works/form-template-parser";
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
    it("preserves the final generated dropzone", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<center style="font-style:italic; color:#888; margin: 3em;">
  (Insert your custom HTML here)
</center>
<anvil-dropzone name="$dz_ifpkow"></anvil-dropzone>`,
                },
            },
            components: [],
        };

        expectHtmlEqual(serializeFormContainer(parsed), parsed.container.properties?.html ?? "");
    });

    it("parses top-level slots and round-trips", () => {
        const html = `<div class="layout">
    <anvil-slot name="body"></anvil-slot>
    <anvil-slot name="header"></anvil-slot>
</div>`;

        const parsed = parseContainerForm(html);

        expectHtmlEqual(
            parsed.container.properties?.html ?? "",
            `<div class="layout">
    <anvil-dropzone name="<dropzone>"></anvil-dropzone>
    <anvil-dropzone name="<dropzone>"></anvil-dropzone>
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
            '<anvil-dropzone name="<dropzone>">'
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

    it("updates slot dropzone ids after reparsing appended components", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div>
    <anvil-dropzone name="$dz_slot"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "button_1",
                    properties: { text: "button_1" },
                    layout_properties: { dropzone: "$dz_missing" },
                },
            ],
            slots: {
                slot_1: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "$dz_slot" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed, { allowReparse: true });
        const reparsedSlotDropzone = parsed.slots?.slot_1?.set_layout_properties?.dropzone;

        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<div>
    <anvil-slot name="slot_1"></anvil-slot>
</div>
<anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>`)
        );
        expect(reparsedSlotDropzone).toBeDefined();
        expect(reparsedSlotDropzone).not.toBe("$dz_slot");
        expect(parsed.container.properties?.html).toContain(`name="${reparsedSlotDropzone}"`);
    });

    it("preserves a root slot when its dropzone is missing during structural serialization", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<section>
    <p>Static content</p>
</section>`,
                },
            },
            components: [],
            slots: {
                slot_1: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "$dz_missing" },
                },
            },
        };

        const result = serializeFormContainerWithResult(parsed, { allowReparse: true });

        expect(result.structuralHtmlChanged).toBe(true);
        expect(result.html).toContain(`<anvil-slot name="slot_1"></anvil-slot>`);
        expect(parsed.slots?.slot_1).toBeDefined();
        expect(parsed.slots?.slot_1?.set_layout_properties?.dropzone).toBeDefined();
        expect(parsed.slots?.slot_1?.set_layout_properties?.dropzone).not.toBe("$dz_missing");
        expect(parsed.container.properties?.html).toContain(
            `name="${parsed.slots?.slot_1?.set_layout_properties?.dropzone}"`
        );
    });

    it("reports no structural change when serialization does not reparse", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div>
    <anvil-dropzone name="body"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "button_1",
                    properties: { text: "button_1" },
                    layout_properties: { dropzone: "body" },
                },
            ],
        };

        const result = serializeFormContainerWithResult(parsed, { allowReparse: true });

        expect(result.structuralHtmlChanged).toBe(false);
        expect(normalizeMultiline(result.html)).toBe(
            normalizeMultiline(`<div>
    <anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>
</div>`)
        );
    });

    it("reparses after filling generated dropzones during structural serialization", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div>
    <anvil-dropzone name="$dz_igoyrk"></anvil-dropzone>
    <anvil-dropzone name="$dz_rbyolc"></anvil-dropzone>
    <anvil-dropzone name="$dz_078e80"></anvil-dropzone>
    <anvil-dropzone name="$dz_83m60w"></anvil-dropzone>
    <anvil-dropzone name="$dz_gyvvuo"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "_1",
                    properties: { text: 1 },
                    layout_properties: { dropzone: "$dz_rbyolc" },
                },
                {
                    type: "Button",
                    name: "_2",
                    properties: { text: 2 },
                    layout_properties: { dropzone: "$dz_078e80" },
                },
                {
                    type: "HtmlComponent",
                    name: "$component_1",
                    properties: {
                        html: `<div anvil:dom-node>
    This Div
    <anvil-dropzone name="$dz_gwzda8"></anvil-dropzone>
</div>`,
                    },
                    layout_properties: { dropzone: "$dz_gyvvuo" },
                },
            ],
            slots: {
                slot_1: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "$dz_igoyrk" },
                },
                slot_2: {
                    target: { type: "container", name: "" },
                    index: 2,
                    set_layout_properties: { dropzone: "$dz_83m60w" },
                },
            },
        };

        const result = serializeFormContainerWithResult(parsed, { allowReparse: true });

        expect(result.structuralHtmlChanged).toBe(true);
        expect(normalizeMultiline(result.html)).toBe(
            normalizeMultiline(`<div>
    <anvil-slot name="slot_1"></anvil-slot>
    <anvil-component type="Button" name="_1" prop:text="1"></anvil-component>
    <anvil-component type="Button" name="_2" prop:text="2"></anvil-component>
    <anvil-slot name="slot_2"></anvil-slot>
    <div anvil:dom-node>
        This Div
        <anvil-dropzone name="$dz_gwzda8"></anvil-dropzone>
    </div>
</div>`)
        );
        expect(parsed.container.properties?.html).toContain(
            `<anvil-dropzone name="${parsed.components?.[0].layout_properties?.dropzone}"`
        );
        expect(parsed.components?.[0].layout_properties?.dropzone).not.toBe("$dz_rbyolc");
    });

    it("reports structural change when nested fragment serialization reparses", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<section>
    <anvil-dropzone name="outer"></anvil-dropzone>
</section>`,
                },
            },
            components: [
                {
                    type: "HtmlComponent",
                    name: "fragment_1",
                    properties: {
                        html: `<article>
    <anvil-dropzone name="inner"></anvil-dropzone>
</article>`,
                    },
                    layout_properties: { dropzone: "outer" },
                    components: [
                        {
                            type: "Button",
                            name: "button_1",
                            properties: { text: "button_1" },
                            layout_properties: { dropzone: "$dz_missing" },
                        },
                    ],
                },
            ],
        };

        const result = serializeFormContainerWithResult(parsed, { allowReparse: true });

        expect(result.structuralHtmlChanged).toBe(true);
        expect(result.html).toContain(`<anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>`);
        expect(parsed.container.properties?.html).toContain("anvil-dropzone");
    });

    it("preserves a nested fragment slot when its dropzone is missing during structural serialization", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div>
  <anvil-dropzone name="fragment-root"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "HtmlComponent",
                    name: "fragment_1",
                    properties: {
                        html: `<article>
  <p>Intro</p>
</article>`,
                    },
                    layout_properties: { dropzone: "fragment-root" },
                },
            ],
            slots: {
                slot_1: {
                    target: { type: "container", name: "fragment_1" },
                    index: 0,
                    set_layout_properties: { dropzone: "$dz_missing" },
                },
            },
        };

        const result = serializeFormContainerWithResult(parsed, { allowReparse: true, indentSize: 2 });

        expect(result.structuralHtmlChanged).toBe(true);
        expect(result.html).toBe(`<div>
  <div anvil:name="fragment_1">
    <article>
      <p>Intro</p>
    </article>
    <anvil-slot name="slot_1"></anvil-slot>
  </div>
</div>`);
        expect(parsed.slots?.slot_1).toBeDefined();
        expect(parsed.slots?.slot_1?.target).toEqual({ type: "container", name: "fragment_1" });
        expect(parsed.slots?.slot_1?.set_layout_properties?.dropzone).toBeDefined();
        expect(parsed.slots?.slot_1?.set_layout_properties?.dropzone).not.toBe("$dz_missing");
        expect(parsed.components?.[0]?.properties?.html).toContain(
            `name="${parsed.slots?.slot_1?.set_layout_properties?.dropzone}"`
        );
    });

    it("keeps root slots when reparsing after a component moves out of a generated slot dropzone", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div>
    <div>
        <anvil-dropzone name="$dz_yp90jk"></anvil-dropzone>
    </div>
    <anvil-dropzone name="$dz_4z1q80"></anvil-dropzone>
    <anvil-dropzone name="$dz_oc67ls"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "button_1",
                    properties: { text: "button_1" },
                    layout_properties: { dropzone: "$dz_missing" },
                },
                {
                    type: "HtmlComponent",
                    name: "$component_1",
                    properties: {
                        html: `<div anvil:dom-node="foo">
    text
</div>`,
                    },
                    layout_properties: { dropzone: "$dz_4z1q80" },
                },
            ],
            slots: {
                foo: {
                    target: { type: "container", name: "" },
                    index: 2,
                    set_layout_properties: { dropzone: "$dz_oc67ls" },
                },
                slot_1: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "$dz_yp90jk" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed, { allowReparse: true });

        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<div>
    <div>
        <anvil-slot name="slot_1"></anvil-slot>
    </div>
    <div anvil:dom-node="foo">
        text
    </div>
    <anvil-slot name="foo"></anvil-slot>
</div>
<anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>`)
        );
        expect(parsed.slots?.slot_1).toBeDefined();
        expect(parsed.slots?.foo).toBeDefined();
        expect(parsed.slots?.slot_1?.set_layout_properties?.dropzone).not.toBe("$dz_yp90jk");
        expect(parsed.slots?.foo?.set_layout_properties?.dropzone).not.toBe("$dz_oc67ls");

        const serializedAgain = serializeFormContainer(parsed, { allowReparse: true });
        expect(normalizeMultiline(serializedAgain)).toBe(normalizeMultiline(serialized));
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
        for (const match of fragmentHtml.matchAll(/<anvil-dropzone name="([^"]+)"/g)) {
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

    it("does not mutate structural yaml when reparsing is disabled", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div>
    <anvil-dropzone name="$dz_slot"></anvil-dropzone>
</div>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "button_1",
                    properties: { text: "button_1" },
                    layout_properties: { dropzone: "$dz_missing" },
                },
            ],
            slots: {
                slot_1: {
                    target: { type: "container", name: "" },
                    index: 0,
                    set_layout_properties: { dropzone: "$dz_slot" },
                },
            },
        };
        const before = JSON.parse(
            JSON.stringify({
                container: parsed.container,
                components: parsed.components,
                slots: parsed.slots,
            })
        );

        serializeFormContainer(parsed);

        expect(parsed.container).toEqual(before.container);
        expect(parsed.components).toEqual(before.components);
        expect(parsed.slots).toEqual(before.slots);
    });

    it("serializes a root slot with empty layout properties into an existing root dropzone", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<center style="font-style:italic; color:#888; margin: 3em;">
  (Insert your custom HTML here)
</center>
<anvil-dropzone name="default"></anvil-dropzone>`,
                },
            },
            components: [],
            slots: {
                slot_1: {
                    index: 0,
                    set_layout_properties: {},
                    target: { type: "container", name: "" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed, { allowReparse: true });

        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<center style="font-style:italic; color:#888; margin: 3em;">
  (Insert your custom HTML here)
</center>
<anvil-slot name="slot_1"></anvil-slot>`)
        );
    });

    it("round trips a root slot with empty layout properties through serialized HTML", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<center style="font-style:italic; color:#888; margin: 3em;">
  (Insert your custom HTML here)
</center>
<anvil-dropzone name="default"></anvil-dropzone>`,
                },
            },
            components: [],
            slots: {
                slot_1: {
                    index: 0,
                    set_layout_properties: {},
                    target: { type: "container", name: "" },
                },
            },
        };

        const serialized = serializeFormContainer(parsed, { allowReparse: true });
        const reparsed = parseContainerForm(serialized);

        expect(expectSlot(reparsed, "slot_1")).toMatchObject({
            target: { type: "container", name: "" },
            index: 0,
            set_layout_properties: { dropzone: "<dropzone>" },
        });
        expect(normalizeMultiline(serializeFormContainer(reparsed))).toBe(normalizeMultiline(serialized));
    });

    it("serializes a root component with empty layout properties into an existing default dropzone", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<center style="font-style: italic; color: #888; margin: 3em">
    (Insert your custom HTML here)
</center>
<anvil-dropzone name="default"></anvil-dropzone>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "button_1",
                    properties: { text: "button_1" },
                    layout_properties: {},
                },
            ],
        };

        const serialized = serializeFormContainer(parsed, { allowReparse: true });

        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<center style="font-style: italic; color: #888; margin: 3em">
    (Insert your custom HTML here)
</center>
<anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>`)
        );
        expect(parsed.components?.[0]?.layout_properties).toEqual({});
        expect(parsed.container.properties?.html).not.toContain("$dz_");
    });

    it("does not reparse explicit named dropzones that were already filled", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div><anvil-dropzone name="slot1"></anvil-dropzone></div>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "button_1",
                    properties: { text: "button_1" },
                    layout_properties: { dropzone: "slot1" },
                },
            ],
        };

        const serialized = serializeFormContainer(parsed, { allowReparse: true });

        expect(serialized).toBe(
            `<div><anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component></div>`
        );
        expect(parsed.container.properties?.html).toBe(`<div><anvil-dropzone name="slot1"></anvil-dropzone></div>`);
        expect(parsed.components?.[0]?.layout_properties?.dropzone).toBe("slot1");
    });

    it("preserves only the default dropzone after deleting a component dropped there", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<center style="font-style: italic; color: #888; margin: 3em">
    (Insert your custom HTML here)
</center>
<anvil-dropzone name="default"></anvil-dropzone>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "button_1",
                    properties: { text: "button_1" },
                    layout_properties: {},
                },
            ],
        };

        serializeFormContainer(parsed, { allowReparse: true });
        parsed.components = [];

        const serializedAfterDelete = serializeFormContainer(parsed, { allowReparse: true });

        expect(normalizeMultiline(serializedAfterDelete)).toBe(
            normalizeMultiline(`<center style="font-style: italic; color: #888; margin: 3em">
    (Insert your custom HTML here)
</center>
<anvil-dropzone name="default"></anvil-dropzone>`)
        );
        expect(serializedAfterDelete).not.toContain("$dz_");
    });

    it("does not serialize a root slot with empty layout properties into a named non-default dropzone", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<anvil-dropzone name="sidebar"></anvil-dropzone>`,
                },
            },
            components: [],
            slots: {
                slot_1: {
                    index: 0,
                    set_layout_properties: {},
                    target: { type: "container", name: "" },
                },
            },
        };

        expect(serializeFormContainer(parsed)).toBe(`<anvil-dropzone name="sidebar"></anvil-dropzone>`);
    });

    it("does not serialize a root component with empty layout properties into a named non-default dropzone", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<anvil-dropzone name="sidebar"></anvil-dropzone>`,
                },
            },
            components: [
                {
                    type: "Button",
                    name: "button_1",
                    properties: { text: "button_1" },
                    layout_properties: {},
                },
            ],
        };

        expect(normalizeMultiline(serializeFormContainer(parsed))).toBe(
            normalizeMultiline(`<anvil-dropzone name="sidebar"></anvil-dropzone>
<anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>`)
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
