import type { Element, Node, SlotTarget, TextNode } from "./types";

const VOID_ELEMENTS = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
]);

// Cache for lowercase tag names to avoid repeated toLowerCase() calls
const tagNameCache = new WeakMap<Element, string>();

export function getLowerTagName(element: Element): string {
    const cached = tagNameCache.get(element);
    if (cached !== undefined) {
        return cached;
    }
    // parse5 already returns lowercase tag names, but we cache for consistency
    const lower = element.tagName.toLowerCase();
    tagNameCache.set(element, lower);
    return lower;
}

export const stripAnvilPrefix = (value: string): string => (value.startsWith("anvil.") ? value.substring(6) : value);

function escapeForDoubleQuotes(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeForSingleQuotes(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
}

export function formatAttribute(name: string, value: string): string {
    // Empty values: render as boolean attribute (no =""), except for property attributes
    if (value === "") {
        // Property attributes should keep ="" even when empty
        if (
            name.startsWith("anvil:prop:") ||
            name.startsWith("prop:") ||
            name.startsWith("anvil:container:") ||
            name.startsWith("container:")
        ) {
            return `${name}=""`;
        }
        // All other empty attributes render as boolean (no ="")
        return name;
    }

    // Non-empty values: render with quotes as before
    if (!value.includes('"')) {
        return `${name}="${escapeForDoubleQuotes(value)}"`;
    }
    if (!value.includes("'")) {
        return `${name}='${escapeForSingleQuotes(value)}'`;
    }
    return `${name}="${escapeForDoubleQuotes(value)}"`;
}

export function renderElement(tagName: string, attrs: { name: string; value: string }[], innerHtml: string): string {
    const attrString = attrs.map(({ name, value }) => formatAttribute(name, value)).join(" ");
    if (VOID_ELEMENTS.has(tagName)) {
        // Self-close void elements to match Prettier conventions
        return attrString.length > 0 ? `<${tagName} ${attrString} />` : `<${tagName} />`;
    }
    const open = attrString.length > 0 ? `<${tagName} ${attrString}>` : `<${tagName}>`;
    return `${open}${innerHtml}</${tagName}>`;
}

// Shared constants
export const BIND_PREFIX = "bind:";
export const WRITEBACK_PREFIX = "writeback:";
export const DEFAULT_INDENT_STEP = "    ";

// Node type checks
export function isElementNode(node: Node): node is Element {
    return typeof (node as Element).tagName === "string";
}

export function isWhitespaceText(node: Node): boolean {
    return node.nodeName === "#text" && /^\s*$/.test((node as TextNode).value);
}

export function isWhitespaceOrComment(node: Node): boolean {
    if (node.nodeName === "#comment") {
        return true;
    }
    return isWhitespaceText(node);
}

// Element attribute helpers
export function getAttribute(element: Element, name: string): string | undefined {
    return element.attrs.find((a) => a.name === name)?.value;
}

// Anvil tag type checks
export function isAnvilSlot(node: Element): boolean {
    return getLowerTagName(node) === "anvil-slot";
}

export function isAnvilDropzone(node: Element): boolean {
    return getLowerTagName(node) === "anvil-dropzone";
}

export function isAnvilComponent(node: Element): boolean {
    return getLowerTagName(node) === "anvil-component";
}

export function isAnvilBlock(node: Element): boolean {
    return getLowerTagName(node) === "anvil-block";
}

export function isAnvilForm(node: Element): boolean {
    return getLowerTagName(node) === "anvil-form";
}

// Slot target helpers
export function getTargetKey(target: SlotTarget): string {
    return `${target.type}:${target.name}`;
}

// String manipulation helpers
export function addSelfPrefix(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "";
    }
    return trimmed.startsWith("self.") ? trimmed : `self.${trimmed}`;
}

export function stripSelfPrefix(value: string): string {
    const trimmed = value.trim();
    return trimmed.startsWith("self.") ? trimmed.substring(5) : trimmed;
}

// Whitespace helpers
export function countLeadingWhitespace(value: string): number {
    const match = value.match(/^[ \t]*/);
    return match ? match[0].length : 0;
}

// Fragment HTML normalization
export function normalizeFragmentHtml(html: string): string {
    if (!html) {
        return "";
    }

    // Work in-place on the split array to minimize allocations. Fragments are edited
    // frequently while the user drags components around, so we keep this hot path tight.
    const normalized = html.indexOf("\r") === -1 ? html : html.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");

    let start = 0;
    let end = lines.length - 1;
    for (; start <= end && lines[start].trim().length === 0; start += 1);
    for (; end >= start && lines[end].trim().length === 0; end -= 1);
    if (start > end) {
        return "";
    }

    // Step 1: remove the indentation of the first non-empty line. This sets the baseline
    // so nested fragments keep their relative indentation without drifting left.
    const firstIndent = countLeadingWhitespace(lines[start]);
    for (let index = start; index <= end; index += 1) {
        let line = lines[index];
        if (line.trim().length === 0) {
            lines[index] = "";
            continue;
        }
        if (firstIndent > 0) {
            const removal = Math.min(firstIndent, countLeadingWhitespace(line));
            if (removal > 0) {
                line = line.slice(removal);
            }
        }
        lines[index] = line;
    }

    // Step 2: determine the smallest indentation among the *remaining* lines so we can
    // normalize multi-line fragments. We skip blank lines to avoid trimming intentional
    // spacing inside user HTML.
    let additionalIndent = Number.POSITIVE_INFINITY;
    for (let index = start + 1; index <= end; index += 1) {
        const line = lines[index];
        if (!line) {
            continue;
        }
        const leading = countLeadingWhitespace(line);
        if (leading < additionalIndent) {
            additionalIndent = leading;
            if (leading === 0) {
                break;
            }
        }
    }
    if (!Number.isFinite(additionalIndent) || additionalIndent <= 0) {
        additionalIndent = 0;
    } else {
        for (let index = start + 1; index <= end; index += 1) {
            let line = lines[index];
            if (!line) {
                continue;
            }
            const removal = Math.min(additionalIndent, countLeadingWhitespace(line));
            if (removal > 0) {
                line = line.slice(removal);
                lines[index] = line;
            }
        }
    }

    return lines.slice(start, end + 1).join("\n");
}
