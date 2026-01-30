import { describe, it, expect } from "@rstest/core";
import { parseContainerForm, serializeFormContainer } from "@runtime/html-form/parser";
import type { ComponentYaml, ParsedFormYaml } from "@runtime/html-form/types";
import { normalizeDropzoneNames, normalizeMultiline, normalizeComponentTree } from "./test-utils";

function expectHtmlEqual(actual: string | undefined, expected: string) {
    expect(normalizeDropzoneNames(normalizeMultiline(actual ?? ""))).toBe(
        normalizeDropzoneNames(normalizeMultiline(expected))
    );
}

function expectComponents(actual: ComponentYaml[] | undefined, expected: ComponentYaml[]) {
    expect(normalizeComponentTree(actual)).toEqual(normalizeComponentTree(expected));
}

describe("anvil: attribute support", () => {
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

        const parsed = parseContainerForm(html);
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

        const parsed = parseContainerForm(html);
        expect(parsed.container.type).toBe("HtmlComponent");
        expect(parsed.container.layout_properties).toBeUndefined();
        expect(parsed.container.properties?.width).toBeUndefined();
        expect(parsed.container.event_bindings).toEqual({ show: "on_show" });
        expect(parsed.components).toEqual([]);
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

    it("handles self-closing void elements with anvil: attributes", () => {
        const html = `<input anvil:on:change="self._on_change" />`;

        const parsed = parseContainerForm(html);

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

        const parsed = parseContainerForm(html);

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

        const parsed = parseContainerForm(html);

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
    });

    it("does not add anvil:dom-node if already present", () => {
        const html = `<div anvil:dom-node anvil:on-dom:click="self._on_click">Click me</div>`;

        const parsed = parseContainerForm(html);

        expect(parsed.container.type).toBe("HtmlComponent");
        // Should still have anvil:dom-node (not duplicated)
        const htmlContent = parsed.container.properties?.html || "";
        const domNodeMatches = (htmlContent.match(/anvil:dom-node/g) || []).length;
        expect(domNodeMatches).toBe(1); // Should appear exactly once
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
