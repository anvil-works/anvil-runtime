import {
    Args,
    Kws,
    buildNativeClass,
    chainOrSuspend,
    pyAttributeError,
    pyCallable,
    pyList,
    pyModule,
    pyNone,
    pyObject,
    pyStr,
    remapToJsOrWrap,
    toPy,
    tryCatchOrSuspend,
} from "@Sk";
import type { GetSetDef } from "@Sk/abstr/build_native_class";
import {
    AnvilHookSpec,
    Component,
    ComponentConstructor,
    ContainerDesignInfo,
    CustomComponentSpec,
    DropZone,
    DroppingSpecification,
    EventDescription,
    Interaction,
    PropertyDescriptionBase,
    PropertyValueUpdates,
    Section,
    ToolboxSection,
    getPyParent,
    notifyComponentMounted,
    notifyComponentUnmounted,
    notifyVisibilityChange as notifyComponentVisibilityChange,
    raiseEventOrSuspend,
    raiseWritebackEventOrSuspend,
} from "@runtime/components/Component";
import { Container, validateChild } from "@runtime/components/Container";
import { initNativeSubclass, kwsToJsObj, s_add_event_handler, s_remove_event_handler } from "@runtime/runner/py-util";
import { DropModeFlags } from "@runtime/runner/python-objects";
import PyDefUtils, { asyncToPromise, pyCall } from "PyDefUtils";
import { addJsModuleHook, customToolboxSections, jsCustomComponents } from "../common";
import { JS_COMPONENT, PY_COMPONENT } from "./constants";
import { asJsComponent, maybeSuspend, returnToPy, toPyComponent } from "./utils";

export interface RawJsComponentConstructor extends JsComponentConstructor {
    new (): RawJsComponent;
}

export interface RawJsComponent extends JsComponent {
    [PY_COMPONENT]: Component;
}

export interface JsComponentConstructor {
    new (): JsComponent | JsContainer;
    _anvilEvents?: EventDescription[];
    _anvilProperties?: PropertyDescriptionBase[];
}
export interface JsComponent {
    _anvilNew?: () => void;
    _anvilSetupDom(): HTMLElement | Promise<HTMLElement>;
    _anvilDomElement: null | undefined | HTMLElement;
    _anvilGetInteractions?(): Interaction[];
    _anvilUpdateDesignName?(name: string): void;
    _anvilSetSectionPropertyValues?(
        id: string,
        values: PropertyValueUpdates
    ): PropertyValueUpdates | void | Promise<PropertyValueUpdates | void>;
    _anvilGetSections?(): Section[];
    _anvilGetSectionDomElement?(id: string): HTMLElement;
}

type RemoveFn = () => void | Promise<void>;
type SetVisibilityFn = (v: boolean) => void;

interface ComponentCleanup {
    onRemove: RemoveFn;
    setVisibility?: SetVisibilityFn;
    isMounted?: boolean;
}

export interface JsContainer extends JsComponent {
    _anvilAddComponent(
        component: JsComponent,
        layoutProperties: { index?: number; [prop: string]: any }
    ): ComponentCleanup | Promise<ComponentCleanup>;
    _anvilGetComponents(): JsComponent[];
    _anvilEnableDropMode?(
        droppingObject: DroppingSpecification & { layoutProperties?: { [prop: string]: any } },
        flags?: DropModeFlags
    ): DropZone[];
    _anvilDisableDropMode?(): void;
    _anvilGetContainerDesignInfo?(component: JsComponent): ContainerDesignInfo;
    _anvilUpdateLayoutProperties?(
        component: JsComponent,
        values: PropertyValueUpdates
    ): PropertyValueUpdates | Promise<PropertyValueUpdates> | undefined | Promise<undefined>;
}

export function getParent(self: JsComponent) {
    const pyComponent = toPyComponent(self);
    const pyParent = getPyParent(pyComponent);
    if (!pyParent) return null;
    return asJsComponent(pyParent);
}

export function notifyMounted(self: JsComponent, isRoot = false) {
    const pyComponent = toPyComponent(self);
    return asyncToPromise(() => notifyComponentMounted(pyComponent, isRoot));
}

export function notifyUnmounted(self: JsComponent, isRoot = false) {
    const pyComponent = toPyComponent(self);
    return asyncToPromise(() => notifyComponentUnmounted(pyComponent, isRoot));
}

export function notifyVisibilityChange(self: JsComponent, visible: boolean) {
    const pyComponent = toPyComponent(self);
    return asyncToPromise(() => notifyComponentVisibilityChange(pyComponent, visible));
}

export function raiseAnvilEvent(self: JsComponent, eventName: string, eventArgs: { [arg: string]: any } = {}) {
    const pyKw: Kws = [];
    for (const [k, v] of Object.entries(eventArgs)) {
        pyKw.push(k, toPy(v));
    }
    return asyncToPromise(() => raiseEventOrSuspend(toPyComponent(self), new pyStr(eventName), pyKw));
}

export function triggerWriteBack(component: JsComponent, property: string, value: any) {
    return asyncToPromise(() =>
        raiseWritebackEventOrSuspend(toPyComponent(component), new pyStr(property), toPy(value))
    );
}

export interface EventArgs {
    sender: JsComponent;
    event_name: string;
    [key: string]: any;
}

export type EventCallback = (eventArgs: EventArgs) => void;
export type Unsubscribe = () => void;

export function subscribeAnvilEvent(self: JsComponent, eventName: string, callback: EventCallback): Unsubscribe {
    const pyListener = PyDefUtils.funcFastCall((_args: Args, kws: Kws = []) => {
        const eventArgs = kwsToJsObj(kws) as EventArgs;
        eventArgs.sender = self;
        return returnToPy(callback(eventArgs));
    });
    const pyComponent = toPyComponent(self);
    const addEventHandler = pyComponent.tp$getattr<pyCallable>(s_add_event_handler);
    const removeEventHandler = pyComponent.tp$getattr<pyCallable>(s_remove_event_handler);
    const pyEventName = new pyStr(eventName);
    pyCall(addEventHandler, [pyEventName, pyListener]);
    return () => {
        pyCall(removeEventHandler, [pyEventName, pyListener]);
    };
}

export interface WrappedJsComponentConstructor extends ComponentConstructor {
    new (): WrappedJsComponent;
}

export interface WrappedJsComponent extends Component {
    [JS_COMPONENT]: JsComponent;
}

export interface WrappedJsContainer extends Component {
    [JS_COMPONENT]: JsContainer;
}

const isContainer = (obj: any, container?: boolean): obj is JsContainer => !!container;

function setPropertyValuesOneByOne(this: JsComponent, updates: { [propName: string]: any }) {
    const retrievedUpdates: { [propName: string]: any } = {};
    for (const [key, val] of Object.entries(updates)) {
        if (!(key in this)) {
            // the key should be a descriptor on the prototype
            throw new pyAttributeError(key);
        }
        (this as any)[key] = val;
        retrievedUpdates[key] = (this as any)[key];
    }
    return retrievedUpdates;
}

const createHookSpec = (spec: CustomComponentSpec): AnvilHookSpec<WrappedJsComponent> => {
    const hooks: AnvilHookSpec<WrappedJsComponent> = {
        setupDom() {
            return maybeSuspend(this[JS_COMPONENT]._anvilSetupDom());
        },
        getDomElement() {
            return this[JS_COMPONENT]._anvilDomElement;
        },
        getProperties() {
            return spec.properties ?? [];
        },
        getEvents() {
            return spec.events ?? [];
        },
        updateDesignName(name) {
            return this[JS_COMPONENT]._anvilUpdateDesignName?.(name);
        },
        getInteractions() {
            // backwards compatability
            if ("_anvilGetDesignInfo" in this[JS_COMPONENT]) {
                console.warn("DEPRECATED _anvilGetDesignInfo - instead use _anvilGetInteractions");
                // @ts-ignore
                return this[JS_COMPONENT]._anvilGetDesignInfo?.()?.interactions ?? [];
            }
            return this[JS_COMPONENT]._anvilGetInteractions?.() ?? [];
        },
        getSections() {
            return this[JS_COMPONENT]._anvilGetSections?.();
        },
        getSectionDomElement(id) {
            return this[JS_COMPONENT]._anvilGetSectionDomElement?.(id);
        },
        setSectionPropertyValues(id, updates) {
            return maybeSuspend(this[JS_COMPONENT]._anvilSetSectionPropertyValues?.(id, updates ?? {}));
        },
    };

    if (spec.container) {
        const containerHooks: Partial<AnvilHookSpec<WrappedJsContainer>> = {
            getContainerDesignInfo(forChild) {
                return (
                    this[JS_COMPONENT]._anvilGetContainerDesignInfo?.(asJsComponent(forChild)) ?? {
                        layoutPropertyDescriptions: [],
                    }
                );
            },
            updateLayoutProperties(forChild, newValues) {
                return maybeSuspend(
                    this[JS_COMPONENT]._anvilUpdateLayoutProperties?.(asJsComponent(forChild), newValues)
                );
            },
            enableDropMode(dropping, flags) {
                if (dropping.pyLayoutProperties) {
                    // @ts-ignore
                    dropping.layoutProperties = remapToJsOrWrap(dropping.pyLayoutProperties);
                }
                return this[JS_COMPONENT]._anvilEnableDropMode?.(dropping, flags) ?? [];
            },
            disableDropMode() {
                return this[JS_COMPONENT]._anvilDisableDropMode?.();
            },
        };
        Object.assign(hooks, containerHooks);
    }
    return hooks;
};

const ObjectProto = Object.prototype;
const FunctionProto = Function.prototype;

function getAllPropertyDescriptors(cls: JsComponentConstructor) {
    let proto = cls.prototype;
    const prototypes = [];

    while (proto && proto !== ObjectProto && proto !== FunctionProto) {
        prototypes.push(proto);
        proto = Object.getPrototypeOf(proto);
    }

    const rv: PropertyDescriptorMap = {};

    for (const proto of prototypes) {
        const propertyDescriptorMap = Object.getOwnPropertyDescriptors(proto);
        Object.assign(rv, propertyDescriptorMap);
    }
    return Object.entries(rv);
}

function pyComponentFromClass(cls: JsComponentConstructor, spec: CustomComponentSpec) {
    const { container, name } = spec;
    const descriptors = getAllPropertyDescriptors(cls);
    const getsets = descriptors.filter(([, descriptor]) => descriptor.get || descriptor.set);
    const methods = descriptors.filter(
        ([name, descriptor]) =>
            !name.startsWith("_") && name !== "constructor" && typeof descriptor.value === "function"
    );

    const base = container ? Container : Component;

    const pyComponentCls: WrappedJsComponentConstructor = buildNativeClass(name, {
        constructor: function WrappedJsComponent() {
            // can't guarantee this gets called when subclassed
        },
        slots: {
            tp$new(args, kws) {
                // this: pyComponentCls.prototype
                const self = base.prototype.tp$new.call(this, []) as WrappedJsComponent;
                const jsSelf = (self[JS_COMPONENT] = new cls());
                (jsSelf as RawJsComponent)[PY_COMPONENT] = self;
                jsSelf._anvilNew?.();
                return self;
            },
            tp$init(args, kws) {
                if (args.length) {
                    throw new Sk.builtin.TypeError("Component constructor takes keyword arguments only");
                }
                const chainedFns = [];
                // TODO handle ignore_property_exceptions
                // We also might want to be cleverer here
                // potentially adding `_anvilPostInit`, `_anvilPreInit` might be useful
                let raiseError = true;
                if (kws) {
                    for (let i = 0; i < kws.length; i += 2) {
                        const k = kws[i] as string;
                        const v = kws[i + 1] as pyObject;
                        if (k !== "__ignore_property_exceptions") {
                            chainedFns.push(() =>
                                tryCatchOrSuspend(
                                    () => this.tp$setattr(new pyStr(k), v, true),
                                    (e) => {
                                        if (raiseError) throw e;
                                    }
                                )
                            );
                        } else {
                            raiseError = false;
                        }
                    }
                }
                if (chainedFns.length) return chainOrSuspend(null, ...chainedFns);
            },
        },
        base,
        getsets: Object.fromEntries(
            getsets.map(([name, descriptor]) => {
                const getset: GetSetDef<WrappedJsComponent> = {
                    $get() {
                        return returnToPy(descriptor.get?.call(this[JS_COMPONENT]));
                    },
                };

                if (descriptor.set) {
                    getset.$set = function (val) {
                        return returnToPy(descriptor.set?.call(this[JS_COMPONENT], remapToJsOrWrap(val)));
                    };
                }

                return [name, getset];
            })
        ),
        methods: {
            ...Object.fromEntries(
                methods.map(([name, descriptor]) => [
                    name,
                    {
                        $meth(...args) {
                            return returnToPy(descriptor.value.apply(this[JS_COMPONENT], args.map(remapToJsOrWrap)));
                        },
                        $flags: { MinArgs: 0 },
                    },
                ])
            ),
            ...(!container
                ? {}
                : {
                      add_component: {
                          $meth([component]: [Component], kws: Kws) {
                              validateChild(component);
                              const layoutProperties = kwsToJsObj(kws);
                              const jsContainer = this[JS_COMPONENT] as JsContainer;

                              const doAddComponent = async () => {
                                  const {
                                      onRemove,
                                      setVisibility,
                                      isMounted = true,
                                  } = await jsContainer._anvilAddComponent(asJsComponent(component), layoutProperties);
                                  // We could call super here
                                  // super().add_component(component, on_remove=toPy(onRemove), on_set_visibility=toPy(setVisibility));
                                  // this might return a suspension and that's fine
                                  return component.anvilComponent$setParent(this, {
                                      onRemove: () => maybeSuspend(onRemove()),
                                      setVisibility,
                                      isMounted,
                                  });
                              };

                              return returnToPy(doAddComponent());
                          },
                          $flags: { FastCall: true },
                      },
                      get_components: {
                          $meth() {
                              return new pyList(
                                  (this[JS_COMPONENT] as JsContainer)._anvilGetComponents().map((c) => toPyComponent(c))
                              );
                          },
                          $flags: { NoArgs: true },
                      },
                  }),
        },
        flags: { sk$klass: true },
        proto: {
            anvil$hookSpec: createHookSpec(spec),
        },
    });

    initNativeSubclass(pyComponentCls);

    return pyComponentCls;
}

const cleanSpec = ({
    name,
    properties,
    events,
    layoutProperties,
    container,
    showInToolbox,
    methods,
}: CustomComponentSpec) => ({
    name,
    properties,
    events,
    layoutProperties,
    container,
    showInToolbox,
    methods,
});

export function registerJsComponent(componentCls: JsComponentConstructor, spec: CustomComponentSpec) {
    const { name } = spec;
    const match = name.match(/^(.*)\.([^.]+)$/);
    if (!match) {
        Sk.builtin.print([`Cannot register JS component with invalid name: ${name}`]);
        return;
    }
    const [_, pkgName, leafName] = match;
    const cls = pyComponentFromClass(componentCls, spec);

    addJsModuleHook(() => {
        const pyMod = new pyModule();
        const pyName = new pyStr(name);
        pyMod.init$dict(pyName, pyNone);
        pyMod.$d[leafName] = cls;
        Sk.sysmodules.mp$ass_subscript(pyName, pyMod);

        try {
            Sk.importModule(pkgName, false, false);
            const parentPkg = Sk.sysmodules.mp$subscript(toPy(pkgName));
            parentPkg.tp$setattr(toPy(leafName), pyMod);
        } catch (e) {
            console.error(e);
            Sk.builtin.print([`Failed to import parent module '${pkgName}' when registering JS component '${name}'`]);
        }

        jsCustomComponents[name] = { pyMod, spec: cleanSpec(spec) };
    });
    return cls;
}

export const registerToolboxSection = (section: ToolboxSection) => {
    customToolboxSections.push(section);
};
