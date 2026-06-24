import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as parser from "../dist/index.js";
import { BenchCase, PROMOTION_MODES, PROMOTION_OPTIONS, RAW_CASES, PromotionMode } from "./dom-promotion-bench-cases";

const OUTPUT_ROOT = resolve(
    "../..",
    "platform/test/anvil_client_tests/tests_runtime_v3/client_code/DomPromotionRuntimeBenchFixtures"
);
const TEST_MODULE = resolve(
    "../..",
    "platform/test/anvil_client_tests/tests_runtime_v3/client_code/RuntimeBenchTests/fixtures.py"
);

type FixtureMeta = {
    caseName: string;
    mode: PromotionMode;
    className: string;
    moduleName: string;
    componentCount: number;
};

function canonicalizeCase(testCase: BenchCase): BenchCase {
    if (testCase.kind === "layout") {
        const parsed = parser.parseLayoutForm(testCase.html, PROMOTION_OPTIONS.none);
        return { ...testCase, html: parser.serializeFormLayout(parsed) };
    }

    const parsed = parser.parseContainerForm(testCase.html, "HtmlComponent", PROMOTION_OPTIONS.none);
    return { ...testCase, html: parser.serializeFormContainer(parsed) };
}

function componentCount(components: any[]): number {
    let count = 0;
    for (const component of components) {
        count += 1 + componentCount(component.components ?? []);
    }
    return count;
}

function parsedComponentCount(parsed: any): number {
    const roots = [
        ...(parsed.components ?? []),
        ...Object.values(parsed.components_by_slot ?? {}).flatMap((components) => components as any[]),
    ];
    const rootIsHtmlComponent = parsed.container?.type === "HtmlComponent" || parsed.layout?.type === "HtmlComponent";
    return componentCount(roots) + (rootIsHtmlComponent ? 1 : 0);
}

function yamlScalar(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    throw new Error(`Unsupported YAML scalar: ${String(value)}`);
}

function isEmptyCollection(value: unknown): boolean {
    return (
        (Array.isArray(value) && value.length === 0) ||
        (value !== null && typeof value === "object" && Object.keys(value).length === 0)
    );
}

function toYaml(value: unknown, indent = 0): string {
    const prefix = " ".repeat(indent);
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return "[]";
        }
        return value
            .map((item) => {
                if (Array.isArray(item) || (item !== null && typeof item === "object")) {
                    return `${prefix}- ${toYaml(item, indent + 2).trimStart()}`;
                }
                return `${prefix}- ${yamlScalar(item)}`;
            })
            .join("\n");
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).filter(([, entryValue]) => entryValue !== undefined);
        if (entries.length === 0) {
            return "{}";
        }
        return entries
            .map(([key, entryValue]) => {
                if (isEmptyCollection(entryValue)) {
                    return `${prefix}${key}: ${Array.isArray(entryValue) ? "[]" : "{}"}`;
                }
                if (Array.isArray(entryValue) || (entryValue !== null && typeof entryValue === "object")) {
                    return `${prefix}${key}:\n${toYaml(entryValue, indent + 2)}`;
                }
                return `${prefix}${key}: ${yamlScalar(entryValue)}`;
            })
            .join("\n");
    }
    return yamlScalar(value);
}

function classNameFor(caseName: string, mode: PromotionMode): string {
    const base = caseName
        .replace(/ form$/, "")
        .replace(/(^|\s|-)([a-z])/g, (_match, _separator, letter: string) => letter.toUpperCase())
        .replace(/[^A-Za-z0-9]/g, "");
    const modeName = mode[0].toUpperCase() + mode.slice(1);
    return `${base}${modeName}`;
}

function formInit(className: string): string {
    return `from ._anvil_designer import ${className}Template\nfrom anvil import *\n\n\nclass ${className}(${className}Template):\n    def __init__(self, **properties):\n        super().__init__(**properties)\n`;
}

function fixturesPy(fixtures: FixtureMeta[]): string {
    const imports = fixtures
        .map(({ className, moduleName }) => `from ..DomPromotionRuntimeBenchFixtures.${moduleName} import ${className}`)
        .join("\n");
    const cases = fixtures
        .map(
            ({ caseName, mode, className, componentCount }) =>
                `    ("${caseName}", "${mode}", ${className}, ${componentCount}),`
        )
        .join("\n");

    return `${imports}\n\n\nBENCH_FIXTURES = [\n${cases}\n]\n`;
}

async function writeFixture(testCase: BenchCase, mode: PromotionMode): Promise<FixtureMeta> {
    const parsed = parser.parseContainerForm(testCase.html, "HtmlComponent", PROMOTION_OPTIONS[mode]);
    const fixtureYaml = {
        components: parsed.components ?? [],
        container: parsed.container,
        ...(parsed.slots ? { slots: parsed.slots } : {}),
        is_package: true,
    };
    const className = classNameFor(testCase.name, mode);
    const moduleName = className;
    const outputDir = join(OUTPUT_ROOT, moduleName);

    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "__init__.py"), formInit(className));
    await writeFile(join(outputDir, "form_template.yaml"), `${toYaml(fixtureYaml)}\n`);

    return {
        caseName: testCase.name,
        mode,
        className,
        moduleName,
        componentCount: parsedComponentCount(parsed),
    };
}

async function main(): Promise<void> {
    const selectedCases = RAW_CASES.map(canonicalizeCase);
    const fixtures: FixtureMeta[] = [];

    await rm(OUTPUT_ROOT, { recursive: true, force: true });
    await mkdir(OUTPUT_ROOT, { recursive: true });
    await writeFile(join(OUTPUT_ROOT, "__init__.py"), "");

    for (const testCase of selectedCases) {
        for (const mode of PROMOTION_MODES) {
            fixtures.push(await writeFixture(testCase, mode));
        }
    }

    await mkdir(dirname(TEST_MODULE), { recursive: true });
    await writeFile(TEST_MODULE, fixturesPy(fixtures));

    console.log(`Wrote ${fixtures.length} DOM promotion runtime benchmark fixtures.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
