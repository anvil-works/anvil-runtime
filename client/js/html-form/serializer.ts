import { FormLayoutYaml, FormYaml } from "@runtime/runner/data";
import { parseFragment } from "parse5";
import { parseSerializedHtml, type ParseHtmlFormOptions } from "./parser";
import type {
    CommentNode,
    ComponentYaml,
    DataBindingYaml,
    Element,
    EventBindingYaml,
    Node,
    ParsedFormYaml,
    SlotDefsYaml,
    SlotDefYaml,
    SlotTarget,
    TextNode,
} from "./types";
import {
    addSelfPrefix,
    BIND_PREFIX,
    countLeadingWhitespace,
    DEFAULT_INDENT_STEP,
    formatAttribute,
    getAttribute,
    getTargetKey,
    isAnvilComponent,
    isAnvilDropzone,
    isElementNode,
    isWhitespaceOrComment,
    normalizeFragmentHtml,
    renderElement,
    stripAnvilPrefix,
    WRITEBACK_PREFIX,
} from "./utils";

export interface SerializeHtmlOptions {
    indentSize?: number;
    /**
     * Whether to reparse HTML after appending components (default: false).
     *
     * When enabled, the serialized HTML is reparsed and the original `parsed` form object
     * is mutated with the reparsed container and components. This ensures proper structure
     * with dropzones when components are appended.
     *
     * **Important:** This option mutates the input `parsed` object. This is expected behavior
     * when used from the editor (see `platform/editor/react/src/controllers/app/code.ts`),
     * where the form is expected to be mutated during serialization.
     */
    allowReparse?: boolean;
    parserOptions?: ParseHtmlFormOptions; // Options to pass to the parser when reparsing
}

const TRAILING_INDENT_PATTERN = /(?:\n|\r)([ \t]*)$/;
const LEADING_NEWLINE_PATTERN = /^\s*\n/;

function resolveIndentStep(options?: SerializeHtmlOptions): string {
    const size = options?.indentSize;
    if (typeof size === "number" && Number.isFinite(size) && size > 0) {
        const width = Math.max(1, Math.round(size));
        return " ".repeat(width);
    }
    return DEFAULT_INDENT_STEP;
}

export interface ParsedLayoutHtml {
    layout: FormLayoutYaml;
    components_by_slot: Record<string, ComponentYaml[]>;
    slots?: SlotDefsYaml;
}

interface SerializerSlotEntry {
    name: string;
    slot: SlotDefYaml;
}

interface SerializerTargetSlots {
    name: string;
    slot: SlotDefYaml;
}

interface SerializerContext {
    slots: SlotDefsYaml;
    slotsByDropzoneId: Map<string, SerializerSlotEntry[]>;
    slotsByTarget: Map<string, SerializerTargetSlots[]>;
    needsReparse: boolean; // Set to true if components were appended at any level (top-level or nested)
}

function sortSlotsByName(slots?: SlotDefsYaml): SlotDefsYaml | undefined {
    if (!slots) {
        return undefined;
    }
    const sortedEntries = Object.entries(slots).sort(([nameA], [nameB]) => nameA.localeCompare(nameB, "en"));
    const sorted: SlotDefsYaml = {};
    for (const [name, slot] of sortedEntries) {
        sorted[name] = slot;
    }
    return sorted;
}

function findAdjacentElement(siblings: Node[], startIndex: number, step: number): Element | null {
    for (let index = startIndex; index >= 0 && index < siblings.length; index += step) {
        const sibling = siblings[index];
        if (isWhitespaceOrComment(sibling)) {
            continue;
        }
        if (!isElementNode(sibling)) {
            return null;
        }
        return sibling as Element;
    }
    return null;
}

function createSerializerContext(parsed: FormYaml | ParsedFormYaml | ParsedLayoutHtml): SerializerContext {
    const unsortedSlots = parsed.slots ?? {};
    // Sort slots once when creating the serializer context
    const slots = sortSlotsByName(unsortedSlots) ?? {};
    const slotsByDropzoneId = new Map<string, SerializerSlotEntry[]>();
    const slotsByTarget = new Map<string, SerializerTargetSlots[]>();
    const entries = Object.entries(slots);

    for (const [slotName, slotDef] of entries) {
        const dropzoneName = slotDef.set_layout_properties?.dropzone;
        if (typeof dropzoneName === "string" && dropzoneName.length > 0) {
            if (!slotsByDropzoneId.has(dropzoneName)) {
                slotsByDropzoneId.set(dropzoneName, []);
            }
            slotsByDropzoneId.get(dropzoneName)!.push({ name: slotName, slot: slotDef });
        }

        const target = slotDef.target;
        // Pre-group slots by their owning target so serialization can do O(1) lookups
        // instead of repeatedly filtering the full slot map for each component.
        if (target) {
            const targetKey = getTargetKey(target);
            if (!slotsByTarget.has(targetKey)) {
                slotsByTarget.set(targetKey, []);
            }
            slotsByTarget.get(targetKey)!.push({ name: slotName, slot: slotDef });
        }
    }

    // Ensure deterministic ordering per target (index then name)
    for (const targetSlots of slotsByTarget.values()) {
        targetSlots.sort((a, b) => {
            const indexDiff = (a.slot.index ?? 0) - (b.slot.index ?? 0);
            if (indexDiff !== 0) {
                return indexDiff;
            }
            return a.name.localeCompare(b.name);
        });
    }

    return { slots, slotsByDropzoneId, slotsByTarget, needsReparse: false };
}

function buildFragmentAttributeList(options: {
    name?: string;
    properties?: { [key: string]: any };
    eventBindings?: EventBindingYaml;
    dataBindings?: DataBindingYaml[];
    layoutProperties?: { [key: string]: any };
    parentIsFragment?: boolean;
}): string[] {
    const attrs: string[] = [];
    const { name, properties, eventBindings, dataBindings, layoutProperties, parentIsFragment } = options;

    if (name && !name.startsWith("$")) {
        attrs.push(formatAttribute("anvil:name", name));
    }

    if (properties) {
        for (const [key, value] of Object.entries(properties)) {
            if (key === "html") continue;
            // visible special case since it default to true
            // so it's unnecessary to serialize it
            if (key === "visible" && value === true) continue;
            attrs.push(formatAttribute(`anvil:prop:${key}`, serializeAttributeValue(value)));
        }
    }

    if (eventBindings) {
        for (const [event, handler] of Object.entries(eventBindings)) {
            const normalized = addSelfPrefix(handler);
            attrs.push(formatAttribute(`anvil:on:${event}`, normalized));
        }
    }

    if (dataBindings) {
        for (const binding of dataBindings) {
            let code = binding.code;
            if (typeof code !== "string") {
                code = String(code);
            }
            const prefix = binding.writeback ? WRITEBACK_PREFIX : BIND_PREFIX;
            attrs.push(formatAttribute(`anvil:${prefix}${binding.property}`, code));
        }
    }

    if (layoutProperties) {
        for (const [key, value] of Object.entries(layoutProperties)) {
            // Only include dropzone in serialized output if we're NOT in a fragment
            if (key === "dropzone") {
                if (parentIsFragment) {
                    continue;
                }
                // Otherwise serialize it (not in fragment)
            }
            attrs.push(formatAttribute(`anvil:container:${key}`, serializeAttributeValue(value)));
        }
    }

    return attrs;
}

function serializeAttributeValue(value: unknown): string {
    if (typeof value !== "string") {
        return JSON.stringify(value);
    }
    try {
        JSON.parse(value); // if this succeeds then value is a valid JSON string and will be deserialized later as something else
        return JSON.stringify(value);
    } catch (e) {
        return value;
    }
}

function componentTypeToAttribute(type: string): string {
    return stripAnvilPrefix(type);
}

interface SerializeSlotOptions {
    parentIsFragment: boolean;
}

function serializeSlot(
    name: string,
    context: SerializerContext,
    indent: string,
    prependIndent: boolean,
    options: SerializeSlotOptions
): string {
    const parentIsFragment = options.parentIsFragment;
    const slotDef = context.slots[name];
    const attributes: string[] = [`name="${name}"`];

    if (slotDef?.one_component) {
        attributes.push("one-component");
    }

    const layoutProps = slotDef?.set_layout_properties || {};
    for (const [key, value] of Object.entries(layoutProps)) {
        // Only include dropzone in serialized output if:
        // 1. We're NOT in a fragment
        if (parentIsFragment) {
            if (key === "slot" || key === "dropzone") {
                continue;
            }
        }
        attributes.push(formatAttribute(`container:${key}`, serializeAttributeValue(value)));
    }

    const openTag = `<anvil-slot ${attributes.join(" ")}></anvil-slot>`;
    return prependIndent ? `${indent}${openTag}` : openTag;
}

function getSlotsForTarget(
    context: SerializerContext,
    target: SlotTarget
): { name: string; slot: SlotDefYaml; order: number }[] {
    // slotsByTarget is already sorted deterministically; we just annotate entries with
    // the original order value expected by downstream slot emitters.
    const targetKey = getTargetKey(target);
    const entries = context.slotsByTarget.get(targetKey) ?? [];
    return entries.map((entry, order) => ({ ...entry, order }));
}

function getSlotsForDropzone(context: SerializerContext, dropzoneName: string): SerializerSlotEntry[] {
    const entries = context.slotsByDropzoneId.get(dropzoneName) ?? [];
    return entries.slice().sort((a, b) => {
        const indexDiff = (a.slot.index ?? 0) - (b.slot.index ?? 0);
        if (indexDiff !== 0) {
            return indexDiff;
        }

        return a.name.localeCompare(b.name);
    });
}

function collectDropzoneMap(
    components: ComponentYaml[],
    map: Map<string, ComponentYaml[]>,
    queue: ComponentYaml[]
): void {
    for (const component of components) {
        const dropzoneName = component.layout_properties?.dropzone;
        if (dropzoneName) {
            if (!map.has(dropzoneName)) {
                map.set(dropzoneName, []);
            }
            map.get(dropzoneName)!.push(component);
        } else {
            queue.push(component);
        }
        // Don't recursively collect nested components - they're handled by their parent
        // component's serialization (e.g., fragment components handle their own nested components)
    }
}

function buildAttributeString(
    component: ComponentYaml,
    options: { typeAttributeName?: string; parentIsFragment: boolean }
): string {
    const attrs: string[] = [];
    const typeAttributeName = options?.typeAttributeName ?? "type";
    const parentIsFragment = options.parentIsFragment;
    // Normalize type once and reuse
    const normalizedType = componentTypeToAttribute(component.type);
    attrs.push(`${typeAttributeName}="${normalizedType}"`);
    if (component.name && !component.name.startsWith("$")) {
        attrs.push(`name="${component.name}"`);
    }

    const isFragment = normalizedType === "HtmlComponent";
    for (const [key, value] of Object.entries(component.properties || {})) {
        if (isFragment && key === "visible" && value === true) {
            continue;
        }
        attrs.push(formatAttribute(`prop:${key}`, serializeAttributeValue(value)));
    }

    for (const [event, handler] of Object.entries(component.event_bindings || {})) {
        const normalizedHandler = handler ? addSelfPrefix(handler) : "";
        attrs.push(formatAttribute(`on:${event}`, normalizedHandler));
    }

    for (const binding of component.data_bindings || []) {
        let value = typeof binding.code === "string" ? binding.code : String(binding.code);
        const prefix = binding.writeback ? WRITEBACK_PREFIX : BIND_PREFIX;
        attrs.push(formatAttribute(`${prefix}${binding.property}`, value));
    }

    for (const [key, value] of Object.entries(component.layout_properties || {})) {
        // Only include dropzone in serialized output if we have layout_properties.dropzone and we're NOT in a fragment
        if (key === "dropzone") {
            if (parentIsFragment) {
                continue;
            }
            // Otherwise serialize it (not in fragment)
        }
        attrs.push(formatAttribute(`container:${key}`, serializeAttributeValue(value)));
    }

    return attrs.join(" ");
}

function indentPreservingRelativeWhitespace(
    content: string,
    indent: string,
    skipFirstLineIndent: boolean = false
): string {
    if (content.length === 0) {
        return content;
    }
    const lines = content.split("\n");
    if (lines.length === 1) {
        // For single-line content, respect skipFirstLineIndent
        if (skipFirstLineIndent) {
            return lines[0];
        }
        return indent.length > 0 ? `${indent}${lines[0]}` : lines[0];
    }

    let baseIndent = Number.POSITIVE_INFINITY;
    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim().length === 0) {
            continue;
        }
        const leading = countLeadingWhitespace(line);
        if (leading === 0) {
            baseIndent = 0;
            break;
        }
        baseIndent = Math.min(baseIndent, leading);
    }
    if (!Number.isFinite(baseIndent)) {
        baseIndent = 0;
    }

    return lines
        .map((line, index) => {
            if (line.length === 0) {
                return "";
            }
            let adjusted = line;
            if (index !== 0 && baseIndent > 0) {
                const removal = Math.min(baseIndent, countLeadingWhitespace(line));
                adjusted = line.slice(removal);
            }
            // Skip first line indent if requested (first line gets indent from preceding whitespace)
            if (skipFirstLineIndent && index === 0) {
                return adjusted;
            }
            return indent.length > 0 ? `${indent}${adjusted}` : adjusted;
        })
        .join("\n");
}

interface SerializeComponentOptions {
    tagName?: "anvil-component" | "anvil-form";
    parentIsFragment: boolean;
}

function serializeComponent(
    component: ComponentYaml,
    context: SerializerContext,
    indent: string,
    indentStep: string,
    prependIndent: boolean,
    options: SerializeComponentOptions
): string {
    const tagName = options?.tagName ?? "anvil-component";
    const parentIsFragment = options.parentIsFragment;

    // Normalize type once and reuse
    const normalizedType = stripAnvilPrefix(component.type);
    const isFragment = normalizedType === "HtmlComponent";
    if (isFragment) {
        const html = serializeFragmentComponent(component, context, indentStep, parentIsFragment);
        // Always apply indentation for multi-line fragments to ensure proper alignment.
        // When prependIndent is false, skip the first line (it gets indent from preceding whitespace).
        return indentPreservingRelativeWhitespace(html, indent, !prependIndent);
    }

    const typeAttributeName = tagName === "anvil-form" ? "container" : "type";
    const attrString = buildAttributeString(component, { typeAttributeName, parentIsFragment });
    const openTag = attrString.length > 0 ? `<${tagName} ${attrString}>` : `<${tagName}>`;
    const openPrefix = prependIndent ? indent : "";
    const childIndent = indent + indentStep;
    const parts: string[] = [];

    const slotsForTarget = getSlotsForTarget(context, { type: "container", name: component.name });
    let slotCursor = 0;

    // Children of a fragment component are inside a fragment
    // If we're already in a fragment context, children are also in a fragment context
    // OR if this component itself is a fragment, its children are in a fragment context

    const emitSlots = (componentCount: number) => {
        while (slotCursor < slotsForTarget.length && (slotsForTarget[slotCursor].slot.index ?? 0) === componentCount) {
            parts.push(
                serializeSlot(slotsForTarget[slotCursor].name, context, childIndent, true, {
                    parentIsFragment: isFragment,
                })
            );
            slotCursor += 1;
        }
    };

    emitSlots(0);

    let emittedChildren = 0;
    for (const child of component.components || []) {
        parts.push(
            serializeComponent(child, context, childIndent, indentStep, true, {
                tagName: "anvil-component",
                parentIsFragment: isFragment,
            })
        );
        emittedChildren += 1;
        emitSlots(emittedChildren);
    }

    while (slotCursor < slotsForTarget.length) {
        parts.push(
            serializeSlot(slotsForTarget[slotCursor].name, context, childIndent, true, {
                parentIsFragment: isFragment,
            })
        );
        slotCursor += 1;
    }

    if (parts.length === 0) {
        return `${openPrefix}${openTag}</${tagName}>`;
    }

    const inner = parts.join("\n");
    return `${openPrefix}${openTag}\n${inner}\n${indent}</${tagName}>`;
}

function addAttributesToRootElement(html: string, attributes: string[]): string {
    if (attributes.length === 0) {
        return html;
    }

    if (html.trim().length === 0) {
        // Empty HTML - wrap in a div with attributes
        const attrString = attributes.join(" ");
        return `<div ${attrString}></div>`;
    }

    // Parse the HTML to find root elements
    const fragment = parseFragment(html);
    const nodes = (fragment.childNodes as Node[]) ?? [];

    // Find all root element nodes (non-whitespace, non-comment)
    const rootElements: Element[] = [];
    const otherNodes: Node[] = [];

    for (const node of nodes) {
        if (isWhitespaceOrComment(node)) {
            otherNodes.push(node);
            continue;
        }
        if (isElementNode(node)) {
            rootElements.push(node as Element);
        } else {
            otherNodes.push(node);
        }
    }

    // If there's exactly one root element, add attributes to it
    if (rootElements.length === 1 && otherNodes.length === 0) {
        const element = rootElements[0];
        // Add attributes to existing attrs
        const existingAttrs = element.attrs || [];
        const newAttrs = [...existingAttrs];
        for (const attr of attributes) {
            // Parse attribute string (format: name="value" or name='value')
            const match = attr.match(/^([^=]+)=["']([^"']*)["']$/);
            if (match) {
                const [, name, value] = match;
                newAttrs.push({ name, value });
            }
        }
        element.attrs = newAttrs;
        // Re-render the element with its children - preserve original structure
        const childNodes = element.childNodes || [];
        const childParts: string[] = [];
        for (const child of childNodes) {
            if (child.nodeName === "#text") {
                childParts.push((child as TextNode).value);
            } else if (child.nodeName === "#comment") {
                childParts.push(`<!--${(child as CommentNode).data}-->`);
            } else if (isElementNode(child)) {
                const childElement = child as Element;
                const grandchildHtml = serializeElementAndChildren(childElement);
                childParts.push(grandchildHtml);
            }
        }
        const childHtml = childParts.join("");
        return renderElement(element.tagName, element.attrs, childHtml);
    }

    // Multiple root elements or mixed content - wrap in a div
    const attrString = attributes.join(" ");
    const wrappedHtml = html.trim();
    // Use a simple indent step for wrapping
    const indentStep = "    ";
    const indented = indentFragmentContent(wrappedHtml, indentStep);
    return `<div ${attrString}>\n${indented}\n</div>`;
}

function serializeElementAndChildren(element: Element): string {
    const childNodes = element.childNodes || [];
    const childParts: string[] = [];
    for (const child of childNodes) {
        if (child.nodeName === "#text") {
            childParts.push((child as TextNode).value);
        } else if (child.nodeName === "#comment") {
            childParts.push(`<!--${(child as CommentNode).data}-->`);
        } else if (isElementNode(child)) {
            const childElement = child as Element;
            childParts.push(serializeElementAndChildren(childElement));
        }
    }
    const childHtml = childParts.join("");
    return renderElement(element.tagName, element.attrs, childHtml);
}

function serializeFragmentComponent(
    component: ComponentYaml,
    context: SerializerContext,
    indentStep: string,
    parentIsFragment: boolean = false
): string {
    const html = component.properties?.html || "";
    const nested = component.components || [];

    // Fill dropzones and append remaining components
    // Note: We don't reparse fragments here because:
    // 1. Fragments are nested components, not top-level forms
    // 2. Reparsing fragments can cause duplication issues
    // 3. The top-level form serialization will handle reparsing if needed
    const { html: filled } = fillDropzonesAndAppendRemaining(html, nested, context, indentStep);

    const normalized = normalizeFragmentHtml(filled);

    const fragmentAttributes = buildFragmentAttributeList({
        name: component.name,
        properties: component.properties,
        eventBindings: component.event_bindings,
        dataBindings: component.data_bindings,
        layoutProperties: component.layout_properties,
        parentIsFragment,
    });

    if (fragmentAttributes.length === 0) {
        return normalized;
    }

    return addAttributesToRootElement(normalized, fragmentAttributes);
}

function buildLayoutAttributes(layout: FormLayoutYaml): string {
    const attrs: string[] = [];
    attrs.push(formatAttribute("layout", layout.type));

    for (const [key, value] of Object.entries(layout.properties || {})) {
        attrs.push(formatAttribute(`prop:${key}`, serializeAttributeValue(value)));
    }

    for (const [event, handler] of Object.entries(layout.event_bindings || {})) {
        const normalizedHandler = handler ? addSelfPrefix(handler) : "";
        attrs.push(formatAttribute(`on:layout:${event}`, normalizedHandler));
    }

    for (const [event, handler] of Object.entries(layout.form_event_bindings || {})) {
        const normalizedHandler = handler ? addSelfPrefix(handler) : "";
        attrs.push(formatAttribute(`on:${event}`, normalizedHandler));
    }

    for (const binding of layout.data_bindings || []) {
        const value = typeof binding.code === "string" ? binding.code : String(binding.code);
        const prefix = binding.writeback ? WRITEBACK_PREFIX : BIND_PREFIX;
        attrs.push(formatAttribute(`${prefix}${binding.property}`, value));
    }

    return attrs.join(" ");
}

function serializeLayoutBlock(
    blockName: string,
    components: ComponentYaml[],
    context: SerializerContext,
    indent: string,
    indentStep: string
): string {
    const childIndent = indent + indentStep;
    const parts: string[] = [];
    const slotsForTarget = getSlotsForTarget(context, { type: "slot", name: blockName });
    let slotCursor = 0;

    const emitSlots = (componentCount: number) => {
        while (slotCursor < slotsForTarget.length && (slotsForTarget[slotCursor].slot.index ?? 0) === componentCount) {
            parts.push(
                serializeSlot(slotsForTarget[slotCursor].name, context, childIndent, true, {
                    // Layout blocks are not fragments, so parentIsFragment is false
                    parentIsFragment: false,
                })
            );
            slotCursor += 1;
        }
    };

    emitSlots(0);

    let emittedComponents = 0;
    for (const component of components) {
        parts.push(
            serializeComponent(component, context, childIndent, indentStep, true, {
                tagName: "anvil-component",
                // Layout blocks are not fragments, so parentIsFragment is false
                parentIsFragment: false,
            })
        );
        emittedComponents += 1;
        emitSlots(emittedComponents);
    }

    while (slotCursor < slotsForTarget.length) {
        parts.push(
            serializeSlot(slotsForTarget[slotCursor].name, context, childIndent, true, {
                // Layout blocks are not fragments, so parentIsFragment is false
                parentIsFragment: false,
            })
        );
        slotCursor += 1;
    }

    return parts.join("\n");
}

function indentFragmentContent(content: string, indent: string): string {
    if (!content) {
        return content;
    }
    const lines = content.split("\n");
    const firstLineIndent = lines.length > 0 ? countLeadingWhitespace(lines[0]) : 0;
    let minPositiveIndent = Number.POSITIVE_INFINITY;
    for (const line of lines) {
        if (line.trim().length === 0) {
            continue;
        }
        const leading = countLeadingWhitespace(line);
        if (leading > 0) {
            minPositiveIndent = Math.min(minPositiveIndent, leading);
        }
    }
    if (!Number.isFinite(minPositiveIndent) || firstLineIndent === 0) {
        minPositiveIndent = 0;
    }

    return lines
        .map((line) => {
            if (line.length === 0) {
                return "";
            }
            let adjusted = line;
            if (minPositiveIndent > 0) {
                const leading = countLeadingWhitespace(line);
                if (leading > 0) {
                    const removal = Math.min(leading, minPositiveIndent);
                    adjusted = line.slice(removal);
                }
            }
            if (indent.length === 0) {
                return adjusted;
            }
            return `${indent}${adjusted}`;
        })
        .join("\n");
}

export function serializeFormLayout(
    parsed: {
        layout?: FormLayoutYaml;
        components_by_slot?: Record<string, ComponentYaml[]>;
        slots?: SlotDefsYaml;
    },
    options?: SerializeHtmlOptions
): string {
    const layout = parsed.layout;
    if (!layout || !layout.type) {
        return "";
    }

    const componentsBySlot = parsed.components_by_slot || {};
    const slots = parsed.slots || {};
    // don't bother with unknown slots if they are empty
    const keepBlock = (name: string, components: ComponentYaml[] | undefined): boolean => {
        if (!name.startsWith("$unknown-slot-")) {
            return true;
        }
        const hasComponents = (components?.length ?? 0) > 0;
        if (hasComponents) {
            return true;
        }
        return Object.values(slots).some((slot) => slot.target?.type === "slot" && slot.target?.name === name);
    };

    const filteredEntries = Object.entries(componentsBySlot).filter(([blockName, blockComponents]) =>
        keepBlock(blockName, blockComponents)
    );

    const filteredComponentsBySlot = Object.fromEntries(filteredEntries);
    const contextInput: ParsedLayoutHtml = {
        layout,
        components_by_slot: filteredComponentsBySlot,
        slots: parsed.slots,
    };
    const indentStep = resolveIndentStep(options);
    const context = createSerializerContext(contextInput);
    const layoutAttributes = buildLayoutAttributes(layout);
    const openTag = layoutAttributes.length > 0 ? `<anvil-form ${layoutAttributes}>` : `<anvil-form>`;

    if (filteredEntries.length === 0) {
        return `${openTag}</anvil-form>`;
    }

    const lines: string[] = [];
    lines.push(openTag);

    for (const [blockName, components] of filteredEntries) {
        const blockIndent = indentStep;
        const blockHeader = `${blockIndent}<anvil-block slot="${blockName}">`;
        const blockContent = serializeLayoutBlock(blockName, components ?? [], context, blockIndent, indentStep);

        if (blockContent.length > 0) {
            lines.push(blockHeader);
            lines.push(blockContent);
            lines.push(`${blockIndent}</anvil-block>`);
        } else {
            lines.push(`${blockIndent}<anvil-block slot="${blockName}"></anvil-block>`);
        }
    }

    lines.push(`</anvil-form>`);
    return lines.join("\n");
}

function getIndentForElement(element: Element, fallback: string): string {
    const parent = (element as any).parentNode as { childNodes?: Node[] } | undefined;
    if (!parent || !parent.childNodes) {
        return fallback;
    }

    const siblings = parent.childNodes;
    const index = siblings.indexOf(element);
    for (let i = index - 1; i >= 0; i--) {
        const sibling = siblings[i];
        if (sibling.nodeName === "#text") {
            const text = (sibling as TextNode).value;
            const match = TRAILING_INDENT_PATTERN.exec(text);
            if (match) {
                return match[1];
            }
        } else if (sibling.nodeName === "#comment") {
            continue;
        } else {
            break;
        }
    }

    return fallback;
}

/**
 * Fills dropzones in HTML with components and appends any remaining components.
 * Returns the final HTML with all components placed or appended.
 * Sets `context.needsReparse = true` if any components were appended.
 */
function fillDropzonesAndAppendRemaining(
    html: string,
    components: ComponentYaml[],
    context: SerializerContext,
    indentStep: string
): { html: string } {
    const unmappedComponents = components.filter((comp) => !comp.layout_properties?.dropzone);
    const { html: filledHtml, remainingComponents } = fillDropzones(html, components, context, indentStep);

    // Collect all remaining components that weren't placed into any dropzone
    const allRemainingComponents: ComponentYaml[] = [];
    for (const componentList of remainingComponents.values()) {
        allRemainingComponents.push(...componentList);
    }
    // Add unmapped components (components without dropzone that weren't placed)
    if (unmappedComponents.length > 0) {
        allRemainingComponents.push(...unmappedComponents);
    }

    if (allRemainingComponents.length === 0) {
        return { html: filledHtml };
    }

    const appendedComponents = allRemainingComponents
        .map((component) => {
            return serializeComponent(component, context, "", indentStep, false, {
                tagName: "anvil-component",
                parentIsFragment: true,
            });
        })
        .join("\n");

    // Track that we need to reparse to sync YAML with HTML
    // having to append components means the HTML is out of sync with the YAML
    // i.e. the dropzones that were in the html property don't match the components in the yaml
    context.needsReparse = true;

    return { html: filledHtml + "\n" + appendedComponents };
}

function fillDropzones(
    html: string,
    components: ComponentYaml[],
    context: SerializerContext,
    indentStep: string
): { html: string; remainingComponents: Map<string, ComponentYaml[]> } {
    if (!html) return { html: "", remainingComponents: new Map() };

    const fragment = parseFragment(html);
    const map = new Map<string, ComponentYaml[]>();
    collectDropzoneMap(components, map, []);
    const replacedDropzones = new Set<string>();
    const slotDropzoneNames = new Set<string>();
    for (const [dropzoneName, entries] of context.slotsByDropzoneId.entries()) {
        if (entries.length > 0) {
            slotDropzoneNames.add(dropzoneName);
        }
    }

    function serializeNodes(nodes: Node[], parentIndent: string): string {
        const parts: string[] = [];
        for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index];
            if (node.nodeName === "#text") {
                parts.push((node as TextNode).value);
                continue;
            }
            if (node.nodeName === "#comment") {
                parts.push(`<!--${(node as CommentNode).data}-->`);
                continue;
            }

            if (!isElementNode(node)) {
                continue;
            }
            const element = node as Element;
            if (isAnvilDropzone(element)) {
                const name = getAttribute(element, "name");
                if (name) {
                    const indent = getIndentForElement(element, parentIndent);
                    const chunks: string[] = [];

                    const slotsForDropzone = getSlotsForDropzone(context, name);
                    let slotCursor = 0;
                    // Components/slots inside fragment HTML are inside a fragment
                    const parentIsFragment = true;

                    const emitSlots = (componentCount: number) => {
                        while (
                            slotCursor < slotsForDropzone.length &&
                            (slotsForDropzone[slotCursor].slot.index ?? 0) === componentCount
                        ) {
                            const slotEntry = slotsForDropzone[slotCursor];
                            chunks.push(
                                serializeSlot(slotEntry.name, context, indent, chunks.length > 0, {
                                    parentIsFragment: true,
                                })
                            );
                            slotCursor += 1;
                        }
                    };

                    emitSlots(0);

                    const componentsForDropzone = map.get(name) ?? [];
                    let emittedComponents = 0;
                    for (const component of componentsForDropzone) {
                        chunks.push(
                            serializeComponent(component, context, indent, indentStep, chunks.length > 0, {
                                tagName: "anvil-component",
                                parentIsFragment: true,
                            })
                        );
                        emittedComponents += 1;
                        emitSlots(emittedComponents);
                    }

                    while (slotCursor < slotsForDropzone.length) {
                        const slotEntry = slotsForDropzone[slotCursor];
                        chunks.push(
                            serializeSlot(slotEntry.name, context, indent, chunks.length > 0, {
                                parentIsFragment: true,
                            })
                        );
                        slotCursor += 1;
                    }

                    if (chunks.length > 0) {
                        parts.push(chunks.join("\n"));
                        replacedDropzones.add(name);
                        map.delete(name);
                        continue;
                    }
                }
                // Dropzones without matching components or slots may need pruning
                if (shouldRemoveSerializedDropzone(element, nodes, index, map, replacedDropzones, slotDropzoneNames)) {
                    if (parts.length > 0 && /^\s*$/.test(parts[parts.length - 1])) {
                        parts.pop();
                    }

                    continue;
                }
                const inner = serializeNodes(element.childNodes || [], parentIndent + indentStep);
                parts.push(renderElement(element.tagName, element.attrs, inner));
                continue;
            }

            const innerHtml = serializeNodes(element.childNodes || [], parentIndent + indentStep);
            parts.push(renderElement(element.tagName, element.attrs, innerHtml));
        }
        return parts.join("");
    }

    const htmlResult = serializeNodes((fragment.childNodes as Node[]) || [], "");
    return { html: htmlResult, remainingComponents: map };
}

/**
 * Determines whether a serialized `<anvil-dropzone>` should be omitted from the final HTML.
 *
 * Designer-originated forms often accumulate redundant dropzones when components are deleted or
 * rearranged. During serialization we remove dropzones that:
 *
 * - live inside another dropzone (only the outer slot is meaningful),
 * - sit directly next to a real component or a dropzone that will be replaced by a component
 *   (HTML parsed back into an `HtmlForm` will introduce fresh `<anvil-dropzone>` elements around
 *   components anyway), or
 * - were already filled earlier in this pass (the replacement markup supersedes the placeholder).
 *
 * This keeps the serialized HTML clean while preserving any dropzones that still represent
 * legitimate designer targets.
 */
function shouldRemoveSerializedDropzone(
    element: Element,
    siblings: Node[],
    index: number,
    componentDropzones: Map<string, ComponentYaml[]>,
    replacedDropzones?: Set<string>,
    slotDropzones?: Set<string>
): boolean {
    const parentNode = (element as any).parentNode as Node | undefined;
    if (parentNode && isElementNode(parentNode) && isAnvilDropzone(parentNode)) {
        return true;
    }

    const prevElement = findAdjacentElement(siblings, index - 1, -1);
    if (
        prevElement &&
        (isAnvilComponent(prevElement) ||
            isPendingDropzoneReplacement(prevElement, componentDropzones, replacedDropzones, slotDropzones))
    ) {
        return true;
    }

    const nextElement = findAdjacentElement(siblings, index + 1, 1);
    if (
        nextElement &&
        (isAnvilComponent(nextElement) ||
            isPendingDropzoneReplacement(nextElement, componentDropzones, replacedDropzones, slotDropzones))
    ) {
        return true;
    }

    if (replacedDropzones && replacedDropzones.size > 0) {
        if (prevElement && isDropzoneReplaced(prevElement, replacedDropzones)) {
            return true;
        }
        if (nextElement && isDropzoneReplaced(nextElement, replacedDropzones)) {
            return true;
        }
    }

    return false;
}

function isDropzoneReplaced(element: Element, replacedDropzones: Set<string>): boolean {
    if (!isAnvilDropzone(element)) {
        return false;
    }
    const name = getAttribute(element, "name");
    return !!name && replacedDropzones.has(name);
}

function isPendingDropzoneReplacement(
    element: Element,
    componentDropzones: Map<string, ComponentYaml[]>,
    replacedDropzones?: Set<string>,
    slotDropzones?: Set<string>
): boolean {
    if (!isAnvilDropzone(element)) {
        return false;
    }
    const name = getAttribute(element, "name");
    if (!name) {
        return false;
    }
    if (componentDropzones.has(name)) {
        return true;
    }
    if (replacedDropzones && replacedDropzones.has(name)) {
        return true;
    }
    if (slotDropzones && slotDropzones.has(name)) {
        return true;
    }
    return false;
}

export function serializeFormContainer(parsed: FormYaml | ParsedFormYaml, options?: SerializeHtmlOptions): string {
    const container = parsed.container;
    const components = parsed.components || [];
    const indentStep = resolveIndentStep(options);
    const context = createSerializerContext(parsed);

    if (container && container.type && container.type !== "HtmlComponent") {
        const containerComponent: ComponentYaml = {
            type: container.type,
            name: container.properties?.name ?? "",
            properties: { ...(container.properties || {}) },
            components,
        };
        if (container.event_bindings) {
            containerComponent.event_bindings = { ...container.event_bindings };
        }
        if (container.data_bindings) {
            containerComponent.data_bindings = [...container.data_bindings];
        }
        if (container.layout_properties) {
            containerComponent.layout_properties = { ...container.layout_properties };
        }

        // Top-level container is not inside a fragment
        const result = serializeComponent(containerComponent, context, "", indentStep, false, {
            tagName: "anvil-form",
            parentIsFragment: false,
        });
        Object.assign(parsed as any, { serialized_html: result });
        return result;
    }

    const html = container?.properties?.html ?? "";
    if (!html) {
        const result = components
            .map((component) => {
                return serializeComponent(component, context, "", indentStep, false, {
                    tagName: "anvil-component",
                    parentIsFragment: true,
                });
            })
            .join("");
        Object.assign(parsed as any, { serialized_html: result });
        return result;
    }

    // Fill dropzones and append remaining components
    const { html: filledHtml } = fillDropzonesAndAppendRemaining(html, components, context, indentStep);
    let result = filledHtml;

    // Reparse and re-serialize to ensure proper structure with dropzones
    // We MUST reparse if components were appended at any level (top-level or nested fragments)
    // because the HTML string is now out of sync with the YAML structure:
    // - container.properties.html doesn't match the serialized HTML
    // - fragment component.properties.html don't match their serialized HTML
    // Reparsing syncs the YAML structure (container, components, properties.html) with the new HTML
    // Only reparse if explicitly enabled (default to false to avoid issues with existing tests)
    let wasReparsed = false;
    const shouldReparse = options?.allowReparse === true && context.needsReparse;
    if (shouldReparse) {
        // NOTE: The reparsing logic below mutates the input `parsed` object by assigning
        // reparsed.container and reparsed.components back to it. This is intentional and
        // expected when used from the editor, where forms are mutated during serialization.
        try {
            const parserOpts = options?.parserOptions;
            const reparsed = parseSerializedHtml(result, parserOpts);
            if (reparsed.kind === "form" && reparsed.container) {
                // Merge container properties/event_bindings/data_bindings from original parsed form
                // (excluding html property since reparsed form already has the correct HTML)
                if (container) {
                    if (container.properties) {
                        const { html: _, ...otherProps } = container.properties;
                        reparsed.container.properties = { ...reparsed.container.properties, ...otherProps };
                    }
                    if (container.event_bindings) {
                        reparsed.container.event_bindings = container.event_bindings;
                    }
                    if (container.data_bindings) {
                        reparsed.container.data_bindings = container.data_bindings;
                    }
                }
                // Mutate the original parsed object with the reparsed container and components
                parsed.container = reparsed.container;
                parsed.components = reparsed.components;
                // Re-serialize the reparsed form to get properly formatted HTML with dropzones
                // Disable reparsing in recursive call to prevent infinite recursion
                result = serializeFormContainer(reparsed, { ...options, allowReparse: false });
                wasReparsed = true;
            }
        } catch (e) {
            // If reparsing fails, fall back to the original result
            console.warn("Failed to reparse HTML after appending components:", e);
        }
    }

    if (container && !wasReparsed) {
        const containerProps = { ...(container.properties || {}) };
        delete containerProps.html;
        const fragmentAttributes = buildFragmentAttributeList({
            properties: containerProps,
            eventBindings: container.event_bindings,
            dataBindings: container.data_bindings,
        });

        if (fragmentAttributes.length > 0) {
            const normalized = normalizeFragmentHtml(result);
            // For container-level fragments, add attributes to root element if single root, otherwise wrap
            // This preserves the original element type (button stays button, input stays input, etc.)
            const wrapped = addAttributesToRootElement(normalized, fragmentAttributes);
            Object.assign(parsed as any, { serialized_html: wrapped });
            return wrapped;
        } else {
            // No attributes - normalize HTML to remove extra indentation
            const normalized = normalizeFragmentHtml(result);
            Object.assign(parsed as any, { serialized_html: normalized });
            return normalized;
        }
    }

    if (LEADING_NEWLINE_PATTERN.test(html)) {
        result = normalizeFragmentHtml(result);
    }
    Object.assign(parsed as any, { serialized_html: result });
    return result;
}
