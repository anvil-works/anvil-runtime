import { performance } from "node:perf_hooks";
import * as parser from "../dist/index.js";
import { BenchCase, PROMOTION_MODES, PROMOTION_OPTIONS, RAW_CASES, PromotionMode } from "./dom-promotion-bench-cases";

type ModelStats = {
    componentCount: number;
    htmlComponentCount: number;
    maxDepth: number;
    serializedLength: number;
};

type BenchMode = "parse" | "parse+serialize";

type BenchResult = ModelStats & {
    caseName: string;
    mode: BenchMode;
    promotionMode: PromotionMode;
    median: number;
    p95: number;
};

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 25;

function canonicalizeCase(testCase: BenchCase): BenchCase {
    if (testCase.kind === "layout") {
        const parsed = parser.parseLayoutForm(testCase.html, PROMOTION_OPTIONS.none);
        return { ...testCase, html: parser.serializeFormLayout(parsed) };
    }

    const parsed = parser.parseContainerForm(testCase.html, "HtmlComponent", PROMOTION_OPTIONS.none);
    return { ...testCase, html: parser.serializeFormContainer(parsed) };
}

const CASES = RAW_CASES.map(canonicalizeCase);

function percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
    return sorted[index] ?? 0;
}

function median(values: number[]): number {
    return percentile(values, 0.5);
}

function componentStats(components: any[], depth = 1): Omit<ModelStats, "serializedLength"> {
    let componentCount = 0;
    let htmlComponentCount = 0;
    let maxDepth = 0;

    for (const component of components) {
        componentCount += 1;
        if (component.type === "HtmlComponent") {
            htmlComponentCount += 1;
        }
        maxDepth = Math.max(maxDepth, depth);
        const childStats = componentStats(component.components ?? [], depth + 1);
        componentCount += childStats.componentCount;
        htmlComponentCount += childStats.htmlComponentCount;
        maxDepth = Math.max(maxDepth, childStats.maxDepth);
    }

    return { componentCount, htmlComponentCount, maxDepth };
}

function getParsedStats(parsed: any, serializedLength: number): ModelStats {
    const roots = [
        ...(parsed.components ?? []),
        ...Object.values(parsed.components_by_slot ?? {}).flatMap((components) => components as any[]),
    ];
    const stats = componentStats(roots);
    const rootIsHtmlComponent = parsed.container?.type === "HtmlComponent" || parsed.layout?.type === "HtmlComponent";

    return {
        componentCount: stats.componentCount + (rootIsHtmlComponent ? 1 : 0),
        htmlComponentCount: stats.htmlComponentCount + (rootIsHtmlComponent ? 1 : 0),
        maxDepth: stats.maxDepth + (rootIsHtmlComponent && stats.maxDepth ? 1 : 0),
        serializedLength,
    };
}

function runParser(testCase: BenchCase, promotionMode: PromotionMode, roundTrip: boolean): ModelStats {
    const options = PROMOTION_OPTIONS[promotionMode];
    if (testCase.kind === "layout") {
        const parsed = parser.parseLayoutForm(testCase.html, options);
        const serialized = roundTrip ? parser.serializeFormLayout(parsed) : "";
        if (roundTrip && serialized !== testCase.html) {
            throw new Error(`${testCase.name} (${promotionMode}) layout serialization did not match input HTML`);
        }
        return getParsedStats(parsed, serialized.length);
    }

    const parsed = parser.parseContainerForm(testCase.html, "HtmlComponent", options);
    const serialized = roundTrip ? parser.serializeFormContainer(parsed) : "";
    if (roundTrip && serialized !== testCase.html) {
        throw new Error(`${testCase.name} (${promotionMode}) container serialization did not match input HTML`);
    }
    return getParsedStats(parsed, serialized.length);
}

function measure(
    testCase: BenchCase,
    promotionMode: PromotionMode,
    roundTrip: boolean
): { samples: number[]; stats: ModelStats } {
    let stats = runParser(testCase, promotionMode, roundTrip);
    for (let i = 0; i < WARMUP_RUNS; i += 1) {
        stats = runParser(testCase, promotionMode, roundTrip);
    }

    const samples: number[] = [];
    for (let i = 0; i < MEASURED_RUNS; i += 1) {
        const start = performance.now();
        stats = runParser(testCase, promotionMode, roundTrip);
        samples.push(performance.now() - start);
    }

    return { samples, stats };
}

function formatMs(value: number): string {
    return `${value.toFixed(3)}ms`;
}

function printTable(title: string, results: BenchResult[]): void {
    const columns = [
        { header: "Case", value: (result: BenchResult) => result.caseName },
        { header: "Parse method", value: (result: BenchResult) => result.promotionMode },
        { header: "Components", value: (result: BenchResult) => String(result.componentCount) },
        { header: "Median", value: (result: BenchResult) => formatMs(result.median) },
        { header: "p95", value: (result: BenchResult) => formatMs(result.p95) },
        { header: "HtmlComponents", value: (result: BenchResult) => String(result.htmlComponentCount) },
        { header: "MaxDepth", value: (result: BenchResult) => String(result.maxDepth) },
        { header: "RoundTrip", value: (result: BenchResult) => (result.mode === "parse+serialize" ? "same" : "-") },
    ];
    const widths = columns.map((column) =>
        Math.max(column.header.length, ...results.map((result) => column.value(result).length))
    );
    const printCells = (cells: string[]) =>
        console.log(cells.map((cell, index) => cell.padEnd(widths[index])).join("  "));

    console.log(`\n${title}`);
    printCells(columns.map((column) => column.header));
    printCells(widths.map((width) => "-".repeat(width)));
    for (const result of results) {
        printCells(columns.map((column) => column.value(result)));
    }
}

const results: BenchResult[] = [];

for (const testCase of CASES) {
    for (const promotionMode of PROMOTION_MODES) {
        for (const roundTrip of [false, true]) {
            const { samples, stats } = measure(testCase, promotionMode, roundTrip);
            results.push({
                caseName: testCase.name,
                mode: roundTrip ? "parse+serialize" : "parse",
                promotionMode,
                median: median(samples),
                p95: percentile(samples, 0.95),
                ...stats,
            });
        }
    }
}

console.log("HTML form parser CLJS DOM promotion benchmark");
console.log(`${MEASURED_RUNS} measured samples after ${WARMUP_RUNS} warmup runs.`);
console.log("Parse + serialize rows assert exact serialized HTML equality with the input HTML.");
printTable(
    "Parse only",
    results.filter((result) => result.mode === "parse")
);
printTable(
    "Parse + serialize",
    results.filter((result) => result.mode === "parse+serialize")
);
