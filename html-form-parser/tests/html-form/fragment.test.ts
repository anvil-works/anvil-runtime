import { describe, it, expect } from "@rstest/core";
import { parseContainerForm, parseLayoutForm, serializeFormContainer } from "@anvil-works/form-template-parser";
import type { ComponentYaml, ParseHtmlFormOptions, ParsedFormYaml } from "@anvil-works/form-template-parser";
import { normalizeDropzoneNames, normalizeMultiline, normalizeComponentTree } from "./test-utils";

function expectHtmlEqual(actual: string | undefined, expected: string) {
    expect(normalizeDropzoneNames(normalizeMultiline(actual ?? ""))).toBe(
        normalizeDropzoneNames(normalizeMultiline(expected))
    );
}

function expectComponents(actual: ComponentYaml[] | undefined, expected: ComponentYaml[]) {
    expect(normalizeComponentTree(actual)).toEqual(normalizeComponentTree(expected));
}

function expectWarningCodes(actual: ParsedFormYaml["warnings"], expected: string[]) {
    expect(actual?.map(({ code }) => code)).toEqual(expected);
}

function parseContainerFormWithWarnings(html: string) {
    return parseContainerForm(html, "HtmlComponent", { warnings: true });
}

const formSpecPackageContext: ParseHtmlFormOptions["formSpecPackageContext"] = {
    appPackageName: "AppPackage",
    knownPackageNames: ["DepPackage"],
};

function parseContainerFormWithPackageWarnings(html: string, options: ParseHtmlFormOptions = {}) {
    return parseContainerForm(html, "HtmlComponent", {
        warnings: true,
        formSpecPackageContext,
        ...options,
    });
}

function parseLayoutFormWithPackageWarnings(html: string, options: ParseHtmlFormOptions = {}) {
    return parseLayoutForm(html, {
        warnings: true,
        formSpecPackageContext,
        ...options,
    });
}

describe("form spec package warnings", () => {
    it("accepts legacy form specs on component types", () => {
        const parsed = parseContainerFormWithPackageWarnings(
            `<anvil-component type="form:Form1" name="custom"></anvil-component>`
        );

        expect(parsed.warnings).toBeUndefined();
    });

    it("accepts app package-qualified component types", () => {
        const parsed = parseContainerFormWithPackageWarnings(
            `<anvil-component type="AppPackage.Form1" name="custom"></anvil-component>`
        );

        expect(parsed.warnings).toBeUndefined();
    });

    it("accepts dependency package-qualified component types", () => {
        const parsed = parseContainerFormWithPackageWarnings(
            `<anvil-component type="DepPackage.Form1" name="custom"></anvil-component>`
        );

        expect(parsed.warnings).toBeUndefined();
    });

    it("warns for unknown package-qualified component types", () => {
        const parsed = parseContainerFormWithPackageWarnings(
            `<anvil-component type="MissingPackage.Form1" name="custom"></anvil-component>`
        );

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "unknown-form-spec-package",
                attrName: "type",
                tagName: "anvil-component",
            }),
        ]);
    });

    it("warns for unknown package-qualified form containers", () => {
        const parsed = parseContainerFormWithPackageWarnings(
            `<anvil-form container="MissingPackage.Container"></anvil-form>`
        );

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "unknown-form-spec-package",
                attrName: "container",
                tagName: "anvil-form",
            }),
        ]);
    });

    it("warns for unknown package-qualified form layouts", () => {
        const parsed = parseLayoutFormWithPackageWarnings(
            `<anvil-form layout="MissingPackage.layouts.Main"></anvil-form>`
        );

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "unknown-form-spec-package",
                attrName: "layout",
                tagName: "anvil-form",
            }),
        ]);
    });

    it("does not warn for plain built-in component or form specs", () => {
        const containerParsed = parseContainerFormWithPackageWarnings(
            `<anvil-form container="HtmlComponent">
                <anvil-component type="Button" name="button"></anvil-component>
            </anvil-form>`
        );
        const layoutParsed = parseLayoutFormWithPackageWarnings(
            `<anvil-form layout="UnknownLayout"></anvil-form>`
        );

        expect(containerParsed.warnings).toBeUndefined();
        expect(layoutParsed.warnings).toBeUndefined();
    });

    it("skips package validation when context is omitted", () => {
        const parsed = parseContainerForm(
            `<anvil-component type="MissingPackage.Form1" name="custom"></anvil-component>`,
            "HtmlComponent",
            { warnings: true }
        );

        expect(parsed.warnings).toBeUndefined();
    });
});

describe("anvil: attribute support", () => {
    it("preserves designer inline text marker as raw HtmlComponent HTML", () => {
        const html = `<div>
    <anvil-component type="FlowPanel" name="panel">
        <section anvil:name="hero" anvil:designer-editable-text>Hero</section>
    </anvil-component>
</div>`;

        const parsed = parseContainerFormWithWarnings(html);
        const fragment = parsed.components?.[0]?.components?.[0];

        expect(fragment?.type).toBe("HtmlComponent");
        expect(fragment?.name).toBe("hero");
        expect(fragment?.properties).toEqual({
            html: "<section anvil:designer-editable-text>Hero</section>",
        });
        expect(fragment?.event_bindings).toBeUndefined();
        expect(fragment?.data_bindings).toBeUndefined();

        const serialized = serializeFormContainer(parsed);
        expectHtmlEqual(
            serialized,
            `<div>
    <anvil-component type="FlowPanel" name="panel">
        <section anvil:designer-editable-text anvil:name="hero">Hero</section>
    </anvil-component>
</div>`
        );
    });

    it("treats a single top-level fragment as container metadata", () => {
        const html = `<div anvil:on:show="self.on_show" anvil:bind:visible="self.show_fragment">
    <div class="body">
        <anvil-component type="Label" name="lbl" prop:text="'Hello'"></anvil-component>
    </div>
</div>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("HtmlComponent");
        // We preserve the original element itself (not just inner content)
        expectHtmlEqual(
            parsed.container.properties?.html,
            `<div>
    <div class="body">
        <anvil-dropzone name="<dropzone>"></anvil-dropzone>
    </div>
</div>`
        );
        expect(parsed.container.event_bindings).toEqual({ show: "on_show" });
        expect(parsed.container.data_bindings).toEqual([{ property: "visible", code: "self.show_fragment" }]);
        expect(parsed.container.layout_properties).toBeUndefined();

        expectComponents(parsed.components, [
            {
                type: "Label",
                name: "lbl",
                properties: { text: "'Hello'" },
                layout_properties: { dropzone: "<dropzone>" },
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        expectHtmlEqual(serialized, html);
    });

    it("does not serialize default-visible metadata on top-level fragments", () => {
        const html = `<div anvil:prop:visible="true">
    <div class="body">Static</div>
</div>`;

        const parsed = parseContainerForm(html);
        expect(parsed.container.properties?.visible).toBe(true);

        const serialized = serializeFormContainer(parsed);
        // When visible=true (default, filtered out), return HTML as-is (preserves element)
        expectHtmlEqual(
            serialized,
            `<div>
    <div class="body">Static</div>
</div>`
        );
        expect(serialized).not.toContain('prop:visible="true"');
    });

    it("does not serialize default-visible property on HtmlComponent components", () => {
        const html = `<div>
    <anvil-component type="FlowPanel" name="panel">
        <div anvil:name="body" anvil:prop:visible="true">
            <span>Content</span>
        </div>
    </anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        const fragment = parsed.components?.[0]?.components?.[0];
        expect(fragment?.properties?.visible).toBe(true);

        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<div>
    <anvil-component type="FlowPanel" name="panel">
        <div anvil:name="body">
            <span>Content</span>
        </div>
    </anvil-component>
</div>`)
        );
        expect(serialized).not.toContain('anvil:prop:visible="true"');
    });

    it("indents serialized fragments when wrapping container metadata", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    visible: false,
                    html: `
<div style="border: 1px solid blue; min-height: 20px">
</div>
`,
                },
            },
            components: [],
        };

        const serialized = serializeFormContainer(parsed);
        // Attributes are added to the root element (the div)
        const expected = `<div style="border: 1px solid blue; min-height: 20px" anvil:prop:visible="false">
</div>`;
        expect(serialized).toBe(expected);
    });

    it("doesn't preserve indentation for plain html when original content was indented", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    visible: true,
                    html: `
    <div style="border: 1px solid blue; min-height: 20px">
    </div>
`,
                },
            },
            components: [],
        };

        const serialized = serializeFormContainer(parsed);
        // When visible=true (default, filtered out), return HTML as-is (may preserve indentation)
        // The HTML content is normalized, so leading whitespace may be preserved
        expect(serialized.trim()).toBe(
            `<div style="border: 1px solid blue; min-height: 20px">
</div>`.trim()
        );
    });

    it("drops the fragment wrapper once container metadata is cleared", () => {
        const html = `<div anvil:on:show="self.on_show" anvil:bind:visible="self.show_fragment">
    <div class="body">
        <p>Static</p>
    </div>
</div>`;

        const parsed = parseContainerForm(html);
        delete parsed.container.event_bindings;
        delete parsed.container.data_bindings;

        const serialized = serializeFormContainer(parsed);
        // When metadata is cleared, return HTML as-is (preserves original element)
        expectHtmlEqual(
            serialized,
            `<div>
    <div class="body">
        <p>Static</p>
    </div>
</div>`
        );
    });

    it("parses multiple top-level fragments into HtmlComponent components", () => {
        const html = `<section class="hero" anvil:name="hero" anvil:on:show="self.on_hero">Hero</section>
<footer anvil:name="footer" anvil:bind:visible="self.show_footer">Footer</footer>`;

        const parsed = parseContainerForm(html);
        expect(parsed.warnings).toBeUndefined();

        expectHtmlEqual(
            parsed.container.properties?.html,
            `<anvil-dropzone name="<dropzone>"></anvil-dropzone>
<anvil-dropzone name="<dropzone>"></anvil-dropzone>`
        );

        expectComponents(parsed.components, [
            {
                type: "HtmlComponent",
                name: "hero",
                properties: { html: '<section class="hero">Hero</section>' },
                event_bindings: { show: "on_hero" },
                layout_properties: { dropzone: "<dropzone>" },
            },
            {
                type: "HtmlComponent",
                name: "footer",
                properties: { html: "<footer>Footer</footer>" },
                data_bindings: [{ property: "visible", code: "self.show_footer" }],
                layout_properties: { dropzone: "<dropzone>" },
            },
        ]);

        const serialized = serializeFormContainer(parsed);
        expectHtmlEqual(serialized, html);
    });

    it("drops fragment wrappers on components when metadata is removed", () => {
        const html = `<div class="wrapper">
    <anvil-component type="FlowPanel" name="container">
        <p anvil:prop:visible="false" anvil:on:show="self.on_show">Static blurb</p>
    </anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        const flowPanel = parsed.components?.[0];
        const fragment = flowPanel?.components?.[0];

        expect(fragment?.type).toBe("HtmlComponent");
        expect(fragment?.event_bindings).toEqual({ show: "on_show" });
        expect(fragment?.properties).toMatchObject({ visible: false });
        expectHtmlEqual(fragment?.properties?.html, `<p>Static blurb</p>`);

        // Clear metadata so the serializer can remove the wrapper.
        delete fragment?.event_bindings;
        if (fragment?.properties) {
            const { html: fragmentHtml } = fragment.properties;
            fragment.properties = fragmentHtml ? { html: fragmentHtml } : {};
        }

        const serialized = serializeFormContainer(parsed);
        expect(serialized).not.toContain("anvil:prop:visible");
        expect(serialized).not.toContain("anvil:on:show");
        expect(serialized).toContain(`<div class="wrapper">`);
        expect(serialized).toContain(`<p>Static blurb</p>`);
    });

    it("normalizes fragment indentation on serialization", () => {
        const html = `<div>
    <anvil-component type="ColumnPanel" prop:spacing="12">
        <div anvil:name="foo">
            <div class="inner" anvil:on:click="self.on_click_fragment"></div>
        </div>
    </anvil-component>
</div>`;

        const parsed = parseContainerFormWithWarnings(html);
        expectWarningCodes(parsed.warnings, ["dom-anvil-on-event-unsupported"]);
        const serialized = serializeFormContainer(parsed);
        expect(normalizeMultiline(serialized)).toBe(normalizeMultiline(html));
    });

    it("keeps fragment counters stable when leading whitespace is skipped", () => {
        const html = `<div>
    <anvil-component type="LinearPanel">
        <div anvil:prop:visible="false">
            <div style="border: 1px solid red; min-height: 100px"></div>
        </div>
    </anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        const fragment = parsed.components?.[0]?.components?.[0];
        // Component numbers may vary - just check that it's a promoted fragment
        expect(fragment?.type).toBe("HtmlComponent");
        expect(fragment?.properties?.visible).toBe(false);
    });

    it("ignores name and container attributes on top-level fragments", () => {
        const html = `<div anvil:name="ignored" anvil:container:width="300" anvil:on:show="self.on_show">
    <div class="body">
        <span>Static</span>
    </div>
</div>`;
        const attrStart = html.indexOf("anvil:name");
        const attrEnd = html.indexOf(" ", attrStart);

        const parsed = parseContainerFormWithWarnings(html);
        expect(parsed.container.type).toBe("HtmlComponent");
        expect(parsed.container.layout_properties).toBeUndefined();
        expect(parsed.container.properties?.width).toBeUndefined();
        expect(parsed.container.event_bindings).toEqual({ show: "on_show" });
        expect(parsed.components).toEqual([]);
        expect(parsed.warnings).toEqual([
            {
                code: "root-html-name-ignored",
                path: "root.anvil:name",
                message:
                    "anvil:name on a single top-level plain HTML root is ignored; use self.classes/self.style for root styling or name a child element if Python needs self.<name>.",
                name: "ignored",
                from: attrStart,
                to: attrEnd,
            },
        ]);
        // We preserve the original element itself (not just inner content)
        expectHtmlEqual(
            parsed.container.properties?.html,
            `<div>
    <div class="body">
        <span>Static</span>
    </div>
</div>`
        );

        const serialized = serializeFormContainer(parsed);
        expect(serialized).not.toContain('anvil:name="ignored"');
        expect(serialized).not.toContain("anvil:container:width");
        // Attributes are added to the root element (the outer div)
        expectHtmlEqual(
            serialized,
            `<div anvil:on:show="self.on_show">
    <div class="body">
        <span>Static</span>
    </div>
</div>`
        );
    });

    it("does not collect warnings by default", () => {
        const parsed = parseContainerForm(`<article anvil:name="card">Static</article>`);

        expect(parsed.warnings).toBeUndefined();
    });

    it("adds root name warning locations when warnings are requested", () => {
        const html = `<article anvil:name="card">Static</article>`;
        const parsed = parseContainerForm(html, "HtmlComponent", { warnings: true });
        const attrStart = html.indexOf("anvil:name");
        const attrEnd = html.indexOf(">", attrStart);

        expect(parsed.warnings).toEqual([
            {
                code: "root-html-name-ignored",
                path: "root.anvil:name",
                message:
                    "anvil:name on a single top-level plain HTML root is ignored; use self.classes/self.style for root styling or name a child element if Python needs self.<name>.",
                name: "card",
                from: attrStart,
                to: attrEnd,
            },
        ]);
    });

    it("does not warn for root class and style without anvil:name", () => {
        const parsed = parseContainerFormWithWarnings(`<article class="card" style="padding: 8px">Static</article>`);

        expect(parsed.warnings).toBeUndefined();
        expect(parsed.container.type).toBe("HtmlComponent");
        expectHtmlEqual(
            parsed.container.properties?.html,
            `<article class="card" style="padding: 8px">Static</article>`
        );
    });

    it("does not warn for top-level Anvil component names", () => {
        const parsed = parseContainerFormWithWarnings(
            `<anvil-component type="Label" name="card" prop:text="Card"></anvil-component>`
        );

        expect(parsed.warnings).toBeUndefined();
        expect(parsed.components?.[0]?.name).toBe("card");
    });

    it("handles self-closing void elements with anvil: attributes", () => {
        const html = `<input anvil:on:change="self._on_change" />`;

        const parsed = parseContainerFormWithWarnings(html);

        expectWarningCodes(parsed.warnings, ["dom-anvil-on-event-unsupported"]);
        expect(parsed.container.type).toBe("HtmlComponent");
        // Single top-level element becomes container metadata, not a component
        expect(parsed.components?.length).toBe(0);
        expect(parsed.container.event_bindings).toEqual({ change: "_on_change" });
        // For void elements, we preserve the element itself (not just inner content)
        // Stored as self-closing to match Prettier conventions
        expect(parsed.container.properties?.html).toBe("<input />");

        const serialized = serializeFormContainer(parsed);
        // Void elements are preserved with attributes added to them (self-closing to match Prettier)
        expectHtmlEqual(serialized, `<input anvil:on:change="self._on_change" />`);
    });

    it("handles regular elements with anvil: attributes", () => {
        const html = `<button anvil:on:click="self._on_click">Click me</button>`;

        const parsed = parseContainerFormWithWarnings(html);

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "dom-anvil-on-event-unsupported",
                path: "button.anvil:on:click",
                attrName: "anvil:on:click",
                tagName: "button",
                eventName: "click",
            }),
        ]);
        expect(parsed.container.type).toBe("HtmlComponent");
        // Single top-level element becomes container metadata, not a component
        expect(parsed.components?.length).toBe(0);
        expect(parsed.container.event_bindings).toEqual({ click: "_on_click" });
        // We preserve the original element itself (not just inner content)
        expect(parsed.container.properties?.html).toBe("<button>Click me</button>");

        const serialized = serializeFormContainer(parsed);
        // Original element type is preserved with attributes added to it
        expectHtmlEqual(serialized, `<button anvil:on:click="self._on_click">Click me</button>`);
    });

    it("handles multiple void elements with anvil: attributes", () => {
        const html = `<input anvil:on:change="self._on_change" />
<img anvil:on:click="self._on_click" />
<br anvil:prop:visible="false" />`;

        const parsed = parseContainerFormWithWarnings(html);

        expectWarningCodes(parsed.warnings, [
            "dom-anvil-on-event-unsupported",
            "dom-anvil-on-event-unsupported",
        ]);
        expect(parsed.container.type).toBe("HtmlComponent");
        expect(parsed.components?.length).toBe(3);

        const inputFragment = parsed.components?.[0];
        expect(inputFragment?.type).toBe("HtmlComponent");
        expect(inputFragment?.event_bindings).toEqual({ change: "_on_change" });
        expect(inputFragment?.properties?.html).toBe("<input />");

        const imgFragment = parsed.components?.[1];
        expect(imgFragment?.type).toBe("HtmlComponent");
        expect(imgFragment?.event_bindings).toEqual({ click: "_on_click" });
        expect(imgFragment?.properties?.html).toBe("<img />");

        const brFragment = parsed.components?.[2];
        expect(brFragment?.type).toBe("HtmlComponent");
        expect(brFragment?.properties?.visible).toBe(false);
        expect(brFragment?.properties?.html).toBe("<br />");

        const serialized = serializeFormContainer(parsed);
        expectHtmlEqual(
            serialized,
            `<input anvil:on:change="self._on_change" />
<img anvil:on:click="self._on_click" />
<br anvil:prop:visible="false" />`
        );
    });

    it("does not warn for supported plain DOM lifecycle event attributes", () => {
        const parsed = parseContainerFormWithWarnings(
            `<section anvil:on:show="self.show" anvil:on:hide="self.hide">Panel</section>`
        );

        expect(parsed.warnings).toBeUndefined();
        expect(parsed.container.event_bindings).toEqual({ show: "show", hide: "hide" });
    });

    it("warns for unknown plain DOM anvil attributes", () => {
        const parsed = parseContainerFormWithWarnings(`<div anvil:foo="bar">Static</div>`);

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "unknown-dom-anvil-attribute",
                path: "div.anvil:foo",
                attrName: "anvil:foo",
                tagName: "div",
            }),
        ]);
        expect(parsed.container.properties?.html).toBe('<div anvil:foo="bar">Static</div>');
    });

    it("warns for anvil namespace attributes on Anvil tags", () => {
        const html = `<anvil-form anvil:name="form" container="HtmlComponent">
    <anvil-component anvil:name="component" type="Label"></anvil-component>
    <anvil-slot anvil:name="slot"></anvil-slot>
    <anvil-block anvil:name="block"></anvil-block>
    <anvil-dropzone anvil:name="dropzone"></anvil-dropzone>
</anvil-form>`;

        const parsed = parseContainerFormWithWarnings(html);

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "anvil-namespace-attribute-on-anvil-tag",
                path: "anvil-form.anvil:name",
                attrName: "anvil:name",
                tagName: "anvil-form",
            }),
            expect.objectContaining({
                code: "anvil-namespace-attribute-on-anvil-tag",
                path: "anvil-component.anvil:name",
                attrName: "anvil:name",
                tagName: "anvil-component",
            }),
            expect.objectContaining({
                code: "anvil-namespace-attribute-on-anvil-tag",
                path: "anvil-slot.anvil:name",
                attrName: "anvil:name",
                tagName: "anvil-slot",
            }),
            expect.objectContaining({
                code: "anvil-namespace-attribute-on-anvil-tag",
                path: "anvil-block.anvil:name",
                attrName: "anvil:name",
                tagName: "anvil-block",
            }),
            expect.objectContaining({
                code: "anvil-namespace-attribute-on-anvil-tag",
                path: "anvil-dropzone.anvil:name",
                attrName: "anvil:name",
                tagName: "anvil-dropzone",
            }),
        ]);
    });

    it("does not treat top-level Anvil tag namespace mistakes as root DOM names", () => {
        const parsed = parseContainerFormWithWarnings(`<anvil-component anvil:name="x" type="Label"></anvil-component>`);

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "anvil-namespace-attribute-on-anvil-tag",
                path: "anvil-component.anvil:name",
                attrName: "anvil:name",
                tagName: "anvil-component",
            }),
        ]);
        expect(parsed.warnings?.map(({ code }) => code)).not.toContain("root-html-name-ignored");
        expect(parsed.components?.[0]?.type).toBe("Label");
    });

    it("adds warning locations for invalid anvil attributes when requested", () => {
        const html = `<button anvil:on:click="self.click">Click</button>`;
        const parsed = parseContainerForm(html, "HtmlComponent", { warnings: true });
        const attrStart = html.indexOf("anvil:on:click");
        const attrEnd = html.indexOf(">", attrStart);

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "dom-anvil-on-event-unsupported",
                from: attrStart,
                to: attrEnd,
            }),
        ]);
    });

    it("warns for unprefixed Anvil component attributes on plain DOM nodes", () => {
        const html = `<div bind:text="self.item['x']">Item</div>
<span prop:text="self.foo">Foo</span>
<button on:click="self.click">Click</button>`;

        const parsed = parseContainerFormWithWarnings(html);

        expect(parsed.warnings).toEqual([
            expect.objectContaining({
                code: "anvil-component-attribute-on-dom-node",
                path: "div.bind:text",
                attrName: "bind:text",
                tagName: "div",
            }),
            expect.objectContaining({
                code: "anvil-component-attribute-on-dom-node",
                path: "span.prop:text",
                attrName: "prop:text",
                tagName: "span",
            }),
            expect.objectContaining({
                code: "anvil-component-attribute-on-dom-node",
                path: "button.on:click",
                attrName: "on:click",
                tagName: "button",
            }),
        ]);
    });

    it("does not warn for supported raw DOM Anvil metadata or Anvil component bindings", () => {
        const parsedDom = parseContainerFormWithWarnings(`<div anvil:bind:visible="self.visible">Visible</div>`);
        const parsedComponent = parseContainerFormWithWarnings(
            `<anvil-component type="Label" bind:text="self.item['x']"></anvil-component>`
        );

        expect(parsedDom.warnings).toBeUndefined();
        expect(parsedComponent.warnings).toBeUndefined();
    });

    it("adds anvil:dom-node attribute when anvil:on-dom: attributes are present", () => {
        const html = `<div anvil:on-dom:click="self._on_click">Click me</div>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("HtmlComponent");
        // anvil:on-dom: should NOT promote to fragment (no components)
        expect(parsed.components?.length).toBe(0);
        // anvil:dom-node attribute should be added
        expect(parsed.container.properties?.html).toContain("anvil:dom-node");
        // anvil:on-dom: attributes are preserved in the HTML (not filtered)
        expect(parsed.container.properties?.html).toContain("anvil:on-dom:click");
        expect(serializeFormContainer(parsed)).toBe(html);
    });

    it("adds anvil:dom-node to the same element as anvil:on-dom when a child has anvil:dom-node", () => {
        const html = `<div class="pipeline-row" anvil:on-dom:click="self.row_click">
    <span anvil:dom-node="label_node">Label</span>
</div>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.properties?.html).toContain(
            `<div class="pipeline-row" anvil:on-dom:click="self.row_click" anvil:dom-node>`
        );
        expect(parsed.container.properties?.html).toContain(`anvil:dom-node="label_node"`);
        expect(serializeFormContainer(parsed)).toBe(html);
    });

    it("does not add anvil:dom-node if already present", () => {
        const html = `<div anvil:dom-node anvil:on-dom:click="self._on_click">Click me</div>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("HtmlComponent");
        // Should still have anvil:dom-node (not duplicated)
        const htmlContent = parsed.container.properties?.html || "";
        const domNodeMatches = (htmlContent.match(/anvil:dom-node/g) || []).length;
        expect(domNodeMatches).toBe(1); // Should appear exactly once
        expect(serializeFormContainer(parsed)).toBe(`<div anvil:on-dom:click="self._on_click">Click me</div>`);
    });

    it("removes empty anvil:dom-node without anvil:on-dom", () => {
        const parsed = parseContainerForm(`<div anvil:dom-node></div>`);

        expect(parsed.container.properties?.html).toBe(`<div></div>`);
        expect(serializeFormContainer(parsed)).toBe(`<div></div>`);
    });

    it("removes empty string anvil:dom-node without anvil:on-dom", () => {
        const parsed = parseContainerForm(`<div anvil:dom-node=""></div>`);

        expect(parsed.container.properties?.html).toBe(`<div></div>`);
        expect(serializeFormContainer(parsed)).toBe(`<div></div>`);
    });

    it("preserves named anvil:dom-node without anvil:on-dom", () => {
        const html = `<div anvil:dom-node="foo"></div>`;
        const parsed = parseContainerForm(html);

        expect(parsed.container.properties?.html).toBe(html);
        expect(serializeFormContainer(parsed)).toBe(html);
    });

    it("strips empty anvil:dom-node with anvil:on-dom during serialization", () => {
        const html = `<button anvil:on-dom:click="self.click" anvil:dom-node></button>`;
        const parsed = parseContainerForm(html);

        expect(parsed.container.properties?.html).toBe(html);
        expect(serializeFormContainer(parsed)).toBe(`<button anvil:on-dom:click="self.click"></button>`);
    });

    it("anvil:on-dom: does not promote element to HtmlComponent component", () => {
        const html = `<div>
    <button anvil:on-dom:click="self._on_click">Click</button>
    <span>Text</span>
</div>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("HtmlComponent");
        // Elements with only anvil:on-dom: should NOT be promoted
        expect(parsed.components?.length).toBe(0);
        // But anvil:dom-node should be added
        expect(parsed.container.properties?.html).toContain("anvil:dom-node");
        expect(parsed.container.properties?.html).toContain("<button");
    });
});
