import { describe, it, expect } from "@rstest/core";
import {
    parseLayoutForm,
    createHashBasedDropzoneNameGenerator,
    hashString,
    serializeFormLayout,
    createDeterministicDropzoneNameGenerator,
} from "@runtime/html-form/parser";
import {
    normalizeComponentsBySlot,
    normalizeDropzoneNames,
    normalizeMultiline,
    stripDropzoneIdsFromComponents,
    normalizeSlots,
} from "./test-utils";

function expectLayoutRoundTrip(serialized: string, original: ReturnType<typeof parseLayoutForm>) {
    const reparsed = parseLayoutForm(serialized);
    expect(reparsed.layout).toEqual(original.layout);
    expect(normalizeComponentsBySlot(stripDropzoneIdsFromComponents(reparsed.components_by_slot))).toEqual(
        normalizeComponentsBySlot(stripDropzoneIdsFromComponents(original.components_by_slot))
    );
    expect(normalizeSlots(reparsed.slots)).toEqual(normalizeSlots(original.slots));
}

describe("parseLayoutHtml", () => {
    it("parses a minimal layout with a single block component", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <anvil-block slot="main">
        <anvil-component type="Label" name="lbl_title" prop:text="Welcome"></anvil-component>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);

        expect(parsed.layout).toEqual({ type: "form:layouts.main" });
        expect(normalizeComponentsBySlot(parsed.components_by_slot)).toEqual({
            main: [
                {
                    type: "Label",
                    name: "lbl_title",
                    properties: { text: "Welcome" },
                },
            ],
        });
        expect(parsed.slots).toBeUndefined();

        const serialized = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: parsed.components_by_slot,
            slots: parsed.slots,
        });
        expectLayoutRoundTrip(serialized, parsed);
    });

    it("parses blocks containing anonymous HTML and nested components", () => {
        const html = `<anvil-form layout="form:layouts.two_column">
    <anvil-block slot="left">
        <div class="intro">
            <h2 anvil-name="heading"></h2>
            <p>Static copy inside the layout.</p>
            <anvil-component type="Button" name="btn_start" on:click="self.start"></anvil-component>
        </div>
    </anvil-block>
    <anvil-block slot="right">
        <anvil-component type="Label" name="lbl_status" prop:text="'Ready'"></anvil-component>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);

        expect(parsed.layout).toEqual({ type: "form:layouts.two_column" });
        expect(normalizeComponentsBySlot(parsed.components_by_slot)).toEqual({
            left: [
                {
                    type: "HtmlComponent",
                    name: "$component_1",
                    properties: {
                        html: normalizeDropzoneNames(
                            normalizeMultiline(`<div class="intro">
    <h2 anvil-name="heading"></h2>
    <p>Static copy inside the layout.</p>
    <anvil-dropzone name="<dropzone>"></anvil-dropzone>
</div>`)
                        ),
                    },
                    components: [
                        {
                            type: "Button",
                            name: "btn_start",
                            properties: {},
                            layout_properties: { dropzone: "<dropzone>" },
                            event_bindings: { click: "start" },
                        },
                    ],
                },
            ],
            right: [
                {
                    type: "Label",
                    name: "lbl_status",
                    properties: { text: "'Ready'" },
                },
            ],
        });
        expect(parsed.slots).toBeUndefined();

        const serialized = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: parsed.components_by_slot,
            slots: parsed.slots,
        });
        expectLayoutRoundTrip(serialized, parsed);
    });

    it("does not reuse dropzone names already present in layout markup", () => {
        const html = `<anvil-form layout="form:layouts.existing">
    <anvil-block slot="main">
        <div>
            <anvil-dropzone name="$dz_0"></anvil-dropzone>
            <anvil-component type="Label" name="lbl_status"></anvil-component>
        </div>
    </anvil-block>
</anvil-form>`;

        // Use hash-based seeded generator to verify uniqueness and determinism
        const htmlSeed = hashString(html);
        const hashBasedGenerator = createHashBasedDropzoneNameGenerator(htmlSeed);
        const parsed = parseLayoutForm(html, { dropzoneNameGenerator: hashBasedGenerator });

        const fragment = parsed.components_by_slot.main?.[0];
        const label = fragment?.components?.find((component) => component.name === "lbl_status");

        expect(fragment?.properties?.html).toContain('name="$dz_0"');
        expect(label?.layout_properties?.dropzone).not.toBe("$dz_0");
        // Verify the generated name is hash-based (deterministic)
        expect(label?.layout_properties?.dropzone).toMatch(/^\$dz_[0-9a-z]{6}$/);

        // Verify parsing twice produces the same results
        const parsed2 = parseLayoutForm(html, {
            dropzoneNameGenerator: createHashBasedDropzoneNameGenerator(htmlSeed),
        });
        const fragment2 = parsed2.components_by_slot.main?.[0];
        const label2 = fragment2?.components?.find((component) => component.name === "lbl_status");
        expect(label2?.layout_properties?.dropzone).toBe(label?.layout_properties?.dropzone);
        expect(parsed2).toEqual(parsed);
    });

    it("parses nested slots inside blocks and components", () => {
        const html = `<anvil-form layout="form:layouts.dashboard">
    <anvil-block slot="header">
        <anvil-component type="TextBox" name="search_box" container:width="200"></anvil-component>
        <anvil-slot name="actions"></anvil-slot>
    </anvil-block>
    <anvil-block slot="body">
        <anvil-component type="FlowPanel" name="main_panel">
            <anvil-slot name="primary"></anvil-slot>
            <anvil-slot name="secondary" container:width="200"></anvil-slot>
        </anvil-component>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);

        expect(parsed.layout).toEqual({ type: "form:layouts.dashboard" });
        expect(normalizeComponentsBySlot(parsed.components_by_slot)).toEqual({
            header: [
                {
                    type: "TextBox",
                    name: "search_box",
                    properties: {},
                    layout_properties: { width: 200 },
                },
            ],
            body: [
                {
                    type: "FlowPanel",
                    name: "main_panel",
                    properties: {},
                },
            ],
        });
        expect(normalizeSlots(parsed.slots)).toEqual({
            actions: {
                target: { type: "slot", name: "header" },
                index: 1,
                set_layout_properties: {},
            },
            primary: {
                target: { type: "container", name: "main_panel" },
                index: 0,
                set_layout_properties: {},
            },
            secondary: {
                target: { type: "container", name: "main_panel" },
                index: 0,
                set_layout_properties: { width: 200 },
            },
        });

        const serialized = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: parsed.components_by_slot,
            slots: parsed.slots,
        });
        expectLayoutRoundTrip(serialized, parsed);
    });

    it("parses data bindings and event handlers on layout components", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <anvil-block slot="main">
        <anvil-component
            type="DataGrid"
            name="grid"
            bind:items="self.items"
            on:row_click="self.on_row_click"
        ></anvil-component>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html, { dropzoneNameGenerator: createDeterministicDropzoneNameGenerator(7) });

        expect(parsed.layout).toEqual({ type: "form:layouts.main" });
        expect(normalizeComponentsBySlot(parsed.components_by_slot)).toEqual({
            main: [
                {
                    type: "DataGrid",
                    name: "grid",
                    properties: {},
                    data_bindings: [{ property: "items", code: "self.items" }],
                    event_bindings: { row_click: "on_row_click" },
                },
            ],
        });
        expect(parsed.slots).toBeUndefined();

        const serialized = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: parsed.components_by_slot,
            slots: parsed.slots,
        });
        expectLayoutRoundTrip(serialized, parsed);
    });

    it("parses layout-level properties, bindings, and events", () => {
        const html = `<anvil-form
    layout="form:layouts.dialog"
    prop:title="Customer details"
    bind:is_enabled="self.dialog_enabled"
    on:show="self.on_show"
    on:layout:submit="self.submit_dialog"
>
    <anvil-block slot="body">
        <anvil-component type="TextBox" name="name_box" prop:placeholder="'Name'"></anvil-component>
        <anvil-component type="Button" name="ok_button" on:click="self.ok_click"></anvil-component>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);

        expect(parsed.layout).toEqual({
            type: "form:layouts.dialog",
            properties: { title: "Customer details" },
            data_bindings: [{ property: "is_enabled", code: "self.dialog_enabled" }],
            form_event_bindings: { show: "on_show" },
            event_bindings: { submit: "submit_dialog" },
        });

        expect(normalizeComponentsBySlot(parsed.components_by_slot)).toEqual({
            body: [
                {
                    type: "TextBox",
                    name: "name_box",
                    properties: { placeholder: "'Name'" },
                },
                {
                    type: "Button",
                    name: "ok_button",
                    properties: {},
                    event_bindings: { click: "ok_click" },
                },
            ],
        });

        const serialized = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: parsed.components_by_slot,
            slots: parsed.slots,
        });
        expect(serialized).toContain(`on:show="self.on_show"`);
        expect(serialized).toContain(`on:layout:submit="self.submit_dialog"`);

        expectLayoutRoundTrip(serialized, parsed);
    });

    it("round-trips layout fragments when toggling visibility metadata", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <anvil-block slot="other">
        <div style="padding: 10px">
            <div style="padding: 10px; border: 1px solid red"></div>
        </div>
        <div>
            <button anvil-name="button_3">Button 3</button>
        </div>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);
        const originalOther = parsed.components_by_slot.other ?? [];
        expect(originalOther.length).toBe(2);
        const firstFragment = originalOther[0];
        expect(firstFragment.type).toBe("HtmlComponent");
        const firstFragmentProperties = firstFragment.properties ?? {};
        const firstFragmentHtml = firstFragmentProperties.html ?? "";
        expect(firstFragmentHtml).toBe(`<div style="padding: 10px">
    <div style="padding: 10px; border: 1px solid red"></div>
</div>`);

        const secondFragment = originalOther[1];
        expect(secondFragment.type).toBe("HtmlComponent");
        const secondFragmentProperties = secondFragment.properties ?? {};
        const secondFragmentHtml = secondFragmentProperties.html ?? "";
        secondFragment.properties = {
            ...secondFragmentProperties,
            visible: false,
            html: secondFragmentHtml,
        };
        expect(secondFragmentHtml).toBe(`<div>
    <button anvil-name="button_3">Button 3</button>
</div>`);

        const serializedHidden = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: parsed.components_by_slot,
            slots: parsed.slots,
        });
        expect(normalizeDropzoneNames(normalizeMultiline(serializedHidden))).toContain(`anvil:prop:visible="false"`);
        expect(serializedHidden).toBe(`<anvil-form layout="form:layouts.main">
    <anvil-block slot="other">
        <div style="padding: 10px">
            <div style="padding: 10px; border: 1px solid red"></div>
        </div>
        <div anvil:prop:visible="false">
            <button anvil-name="button_3">Button 3</button>
        </div>
    </anvil-block>
</anvil-form>`);

        const reparsed = parseLayoutForm(serializedHidden);
        const reparsedOther = reparsed.components_by_slot.other ?? [];
        expect(reparsedOther.length).toBe(2);

        const reparsedSecondFragment = reparsedOther[1];
        expect(reparsedSecondFragment.type).toBe("HtmlComponent");
        const reparsedSecondProps = reparsedSecondFragment.properties ?? {};
        const reparsedSecondHtml = reparsedSecondProps.html ?? "";
        expect(reparsedSecondProps.visible).toBe(false);
        reparsedSecondFragment.properties = {
            ...reparsedSecondProps,
            visible: true,
            html: reparsedSecondHtml,
        };
        expect(reparsedSecondHtml).toBe(`<div>
    <button anvil-name="button_3">Button 3</button>
</div>`);

        const roundTripped = serializeFormLayout({
            layout: reparsed.layout,
            components_by_slot: reparsed.components_by_slot,
            slots: reparsed.slots,
        });
        expect(roundTripped).toBe(html);
    });

    it("normalizes deeply nested fragment HTML when toggling visibility metadata", () => {
        const html = `<anvil-form layout="form:layouts.main">
    <anvil-block slot="main">
        <div anvil:prop:visible="false">
            <!-- About Page using utility classes -->
            <section class="py-12">
                <div class="max-w-4xl mx-auto px-4">
                    <h1 class="text-4xl font-bold text-center mb-4">
                        About Us
                    </h1>
                    <p class="text-lg text-secondary text-center mb-12">
                        This is a generic about page. Replace this content with
                        information about your application.
                    </p>
                    <div class="bg-white border rounded-lg p-8 mb-6">
                        <h2 class="text-2xl font-bold text-primary mb-4">
                            Our Mission
                        </h2>
                        <p class="text-secondary">
                            We build amazing web applications with Anvil.
                        </p>
                    </div>
                    <div class="bg-white border rounded-lg p-8 mb-6">
                        <h2 class="text-2xl font-bold text-primary mb-4">
                            Our Technology
                        </h2>
                        <p class="text-secondary mb-4">
                            Built with modern tools and best practices:
                        </p>
                        <ul class="text-secondary space-y-2">
                            <li>Built with Anvil (Python + HTML/CSS)</li>
                            <li>Client-side routing for SPA experience</li>
                            <li>Component-based architecture</li>
                            <li>Modern, responsive design</li>
                        </ul>
                    </div>
                    <div class="bg-white border rounded-lg p-8">
                        <h2 class="text-2xl font-bold text-primary mb-4">
                            Get In Touch
                        </h2>
                        <p class="text-secondary">
                            Have questions?
                            <a href="mailto:hello@example.com" class="text-primary font-medium hover:underline">Contact us</a>
                            and we'll get back to you soon.
                        </p>
                    </div>
                </div>
            </section>
        </div>
    </anvil-block>
</anvil-form>`;

        const parsed = parseLayoutForm(html);
        const mainComponents = parsed.components_by_slot.main ?? [];
        expect(mainComponents.length).toBe(1);

        const fragment = mainComponents[0];
        expect(fragment.type).toBe("HtmlComponent");
        const fragmentProperties = fragment.properties ?? {};
        const fragmentHtml = fragmentProperties.html ?? "";
        // The HTML includes the wrapper div, so first line is <div>
        const firstLine = fragmentHtml.split("\n")[0]?.trim() ?? "";
        expect(firstLine).toBe("<div>");
        // But the comment should be in the HTML
        expect(fragmentHtml).toContain("<!-- About Page using utility classes -->");

        const serializedHidden = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: parsed.components_by_slot,
            slots: parsed.slots,
        });
        expect(serializedHidden).toBe(html);

        fragment.properties = {
            ...fragmentProperties,
            visible: true,
            html: fragmentHtml,
        };

        const serializedVisible = serializeFormLayout({
            layout: parsed.layout,
            components_by_slot: parsed.components_by_slot,
            slots: parsed.slots,
        });
        const expectedVisible = `<anvil-form layout="form:layouts.main">
    <anvil-block slot="main">
        <div>
            <!-- About Page using utility classes -->
            <section class="py-12">
                <div class="max-w-4xl mx-auto px-4">
                    <h1 class="text-4xl font-bold text-center mb-4">
                        About Us
                    </h1>
                    <p class="text-lg text-secondary text-center mb-12">
                        This is a generic about page. Replace this content with
                        information about your application.
                    </p>
                    <div class="bg-white border rounded-lg p-8 mb-6">
                        <h2 class="text-2xl font-bold text-primary mb-4">
                            Our Mission
                        </h2>
                        <p class="text-secondary">
                            We build amazing web applications with Anvil.
                        </p>
                    </div>
                    <div class="bg-white border rounded-lg p-8 mb-6">
                        <h2 class="text-2xl font-bold text-primary mb-4">
                            Our Technology
                        </h2>
                        <p class="text-secondary mb-4">
                            Built with modern tools and best practices:
                        </p>
                        <ul class="text-secondary space-y-2">
                            <li>Built with Anvil (Python + HTML/CSS)</li>
                            <li>Client-side routing for SPA experience</li>
                            <li>Component-based architecture</li>
                            <li>Modern, responsive design</li>
                        </ul>
                    </div>
                    <div class="bg-white border rounded-lg p-8">
                        <h2 class="text-2xl font-bold text-primary mb-4">
                            Get In Touch
                        </h2>
                        <p class="text-secondary">
                            Have questions?
                            <a href="mailto:hello@example.com" class="text-primary font-medium hover:underline">Contact us</a>
                            and we'll get back to you soon.
                        </p>
                    </div>
                </div>
            </section>
        </div>
    </anvil-block>
</anvil-form>`;
        expect(serializedVisible).toBe(expectedVisible);

        const reparsedVisible = parseLayoutForm(serializedVisible);
        const reparsedMain = reparsedVisible.components_by_slot.main ?? [];
        expect(reparsedMain.length).toBe(1);

        const reparsedFragment = reparsedMain[0];
        expect(reparsedFragment.type).toBe("HtmlComponent");
        expect(reparsedFragment.properties?.visible).toBeUndefined();
        const reparsedFragmentHtml = reparsedFragment.properties?.html ?? "";
        // The HTML includes the wrapper div
        const reparsedFirstLine = reparsedFragmentHtml.split("\n")[0]?.trim() ?? "";
        expect(reparsedFirstLine).toBe("<div>");
        expect(reparsedFragmentHtml).toContain("<!-- About Page using utility classes -->");
    });
});
