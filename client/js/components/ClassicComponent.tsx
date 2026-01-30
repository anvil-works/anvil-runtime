"use strict";

import type { Suspension, pyObjectWithDict } from "@Sk";
import {
    buildNativeClass,
    buildPyClass,
    chainOrSuspend,
    isTrue,
    lookupSpecial,
    objectRepr,
    pyAttributeError,
    pyCall,
    pyCallOrSuspend,
    pyDict,
    pyFunc,
    pyNone,
    pyObject,
    pyStr,
    pySuper,
    pyTypeError,
    pyValueError,
    retryOptionalSuspensionOrThrow,
    toJs,
    toPy,
    typeName,
} from "@Sk";
import type { pyCallable } from "@Sk";
import PyDefUtils from "PyDefUtils";
import { ClassicInitOptions } from "@runtime/PyDefUtils/classic-component";
import { data } from "@runtime/runner/data";
import { hasLegacyDict } from "@runtime/runner/legacy-features";
import { designerApi } from "../runner/component-designer-api";
import {
    PyModMap,
    funcFastCall,
    initNativeSubclass,
    kwsToObj,
    s_init_subclass,
    s_x_anvil_classic_hide,
    s_x_anvil_classic_show,
    s_x_anvil_page_added,
    s_x_anvil_page_removed,
    s_x_anvil_page_shown,
} from "../runner/py-util";
import {
    AnvilHookSpec,
    Component,
    ComponentConstructor,
    ContainerDesignInfo,
    EventDescription,
    Interaction,
    PropertyDescription,
    StringPropertyDescription,
    getListenerCallbacks,
    raiseWritebackEventOrSuspend,
} from "./Component";

const hasOwnProperty = Object.prototype.hasOwnProperty;

export interface ClassicComponentConstructor<T extends ClassicComponent = ClassicComponent>
    extends ComponentConstructor {
    new <T extends ClassicComponent>(): T;
    prototype: T & {
        _anvilClassic$propDefaults: Record<string, pyObject>;
        _anvilClassic$createElement?: (props: Record<string, any>) => JSX.Element;
        _anvilClassic$propMap: PropMap<T>;
        _anvilClassic$propTypes: ClassicPropertyDescriptionMinaml[];
        _anvilClassic$eventTypes: Record<string, ClassicEventDescription>;
        _anvilClassic$layoutProps?: ClassicPropertyDescriptionMinaml[];
        _anvilClassic$dataBindingProps?: string | null;
        _anvilClassic$propsToInitialize?: string[];
    };
}

export type ClassicPropertyDescriptionMinaml = PropertyDescription & {
    readOnly?: boolean;
    initialize?: boolean;
    mapProp?: boolean;
    pyType?: string;
    deprecateFromRuntimeV3?: boolean;
    exampleValue?: any;
    dataBindingProp?: boolean;
    pyVal?: boolean;
    defaultValue?: any;
    suggested?: boolean;
    allowBindingWriteback?: boolean;
};

export type ClassicPropertyDescription<T extends ClassicComponent = ClassicComponent> =
    ClassicPropertyDescriptionMinaml &
        (
            | {
                  pyVal: true;
                  defaultValue?: pyObject;
                  get?: (self: T, element: RootElement<T>) => pyObject | Suspension;
                  getJS?: (self: T, element: RootElement<T>) => any;
                  set?: (
                      self: T,
                      element: RootElement<T>,
                      value: pyObject,
                      oldValue: pyObject
                  ) => pyObject | Suspension | void;
                  getUnset?: (
                      self: T,
                      element: RootElement<T>,
                      value: pyObject
                  ) => { value: any; css: any } | undefined;
              }
            | {
                  pyVal?: false | undefined;
                  defaultValue?: any;
                  get?: (self: T, element: RootElement<T>) => pyObject | Suspension;
                  getJS?: (self: T, element: RootElement<T>) => any;
                  set?: (self: T, element: RootElement<T>, value: any, oldValue: any) => pyObject | Suspension | void;
                  getUnset?: (self: T, element: RootElement<T>, value: any) => { value: any; css: any } | undefined;
              }
        );

type PropMap<T extends ClassicComponent> = Record<string, ClassicPropertyDescription<T>>;

export type ClassicEventDescription = EventDescription & {
    parameters?: EventDescription["parameters"] & { pyVal?: boolean };
    important?: boolean;
    deprecated?: boolean;
};

interface DefaultElements {
    root: HTMLElement;
}

type _RootElement<Elements extends DefaultElements> = Elements extends { root: HTMLElement }
    ? Elements["root"]
    : HTMLElement;

type RootElement<T extends ClassicComponent> = _RootElement<ReturnType<T["_anvilClassic$createElement"]>[1]>;

export interface _Anvil<T extends ClassicComponent = ClassicComponent> {
    domNode: RootElement<T>;
    element: JQuery<RootElement<T>>;
    elements: ReturnType<T["_anvilClassic$createElement"]>[1];
    designName?: string;
    updateDesignName?: (self: T) => void;
    propTypes: PropertyDescription[];
    propMap: PropMap<T>;
    props: Record<string, pyObject>;
    layoutPropTypes?: PropertyDescription[];
    dataBindingProp: string | null;
    eventHandlers: Record<string, pyCallable<pyObject | Suspension>[]>;
    eventTypes: Record<string, ClassicEventDescription>;
    onPage: boolean;
    inlineEditing?: boolean;
    pageEvents: {
        add?: () => pyObject | Suspension | void;
        remove?: () => pyObject | Suspension | void;
        show?: () => pyObject | Suspension | void;
    };
    components: { component: Component; layoutProperties: any }[];
    metadata: Record<string, any>;
    childLayoutProps: Record<string, any>;
    defaultWidth: number | null;
    get parent(): { pyObj: Component; removeFn: () => void; setVisibility?: (v: boolean) => void } | null;
    set parent(value: { pyObj: Component; removeFn: () => void; setVisibility?: (v: boolean) => void } | null);
    addedToPage(): pyObject | Suspension;
    removedFromPage(): pyObject | Suspension;
    shownOnPage(): pyObject | Suspension | void;
    getProp(name: string): pyObject | Suspension;
    getPropJS(name: string): any;
    setProp(name: string, pyValue: pyObject): Suspension | void | pyObject;
    setPropJS(name: string, value: any): void;
    dataBindingWriteback(pyComponent: Component, attrName: string, pyNewValue?: pyObject): Promise<any>;
    overrideParentObj?: Component;
}

export interface ClassicComponent<Anvil extends Record<string, any> = any> extends Component {
    _anvil: _Anvil<this> & Anvil & { domNode: Anvil["elements"]["root"]; element: JQuery<Anvil["elements"]["root"]> };
    _anvilClassic$propDefaults: Record<string, pyObject>;
    _anvilClassic$createElement: (
        props: Record<string, any>
    ) => [HTMLElement, "elements" extends keyof Anvil ? Anvil["elements"] : DefaultElements];
    _anvilClassic$propMap: PropMap<this>;
    _anvilClassic$propTypes: ClassicPropertyDescriptionMinaml[];
    _anvilClassic$eventTypes: Record<string, ClassicEventDescription>;
    _anvilClassic$layoutProps?: ClassicPropertyDescriptionMinaml[];
    _anvilClassic$dataBindingProps?: string | null;
    _anvilClassic$propsToInitialize?: string[];
}

interface ComponentTag extends pyObjectWithDict {}

export const ANVIL_PY_COMPONENT_PROP = "__anvilPyComponent" as const;

export function setDomPyComponent(domNode: HTMLElement, pyComponent: unknown) {
    (domNode as any)[ANVIL_PY_COMPONENT_PROP] = pyComponent;
}

export function getDomPyComponent<T = unknown>(domNode: Element | null | undefined): T | undefined {
    return (domNode as any)?.[ANVIL_PY_COMPONENT_PROP] as T | undefined;
}

const ClassicComponentFactory = (pyModule: PyModMap) => {
    // TODO: pyModule["ComponentTag"] = ComponentTag
    pyModule["ComponentTag"] = buildPyClass<ComponentTag>(
        pyModule,
        ($gbl, $loc) => {
            $loc["__serialize__"] = new pyFunc((self: ComponentTag) => self.$d);
            $loc["__repr__"] = new pyFunc(
                (self: ComponentTag) => new pyStr("ComponentTag(" + objectRepr(self.$d) + ")")
            );
        },
        "ComponentTag",
        []
    );

    const propNameMap = [
        ["name", "name"],
        ["type", "type"],
        ["group", "group"],
        ["description", "description"],
        ["important", "important"],
        ["hidden", "hidden"],
        ["options", "options"],
        ["accept", "accept"],
        ["iconsets", "iconsets"],
        ["allowCustomValue", "allowCustomValue"],
        ["designerHint", "designerHint"],
        ["multiline", "multiline"],
        ["deprecated", "deprecated"],
        ["allowBindingWriteback", "supportsWriteback"],
        ["includeNoneOption", "includeNoneOption"],
        ["noneOptionLabel", "noneOptionLabel"],
        ["defaultBindingProp", "defaultBindingProp"],
        ["priority", "priority"],
        ["showInDesignerWhen", "showInDesignerWhen"],
    ];

    function propertyDescriptionMapper(
        property: PropertyDescription & { deprecateFromRuntimeV3?: boolean }
    ): PropertyDescription {
        const rv: Record<string, any> = {};
        for (const [sourceCodeName, designerName] of propNameMap) {
            if (sourceCodeName in property) {
                rv[designerName] = property[sourceCodeName as keyof typeof property];
            }
        }
        if (property.deprecateFromRuntimeV3 && data.app.runtime_options.version >= 3) {
            rv.deprecated = true;
        }
        return rv as PropertyDescription;
    }

    function getPropertyDescriptions(rawPropDescriptions: PropertyDescription[]): PropertyDescription[] {
        return rawPropDescriptions.map(propertyDescriptionMapper);
    }

    const universalEvents = PyDefUtils.assembleGroupEvents("ClassicComponent", ["universal"]);

    const createHookSpec = (cls: ClassicComponentConstructor) => {
        let hookSpec: AnvilHookSpec<ClassicComponent<{ elements: DefaultElements }>>;
        if (ANVIL_IN_DESIGNER) {
            hookSpec = {
                // Return an implementation of the new JS API (anvil$hooks) that's backed off the old implementation (component._anvil)
                setupDom() {
                    return this._anvil.domNode;
                },
                getDomElement() {
                    return this._anvil.domNode;
                },
                // Designer hooks
                updateDesignName(name) {
                    this._anvil.designName = name;
                    this._anvil.updateDesignName?.(this);
                },
                getInteractions() {
                    const interactions: Interaction[] = [];
                    const inlineEditProp = this._anvil.propTypes.find(
                        (prop): prop is StringPropertyDescription => prop.type === "string" && !!prop.inlineEditElement
                    );
                    if (inlineEditProp && inlineEditProp.inlineEditElement) {
                        interactions.push({
                            type: "whole_component",
                            title: "Edit text",
                            icon: "edit",
                            callbacks: {
                                execute: () => {
                                    this._anvil.inlineEditing = true;
                                    this._anvil.updateDesignName?.(this);
                                    const elementName = inlineEditProp.inlineEditElement as
                                        | undefined
                                        | keyof DefaultElements;
                                    if (!elementName || !this._anvil.elements[elementName]) {
                                        return;
                                    }
                                    designerApi.startInlineEditing(
                                        this,
                                        inlineEditProp,
                                        this._anvil.elements[elementName],
                                        {
                                            onFinished: () => {
                                                this._anvil.inlineEditing = false;
                                                this._anvil.updateDesignName?.(this);
                                            },
                                        }
                                    );
                                },
                            },
                            default: true,
                        });
                    }
                    const heightAdjustment = this._anvil.propTypes.find(({ name }) => name === "height");
                    if (heightAdjustment) {
                        // Canvas, TextArea, Image, GoogleMap, Plot, Spacer, XYPanel
                        const heightProp = this._anvil.propMap["height"];
                        const oldSetHeight = heightProp?.set;

                        if (heightProp) {
                            heightProp.set = (s: ClassicComponent, e: HTMLElement, v: any, oldV?: any) => {
                                oldSetHeight?.(s, e, v, oldV);
                            };
                        }

                        let originalHeight: number | undefined;
                        const element = this.anvil$hooks.domElement;
                        if (!element) {
                            return [];
                        }

                        interactions.push({
                            type: "handle",
                            position: "bottom",
                            direction: "y",
                            callbacks: {
                                grab: () => {
                                    // use clientHeight since the prop might be a css value
                                    originalHeight = element.clientHeight;
                                },
                                drag: (_relX: number, relY: number) => {
                                    if (originalHeight !== undefined) {
                                        this._anvil.setPropJS("height", originalHeight + relY);
                                    }
                                },
                                drop: (_relX: number, relY: number) => {
                                    if (originalHeight !== undefined) {
                                        const newHeight = originalHeight + relY;
                                        this._anvil.setPropJS("height", newHeight);
                                        designerApi.updateComponentProperties(this, { height: newHeight }, {});
                                    }
                                },
                            },
                        });
                    }
                    return interactions;
                },
                getUnsetPropertyValues() {
                    return Object.fromEntries(
                        Object.entries(this._anvil.propMap)
                            .map(([name, { getUnset }]) => [
                                name,
                                getUnset?.(this, this._anvil.domNode, this._anvil.props[name]),
                            ])
                            .filter(([_name, unset]) => unset)
                    );
                },
                getProperties() {
                    // we don't use _anvil because 'this' might be the prototype
                    return getPropertyDescriptions(this._anvilClassic$propTypes);
                },
                getEvents() {
                    return Object.values(this._anvilClassic$eventTypes);
                },
                getContainerDesignInfo(child: Component): ContainerDesignInfo {
                    return {
                        layoutPropertyDescriptions: getPropertyDescriptions(this._anvil.layoutPropTypes ?? []),
                    };
                },
            };
        } else {
            hookSpec = {
                setupDom() {
                    return this._anvil.domNode;
                },
                getDomElement() {
                    return this._anvil.domNode;
                },
                getProperties() {
                    // we don't use _anvil because 'this' might be the cls.prototype
                    return getPropertyDescriptions(this._anvilClassic$propTypes);
                },
                getEvents() {
                    return Object.values(this._anvilClassic$eventTypes);
                },
            };
        }
        cls.prototype.anvil$hookSpec = hookSpec;
    };

    // TODO: implement anvilComponent$setParent

    // We use buildNativeClass to ensure that all instances of subclasses of Component follow prototypical inheritance
    // this is enforced by python. It is the reason why you get layout conflicts when trying to inherit from str and int
    // in javascript land the winner of __base__ is the next class on the prototypical chain
    // having Component as a nativeClass means that a subclass of Component will always be the winner of __base__
    // class A(Component): pass
    // class B: pass
    // class C(B, A): pass
    // C.__base__ # A (A is the winer of __base__)  in javascript C instanceof Component // true
    // an alternative would be to implement slots and give Component a __slots__ attribute. This does the same thing as above.

    const ClassicComponent: ClassicComponentConstructor = buildNativeClass("anvil.ClassicComponent", {
        constructor: function ClassicComponent() {
            // note a pure instance of Component doesn't have a __dict__, all subclasses do however.
        },
        base: Component,
        slots: {
            tp$new(args, kwargs) {
                const self = Component.prototype.tp$new.call(this, []) as ClassicComponent;
                if (!self.$d && hasLegacyDict()) {
                    self.$d = new pyDict();
                }
                const _anvil = (self._anvil = createAnvil(self));

                kwargs = kwargs || [];
                const propsToInit: Record<string, pyObject> = {};
                for (let i = 0; i < kwargs.length; i += 2) {
                    const key = kwargs[i];
                    if (typeof key === "string") {
                        propsToInit[key] = kwargs[i + 1] as pyObject;
                    }
                }

                const {
                    _anvilClassic$propDefaults: propDefaults,
                    _anvilClassic$createElement: createElement,
                    _anvilClassic$propMap: propMap,
                    _anvilClassic$propTypes: propTypes,
                    _anvilClassic$eventTypes: eventTypes,
                    _anvilClassic$layoutProps: layoutPropTypes,
                    _anvilClassic$dataBindingProps: dataBindingProps,
                    _anvilClassic$propsToInitialize: propsToInitialize,
                } = self;
                // use prototypical inheritance to get these
                // this won't break since native classes demand prototypical inheritance

                const props: Record<string, pyObject> = {};
                Object.keys(propDefaults).forEach((propName) => {
                    const propVal = propsToInit[propName] || propDefaults[propName];
                    if (propVal !== undefined) {
                        props[propName] = propVal; // we shouldn't put undefined in props see getProp
                    }
                });
                props.tag ??= pyCall(pyModule["ComponentTag"]);

                _anvil.props = props;
                _anvil.propMap = propMap;
                _anvil.propTypes = propTypes;
                _anvil.layoutPropTypes = layoutPropTypes;
                _anvil.dataBindingProp = dataBindingProps ?? null;
                // backwards compatibility (anvil-extras uses this oops)
                _anvil.eventHandlers = Object.assign(self._Component.eventHandlers, _anvil.eventHandlers);
                _anvil.eventTypes = new Proxy(eventTypes ?? {}, {
                    get(target, k: string) {
                        return target[k];
                    },
                    set(target, k: string, v) {
                        target[k] = v;
                        if (v) {
                            self._Component.allowedEvents.add(k);
                        } else {
                            self._Component.allowedEvents.delete(k);
                        }
                        return true;
                    },
                });

                // We have discussed passing self to createElement.
                // This would be totally reasonable, and probably be useful, but we don't need it right now.
                const [domNode, elements] = createElement(props);
                const element = $(domNode);

                _anvil.element = element;
                _anvil.elements = elements;
                _anvil.domNode = domNode;

                domNode.classList.add("anvil-component"); // this is a relatively slow operation
                setDomPyComponent(domNode, self);
                element.data("anvil-py-component", self);
                // These may have already been set if we created this component in the designer, but
                // we need to set them if we created this component at runtime. No harm setting them
                // twice, so just do it.

                // special case visible - since we need to notify parent
                if ("visible" in props && "visible" in propMap) {
                    self._Component.pageState.currentlyVisible = isTrue(props.visible);
                }

                if (propsToInitialize?.length) {
                    const fns = propsToInitialize
                        .filter((propName) => propName in props)
                        .map((propName) => () => _anvil.setProp(propName, props[propName]));
                    return chainOrSuspend(null, ...fns, () => self);
                } else {
                    return self;
                }
            },
            /*
             * The job of __init__ here is to be friendly to subclassing
             * We wait until __init__ to throw any exceptions
             * We only update component props that are not strictly equal to the props we received in __new__
             * This allows users to extract properties and manipulate them before calling super().__init__
             *
             *     def __init__(self, foo, background, **properties):
             *         self.foo = foo
             *         background = 'red'
             *         super().__init__(background=background, **properties)
             */
            tp$init(args, kwargs) {
                if (args.length) {
                    throw new pyTypeError("Component constructor takes keyword arguments only");
                }
                if (ANVIL_IN_DESIGNER || designerApi.inDesigner) {
                    return;
                }
                kwargs = kwargs || [];
                let __ignore_property_exceptions = false;
                const badKwargs: string[] = [];
                const chainFns: Array<() => void | Suspension | pyObject> = [];
                const readOnly: string[] = [];
                const props = this._anvil.props;
                const propMap = this._anvil.propMap;
                for (let i = 0; i < kwargs.length; i += 2) {
                    const propName = kwargs[i] as string;
                    const propVal = kwargs[i + 1] as pyObject;
                    if (propVal !== props[propName]) {
                        if (propName === "__ignore_property_exceptions") {
                            __ignore_property_exceptions = true;
                            // this will be true for every anvil yaml component so check this first
                        } else if (!(propName in propMap)) {
                            badKwargs.push(propName);
                        } else if (propMap[propName].readOnly) {
                            readOnly.push(propName);
                        } else {
                            chainFns.push(() => this._anvil.setProp(propName, propVal));
                        }
                    }
                }
                if (!__ignore_property_exceptions && (badKwargs.length || readOnly.length)) {
                    let msg = typeName(this);
                    if (badKwargs.length) {
                        msg += " got unexpected keyword argument(s): " + badKwargs.map((x) => "'" + x + "'").join(", ");
                    }
                    if (readOnly.length) {
                        msg += badKwargs.length ? "\n" : " ";
                        msg +=
                            "cannot set the following readonly properties: " +
                            readOnly.map((x) => "'" + x + "'").join(", ");
                    }
                    throw new pyTypeError(msg);
                }
                if (chainFns.length) {
                    return chainOrSuspend(null, ...chainFns, () => undefined);
                }
            },
        },
        classmethods: {
            __init_subclass__: {
                $meth(args, kws) {
                    const kwObj = kwsToObj(kws);
                    const classicInitOptions = (kwObj._anvil_classic ?? {}) as ClassicInitOptions;
                    PyDefUtils.initClassicComponentClassPrototype(this, classicInitOptions);
                    if (kwObj._anvil_classic && !hasOwnProperty.call(this, "anvil$hookSpec")) {
                        createHookSpec(this);
                    }
                    const superInit = new pySuper(ClassicComponent, this).tp$getattr<pyCallable>(s_init_subclass);
                    return pyCallOrSuspend(superInit, args, kws);
                },
                $flags: { FastCall: true },
            },
        },
        getsets: {
            __name__: {
                $get() {
                    // Backwards compatibility with Skulpt - annoying hack to get the name of the class
                    return lookupSpecial(this.ob$type, pyStr.$name);
                },
            },
        },
        proto: {
            // just use the self version
            __serialize__: PyDefUtils.mkSerializePreservingIdentity((self: ClassicComponent) => {
                const v: pyObject[] = [];
                for (const n in self._anvil.props) {
                    v.push(new pyStr(n), self._anvil.props[n]);
                }
                return new pyDict(v);
            }),
            __new_deserialized__: PyDefUtils.mkNewDeserializedPreservingIdentity(),
        },
        flags: {
            sk$klass: true, // tell skulpt we can be treated like a regular klass for tp$setatttr
        },
    });

    PyDefUtils.initClassicComponentClassPrototype(ClassicComponent, {
        properties: PyDefUtils.assembleGroupProperties(["user data"]),
        events: universalEvents, // events
        element: () => <div />, // element
        layouts: [], // layoutProps
    });

    Object.defineProperties(ClassicComponent.prototype, {
        anvil$properties: {
            get() {
                return getPropertyDescriptions(this._anvilClassic$propTypes);
            },
            configurable: true,
        },
        anvil$events: {
            get() {
                return Object.values(this._anvilClassic$eventTypes);
            },
            configurable: true,
        },
    });

    // Because __init_subclass__ isn't a thing for native types
    createHookSpec(ClassicComponent);
    initNativeSubclass(ClassicComponent);

    function createAnvil(self: ClassicComponent): _Anvil {
        const tempEl = document.createElement("div");

        const _anvil: _Anvil = {
            element: $(tempEl), // will be created in Component.__new__
            domNode: tempEl, // will be created in Component.__new__
            elements: { root: tempEl }, // will be an object of {refName: domNode}
            // for compatibility
            // parent: null, // will be {pyObj: parent_component, removeFn: fn}
            get parent() {
                const internalParent = self._Component.parent ?? null;
                if (!internalParent) {
                    return null;
                }
                return {
                    pyObj: internalParent.pyParent,
                    removeFn: () => internalParent.remove.forEach((f) => f()),
                    setVisibility: internalParent.setVisibility,
                };
            },
            set parent(value: { pyObj: Component; removeFn: () => void; setVisibility?: (v: boolean) => void } | null) {
                if (!value) {
                    return;
                }
                // this shouldn't be called directly - leave here for legacy
                self._Component.parent = {
                    pyParent: value.pyObj,
                    remove: [value.removeFn],
                    setVisibility: value.setVisibility,
                };
            },
            eventTypes: {},
            eventHandlers: {},
            props: {},
            propTypes: [],
            propMap: {},
            layoutPropTypes: [],
            childLayoutProps: {},
            metadata: {},
            defaultWidth: null,
            onPage: false,
            components: [],
            addedToPage(): pyObject | Suspension {
                self._anvil.onPage = true;
                return self._anvil.pageEvents.add?.() ?? pyNone;
            },
            removedFromPage(): pyObject | Suspension {
                self._anvil.onPage = false;
                return self._anvil.pageEvents.remove?.() ?? pyNone;
            },
            shownOnPage(): pyObject | Suspension | void {
                if (self._anvil.onPage) {
                    return self._anvil.pageEvents.show?.();
                }
                return pyNone;
            },
            pageEvents: {},
            getProp(name: string): pyObject | Suspension {
                const prop = self._anvil.propMap[name];
                if (!prop) {
                    throw new pyAttributeError(self.tp$name + " component has no property called '" + name + "'");
                }
                let v: pyObject | Suspension;
                if (prop.get) {
                    const result = prop.get(self, self._anvil.domNode);
                    v = prop.pyVal ? result : toPy(result);
                } else {
                    if (name in self._anvil.props) {
                        v = self._anvil.props[name];
                    } else {
                        const defaultValue = prop.pyVal ? prop.defaultValue : toPy(prop.defaultValue);
                        if (defaultValue === undefined) {
                            throw new pyValueError(
                                self.tp$name + " component has no value or default for property '" + name + "'"
                            );
                        }
                        v = defaultValue;
                    }
                }
                return v;
            },
            getPropJS(name: string): any {
                const prop = self._anvil.propMap[name];
                if (prop && prop.getJS) {
                    return prop.getJS(self, self._anvil.domNode);
                } else {
                    return toJs(retryOptionalSuspensionOrThrow(this.getProp(name)));
                }
            },
            setProp(name: string, pyValue: pyObject): pyObject | Suspension | void {
                const prop = self._anvil.propMap[name];

                if (!prop) {
                    throw new pyAttributeError(self.tp$name + " component has no property called '" + name + "'");
                }

                if (pyValue === undefined) {
                    throw new pyValueError("'undefined' is not a valid Python value");
                }

                if (prop.readOnly) {
                    throw new pyAttributeError("The '" + name + "' property for a " + self.tp$name + " is read-only");
                }

                let pyOldValue = self._anvil.props[name];
                pyOldValue = pyOldValue === undefined ? pyNone : pyOldValue;
                self._anvil.props[name] = pyValue;

                let v: pyObject | Suspension | void = undefined;
                if (prop.set) {
                    if (prop.pyVal) {
                        v = prop.set(self, self._anvil.domNode, pyValue, pyOldValue);
                    } else {
                        v = prop.set(self, self._anvil.domNode, toJs(pyValue), toJs(pyOldValue));
                    }
                }
                return v === undefined ? pyNone : v;
            },
            setPropJS(name: string, value: any): void {
                retryOptionalSuspensionOrThrow(this.setProp(name, toPy(value)));
            },
            dataBindingWriteback(pyComponent: Component, attrName: string, pyNewValue: pyObject): Promise<any> {
                return PyDefUtils.asyncToPromise(() =>
                    raiseWritebackEventOrSuspend(pyComponent, new pyStr(attrName), pyNewValue)
                );
            },

            dataBindingProp: null,
        };

        _anvil.eventHandlers[s_x_anvil_page_added.toString()] = [funcFastCall(() => _anvil.addedToPage())];
        _anvil.eventHandlers[s_x_anvil_page_removed.toString()] = [funcFastCall(() => _anvil.removedFromPage())];
        _anvil.eventHandlers[s_x_anvil_page_shown.toString()] = [
            funcFastCall(() => {
                const result = _anvil.shownOnPage();
                return result ?? pyNone;
            }),
        ];
        _anvil.eventHandlers[s_x_anvil_classic_show.toString()] = [
            funcFastCall(() => {
                if (_anvil.onPage) {
                    const cbs = getListenerCallbacks(self, "show");
                    if (cbs.length) return chainOrSuspend(null, ...cbs);
                }
                return pyNone;
            }),
        ];
        _anvil.eventHandlers[s_x_anvil_classic_hide.toString()] = [
            funcFastCall(() => {
                if (!_anvil.onPage) {
                    const cbs = getListenerCallbacks(self, "hide");
                    if (cbs.length) return chainOrSuspend(null, ...cbs);
                }
                return pyNone;
            }),
        ];

        return _anvil;
    }

    pyModule["ClassicComponent"] = ClassicComponent;
};

export default ClassicComponentFactory;

/*
 * TO TEST:
 *
 *  - Methods: set_event_handler, add_event_handler, raise_event, remove_from_parent
 *
 */
