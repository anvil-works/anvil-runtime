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
    toJs,
    toPy,
    tryCatchOrSuspend,
} from "@Sk";
import type { GetSetDef } from "@Sk/abstr/build_native_class";
import {
    AnvilHooks,
    Component,
    ComponentConstructor,
    ContainerDesignInfo,
    CustomComponentSpec,
    DesignInfo,
    DropZone,
    DroppingSpecification,
    EventDescription,
    Section,
    ToolboxSection,
    initComponentSubclass,
    raiseEventOrSuspend, PropertyValueUpdates,
} from "@runtime/components/Component";
import { Container, validateChild } from "@runtime/components/Container";
import { kwargsToJsObject, s_add_event_handler, s_anvil_events, s_remove_event_handler } from "@runtime/runner/py-util";
import { DropModeFlags } from "@runtime/runner/python-objects";
import PyDefUtils, { asyncToPromise, pyCall } from "PyDefUtils";
import { designerApi } from ".";
import { customToolboxSections, jsCustomComponents, whenEnvironmentReady } from "../common";
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
    _anvilEvents?: string[] | EventDescription[];
}
export interface JsComponent {
    _anvilSetupDom(): HTMLElement | Promise<HTMLElement>;
    _anvilDomElement: null | undefined | HTMLElement;
    _anvilGetDesignInfo?(options: { asLayout?: boolean }): DesignInfo;
    _anvilSetPropertyValues?(values: PropertyValueUpdates): PropertyValueUpdates | Promise<PropertyValueUpdates>;
    _anvilUpdateDesignName?(name: string): void;
    _anvilSetSectionPropertyValues?(id: string, values: PropertyValueUpdates): PropertyValueUpdates | Promise<PropertyValueUpdates>;
    _anvilGetSections?(): Section[];
    _anvilGetSectionDomElement?(id: string): HTMLElement;
}

type RemoveFn = () => void | Promise<void>;
type SetVisibilityFn = (v: boolean) => void;

interface ComponentCleanup {
    onRemove: RemoveFn;
    setVisibility?: SetVisibilityFn;
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
    _anvilUpdateLayoutProperties?(component: JsComponent, values: PropertyValueUpdates): PropertyValueUpdates | Promise<PropertyValueUpdates>;

}

export function raiseAnvilEvent(self: JsComponent, eventName: string, eventArgs: { [arg: string]: any } = {}) {
    const pyKw: Kws = [];
    for (const [k, v] of Object.entries(eventArgs)) {
        pyKw.push(k, toPy(v));
    }
    return asyncToPromise(() => raiseEventOrSuspend(toPyComponent(self), new pyStr(eventName), pyKw));
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
        const eventArgs = kwargsToJsObject(kws) as EventArgs;
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

const createHooks = (jsSelf: JsComponent | JsContainer, spec: CustomComponentSpec): AnvilHooks => {
    const setPropertyValues = jsSelf._anvilSetPropertyValues ?? setPropertyValuesOneByOne;

    const hooks: AnvilHooks = {
        setupDom: () => {
            return maybeSuspend(jsSelf._anvilSetupDom());
        },
        get domElement() {
            return jsSelf._anvilDomElement;
        },
        updateDesignName(name) {
            return jsSelf._anvilUpdateDesignName?.(name);
        },
        setPropertyValues(updates) {
            return setPropertyValues.call(jsSelf, updates);
        },
        getDesignInfo(asLayout) {
            return (
                jsSelf._anvilGetDesignInfo?.({ asLayout }) ?? { propertyDescriptions: [], events: [], interactions: [] }
            );
        },
        getSections() {
            return jsSelf._anvilGetSections?.();
        },
        getSectionDomElement(id) {
            return jsSelf._anvilGetSectionDomElement?.(id);
        },
        setSectionPropertyValues(id, updates) {
            return maybeSuspend(jsSelf._anvilSetSectionPropertyValues?.(id, updates ?? {}));
        },
    };

    if (isContainer(jsSelf, spec.container)) {
        const containerHooks: Partial<AnvilHooks> = {
            getContainerDesignInfo(forChild) {
                return (
                    jsSelf._anvilGetContainerDesignInfo?.(asJsComponent(forChild)) ?? {
                        layoutPropertyDescriptions: [],
                    }
                );
            },
            updateLayoutProperties(forChild, newValues) {
                return maybeSuspend(jsSelf._anvilUpdateLayoutProperties?.(asJsComponent(forChild), newValues));
            },
            enableDropMode(dropping, flags) {
                if (dropping.pyLayoutProperties) {
                    // @ts-ignore
                    dropping.layoutProperties = toJs(dropping.pyLayoutProperties);
                }
                return jsSelf._anvilEnableDropMode?.(dropping, flags) ?? [];
            },
            disableDropMode() {
                return jsSelf._anvilDisableDropMode?.();
            },
        };
        Object.assign(hooks, containerHooks);
    }
    return hooks;
};

function pyComponentFromClass(cls: JsComponentConstructor, spec: CustomComponentSpec) {
    const { container, name } = spec;
    const descriptors = Object.entries(Object.getOwnPropertyDescriptors(cls.prototype));
    const getsets = descriptors.filter(([, descriptor]) => descriptor.get || descriptor.set);
    const methods = descriptors.filter(
        ([name, descriptor]) => !name.startsWith("_") && typeof descriptor.value === "function"
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
                self.anvil$hooks = createHooks(self[JS_COMPONENT], spec);
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
                        return returnToPy(descriptor.set?.call(this[JS_COMPONENT], toJs(val)));
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
                            return returnToPy(descriptor.value.apply(this[JS_COMPONENT], args.map(toJs)));
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
                              const layoutProperties = kwargsToJsObject(kws);
                              const jsContainer = this[JS_COMPONENT] as JsContainer;

                              const doAddComponent = async () => {
                                  const { onRemove, setVisibility } = await jsContainer._anvilAddComponent(
                                      asJsComponent(component),
                                      layoutProperties
                                  );
                                  // We could call super here
                                  // super().add_component(component, on_remove=toPy(onRemove), on_set_visibility=toPy(setVisibility));
                                  component.anvilComponent$setParent(this, {
                                      onRemove: () => maybeSuspend(onRemove()),
                                      setVisibility,
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
            [s_anvil_events.toString()]: toPy(cls._anvilEvents ?? []),
        },
    });

    initComponentSubclass(pyComponentCls);

    return pyComponentCls;
}

const cleanSpec = ({ name, properties, events, layoutProperties, container, showInToolbox }: CustomComponentSpec) => ({
    name,
    properties,
    events,
    layoutProperties,
    container,
    showInToolbox,
});

export function registerJsComponent(componentCls: JsComponentConstructor, spec: CustomComponentSpec) {
    const { name } = spec;
    const leafName = name.replace(/^.*\./, "");
    const cls = pyComponentFromClass(componentCls, spec);

    whenEnvironmentReady(() => {
        // // Try to import the parent package. Honestly this is a nicety
        // const pyPackage = component.name.replace(/\.[^.]+$/, "");
        // Sk.importModule(pyPackage, false, false);

        const pyMod = new pyModule();
        const pyName = new pyStr(name);
        pyMod.init$dict(pyName, pyNone);
        pyMod.$d[leafName] = cls;
        Sk.sysmodules.mp$ass_subscript(pyName, pyMod);
        jsCustomComponents[name] = { pyMod, spec: cleanSpec(spec) };
    });
}

export const registerToolboxSection = (section: ToolboxSection) => {
    customToolboxSections.push(section);
};
