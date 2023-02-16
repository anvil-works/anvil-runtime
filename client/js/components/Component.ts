import {
    arrayFromIterable,
    buildPyClass,
    objectRepr,
    pyFunc,
    pyStr,
    buildNativeClass,
    pyNone,
    pyCallOrSuspend,
    isTrue,
    chainOrSuspend,
    checkString,
    pyType,
    pyTypeError,
    toPy,
    toJs,
    pyNoneType,
    pyBool,
    Kws,
    Args
} from "../@Sk";
import { pyCallable, pyDict, pyObject, pyNewableType, pyIterable, Suspension } from "../@Sk";
import PyDefUtils from "../PyDefUtils";
import {ComponentYaml, FormLayoutYaml} from "../runner/data";
import {
    s_anvil_events,
    s_anvil_hooks,
    s_dom_element,
    s_page_added,
    s_page_removed,
    s_page_shown,
    s_set_data_binding_listener,
    s_setup_dom,
    s_name,
    kwToObj,
    objToKw,
    s_update_design_name,
    s_get_design_info,
    s_parent, s_raise_event, s_add_event_handler,
} from "../runner/py-util";
import {HasRelevantHooks} from "../runner/python-objects";

// The *real* base Component class. It implements the event APIs, the _anvil_hooks_/anvil$hooks API, and that's it.

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

const unwrapDomElement = (elt: any, pyComponent: Component) => {
    if (!elt?.js$wrapped?.tagName) {
        throw new Sk.builtin.ValueError(`"${Sk.abstr.typeName(pyComponent)}" component did not provide a valid DOM element (got ${Sk.abstr.typeName(elt)} instead)`);
    }
    return elt.js$wrapped as HTMLElement;
};

const mkJsHooksForPython = (pyComponent: Component): AnvilHooks => {
    const pyHooks = Sk.abstr.gattr(pyComponent, s_anvil_hooks);
    const callMethod = (method: pyStr, args: pyObject[]) => pyCallOrSuspend(Sk.abstr.gattr(pyHooks, method), args);
    const callMethodIfExists = (method: pyStr, args: pyObject[]) => {
        const pyMethod = pyHooks.tp$getattr(method);
        if (pyMethod) {
            return pyCallOrSuspend(pyMethod, args);
        }
    };
    return {
        // Return an implementation of the JS API (anvil$hooks) that's backed off the Python implementation (_anvil_hooks_)
        setupDom() {
            return chainOrSuspend(callMethod(s_setup_dom, []), (elt) => unwrapDomElement(elt, pyComponent));
        },
        get domElement() {
            return unwrapDomElement(Sk.abstr.gattr(pyHooks, s_dom_element), pyComponent);
        },
        setDataBindingListener(listenFn: ListenerFn) {
            callMethod(s_set_data_binding_listener, [
                new pyFunc((pyComponent: Component, pyAttrName: pyStr, pyNewValue: pyObject) =>
                    listenFn(pyComponent, pyAttrName.toString(), pyNewValue)
                ),
            ]);
        },
        updateDesignName(name: string) {
            callMethodIfExists(s_update_design_name,[new pyStr(name)]);
        },
        getDesignInfo: () => {
            const pyDesignInfo = callMethodIfExists(s_get_design_info, []);
            if (pyDesignInfo) {
                return toJs(pyDesignInfo) as DesignInfo;
            } else {
                return EMPTY_DESIGN_INFO;
            }
        },
    };
};

// An implementation of the new Python API backed off the new JS API
interface PyHooks extends pyObject {
    hooks: AnvilHooks;
}

export const PyHooks: pyNewableType<PyHooks> = Sk.abstr.buildNativeClass("anvil.Component._AnvilHooks", {
    constructor: function AnvilHooks(hooks) {
        this.hooks = hooks;
    },
    slots: {
        tp$init(args, kws) {
            Sk.abstr.checkOneArg("_AnvilHooks", args, kws);
            const [component] = args;
            this.hooks = (component as Component).anvil$hooks;
        },
    },
    methods: {
        set_data_binding_listener: {
            $meth(listenerFn: pyCallable) {
                return chainOrSuspend(
                    this.hooks.setDataBindingListener(
                        (pyComponent: Component, attrName: string, pyNewValue: pyObject) =>
                            pyCallOrSuspend(listenerFn, [pyComponent, new pyStr(attrName), pyNewValue])
                    ),
                    () => pyNone
                );
            },
            $flags: { OneArg: true },
        },
        setup_dom: {
            $meth() {
                return chainOrSuspend(this.hooks.setupDom(), toPy);
            },
            $flags: { NoArgs: true },
        },
        update_design_name: {
            $meth(name: pyStr) {
                this.hooks.updateDesignName?.(name.toString());
                return pyNone;
            },
            $flags: { OneArg: true },
        },
        get_design_info: {
            $meth(asLayout: pyBool) {
                return toPy(this.hooks.getDesignInfo?.(Sk.misceval.isTrue(asLayout)) || EMPTY_DESIGN_INFO);
            },
            $flags: { OneArg: true },
        }
    },
    getsets: {
        dom_element: {
            $get() {
                return toPy(this.hooks.domElement);
            },
        },
    },
});

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

export function initComponentSubclass(cls: ComponentConstructor) {
    const pyAllowedEvents = cls.tp$getattr<pyIterable<pyStr>>(s_anvil_events);
    const allowedEvents = new Set((pyAllowedEvents ? arrayFromIterable(pyAllowedEvents) : []).map(eventDescriptionToString));
    const providesHooksInPython = cls.$typeLookup(s_anvil_hooks) !== Component.$typeLookup(s_anvil_hooks);

    cls._ComponentClass = { allowedEvents, providesHooksInPython };
    return pyNone;
}

let defaultDepId: string | undefined | null;
let onNextInstantiation: ((c: Component) => void) | undefined;

export const setDefaultDepId = (depId: string | null) => { defaultDepId = depId; }; // call immediately before instantiating a component
export const getDefaultDepId = (component: Component | null) => component?._Component.defaultDepId ?? null;
export const runOnNextInstantiation = (f: (c: Component) => void) => {
    onNextInstantiation = f;
};

interface ComponentState {
    allowedEvents: Set<string>;
    eventHandlers: { [eventName: string]: pyCallable[] };
    parent?: { pyParent: Component; remove: (() => void)[] };
    tag: pyObject;
    defaultDepId: string | null;
    pyHookWrapper?: pyObject;
}

type DesignerHint = "align-horizontal" | "font-bold" | "font-italic" | "font-underline" | "visible" | "enabled" | "background-color" | "foreground-color" | "border";

export interface PropertyDescriptionBase {
    name: string;
    type: string;
    description?: string;
    important?: boolean;
    group?: string | null;
    designerHint?: DesignerHint;
    deprecated?: boolean;
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
    | HtmlPropertyType;

export interface StringPropertyDescription extends PropertyDescriptionBase { type: StringPropertyType; multiline?: boolean, inlineEditElement?: string}
export interface StringListPropertyDescription extends PropertyDescriptionBase {type: StringListPropertyType; }
export interface NumberPropertyDescription extends PropertyDescriptionBase { type: NumberPropertyType; }
export interface BooleanPropertyDescription extends PropertyDescriptionBase { type: BooleanPropertyType; }
export interface FormPropertyDescription extends PropertyDescriptionBase { type: FormPropertyType; }
export interface ObjectPropertyDescription extends PropertyDescriptionBase { type: ObjectPropertyType; }
export interface ColorPropertyDescription extends PropertyDescriptionBase {type: ColorPropertyType; }
export interface IconPropertyDescription extends PropertyDescriptionBase {type: IconPropertyType; }
export interface RolePropertyDescription extends PropertyDescriptionBase {type: RolePropertyType; }
export interface UriPropertyDescription extends PropertyDescriptionBase {type: UriPropertyType; }
export interface HtmlPropertyDescription extends PropertyDescriptionBase {type: HtmlPropertyType; }

export interface EnumPropertyDescription extends PropertyDescriptionBase {
    type: EnumPropertyType,
    options: string[];
}

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
type RolePropertyValue = string;
type UriPropertyValue = string;
type HtmlPropertyvalue = string;

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
        /** if position set, call designerAPI.notifyBoundsChanged() otherwise return a HandleResult */
        drag: (relativeX: number, relativeY: number) => HandleDragResult | void;
        drop: (relativeX: number, relativeY: number) => void;
        doubleClick?: () => void;
    };
}

export interface WholeComponentInteraction extends InteractionBase {
    type: "whole_component";
    name: string;
    icon: "edit" | "delete" | "arrow_left" | "arrow_right" | "add";
    callbacks: { execute: () => void }
}

export type Interaction = ButtonInteraction | HandleInteraction | WholeComponentInteraction;

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
    childIdx?: number;
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
    pyLayoutProperties?: pyDict<pyStr,pyObject>;
}

export interface AnvilHooks extends Partial<HasRelevantHooks> {
    setupDom: () => Suspension | HTMLElement;
    readonly domElement: HTMLElement | undefined | null;
    setDataBindingListener(listenerFn: ListenerFn): void | Suspension | pyObject;
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

export interface ComponentConstructor extends pyType<Component> {
    new (): Component;
    _ComponentClass: {
        allowedEvents: Set<string>,
        providesHooksInPython: boolean;
    }
}

export interface Component extends pyObject {
    readonly constructor: ComponentConstructor;
    _Component: ComponentState;
    anvil$hooks: AnvilHooks;
    $verifyEventName(this: Component, pyEventName: pyStr, msg: string): string;
    $verifyCallable(this: Component, eventName: string, pyHandler: pyObject): void;
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

export const EMPTY_DESIGN_INFO : DesignInfo = {
    propertyDescriptions: [],
    events: {},
    interactions: [],
};

export const Component: ComponentConstructor = buildNativeClass("anvil.Component", {
    constructor: function Component() {},
    slots: {
        tp$new(args, kws) {
            const cls = this.constructor;
            const self = new cls();
            const {_ComponentClass: {allowedEvents, providesHooksInPython}} = cls;
            self._Component = {
                allowedEvents,
                eventHandlers: {},
                tag: new ComponentTag(),
                defaultDepId: defaultDepId as string,
            };
            defaultDepId = undefined;
            if (providesHooksInPython) {
                self.anvil$hooks = mkJsHooksForPython(self);
            }

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
            $meth(args) {
                return initComponentSubclass(this);
            },
            $flags: { FastCall: true },
        },
    },
    proto: {
        $verifyEventName(pyEventName: pyStr, msg: string) : string {
            const { allowedEvents } = this._Component;
            if (!Sk.builtin.checkString(pyEventName)) {
                throw new Sk.builtin.TypeError("expected the first argument to be a string");
            }
            const eventName = pyEventName.toString();
            if (eventName.startsWith("x-") || allowedEvents.has(eventName)) {
                return eventName;
            } else {
                throw new Sk.builtin.ValueError(`Cannot ${msg} for unknown event '${eventName}' on ${this.tp$name} component. Custom event names must start with 'x-'.`);
            }
        },
        $verifyCallable(eventName: string, pyHandler: pyObject) {
            if (!Sk.builtin.checkCallable(pyHandler)) {
                throw new Sk.builtin.TypeError(`The '${eventName}' event handler added to ${this.tp$name} must be a callable, not type '${Sk.abstr.typeName(pyHandler)}'`);
            }
        },
        anvilComponent$setParent(pyParent: Component, remove: () => void) {
            this._Component.parent = { pyParent, remove: [remove] };
        },
        anvilComponent$onRemove(remove: () => void) {
            this._Component.parent?.remove.push(remove);
        }
    },
    methods: {
        /*!defBuiltinMethod(,event_name,handler_func:callable)!2*/
        "set_event_handler": {
            $meth: function (pyEventName, pyHandler) {
                const {allowedEvents, eventHandlers} = this._Component;
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
                    throw new Sk.builtin.LookupError(`event handler '${pyHandler}' was not found in '${eventName}' event handlers for this component`);
                }
                const eventHandlers = currentHandlers.filter(
                    (handler) => handler !== pyHandler && Sk.misceval.richCompareBool(handler, pyHandler, "NotEq")
                );
                if (eventHandlers.length === currentHandlers.length) {
                    throw new Sk.builtin.LookupError(`event handler '${pyHandler}' was not found in '${eventName}' event handlers for this component`);
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
                Sk.abstr.checkOneArg("raise_event", args);
                const eventName = this.$verifyEventName(args[0], "raise event");

                const listeners = this._Component.eventHandlers[eventName];
                if (!listeners) {
                    return pyNone;
                }

                const eventArgs = kwToObj(kws);
                eventArgs["sender"] = this;
                eventArgs["event_name"] = args[0];

                return Sk.misceval.chain(
                    pyNone,
                    ...listeners.map((pyFn) => () => Sk.misceval.callsimOrSuspendArray(pyFn, [], objToKw(eventArgs)))
                );
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
                throw new Sk.builtin.AttributeError("Cannot set a '" + this.tp$name + "' component's parent this way - use 'add_component' on the container instead");
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
        _anvil_hooks_: {
            // If this doesn't get overridden, we're using JS hooks, so return a wrapper.
            $get() {
                return (this._Component.pyHookWrapper ??= new PyHooks(this));
            },
        },
    },
    flags: {
        sk$klass: true, // tell skulpt we can be treated like a regular klass for tp$setatttr
    },
});

export const getComponentParent = (component: Component) : Component | pyNoneType => Component.prototype.parent.tp$descr_get(component, null);

export const raiseEventOrSuspend = (component: Component, pyName: pyStr) =>
    pyCallOrSuspend(component.tp$getattr<pyCallable>(s_raise_event), [pyName]);

export const addEventHandler = (component: Component, pyName: pyStr, handler: (k: Kws) => Suspension | pyObject | void) =>
    pyCallOrSuspend(component.tp$getattr<pyCallable>(s_add_event_handler), [
        pyName,
        PyDefUtils.funcFastCall((_args: Args, kws: Kws = []) => chainOrSuspend(handler(kws), () => pyNone)),
    ]);

/*!defClass(anvil,Component)!*/

