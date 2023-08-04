/** @jsx React.createElement */
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import type {
    ComponentProperties,
    ContainerDesignInfo,
    CustomComponentSpec,
    DropZone as DZ,
    DropInfo,
    DroppingSpecification,
    EventDescription,
    Interaction,
    LayoutProperties,
    PropertyDescription,
} from "@runtime/components/Component";
import type { JsComponentAPI } from "../../../public-api";
import type { JsComponent, JsComponentConstructor, JsContainer } from "../../../public-api/component";

import type { DropModeFlags } from "@runtime/runner/python-objects";

// @ts-ignore
const { _jsComponentApi } = window.anvil;
const { designerApi, raiseAnvilEvent, registerJsComponent, registerToolboxSection, subscribeAnvilEvent } = _jsComponentApi as JsComponentAPI;

export const { openForm } = _jsComponentApi as JsComponentAPI;

export interface ComponentProps {
    children?: React.ReactNode;
    childrenWithoutDropZones: React.ReactNode;
    childrenWithLayoutProperties?: ChildWithLayoutProperties[];
    properties: any;
    components?: any;
    childKeys: WeakMap<JsComponent, string>;
}

export interface ReactComponentDefinition extends CustomComponentSpec {
    component: (props: ComponentProps, ref?: React.ForwardedRef<any>) => React.ReactElement | null; // React component
    autoDropZones?: boolean;
    autoDropZoneProps?: React.ComponentProps<any>;
}
export interface ChildWithLayoutProperties {
    child: React.ReactNode;
    childIdx: number;
    key: string;
    layoutProperties: LayoutProperties;
}

export interface SectionSpec {
    id: string;
    title: string;
    sectionProperties: PropertyDescription[];
    sectionPropertyValues: ComponentProperties;
    setSectionPropertyValues: (updates: any) => void;
    inlineEditProps?: string[];
    inlineEditRoot?: string;
}

export interface SectionRefs {
    [sectionId: string]: {
        ref: ReactRef<any>;
        inlineEditRefs: {
            [propName: string]: ReactRef<any>;
        }
    }
}

export type InteractionSpec = (Interaction & { sectionId?: string }) | undefined | false | null;

export type Section = SectionSpec & { element: HTMLElement };

const HooksContext = React.createContext<AnvilReactHooks>(null as unknown as AnvilReactHooks);
const DropZoneContext = React.createContext<DropZoneContextType>(null as unknown as DropZoneContextType);

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

export interface ReactComponentWrapper {
    reactComponent: React.ReactNode;
    rootElement?: HTMLElement;
    reactRoot?: any;
    components: JsComponent[];
    componentLayoutProps: WeakMap<JsComponent, LayoutProperties>;
    forceRender?(): any;
    setDropping?(): any;
    dropping?: DroppingSpecification | null;
    ref?: any;
    actions: any;
    propertyInterface: any;
    dropZones: DZ[];
    sections: Map<string, Section>;
    sectionInteractions: Map<string, Map<string, Interaction>>; // sectionId => interactionId => interactions
    interactions: Map<string, Interaction>;
    inlineEditInteractions: Map<string, Interaction>; // propName => interaction
    sectionInlineEditInteractions: Map<string, Map<string, Interaction>>; // sectionId => propName => interactions
    componentKeys: WeakMap<JsComponent, number>;
    nextComponentKey: number;
    designName?: string;
    nextDesignerStateId: number;
}

export interface DropZoneSpec {
    element: HTMLElement;
    expandable?: boolean;
    dropInfo: DropInfo;
}

export interface DropZoneContextType {
    dropping: DroppingSpecification | null | undefined;
    dropZones: DZ[];
}

export const DropZone = ({
    minChildIdx = undefined,
    maxChildIdx = undefined,
    childIdx = undefined,
    layoutProperties = undefined,
    ...props
}: React.ComponentProps<any>) => {
    const ctx = React.useContext(DropZoneContext);
    if (!ctx.dropping) return null;

    if (minChildIdx === undefined && maxChildIdx === undefined && childIdx !== undefined) {
        minChildIdx = maxChildIdx = childIdx;
    } else if (childIdx !== undefined && (minChildIdx !== undefined || maxChildIdx !== undefined)) {
        console.warn("DropZones only accept either childIdx or minChildIdx,maxChildIdx. Not both.");
    }

    const ref = (element: HTMLElement) => {
        // Callable ref can be called with a null element if it's somehow vanished from the DOM already.
        if (element) {
            ctx.dropZones.push({
                element,
                expandable: true,
                dropInfo: { minChildIdx, maxChildIdx, layout_properties: layoutProperties },
            });
        }
    };

    return <div ref={ref} {...props} />;
};

const IS_REACT = Symbol();

interface ReactComponent extends JsComponent {
    _: ReactComponentWrapper;
    [IS_REACT]: boolean;
}

interface ReactContainer extends JsContainer, ReactComponent {
    _: ReactComponentWrapper;
}

type ReactRef<T> = React.RefCallback<T> | React.MutableRefObject<T> | null;

function setRef<T>(ref: ReactRef<T> | undefined | null, value: T): void {
    if (typeof ref === "function") {
        ref(value);
    } else if (ref) {
        ref.current = value;
    }
}

const isReactComponent = (obj: any): obj is ReactComponent => !!obj[IS_REACT];

function setupReactComponent(self: ReactComponent, spec: ReactComponentDefinition) {
    const {
        name,
        component,
        properties,
        layoutProperties,
        events,
        container,
        autoDropZones = true,
        autoDropZoneProps,
    } = spec;

    const actions: AnvilReactActions = {
        raiseEvent(eventName: string, args: object = {}) {
            raiseAnvilEvent(self, eventName, args);
        },
        setProperty(propName: string, value: any) {
            if (designerApi.inDesigner) {
                flushSync(() => {
                    _.propertyInterface[propName] = value; // Invoke setter, which will cause render
                });
                designerApi.updateComponentProperties(self, { [propName]: value }, {});

                // TODO: Only do this if the sections have changed.
                // When setSectionProperties is called from the IDE, if the value of the sections is what was asked for by setSectionProperties, don't do this update:
                designerApi.updateComponentSections(self);
            } else {
                // Don't need the synchronous render in this case
                _.propertyInterface[propName] = value; // Invoke setter, which will cause render
            }
        }
    };

    const propertyState = Object.fromEntries(properties?.map(({ name, defaultValue }) => [name, defaultValue]) || []);

    const designerApiContext: AnvilReactDesignerApi = {
        inDesigner: designerApi.inDesigner,
        updateProperties(updates) {
            flushSync(() => {
                for (const [name, newValue] of Object.entries(updates || {})) {
                    _.propertyInterface[name] = newValue; // Invoke setter, which will cause render
                }
            });
            designerApi.updateComponentProperties(self, updates, {});

            // TODO: Only do this if the sections have changed.
            // When setSectionProperties is called from the IDE, if the value of the sections is what was asked for by setSectionProperties, don't do this update:
            designerApi.updateComponentSections(self);
        },
        designName: null,
        startEditingForm(form: string) {
            designerApi.startEditingForm(self, form);
        }
    };

    const hooksContext: AnvilReactHooks = {
        useActions: () => actions,
        useDesignerApi: () => ({ ...designerApiContext, designName: designerApi.getDesignName(self) }),
        useInteraction: (maybeInteraction: InteractionSpec) => {
            // Maybe make second arg an object?
            const id = React.useId();
            if (maybeInteraction) {
                const { sectionId, ...interaction } = maybeInteraction;
                if (sectionId) {
                    _.sectionInteractions.has(sectionId) ||
                        _.sectionInteractions.set(sectionId, new Map<string, Interaction>());
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
                                designerApi.startInlineEditing(self, { name: propName, type: "string" }, element, {});
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
                    addSectionInlineEditInteraction(sectionId, propName, element);
                }
            };
        },
        useSectionRef: (section: SectionSpec, otherRef?: ReactRef<HTMLElement>) => (element: HTMLElement) => {
            setRef(otherRef, element);
            if (element) {
                _.sections.set(section.id, { ...section, element });
            }
        },
        useSectionRefs: (sections: SectionSpec[]) => {
            const sectionRefs:SectionRefs = {};
            for (const section of sections) {
                sectionRefs[section.id] = {
                    ref: (element: HTMLElement) => {
                        if (element) {
                            _.sections.set(section.id, { ...section, element });
                            if (section.inlineEditRoot) {
                                addSectionInlineEditInteraction(section.id, section.inlineEditRoot, element);
                            }
                        }
                    },
                    inlineEditRefs: Object.fromEntries(section.inlineEditProps?.map((propName) => [
                        propName,
                        (element: HTMLElement) => {
                            if (element) {
                                addSectionInlineEditInteraction(section.id, propName, element);
                            }
                        }
                    ]) || []),
                }
            }
            return sectionRefs;
        },
        useComponentState: (initialState) => {
            // TODO
            return React.useState<any>(initialState);
        },
        useDesignerInteractionRef: (event: "dblclick", callback: () => void, otherRef?: ReactRef<HTMLElement>) => (element: HTMLElement) => {
            setRef(otherRef, element);
            if (element) {
                designerApi.registerInteraction(self, {event, callback, element});
            }
        }
    };

    const WrappedComponent = React.forwardRef<any, ComponentProps>((props, ref) => {
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
        const _ = _ReactComponentWrapper;
        _.forceRender = React.useReducer(() => ({}), {})[1];

        _.dropZones = [];
        const dropZoneContext = {
            dropping: _.dropping,
            dropZones: _.dropZones,
        };

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
            // TODO - how do we determine this now since we give you a WrappedComponent
            if (isReactComponent(c)) {
                child = <React.Fragment key={key}>{c._.reactComponent}</React.Fragment>;
            } else {
                // TODO: We could probably even do without this ElementWrapper, by directly inserting the child domElement into
                //      the right position inside this one in a useLayoutEffect. This will be hard, and may not be worth it.
                child = <ElementWrapper key={key} el={c._anvilDomElement!} />;
            }
            children.push(child);
            childrenWithoutDropZones.push(child);
            childrenWithLayoutProperties.push({
                child,
                layoutProperties: _.componentLayoutProps.get(c)!,
                childIdx: i,
                key,
            });
            childKeys.set(child, key);
            if (autoDropZones) {
                children.push(
                    <DropZone key={`${key}-dz`} minChildIdx={i + 1} maxChildIdx={i + 1} {...autoDropZoneProps} />
                );
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

        // console.group("Render", name, self.anvil$designerPath);

        const c = (
            <HooksContext.Provider value={hooksContext}>
                <DropZoneContext.Provider value={dropZoneContext}>
                    <WrappedComponent ref={_.ref} {...props} />
                </DropZoneContext.Provider>
            </HooksContext.Provider>
        );
        // console.log("Rendered", self.anvil$designerPath, c, _);
        // console.groupEnd();
        return c;
    };

    const _ReactComponentWrapper: ReactComponentWrapper = {
        rootElement: undefined,
        reactComponent: <InnerComponent />,
        components: [],
        componentLayoutProps: new WeakMap<JsComponent, LayoutProperties>(),
        actions,
        propertyInterface: new Proxy(propertyState, {
            set(target, p, v) {
                target[p as keyof typeof propertyState] = v;
                _ReactComponentWrapper.forceRender?.();
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

    const _ = _ReactComponentWrapper;

    const addSectionInlineEditInteraction = (sectionId: string, propName: string, element: HTMLElement) => {
        if (!_.sectionInlineEditInteractions.has(sectionId)) {
            _.sectionInlineEditInteractions.set(sectionId, new Map<string, Interaction>());
        }
        _.sectionInlineEditInteractions.get(sectionId)!.set(propName, {
            type: "whole_component",
            title: `Edit ${propName}`,
            icon: "edit",
            default: true,
            callbacks: {
                execute() {
                    designerApi.startInlineEditing(self, { name: propName, type: "string" }, element, {
                        sectionId,
                    });
                },
            },
        });
    }

    return _;
}

function mkComponentClass(spec: ReactComponentDefinition): JsComponentConstructor {
    const { properties, events, container, layoutProperties } = spec;
    class ReactComponent_ implements ReactComponent {
        _: ReactComponentWrapper;
        [IS_REACT] = true;
        constructor() {
            this._ = setupReactComponent(this, spec);
        }
        _anvilSetupDom(): HTMLElement | Promise<HTMLElement> {
            const _ = this._;
            if (!_.rootElement) {
                _.rootElement = document.createElement("div");
                _.reactRoot = createRoot(_.rootElement);
                console.log("Creating react root for component", this, _.rootElement);
                flushSync(() => {
                    _.reactRoot.render(_.reactComponent);
                });
                designerApi.inDesigner && designerApi.notifyDomNodeChanged(this);
            }
            return _.rootElement;
        }
        get _anvilDomElement(): HTMLElement | undefined {
            return this._.rootElement || this._.ref?.current;
        }
        _anvilGetDesignInfo() {
            return {
                propertyDescriptions: (properties || []).map((description) => ({ ...description })),
                events: (events || []).reduce((es, e) => {
                    es[e.name] = e;
                    return es;
                }, {} as { [propName: string]: EventDescription }),
                interactions: [...this._.interactions.values(), ...this._.inlineEditInteractions.values()],
            };
        }
        _anvilUpdateDesignName(name: string): void {
            this._.designName = name;
            this._.forceRender?.();
        }
        static _anvilEvents = events ?? [];
    }

    if (!container) return ReactComponent_;

    class ReactContainer extends ReactComponent_ implements JsContainer {
        async _anvilAddComponent(
            component: JsComponent,
            layoutProperties: { [prop: string]: any; index?: number | undefined }
        ) {
            const _ = this._;
            _.componentKeys.set(component, _.componentKeys.get(component) || _.nextComponentKey++);
            if ("index" in layoutProperties && typeof layoutProperties.index === "number") {
                _.components.splice(layoutProperties.index, 0, component);
            } else {
                _.components.push(component);
            }
            if (!isReactComponent(component)) {
                await component._anvilSetupDom();
            }
            _.componentLayoutProps.set(component, layoutProperties);
            _.forceRender?.();
            return {
                onRemove: () => {
                    this._.components = this._.components.filter((c) => c !== component);
                    this._.forceRender?.();
                },
            };
        }
        _anvilGetComponents(): JsComponent[] {
            return this._.components;
        }
        _anvilEnableDropMode(
            droppingObject: DroppingSpecification & { layoutProperties?: { [prop: string]: any } | undefined },
            flags?: DropModeFlags | undefined
        ): DZ[] {
            const _ = this._;

            if (!container) {
                return [];
            }

            flushSync(() => {
                _.dropping = droppingObject;
                _.forceRender?.();
            });

            const dropLayoutProps = droppingObject.layoutProperties;

            return _.dropZones.filter(({ dropInfo }) => {
                if (dropLayoutProps) {
                    for (const [k, v] of Object.entries(dropLayoutProps)) {
                        if (dropInfo.layout_properties?.[k] !== v) {
                            return false;
                        }
                    }
                }
                return true;
            });
        }
        _anvilDisableDropMode(): void {
            this._.dropping = null;
            this._.forceRender?.();
        }
        _anvilGetSections() {
            return Array.from(
                this._.sections.values(),
                ({ id, sectionProperties, sectionPropertyValues, setSectionPropertyValues, ...section }) => ({
                    id,
                    ...section,
                    propertyDescriptions: sectionProperties,
                    propertyValues: sectionPropertyValues,
                    interactions: [
                        ...(this._.sectionInteractions.get(id)?.values() || []),
                        ...(this._.sectionInlineEditInteractions.get(id)?.values() || []),
                    ],
                })
            );
        }
        _anvilGetSectionDomElement(id: string): HTMLElement {
            return this._.sections.get(id)!.element;
        }
        _anvilSetSectionPropertyValues(id: string, values: { [propName: string]: any }): void | Promise<void> {
            const section = this._.sections.get(id)!;
            section.setSectionPropertyValues(values);
        }
        _anvilGetContainerDesignInfo(component: JsComponent): ContainerDesignInfo {
            return { layoutPropertyDescriptions: layoutProperties ?? [] };
        }
        _anvilUpdateLayoutProperties(
            component: JsComponent,
            values: { [propName: string]: any }
        ): void | Promise<void> {}
    }

    return ReactContainer;
}

function mkComponent(spec: ReactComponentDefinition) {
    const { properties } = spec;

    const cls = mkComponentClass(spec);

    for (const { name } of properties ?? []) {
        Object.defineProperty(cls.prototype, name, {
            get() {
                return this._.propertyInterface[name];
            },
            set(value) {
                this._.propertyInterface[name] = value;
            },
            configurable: true,
        });
    }

    return cls;
}

const reactComponentToSpec = ({
    name,
    properties,
    events,
    layoutProperties,
    container,
    showInToolbox,
}: ReactComponentDefinition) => ({ name, properties, events, layoutProperties, container, showInToolbox });

export function registerReactComponent(spec: ReactComponentDefinition) {
    return registerJsComponent(mkComponent(spec), reactComponentToSpec(spec));
}

export interface AnvilReactDesignerApi {
    inDesigner: boolean;
    designName: string | null;
    updateProperties(updates: any): void;
    startEditingForm(form: string): void;
}
export interface AnvilReactActions {
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
    useSectionRefs(sectionSpecs: SectionSpec[]): SectionRefs;
    useDesignerInteractionRef(event: "dblclick", callback: () => void, otherRef?: ReactRef<HTMLElement>): ReactRef<HTMLElement>;
}

export const hooks: AnvilReactHooks = {
    useActions: () => React.useContext(HooksContext).useActions(),
    useDesignerApi: () => React.useContext(HooksContext).useDesignerApi(),
    useComponentState: (...args) => React.useContext(HooksContext).useComponentState(...args),
    useInteraction: (...args) => React.useContext(HooksContext).useInteraction(...args),
    useInlineEditRef: (...args) => React.useContext(HooksContext).useInlineEditRef(...args),
    useInlineEditSectionRef: (...args) => React.useContext(HooksContext).useInlineEditSectionRef(...args),
    useSectionRef: (...args) => React.useContext(HooksContext).useSectionRef(...args),
    useSectionRefs: (...args) => React.useContext(HooksContext).useSectionRefs(...args),
    useDesignerInteractionRef: (...args) => React.useContext(HooksContext).useDesignerInteractionRef(...args),
};

export const inDesigner = designerApi.inDesigner;
export { registerToolboxSection };
