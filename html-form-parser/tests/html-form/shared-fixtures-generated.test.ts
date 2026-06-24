import { describe, expect, it } from "@rstest/core";
import fs from "node:fs";
import path from "node:path";
import {
    createDeterministicDropzoneNameGenerator,
    parseContainerForm,
    parseLayoutForm,
    parseSerializedHtml,
    serializeFormContainer,
    serializeFormLayout,
    setDefaultDropzoneNameGenerator,
} from "@anvil-works/form-template-parser";
import type { ParsedFormYaml } from "@anvil-works/form-template-parser";

type Fixture = {
    name: string;
    entrypoint: "parseContainerForm" | "parseLayoutForm" | "parseSerializedHtml";
    html: string;
    containerType?: string;
    options?: Record<string, unknown>;
    normalization?: {
        dropzoneIds?: boolean;
    };
    expected: unknown;
    serializerInput?: unknown;
    expectedSerializedHtml?: string;
};

const fixtureRoot = path.resolve(process.cwd(), "test-fixtures/html-form");

function fixturePaths(root: string): string[] {
    return fs
        .readdirSync(root, { withFileTypes: true })
        .flatMap((entry) => {
            const entryPath = path.join(root, entry.name);
            if (entry.isDirectory()) {
                return fixturePaths(entryPath);
            }
            return entry.name.endsWith(".json") ? [entryPath] : [];
        })
        .sort();
}

function readFixtures(): Fixture[] {
    return fixturePaths(fixtureRoot).map((fixturePath) => JSON.parse(fs.readFileSync(fixturePath, "utf8")));
}

function resetDropzoneGenerator(): void {
    setDefaultDropzoneNameGenerator(() => createDeterministicDropzoneNameGenerator());
}

function parseFixture(fixture: Fixture): any {
    resetDropzoneGenerator();
    switch (fixture.entrypoint) {
        case "parseContainerForm":
            return parseContainerForm(fixture.html, fixture.containerType ?? "HtmlComponent", fixture.options);
        case "parseLayoutForm":
            return parseLayoutForm(fixture.html, fixture.options);
        case "parseSerializedHtml":
            return parseSerializedHtml(fixture.html, fixture.options);
    }
}

function serializeFixture(fixture: Fixture, parsed: any): string {
    const serializerInput: any = fixture.serializerInput ?? parsed;
    return fixture.entrypoint === "parseLayoutForm" || serializerInput.layout
        ? serializeFormLayout(serializerInput)
        : serializeFormContainer(serializerInput);
}

describe("shared html-form fixtures against generated parser", () => {
    it("uses JS-compatible default hash dropzone names", () => {
        setDefaultDropzoneNameGenerator(null as any);
        const parsed = parseContainerForm(
            "<div><anvil-component type='Button' name='b'></anvil-component><anvil-slot name='s'></anvil-slot></div>"
        );

        expect(parsed.components[0]?.layout_properties?.dropzone).toBe("$dz_9iwv7k");
        expect(parsed.slots?.s?.set_layout_properties?.dropzone).toBe("$dz_hfan0g");
    });

    it("accepts serializer options and mutates on allowReparse", () => {
        setDefaultDropzoneNameGenerator(() => createDeterministicDropzoneNameGenerator());
        const parsed: ParsedFormYaml = {
            container: { type: "HtmlComponent", properties: { html: "<div></div>" } },
            components: [{ type: "Button", name: "b", properties: { text: "Click" } }],
        };

        const serialized = serializeFormContainer(parsed, {
            allowReparse: true,
            indentSize: 2,
            parserOptions: { domNodePromotion: "annotated" },
        } as any);

        expect(serialized).toBe(
            '<div></div>\n<anvil-component type="Button" name="b" prop:text="Click"></anvil-component>'
        );
        expect(parsed.container.properties?.html).toBe(
            '<div></div>\n<anvil-dropzone name="$dz_0"></anvil-dropzone>'
        );
        expect(parsed.components[0]?.layout_properties?.dropzone).toBe("$dz_0");
        expect((parsed as any).serialized_html).toBe(serialized);
    });

    for (const fixture of readFixtures()) {
        it(fixture.name, () => {
            const parsed = parseFixture(fixture);
            expect(parsed).toEqual(fixture.expected);

            if (fixture.expectedSerializedHtml !== undefined) {
                expect(serializeFixture(fixture, parsed)).toBe(fixture.expectedSerializedHtml);
            }
        });
    }
});
