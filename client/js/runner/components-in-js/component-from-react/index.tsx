/** @jsx React.createElement */

import {
    Component,
    ComponentConstructor, ComponentProperties,
    DropInfo,
    DroppingSpecification, DropZone,
    EventDescription,
    initComponentSubclass, Interaction, LayoutProperties,
    PropertyDescription, PropertyDescriptionBase,
    ToolboxItem,
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
import {designerApi, DesignerState, SectionUpdates} from "../../component-designer-api";
import {s_anvil_events, s_raise_event, s_slot} from "../../py-util";
import { customToolboxItems, jsComponentModules, whenEnvironmentReady } from "../common";
import { kwargsToJsObject } from "@runtime/runner/instantiation";

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

interface ComponentSpec {
    name: string;
    properties?: (PropertyDescription & { defaultValue: any })[];
    layoutProperties?: PropertyDescriptionBase[];
    events?: EventDescription[];
    component: (props: ComponentProps, ref?: ReactType.ForwardedRef<any>) => ReactType.ReactElement | null; // React component
    container?: boolean;
    autoDropZones?: boolean;
    autoDropZoneProps?: React.ComponentProps<any>;
}

interface ChildWithLayoutProperties {
    child: ReactType.ReactNode;
    childIdx: number;
    layoutProperties: LayoutProperties;
}

interface SectionSpec {
    id: string;
    title: string;
    sectionProperties: PropertyDescription[];
    sectionPropertyValues: ComponentProperties;
    setSectionPropertyValues: (sectionId: string, updates: any) => void;
    interactions: Interaction[];
}

type Section = SectionSpec & { element: HTMLElement };

interface ComponentDesignerApi {
    inDesigner: boolean;
    useInteraction(interaction: Interaction): void;
    useInlineEdit(propName: string, otherRef?: ReactRef<HTMLElement>): any;
    useInlineEditSection(sectionId: string, propName: string, otherRef?: ReactRef<HTMLElement>): any;
    useSectionRef: (sectionSpec: SectionSpec, otherRef?: ReactRef<HTMLElement>) => void;
    updateProperties: (updates: any, sectionUpdates?: SectionUpdates) => void; // TODO: sectionUpdates, once I've worked out what they are...
    designerState: DesignerState;
    componentName?: string;
}

interface ComponentProps {
    children?: ReactType.ReactNode;
    childrenWithoutDropZones: ReactType.ReactNode,
    childrenWithLayoutProperties?: ChildWithLayoutProperties[];
    properties: any;
    actions: any;
    designerApi: ComponentDesignerApi;
    components?: any;
    dropInfo: {
        dropping: boolean;
        DropZone: ReactType.FC;
    };
    childKeys: WeakMap<Component, string>;
}

interface ReactComponentWrapperConstructor extends ComponentConstructor {
    new (): ReactComponentWrapper;
}

let React: typeof ReactType;
let createRoot: typeof createRootType;
let flushSync: any;

export const setReactImpl = (react: any, reactDomCreateRoot: any, reactDomFlushSync: any) => {
    React = react;
    createRoot = reactDomCreateRoot;
    flushSync = reactDomFlushSync;
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
        interactions: Interaction[];
        inlineEditInteractions: Map<string, Interaction>; // propName => interaction
        sectionInlineEditInteractions: Map<string, Map<string, Interaction>>; // sectionId => propName => interactions
        componentKeys: WeakMap<Component, number>;
        nextComponentKey: number;
        designName?: string;
    };
}

interface DropZoneSpec {
    element: HTMLElement;
    expandable?: boolean;
    dropInfo: DropInfo;
}

const mkComponentClass = ({
    name,
    component,
    properties,
    layoutProperties,
    events,
    container,
    autoDropZones = true,
    autoDropZoneProps,
}: ComponentSpec) => {
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
                const actions = {
                    raiseEvent(eventName: string, args: object = {}) {
                        const pyKw: Kws = [];
                        for (const [k, v] of Object.entries(args)) {
                            pyKw.push(k, toPy(v));
                        }
                        return suspensionToPromise(() => pyCallOrSuspend(pyRaiseEvent, [new pyStr(eventName)], pyKw));
                    },
                    setProperty(propName: string, value: any) {
                        // This is experimental: Is this a good API? Should it be unified with designerApi.updateProperties()?
                        self._ReactComponentWrapper.propertyInterface[propName] = value;
                    }
                };

                const propertyState = Object.fromEntries(
                    properties?.map(({ name, defaultValue }) => [name, defaultValue]) || []
                );

                const exposedDesignerApi: ComponentDesignerApi = {
                    inDesigner: designerApi.inDesigner,
                    useInteraction: (interaction: Interaction) => {
                        _.interactions.push(interaction);
                    },
                    useInlineEdit: (propName, otherRef?) => {
                        return (element: HTMLElement) => {
                            setRef(otherRef, element);

                            if (element) {
                                _.inlineEditInteractions.set(propName, {
                                    type: "whole_component",
                                    name: `Edit ${propName}`,
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
                    useInlineEditSection(sectionId, propName, otherRef?): any {
                        return (element: HTMLElement) => {
                            setRef(otherRef, element);

                            if (element) {
                                _.sectionInlineEditInteractions.has(sectionId) || _.sectionInlineEditInteractions.set(sectionId, new Map<string, Interaction>());
                                _.sectionInlineEditInteractions.get(sectionId)!.set(propName, {
                                    type: "whole_component",
                                    name: `Edit ${propName}`,
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
                    updateProperties(updates, sectionUpdates) {
                        for (const [name, newValue] of Object.entries(updates || {})) {
                            _.propertyInterface[name] = newValue; // Invoke setter, which will cause render
                        }
                        designerApi.updateComponentProperties(self, updates, {}, sectionUpdates);
                    },
                    designerState: designerApi.inDesigner ? designerApi.getDesignerState(self) : {},
                    // TODO: More things.
                };

                const addDropZone = (dz: DropZoneSpec) => {
                    _.dropZones.push(dz);
                };

                const DropZone = ({ minChildIdx=undefined, maxChildIdx=undefined, layoutProperties=undefined, ...props }: React.ComponentProps<any>) => {
                    if (!_.dropping) return null;

                    const ref = (element: HTMLElement) => {
                        // Callable ref can be called with a null element if it's somehow vanished from the DOM already.
                        if (element) {
                            addDropZone({
                                element,
                                expandable: true,
                                dropInfo: {minChildIdx, maxChildIdx, layout_properties: layoutProperties},
                            });
                        }
                    };

                    return <div ref={ref} {...props} />;
                };

                const WrappedComponent = React.forwardRef(component);
                const InnerComponent = () => {
                    const _ = self._ReactComponentWrapper;
                    _.forceRender = React.useReducer(() => ({}), {})[1];

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
                        })
                        childKeys.set(child, key);
                        if (autoDropZones) {
                            children.push(<DropZone key={`${key}-dz`} minChildIdx={i+1} maxChildIdx={i+1} {...autoDropZoneProps} />);
                        }
                        i++;
                    }

                    // Clear on every render
                    _.dropZones = [];
                    _.interactions = [];
                    _.inlineEditInteractions.clear();
                    _.sections.clear();
                    _.sectionInlineEditInteractions.clear();

                    const props: ComponentProps = {
                        children,
                        // TODO: This only passes non-undefined properties. Decide whether this is right.
                        properties: Object.fromEntries(Object.entries(_.propertyInterface).filter(([k, v]) => v !== undefined)),
                        actions,
                        designerApi: {...exposedDesignerApi, componentName: _.designName},
                        dropInfo: { dropping: !!_.dropping, DropZone },
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

                    console.log("Render", name);

                    return <WrappedComponent ref={_.ref} {...props} />;
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
                    sections: new Map<string, Section>(),
                    interactions: [],
                    inlineEditInteractions: new Map<string, Interaction>(),
                    sectionInlineEditInteractions: new Map<string, Map<string, Interaction>>(),
                    nextComponentKey: 0,
                    componentKeys: new WeakMap(),
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
                    setDataBindingListener: (fn) => {}, // TODO: This.
                    getDesignInfo() {
                        return {
                            propertyDescriptions: (properties || []).map((description) => ({ ...description })),
                            events: (events || []).reduce((es, e) => {
                                es[e.name] = e;
                                return es;
                            }, {} as { [propName: string]: EventDescription }),
                            interactions: [
                                ..._.interactions,
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
                            sectionProperties,
                            sectionPropertyValues,
                            setSectionPropertyValues,
                            interactions,
                            ...section
                        }) => ({
                            ...section,
                            propertyDescriptions: sectionProperties,
                            propertyValues: sectionPropertyValues,
                            interactions: [
                                ...interactions || [],
                                ..._.sectionInlineEditInteractions.get(section.id)?.values() || []],
                        }));
                    },
                    getSectionDomElement(id: string) {
                        return _.sections.get(id)!.element;
                    },
                    setSectionPropertyValues(id: string, updates: { [p: string]: any } | null) {
                        const section = _.sections.get(id)!;
                        section.setSectionPropertyValues(id, updates);
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
                          pyComponent.anvilComponent$setParent(this, () => {
                              _.components = _.components.filter((c) => c !== pyComponent);
                              _.forceRender?.();
                          });
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

export const registerReactComponent = (component: ComponentSpec) => {
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
        jsComponentModules[component.name] = pyMod;
    });
};

export const registerToolboxItem = (item: ToolboxItem) => {
    customToolboxItems.push(item);
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
