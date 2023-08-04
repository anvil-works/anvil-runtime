/** @jsx React.createElement */

import {
    Component,
    ComponentConstructor, ComponentProperties,
    CustomComponentSpec,
    DropInfo,
    DroppingSpecification, DropZone,
    EventDescription,
    initComponentSubclass, Interaction, LayoutProperties,
    PropertyDescription, PropertyDescriptionBase,
    ToolboxItem,
    ToolboxSection,
} from "@runtime/components/Component";
import { Container } from "@runtime/components/Container";
import type { Kws } from "@Sk";
import {
    buildNativeClass,
    pyCallable,
    pyCallOrSuspend,
    pyDict,
    pyList,
    pyModule,
    pyNone,
    pyObject,
    pyStr,
    suspensionToPromise,
    toJs,
    toPy,
} from "@Sk";
import type * as ReactType from "react";
import type { createRoot as createRootType } from "react-dom/client";
import {designerApi, SectionUpdates} from "../../component-designer-api";
import {kwargsToJsObject, s_anvil_events, s_raise_event, s_slot} from "../../py-util";
import { customToolboxSections, jsCustomComponents, whenEnvironmentReady } from "../common";

// TODO:
//   React.render -> ReactDOM.render
//   React.h -> React.createElement
//   Make work with React (not just Preact)
//   The crazy component-div-substitution hack mucks up the order of elements (at least with Preact)
//   Enable other component updates in container drop
//   We should support creating drop zones on demand (we can *probably* do this with a synchronous render, but...ew?)
//   I'm sure registering drop zones should be more React-y / future-proof for async


function setRef<T>(ref: ReactRef<T> | undefined | null, value: T): void {
    if (typeof ref === "function") {
        ref(value);
    } else if (ref) {
        ref.current = value;
    }
}

type ReactRef<T> = ReactType.RefCallback<T> | ReactType.MutableRefObject<T> | null;


interface ReactComponentDefinition extends CustomComponentSpec {
    component: (props: ComponentProps, ref?: ReactType.ForwardedRef<any>) => ReactType.ReactElement | null; // React component
    autoDropZones?: boolean;
    autoDropZoneProps?: React.ComponentProps<any>;
}

interface ChildWithLayoutProperties {
    child: ReactType.ReactNode;
    childIdx: number;
    key: string;
    layoutProperties: LayoutProperties;
}

interface SectionSpec {
    id: string;
    title: string;
    sectionProperties: PropertyDescription[];
    sectionPropertyValues: ComponentProperties;
    setSectionPropertyValues: (updates: any) => void;
}

type InteractionSpec = (Interaction & {sectionId?: string}) | undefined | false | null;

type Section = SectionSpec & { element: HTMLElement };

interface ComponentProps {
    children?: ReactType.ReactNode;
    childrenWithoutDropZones: ReactType.ReactNode,
    childrenWithLayoutProperties?: ChildWithLayoutProperties[];
    properties: any;
    components?: any;
    childKeys: WeakMap<Component, string>;
}

interface ReactComponentWrapperConstructor extends ComponentConstructor {
    new (): ReactComponentWrapper;
}

let React: typeof ReactType;
let createRoot: typeof createRootType;
let flushSync: any;

const setReactImpl = (react: any, reactDomCreateRoot: any, reactDomFlushSync: any) => {
    React = react;
    createRoot = reactDomCreateRoot;
    flushSync = reactDomFlushSync;

    // The hooks won't work outside our context, so null is fine as default.
    HooksContext = React.createContext<AnvilReactHooks>(null as unknown as AnvilReactHooks);
    DropZoneContext = React.createContext<DropZoneContextType>(null as unknown as DropZoneContextType);
};

const ElementWrapper = ({ el }: { el: HTMLElement }) => {
    const ref = React.useRef<HTMLDivElement>(null!);

    React.useLayoutEffect(() => {
        ref.current.appendChild(el);
        return () => {
            el.remove();
        };
    }, [el]);

    return <div ref={ref} />;
};

interface ReactComponentWrapper extends Component {
    _ReactComponentWrapper: {
        reactComponent: ReactType.ReactElement;
        rootElement?: HTMLElement;
        reactRoot?: any;
        components: Component[];
        componentLayoutProps: WeakMap<Component, LayoutProperties>;
        forceRender?(): any;
        setDropping?(): any;
        dropping?: DroppingSpecification | null;
        ref?: any;
        actions: any;
        propertyInterface: any;
        dropZones: DropZone[];
        sections: Map<string, Section>;
        sectionInteractions: Map<string, Map<string, Interaction>>; // sectionId => interactionId => interactions
        interactions: Map<string, Interaction>;
        inlineEditInteractions: Map<string, Interaction>; // propName => interaction
        sectionInlineEditInteractions: Map<string, Map<string, Interaction>>; // sectionId => propName => interactions
        componentKeys: WeakMap<Component, number>;
        nextComponentKey: number;
        designName?: string;
        nextDesignerStateId: number;
    };
}

interface DropZoneSpec {
    element: HTMLElement;
    expandable?: boolean;
    dropInfo: DropInfo;
}

interface DropZoneContextType {
    dropping: DroppingSpecification | null | undefined;
    dropZones: DropZone[];
}

let DropZoneContext: ReactType.Context<DropZoneContextType>;

const DropZone = ({ minChildIdx=undefined, maxChildIdx=undefined, childIdx=undefined, layoutProperties=undefined, ...props }: React.ComponentProps<any>) => {
    const ctx = React.useContext(DropZoneContext);
    if (!ctx.dropping) return null;

    if (minChildIdx === undefined && maxChildIdx === undefined && childIdx !== undefined) {
        minChildIdx = maxChildIdx = childIdx;
    } else if (childIdx !== undefined && (minChildIdx !== undefined || maxChildIdx !== undefined)) {
        console.warn("DropZones only accept either childIdx or minChildIdx,maxChildIdx. Not both.")
    }

    const ref = (element: HTMLElement) => {
        // Callable ref can be called with a null element if it's somehow vanished from the DOM already.
        if (element) {
            ctx.dropZones.push({
                element,
                expandable: true,
                dropInfo: {minChildIdx, maxChildIdx, layout_properties: layoutProperties},
            });
        }
    };

    return <div ref={ref} {...props} />;
};

const mkComponentClass = ({
    name,
    component,
    properties,
    layoutProperties,
    events,
    container,
    autoDropZones = true,
    autoDropZoneProps,
}: ReactComponentDefinition) => {
    const cls: ReactComponentWrapperConstructor = buildNativeClass(name, {
        constructor: function ReactComponentWrapper() {},
        base: container ? Container : Component,
        getsets: {
            ...Object.fromEntries(
                properties?.map(({ name }) => [
                    name,
                    {
                        $get() {
                            return toPy(this._ReactComponentWrapper.propertyInterface[name]);
                        },
                        $set(v) {
                            //console.log("Property descriptor", name, "set to", v, "for", this);
                            this._ReactComponentWrapper.propertyInterface[name] = toJs(v);
                        },
                    },
                ]) || []
            ),
            __dict__: Sk.generic.getSetDict,
        },
        slots: {
            tp$new(args, kws) {
                const self: ReactComponentWrapper = (container ? Container : Component).prototype.tp$new.call(
                    this,
                    []
                ) as ReactComponentWrapper;

                self.$d = new pyDict();

                const pyRaiseEvent = self.tp$getattr<pyCallable>(s_raise_event);
                const actions: AnvilReactActions = {
                    raiseEvent(eventName: string, args: object = {}) {
                        const pyKw: Kws = [];
                        for (const [k, v] of Object.entries(args)) {
                            pyKw.push(k, toPy(v));
                        }
                        return suspensionToPromise(() => pyCallOrSuspend(pyRaiseEvent, [new pyStr(eventName)], pyKw));
                    },
                    setProperty(propName: string, value: any) {
                        if (designerApi.inDesigner) {
                            flushSync(() => {
                                _.propertyInterface[propName] = value; // Invoke setter, which will cause render
                            });
                            designerApi.updateComponentProperties(self, {[propName]: value}, {});

                            // TODO: Only do this if the sections have changed.
                            // When setSectionProperties is called from the IDE, if the value of the sections is what was asked for by setSectionProperties, don't do this update:
                            designerApi.updateComponentSections(self);

                        } else {
                            // Don't need the synchronous render in this case
                            _.propertyInterface[propName] = value; // Invoke setter, which will cause render
                        }
                    }
                };

                const propertyState = Object.fromEntries(
                    properties?.map(({ name, defaultValue }) => [name, defaultValue]) || []
                );

                const designerApiContext: AnvilReactDesignerApi = {
                    designName: null,
                };

                const hooksContext: AnvilReactHooks = {
                    useActions: () => actions,
                    useDesignerApi: () => ({...designerApiContext, designName: designerApi.getDesignName(self)}),
                    useInteraction: (maybeInteraction: InteractionSpec) => { // Maybe make second arg an object?
                        const id = React.useId()
                        if (maybeInteraction) {
                            const {sectionId, ...interaction} = maybeInteraction;
                            if (sectionId) {
                                _.sectionInteractions.has(sectionId) || _.sectionInteractions.set(sectionId, new Map<string, Interaction>());
                                _.sectionInteractions.get(sectionId)!.set(id, interaction);
                            } else {
                                console.log("Use Interaction", maybeInteraction);
                                _.interactions.set(id, interaction);
                            }
                        }
                    },
                    useInlineEditRef: (propName, otherRef?) => {
                        return (element: HTMLElement) => {
                            setRef(otherRef, element);

                            if (element) {
                                _.inlineEditInteractions.set(propName, {
                                    type: "whole_component",
                                    title: `Edit ${propName}`,
                                    icon: "edit",
                                    default: true,
                                    callbacks: {
                                        execute() {
                                            designerApi.startInlineEditing(
                                                self,
                                                {name: propName, type: "string"},
                                                element,
                                                {}
                                            );
                                        },
                                    },
                                });
                            }
                        };
                    },
                    useInlineEditSectionRef(sectionId, propName, otherRef?): any {
                        return (element: HTMLElement) => {
                            setRef(otherRef, element);

                            if (element) {
                                _.sectionInlineEditInteractions.has(sectionId) || _.sectionInlineEditInteractions.set(sectionId, new Map<string, Interaction>());
                                _.sectionInlineEditInteractions.get(sectionId)!.set(propName, {
                                    type: "whole_component",
                                    title: `Edit ${propName}`,
                                    icon: "edit",
                                    default: true,
                                    callbacks: {
                                        execute() {
                                            designerApi.startInlineEditing(
                                                self,
                                                {name: propName, type: "string"},
                                                element,
                                                {sectionId}
                                            );
                                        },
                                    },
                                });
                            }
                        }
                    },
                    useSectionRef: (section: SectionSpec, otherRef?: ReactRef<HTMLElement>) => (element: HTMLElement) => {
                        setRef(otherRef, element);
                        if (element) {
                            _.sections.set(section.id, {...section, element});
                        }
                    },
                    useComponentState: (initialState) => {
                        if (designerApi.inDesigner) {
                            const [_s, setS] = React.useState(initialState); // Just to force a render when designerState changes.
                            const id = `${_.nextDesignerStateId++}`;
                            const state = designerApi.getDesignerState(self);
                            let currentValue: any;
                            if (state.has(id)) {
                                currentValue = state.get(id);
                            } else {
                                state.set(id, initialState);
                                currentValue = initialState;
                            }
                            return [currentValue, (newStateOrFn: any) => {
                                const newState = typeof newStateOrFn === "function" ? newStateOrFn(state.get(id)) : newStateOrFn;
                                state.set(id, newState);
                                setS(newState); // Force re-render if necessary
                            }];
                        } else {
                            return React.useState<any>(initialState);
                        }
                    },
                }

                const WrappedComponent = React.forwardRef<any,  ComponentProps>((props, ref) => {
                    // Clear on every render
                    _.interactions.clear();
                    _.inlineEditInteractions.clear();
                    _.sections.clear();
                    _.sectionInlineEditInteractions.clear();
                    _.sectionInteractions.clear();
                    _.nextDesignerStateId = 0;

                    return component(props, ref);
                });
                const InnerComponent = () => {
                    const _ = self._ReactComponentWrapper;
                    _.forceRender = React.useReducer(() => ({}), {})[1];

                    _.dropZones = [];
                    const dropZoneContext = {
                        dropping: _.dropping,
                        dropZones: _.dropZones,
                    }

                    const children: any[] = [];
                    const childKeys: WeakMap<any, string> = new WeakMap();
                    const childrenWithLayoutProperties: ChildWithLayoutProperties[] = [];
                    if (autoDropZones) {
                        children.push(<DropZone key={"anvil-child-0-dz"} minChildIdx={0} maxChildIdx={0} {...autoDropZoneProps} />);
                    }
                    const childrenWithoutDropZones: any[] = [];
                    let i = 0;
                    for (const c of _.components) {
                        let child;
                        const key = `anvil-child-${_.componentKeys.get(c)}`;
                        if (c._ReactComponentWrapper) {
                            child = <React.Fragment key={key}>
                                    {c._ReactComponentWrapper.reactComponent}
                                </React.Fragment>;
                        } else {
                            // TODO: We could probably even do without this ElementWrapper, by directly inserting the child domElement into
                            //      the right position inside this one in a useLayoutEffect. This will be hard, and may not be worth it.
                            child = <ElementWrapper key={key} el={c.anvil$hooks.domElement!} />;
                        }
                        children.push(child);
                        childrenWithoutDropZones.push(child);
                        childrenWithLayoutProperties.push({
                            child,
                            layoutProperties: _.componentLayoutProps.get(c)!,
                            childIdx: i,
                            key,
                        })
                        childKeys.set(child, key);
                        if (autoDropZones) {
                            children.push(<DropZone key={`${key}-dz`} minChildIdx={i+1} maxChildIdx={i+1} {...autoDropZoneProps} />);
                        }
                        i++;
                    }

                    const props: ComponentProps = {
                        children,
                        // TODO: This only passes non-undefined properties. Decide whether this is right.
                        properties: Object.fromEntries(Object.entries(_.propertyInterface).filter(([k, v]) => v !== undefined)),
                        childrenWithLayoutProperties,
                        childrenWithoutDropZones,
                        childKeys,
                    };

                    if (container) {
                        props.components = _.components;
                    }

                    _.ref = React.useRef();

                    React.useEffect(() => {
                        designerApi.inDesigner && designerApi.notifyDomNodeChanged(self);
                    }, [_.ref.current]);

                    console.group("Render", name, self.anvil$designerPath);

                    const c = <HooksContext.Provider value={hooksContext}>
                        <DropZoneContext.Provider value={dropZoneContext}>
                            <WrappedComponent ref={_.ref} {...props} />
                        </DropZoneContext.Provider>
                    </HooksContext.Provider>;
                    console.log("Rendered", self.anvil$designerPath, c, _);
                    console.groupEnd();
                    return c;
                };
                self._ReactComponentWrapper = {
                    reactComponent: <InnerComponent />,
                    components: [],
                    componentLayoutProps: new WeakMap<Component, LayoutProperties>(),
                    actions,
                    propertyInterface: new Proxy(propertyState, {
                        set(target, p, v) {
                            target[p as keyof typeof propertyState] = v;
                            self._ReactComponentWrapper.forceRender?.();
                            return true;
                        },
                    }),
                    dropZones: [],
                    sections: new Map(),
                    sectionInteractions: new Map(),
                    interactions: new Map(),
                    inlineEditInteractions: new Map(),
                    sectionInlineEditInteractions: new Map(),
                    nextComponentKey: 0,
                    componentKeys: new WeakMap(),
                    nextDesignerStateId: 0,
                };

                const _ = self._ReactComponentWrapper;

                self.anvil$hooks = {
                    setupDom: () => {
                        if (!_.rootElement) {
                            _.rootElement = document.createElement("div");
                            _.reactRoot = createRoot(_.rootElement);
                            console.log("Creating react root for component", self, _.rootElement);
                            flushSync(() => {
                                _.reactRoot.render(_.reactComponent);
                            });
                            designerApi.inDesigner && designerApi.notifyDomNodeChanged(self);
                        }
                        return _.rootElement;
                    },
                    get domElement() {
                        return _.rootElement || _.ref?.current;
                    },
                    getDesignInfo() {
                        // console.log("GDI for", self.anvil$designerPath, _);
                        return {
                            propertyDescriptions: (properties || []).map((description) => ({ ...description })),
                            events: (events || []).reduce((es, e) => {
                                es[e.name] = e;
                                return es;
                            }, {} as { [propName: string]: EventDescription }),
                            interactions: [
                                ..._.interactions.values(),
                                ..._.inlineEditInteractions.values(),
                            ],
                        };
                    },
                    enableDropMode: (dropping) => {
                        if (!container) {
                            return [];
                        }

                        flushSync(() => {
                            _.dropping = dropping;
                            _.forceRender?.();
                        });

                        const dropLayoutProps = toJs(dropping.pyLayoutProperties);

                        return _.dropZones.filter(({dropInfo}) => {
                            if (dropLayoutProps) {
                                for (const [k, v] of Object.entries(dropLayoutProps)) {
                                    if (dropInfo.layout_properties?.[k] !== v) {
                                        return false;
                                    }
                                }
                            }
                            return true;
                        });
                    },
                    disableDropMode: () => {
                        _.dropping = null;
                        _.forceRender?.();
                    },
                    getSections() {
                        return Array.from(_.sections.values(), ({
                            id,
                            sectionProperties,
                            sectionPropertyValues,
                            setSectionPropertyValues,
                            ...section
                        }) => ({
                            id,
                            ...section,
                            propertyDescriptions: sectionProperties,
                            propertyValues: sectionPropertyValues,
                            interactions: [
                                ..._.sectionInteractions.get(id)?.values() || [],
                                ..._.sectionInlineEditInteractions.get(id)?.values() || []],
                        }));
                    },
                    getSectionDomElement(id: string) {
                        return _.sections.get(id)!.element;
                    },
                    setSectionPropertyValues(id: string, updates: { [p: string]: any } | null) {
                        const section = _.sections.get(id)!;
                        section.setSectionPropertyValues(updates);
                    },
                    updateDesignName(name: string) {
                        _.designName = name;
                        _.forceRender?.();
                    }
                };

                if (container) {
                    self.anvil$hooks.getContainerDesignInfo = forChild => ({
                        layoutPropertyDescriptions: layoutProperties || [],
                    })
                }

                if (kws) {
                    for (let i = 0; i < kws.length; i += 2) {
                        const k = kws[i];
                        const v = kws[i + 1] as pyObject;
                        if (k !== "__ignore_property_exceptions") {
                            self.tp$setattr(new pyStr(k), v);
                        }
                    }
                }
                // TODO: The old implementation has a page show event handler here. Why?
                return self;
            },
        },
        methods: container
            ? {
                  add_component: {
                      $meth([pyComponent]: [ReactComponentWrapper | Component], kws: Kws) {
                          const _ = this._ReactComponentWrapper;
                          _.componentKeys.set(pyComponent, _.componentKeys.get(pyComponent) || _.nextComponentKey++);
                          const layoutProperties = kwargsToJsObject(kws);
                          if ('index' in layoutProperties) {
                              _.components.splice(layoutProperties.index, 0, pyComponent);
                          } else {
                              _.components.push(pyComponent);
                          }
                          _.componentLayoutProps.set(pyComponent, layoutProperties);
                          _.forceRender?.();
                          pyComponent.anvilComponent$setParent(this, {onRemove: () => {
                              _.components = _.components.filter((c) => c !== pyComponent);
                              _.forceRender?.();
                          }});
                          return pyNone;
                      },
                      $flags: { FastCall: true },
                  },
                  get_components: {
                      $meth() {
                          return new pyList(this._ReactComponentWrapper.components);
                      },
                      $flags: { NoArgs: true },
                  },
              }
            : {},
        flags: { sk$klass: true },
    });
    cls.tp$setattr(s_anvil_events, toPy(events || []));
    initComponentSubclass(cls);
    return cls;
};

const reactComponentToSpec = ({name, properties, events, layoutProperties, container, showInToolbox}: ReactComponentDefinition) =>
    ({name, properties, events, layoutProperties, container, showInToolbox});

export const registerReactComponent = (component: ReactComponentDefinition) => {
    const leafName = component.name.replace(/^.*\./, "");
    const cls = mkComponentClass(component);

    whenEnvironmentReady(() => {
        // // Try to import the parent package. Honestly this is a nicety
        // const pyPackage = component.name.replace(/\.[^.]+$/, "");
        // Sk.importModule(pyPackage, false, false);

        const pyMod = new pyModule();
        const pyName = new pyStr(component.name);
        pyMod.init$dict(pyName, pyNone);
        pyMod.$d[leafName] = cls;
        Sk.sysmodules.mp$ass_subscript(pyName, pyMod);
        jsCustomComponents[component.name] = {pyMod, spec: reactComponentToSpec(component)};
    });
};

export const registerToolboxSection = (section: ToolboxSection) => {
    customToolboxSections.push(section);
};

export const getReactComponents = (React: any, Hooks?: any) => {

    type Ref = any;

    const useComponentsRef = (
        existingRef: Ref | null,
        components: Component[],
        dropState?: any,
        wrapComponent?: any,
        createDropzoneElement?: any
    ) => {
        const ref = existingRef || Hooks.useRef(null);

        Hooks.useLayoutEffect(() => {
            let i = 0;
            for (const { component } of components) {
                if (dropState) {
                    const element = createDropzoneElement?.() || document.createElement("div");
                    dropState.registerDropElement(i, { element, dropInfo: { childIdx: i++ } });
                    ref.current.appendChild(element);
                }
                // TODO: Page events?
                ref.current.appendChild(
                    wrapComponent?.(component.anvil$hooks.domElement!) || component.anvil$hooks.domElement!
                );
            }
            if (dropState) {
                const element = createDropzoneElement?.() || document.createElement("div");
                dropState.registerDropElement(i, { element, dropInfo: { childIdx: i } });
                ref.current.appendChild(element);
            }
            return () => {
                ref.current.replaceChildren();
            };
        }, [dropState, components, components?.length]);

        return ref;
    };

    const useComponentSlots = (components: any, slotPropName: string, slotNames: string[], dropState?: any) => {
        const slots: any = {};
        for (const s of slotNames) {
            slots[s] = { ref: Hooks.useRef(null), hasComponents: false };
        }

        for (const { layoutProperties } of components) {
            slots[layoutProperties[slotPropName]].hasComponents = true;
        }

        Hooks.useLayoutEffect(() => {
            let i = 0;
            for (const { component, layoutProperties } of components) {
                const slot = layoutProperties[slotPropName];
                if (dropState) {
                    const element = document.createElement("div");
                    dropState.registerDropElement(i, {
                        element,
                        dropInfo: { childIdx: i++, layout_properties: { [slotPropName]: slot } },
                    });
                    slots[slot].ref.current.appendChild(element);
                }
                slots[slot].ref.current.appendChild(component.anvil$hooks.domElement);
            }
            if (dropState) {
                for (const s of slotNames) {
                    const element = document.createElement("div");
                    dropState.registerDropElement(i, {
                        element,
                        dropInfo: { childIdx: i++, layout_properties: { [slotPropName]: s } },
                    });
                    slots[s].ref.current.appendChild(element);
                }
            }
            return () => {
                for (const s of slotNames) {
                    slots[s].ref.current?.replaceChildren();
                }
            };
        }, [dropState, components, components?.length]);

        return slots;
    };

    return { useComponentsRef, useComponentSlots };
};

interface AnvilReactDesignerApi {
    designName: string | null;
}
interface AnvilReactActions {
    raiseEvent(eventName: string, args: object): void;
    setProperty(propName: string, value: any): void;
}
interface AnvilReactHooks {
    useActions(): AnvilReactActions;
    useComponentState<T>(initialState?: T): [T, (newState: T | ((oldState: T) => T)) => void];
    useDesignerApi(): AnvilReactDesignerApi;
    useInteraction(interaction: Interaction, sectionId?: string): void;
    useInlineEditRef(propName: string, otherRef?: ReactRef<HTMLElement>): any;
    useInlineEditSectionRef(sectionId: string, propName: string, otherRef?: ReactRef<HTMLElement>): any;
    useSectionRef(sectionSpec: SectionSpec, otherRef?: ReactRef<HTMLElement>): void;
}

let HooksContext: ReactType.Context<AnvilReactHooks>;

export const _react : {hooks: AnvilReactHooks, [k:string]: any} = {
    //@ts-ignore
    inDesigner: !!window.anvilInDesigner,
    DropZone,
    hooks: {
        useActions: () => React.useContext(HooksContext).useActions(),
        useDesignerApi: () => React.useContext(HooksContext).useDesignerApi(),
        useComponentState: (...args) => React.useContext(HooksContext).useComponentState(...args),
        useInteraction: (...args) => React.useContext(HooksContext).useInteraction(...args),
        useInlineEditRef: (...args) => React.useContext(HooksContext).useInlineEditRef(...args),
        useInlineEditSectionRef: (...args) => React.useContext(HooksContext).useInlineEditSectionRef(...args),
        useSectionRef: (...args) => React.useContext(HooksContext).useSectionRef(...args),
    },
    registerReactComponent,
    registerToolboxSection,
    setReactImpl,
};
