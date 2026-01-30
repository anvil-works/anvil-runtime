import { describe, it, expect } from "@rstest/core";
import {
    parseContainerForm,
    serializeFormContainer,
    createDeterministicDropzoneNameGenerator,
} from "@runtime/html-form/parser";
import type { ParsedFormYaml } from "@runtime/html-form/types";
import {
    expectNormalizedComponents,
    expectSlot,
    normalizeComponentTree,
    normalizeDropzoneNames,
    normalizeMultiline,
} from "./test-utils";

describe("top-level anvil-component container behaviour", () => {
    it("treats a single top-level component as a component in an HtmlComponent", () => {
        const html = `<anvil-component type="ColumnPanel" name="ignored" prop:spacing="10" bind:visible="self.show" on:show="self.on_show">
    <anvil-component type="Label" name="lbl" prop:text="'Hello'"></anvil-component>
</anvil-component>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("HtmlComponent");
        expect(parsed.container.event_bindings).toBeUndefined();
        expect(parsed.container.data_bindings).toBeUndefined();
        expect(parsed.container.properties?.spacing).toBeUndefined();
        expect(normalizeDropzoneNames(normalizeMultiline(parsed.container.properties?.html ?? ""))).toBe(
            normalizeDropzoneNames(normalizeMultiline(`<anvil-dropzone name="<dropzone>"></anvil-dropzone>`))
        );
        expectNormalizedComponents(parsed.components, [
            {
                type: "ColumnPanel",
                name: "ignored",
                properties: { spacing: 10 },
                layout_properties: { dropzone: "<dropzone>" },
                data_bindings: [{ property: "visible", code: "self.show" }],
                event_bindings: { show: "on_show" },
                components: [
                    {
                        type: "Label",
                        name: "lbl",
                        properties: { text: "'Hello'" },
                    },
                ],
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<anvil-component type="ColumnPanel" name="ignored" prop:spacing="10" on:show="self.on_show" bind:visible="self.show">
    <anvil-component type="Label" name="lbl" prop:text="'Hello'"></anvil-component>
</anvil-component>`)
        );
    });

    it("treats a single top-level anvil-form as the Form container", () => {
        const html = `<anvil-form container="ColumnPanel" name="ignored" prop:spacing="10" bind:visible="self.show" on:show="self.on_show">
    <anvil-component type="Label" name="lbl" prop:text="'Hello'"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("ColumnPanel");
        expect(parsed.container.event_bindings).toEqual({ show: "on_show" });
        expect(parsed.container.data_bindings).toEqual([{ property: "visible", code: "self.show" }]);
        expect(parsed.container.properties).toEqual({ spacing: 10 });
        expect(parsed.components).toEqual([
            {
                type: "Label",
                name: "lbl",
                properties: { text: "'Hello'" },
                layout_properties: undefined,
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<anvil-form container="ColumnPanel" prop:spacing="10" on:show="self.on_show" bind:visible="self.show">
    <anvil-component type="Label" name="lbl" prop:text="'Hello'"></anvil-component>
</anvil-form>`)
        );
    });

    it("treats a top-level HtmlComponent anvil-form as plain HTML", () => {
        const html = `<anvil-form container="HtmlComponent">
    <center style="font-style: italic; color: #888; margin: 3em">(Insert your custom HTML here)</center>
    <anvil-component type="Button" name="button_2" prop:text="button_2"></anvil-component>
    <anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("HtmlComponent");
        expect(normalizeDropzoneNames(normalizeMultiline(parsed.container.properties?.html ?? ""))).toBe(
            normalizeDropzoneNames(
                normalizeMultiline(`<center style="font-style: italic; color: #888; margin: 3em">(Insert your custom HTML here)</center>
<anvil-dropzone name="<dropzone>"></anvil-dropzone>
<anvil-dropzone name="<dropzone>"></anvil-dropzone>`)
            )
        );
        expectNormalizedComponents(parsed.components, [
            {
                type: "Button",
                name: "button_2",
                properties: { text: "button_2" },
                layout_properties: { dropzone: "<dropzone>" },
            },
            {
                type: "Button",
                name: "button_1",
                properties: { text: "button_1" },
                layout_properties: { dropzone: "<dropzone>" },
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        const expected = `<center style="font-style: italic; color: #888; margin: 3em">(Insert your custom HTML here)</center>
<anvil-component type="Button" name="button_2" prop:text="button_2"></anvil-component>
<anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));
    });

    it("treats a top-level HtmlComponent anvil-form as plain HTML", () => {
        const html = `<anvil-form container="HtmlComponent" prop:visible="false">
    <center style="font-style: italic; color: #888; margin: 3em">(Insert your custom HTML here)</center>
    <anvil-component type="Button" name="button_2" prop:text="button_2"></anvil-component>
    <anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("HtmlComponent");
        expect(parsed.container.properties?.visible).toBe(false);
        expect(normalizeDropzoneNames(normalizeMultiline(parsed.container.properties?.html ?? ""))).toBe(
            normalizeDropzoneNames(
                normalizeMultiline(`<center style="font-style: italic; color: #888; margin: 3em">(Insert your custom HTML here)</center>
<anvil-dropzone name="<dropzone>"></anvil-dropzone>
<anvil-dropzone name="<dropzone>"></anvil-dropzone>`)
            )
        );
        expectNormalizedComponents(parsed.components, [
            {
                type: "Button",
                name: "button_2",
                properties: { text: "button_2" },
                layout_properties: { dropzone: "<dropzone>" },
            },
            {
                type: "Button",
                name: "button_1",
                properties: { text: "button_1" },
                layout_properties: { dropzone: "<dropzone>" },
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        const expected = `<div anvil:prop:visible="false">
    <center style="font-style: italic; color: #888; margin: 3em">(Insert your custom HTML here)</center>
    <anvil-component type="Button" name="button_2" prop:text="button_2"></anvil-component>
    <anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>
</div>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));
    });

    it("serializes HtmlForm containers with HtmlComponent children inside LinearPanel components", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div><anvil-dropzone name="$dz_0"></anvil-dropzone></div>
`,
                },
            },
            components: [
                {
                    type: "LinearPanel",
                    name: "$component_1",
                    properties: {},
                    layout_properties: { dropzone: "$dz_0" },
                    event_bindings: { show: "linear_panel_1_show" },
                    components: [
                        {
                            type: "HtmlComponent",
                            name: "$component_1",
                            properties: {
                                html: `
        <div style="border: 1px solid blue; min-height: 20px"></div>
        `,
                            },
                        },
                        {
                            type: "HtmlComponent",
                            name: "$component_2",
                            properties: {
                                html: `
        <div style="border: 1px solid blue; min-height: 20px"></div>
    `,
                            },
                        },
                    ],
                },
            ],
        };

        const serialized = serializeFormContainer(parsed);
        const expected = `<div><anvil-component type="LinearPanel" on:show="self.linear_panel_1_show">
        <div style="border: 1px solid blue; min-height: 20px"></div>
        <div style="border: 1px solid blue; min-height: 20px"></div>
    </anvil-component></div>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));

        const reparsed = parseContainerForm(serialized);
        expect(reparsed.container.type).toBe("HtmlComponent");
        expect(normalizeMultiline(reparsed.container.properties?.html ?? "")).toBe(
            normalizeMultiline(parsed.container.properties?.html ?? "")
        );
    });

    it("serializes HtmlForm containers with HtmlComponent children inside LinearPanel components with metadata", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<div><anvil-dropzone name="$dz_0"></anvil-dropzone></div>
`,
                },
            },
            components: [
                {
                    type: "LinearPanel",
                    name: "$component_1",
                    properties: {},
                    layout_properties: { dropzone: "$dz_0" },
                    event_bindings: { show: "linear_panel_1_show" },
                    components: [
                        {
                            type: "HtmlComponent",
                            name: "html_fragment_1",
                            properties: {
                                html: `
        <div style="border: 1px solid blue; min-height: 20px"></div>
        `,
                                visible: false,
                            },
                        },
                        {
                            type: "HtmlComponent",
                            name: "$component_1",
                            properties: {
                                html: `
        <div style="border: 1px solid blue; min-height: 20px"></div>
    `,
                            },
                        },
                    ],
                },
            ],
        };

        const serialized = serializeFormContainer(parsed);
        const expected = `<div><anvil-component type="LinearPanel" on:show="self.linear_panel_1_show">
        <div style="border: 1px solid blue; min-height: 20px" anvil:name="html_fragment_1" anvil:prop:visible="false"></div>
        <div style="border: 1px solid blue; min-height: 20px"></div>
    </anvil-component></div>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));

        const reparsed = parseContainerForm(serialized);
        expect(reparsed.container.type).toBe("HtmlComponent");
        expect(normalizeMultiline(reparsed.container.properties?.html ?? "")).toBe(
            normalizeMultiline(parsed.container.properties?.html ?? "")
        );

        const reparsedLinearPanel = reparsed.components?.[0];
        expect(reparsedLinearPanel?.type).toBe("LinearPanel");
        expect(reparsedLinearPanel?.components?.length).toBe(2);

        const reparsedMetadataFragment = reparsedLinearPanel?.components?.find(
            (component) => component.type === "HtmlComponent" && component.properties?.visible === false
        );
        expect(reparsedMetadataFragment?.name).toBe("html_fragment_1");
        expect(reparsedMetadataFragment?.properties?.visible).toBe(false);
        expect(normalizeMultiline(reparsedMetadataFragment?.properties?.html ?? "")).toBe(
            normalizeMultiline(`<div style="border: 1px solid blue; min-height: 20px"></div>`)
        );

        const reparsedPlainFragment = reparsedLinearPanel?.components?.find(
            (component) => component !== reparsedMetadataFragment
        );
        expect(reparsedPlainFragment?.type).toBe("HtmlComponent");
        expect(normalizeMultiline(reparsedPlainFragment?.properties?.html ?? "")).toBe(
            normalizeMultiline(`<div style="border: 1px solid blue; min-height: 20px"></div>`)
        );

        const reserialized = serializeFormContainer(reparsed);
        expect(normalizeMultiline(reserialized)).toBe(normalizeMultiline(serialized));
    });

    it("serializes LinearPanel containers with HtmlComponent children and metadata", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "LinearPanel",
            },
            components: [
                {
                    type: "HtmlComponent",
                    name: "html_fragment_1",
                    properties: {
                        html: `
        <div style="border: 1px solid blue; min-height: 20px"></div>
        `,
                        visible: false,
                    },
                },
                {
                    type: "HtmlComponent",
                    name: "$component_1",
                    properties: {
                        html: `
        <div style="border: 1px solid blue; min-height: 20px"></div>
    `,
                    },
                },
            ],
        };

        const serialized = serializeFormContainer(parsed);
        const expected = `<anvil-form container="LinearPanel">
    <div style="border: 1px solid blue; min-height: 20px" anvil:name="html_fragment_1" anvil:prop:visible="false"></div>
    <div style="border: 1px solid blue; min-height: 20px"></div>
</anvil-form>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));

        const reparsed = parseContainerForm(serialized);
        expect(reparsed.container.type).toBe("LinearPanel");
        const fragments = reparsed.components ?? [];
        expect(fragments.length).toBe(2);

        const metadataFragment = fragments.find(
            (component) => component.type === "HtmlComponent" && component.properties?.visible === false
        );
        expect(metadataFragment?.name).toBe("html_fragment_1");
        expect(normalizeMultiline(metadataFragment?.properties?.html ?? "")).toBe(
            normalizeMultiline(`<div style="border: 1px solid blue; min-height: 20px"></div>`)
        );

        const plainFragment = fragments.find((component) => component !== metadataFragment);
        expect(plainFragment?.type).toBe("HtmlComponent");
        expect(normalizeMultiline(plainFragment?.properties?.html ?? "")).toBe(
            normalizeMultiline(`<div style="border: 1px solid blue; min-height: 20px"></div>`)
        );

        const reserialized = serializeFormContainer(reparsed);
        expect(normalizeMultiline(reserialized)).toBe(normalizeMultiline(serialized));
    });

    it("serializes LinearPanel containers with HtmlComponent children", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "LinearPanel",
            },
            components: [
                {
                    type: "HtmlComponent",
                    name: "$component_1",
                    properties: {
                        html: `
        <div style="border: 1px solid blue; min-height: 20px"></div>
        `,
                    },
                },
                {
                    type: "HtmlComponent",
                    name: "$component_2",
                    properties: {
                        html: `
        <div style="border: 1px solid blue; min-height: 20px"></div>
    `,
                    },
                },
            ],
        };

        const serialized = serializeFormContainer(parsed);
        const expected = `<anvil-form container="LinearPanel">
    <div style="border: 1px solid blue; min-height: 20px"></div>
    <div style="border: 1px solid blue; min-height: 20px"></div>
</anvil-form>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));

        const reparsed = parseContainerForm(serialized);
        expect(reparsed.container.type).toBe("LinearPanel");
        expectNormalizedComponents(reparsed.components, parsed.components ?? []);

        const reserialized = serializeFormContainer(reparsed);
        expect(normalizeMultiline(reserialized)).toBe(normalizeMultiline(serialized));
    });

    it("preserves string values that look like JSON when serializing from YAML", () => {
        const yaml = {
            container: { type: "ColumnPanel", properties: {} },
            components: [
                {
                    type: "Label",
                    name: "lbl",
                    properties: { text: "{}", tooltip: "true" },
                },
            ],
        };

        const serialized = serializeFormContainer(yaml);
        expect(serialized).toContain(`prop:text='"{}"'`);
        expect(serialized).toContain(`prop:tooltip='"true"'`);
        const parsed = parseContainerForm(serialized);
        expect(parsed.components?.[0].properties).toMatchObject({ text: "{}", tooltip: "true" });
    });

    it("respects deterministic dropzone ids for nested components", () => {
        const html = `<anvil-form container="FlowPanel" prop:tag="root">
    <anvil-component type="Button" name="primary"></anvil-component>
    <anvil-component type="Label" name="secondary"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html, "HtmlComponent", {
            dropzoneNameGenerator: createDeterministicDropzoneNameGenerator(0x99),
        });

        expect(parsed.container.type).toBe("FlowPanel");
        expect(parsed.container.properties).toEqual({ tag: "root" });
        expect(parsed.components).toEqual([
            {
                type: "Button",
                name: "primary",
                properties: {},
                layout_properties: undefined,
            },
            {
                type: "Label",
                name: "secondary",
                properties: {},
                layout_properties: undefined,
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeDropzoneNames(normalizeMultiline(serialized))).toBe(
            normalizeDropzoneNames(
                normalizeMultiline(`<anvil-form container="FlowPanel" prop:tag="root">
    <anvil-component type="Button" name="primary"></anvil-component>
    <anvil-component type="Label" name="secondary"></anvil-component>
</anvil-form>`)
            )
        );
    });

    it("round-trips complex container properties and bindings", () => {
        const html = `<anvil-form container="Custom" prop:text="Hello" prop:config='{"foo": 1}' bind:enabled="self.enabled" on:update="self.on_update">
    <anvil-component type="Label" name="lbl" prop:text="'Inner'"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("Custom");
        expect(parsed.container.properties).toEqual({ text: "Hello", config: { foo: 1 } });
        expect(parsed.container.data_bindings).toEqual([{ property: "enabled", code: "self.enabled" }]);
        expect(parsed.container.event_bindings).toEqual({ update: "on_update" });
        expect(parsed.components).toEqual([
            {
                type: "Label",
                name: "lbl",
                properties: { text: "'Inner'" },
                layout_properties: undefined,
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<anvil-form container="Custom" prop:text="Hello" prop:config='{"foo":1}' on:update="self.on_update" bind:enabled="self.enabled">
    <anvil-component type="Label" name="lbl" prop:text="'Inner'"></anvil-component>
</anvil-form>`)
        );
    });

    it("captures slots defined on the container", () => {
        const html = `<anvil-form container="LinearPanel" name="content_panel">
    <anvil-slot name="main"></anvil-slot>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("LinearPanel");
        const slot = expectSlot(parsed, "main");
        expect(slot.target).toMatchObject({ type: "container", name: "" });
        expect(slot.index).toBe(0);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<anvil-form container="LinearPanel">
    <anvil-slot name="main"></anvil-slot>
</anvil-form>`)
        );
    });

    it("supports anonymous containers with slots", () => {
        const html = `<anvil-form container="LinearPanel">
    <anvil-slot name="body"></anvil-slot>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("LinearPanel");
        const slot = expectSlot(parsed, "body");
        expect(slot.target).toMatchObject({ type: "container", name: "" });
        expect(slot.index).toBe(0);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(html));
    });

    it("round-trips plain HTML children inside LinearPanel containers", () => {
        const html = `<anvil-form container="LinearPanel">

    <div style="border: 1px solid blue; min-height: 20px"></div>

</anvil-form>`;

        const parsed = parseContainerForm(html);
        expect(parsed.container.type).toBe("LinearPanel");

        const serialized = serializeFormContainer(parsed);
        const expected = `<anvil-form container="LinearPanel">
    <div style="border: 1px solid blue; min-height: 20px"></div>
</anvil-form>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));
    });

    it("round-trips plain HTML with container event bindings", () => {
        const html = `<anvil-form container="LinearPanel" on:show="self.linear_panel_1_show">
    <div style="border: 1px solid blue; min-height: 20px"></div>
    <div style="border: 1px solid blue; min-height: 20px"></div>
</anvil-form>`;

        const parsed = parseContainerForm(html);
        expect(parsed.container.type).toBe("LinearPanel");
        expect(parsed.container.event_bindings).toEqual({ show: "linear_panel_1_show" });
        expect(parsed.components?.length).toBe(2);

        const firstFragment = parsed.components?.[0];
        expect(firstFragment?.type).toBe("HtmlComponent");
        expect(normalizeMultiline(firstFragment?.properties?.html ?? "")).toBe(
            normalizeMultiline(`<div style="border: 1px solid blue; min-height: 20px"></div>`)
        );

        const secondFragment = parsed.components?.[1];
        expect(secondFragment?.type).toBe("HtmlComponent");
        expect(normalizeMultiline(secondFragment?.properties?.html ?? "")).toBe(
            normalizeMultiline(`<div style="border: 1px solid blue; min-height: 20px"></div>`)
        );

        const serialized = serializeFormContainer(parsed);
        const expected = `<anvil-form container="LinearPanel" on:show="self.linear_panel_1_show">
    <div style="border: 1px solid blue; min-height: 20px"></div>
    <div style="border: 1px solid blue; min-height: 20px"></div>
</anvil-form>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));
    });

    it("handles slots mixed with child components", () => {
        const html = `<anvil-form container="LinearPanel">
    <anvil-slot name="sidebar"></anvil-slot>
    <anvil-component type="Label" name="extra" prop:text="Extra"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);
        const slot = expectSlot(parsed, "sidebar");
        expect(slot.target).toMatchObject({ type: "container", name: "" });
        expect(slot.index).toBe(0);

        expect(parsed.components).toEqual([
            {
                type: "Label",
                name: "extra",
                properties: { text: "Extra" },
                layout_properties: undefined,
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<anvil-form container="LinearPanel">
    <anvil-slot name="sidebar"></anvil-slot>
    <anvil-component type="Label" name="extra" prop:text="Extra"></anvil-component>
</anvil-form>`)
        );
    });

    it("round-trips multiple anonymous child components", () => {
        const html = `<anvil-form container="ColumnPanel">
    <anvil-component type="Button" prop:text="foo"></anvil-component>
    <anvil-component type="Button" prop:text="bar"></anvil-component>
    <anvil-component type="Button" prop:text="baz"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("ColumnPanel");
        // Component numbers may vary due to shared counter with promoted fragments
        const components = parsed.components || [];
        expect(components.length).toBe(3);
        expect(components[0].type).toBe("Button");
        expect(components[0].properties).toEqual({ text: "foo" });
        expect(components[1].type).toBe("Button");
        expect(components[1].properties).toEqual({ text: "bar" });
        expect(components[2].type).toBe("Button");
        expect(components[2].properties).toEqual({ text: "baz" });

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(html));
    });

    it("round-trips nested buttons inside LinearPanel without layout properties", () => {
        const html = `<anvil-form container="LinearPanel">
    <anvil-component type="Button" prop:text="Button 1"></anvil-component>
    <anvil-component type="Button" prop:text="Button 2"></anvil-component>
    <anvil-component type="Button" prop:text="Button 3"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("LinearPanel");
        // Component numbers may vary due to shared counter with promoted fragments
        const components = parsed.components || [];
        expect(components.length).toBe(3);
        expect(components[0].type).toBe("Button");
        expect(components[0].properties).toEqual({ text: "Button 1" });
        expect(components[1].type).toBe("Button");
        expect(components[1].properties).toEqual({ text: "Button 2" });
        expect(components[2].type).toBe("Button");
        expect(components[2].properties).toEqual({ text: "Button 3" });

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(html));
    });

    it("preserves layout properties supplied via container attributes", () => {
        const html = `<anvil-form container="ColumnPanel">
    <anvil-component type="Label" name="lbl" prop:text="'Hello'" container:full_width_row="true"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.components).toEqual([
            {
                type: "Label",
                name: "lbl",
                properties: { text: "'Hello'" },
                layout_properties: { full_width_row: true },
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(html));
    });

    it("serializes components from YAML without introducing dropzones", () => {
        const staleHtml = `<anvil-form container="LinearPanel">
    <anvil-component type="Button" prop:text="Button 1"></anvil-component>
    <anvil-component type="Button" prop:text="Button 2"></anvil-component>
    <anvil-component type="Button" prop:text="Button 3"></anvil-component>
</anvil-form>`;
        const expectedHtml = `<anvil-form container="LinearPanel">
    <anvil-component type="Button" prop:text="Button 2"></anvil-component>
    <anvil-component type="Button" prop:text="Button 3"></anvil-component>
    <anvil-component type="Button" prop:text="Button 1"></anvil-component>
</anvil-form>`;

        const yaml = JSON.parse(
            '{"container":{"type":"LinearPanel","properties":{}},"components":[{"type":"Button","name":"$component_2","properties":{"text":"Button 2"}},{"type":"Button","name":"$component_3","properties":{"text":"Button 3"}},{"type":"Button","name":"$component_1","properties":{"text":"Button 1"}}]}'
        );
        yaml.serialized_html = staleHtml;

        const serialized = serializeFormContainer(yaml);
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expectedHtml));
        expect(normalizeMultiline(yaml.serialized_html ?? "")).toBe(normalizeMultiline(expectedHtml));
    });
    it("downgrades to HtmlForm when re-parsing serialized output with no metadata", () => {
        const html = `<div anvil:on:show="self.on_show">
    <anvil-component type="Button" prop:text="Click"></anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        expect(parsed.container.event_bindings).toEqual({ show: "on_show" });

        delete parsed.container.event_bindings;
        const serialized = serializeFormContainer(parsed);
        // When there are no attributes, HTML is returned as-is (preserves original wrapper div)
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<div>
    <anvil-component type="Button" prop:text="Click"></anvil-component>
</div>`)
        );

        const reparsed = parseContainerForm(serialized);
        expect(reparsed.container.type).toBe("HtmlComponent");
        expect(reparsed.container.event_bindings).toBeUndefined();
        expectNormalizedComponents(reparsed.components, [
            {
                type: "Button",
                name: "$component_1",
                properties: { text: "Click" },
                layout_properties: { dropzone: "<dropzone>" },
            },
        ]);
    });
});

describe("top-level anvil-form recovery", () => {
    it("treats the first anvil-form as canonical even with leading HTML", () => {
        const html = `<p class="lead">Outside</p>
<anvil-form container="ColumnPanel">
    <anvil-component type="Label" name="lbl" prop:text="'Inside'"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("ColumnPanel");
        const components = parsed.components || [];
        expect(components.length).toBe(2);
        const fragmentComponent = components.find((c) => c.type === "HtmlComponent");
        expect(fragmentComponent).toBeDefined();
        expect(fragmentComponent?.properties?.html).toContain(`<p class="lead">Outside</p>`);
        const labelComponent = components.find((c) => c.type === "Label" && c.name === "lbl");
        expect(labelComponent).toBeDefined();
        expect(labelComponent?.properties).toEqual({ text: "'Inside'" });

        const serialized = serializeFormContainer(parsed);
        const expected = `<anvil-form container="ColumnPanel">
    <p class="lead">Outside</p>
    <anvil-component type="Label" name="lbl" prop:text="'Inside'"></anvil-component>
</anvil-form>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));
    });

    it("appends trailing HTML outside the container into the canonical container", () => {
        const html = `<anvil-form container="ColumnPanel">
    <anvil-component type="Label" name="lbl" prop:text="'Inside'"></anvil-component>
</anvil-form>
<footer>Trailing</footer>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("ColumnPanel");
        const components = parsed.components || [];
        expect(components.length).toBe(2);
        expect(components[0].type).toBe("Label");
        expect(components[0].name).toBe("lbl");
        expect(components[1].type).toBe("HtmlComponent");
        expect(components[1].properties?.html).toContain("<footer>Trailing</footer>");

        const serialized = serializeFormContainer(parsed);
        const expected = `<anvil-form container="ColumnPanel">
    <anvil-component type="Label" name="lbl" prop:text="'Inside'"></anvil-component>
    <footer>Trailing</footer>
</anvil-form>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));
    });

    it("demotes subsequent anvil-form roots to HtmlComponent components", () => {
        const html = `<anvil-form container="ColumnPanel">
    <anvil-component type="Label" name="primary" prop:text="'Primary'"></anvil-component>
</anvil-form>
<anvil-form container="LinearPanel">
    <anvil-component type="Label" name="secondary" prop:text="'Secondary'"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("ColumnPanel");
        const components = parsed.components || [];
        expect(components.length).toBe(2);
        expect(components[0].type).toBe("Label");
        expect(components[0].name).toBe("primary");
        const fragmentComponent = components.find((c) => c.type === "HtmlComponent");
        expect(fragmentComponent).toBeDefined();
        expect(fragmentComponent?.properties?.html).toContain(`<anvil-form container="LinearPanel">`);
        expect(fragmentComponent?.components?.length).toBe(1);
        expect(fragmentComponent?.components?.[0]?.type).toBe("Label");
        expect(fragmentComponent?.components?.[0]?.name).toBe("secondary");

        const serialized = serializeFormContainer(parsed);
        const expected = `<anvil-form container="ColumnPanel">
    <anvil-component type="Label" name="primary" prop:text="'Primary'"></anvil-component>
    <anvil-form container="LinearPanel">
        <anvil-component type="Label" name="secondary" prop:text="'Secondary'"></anvil-component>
    </anvil-form>
</anvil-form>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));
    });

    it("wraps leading anvil-component nodes into the canonical container", () => {
        const html = `<anvil-component type="Label" name="outside" prop:text="'Outside'"></anvil-component>
<anvil-form container="ColumnPanel">
    <anvil-component type="Label" name="inside" prop:text="'Inside'"></anvil-component>
</anvil-form>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("ColumnPanel");
        expectNormalizedComponents(parsed.components, [
            {
                type: "Label",
                name: "outside",
                properties: { text: "'Outside'" },
                layout_properties: undefined,
            },
            {
                type: "Label",
                name: "inside",
                properties: { text: "'Inside'" },
                layout_properties: undefined,
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        const expected = `<anvil-form container="ColumnPanel">
    <anvil-component type="Label" name="outside" prop:text="'Outside'"></anvil-component>
    <anvil-component type="Label" name="inside" prop:text="'Inside'"></anvil-component>
</anvil-form>`;
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(expected));
    });
});
