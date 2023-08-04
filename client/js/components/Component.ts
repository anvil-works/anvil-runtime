import {
    Args,
    Kws,
    Suspension,
    arrayFromIterable,
    buildNativeClass,
    buildPyClass,
    chainOrSuspend,
    checkOneArg,
    checkString,
    isTrue,
    objectRepr,
    pyBool,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyException,
    pyFalse,
    pyFunc,
    pyIterable,
    pyNone,
    pyNoneType,
    pyObject,
    pyStr,
    pyTrue,
    pyTuple,
    pyType,
    pyTypeError,
    pyValueError,
    retryOptionalSuspensionOrThrow,
    toJs,
    toPy,
} from "../@Sk";
import PyDefUtils, { remapToJsOrWrap } from "../PyDefUtils";
import { ComponentYaml, FormLayoutYaml } from "../runner/data";
import {
    kwToObj,
    objToKw,
    s_add_event_handler,
    s_anvil_disable_drop_mode,
    s_anvil_dom_element,
    s_anvil_enable_drop_mode,
    s_anvil_events,
    s_anvil_get_container_design_info,
    s_anvil_get_design_info,
    s_anvil_get_section_dom_element,
    s_anvil_get_sections,
    s_anvil_set_property_values,
    s_anvil_set_section_property_values,
    s_anvil_setup_dom,
    s_anvil_update_design_name,
    s_anvil_update_layout_properties,
    s_name,
    s_raise_event,
} from "../runner/py-util";
import { HasRelevantHooks } from "../runner/python-objects";
import type {YamlCreationStack} from "@runtime/runner/component-creation";

// The *real* base Component class. It implements the event APIs, the __anvil_xyz/anvil$hooks API, and that's it.

// A subclass can specify a set of events that can be raised on this component by providing a list in _anvil_events
// (Currently this is a list of strings, but that will probably change when components occur)

// This is a private method for quick lookup of a python parent
// To achieve this in python:
//     component.parent is not None
// should work but there is an odd case when someone has named a component parent on their form
// The most correct version might be
//     Component.parent.__get__(component, type(component)) is not None
export function getPyParent(pyComponent: Component) {
    return pyComponent?._Component?.parent?.pyParent;
}

export const isComponent = (c: any): c is Component => !!c?.anvil$hooks;

const unwrapDomElement = (elt: any, pyComponent: Component) => {
    if (!elt?.js$wrapped?.tagName) {
        throw new Sk.builtin.ValueError(`"${Sk.abstr.typeName(pyComponent)}" component did not provide a valid DOM element (got ${Sk.abstr.typeName(elt)} instead)`);
    }
    return elt.js$wrapped as HTMLElement;
};

interface NonSuspendableHookMapping {
    jsMethod: keyof AnvilHooks;
    pythonMethod: pyStr;
    canSuspend: false;
    jsCall?: (method: pyCallable, ...args: any[]) => any;
    pyCall?: (hooks: AnvilHooks, ...args: pyObject[]) => pyObject;
    $flags?: { NamedArgs: string[]; Defaults?: pyObject[]; },
    $doc?: string,
}

interface SuspendableHookMapping {
    jsMethod: keyof AnvilHooks;
    pythonMethod: pyStr;
    canSuspend: true;
    jsCall?: (method: pyCallable, ...args: any[]) => any | Suspension;
    pyCall?: (hooks: AnvilHooks, ...args: pyObject[]) => pyObject | Suspension;
    $flags?: { NamedArgs: string[]; Defaults?: pyObject[]; },
    $doc?: string,
}
type HookMapping = SuspendableHookMapping | NonSuspendableHookMapping;

const hookMappings: HookMapping[] = [{
    jsMethod: "setupDom",
    pythonMethod: s_anvil_setup_dom,
    canSuspend: true,
    $doc: "Return the DOM element for this component, doing any necessary setup. May block, but must return a DOM element",
    jsCall(method, ...args) {
        return chainOrSuspend(pyCallOrSuspend(method, args.map(toPy)), pyElement => {
            const element = toJs(pyElement);
            if (!element) {
                throw new pyValueError(`setup_dom cannot return None: ${method}`);
            }
            return element;
        })
    }
}, {
    jsMethod: "setPropertyValues",
    pythonMethod: s_anvil_set_property_values,
    canSuspend: true,
    $flags: { NamedArgs: ["property_values"] },
    $doc: "Set multiple property values at once",
}, {
    jsMethod: "updateDesignName",
    pythonMethod: s_anvil_update_design_name,
    canSuspend: false,
    $flags: { NamedArgs: ["name"] },
    $doc: "Inform a component of its current name, for display if necessary. Design mode only."
}, {
    jsMethod: "getDesignInfo",
    pythonMethod: s_anvil_get_design_info,
    canSuspend: false,
    $flags: { NamedArgs: ["as_layout"], Defaults: [pyFalse] },
    $doc: "Get information for displaying this component's property palette and interactions. Design mode only.",
}, {
    jsMethod: "getContainerDesignInfo",
    pythonMethod: s_anvil_get_container_design_info,
    canSuspend: false,
    $flags: { NamedArgs: ["for_child"] },
    jsCall(method, forChild) {
        return remapToJsOrWrap(Sk.misceval.callsimArray(method, [forChild]));
    },
    pyCall(hooks, forChild) {
        if (!(forChild instanceof Component)) {
            throw new pyValueError("for_child must be a Component instance");
        }
        return toPy(hooks.getContainerDesignInfo!(forChild));
    },
    $doc: "For containers: Get information for displaying a child component's layout properties and container interaction. Design mode only.",
}, {
    jsMethod: "enableDropMode",
    pythonMethod: s_anvil_enable_drop_mode,
    canSuspend: false,
    $flags: { NamedArgs: ["dropping", "allow_other_component_updates"], Defaults: [pyFalse] },
    $doc: "For containers: Set up, and get a list of, available drop zones. Design mode only.",
}, {
    jsMethod: "disableDropMode",
    pythonMethod: s_anvil_disable_drop_mode,
    canSuspend: false,
    $doc: "For containers: Clean up possible drop zones. Design mode only.",
}, {
    jsMethod: "updateLayoutProperties",
    pythonMethod: s_anvil_update_layout_properties,
    canSuspend: false,
    $flags: { NamedArgs: ["for_child", "updates"] },
    jsCall(method, forChild, updates=null) {
        return toJs(Sk.misceval.callsimArray(method, [forChild, toPy(updates)]));
    },
    pyCall(hooks, forChild, updates) {
        if (!(forChild instanceof Component)) {
            throw new pyValueError("for_child must be a Component instance");
        }
        if (!(updates instanceof pyDict)) {
            throw new pyValueError("updates must be a dictionary");
        }
        return toPy(hooks.updateLayoutProperties!(forChild, toJs(updates) as LayoutProperties));
    },
}, {
    jsMethod: "getSections",
    pythonMethod: s_anvil_get_sections,
    canSuspend: false,
}, {
    jsMethod: "getSectionDomElement",
    pythonMethod: s_anvil_get_section_dom_element,
    canSuspend: false,
    $flags: { NamedArgs: ["section_id"] },
}, {
    jsMethod: "setSectionPropertyValues",
    pythonMethod: s_anvil_set_section_property_values,
    canSuspend: false,
    $flags: { NamedArgs: ["section_id", "updates"] },
}];

const getHooksWithOverrides = (baseHooks: AnvilHooks, pyComponent: Component, cls: ComponentConstructor) => {
    const hooks = Object.create(baseHooks);
    const {_ComponentClass: {providesHooksInPython}} = cls;

    const domElementDescriptor = providesHooksInPython["domElement"]
    if (domElementDescriptor) {
        Object.defineProperty(hooks, "domElement", {
            get() {
                const pyElement = domElementDescriptor.tp$descr_get!(pyComponent, pyComponent.ob$type);
                return toJs(pyElement);
            }
        });
    }

    for (const {jsMethod, pythonMethod, jsCall, canSuspend} of hookMappings) {
        if (providesHooksInPython[jsMethod]) {
            const method = providesHooksInPython[jsMethod]?.tp$descr_get!(pyComponent, cls) as pyCallable;
            hooks[jsMethod] = jsCall ?
                (...args: any[]) => jsCall(method, ...args) :
                canSuspend ?
                    (...args: any[]) => chainOrSuspend(pyCallOrSuspend(method, args.map(toPy)), remapToJsOrWrap) :
                    (...args: any[]) => remapToJsOrWrap(retryOptionalSuspensionOrThrow(pyCallOrSuspend(method, args.map(toPy))));
        }
    }
    return hooks;
};

const overrideJsHooksWithPython = (pyComponent: Component, cls: ComponentConstructor) => {
    // This function is because of some ugly sequencing. At __new__ time, the base Component class
    // wants to implement "Python functionality can override JS hooks", but the anvil$hooks hasn't
    // been initialised yet - that will happen in subclass __new__. So we make anvil$hooks a property
    // that wraps the actual hooks and overrides with JS hooks.
    // TODO it would be nice to compute more of this up-front rather than per-instance. Can we make
    //   anvil$hooks a class/prototype thing, not a dynamic thing? (Kinda hard, as it's supposed to know about
    //   the instance...) Fortunately, anvil$hooks is a private API, so we can change this later.

    const baseHooks = {
        domElement: null,
        setupDom() {
            const d = this.domElement;
            if (d) { return d; }
            throw new pyException(`setup_dom not defined for ${Sk.abstr.typeName(pyComponent)}`);
        },
    };

    let wrappedHooks: AnvilHooks = getHooksWithOverrides(baseHooks, pyComponent, cls);
    pyComponent._Component.unwrappedHooks = baseHooks;

    Object.defineProperty(pyComponent, "anvil$hooks", {
        get() {
            return wrappedHooks;
        },
        set(v: AnvilHooks) {
            pyComponent._Component.unwrappedHooks = v;
            wrappedHooks = getHooksWithOverrides(v, pyComponent, cls);
        }
    });
};

const pythonMethodDescriptorsForJsHooks = Object.fromEntries(hookMappings.map(({pythonMethod, jsMethod, pyCall, canSuspend, $flags, $doc}) => [
    pythonMethod.toString(),
    {
        $get(this: Component) {
            const hooks = this._Component.unwrappedHooks;
            const f = hooks[jsMethod] as ((...args:any[]) => any) | undefined;
            if (f) {
                return new Sk.builtin.sk_method({
                    $meth: pyCall ?? function(this: Component, ...args: pyObject[]) {
                        const r = f.apply(hooks, args.map(toJs));
                        return canSuspend ? chainOrSuspend(r, toPy) : toPy(retryOptionalSuspensionOrThrow(r));
                    },
                    $flags: $flags ?? { NoArgs: true },
                    $doc
                }, this) as pyObject;
            }
        }
    }
]).concat([[
    "_anvil_dom_element_",
    {
        $get(this:Component) {
            return toPy(this.anvil$hooks.domElement);
        }
    }
]]));

export interface ComponentTag extends pyObject {
    $d: pyDict;
}

export const ComponentTag = buildPyClass<ComponentTag>(
    { __name__: new pyStr("anvil") },
    ($gbl, $loc) => {
        $loc.__serialize__ = new pyFunc((self: ComponentTag) => self.$d);
        $loc.__repr__ = new pyFunc((self: ComponentTag) => new pyStr("ComponentTag(" + objectRepr(self.$d) + ")"));
    },
    "ComponentTag"
);

function eventDescriptionToString(event: pyStr | pyDict) {
    if (checkString(event)) {
        return event.toString();
    } else if (event instanceof pyDict) {
        const eventName = event.quick$lookup(s_name);
        if (eventName !== undefined && checkString(eventName)) {
            return eventName.toString();
        }
    }
    // fall through
    throw new pyTypeError(`Invalid argument for ${objectRepr(s_anvil_events)}, got ${objectRepr(event)}`);
}

const s___mro__ = new pyStr("__mro__");

export function initComponentSubclass(cls: ComponentConstructor) {
    const mro = cls.tp$getattr<pyTuple<pyType>>(s___mro__);
    const allowedEvents = new Set<string>();
    for (const c of arrayFromIterable(mro)) {
        if (c === Component) break;
        // we could check if c is a subclass of Component, but seems unnecessary
        const pyAllowedEvents = c.tp$getattr<pyIterable<pyStr>>(s_anvil_events);
        if (!pyAllowedEvents) continue;
        for (const pyEvent of arrayFromIterable(pyAllowedEvents)) {
            allowedEvents.add(eventDescriptionToString(pyEvent));
        }
    }
    const providesHooksInPython: HookDescriptors = {};
    for (const {pythonMethod, jsMethod} of [...hookMappings, {pythonMethod: s_anvil_dom_element, jsMethod: "domElement" as keyof AnvilHooks}]) {
        const descr = cls.$typeLookup(pythonMethod);
        if (descr?.tp$descr_get && descr !== Component.$typeLookup(pythonMethod)) {
            providesHooksInPython[jsMethod] = descr;
        }
    }
    cls._ComponentClass = { allowedEvents, providesHooksInPython };
    return pyNone;
}

// This is something of a hack, so it's pretty self-contained - Component.__new__ just forwards this information
// to forms.ts
let yamlStackForNextComponent: YamlCreationStack;
let yamlStackForThisComponent: YamlCreationStack;
export const setYamlStackForNextComponent = (yamlStack: YamlCreationStack) => { yamlStackForNextComponent = yamlStack; };
export const getYamlStackForThisComponent = () => yamlStackForThisComponent;
// end hack

let defaultDepId: string | undefined | null;
let onNextInstantiation: ((c: Component) => void) | undefined;

export const setDefaultDepIdForNextComponent = (depId: string | null) => { defaultDepId = depId; }; // call immediately before instantiating a component
export const getDefaultDepIdForComponent = (component: Component | undefined) => component?._Component.defaultDepId ?? null;
export const runOnNextInstantiation = (f: (c: Component) => void) => {
    onNextInstantiation = f;
};

interface ComponentState {
    allowedEvents: Set<string>;
    eventHandlers: { [eventName: string]: pyCallable[] };
    parent?: { pyParent: Component; remove: (() => void)[]; setVisibility?: (v: boolean) => void };
    lastVisibility?: boolean;
    tag: pyObject;
    defaultDepId: string | null;
    unwrappedHooks?: any;
}

type DesignerHint = "align-horizontal" | "font-bold" | "font-italic" | "font-underline" | "visible" | "enabled" | "background-color" | "foreground-color" | "border";

export interface PropertyDescriptionBase {
    name: string;
    type: string;
    description?: string;
    important?: boolean;
    group?: string | null;
    designerHint?: DesignerHint;
    hidden?: boolean;
    deprecated?: boolean;
    supportsWriteback?: boolean;
}

export type StringPropertyType = "string";
export type StringListPropertyType = "text[]"; // Consistency is the last resort of the unimaginative.
export type NumberPropertyType = "number";
export type BooleanPropertyType = "boolean";
export type FormPropertyType = "form";
export type ObjectPropertyType = "object" | "dict";
export type EnumPropertyType = "enum";
export type ColorPropertyType = "color";
export type IconPropertyType = "icon";
export type RolePropertyType = "themeRole";
export type UriPropertyType = "uri";
export type HtmlPropertyType = "html";
export type RecordTypePropertyType = "recordType";
export type MarginPropertyType = "margin";
export type PaddingPropertyType = "padding";
export type SpacingPropertyType = "spacing";
export type PropertyType =
    | StringPropertyType
    | StringListPropertyType
    | EnumPropertyType
    | NumberPropertyType
    | BooleanPropertyType
    | FormPropertyType
    | ObjectPropertyType
    | ColorPropertyType
    | IconPropertyType
    | RolePropertyType
    | UriPropertyType
    | HtmlPropertyType
    | RecordTypePropertyType
    | MarginPropertyType
    | PaddingPropertyType
    | SpacingPropertyType;

export interface StringPropertyDescription extends PropertyDescriptionBase { type: StringPropertyType; multiline?: boolean, inlineEditElement?: string}
export interface StringListPropertyDescription extends PropertyDescriptionBase {type: StringListPropertyType; }
export interface NumberPropertyDescription extends PropertyDescriptionBase { type: NumberPropertyType; }
export interface BooleanPropertyDescription extends PropertyDescriptionBase { type: BooleanPropertyType; }
export interface FormPropertyDescription extends PropertyDescriptionBase { type: FormPropertyType; }
export interface ObjectPropertyDescription extends PropertyDescriptionBase { type: ObjectPropertyType; }
export interface ColorPropertyDescription extends PropertyDescriptionBase {type: ColorPropertyType; }
export interface IconPropertyDescription extends PropertyDescriptionBase {type: IconPropertyType; iconset?: string }
export interface RolePropertyDescription extends PropertyDescriptionBase {type: RolePropertyType; }
export interface UriPropertyDescription extends PropertyDescriptionBase {type: UriPropertyType; }
export interface HtmlPropertyDescription extends PropertyDescriptionBase {type: HtmlPropertyType; }
export interface RecordTypePropertyDescription extends PropertyDescriptionBase {type: RecordTypePropertyType; }
export interface MarginPropertyDescription extends PropertyDescriptionBase {type: MarginPropertyType; }
export interface PaddingPropertyDescription extends PropertyDescriptionBase {type: PaddingPropertyType; }
export interface SpacingPropertyDescription extends PropertyDescriptionBase {type: SpacingPropertyType; }

export type EnumPropertyDescription = PropertyDescriptionBase & {
    type: EnumPropertyType;
    allowCustomValue?: boolean;
    options: string[];
};

export type PropertyDescription<T extends PropertyType = PropertyType> = { type: T } & (
    | StringPropertyDescription
    | StringListPropertyDescription
    | EnumPropertyDescription
    | NumberPropertyDescription
    | BooleanPropertyDescription
    | FormPropertyDescription
    | ObjectPropertyDescription
    | ColorPropertyDescription
    | IconPropertyDescription
    | RolePropertyDescription
    | UriPropertyDescription
    | HtmlPropertyDescription
    | RecordTypePropertyDescription
    | MarginPropertyDescription
    | PaddingPropertyDescription
    | SpacingPropertyDescription
);

type StringPropertyValue = string;
type StringListPropertyValue = string[];
type NumberPropertyValue = number;
type BooleanPropertyValue = boolean;
type FormPropertyValue = string;
type ObjectPropertyValue = never;
type EnumPropertyValue = string;
type ColorPropertyValue = string;
type IconPropertyValue = string;
type RolePropertyValue = string[] | string;
type UriPropertyValue = string;
type HtmlPropertyvalue = string;
type RecordTypePropertyValue = string;

type SpacingLength = string | number;
type MarginPropertyValue =
    SpacingLength
    | [SpacingLength, SpacingLength]
    | [SpacingLength, SpacingLength, SpacingLength, SpacingLength];
type PaddingPropertyValue = MarginPropertyValue;
type SpacingPropertyValue = {
    margin?: MarginPropertyValue;
    padding?: PaddingPropertyValue;
}

export type PropertyValue<T extends PropertyType> =
    | (T extends StringPropertyType
          ? StringPropertyValue
          : T extends StringListPropertyType
          ? StringListPropertyValue
          : T extends NumberPropertyType
          ? NumberPropertyValue
          : T extends BooleanPropertyType
          ? BooleanPropertyValue
          : T extends FormPropertyType
          ? FormPropertyValue
          : T extends ObjectPropertyType
          ? ObjectPropertyValue
          : T extends EnumPropertyType
          ? EnumPropertyValue
          : T extends ColorPropertyType
          ? ColorPropertyValue
          : T extends IconPropertyType
          ? IconPropertyValue
          : T extends RolePropertyType
          ? RolePropertyValue
          : T extends UriPropertyType
          ? UriPropertyValue
          : T extends HtmlPropertyType
          ? HtmlPropertyvalue
          : T extends RecordTypePropertyType
          ? RecordTypePropertyValue
          : T extends MarginPropertyType
          ? MarginPropertyValue
          : T extends PaddingPropertyType
          ? PaddingPropertyValue
          : T extends SpacingPropertyType
          ? SpacingPropertyValue
          : never)
    | null
    | undefined;

export interface EventDescription {
    name: string;
    description?: string;
    parameters?: {name: string, description: string}[];
    defaultEvent?: boolean;
}

// all X and Y are relative to component

export interface InteractionBase {
    type: string;
    default?: boolean;
}

export interface ButtonInteraction extends InteractionBase {
    type: "button";
    x: number;
    y: number;
    // TODO what do we support here? Probably icons and text and all sorts; work that out later
    callbacks: { onClick: () => void };
}

export interface HandleDragResult {
    x: number;
    y: number;
}

/** HandleInteraction can have x,y,width,height or position */
export interface HandleInteraction extends InteractionBase {
    type: "handle";
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    position?: "left" | "top" | "right" | "bottom";
    direction?: 'x' | 'y';
    callbacks: {
        grab: () => void;
        drag: (relativeX: number, relativeY: number) => HandleDragResult | void;
        drop: (relativeX: number, relativeY: number) => void;
        doubleClick?: () => void;
    };
}

type InteractionIconName = "edit" | "delete" | "arrow_left" | "arrow_right" | "add";

export interface WholeComponentInteraction extends InteractionBase {
    type: "whole_component";
    title: string;
    icon: InteractionIconName;
    callbacks: { execute: () => void }
}

export interface WholeComponentMultiInteraction extends InteractionBase {
    type: "whole_component_multi";
    title: string;
    icon?: InteractionIconName;
    callbacks: { execute: (id :any) => void };
    options: {name: string, icon?: InteractionIconName, id: any}[];
}

export interface OnSelectionInteraction extends InteractionBase {
    type: "on_selection",
    callbacks: {
        onSelect: () => void; // When this component is selected
        onDeselect: () => void; // When this component is deselected
        onSelectDescendent: () => void; // When this component or any of its descendents are selected
        onDeselectDescendent: () => void; // When neither this component nor any of its descendents are selected
        onSelectOther: () => void; // When a component outside the descendent tree of this component is selected
    }
}

export type Interaction = ButtonInteraction | HandleInteraction | WholeComponentInteraction | WholeComponentMultiInteraction | OnSelectionInteraction;

export interface DesignInfo {
    propertyDescriptions: PropertyDescriptionBase[];
    propertyValues?: ComponentProperties;
    events: {[eventName:string]: EventDescription};
    interactions: Interaction[];
}

export interface ContainerDesignInfo {
    layoutPropertyDescriptions: PropertyDescriptionBase[];
    interactions?: Interaction[];
}

export interface Section {
    id: string;
    title: string;
    element: Element,
    propertyDescriptions: PropertyDescriptionBase[];
    propertyValues: ComponentProperties;
    interactions: Interaction[];
}

type ListenerFn = (component: Component, attr: string, val: pyObject) => any;

export interface DropInfo {
    perComponentUpdates?: { layout_properties: LayoutProperties; }[];
    minChildIdx?: number;
    maxChildIdx?: number;
    layout_properties?: LayoutProperties;
    slots_set_layout_properties?: string[];
    otherComponentUpdates?: {
        [componentName: string]: {
            layout_properties: LayoutProperties;
        }
    }
}

export interface DropZone {
    element: HTMLElement;
    dropInfo: DropInfo;
    expandable?: boolean | 'x' | 'y'; // Probably?
    freePlacement?: {sourceX?: number, sourceY?: number, sourceWidth: number}[];
    defaultDropZone?: boolean; // Set to true if this is the default DZ in this container. Use it if all we know is that we're dropping in this container.
}

export interface PropertyUpdates {
    propertyUpdates: {[componentName: string]: ComponentProperties};
    layoutPropertyUpdates: {[componentName: string]: LayoutProperties};
}

export interface DroppingSpecification {
    creating?: CreatingObject;
    dragging?: {type: "component" | "slot", name: string}[];
    pasting?: PastingObjects;

    // Slots use these to communicate their requirements to their target containers. They will filter DropZones
    // afterwards anyway, but you (a container) can take notice of these if you wish.
    // For example, HTMLPanels use this to avoid creating unnecessary dropzones (which might mess up a layout if they are in the DOM, regardless of whether the slot filters them out.)
    // For example, ColumnPanels use this to offer dropzones in Columns that don't exist yet, if that's what the slot is looking for.
    pyLayoutProperties?: pyDict<pyStr,pyObject>;
    minChildIdx?: number;
    maxChildIdx?: number;
}

export interface AnvilHooks extends Partial<HasRelevantHooks> {
    setupDom: () => Suspension | HTMLElement;
    readonly domElement: HTMLElement | undefined | null;
    setPropertyValues?(updates: { [propName: string]: any}): void;
    updateDesignName?(name: string): void;
    getDesignInfo?(asLayout: boolean): DesignInfo;
    getContainerDesignInfo?(forChild: Component): ContainerDesignInfo;
    updateLayoutProperties?(forChild: Component, newValues: LayoutProperties): void | Suspension; // TODO: Should we allow an option to signal "I need the page refreshing anyway"?
    getSections?(): Section[] | null | undefined;
    getSectionDomElement?(id: string): HTMLElement | undefined | null; 
    setSectionPropertyValues?(id: string, updates: { [propName: string]: any} | null): void;
    cleanupLayoutProperties?(): PropertyUpdates;
}

type HookDescriptors = Partial<Record<keyof AnvilHooks, pyObject>>;

export interface ComponentConstructor extends pyType<Component> {
    new (): Component;
    _ComponentClass: {
        allowedEvents: Set<string>,
        providesHooksInPython: HookDescriptors;
    }
}

export interface Component extends pyObject {
    _Component: ComponentState;
    anvil$hooks: AnvilHooks;
    anvilComponent$setParent(
        this: Component,
        pyParent: Component,
        { onRemove, setVisibility }: { onRemove: () => void; setVisibility?: (visible: boolean) => void }
    ): pyNoneType;
    $verifyEventName(this: Component, pyEventName: pyStr, msg: string): string;
    $verifyCallable(this: Component, eventName: string, pyHandler: pyObject): void;
    anvilComponent$onRemove(this: Component, remove: () => void): void;
}

export interface LayoutProperties {
    [propName: string]: any;
}
export interface ComponentProperties {
    [propName: string]: any;
}

export interface CreatingSlotYaml {
    set_layout_properties?: LayoutProperties;
    one_component?: boolean;
}

export interface CreatingComponentYaml {
    type: string;
    properties?: ComponentProperties;
    layout_properties?: LayoutProperties;
}

export interface ToolboxIcon {
    light: string,
    dark?: string,
}

export type CreateForm = ({container: FullyQualifiedPackageName} | {layout: FullyQualifiedPackageName}) & {
    className?: string;
    properties?: ComponentProperties;
    // TODO: components? Do we want to support adding components to newly-created forms? Probably.
}

export type FullyQualifiedPackageName = string;

export interface ToolboxItemComponent {
    type: FullyQualifiedPackageName;
    name?: string; // If not provided, will be inferred from type.
    properties?: ComponentProperties;
    layout_properties?: LayoutProperties;
    components?: ToolboxItemComponent[];
}

export interface ToolboxSection {
    packageName?: string; // Top-level app if missing
    title?: string; // If you don't specify a title for your ToolboxSection, its items will end up in the default section for this package.
    description?: string;
    items: ToolboxItem[];
    defaultExpanded?: boolean;
}

export interface ToolboxItem {
    title: string;
    icon?: ToolboxIcon;
    codePrelude?: string;
    createForms?: {[formKey:string]: CreateForm};
    component: ToolboxItemComponent;
}

export interface LayoutSpec {
    name: string;
    layout: FormLayoutYaml;
}

export interface CreatingComponent {
    type: "component";
    toolboxItem: ToolboxItem;
}
export interface CreatingSlot {
    type: "slot";
    yaml?: CreatingSlotYaml;
}
export type CreatingObject = CreatingComponent | CreatingSlot;

export interface PastingObject {
    yaml: ComponentYaml;
    parentType: string | null; // Fully qualified form/component name
}
export interface PastingComponent extends PastingObject {
    type: "component";
}
export interface PastingSlot extends PastingObject {
    type: "slot";
}
export type PastingObjects = (PastingComponent | PastingSlot)[];

// All custom components defined in JS/React need to be able to produce one of these to be sent to the IDE.
export interface CustomComponentSpec {
    // Right now, name must be fully-qualified with the package name. It would be nice to separate this out, but we can do it later.
    name: string;
    properties?: (PropertyDescription & { defaultValue?: any })[];
    layoutProperties?: PropertyDescriptionBase[];
    events?: EventDescription[];
    container?: boolean;
    // TODO: layout?: boolean; (probably +slots)

    // If true, this component will automatically appear in this app's "Custom Components" toolbox section.
    // Otherwise it won't appear unless you manually add it to an explicitly-defined ToolboxSection
    showInToolbox?: boolean;
}

export const EMPTY_DESIGN_INFO : DesignInfo = {
    propertyDescriptions: [],
    events: {},
    interactions: [],
};

export const EMPTY_CONTAINER_DESIGN_INFO : ContainerDesignInfo = {
    layoutPropertyDescriptions: []
};

export const Component: ComponentConstructor = buildNativeClass("anvil.Component", {
    constructor: function Component() {},
    slots: {
        tp$new(args, kws) {
            const cls = this.constructor as ComponentConstructor;
            const self = new cls();
            const {
                _ComponentClass: { allowedEvents, providesHooksInPython },
            } = cls;
            self._Component = {
                allowedEvents,
                eventHandlers: {},
                tag: new ComponentTag(),
                defaultDepId: defaultDepId as string,
            };
            defaultDepId = undefined;
            overrideJsHooksWithPython(self, cls);

            if (onNextInstantiation) {
                onNextInstantiation(self);
                onNextInstantiation = undefined;
            }

            yamlStackForThisComponent = yamlStackForNextComponent;
            yamlStackForNextComponent = undefined;

            //console.log("Class", cls.toString(), "has permitted events", allowedEvents);
            return self;
        },
    },
    classmethods: {
        __init_subclass__: {
            $meth(args) {
                return initComponentSubclass(this);
            },
            $flags: { FastCall: true },
        },
    },
    proto: {
        $verifyEventName(pyEventName: pyStr, msg: string): string {
            const { allowedEvents } = this._Component;
            if (!Sk.builtin.checkString(pyEventName)) {
                throw new Sk.builtin.TypeError("expected the first argument to be a string");
            }
            const eventName = pyEventName.toString();
            if (eventName.startsWith("x-") || allowedEvents.has(eventName)) {
                return eventName;
            } else {
                throw new Sk.builtin.ValueError(
                    `Cannot ${msg} for unknown event '${eventName}' on ${this.tp$name} component. Custom event names must start with 'x-'.`
                );
            }
        },
        $verifyCallable(eventName: string, pyHandler: pyObject) {
            if (!Sk.builtin.checkCallable(pyHandler)) {
                throw new Sk.builtin.TypeError(
                    `The '${eventName}' event handler added to ${
                        this.tp$name
                    } must be a callable, not type '${Sk.abstr.typeName(pyHandler)}'`
                );
            }
        },
        anvilComponent$setParent(pyParent, { onRemove, setVisibility }) {
            if (!onRemove) {
                // Invalid!
                // debugger;
            }
            this._Component.parent = { pyParent, remove: [onRemove], setVisibility };
            if (setVisibility && this._Component.lastVisibility !== undefined) {
                setVisibility(this._Component.lastVisibility);
            }
            return pyNone;
        },
        anvilComponent$onRemove(remove: () => void) {
            this._Component.parent?.remove.push(remove);
        },
    },
    methods: {
        /*!defBuiltinMethod(,event_name,handler_func:callable)!2*/
        "set_event_handler": {
            $meth: function (pyEventName, pyHandler) {
                const eventName = this.$verifyEventName(pyEventName, "set event handler for");
                if (Sk.builtin.checkNone(pyHandler)) {
                    // we delete as a signal that the event handlers for this event don't exist. See link click event for example
                    delete this._Component.eventHandlers[eventName];
                } else {
                    // replace existing handlers with the new handler
                    this.$verifyCallable(eventName, pyHandler);
                    this._Component.eventHandlers[eventName] = [pyHandler];
                }
                return Sk.builtin.none.none$;
            },
            $flags: { MinArgs: 2, MaxArgs: 2 },
            $doc: "Set a function to call when the 'event_name' event happens on this component. Using set_event_handler removes all other handlers. Setting the handler function to None removes all handlers.",
        },
        /*!defBuiltinMethod(,event_name,handler_func:callable)!2*/
        "add_event_handler": {
            $meth: function (pyEventName, pyHandler) {
                const eventName = this.$verifyEventName(pyEventName, "set event handler");
                this.$verifyCallable(eventName, pyHandler);
                const eventHandlers = (this._Component.eventHandlers[eventName] ||= []);
                eventHandlers.push(pyHandler);
                return Sk.builtin.none.none$;
            },
            $flags: { MinArgs: 2, MaxArgs: 2 },
            $doc: "Add an event handler function to be called when the event happens on this component. Event handlers will be called in the order they are added. Adding the same event handler multiple times will mean it gets called multiple times.",
        },
        /*!defBuiltinMethod(,event_name,[handler_func:callable])!2*/
        "remove_event_handler": {
            $meth: function (pyEventName, pyHandler) {
                const eventName = this.$verifyEventName(pyEventName, "remove event handler");
                if (pyHandler === undefined) {
                    // remove all the handlers
                    delete this._Component.eventHandlers[eventName];
                    return Sk.builtin.none.none$;
                }
                this.$verifyCallable(eventName, pyHandler);
                const currentHandlers = this._Component.eventHandlers[eventName];
                if (currentHandlers === undefined) {
                    throw new Sk.builtin.LookupError(
                        `event handler '${pyHandler}' was not found in '${eventName}' event handlers for this component`
                    );
                }
                const eventHandlers = currentHandlers.filter(
                    (handler) => handler !== pyHandler && Sk.misceval.richCompareBool(handler, pyHandler, "NotEq")
                );
                if (eventHandlers.length === currentHandlers.length) {
                    throw new Sk.builtin.LookupError(
                        `event handler '${pyHandler}' was not found in '${eventName}' event handlers for this component`
                    );
                } else if (eventHandlers.length) {
                    this._Component.eventHandlers[eventName] = eventHandlers;
                } else {
                    // we delete as a signal that the event handlers for this event don't exist. See link click event for example
                    delete this._Component.eventHandlers[eventName];
                }
                return pyNone;
            },
            $flags: { MinArgs: 1, MaxArgs: 2 },
            $doc: "Remove a specific event handler function for a given event. Calling remove_event_handler with just the event name will remove all the handlers for this event",
        },
        /*!defBuiltinMethod(,event_name,**event_args)!2*/
        "raise_event": {
            $meth: function (args, kws) {
                checkOneArg("raise_event", args);
                const eventName = this.$verifyEventName(args[0], "raise event");
                return chainOrSuspend(pyNone, ...getListenerCallbacks(this, eventName, kws));
            },
            $flags: { FastCall: true },
            $doc: "Trigger the event on this component. Any keyword arguments are passed to the handler function.",
        },
        /*!defBuiltinMethod(_)!2*/
        "remove_from_parent": {
            $meth: function () {
                const parent = this._Component.parent;
                const fns = [];
                if (parent) {
                    delete this._Component.parent;
                    for (const cb of parent.remove) {
                        fns.push(cb);
                    }
                }
                return chainOrSuspend(null, ...fns, () => pyNone);
            },
            $flags: { NoArgs: true },
            $doc: "Remove this component from its parent container.",
        },
        "_notify_parent_of_visibility": {
            $meth(visible: pyBool) {
                const v = Sk.misceval.isTrue(visible);
                this._Component.lastVisibility = v;
                const setVisibility = this._Component.parent?.setVisibility;
                setVisibility?.(v);
                return setVisibility ? pyTrue : pyFalse;
            },
            $flags: { OneArg: true },
            $doc: "Notify this component's parent of its visible status",
        },
        /*!defBuiltinMethod(,smooth=False)!2*/ // "scroll_into_view" {$doc: "Scroll the window to make sure this component is in view."}
        "scroll_into_view": {
            $meth: function (smooth) {
                const how = { behavior: isTrue(smooth) ? "smooth" : "instant", block: "center", inline: "center" };
                return chainOrSuspend(this.anvil$hooks.setupDom(), (element) => {
                    element.scrollIntoView(how as ScrollIntoViewOptions);
                    return pyNone;
                });
            },
            $flags: { NamedArgs: ["smooth"], Defaults: [Sk.builtin.bool.false$] },
            $doc: "Scroll the window to make sure this component is in view.",
        },
        /*!defBuiltinMethod(tuple_of_event_handlers, event_name)!2*/
        "get_event_handlers": {
            $meth: function (eventName) {
                eventName = this.$verifyEventName(eventName, "get event handlers");
                return new Sk.builtin.tuple(this._Component.eventHandlers[eventName] || []);
            },
            $flags: { OneArg: true },
            $doc: "Get the current event_handlers for a given event_name",
        },
    },
    getsets: {
        parent: {
            $get() {
                return getPyParent(this) || Sk.builtin.none.none$;
            },
            $set() {
                throw new Sk.builtin.AttributeError(
                    "Cannot set a '" +
                        this.tp$name +
                        "' component's parent this way - use 'add_component' on the container instead"
                );
            },
        },
        __name__: {
            $get() {
                // This is for backward compatability
                // Skulpt had a long time bug where .__name__ was accessable on instances of classes due to implementation details
                // Some anvil users (including hash routing) used the .__name__ on instances because it worked by accident
                // When upgrading Skulpt users reported sudden errors in their code
                // So we added this get set descriptor as workaround
                return Sk.abstr.lookupSpecial<pyStr>(this.ob$type, Sk.builtin.str.$name);
            },
        },
        tag: {
            $get() {
                return this._Component.tag;
            },
            $set(val) {
                this._Component.tag = val ?? new ComponentTag();
            },
            $doc: "Use this property to store any extra information about this component",
        },
        ...pythonMethodDescriptorsForJsHooks,
    },
    flags: {
        sk$klass: true, // tell skulpt we can be treated like a regular klass for tp$setatttr
    },
});

export const getComponentParent = (component: Component) : Component | pyNoneType => Component.prototype.parent.tp$descr_get(component, null);

export const raiseEventOrSuspend = (component: Component, pyName: pyStr, kws?: Kws) =>
    pyCallOrSuspend(component.tp$getattr<pyCallable>(s_raise_event), [pyName], kws);

export const addEventHandler = (component: Component, pyName: pyStr, handler: (k: Kws) => Suspension | pyObject | void) =>
    pyCallOrSuspend(component.tp$getattr<pyCallable>(s_add_event_handler), [
        pyName,
        PyDefUtils.funcFastCall((_args, kws = []) => chainOrSuspend(handler(kws), () => pyNone)),
    ]);

/*!defClass(anvil,Component)!*/

function getListenerCallbacks(c: Component, eventName: string, kws?: Kws) {
    const listeners = c._Component.eventHandlers[eventName] ?? [];
    const eventArgs = kwToObj(kws);
    eventArgs["sender"] = c;
    eventArgs["event_name"] = new pyStr(eventName);
    return listeners.map((pyFn) => () => pyCallOrSuspend(pyFn, [], objToKw(eventArgs)));
}

