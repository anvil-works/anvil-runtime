/** @jsx React.createElement */
import React from "react";
import { createPortal, flushSync } from "react-dom";

import {
    type ComponentProperties,
    type ContainerDesignInfo,
    type CustomComponentSpec,
    type DropZone as DZ,
    type DropInfo,
    type DroppingSpecification,
    type Interaction,
    type LayoutProperties,
    type PropertyDescription,
    type PropertyValueUpdates,
    type RegionInteraction,
    type StringPropertyDescription,
    type ToolboxSection,
} from "@runtime/components/Component";
import type { JsComponentAPI } from "../../../public-api";
import type { JsComponent, JsComponentConstructor, JsContainer } from "../../../public-api/component";

import type { InlineEditingOptions } from "@runtime/runner/components-in-js/public-api/designer";
import type { DropModeFlags } from "@runtime/runner/python-objects";
import { rcStore } from "./root";

// @ts-ignore
const { _jsComponentApi } = window.anvil;
const {
    designerApi,
    notifyMounted,
    notifyUnmounted,
    notifyVisibilityChange,
    raiseAnvilEvent,
    triggerWriteBack,
    registerJsComponent,
    registerToolboxSection,
    propertyUtils,
    subscribeAnvilEvent,
    getClientConfig,
    getParent,
} = _jsComponentApi as JsComponentAPI;

export const { openForm } = _jsComponentApi as JsComponentAPI;

export interface ComponentProps {
    children: React.ReactNode[];
    childrenWithoutDropZones: React.ReactNode[];
    childrenWithLayoutProperties: ChildWithLayoutProperties[];
    properties: Record<string, any>;
    components?: JsComponent[];
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
    visible: boolean;
}

export interface SectionSpec {
    id: string;
    title: string;
    sectionProperties: PropertyDescription[];
    sectionPropertyValues: ComponentProperties;
    setSectionPropertyValues: (updates: PropertyValueUpdates) => PropertyValueUpdates | void;
    inlineEditProps?: string[];
    inlineEditRoot?: string;
}

export interface SectionRefs {
    [sectionId: string]: {
        ref: ReactRef<any>;
        inlineEditRefs: {
            [propName: string]: ReactRef<any>;
        };
    };
}

type SectionInteraction = Interaction & {
    sectionId: string;
};

export type InteractionSpec = Interaction | RegionRefInteraction | SectionInteraction | undefined | false | null;

export type Section = SectionSpec & { element: HTMLElement };

const HooksContext = React.createContext<AnvilReactHooks>(null as unknown as AnvilReactHooks);
const DropZoneContext = React.createContext<DropZoneContextType>(null as unknown as DropZoneContextType);

const useNotifyMounted = (c: JsComponent, isRoot = false) => {
    React.useLayoutEffect(() => {
        notifyMounted(c, isRoot);
        return () => {
            const parent = getParent(c);
            if (isRoot || parent === null || isReactComponent(parent)) {
                // in anvil-react we are responsible for unmounting ourselves in useEffect cleanups
                // this allows developers to write react components like Tabs, and not have to worry about anvil page events
                // but if our parent is not a react component,
                // then the responsibility for unmounting falls to our parent anvil component
                // (or from calling remove_from_parent)
                // In anvil page events - the responsibility for mounting/unmounting is on the parent
                // if we unmount ourselves when we are removed from the dom tree, we may still be in the Anvil component tree
                // and then if our parent is remounted, we might never get remounted, because our parent didn't unmount us!
                notifyUnmounted(c, isRoot);
            }
        };
    }, []);
};

const portalElementCache = new WeakMap<JsComponent, { components: ReactComponent[]; forceRender: () => void }>();

const ElementWrapper = ({ el, c }: { el: HTMLElement; c: JsComponent }) => {
    const ref = React.useRef<HTMLDivElement>(null!);

    React.useLayoutEffect(() => {
        ref.current.appendChild(el);
        return () => {
            el.remove();
        };
    }, [el]);

    useNotifyMounted(c);

    return (
        <div data-anvil-react-wrapper="" ref={ref}>
            {portalElementCache
                .get(c)
                ?.components.map(
                    (c) => c._.portalElement && createPortal(c._.reactComponent(), c._.portalElement, c._.id.toString())
                )}
        </div>
    );
};

interface RegionRefInteraction extends Omit<RegionInteraction, "bounds"> {
    bounds: NonNullable<ReactRef<HTMLElement>>;
}

export interface ReactComponentWrapper {
    reactComponent: (props?: { isRoot?: boolean }) => React.ReactNode;
    id: number;
    name: string;
    portalElement?: HTMLElement;
    reactRoot?: any;
    components: JsComponent[];
    componentLayoutProps: WeakMap<JsComponent, LayoutProperties>;
    componentVisibility: WeakMap<JsComponent, boolean>;
    forceRender?(): any;
    setDropping?(): any;
    dropping?: DroppingSpecification | null;
    ref?: any;
    actions: any;
    propertyInterface: any;
    dropZones: DZ[];
    sections: Map<string, Section>;
    sectionInteractions: Map<string, Map<string, Interaction>>; // sectionId => interactionId => interactions
    interactions: Map<string, Interaction | RegionRefInteraction>;
    inlineEditInteractions: Map<string, Interaction>; // propName => interaction
    sectionInlineEditInteractions: Map<string, Map<string, Interaction>>; // sectionId => propName => interactions
    componentKeys: WeakMap<JsComponent, number>;
    nextComponentKey: number;
    designName?: string;
    nextDesignerStateId: number;
    methodHandlers: Record<string, (...args: any[]) => any>;
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

export interface DropZoneProps extends React.HTMLAttributes<HTMLDivElement> {
    minChildIdx?: number;
    maxChildIdx?: number;
    childIdx?: number;
    layoutProperties?: Record<string, any>;
}

interface ErrorProps extends React.PropsWithChildren {
    self: ReactComponent;
}
interface ErrorState {
    hasError?: boolean;
    error?: any;
}

const errorStyle = {
    textAlign: "center",
    padding: "1rem",
    border: "1px dashed black",
    wordWrap: "break-word",
    color: "#a00",
    backgroundColor: "#faa",
} as const;

function ErrorFallback({ self, children }: ErrorProps) {
    React.useEffect(() => {
        designerApi.inDesigner && designerApi.notifyDomNodeChanged(self);
    }, []);

    return (
        <div ref={self._.ref} style={errorStyle}>
            {children}
        </div>
    );
}

class ErrorBoundary extends React.Component<ErrorProps, ErrorState> {
    constructor(props: ErrorProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: any) {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error: error };
    }
    componentDidMount(): void {}
    componentDidUpdate(prevProps: Readonly<ErrorProps>, prevState: Readonly<ErrorState>, snapshot?: any): void {
        // console.log(prevProps, prevState);
    }
    reset() {
        this.setState({ hasError: false, error: null });
    }

    componentDidCatch(error: any, info: any) {
        // Example "componentStack":
        //   in ComponentThatThrows (created by App)
        //   in ErrorBoundary (created by App)
        //   in div (created by App)
        //   in App
        //   logErrorToMyService(error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            const self = this.props.self;
            self._.forceRender = () => this.reset();
            const msg = `${
                self._.designName ?? self._.name ?? "This"
            } component experienced an error: ${this.state.error?.toString()}`;
            return <ErrorFallback self={self}>{msg}</ErrorFallback>;
        }
        return this.props.children;
    }
}

export const DropZone = ({
    minChildIdx = undefined,
    maxChildIdx = undefined,
    childIdx = undefined,
    layoutProperties = undefined,
    ...props
}: DropZoneProps) => {
    const ctx = React.useContext(DropZoneContext);
    if (!ctx.dropping) return null;

    if (minChildIdx === undefined && maxChildIdx === undefined && childIdx !== undefined) {
        minChildIdx = maxChildIdx = childIdx;
    } else if (childIdx !== undefined && (minChildIdx !== undefined || maxChildIdx !== undefined)) {
        console.warn("DropZones only accept either childIdx or minChildIdx,maxChildIdx. Not both.");
    }

    const ref = (element: HTMLDivElement) => {
        // Callable ref can be called with a null element if it's somehow vanished from the DOM already.
        if (element) {
            ctx.dropZones.push({
                element,
                expandable: true,
                dropInfo: { minChildIdx, maxChildIdx, layout_properties: layoutProperties },
            });
        }
    };

    return <div data-anvil-react-dropzone="" ref={ref} {...props} />;
};

const IS_REACT = Symbol();

export interface ReactComponent extends JsComponent {
    _: ReactComponentWrapper;
    [IS_REACT]: boolean;
}

export interface ReactContainer extends JsContainer, ReactComponent {
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

const isReactComponent = (obj: any): obj is ReactComponent => !!obj?.[IS_REACT];
let componentId = 0;

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

    const getStringProp = (propName: string) => {
        const rv = properties?.find(({ name }) => propName === name) ?? { name: propName, type: "string" };
        return rv as PropertyDescription<"string">;
    };

    const actions: AnvilReactActions = {
        async raiseEvent(eventName: string, args: Record<string, any> = {}) {
            await raiseAnvilEvent(self, eventName, args);
        },
        async triggerWriteBack(property: string, value: any) {
            await triggerWriteBack(self, property, value);
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
        },
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
        },
        startInlineEditing(prop, element, options) {
            const property = properties?.find(({ name }) => name === prop);
            if (property) {
                designerApi.startInlineEditing(self, property as StringPropertyDescription, element, options);
            }
        },
    };

    const hooksContext: AnvilReactHooks = {
        useActions: () => actions,
        useDesignerApi: () => ({ ...designerApiContext, designName: designerApi.getDesignName(self) }),
        useDropping: () => _.dropping,
        useMethodHandler(methodName: string, handler: (...args: any[]) => any) {
            React.useEffect(() => {
                _.methodHandlers[methodName] = handler;
                return () => {
                    delete _.methodHandlers[methodName];
                };
            });
        },
        useInteraction: (maybeInteraction: InteractionSpec) => {
            // Maybe make second arg an object?
            const id = React.useId();
            if (maybeInteraction) {
                if ("sectionId" in maybeInteraction) {
                    const { sectionId, ...interaction } = maybeInteraction;
                    let sectionMap = _.sectionInteractions.get(sectionId);
                    if (sectionMap === undefined) {
                        sectionMap = new Map<string, Interaction>();
                        _.sectionInteractions.set(sectionId, sectionMap);
                    }
                    sectionMap.set(id, interaction);
                } else {
                    _.interactions.set(id, maybeInteraction);
                }
            }
        },
        useInlineEditRef: (propName, otherRef?, { onStart, onEnd } = {}) => {
            return (element) => {
                setRef(otherRef, element);

                if (element) {
                    _.inlineEditInteractions.set(propName, {
                        type: "whole_component",
                        title: `Edit ${propName}`,
                        icon: "edit",
                        default: true,
                        callbacks: {
                            execute() {
                                onStart?.();
                                designerApi.startInlineEditing(self, getStringProp(propName), element, {
                                    onFinished: onEnd,
                                });
                            },
                        },
                    });
                }
            };
        },
        useInlineEditRegionRef: (propName, otherRef?, { onStart, onEnd } = {}) => {
            return (element) => {
                setRef(otherRef, element);

                if (element) {
                    _.inlineEditInteractions.set(propName, {
                        type: "region",
                        sensitivity: 2,
                        bounds: element,
                        callbacks: {
                            execute() {
                                onStart?.();
                                designerApi.startInlineEditing(self, getStringProp(propName), element, {
                                    onFinished: onEnd,
                                });
                            },
                        },
                    });
                }
            };
        },
        useInlineEditSectionRef(sectionId, propName, otherRef, cbs) {
            return (element) => {
                setRef(otherRef, element);

                if (element) {
                    addSectionInlineEditInteraction(sectionId, propName, element, cbs);
                }
            };
        },
        useSectionRef: (section, otherRef) => (element) => {
            setRef(otherRef, element);
            if (element) {
                _.sections.set(section.id, { ...section, element });
                designerApi.updateComponentSections(self, { [section.id]: { element } });
            }
        },
        useSectionRefs: (sections) => {
            const sectionRefs: SectionRefs = {};
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
                    inlineEditRefs: Object.fromEntries(
                        section.inlineEditProps?.map((propName) => [
                            propName,
                            (element: HTMLElement) => {
                                if (element) {
                                    addSectionInlineEditInteraction(section.id, propName, element);
                                }
                            },
                        ]) || []
                    ),
                };
            }
            return sectionRefs;
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
                return [
                    currentValue,
                    (newStateOrFn: any) => {
                        const newState =
                            typeof newStateOrFn === "function" ? newStateOrFn(state.get(id)) : newStateOrFn;
                        state.set(id, newState);
                        setS(newState); // Force re-render if necessary
                    },
                ];
            } else {
                return React.useState<any>(initialState);
            }
        },
        useRegionInteractionRef: (execute, otherRef, { sensitivity = 0 } = {}) => {
            const localRef = React.useRef<any>(null);
            hooksContext.useInteraction({
                type: "region",
                bounds: localRef,
                callbacks: { execute },
                sensitivity,
            });
            return (element) => {
                setRef(otherRef, element);
                setRef(localRef, element);
            };
        },
        useDesignerInteractionRef:
            (event: "dblclick", callback, otherRef, options = {}) =>
            (element) => {
                setRef(otherRef, element);
                const { enabled = true } = options;
                if (element && enabled) {
                    designerApi.registerInteraction(self, { event, callback, element });
                }
            },
        useVisibility: (visible: boolean) => {
            notifyVisibilityChange(self, visible);
        },
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

    WrappedComponent.displayName = "WrappedComponent";

    const InnerComponent = ({ isRoot }: { isRoot?: boolean }) => {
        const _ = _ReactComponentWrapper;
        _.forceRender = React.useReducer(() => ({}), {})[1];

        _.dropZones = [];
        const dropZoneContext = {
            dropping: _.dropping,
            dropZones: _.dropZones,
        };

        const children: React.ReactNode[] = [];
        const childKeys: WeakMap<any, string> = new WeakMap();
        const childrenWithLayoutProperties: ChildWithLayoutProperties[] = [];
        if (autoDropZones) {
            children.push(
                <DropZone key={"anvil-child-[-1]-dz"} minChildIdx={0} maxChildIdx={0} {...autoDropZoneProps} />
            );
        }
        const childrenWithoutDropZones: React.ReactNode[] = [];
        let i = 0;
        for (const c of _.components) {
            let child;
            const key = `anvil-child-${_.componentKeys.get(c)}`;
            // TODO - how do we determine this now since we give you a WrappedComponent
            if (isReactComponent(c)) {
                delete c._.portalElement; // if someone asked for our dom node before we were rendered - delete it now so we don't become a portal
                child = <React.Fragment key={key}>{c._.reactComponent()}</React.Fragment>;
            } else {
                // TODO: We could probably even do without this ElementWrapper, by directly inserting the child domElement into
                //      the right position inside this one in a useLayoutEffect. This will be hard, and may not be worth it.
                child = <ElementWrapper key={key} el={c._anvilDomElement!} c={c} />;
            }
            children.push(child);
            childrenWithoutDropZones.push(child);
            childrenWithLayoutProperties.push({
                child,
                layoutProperties: _.componentLayoutProps.get(c)!,
                visible: _.componentVisibility.get(c)!,
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

        useNotifyMounted(self, isRoot);

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
        id: componentId++,
        name,
        portalElement: undefined,
        reactComponent: ({ isRoot } = {}) => (
            <ErrorBoundary self={self}>
                <InnerComponent isRoot={isRoot} />
            </ErrorBoundary>
        ),
        components: [],
        componentLayoutProps: new WeakMap<JsComponent, LayoutProperties>(),
        componentVisibility: new WeakMap<JsComponent, boolean>(),
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
        methodHandlers: {},
    };

    const _ = _ReactComponentWrapper;

    const addSectionInlineEditInteraction = (
        sectionId: string,
        propName: string,
        element: HTMLElement,
        { onStart, onEnd }: { onStart?: () => void; onEnd?: () => void } = {}
    ) => {
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
                    onStart?.();
                    designerApi.startInlineEditing(self, getStringProp(propName), element, {
                        sectionId,
                        onFinished: onEnd,
                    });
                },
            },
        });
    };

    return _;
}

// Interactions coming from React might be of type RegionRefInteraction, where bounds are specified by a ref.
// Deal with that here, turning the ref into an HTMLElement
const remapInteractions = (interactions: (Interaction | RegionRefInteraction)[]) =>
    interactions.map((i) =>
        i.type === "region"
            ? { ...i, bounds: i.bounds && "current" in i.bounds ? i.bounds.current : (i as RegionInteraction).bounds }
            : i
    );

function mkComponentClass(spec: ReactComponentDefinition): JsComponentConstructor {
    const { properties, events, container, layoutProperties } = spec;
    // events?.push({ name: "mounted" }, { name: "unmounted" });
    class ReactComponent_ implements ReactComponent {
        _: ReactComponentWrapper;
        [IS_REACT] = true;
        constructor() {
            this._ = setupReactComponent(this, spec);
        }
        _anvilNew() {
            subscribeAnvilEvent(this, "x-anvil-page-added", () => {
                if (!this._.portalElement) return;
                if (rcStore.getState().components.includes(this)) return;
                flushSync(() => {
                    let parent = getParent(this);
                    while (parent) {
                        const { components: portalElements, forceRender } = portalElementCache.get(parent) ?? {};
                        if (portalElements) {
                            if (!portalElements.includes(this)) {
                                portalElements.push(this);
                                forceRender?.();
                            }
                            return;
                        }
                        parent = getParent(parent);
                    }
                    rcStore.setState(({ components }) => ({ components: [...components, this] }));
                });
            });
            subscribeAnvilEvent(this, "x-anvil-page-removed", () => {
                if (!this._.portalElement) return;
                let parent = getParent(this);
                while (parent) {
                    const { components: portalElements, forceRender } = portalElementCache.get(parent) ?? {};
                    if (portalElements) {
                        const idx = portalElements.findIndex((c) => c === this);
                        if (idx > 0) {
                            portalElements.splice(idx, 1);
                            forceRender?.();
                            return;
                        }
                    }
                    parent = getParent(parent);
                }
                rcStore.setState(({ components }) => ({
                    components: components.filter((x) => x !== this),
                }));
            });
        }
        _anvilSetupDom(): HTMLElement | Promise<HTMLElement> {
            const _ = this._;
            // somebody asked for our dom node - we'll have a ref if we're already in the tree
            if (!(_.portalElement || _.ref?.current)) {
                _.portalElement = document.createElement("div");
                _.portalElement.setAttribute("data-anvil-react-portal", "");
                designerApi.inDesigner && designerApi.notifyDomNodeChanged(this);
            }
            return _.portalElement || _.ref?.current;
        }
        get _anvilDomElement(): HTMLElement | undefined {
            return this._.portalElement || this._.ref?.current;
        }
        _anvilGetInteractions(): Interaction[] {
            return [...remapInteractions([...this._.interactions.values()]), ...this._.inlineEditInteractions.values()];
        }
        _anvilUpdateDesignName(name: string): void {
            this._.designName = name;
            this._.forceRender?.();
        }
        static _anvilEvents = events ?? [];
        static _anvilProperties = (properties ?? []).map((description) => ({ ...description }));

        get reactComponent() {
            // we are no longer going to be rendered into the anvil page events hierarchy
            // so consider us the root element for anvil page events
            return this._.reactComponent({ isRoot: true });
        }
    }

    if (!container) return ReactComponent_;

    class ReactContainer extends ReactComponent_ implements JsContainer {
        async _anvilAddComponent(
            component: JsComponent,
            layoutProperties: { [prop: string]: any; index?: number | undefined }
        ) {
            const _ = this._;
            if (!isReactComponent(component)) {
                await component._anvilSetupDom();
                portalElementCache.set(component, { components: [], forceRender: () => _.forceRender?.() });
            } else {
                // in case somoeone asked for this elements dom node before being rendered
                // we know this element doesn't have a parent at this stage
                delete component._.portalElement;
            }
            _.componentKeys.set(component, _.componentKeys.get(component) || _.nextComponentKey++);
            if ("index" in layoutProperties && typeof layoutProperties.index === "number") {
                _.components.splice(layoutProperties.index, 0, component);
            } else {
                _.components.push(component);
            }
            _.componentLayoutProps.set(component, layoutProperties);
            _.componentVisibility.set(component, true);
            _.forceRender?.();
            return {
                onRemove: () => {
                    this._.components = this._.components.filter((c) => c !== component);
                    this._.forceRender?.();
                    portalElementCache.delete(component);
                },
                setVisibility: (v: boolean) => {
                    _.componentVisibility.set(component, v);
                    this._.forceRender?.();
                },
                isMounted: false,
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

            return _.dropZones.filter(({ dropInfo = {} }) => {
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
                        ...remapInteractions([...(this._.sectionInteractions.get(id)?.values() || [])]),
                        ...(this._.sectionInlineEditInteractions.get(id)?.values() || []),
                    ],
                })
            );
        }
        _anvilGetSectionDomElement(id: string): HTMLElement {
            return this._.sections.get(id)!.element;
        }
        _anvilSetSectionPropertyValues(id: string, values: PropertyValueUpdates) {
            const section = this._.sections.get(id);
            return section?.setSectionPropertyValues(values);
        }
        _anvilGetContainerDesignInfo(component: JsComponent): ContainerDesignInfo {
            return { layoutPropertyDescriptions: layoutProperties ?? [] };
        }
        _anvilUpdateLayoutProperties(component: JsComponent, updates: PropertyValueUpdates): undefined {
            const layoutProps = this._.componentLayoutProps.get(component);
            this._.componentLayoutProps.set(component, { ...layoutProps, ...updates });
            flushSync(() => {
                this._.forceRender?.();
            });
            // no need to return anything - we're accepting the updates as is
        }
    }

    return ReactContainer;
}

function mkComponent(spec: ReactComponentDefinition) {
    const { properties, methods } = spec;

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

    for (const { name } of methods ?? []) {
        Object.defineProperty(cls.prototype, name, {
            value: function (...args: any[]) {
                return this._.methodHandlers[name]?.(...args);
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
    methods,
}: ReactComponentDefinition) => ({ name, properties, events, layoutProperties, container, showInToolbox, methods });

export function registerReactComponent(spec: ReactComponentDefinition) {
    return registerJsComponent(mkComponent(spec), reactComponentToSpec(spec));
}

export interface AnvilReactDesignerApi {
    inDesigner: boolean;
    designName: string | null;
    updateProperties(updates: any): void;
    startEditingForm(form: string): void;
    startInlineEditing(prop: string, element: HTMLElement, options?: InlineEditingOptions): void;
}
export interface AnvilReactActions {
    raiseEvent(eventName: string, args?: object): Promise<void>;
    triggerWriteBack(propName: string, value: any): Promise<void>;
    setProperty(propName: string, value: any): void;
}

interface AnvilReactHooks {
    useActions(): AnvilReactActions;
    useVisibility(visible: boolean): void;
    useDropping(): DroppingSpecification | undefined | null;
    useComponentState<T>(initialState?: T): [T, (newState: T | ((oldState: T) => T)) => void];
    useDesignerApi(): AnvilReactDesignerApi;
    useInteraction(interaction: InteractionSpec): void;
    useInlineEditRef<T extends HTMLElement>(
        propName: string,
        otherRef?: React.Ref<T>,
        cbs?: { onStart?: () => void; onEnd?: () => void }
    ): React.Ref<T>;
    useInlineEditSectionRef<T extends HTMLElement>(
        sectionId: string,
        propName: string,
        otherRef?: React.Ref<T>,
        cbs?: { onStart?: () => void; onEnd?: () => void }
    ): React.Ref<T>;
    useInlineEditRegionRef<T extends HTMLElement>(
        propName: string,
        otherRef?: React.Ref<T>,
        cbs?: { onStart?: () => void; onEnd?: () => void }
    ): React.Ref<T>;
    useSectionRef<T extends HTMLElement>(sectionSpec: SectionSpec, otherRef?: React.Ref<T>): React.Ref<T>;
    useSectionRefs(sectionSpecs: SectionSpec[]): SectionRefs;
    useDesignerInteractionRef<T extends HTMLElement>(
        event: "dblclick",
        callback: () => void,
        otherRef?: React.Ref<T>,
        options?: { enabled?: boolean }
    ): React.Ref<T>;
    useRegionInteractionRef<T extends HTMLElement>(
        callback: () => void,
        otherRef?: React.Ref<T>,
        options?: Partial<Pick<RegionInteraction, "sensitivity">>
    ): React.Ref<T>;
    useMethodHandler(methodName: string, handler?: ((...args: any[]) => any) | null): void;
}

export const hooks: AnvilReactHooks = {
    useActions: () => React.useContext(HooksContext).useActions(),
    useVisibility: (...args) => React.useContext(HooksContext).useVisibility(...args),
    useDropping: () => React.useContext(HooksContext).useDropping(),
    useDesignerApi: () => React.useContext(HooksContext).useDesignerApi(),
    useComponentState: (...args) => React.useContext(HooksContext).useComponentState(...args),
    useInteraction: (...args) => React.useContext(HooksContext).useInteraction(...args),
    useInlineEditRef: (...args) => React.useContext(HooksContext).useInlineEditRef(...args),
    useInlineEditSectionRef: (...args) => React.useContext(HooksContext).useInlineEditSectionRef(...args),
    useInlineEditRegionRef: (...args) => React.useContext(HooksContext).useInlineEditRegionRef(...args),
    useSectionRef: (...args) => React.useContext(HooksContext).useSectionRef(...args),
    useSectionRefs: (...args) => React.useContext(HooksContext).useSectionRefs(...args),
    useDesignerInteractionRef: (...args) => React.useContext(HooksContext).useDesignerInteractionRef(...args),
    useRegionInteractionRef: (...args) => React.useContext(HooksContext).useRegionInteractionRef(...args),
    useMethodHandler: (...args) => React.useContext(HooksContext).useMethodHandler(...args),
};

export const inDesigner = designerApi.inDesigner;
export { propertyUtils, registerToolboxSection };
export type { ToolboxSection };

export function includeContext(ctx: React.FC<React.PropsWithChildren>) {
    rcStore.setState(({ contexts }) => ({ contexts: [...contexts, ctx] }));
}

export function useClientConfig(packageName: string) {
    // shouldn't need to re-render: client configs should be loaded once on startup
    // but we don't memoise this since this might be called before data loaded
    return getClientConfig(packageName);
}
