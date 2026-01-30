import { describe, it, expect } from "@rstest/core";
import { parseContainerForm } from "@runtime/html-form/parser";

describe("parseContainerForm normalizeHtml option", () => {
    it("normalizes fragment html by default", () => {
        const originalHtml = "\n        <div>\n            <p>Indented text</p>\n        </div>\n    ";

        const parsed = parseContainerForm(originalHtml);
        const normalized = parsed.container.properties?.html;

        expect(normalized).toBe(`<div>
    <p>Indented text</p>
</div>`);
    });

    it("retains original whitespace when normalizeHtml is false", () => {
        const originalHtml = "\n        <div>\n            <p>Indented text</p>\n        </div>\n    ";

        const parsed = parseContainerForm(originalHtml, "HtmlComponent", { normalizeHtml: false });
        const rawHtml = parsed.container.properties?.html ?? "";

        expect(rawHtml.startsWith("\n        <div>")).toBe(true);
        expect(rawHtml).toContain("            <p>Indented text</p>");
        expect(rawHtml.endsWith("\n        </div>\n    ")).toBe(true);
    });
});
