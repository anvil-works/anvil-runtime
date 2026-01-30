import { FormLayoutYaml } from "@runtime/runner/data";
import { parseFragment } from "parse5";
import type {
    CommentNode,
    ComponentYaml,
    DataBindingYaml,
    Element,
    EventBindingYaml,
    FormContainerYaml,
    Node,
    ParsedFormYaml,
    SlotDefsYaml,
    SlotDefYaml,
    SlotTarget,
    TextNode,
} from "./types";
import {
    BIND_PREFIX,
    getAttribute,
    getLowerTagName,
    getTargetKey,
    isAnvilBlock,
    isAnvilComponent,
    isAnvilDropzone,
    isAnvilForm,
    isAnvilSlot,
    isElementNode,
    isWhitespaceOrComment,
    normalizeFragmentHtml,
    renderElement,
    stripAnvilPrefix,
    stripSelfPrefix,
    WRITEBACK_PREFIX,
} from "./utils";

export { serializeFormContainer, serializeFormLayout, type SerializeHtmlOptions } from "./serializer";

const CONTAINER_TYPES = new Set([
    "LinearPanel",
    "ColumnPanel",
    "FlowPanel",
    "GridPanel",
    "HtmlComponent",
    "RichText",
    "RepeatingPanel",
    "Card",
    "HtmlComponent",
]);

export interface ParseHtmlFormOptions {
    dropzoneNameGenerator?: () => string;
    normalizeHtml?: boolean;
    promoteDomNodes?: boolean; // promote anvil:on-dom: events and anvil:dom-node attributes (for designer)
}

export interface ParsedLayoutHtml {
    layout: FormLayoutYaml;
    components_by_slot: Record<string, ComponentYaml[]>;
    slots?: SlotDefsYaml;
}

export type ParsedHtmlTemplate = ({ kind: "layout" } & ParsedLayoutHtml) | ({ kind: "form" } & ParsedFormYaml);

interface ParseContext {
    slots: SlotDefsYaml;
    componentCounts: Map<string, number>;
    anonymousComponentCounter: number;
    anonymousSlotCounter: number;
    slotState: Map<
        string,
        {
            slotCounter: number;
            lastComponentCount: number | null;
            lastIndex: number | null;
        }
    >;
    dropzoneNameGenerator: () => string;
    slotOrder: { targetKey: string; slotName: string }[];
    dropzoneCounters: Map<string, number>;
    dropzoneHashes: Map<string, string>;
    deterministicScopeIds: boolean;
    hasCustomGenerator: boolean;
    normalizeHtml: boolean;
    promoteDomNodes: boolean;
}

let defaultDropzoneNameGeneratorFactory: (() => () => string) | null = null;

export function setDefaultDropzoneNameGenerator(factory: () => () => string): void {
    defaultDropzoneNameGeneratorFactory = factory;
}

export function hashString(str: string): number {
    // Fast string hash (djb2 variant)
    // Only called once per parse, so performance is acceptable even for large HTML
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0; // Force 32-bit integer
    }
    return hash >>> 0; // Convert to unsigned 32-bit
}

// Pre-compute 36^6 for performance (2,176,782,336)
const BASE36_POWER_6 = 36 ** 6;

function hashToBase36(value: number, length: number = 6): string {
    // Simple multiplicative hash to scramble the value
    // Using large primes for better distribution
    let hash = ((value * 2654435761) >>> 0) % BASE36_POWER_6;

    // Convert to base36 (0-9, a-z)
    // Use array and join for O(n) performance instead of string prepending O(n²)
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    const result: string[] = new Array(length);
    for (let i = length - 1; i >= 0; i--) {
        result[i] = chars[hash % 36];
        hash = (hash / 36) | 0; // Integer division (faster than Math.floor)
    }
    return result.join("");
}
const DROPZONE_COUNTER_OFFSET = 0x7f3a2b1c;

export function createHashBasedDropzoneNameGenerator(htmlSeed?: number): () => string {
    // Use a deterministic generator with hash-based encoding
    // HTML seed makes names deterministic for same HTML, different for different HTML
    // This avoids collisions with old dropzones when structure changes
    const seed = htmlSeed ?? 0;
    let counter = 0;
    return () => {
        // Combine HTML seed + counter + offset for structure-aware deterministic names
        // hashToBase36 will do the multiplication, so we just combine the values here
        const combinedValue = (seed + counter++ + DROPZONE_COUNTER_OFFSET) >>> 0;
        const hashStr = hashToBase36(combinedValue);
        return `$dz_${hashStr}`;
    };
}

function createDefaultDropzoneNameGenerator(htmlSeed?: number): () => string {
    if (!defaultDropzoneNameGeneratorFactory) {
        return createHashBasedDropzoneNameGenerator(htmlSeed);
    }
    // Call the factory to get a new generator instance with a fresh counter
    return defaultDropzoneNameGeneratorFactory();
}

export function createDeterministicDropzoneNameGenerator(seed = 0): () => string {
    let counter = seed >>> 0;
    return () => `$dz_${counter++}`;
}

function createContext(
    options?: ParseHtmlFormOptions,
    deterministicScopeIds: boolean = false,
    html?: string
): ParseContext {
    const hasCustomGenerator = !!options?.dropzoneNameGenerator;
    // Hash HTML to use as seed for deterministic, structure-aware names
    // Same HTML → same seed → same names (deterministic)
    // Different HTML → different seed → different names (avoids collisions with old dropzones)
    const htmlSeed = html ? hashString(html) : undefined;
    const dropzoneNameGenerator = options?.dropzoneNameGenerator ?? createDefaultDropzoneNameGenerator(htmlSeed);
    return {
        slots: {},
        componentCounts: new Map(),
        anonymousComponentCounter: 0,
        anonymousSlotCounter: 0,
        slotState: new Map(),
        dropzoneNameGenerator,
        slotOrder: [],
        dropzoneCounters: new Map(),
        dropzoneHashes: new Map(),
        deterministicScopeIds,
        hasCustomGenerator,
        normalizeHtml: options?.normalizeHtml !== false,
        promoteDomNodes: options?.promoteDomNodes ?? false,
    };
}

function hasTopLevelLayoutElement(html: string): boolean {
    const fragment = parseFragment(html);
    const nodes = (fragment.childNodes as Node[]) ?? [];
    for (const node of nodes) {
        if (isWhitespaceOrComment(node)) {
            continue;
        }
        if (!isElementNode(node)) {
            continue;
        }
        const element = node as Element;
        if (isAnvilForm(element) && getAttribute(element, "layout")) {
            return true;
        }
    }
    return false;
}

export function parseSerializedHtml(html: string, options?: ParseHtmlFormOptions): ParsedHtmlTemplate {
    if (hasTopLevelLayoutElement(html)) {
        const parsedLayout = parseLayoutForm(html, options);
        return { kind: "layout", ...parsedLayout };
    }
    const parsedForm = parseContainerForm(html, "HtmlComponent", options);
    return { kind: "form", ...parsedForm };
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

function hasRenderableContent(nodes: Node[]): boolean {
    return nodes.some((node) => !isWhitespaceOrComment(node));
}

function generateDropzoneName(context: ParseContext, scope?: SlotTarget): string {
    // Always use the generator - it's now HTML-seeded and deterministic
    // The deterministic mode with scope-based counters was for a different use case
    // but now that we have HTML-seeded generators, we can always use them
    return context.dropzoneNameGenerator();
}

function generateAnonymousComponentName(context: ParseContext): string {
    context.anonymousComponentCounter += 1;
    return `$component_${context.anonymousComponentCounter}`;
}

function generateAnonymousSlotName(context: ParseContext): string {
    context.anonymousSlotCounter += 1;
    return `$slot_${context.anonymousSlotCounter}`;
}

interface RecordSlotOptions {
    layoutProperties?: { [key: string]: any };
    dropzoneName?: string;
    oneComponent?: boolean;
    includeEmptyLayout?: boolean;
    index: number;
    parentIsFragment: boolean;
}

function recordSlot(
    context: ParseContext,
    slotName: string,
    target: SlotTarget,
    options: RecordSlotOptions
): SlotDefYaml {
    const targetKey = getTargetKey(target);
    const index = options.index;
    const parentIsFragment = options.parentIsFragment;
    const slotDef: SlotDefYaml = {
        target,
        index,
    };

    const layoutProperties = { ...(options.layoutProperties || {}) };
    // Always include dropzone in parsed output:
    // 1. User provided container:dropzone (already in layoutProperties from options.layoutProperties)
    // 2. Generated dropzone name (always add during parsing, serialization will skip if in fragment)
    if (options.dropzoneName && !options.layoutProperties?.dropzone && parentIsFragment) {
        // No user-provided dropzone - add generated dropzone name
        // Note: Serialization will skip this dropzone if parentIsFragment is true
        layoutProperties.dropzone = options.dropzoneName;
    }
    const hasLayoutProps = Object.keys(layoutProperties).length > 0;
    if (hasLayoutProps) {
        slotDef.set_layout_properties = layoutProperties;
    } else if (options.includeEmptyLayout) {
        slotDef.set_layout_properties = {};
    }

    if (options.oneComponent) {
        slotDef.one_component = true;
    }

    context.slots[slotName] = slotDef;
    context.slotOrder.push({ targetKey, slotName });

    return slotDef;
}

function getComponentCount(context: ParseContext, target: SlotTarget): number {
    const key = getTargetKey(target);
    return context.componentCounts.get(key) ?? 0;
}

function incrementComponentCount(context: ParseContext, target: SlotTarget): void {
    const key = getTargetKey(target);
    const current = context.componentCounts.get(key) ?? 0;
    context.componentCounts.set(key, current + 1);
}

function getSlotState(context: ParseContext, target: SlotTarget) {
    const key = getTargetKey(target);
    if (!context.slotState.has(key)) {
        context.slotState.set(key, {
            slotCounter: 0,
            lastComponentCount: null,
            lastIndex: null,
        });
    }
    return context.slotState.get(key)!;
}

function computeSlotIndex(context: ParseContext, target: SlotTarget): number {
    const componentCount = getComponentCount(context, target);
    const state = getSlotState(context, target);

    let index: number;
    if (componentCount === 0) {
        index = 0;
        // TODO: do we event need this?
    } else if (state.lastComponentCount === componentCount && state.lastIndex !== null) {
        index = state.lastIndex;
    } else {
        index = componentCount;
    }

    state.slotCounter += 1;
    state.lastComponentCount = componentCount;
    state.lastIndex = index;

    return index;
}

function isLayoutRoot(element: Element): boolean {
    return getLowerTagName(element) === "anvil-form" && !!getAttribute(element, "layout");
}

function getLayoutTypeAttribute(element: Element): string | undefined {
    return getAttribute(element, "layout") || getAttribute(element, "type");
}

function resolveAnvilFormType(element: Element, explicitType: string | undefined, fallback: string): string {
    const candidate = explicitType || getAttribute(element, "container") || "";
    const normalized = stripAnvilPrefix(candidate) || candidate;
    return normalized || fallback;
}

function normalizeBindingCode(value: string | undefined): string {
    return (value ?? "").replace(/&quot;/g, '"');
}

function parseAttributeValue(value: string): any {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function processDataBindingAttribute(
    attr: { name: string; value: string },
    bindingsByProperty: Map<string, DataBindingYaml>,
    orderedBindings: DataBindingYaml[]
): void {
    let prefixLength: number | null = null;
    let enableWriteback = false;
    if (attr.name.startsWith(BIND_PREFIX)) {
        prefixLength = BIND_PREFIX.length;
    } else if (attr.name.startsWith(WRITEBACK_PREFIX)) {
        prefixLength = WRITEBACK_PREFIX.length;
        enableWriteback = true;
    }
    if (prefixLength !== null) {
        const property = attr.name.substring(prefixLength);
        if (property) {
            let binding = bindingsByProperty.get(property);
            if (!binding) {
                binding = { property, code: "" };
                bindingsByProperty.set(property, binding);
                orderedBindings.push(binding);
            }
            binding.code = normalizeBindingCode(attr.value);
            if (enableWriteback) {
                binding.writeback = true;
            } else {
                delete binding.writeback;
            }
        }
    }
}

function extractComponentData(element: Element): {
    type: string;
    name: string;
    properties: { [key: string]: any };
    eventBindings: EventBindingYaml;
    dataBindings: DataBindingYaml[];
    layoutEventBindings: EventBindingYaml;
    layoutProperties: { [key: string]: any };
    oneComponent: boolean;
} {
    const typeAttr = getAttribute(element, "type") || "";
    const nameAttr = getAttribute(element, "name") || "";

    const properties: Record<string, any> = {};
    const eventBindings: EventBindingYaml = {};
    const layoutEventBindings: EventBindingYaml = {};
    const bindingsByProperty = new Map<string, DataBindingYaml>();
    const orderedBindings: DataBindingYaml[] = [];
    const layoutProperties: Record<string, any> = {};
    let oneComponent = false;
    for (const { name, value } of element.attrs) {
        if (name.startsWith("prop:")) {
            const key = name.substring(5);
            properties[key] = parseAttributeValue(value);
        } else if (name.startsWith("on:layout:")) {
            const key = name.substring(10);
            layoutEventBindings[key] = stripSelfPrefix(value);
        } else if (name.startsWith("on:")) {
            const key = name.substring(3);
            eventBindings[key] = stripSelfPrefix(value);
        } else if (name.startsWith("container:")) {
            const key = name.substring(10);
            layoutProperties[key] = parseAttributeValue(value);
        } else if (name === "one-component" || name === "one_component") {
            if (value === "" || value.toLowerCase() === "true") {
                oneComponent = true;
            }
        } else {
            processDataBindingAttribute({ name, value }, bindingsByProperty, orderedBindings);
        }
    }

    return {
        type: typeAttr,
        name: nameAttr,
        properties,
        eventBindings,
        dataBindings: orderedBindings,
        layoutEventBindings,
        layoutProperties,
        oneComponent,
    };
}

function extractFragmentMetadata(element: Element): {
    name?: string;
    properties: { [key: string]: any };
    eventBindings: EventBindingYaml;
    dataBindings: DataBindingYaml[];
    layoutProperties: { [key: string]: any };
} {
    const { name, properties, eventBindings, dataBindings, layoutProperties } = extractComponentData(element);

    return {
        name: name,
        properties,
        eventBindings,
        dataBindings,
        layoutProperties,
    };
}

function extractSlotData(element: Element): {
    name: string;
    layoutProperties: { [key: string]: any };
    oneComponent: boolean;
} {
    const { name, layoutProperties, oneComponent } = extractComponentData(element);

    return {
        name,
        layoutProperties,
        oneComponent,
    };
}

function hasPromotableAttributes(element: Element, promoteDomNodes: boolean = false): boolean {
    return element.attrs.some(
        ({ name }) =>
            name === "anvil:name" ||
            name.startsWith("anvil:prop:") ||
            name.startsWith("anvil:on:") ||
            (promoteDomNodes && name.startsWith("anvil:on-dom:")) ||
            (promoteDomNodes && name === "anvil:dom-node") ||
            name.startsWith("anvil:bind:") ||
            name.startsWith("anvil:writeback:") ||
            name.startsWith("anvil:container:")
    );
}

function ensureAnvilDomNodeAttribute(element: Element): void {
    // Check if element has any anvil:on-dom: attributes
    const hasOnDomAttr = element.attrs.some(({ name }) => name.startsWith("anvil:on-dom:"));

    if (hasOnDomAttr) {
        // Check if anvil:dom-node attribute already exists
        console.log("ensureAnvilDomNodeAttribute", element.attrs);
        const hasDomNodeAttr = element.attrs.some(({ name }) => name === "anvil:dom-node");

        if (!hasDomNodeAttr) {
            // Add anvil:dom-node attribute
            element.attrs.push({ name: "anvil:dom-node", value: "" });
        }
    }
}

function extractPromotedFragmentData(element: Element): {
    name: string | undefined;
    properties: Record<string, any>;
    eventBindings: EventBindingYaml;
    dataBindings: DataBindingYaml[];
    layoutProperties: Record<string, any>;
} {
    const properties: Record<string, any> = {};
    const eventBindings: EventBindingYaml = {};
    const bindingsByProperty = new Map<string, DataBindingYaml>();
    const orderedBindings: DataBindingYaml[] = [];
    const layoutProperties: Record<string, any> = {};
    let name: string | undefined;

    for (const { name: attrName, value } of element.attrs) {
        if (attrName === "anvil:name") {
            name = value;
        } else if (attrName.startsWith("anvil:prop:")) {
            const key = attrName.substring(11); // "anvil:prop:".length
            properties[key] = parseAttributeValue(value);
        } else if (attrName.startsWith("anvil:on:")) {
            const key = attrName.substring(9); // "anvil:on:".length
            eventBindings[key] = stripSelfPrefix(value);
        } else if (attrName.startsWith("anvil:container:")) {
            const key = attrName.substring(16); // "anvil:container:".length
            layoutProperties[key] = parseAttributeValue(value);
        } else if (attrName.startsWith("anvil:bind:") || attrName.startsWith("anvil:writeback:")) {
            // Strip "anvil:" prefix and process as normal binding
            const isWriteback = attrName.startsWith("anvil:writeback:");
            const strippedName = isWriteback
                ? attrName.substring(6) // "anvil:".length, then "writeback:" is handled by processDataBindingAttribute
                : attrName.substring(6); // "anvil:".length, then "bind:" is handled by processDataBindingAttribute
            processDataBindingAttribute({ name: strippedName, value }, bindingsByProperty, orderedBindings);
        }
    }

    return { name, properties, eventBindings, dataBindings: orderedBindings, layoutProperties };
}

function filterAnvilAttributes(attrs: { name: string; value: string }[]): { name: string; value: string }[] {
    // Filter out anvil: attributes, but preserve anvil:on-dom: attributes (they're not promotable)
    return attrs.filter(({ name }) => !name.startsWith("anvil:") || name === "anvil:dom-node" || name.startsWith("anvil:on-dom:"));
}

function parsePromotedFragment(
    element: Element,
    context: ParseContext,
    slotTarget: SlotTarget,
    options: { parentIsFragment: boolean }
): { component: ComponentYaml; dropzoneName?: string } {
    const metadata = extractPromotedFragmentData(element);
    const fragmentName = metadata.name || generateAnonymousComponentName(context);

    const fragmentTarget: SlotTarget = { type: "container", name: fragmentName };

    // Recursively process children
    const { html: childHtml, components } = renderNodes((element.childNodes as Node[]) ?? [], context, fragmentTarget, {
        parentIsFragment: true,
    });

    // Check for anvil:on-dom: attributes and add anvil:dom-node if needed
    // (before filtering, so we can check for anvil:on-dom:)
    ensureAnvilDomNodeAttribute(element);

    // Render the element itself (without anvil: attrs) wrapping the children
    // Note: anvil:dom-node is not an anvil: attribute, so it won't be filtered
    const cleanAttrs = filterAnvilAttributes(element.attrs);
    const elementHtml = renderElement(element.tagName, cleanAttrs, childHtml);

    const fragmentProperties: Record<string, any> = { ...metadata.properties };
    fragmentProperties.html = context.normalizeHtml ? normalizeFragmentHtml(elementHtml) : elementHtml;

    const fragmentComponent: ComponentYaml = {
        type: "HtmlComponent",
        name: fragmentName,
        properties: fragmentProperties,
    };

    if (components.length > 0) {
        fragmentComponent.components = components;
    }

    if (Object.keys(metadata.eventBindings).length > 0) {
        fragmentComponent.event_bindings = metadata.eventBindings;
    }

    if (metadata.dataBindings.length > 0) {
        fragmentComponent.data_bindings = metadata.dataBindings;
    }

    // Handle layout properties / dropzone
    const layoutProps = { ...metadata.layoutProperties };
    let dropzoneName: string | undefined;

    if (options.parentIsFragment) {
        if (layoutProps.dropzone) {
            dropzoneName = layoutProps.dropzone;
        } else {
            dropzoneName = generateDropzoneName(context, slotTarget);
            layoutProps.dropzone = dropzoneName;
        }
    }

    if (Object.keys(layoutProps).length > 0) {
        fragmentComponent.layout_properties = layoutProps;
    }

    return { component: fragmentComponent, dropzoneName };
}

interface RenderNodesOptions {
    parentIsFragment: boolean;
}

function renderNodes(
    nodes: Node[],
    context: ParseContext,
    slotTarget: SlotTarget,
    options: RenderNodesOptions
): {
    html: string;
    components: ComponentYaml[];
} {
    // When rendering nodes, we're inside a fragment context
    const parentIsFragment = options.parentIsFragment;

    const parts: string[] = [];
    const components: ComponentYaml[] = [];

    for (const node of nodes) {
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
        if (isAnvilSlot(element)) {
            const { name, layoutProperties, oneComponent } = extractSlotData(element);
            const slotName = name || generateAnonymousSlotName(context);
            const dropzoneName = generateDropzoneName(context, slotTarget);
            recordSlot(context, slotName, slotTarget, {
                layoutProperties,
                dropzoneName,
                oneComponent,
                index: computeSlotIndex(context, slotTarget),
                parentIsFragment,
            });
            parts.push(`<anvil-dropzone name="${dropzoneName}" data-slot="${slotName}"></anvil-dropzone>`);
            continue;
        }
        if (isAnvilComponent(element)) {
            const { component, dropzoneName } = parseComponent(element, context, slotTarget, { parentIsFragment });
            components.push(component);
            incrementComponentCount(context, slotTarget);
            parts.push(`<anvil-dropzone name="${dropzoneName}"></anvil-dropzone>`);
            continue;
        }
        if (hasPromotableAttributes(element, context.promoteDomNodes)) {
            const { component, dropzoneName } = parsePromotedFragment(element, context, slotTarget, {
                parentIsFragment,
            });
            const resolvedName = dropzoneName ?? generateDropzoneName(context, slotTarget);
            if (!dropzoneName) {
                component.layout_properties = { dropzone: resolvedName };
            }
            components.push(component);
            incrementComponentCount(context, slotTarget);
            parts.push(`<anvil-dropzone name="${resolvedName}"></anvil-dropzone>`);
            continue;
        }

        // Check for anvil:on-dom: attributes and add anvil:dom-node if needed
        ensureAnvilDomNodeAttribute(element);

        // taking all the html fragments, and lifting out the anvil-components/anvil-slots, replacing those with anvil-dropzones
        // and creating ComponentYaml as necessary
        const childResult = renderNodes(element.childNodes || [], context, slotTarget, { parentIsFragment });
        components.push(...childResult.components);
        parts.push(renderElement(element.tagName, element.attrs, childResult.html));
    }

    return { html: parts.join(""), components };
}

interface CanonicalFormDetection {
    element: Element;
    leading: Node[][];
    trailing: Node[][];
}

function detectCanonicalForm(nodes: Node[]): CanonicalFormDetection | null {
    let canonical: Element | null = null;
    const leading: Node[][] = [];
    const trailing: Node[][] = [];
    let currentStray: Node[] | null = null;

    const flushCurrentStray = (target: Node[][]) => {
        if (currentStray && hasRenderableContent(currentStray)) {
            target.push(currentStray);
        }
        currentStray = null;
    };

    for (const node of nodes) {
        if (isWhitespaceOrComment(node)) {
            if (currentStray) {
                currentStray.push(node);
            }
            continue;
        }

        if (isElementNode(node) && isAnvilForm(node as Element)) {
            if (!canonical) {
                flushCurrentStray(leading);
                canonical = node as Element;
            } else {
                if (!currentStray) {
                    currentStray = [];
                }
                currentStray.push(node);
            }
            continue;
        }

        if (!currentStray) {
            currentStray = [];
        }
        currentStray.push(node);
    }

    if (canonical) {
        flushCurrentStray(trailing);
        return { element: canonical, leading, trailing };
    }

    flushCurrentStray(leading);
    return null;
}

interface ParseContainerChildrenOptions {
    parentIsFragment: boolean;
}

function parseContainerChildren(
    children: Node[] | undefined,
    context: ParseContext,
    containerTarget: SlotTarget,
    options: ParseContainerChildrenOptions
): ComponentYaml[] {
    if (!children || children.length === 0) return [];

    // When parsing children of a non-fragment container, ensure we're not in fragment context
    // (renderNodes will set it to true when needed for fragments)
    const parentIsFragment = options.parentIsFragment;

    const result: ComponentYaml[] = [];
    let index = 0;

    while (index < children.length) {
        const child = children[index];

        if (isElementNode(child)) {
            const element = child as Element;

            if (isAnvilSlot(element)) {
                const { name, layoutProperties, oneComponent } = extractSlotData(element);
                const slotName = name || generateAnonymousSlotName(context);
                recordSlot(context, slotName, containerTarget, {
                    layoutProperties,
                    oneComponent,
                    includeEmptyLayout: true,
                    dropzoneName: generateDropzoneName(context, containerTarget),
                    index: computeSlotIndex(context, containerTarget),
                    parentIsFragment,
                });
                index += 1;
                continue;
            }

            if (isAnvilComponent(element)) {
                const { component } = parseComponent(element, context, containerTarget, {
                    parentIsFragment,
                });
                result.push(component);
                incrementComponentCount(context, containerTarget);
                index += 1;
                continue;
            }

            if (hasPromotableAttributes(element, context.promoteDomNodes)) {
                const { component } = parsePromotedFragment(element, context, containerTarget, {
                    parentIsFragment,
                });
                result.push(component);
                incrementComponentCount(context, containerTarget);
                index += 1;
                continue;
            }
        }

        const fragmentNodes: Node[] = [];
        let capturedElement = false;
        while (index < children.length) {
            const current = children[index];
            if (isElementNode(current)) {
                const el = current as Element;
                if (isAnvilSlot(el) || isAnvilComponent(el) || hasPromotableAttributes(el, context.promoteDomNodes)) {
                    break;
                }
                if (capturedElement) {
                    break;
                }
                fragmentNodes.push(current);
                index += 1;
                capturedElement = true;
                continue;
            }
            if (capturedElement) {
                if (current.nodeName === "#text") {
                    const textValue = (current as TextNode).value ?? "";
                    if (textValue.trim().length > 0) {
                        break;
                    }
                } else if (current.nodeName === "#comment") {
                    break;
                }
            }
            fragmentNodes.push(current);
            index += 1;
        }

        if (fragmentNodes.length === 0) {
            continue;
        }

        const fragmentName = generateAnonymousComponentName(context);
        const fragmentTarget: SlotTarget = { type: "container", name: fragmentName };
        const { html, components } = renderNodes(fragmentNodes, context, fragmentTarget, { parentIsFragment: true });
        const fragmentHtml = context.normalizeHtml ? normalizeFragmentHtml(html) : html;
        if ((fragmentHtml.length === 0 || fragmentHtml.trim().length === 0) && components.length === 0) {
            // Skip empty fragments - the anonymous component name was already generated but that's fine
            continue;
        }

        const fragmentComponent: ComponentYaml = {
            type: "HtmlComponent",
            name: fragmentName,
            properties: { html: fragmentHtml },
        };
        if (components.length > 0) {
            fragmentComponent.components = components;
        }
        result.push(fragmentComponent);
        incrementComponentCount(context, containerTarget);
    }

    return result;
}

export function parseLayoutForm(html: string, options?: ParseHtmlFormOptions): ParsedLayoutHtml {
    const fragment = parseFragment(html);
    const nodes = (fragment.childNodes as Node[]) ?? [];
    let layoutElement: Element | undefined;
    const strayBlocks: Node[][] = [];
    let currentStray: Node[] | null = null;

    const flushCurrentStray = () => {
        if (currentStray && hasRenderableContent(currentStray)) {
            strayBlocks.push(currentStray);
        }
        currentStray = null;
    };

    // look for the anvil form element with a layout attribute, in the top level nodes
    for (const node of nodes) {
        if (isWhitespaceOrComment(node)) {
            if (currentStray) {
                currentStray.push(node);
            }
            continue;
        }

        if (isElementNode(node) && isLayoutRoot(node as Element)) {
            if (!layoutElement) {
                flushCurrentStray();
                layoutElement = node as Element;
            } else {
                if (!currentStray) {
                    currentStray = [];
                }
                currentStray.push(node);
            }
            continue;
        }

        if (!currentStray) {
            currentStray = [];
        }
        currentStray.push(node);
    }

    flushCurrentStray();

    // we didn't find one, but we are parsing a layout form so wrap it in an anvil form element, also why are we here!
    if (!layoutElement) {
        const wrappedHtml = `<anvil-form layout="UnknownLayout">${html}</anvil-form>`;
        return parseLayoutForm(wrappedHtml, options);
    }

    const {
        properties: layoutProperties,
        layoutEventBindings,
        dataBindings: layoutDataBindings,
        eventBindings: layoutFormEventBindings,
    } = extractComponentData(layoutElement);
    const layoutType = getLayoutTypeAttribute(layoutElement) || "UnknownLayout";

    const context = createContext(options, true, html);

    const componentsBySlot: Record<string, ComponentYaml[]> = {};
    const blockNames = new Set<string>();
    const duplicateCounts = new Map<string, number>();
    let unknownBlockCounter = 1;

    const generateUnknownBlockName = (): string => {
        let candidate: string;
        do {
            candidate = `$unknown-slot-${unknownBlockCounter++}`;
        } while (blockNames.has(candidate));
        blockNames.add(candidate);
        return candidate;
    };

    const allocateBlockName = (rawName?: string | null): string => {
        const trimmed = rawName?.trim();
        if (!trimmed) {
            return generateUnknownBlockName();
        }
        if (!blockNames.has(trimmed)) {
            blockNames.add(trimmed);
            return trimmed;
        }
        let suffix = duplicateCounts.get(trimmed) ?? 1;
        let candidate: string;
        do {
            candidate = `${trimmed}_copy_${suffix}`;
            suffix += 1;
        } while (blockNames.has(candidate));
        duplicateCounts.set(trimmed, suffix);
        blockNames.add(candidate);
        return candidate;
    };

    const registerBlock = (blockName: string, blockNodes: Node[] | undefined) => {
        const blockComponents = parseContainerChildren(
            blockNodes,
            context,
            {
                type: "slot",
                name: blockName,
            },
            { parentIsFragment: false }
        );
        componentsBySlot[blockName] = blockComponents;
    };

    // find the anvil blocks inside the layout
    const childNodes = (layoutElement.childNodes as Node[]) ?? [];
    for (const child of childNodes) {
        if (isWhitespaceOrComment(child)) {
            continue;
        }
        if (isElementNode(child) && isAnvilBlock(child)) {
            const blockElement = child as Element;
            const blockName = allocateBlockName(getAttribute(blockElement, "slot"));
            registerBlock(blockName, (blockElement.childNodes as Node[]) ?? []);
            continue;
        }

        const fallbackName = generateUnknownBlockName();
        registerBlock(fallbackName, [child]);
    }

    for (const stray of strayBlocks) {
        const fallbackName = generateUnknownBlockName();
        registerBlock(fallbackName, stray);
    }

    const layout: FormLayoutYaml = { type: layoutType };
    if (Object.keys(layoutProperties).length > 0) {
        layout.properties = layoutProperties;
    }
    if (Object.keys(layoutEventBindings).length > 0) {
        layout.event_bindings = layoutEventBindings;
    }
    if (Object.keys(layoutFormEventBindings).length > 0) {
        layout.form_event_bindings = layoutFormEventBindings;
    }
    if (layoutDataBindings.length > 0) {
        layout.data_bindings = layoutDataBindings;
    }

    // Slots will be sorted once during serialization in createSerializerContext
    const slots = Object.keys(context.slots).length > 0 ? context.slots : undefined;

    return {
        layout,
        components_by_slot: componentsBySlot,
        slots,
    };
}

interface ParseComponentOptions {
    parentIsFragment: boolean;
}

function parseComponent(
    element: Element,
    context: ParseContext,
    target: SlotTarget,
    options: ParseComponentOptions
): { component: ComponentYaml; dropzoneName: string } {
    const parentIsFragment = options.parentIsFragment;
    const dropzoneName = generateDropzoneName(context, target);
    const { type, name, properties, eventBindings, dataBindings, layoutProperties } = extractComponentData(element);
    const normalizedType = stripAnvilPrefix(type);
    const effectiveName = name || generateAnonymousComponentName(context);

    let childComponents: ComponentYaml[] | undefined;
    const containerType = normalizedType || type;
    // normalizedType is already stripped, so use it directly for the container check
    // Containers are identified by type + set membership. html-form authoring often adds
    // transient child nodes, so we also treat any component that actually has children
    // as a container to make parsing resilient.
    if ((normalizedType && CONTAINER_TYPES.has(normalizedType)) || element.childNodes?.length) {
        const containerTarget: SlotTarget = { type: "container", name: effectiveName };
        const parsedChildren = parseContainerChildren(element.childNodes, context, containerTarget, {
            parentIsFragment: containerType === "HtmlComponent",
        });
        if (parsedChildren.length > 0) {
            childComponents = parsedChildren;
        }
    }

    const component: ComponentYaml = {
        type: normalizedType || type,
        name: effectiveName,
        properties,
    };

    const layoutProps = { ...layoutProperties };
    // Always include dropzone in parsed output:
    // 1. User provided container:dropzone (already in layoutProps from layoutProperties)
    // 2. Generated dropzone name (always add during parsing, serialization will skip if in fragment)
    if (!layoutProperties.dropzone && parentIsFragment) {
        // No user-provided dropzone - add generated dropzone name
        // Note: Serialization will skip this dropzone if parentIsFragment is true
        layoutProps.dropzone = dropzoneName;
    }
    if (Object.keys(layoutProps).length > 0) {
        component.layout_properties = layoutProps;
    }

    if (childComponents) {
        component.components = childComponents;
    }

    if (Object.keys(eventBindings).length > 0) {
        component.event_bindings = eventBindings;
    }

    if (dataBindings.length > 0) {
        component.data_bindings = dataBindings;
    }

    return { component, dropzoneName };
}

export function parseContainerForm(
    html: string,
    containerType: string = "HtmlComponent",
    options?: ParseHtmlFormOptions
): ParsedFormYaml {
    const fragment = parseFragment(html);
    const nodes = (fragment.childNodes as Node[]) ?? [];
    const context = createContext(options, false, html);
    const rootTarget: SlotTarget = { type: "container", name: "" };

    const significantNodes = nodes.filter((node) => !isWhitespaceOrComment(node));
    // find the anvil-form (which there might not be one if it's implicit)
    const canonicalForm = detectCanonicalForm(nodes);
    let handledCanonical = false;

    let components: ComponentYaml[] = [];
    let containerTypeOverride = containerType;
    const containerProperties: Record<string, any> = {};
    let containerEventBindings: EventBindingYaml | undefined;
    let containerDataBindings: DataBindingYaml[] | undefined;
    let containerLayoutProperties: { [key: string]: any } | undefined;

    const appendSegmentsAsComponents = (segments: Node[][]) => {
        if (segments.length === 0) return;
        for (const segment of segments) {
            const parsedSegment = parseContainerChildren(segment, context, rootTarget, {
                parentIsFragment: false,
            });
            if (parsedSegment.length > 0) {
                components.push(...parsedSegment);
            }
        }
    };

    const flattenSegments = (segments: Node[][]): Node[] => {
        if (segments.length === 0) {
            return [];
        }
        return segments.reduce<Node[]>((acc, segment) => {
            acc.push(...segment);
            return acc;
        }, []);
    };

    const applyMetadataToContainer = (metadata: ReturnType<typeof extractComponentData>) => {
        Object.assign(containerProperties, metadata.properties || {});
        if (metadata.eventBindings && Object.keys(metadata.eventBindings).length > 0) {
            containerEventBindings = metadata.eventBindings;
        }
        if (metadata.dataBindings && metadata.dataBindings.length > 0) {
            containerDataBindings = metadata.dataBindings;
        }
        if (metadata.layoutProperties && Object.keys(metadata.layoutProperties).length > 0) {
            containerLayoutProperties = metadata.layoutProperties;
        }
    };

    if (canonicalForm) {
        const element = canonicalForm.element;
        const metadata = extractComponentData(element);
        const normalizedType = resolveAnvilFormType(element, metadata.type, containerType);

        if (normalizedType === "HtmlComponent") {
            handledCanonical = true;
            /**
             * HtmlComponent canonical: treat everything as raw HTML so we
             * preserve the original markup rather than wrapping components.
             * We flatten the leading/trailing orphan segments plus the form
             * children and run them back through renderNodes to generate
             * dropzones/components.
             */
            const mergedNodes: Node[] = [
                ...flattenSegments(canonicalForm.leading),
                ...((element.childNodes as Node[]) ?? []),
                ...flattenSegments(canonicalForm.trailing),
            ];

            const rendered = renderNodes(mergedNodes, context, rootTarget, { parentIsFragment: true });
            components = rendered.components;
            containerProperties.html = context.normalizeHtml ? normalizeFragmentHtml(rendered.html) : rendered.html;

            applyMetadataToContainer(metadata);
            containerTypeOverride = "HtmlComponent";
        } else {
            handledCanonical = true;
            /**
             * Non-HTML canonical: treat the canonical anvil-form as the real container.
             * Leading/trailing DOM becomes HtmlComponent components, while the form's
             * child nodes are parsed as container children.
             */
            appendSegmentsAsComponents(canonicalForm.leading);
            const canonicalChildren = parseContainerChildren(
                (element.childNodes as Node[]) ?? [],
                context,
                rootTarget,
                { parentIsFragment: false }
            );
            if (canonicalChildren.length > 0) {
                components.push(...canonicalChildren);
            }
            appendSegmentsAsComponents(canonicalForm.trailing);

            applyMetadataToContainer(metadata);
            containerTypeOverride = normalizedType;
        }
    }

    if (!handledCanonical) {
        // Check for a single top-level element with promotable attributes (like single anvil-fragment)
        if (
            significantNodes.length === 1 &&
            isElementNode(significantNodes[0]) &&
            hasPromotableAttributes(significantNodes[0] as Element, context.promoteDomNodes)
        ) {
            const element = significantNodes[0] as Element;
            const metadata = extractPromotedFragmentData(element);
            const tagName = getLowerTagName(element);

            // Recursively process children
            const { html, components: childComponents } = renderNodes(
                (element.childNodes as Node[]) ?? [],
                context,
                rootTarget,
                { parentIsFragment: true }
            );

            components = childComponents;

            // Check for anvil:on-dom: attributes and add anvil:dom-node if needed
            ensureAnvilDomNodeAttribute(element);

            // Preserve the original element itself (not just inner content) to maintain element type
            // This ensures <button> stays as <button>, <input> stays as <input>, etc.
            // Note: anvil:dom-node is not an anvil: attribute, so it won't be filtered
            const cleanAttrs = filterAnvilAttributes(element.attrs);
            const elementHtml = renderElement(tagName, cleanAttrs, html);
            containerProperties.html = context.normalizeHtml ? normalizeFragmentHtml(elementHtml) : elementHtml;

            // Apply metadata to container (ignore name and layout properties for top-level)
            Object.assign(containerProperties, metadata.properties || {});
            if (metadata.eventBindings && Object.keys(metadata.eventBindings).length > 0) {
                containerEventBindings = metadata.eventBindings;
            }
            if (metadata.dataBindings && metadata.dataBindings.length > 0) {
                containerDataBindings = metadata.dataBindings;
            }
            // Note: layout properties are ignored for top-level fragments (as per old behavior)

            containerTypeOverride = "HtmlComponent";
        } else {
            const rendered = renderNodes(nodes, context, rootTarget, { parentIsFragment: true });
            components = rendered.components;
            containerProperties.html = context.normalizeHtml ? normalizeFragmentHtml(rendered.html) : rendered.html;
            containerTypeOverride = containerType;
        }
    }

    const container: FormContainerYaml = {
        type: containerTypeOverride,
        properties: containerProperties,
    };

    if (containerEventBindings) {
        container.event_bindings = containerEventBindings;
    }
    if (containerDataBindings) {
        container.data_bindings = containerDataBindings;
    }
    if (containerLayoutProperties) {
        container.layout_properties = containerLayoutProperties;
    }

    const result: ParsedFormYaml = {
        container,
        components,
    };

    // Slots will be sorted once during serialization in createSerializerContext
    const sortedSlots = sortSlotsByName(Object.keys(context.slots).length > 0 ? context.slots : undefined);
    if (sortedSlots) {
        result.slots = sortedSlots;
    }

    result.serialized_html = context.normalizeHtml ? normalizeFragmentHtml(html) : html;

    return result;
}

interface SelectionNameMaps {
    components: Map<number, string>;
    slots: Map<number, string>;
}

/**
 * Builds maps of character positions to component and slot names, allowing the editor to determine
 * which element corresponds to a given cursor position even when the element lacks an explicit `name`.
 *
 * Uses parse5's sourceCodeLocation feature to get accurate positions directly from the parsed tree,
 * eliminating the need for regex-based position matching.
 *
 * @param html The HTML string to parse
 * @returns Maps keyed by the starting character index of each tag (`<anvil-component>` / `<anvil-slot>`)
 */
export function buildSelectionNameMaps(html: string): SelectionNameMaps {
    // Enable source location tracking to get accurate positions from parse5
    const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
    const context = createContext(undefined, false);
    const componentMap = new Map<number, string>();
    const slotMap = new Map<number, string>();

    function walkNodes(nodes: Node[]): void {
        for (const node of nodes) {
            if (!isElementNode(node)) {
                continue;
            }
            const element = node as Element;

            // Get the start tag position from sourceCodeLocation (character offset)
            const startOffset = element.sourceCodeLocation?.startTag?.startOffset;

            if (isAnvilComponent(element)) {
                const nameAttr = getAttribute(element, "name");
                const effectiveName = nameAttr || generateAnonymousComponentName(context);
                // Only add to map if we have a valid position
                if (startOffset !== undefined) {
                    componentMap.set(startOffset, effectiveName);
                }
            } else if (isAnvilSlot(element)) {
                const nameAttr = getAttribute(element, "name");
                const effectiveName = nameAttr || generateAnonymousSlotName(context);
                // Only add to map if we have a valid position
                if (startOffset !== undefined) {
                    slotMap.set(startOffset, effectiveName);
                }
            } else if (hasPromotableAttributes(element, context.promoteDomNodes)) {
                // Check for elements with anvil:name attribute (promoted fragments)
                const anvilNameAttr = getAttribute(element, "anvil:name");
                const effectiveName = anvilNameAttr || generateAnonymousComponentName(context);
                // Only add to map if we have a valid position
                if (startOffset !== undefined) {
                    componentMap.set(startOffset, effectiveName);
                }
            }

            if (element.childNodes) {
                walkNodes(element.childNodes as Node[]);
            }
        }
    }

    walkNodes((fragment.childNodes as Node[]) ?? []);

    return {
        components: componentMap,
        slots: slotMap,
    };
}
