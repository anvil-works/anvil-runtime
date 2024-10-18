import {
    Kws,
    Suspension,
    arrayFromIterable,
    buildNativeClass,
    buildPyClass,
    chainOrSuspend,
    checkOneArg,
    checkString,
    isTrue,
    lookupSpecial,
    objectRepr,
    pyAttributeError,
    pyBool,
    pyCall,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyFalse,
    pyFunc,
    pyIterable,
    pyList,
    pyNone,
    pyNoneType,
    pyObject,
    pyStr,
    pyTuple,
    pyType,
    pyTypeError,
    toPy,
} from "../@Sk";
import { ComponentYaml, FormLayoutYaml } from "../runner/data";
import {
    funcFastCall,
    kwsToObj,
    objToKws,
    s_add_event_handler,
    s_anvil_events,
    s_get_components,
    s_name,
    s_raise_event,
} from "../runner/py-util";
import type { DropModeFlags, WithLayout } from "../runner/python-objects";
import { HasRelevantHooks } from "../runner/python-objects";
import type { Container } from "./Container";
import { setupClsHooks, setupInstanceHooks } from "./anvil-hooks";

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

function eventDescriptionToString(event: pyStr | pyDict): string {
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

const hasOwnProperty = Object.prototype.hasOwnProperty;

function initComponentSubclass(cls: ComponentConstructor) {
    const providesHooksInPython: HookDescriptors = {};
    setupClsHooks(cls);

    const mro = cls.tp$getattr<pyTuple<pyType>>(s___mro__);
    const allowedEvents = new Set<string>();
    for (const c of arrayFromIterable(mro)) {
        if (c === Component) break;
        // we could check if c is a subclass of Component, but seems unnecessary
        if (!hasOwnProperty.call(c.prototype, s_anvil_events.toString())) {
            continue;
        }
        const pyAllowedEvents = c.tp$getattr<pyIterable<pyDict>>(s_anvil_events);
        if (!pyAllowedEvents) continue;
        for (const pyEvent of arrayFromIterable(pyAllowedEvents)) {
            allowedEvents.add(eventDescriptionToString(pyEvent));
        }
    }

    cls._ComponentClass = { allowedEvents, providesHooksInPython };

    return pyNone;
}

let defaultDepId: string | undefined | null;
let onNextInstantiation: ((c: Component) => void) | undefined;

export const setDefaultDepIdForNextComponent = (depId: string | null) => {
    defaultDepId = depId;
}; // call immediately before instantiating a component
export const getDefaultDepIdForComponent = (component: Component | undefined) =>
    component?._Component.defaultDepId ?? null;
export const runOnNextInstantiation = (f: (c: Component) => void) => {
    onNextInstantiation = f;
};

interface ComponentParent {
    pyParent: Component;
    remove: (() => void)[];
    setVisibility?: (v: boolean) => void;
}

interface ComponentState {
    allowedEvents: Set<string>;
    eventHandlers: { [eventName: string]: pyCallable[] };
    parent?: ComponentParent;
    tag: pyObject;
    defaultDepId: string | null;
    unwrappedHooks?: any;
    pageState: {
        ancestorsMounted: boolean;
        ancestorsVisible: boolean;
        currentlyMounted: boolean;
        currentlyVisible: boolean;
        addedFired: boolean;
        shownFired: boolean;
    };
    fallbackDomElement?: HTMLDivElement | null;
    portalParent?: ComponentParent;
}

// Make sure to update CustomComponent dialogue if adding new hints
export type DesignerHint =
    | "align-horizontal"
    | "font-bold"
    | "font-italic"
    | "font-underline"
    | "visible"
    | "enabled"
    | "background-color"
    | "foreground-color"
    | "border"
    | "asset-upload"
    | "toggle"
    | "disabled";

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
    priority?: number;
    defaultBindingProp?: boolean;
    showInDesignerWhen?: string;
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

export interface StringPropertyDescription extends PropertyDescriptionBase {
    type: StringPropertyType;
    multiline?: boolean;
    inlineEditElement?: string;
}
export interface StringListPropertyDescription extends PropertyDescriptionBase {
    type: StringListPropertyType;
}
export interface NumberPropertyDescription extends PropertyDescriptionBase {
    type: NumberPropertyType;
}
export interface BooleanPropertyDescription extends PropertyDescriptionBase {
    type: BooleanPropertyType;
}
export interface FormPropertyDescription extends PropertyDescriptionBase {
    type: FormPropertyType;
}
export interface ObjectPropertyDescription extends PropertyDescriptionBase {
    type: ObjectPropertyType;
}
export interface ColorPropertyDescription extends PropertyDescriptionBase {
    type: ColorPropertyType;
}
export interface IconPropertyDescription extends PropertyDescriptionBase {
    type: IconPropertyType;
    iconsets?: string[];
}
export interface RolePropertyDescription extends PropertyDescriptionBase {
    type: RolePropertyType;
}
export interface UriPropertyDescription extends PropertyDescriptionBase {
    type: UriPropertyType;
    accept?: string;
}
export interface HtmlPropertyDescription extends PropertyDescriptionBase {
    type: HtmlPropertyType;
}
export interface RecordTypePropertyDescription extends PropertyDescriptionBase {
    type: RecordTypePropertyType;
}
export interface MarginPropertyDescription extends PropertyDescriptionBase {
    type: MarginPropertyType;
}
export interface PaddingPropertyDescription extends PropertyDescriptionBase {
    type: PaddingPropertyType;
}
export interface SpacingPropertyDescription extends PropertyDescriptionBase {
    type: SpacingPropertyType;
}

export type EnumPropertyDescription = PropertyDescriptionBase & {
    type: EnumPropertyType;
    allowCustomValue?: boolean;
    options: string[];
    includeNoneOption?: boolean;
    noneOptionLabel?: string;
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

export type SpacingLength = string | number | null;
export type MarginPropertyValue =
    | SpacingLength
    | [SpacingLength, SpacingLength]
    | [SpacingLength, SpacingLength, SpacingLength]
    | [SpacingLength, SpacingLength, SpacingLength, SpacingLength];
export type PaddingPropertyValue = MarginPropertyValue;
export type SpacingPropertyValue = {
    margin?: MarginPropertyValue;
    padding?: PaddingPropertyValue;
};

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
    parameters?: { name: string; description?: string; important?: boolean }[];
    defaultEvent?: boolean;
    hidden?: boolean;
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
    direction?: "x" | "y";
    callbacks: {
        grab: (pageX: number, pageY: number) => void;
        drag: (relativeX: number, relativeY: number, metaKey: boolean) => HandleDragResult | void;
        drop: (relativeX: number, relativeY: number) => void;
        doubleClick?: () => void;
    };
}

type InteractionIconName = "edit" | "delete" | "arrow_left" | "arrow_right" | "add" | "edit_form";

export interface WholeComponentInteraction extends InteractionBase {
    type: "whole_component";
    title: string;
    icon: InteractionIconName;
    callbacks: { execute: () => void };
}

export interface WholeComponentMultiInteraction extends InteractionBase {
    type: "whole_component_multi";
    title: string;
    icon?: InteractionIconName;
    callbacks: { execute: (id: any) => void };
    options: { name: string; icon?: InteractionIconName; id: any }[];
}

export interface DesignerEventsInteraction extends InteractionBase {
    type: "designer_events";
    callbacks: {
        onSelect?: () => void; // When this component is selected
        onDeselect?: () => void; // When this component is deselected
        onSelectDescendent?: () => void; // When this component or any of its descendents are selected
        onDeselectDescendent?: () => void; // When neither this component nor any of its descendents are selected
        onSelectOther?: () => void; // When a component outside the descendent tree of this component is selected
    };
}

export interface RegionInteraction extends InteractionBase {
    type: "region";
    bounds: DOMRect | HTMLElement | null; // support null in case there should be a region but the element is not rendered
    sensitivity: 0 | 1 | 2; // This corresponds to 'doubleClick' | 'clickWhenSelected' | 'click';
    callbacks: {
        execute: () => void;
    };
}

export type Interaction =
    | ButtonInteraction
    | HandleInteraction
    | WholeComponentInteraction
    | WholeComponentMultiInteraction
    | DesignerEventsInteraction
    | RegionInteraction;

export interface UnsetPropertyValue {
    value: any;
    css: string;
}

export interface UnsetPropertyValues {
    [propName: string]: UnsetPropertyValue;
}

export interface DesignInfo {
    propertyDescriptions: PropertyDescription[];
    events: EventDescription[];
    interactions: Interaction[];
    unsetPropertyValues: UnsetPropertyValues;
}

export interface ContainerDesignInfo {
    layoutPropertyDescriptions: PropertyDescription[];
    interactions?: Interaction[];
}

export interface Section {
    id: string;
    title: string;
    element: Element;
    propertyDescriptions: PropertyDescription[];
    propertyValues: ComponentProperties;
    interactions: Interaction[];
}

type ListenerFn = (component: Component, attr: string, val: pyObject) => any;

export interface DropInfo {
    perComponentUpdates?: { layout_properties: LayoutProperties }[];
    minChildIdx?: number;
    maxChildIdx?: number;
    layout_properties?: LayoutProperties;
    slots_set_layout_properties?: string[];
    otherComponentUpdates?: {
        [componentName: string]: {
            layout_properties: LayoutProperties;
        };
    };
}

export interface DropZone {
    element: HTMLElement;
    dropInfo?: DropInfo;
    freePlacement?: (dropping: { x: number; y: number; width?: number; height?: number }[]) => {
        dropLocations: { x: number; y: number; width: number; height: number }[];
        dropInfo: DropInfo;
    };
    expandable?: boolean | "x" | "y"; // Probably?
    defaultDropZone?: boolean; // Set to true if this is the default DZ in this container. Use it if all we know is that we're dropping in this container.
}

export interface PropertyUpdates {
    propertyUpdates: { [componentName: string]: ComponentProperties };
    layoutPropertyUpdates: { [componentName: string]: LayoutProperties };
}
export type PropertyValueUpdates = Record<string, any>;

export interface DroppingSpecification {
    creating?: CreatingObject;
    dragging?: { type: "component" | "slot"; name: string }[];
    pasting?: PastingObjects;

    // Slots use these to communicate their requirements to their target containers. They will filter DropZones
    // afterwards anyway, but you (a container) can take notice of these if you wish.
    // For example, HTMLPanels use this to avoid creating unnecessary dropzones (which might mess up a layout if they are in the DOM, regardless of whether the slot filters them out.)
    // For example, ColumnPanels use this to offer dropzones in Columns that don't exist yet, if that's what the slot is looking for.
    pyLayoutProperties?: pyDict<pyStr, pyObject>;
    minChildIdx?: number;
    maxChildIdx?: number;
}

export interface AnvilHookSpec<T extends Component = Component> {
    setupDom: (this: T) => Suspension | HTMLElement;
    getDomElement(this: T): HTMLElement | undefined | null;
    getProperties?(this: T): PropertyDescriptionBase[];
    getEvents?(this: T): EventDescription[];
    updateDesignName?(this: T, name: string): void;
    getInteractions?(this: T): Interaction[];
    getUnsetPropertyValues?(this: T): UnsetPropertyValues;
    getContainerDesignInfo?(this: T, forChild: Component): ContainerDesignInfo;
    updateLayoutProperties?(
        this: T,
        forChild: Component,
        newValues: LayoutProperties
    ): PropertyValueUpdates | null | undefined | Suspension; // TODO: Should we allow an option to signal "I need the page refreshing anyway"?
    getSections?(this: T): Section[] | null | undefined;
    getSectionDomElement?(this: T, id: string): HTMLElement | undefined | null;
    setSectionPropertyValues?(
        this: T,
        id: string,
        updates: PropertyValueUpdates
    ): PropertyValueUpdates | null | undefined | true | void; // 'true' means we don't have a useful update for you. Reload everything. undefined | null - nothing to do
    cleanupLayoutProperties?(this: T): PropertyUpdates;
    enableDropMode?: (this: T, dropping: DroppingSpecification, flags?: DropModeFlags) => DropZone[];
    disableDropMode?: (this: T) => void;
}

export interface AnvilHooks extends Partial<HasRelevantHooks> {
    setupDom: () => Suspension | HTMLElement;
    domElement: HTMLElement | undefined | null;
    properties: PropertyDescription[];
    events: EventDescription[];
    updateDesignName?(name: string): void;
    getInteractions?(): Interaction[];
    getUnsetPropertyValues?(): UnsetPropertyValues;
    getContainerDesignInfo?(forChild: Component): ContainerDesignInfo;
    updateLayoutProperties?(
        forChild: Component,
        newValues: LayoutProperties
    ): PropertyValueUpdates | null | undefined | Suspension; // TODO: Should we allow an option to signal "I need the page refreshing anyway"?
    getSections?(): Section[] | null | undefined;
    getSectionDomElement?(id: string): HTMLElement | undefined | null;
    setSectionPropertyValues?(
        id: string,
        updates: PropertyValueUpdates
    ): PropertyValueUpdates | null | undefined | true; // 'true' means we don't have a useful update for you. Reload everything.
    cleanupLayoutProperties?(): PropertyUpdates;
}

type HookDescriptors = Partial<Record<keyof AnvilHooks, pyObject>>;

export interface ComponentConstructor extends pyType<Component> {
    new (): Component;
    _ComponentClass: {
        allowedEvents: Set<string>;
        providesHooksInPython: HookDescriptors;
    };
}

export interface Component extends pyObject {
    _Component: ComponentState;
    anvil$hooks: AnvilHooks;
    anvilComponent$setParent(
        this: Component,
        pyParent: Component,
        {
            onRemove,
            setVisibility,
            isMounted,
        }: { onRemove: () => void; setVisibility?: (visible: boolean) => void; isMounted?: boolean }
    ): Suspension | pyObject;
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
    light?: string;
    dark?: string;
}

export type CreateForm = ({ container: FullyQualifiedPackageName } | { layout: FullyQualifiedPackageName }) & {
    className?: string;
    properties?: ComponentProperties;
    // TODO: components? Do we want to support adding components to newly-created forms? Probably.
};

export type FullyQualifiedPackageName = string;

export interface CustomComponentToolboxItem {
    hidden?: boolean;
    title?: string;
    group?: string;
    icon?: ToolboxIcon;
}

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

export interface ToolboxItemBase {
    title: string;
    icon?: ToolboxIcon;
    codePrelude?: string;
    createForms?: { [formKey: string]: CreateForm };
    url?: string;
    showInToolbox?: boolean; // Missing means true
}
export interface ToolboxComponentItem extends ToolboxItemBase {
    component: ToolboxItemComponent;
}

export interface ToolboxSlotItem extends ToolboxItemBase {
    slot: true;
}

export type ToolboxItem = ToolboxComponentItem | ToolboxSlotItem;

export interface CustomLayoutYaml {
    title: string;
    description?: string;
    thumbnail?: string;
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

// mostly used by the autocompleter
interface MethodSpec {
    name: string;
    description?: string;
    args?: any[];
    returns?: any;
}

// All custom components defined in JS/React need to be able to produce one of these to be sent to the IDE.
export interface CustomComponentSpec {
    // Right now, name must be fully-qualified with the package name. It would be nice to separate this out, but we can do it later.
    name: string;
    properties?: (PropertyDescription & { defaultValue?: any })[];
    layoutProperties?: PropertyDescription[];
    events?: EventDescription[];
    methods?: MethodSpec[];
    container?: boolean;
    // TODO: layout?: boolean; (probably +slots)

    // If true, this component will automatically appear in this app's "Custom Components" toolbox section.
    // Otherwise it won't appear unless you manually add it to an explicitly-defined ToolboxSection
    showInToolbox?: boolean;
}

export const EMPTY_DESIGN_INFO: DesignInfo = {
    propertyDescriptions: [],
    events: [],
    interactions: [],
    unsetPropertyValues: {},
};

export const EMPTY_CONTAINER_DESIGN_INFO: ContainerDesignInfo = {
    layoutPropertyDescriptions: [],
};

const _AnvilMagicDescriptor = buildNativeClass("anvil.AnvilMagicDescriptor", {
    constructor: function (key: string) {
        this.key = key;
    },
    slots: {
        tp$descr_get(obj, obType) {
            let rv;
            if (obj != null) {
                rv = obj[this.key];
            } else if (obType != null) {
                rv = obType.prototype[this.key];
            }
            if (!rv) return;
            return toPy(rv);
        },
        tp$descr_set(obj, value, canSuspend) {
            throw new pyAttributeError("readonly");
        },
    },
});

export const Component: ComponentConstructor = buildNativeClass("anvil.Component", {
    constructor: function Component() {},
    slots: {
        tp$new(args, kws) {
            const cls = this.constructor as ComponentConstructor;
            const self = new cls();
            const {
                _ComponentClass: { allowedEvents, providesHooksInPython },
            } = cls;
            const pageState = {
                ancestorsMounted: false,
                ancestorsVisible: false,
                currentlyMounted: false,
                currentlyVisible: true,
                addedFired: false,
                shownFired: false,
            };
            self._Component = {
                allowedEvents,
                eventHandlers: {},
                tag: new ComponentTag(),
                defaultDepId: defaultDepId as string,
                pageState,
                fallbackDomElement: null,
            };
            defaultDepId = undefined;
            setupInstanceHooks(self, cls);

            if (onNextInstantiation) {
                onNextInstantiation(self);
                onNextInstantiation = undefined;
            }

            //console.log("Class", cls.toString(), "has permitted events", allowedEvents);
            return self;
        },
    },
    classmethods: {
        __init_subclass__: {
            $meth(args, kws) {
                return initComponentSubclass(this);
            },
            $flags: { FastCall: true },
        },
    },
    proto: {
        anvil$hookSpec: {
            setupDom(this: Component) {
                return (this._Component.fallbackDomElement ??= document.createElement("div"));
            },
            getDomElement(this: Component) {
                return (this._Component.fallbackDomElement ??= document.createElement("div"));
            },
            getProperties() {
                return [];
            },
            getEvents() {
                return [];
            },
            getInteractions() {
                return [];
            },
            getUnsetPropertyValues() {
                return {};
            },
        },
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
        anvilComponent$setParent(pyParent, { onRemove, setVisibility, isMounted = true }) {
            if (!onRemove) {
                // Invalid!
                // debugger;
            }
            this._Component.parent = { pyParent, remove: [onRemove], setVisibility };
            let currentlyVisible;
            const pageState = this._Component.pageState;
            if (isWithLayout(this)) {
                currentlyVisible =
                    this._withLayout._pyLayout?._Component.pageState.currentlyVisible ?? pageState.currentlyVisible;
            } else {
                currentlyVisible = pageState.currentlyVisible;
            }
            if (!currentlyVisible) {
                setVisibility?.(currentlyVisible);
            }
            const parentPageState = pyParent._Component.pageState;
            pageState.ancestorsVisible = parentPageState.ancestorsVisible && parentPageState.currentlyVisible;
            pageState.ancestorsMounted = parentPageState.ancestorsMounted && parentPageState.currentlyMounted;
            if (isMounted) {
                return chainOrSuspend(pyNone, ...getMountedCallbacks(this, pyParent));
            } else {
                return pyNone;
            }
        },
        anvilComponent$onRemove(remove: () => void) {
            this._Component.parent?.remove.push(remove);
        },
    },
    methods: {
        /*!defBuiltinMethod(,event_name,handler_func:callable)!2*/ // "set_event_handler";
        set_event_handler: {
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
        /*!defBuiltinMethod(,event_name,handler_func:callable)!2*/ // "add_event_handler";
        add_event_handler: {
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
        /*!defBuiltinMethod(,event_name,[handler_func:callable])!2*/ // "remove_event_handler";
        remove_event_handler: {
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
        /*!defBuiltinMethod(,event_name,**event_args)!2*/ // "raise_event";
        raise_event: {
            $meth: function (args, kws) {
                checkOneArg("raise_event", args);
                const eventName = this.$verifyEventName(args[0], "raise event");
                return chainOrSuspend(pyNone, ...getListenerCallbacks(this, eventName, kws));
            },
            $flags: { FastCall: true },
            $doc: "Trigger the event on this component. Any keyword arguments are passed to the handler function.",
        },
        /*!defBuiltinMethod(_)!2*/ // "remove_from_parent";
        remove_from_parent: {
            $meth: function () {
                const parent = this._Component.parent;
                const fns = [];
                if (parent) {
                    delete this._Component.parent;
                    for (const cb of parent.remove) {
                        fns.push(cb);
                    }
                    const pageState = this._Component.pageState;
                    if (pageState.currentlyMounted) {
                        fns.push(...getUnmountedCallbacks(this, parent.pyParent));
                    }
                    pageState.ancestorsMounted = false;
                    pageState.ancestorsVisible = false;
                }
                return chainOrSuspend(null, ...fns, () => pyNone);
            },
            $flags: { NoArgs: true },
            $doc: "Remove this component from its parent container.",
        },
        _notify_mounted_by_parent: {
            $meth(mounted, root) {
                return notifyMountedChange(this, isTrue(mounted), isTrue(root));
            },
            $flags: { NamedArgs: [null, "root"], Defaults: [pyFalse] },
            $doc: "Notify this component, and all its children, that it has been mounted by its parent",
        },
        _notify_visibility_change: {
            $meth(visible: pyBool) {
                return notifyVisibilityChange(this, isTrue(visible));
            },
            $flags: { OneArg: true },
            $doc: "Notify the component's parent and children that its visible status has changed",
        },
        /*!defBuiltinMethod(,smooth=False)!2*/ // "scroll_into_view";
        scroll_into_view: {
            $meth: function (smooth) {
                const how = { behavior: isTrue(smooth) ? "smooth" : "instant", block: "center", inline: "center" };
                return chainOrSuspend(this.anvil$hooks.setupDom(), (element) => {
                    // @ts-expect-error - can't do ts typing because of gendoc
                    element.scrollIntoView(how);
                    return pyNone;
                });
            },
            $flags: { NamedArgs: ["smooth"], Defaults: [Sk.builtin.bool.false$] },
            $doc: "Scroll the window to make sure this component is in view.",
        },
        /*!defBuiltinMethod(tuple_of_event_handlers, event_name)!2*/ // "get_event_handlers";
        get_event_handlers: {
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
    },
    flags: {
        sk$klass: true, // tell skulpt we can be treated like a regular klass for tp$setatttr
    },
});

initComponentSubclass(Component);

export const getComponentParent = (component: Component): Component | pyNoneType =>
    Component.prototype.parent.tp$descr_get(component, null);

export const raiseEventOrSuspend = (component: Component, pyName: pyStr, kws?: Kws) =>
    pyCallOrSuspend(component.tp$getattr<pyCallable>(s_raise_event), [pyName], kws);

export function raiseWritebackEventOrSuspend(component: Component, pyAttr: pyStr, pyValue?: pyObject) {
    return chainOrSuspend(pyValue ?? Sk.abstr.gattr(component, pyAttr, true), (pyNewValue) =>
        raiseEventOrSuspend(component, new pyStr("x-anvil-write-back-" + pyAttr), [
            "property",
            pyAttr,
            "value",
            pyNewValue,
        ])
    );
}

export const addEventHandler = (
    component: Component,
    pyName: pyStr,
    handler: (k: Kws) => Suspension | pyObject | void
) =>
    pyCallOrSuspend(component.tp$getattr<pyCallable>(s_add_event_handler), [
        pyName,
        funcFastCall((_args, kws = []) => chainOrSuspend(handler(kws), () => pyNone)),
    ]);

/*!defClass(anvil,Component)!*/

const getComponents = (container: Container) => {
    return pyCall<pyList<Component>>(container.tp$getattr(s_get_components), []).valueOf();
};

const isContainerLike = (c: Component): c is Container => {
    return !!lookupSpecial(c, s_get_components);
};

const isWithLayout = (c: Component): c is WithLayout => {
    return !!c._withLayout;
};

/** Be careful - you should rarely call this directly - it's almost always better to call component.raise_event(event) */
export function getListenerCallbacks(c: Component, eventName: string, kws?: Kws) {
    const listeners = c._Component.eventHandlers[eventName] ?? [];
    const eventArgs = kwsToObj(kws);
    eventArgs["sender"] = c;
    eventArgs["event_name"] = new pyStr(eventName);
    return listeners.map((pyFn) => () => pyCallOrSuspend(pyFn, [], objToKws(eventArgs)));
}

function shouldFirePageAdded(c: Component) {
    const pageState = c._Component.pageState;
    if (pageState.currentlyMounted && pageState.ancestorsMounted && !pageState.addedFired) {
        pageState.addedFired = true;
        return true;
    }
    return false;
}

function shouldFirePageShown(c: Component) {
    const pageState = c._Component.pageState;
    if (
        pageState.currentlyMounted &&
        pageState.ancestorsMounted &&
        pageState.ancestorsVisible &&
        pageState.currentlyVisible &&
        !pageState.shownFired
    ) {
        pageState.shownFired = true;
        return true;
    }
    return false;
}

function shouldFirePageHidden(c: Component) {
    const pageState = c._Component.pageState;
    if (pageState.shownFired) {
        pageState.shownFired = false;
        return true;
    }
    return false;
}

function shouldFirePageRemoved(c: Component) {
    const pageState = c._Component.pageState;
    if (pageState.addedFired) {
        pageState.addedFired = false;
        return true;
    }
    return false;
}

type PyCallback = ReturnType<typeof getListenerCallbacks>[number];
type ChildVisitor = (c: Component, parent: null | Component) => boolean;

/** setting parent to null is equivalent to saying this is the first time we are walking */
function walkComponents(c: Component, visitChild: ChildVisitor, parent: null | Component) {
    if (!visitChild(c, parent)) return;
    let components;
    if (isContainerLike(c)) {
        components = getComponents(c);
    } else if (isWithLayout(c)) {
        components = c._withLayout.pyLayout ? [c._withLayout.pyLayout] : null;
    }
    // ?. as a fail safe - if get_components is not a list don't continue
    components?.forEach?.((child) => walkComponents(child, visitChild, c));
}

/**
 * If parent is null then we are the root node - i.e. open_form or alert
 * since page-shown can't fire until page-added
 * We can be lazy about setting ancestorsVisible (which is initialized as false)
 * We check ancestorsVisible as ancestorsMounted becomes true
 * We also set ancestorsVisible in anvilComponent$setParent
 */
function getMountedCallbacks(c: Component, parent: null | Component = null) {
    const pageState = c._Component.pageState;
    pageState.currentlyMounted = true;
    if (!parent) {
        pageState.ancestorsMounted = true;
        pageState.ancestorsVisible = true;
    } else if (!pageState.ancestorsMounted) {
        return [];
    }
    const addFns: PyCallback[] = [];
    const showFns: PyCallback[] = [];
    const classicFns: PyCallback[] = [];
    const visitChild: ChildVisitor = (c, parent) => {
        const pageState = c._Component.pageState;
        if (parent) {
            pageState.ancestorsMounted = true;
            const parentPageState = parent._Component.pageState;
            pageState.ancestorsVisible = parentPageState.ancestorsVisible && parentPageState.currentlyVisible;
            if (!pageState.currentlyMounted) return false;
        }
        if (shouldFirePageAdded(c)) {
            addFns.push(...getListenerCallbacks(c, "x-anvil-page-added"));
            classicFns.push(...getListenerCallbacks(c, "x-anvil-classic-show"));
        }
        if (shouldFirePageShown(c)) {
            showFns.push(...getListenerCallbacks(c, "x-anvil-page-shown"));
        }
        return true;
    };
    walkComponents(c, visitChild, null);
    // weird order preserves existing propagation oddities of classic components
    classicFns.reverse();
    return [...addFns, ...showFns, ...classicFns];
}

function getUnmountedCallbacks(c: Component, parent: null | Component = null) {
    const pageState = c._Component.pageState;
    pageState.currentlyMounted = false;
    if (!parent) {
        pageState.ancestorsMounted = false;
        pageState.ancestorsVisible = false;
    } else if (!pageState.ancestorsMounted) {
        return [];
    }
    const removeFns: PyCallback[] = [];
    const hiddenFns: PyCallback[] = [];
    const classicFns: PyCallback[] = [];

    const cb: ChildVisitor = (c, parent) => {
        const pageState = c._Component.pageState;
        if (parent) {
            pageState.ancestorsMounted = false;
            pageState.ancestorsVisible = false;
            if (!pageState.currentlyMounted) return false;
        }
        if (shouldFirePageHidden(c)) {
            hiddenFns.push(...getListenerCallbacks(c, "x-anvil-page-hidden"));
        }
        if (shouldFirePageRemoved(c)) {
            removeFns.push(...getListenerCallbacks(c, "x-anvil-page-removed"));
            classicFns.push(...getListenerCallbacks(c, "x-anvil-classic-hide"));
        }
        return true;
    };
    walkComponents(c, cb, null);
    return [...hiddenFns, ...removeFns, ...classicFns];
}

function getVisibilityShownCallbacks(c: Component) {
    const pageState = c._Component.pageState;
    pageState.currentlyVisible = true;
    if (!pageState.ancestorsVisible) return [];
    const fns: PyCallback[] = [];
    const classicFns: PyCallback[] = [];
    const cb: ChildVisitor = (c, parent) => {
        const pageState = c._Component.pageState;
        if (parent) {
            pageState.ancestorsVisible = true;
            if (!pageState.currentlyVisible) return false;
        }
        if (shouldFirePageShown(c)) {
            fns.push(...getListenerCallbacks(c, "x-anvil-page-shown"));
            classicFns.push(...getListenerCallbacks(c, "x-anvil-classic-show"));
        }
        return true;
    };
    walkComponents(c, cb, null);
    return [...fns, ...classicFns];
}

function getVisibilityHiddenCallbacks(c: Component) {
    const pageState = c._Component.pageState;
    pageState.currentlyVisible = false;
    if (!pageState.ancestorsVisible) return [];
    const fns: PyCallback[] = [];
    const cb: ChildVisitor = (c, parent) => {
        const pageState = c._Component.pageState;
        if (parent) {
            pageState.ancestorsVisible = false;
            if (!pageState.currentlyVisible) return false;
        }
        if (shouldFirePageHidden(c)) {
            fns.push(...getListenerCallbacks(c, "x-anvil-page-hidden"));
        }
        return true;
    };
    walkComponents(c, cb, null);
    return fns;
}

function notifyMountedChange(c: Component, mounted: boolean, root = false) {
    const pyParent = c._Component.parent?.pyParent ?? null;
    const isRoot = isTrue(root);
    if (!pyParent && !isRoot) {
        // we can't be mounted by a parent if we don't have one!
        return pyNone;
    }
    const currentlyMounted = c._Component.pageState.currentlyMounted;
    if (mounted === currentlyMounted) return pyNone;
    let fns;
    if (mounted) {
        fns = getMountedCallbacks(c, isRoot ? null : pyParent);
    } else {
        fns = getUnmountedCallbacks(c, isRoot ? null : pyParent);
    }
    return chainOrSuspend(pyNone, ...fns);
}

export function notifyComponentMounted(c: Component, root = false) {
    return notifyMountedChange(c, true, root);
}

export function notifyComponentUnmounted(c: Component, root = false) {
    return notifyMountedChange(c, false, root);
}

export function notifyVisibilityChange(c: Component, visible: boolean) {
    visible = isTrue(visible); // ensure boolean
    const pageState = c._Component.pageState;
    const prevVisibility = pageState.currentlyVisible;
    if (prevVisibility === visible) return pyNone;
    pageState.currentlyVisible = visible;
    const setVisibility = (c._Component.portalParent ?? c._Component.parent)?.setVisibility;
    setVisibility?.(visible);
    let fns;
    if (visible) {
        fns = getVisibilityShownCallbacks(c);
    } else {
        fns = getVisibilityHiddenCallbacks(c);
    }
    return chainOrSuspend(pyNone, ...fns);
}
