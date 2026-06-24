import { describe, it, expect } from "@rstest/core";
import { parseContainerForm, serializeFormContainer } from "@anvil-works/form-template-parser";
import type { ParsedFormYaml } from "@anvil-works/form-template-parser";
import { normalizeMultiline } from "./test-utils";

describe("HtmlComponent classes/style root properties", () => {
    it("preserves root class and style attributes in html by default", () => {
        const parsed = parseContainerForm(`<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`);

        expect(parsed.container.properties?.classes).toBeUndefined();
        expect(parsed.container.properties?.style).toBeUndefined();
        expect(parsed.container.properties?.html).toBe(
            `<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`
        );
    });

    it("copies root class and style attributes into component properties when requested", () => {
        const parsed = parseContainerForm(
            `<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`,
            "HtmlComponent",
            { extractRootStyling: true }
        );

        expect(parsed.container.properties?.classes).toEqual(["card", "primary"]);
        expect(parsed.container.properties?.style).toBe("color: red; margin-top: 4px");
        expect(parsed.container.properties?.html).toBe(
            `<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`
        );
    });

    it("can explicitly opt out of root styling extraction", () => {
        const parsed = parseContainerForm(
            `<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`,
            "HtmlComponent",
            { extractRootStyling: false }
        );

        expect(parsed.container.properties?.classes).toBeUndefined();
        expect(parsed.container.properties?.style).toBeUndefined();
        expect(parsed.container.properties?.html).toBe(
            `<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`
        );
    });

    it("serializes classes and style properties as root attributes", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: "<div><span>Hi</span></div>",
                    classes: ["card", "primary"],
                    style: { color: "red", marginTop: "4px" },
                },
            },
            components: [],
        };

        expect(serializeFormContainer(parsed)).toBe(
            `<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`
        );
    });

    it("splits whitespace inside class list entries when serializing", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: "<div></div>",
                    classes: ["foo", "bar baz"],
                },
            },
            components: [],
        };

        expect(serializeFormContainer(parsed)).toBe(`<div class="foo bar baz"></div>`);
    });

    it("splits whitespace inside class dict keys when serializing", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: "<div></div>",
                    classes: { "foo bar": true, "bar baz": false, qux: true },
                },
            },
            components: [],
        };

        expect(serializeFormContainer(parsed)).toBe(`<div class="foo qux"></div>`);
    });

    it("serializes numeric and list style values with property-aware units", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: "<div></div>",
                    style: {
                        marginTop: 4,
                        padding: [12, "40rem", 0, 0],
                        opacity: 0.5,
                        zIndex: 10,
                        font_weight: 600,
                        lineHeight: 1.4,
                        "--gap": 4,
                    },
                },
            },
            components: [],
        };

        expect(serializeFormContainer(parsed)).toBe(
            `<div style="margin-top: 4px; padding: 12px 40rem 0px 0px; opacity: 0.5; z-index: 10; font-weight: 600; line-height: 1.4; --gap: 4"></div>`
        );
    });

    it("updates existing root attributes without duplicating them", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<section class="old" style="color: blue" data-id="1">Hi</section>`,
                    classes: "new featured",
                    style: "color: red",
                },
            },
            components: [],
        };

        expect(serializeFormContainer(parsed)).toBe(`<section data-id="1" class="new featured" style="color: red">Hi</section>`);
    });

    it("serializes copied parser state without duplicating root attributes", () => {
        const parsed = parseContainerForm(
            `<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`,
            "HtmlComponent",
            { extractRootStyling: true }
        );

        expect(serializeFormContainer(parsed)).toBe(
            `<div class="card primary" style="color: red; margin-top: 4px"><span>Hi</span></div>`
        );
        expect(serializeFormContainer(parsed).match(/\bclass=/g)).toHaveLength(1);
        expect(serializeFormContainer(parsed).match(/\bstyle=/g)).toHaveLength(1);

        parsed.container.properties!.classes = ["updated"];
        parsed.container.properties!.style = "color: blue";
        expect(serializeFormContainer(parsed)).toBe(`<div class="updated" style="color: blue"><span>Hi</span></div>`);

        parsed.container.properties!.classes = null;
        parsed.container.properties!.style = null;
        expect(serializeFormContainer(parsed)).toBe(`<div><span>Hi</span></div>`);
    });

    it("does not wrap components appended to single-root HTML with extracted root style", () => {
        const parsed = parseContainerForm(
            `<center style="font-style: italic; color: #888; margin: 3em">
  (Edit this HTML in the HTML pane)
</center>`,
            "HtmlComponent",
            { extractRootStyling: true, domNodePromotion: "annotated" }
        );

        parsed.components = [
            {
                type: "Button",
                name: "button_1",
                properties: { text: "button_1" },
                layout_properties: {},
            },
        ];

        const serialized = serializeFormContainer(parsed, {
            allowReparse: true,
            parserOptions: { extractRootStyling: true, domNodePromotion: "annotated" },
        });

        expect(normalizeMultiline(serialized)).toBe(
            normalizeMultiline(`<center style="font-style: italic; color: #888; margin: 3em">
  (Edit this HTML in the HTML pane)
</center>
<anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>`)
        );
        expect(serialized).not.toMatch(/^<div style=/);
        expect(serialized.match(/\bstyle=/g)).toHaveLength(1);
        expect(parsed.container.properties?.style).toBeUndefined();
    });

    it("still wraps multi-root HTML with explicit root style when appending components", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: "<span>A</span><span>B</span>",
                    style: "display: flex",
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
            normalizeMultiline(`<div style="display: flex">
    <span>A</span><span>B</span>
    <anvil-component type="Button" name="button_1" prop:text="button_1"></anvil-component>
</div>`)
        );
    });

    it("removes root attributes when properties are explicitly cleared", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: {
                    html: `<section class="old" style="color: blue">Hi</section>`,
                    classes: null,
                    style: null,
                },
            },
            components: [],
        };

        expect(serializeFormContainer(parsed)).toBe(`<section>Hi</section>`);
    });

    it("wraps empty and multiple-root html when attributes need a root", () => {
        expect(
            serializeFormContainer({
                container: { type: "HtmlComponent", properties: { html: "", classes: "empty" } },
                components: [],
            })
        ).toBe(`<div class="empty"></div>`);

        const wrapped = serializeFormContainer({
            container: { type: "HtmlComponent", properties: { html: "<span>A</span><span>B</span>", style: "display: flex" } },
            components: [],
        });
        expect(normalizeMultiline(wrapped)).toBe(
            normalizeMultiline(`<div style="display: flex">
    <span>A</span><span>B</span>
</div>`)
        );
    });

    it("uses serializer indentation when wrapping multiple-root html with root attributes", () => {
        const serialized = serializeFormContainer(
            {
                container: {
                    type: "HtmlComponent",
                    properties: { html: "<span>A</span><span>B</span>", style: "display: flex" },
                },
                components: [],
            },
            { indentSize: 2 }
        );

        expect(serialized).toBe(`<div style="display: flex">
  <span>A</span><span>B</span>
</div>`);
    });

    it("preserves existing root attributes when properties are absent", () => {
        const parsed: ParsedFormYaml = {
            container: {
                type: "HtmlComponent",
                properties: { html: `<section class="legacy" style="color: blue">Hi</section>` },
            },
            components: [],
        };

        expect(serializeFormContainer(parsed)).toBe(`<section class="legacy" style="color: blue">Hi</section>`);
    });
});
