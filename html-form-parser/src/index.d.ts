export type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

export interface DataBindingYaml {
    property: string;
    code: string;
    writeback?: boolean;
}

export interface ComponentYaml {
    type: string;
    name: string;
    properties: Record<string, JsonLike>;
    layout_properties?: Record<string, JsonLike>;
    event_bindings?: Record<string, string>;
    data_bindings?: DataBindingYaml[];
    components?: ComponentYaml[];
}

export interface FormContainerYaml {
    type: string;
    properties?: Record<string, JsonLike>;
    layout_properties?: Record<string, JsonLike>;
    event_bindings?: Record<string, string>;
    data_bindings?: DataBindingYaml[];
}

export interface FormLayoutYaml {
    type: string;
    properties?: Record<string, JsonLike>;
    event_bindings?: Record<string, string>;
    form_event_bindings?: Record<string, string>;
    data_bindings?: DataBindingYaml[];
}

export interface SlotDefYaml {
    target: {
        type: "container" | "slot";
        name: string;
    };
    index: number;
    set_layout_properties?: Record<string, JsonLike>;
    one_component?: boolean;
    placeholder_text?: string;
}

export type SlotDefsYaml = Record<string, SlotDefYaml>;

export interface FormContainerTemplateYaml {
    container: FormContainerYaml;
    components?: ComponentYaml[];
    slots?: SlotDefsYaml;
    [key: string]: unknown;
}

export interface FormLayoutTemplateYaml {
    layout: FormLayoutYaml;
    components_by_slot?: Record<string, ComponentYaml[]>;
    slots?: SlotDefsYaml;
    [key: string]: unknown;
}

export interface FormYaml {
    container?: FormContainerYaml;
    components?: ComponentYaml[];
    layout?: FormLayoutYaml;
    components_by_slot?: Record<string, ComponentYaml[]>;
    slots?: SlotDefsYaml;
}

export interface ParseHtmlFormOptions {
    dropzoneNameGenerator?: () => string;
    normalizeHtml?: boolean;
    extractRootStyling?: boolean;
    domNodePromotion?: "annotated" | "all";
    selectionNameMaps?: SelectionNameMaps;
}

export interface SelectionNameMaps {
    components: Map<number, string>;
    slots: Map<number, string>;
}

export interface SerializeHtmlOptions {
    indentSize?: number;
    allowReparse?: boolean;
    parserOptions?: ParseHtmlFormOptions;
}

export interface SerializeHtmlResult {
    html: string;
    structuralHtmlChanged: boolean;
}

export interface FormSpecPackageContext {
    appPackageName?: string;
    knownPackageNames?: string[];
    dependencyPackageNamesByLogicalDepId?: Record<string, string | undefined>;
}

export interface FormSpecRewriteResult {
    /** Rewritten copy of the input form. The parser does not mutate the input object. */
    form: FormYaml;
    changed: boolean;
}

export interface FormSpecRewriters {
    customComponentSpec?: (customComponentSpec: string) => string | null | undefined;
    formPropertySpec?: (formPropertySpec: string) => string | null | undefined;
    /** Component YAML type -> names of properties whose component metadata type is "form". */
    formTypedPropertyNamesByComponentType?: Record<string, string[]>;
}

export interface ParsedFormYaml {
    container: FormContainerYaml;
    components: ComponentYaml[];
    slots?: SlotDefsYaml;
    serialized_html?: string;
}

export interface ParsedLayoutHtml {
    layout: FormLayoutYaml;
    components_by_slot: Record<string, ComponentYaml[]>;
    slots?: SlotDefsYaml;
}

export type ParsedHtmlTemplate = ParsedLayoutHtml | ParsedFormYaml;

export interface DomNodeRef {
    name: string;
    tagName: string;
}

export type FormTemplateSourceFormat = "yaml" | "html";

/**
 * Parsed local form-template file content.
 *
 * This is a low-level save adapter input, not a validated form model:
 * - `template` contains YAML template fields or HTML frontmatter fields.
 * - `serializedHtml` is the raw HTML body and is required for `format: "html"`.
 * - parser-owned managed fields are stripped later by `buildFormTemplateSavePayload`.
 */
export interface FormTemplateSource {
    format: FormTemplateSourceFormat;
    template: Record<string, unknown>;
    serializedHtml?: string;
}

/**
 * Trusted identity derived by the caller from app storage paths and companion
 * Python source, not from user-editable template YAML/frontmatter.
 */
export interface FormTemplateSaveIdentity {
    /** Python class name used by the server-side form object. Must be non-empty. */
    className: string;
    /** Companion Python file contents. Empty string is allowed. */
    code: string;
    /** Whether the form is stored as `FormName/__init__.py` plus template. */
    isPackage: boolean;
}

/** Full form object suitable for Anvil save API updates. */
export interface FormTemplateSavePayload extends Record<string, unknown> {
    class_name: string;
    code: string;
    is_package: boolean;
    save_as_html?: true;
    serialized_html?: string;
}

export function setDefaultDropzoneNameGenerator(factory: (() => () => string) | null): void;
export function hashString(value: string): number;
export function createHashBasedDropzoneNameGenerator(seed?: number): () => string;
export function createDeterministicDropzoneNameGenerator(seed?: number): () => string;
export function parseSerializedHtml(html: string, options?: ParseHtmlFormOptions): ParsedHtmlTemplate;
export function parseLayoutForm(html: string, options?: ParseHtmlFormOptions): ParsedLayoutHtml;
export function parseContainerForm(
    html: string,
    containerType?: string,
    options?: ParseHtmlFormOptions
): ParsedFormYaml;
export function buildSelectionNameMaps(html: string, options?: ParseHtmlFormOptions): SelectionNameMaps;
export function extractDomNodeNames(html: string): string[];
export function extractDomNodeRefs(html: string): DomNodeRef[];
export function serializeFormContainerWithResult(
    parsed: FormYaml | ParsedFormYaml,
    options?: SerializeHtmlOptions
): SerializeHtmlResult;
export function serializeFormContainer(parsed: FormYaml | ParsedFormYaml, options?: SerializeHtmlOptions): string;
export function serializeFormLayoutWithResult(
    parsed: FormYaml | ParsedLayoutHtml,
    options?: SerializeHtmlOptions
): SerializeHtmlResult;
export function serializeFormLayout(parsed: FormYaml | ParsedLayoutHtml, options?: SerializeHtmlOptions): string;
export function serializeFormTemplateHtml(parsed: FormYaml, options?: SerializeHtmlOptions): string;
/**
 * Parse local form-template file content without structurally parsing or
 * normalizing serialized HTML. Throws if YAML/frontmatter is not an object.
 */
export function parseFormTemplateSource(
    content: string,
    options: { format: FormTemplateSourceFormat }
): FormTemplateSource;
/**
 * Build the full form payload sent over the save API. Throws if required
 * identity/source fields are missing or incorrectly typed, so callers do not
 * accidentally emit unsavable payloads.
 */
export function buildFormTemplateSavePayload(
    source: FormTemplateSource,
    identity: FormTemplateSaveIdentity
): FormTemplateSavePayload;
/**
 * One-time canonicalization used when YAML is serialized into HTML-backed
 * forms. Known app/dependency specs are rewritten to package-qualified names.
 *
 * Does not mutate `form`; callers that want in-place updates must apply the
 * returned `form` when `changed` is true.
 */
export function copyFormYamlWithCanonicalizedFormSpecs(
    form: FormYaml,
    context: FormSpecPackageContext
): FormSpecRewriteResult;
/**
 * General traversal hook for callers that need to rewrite customComponentSpec
 * and formPropertySpec values, for example form or package renames.
 *
 * Does not mutate `form`; callers that want in-place updates must apply the
 * returned `form` when `changed` is true.
 */
export function copyFormYamlWithRewrittenFormSpecs(form: FormYaml, rewriters: FormSpecRewriters): FormSpecRewriteResult;
