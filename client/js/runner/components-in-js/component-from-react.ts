import {chainOrSuspend, pyCallable, pyFunc, pyList, pyNewableType, pyNone, pyObject, pyStr} from "../../@Sk";
import type {Kws} from "../../@Sk";
import {
    addEventHandler,
    Component,
    ComponentConstructor,
    DropInfo,
    DropZone,
    EventDescription,
    initComponentSubclass,
    Interaction,
    PropertyDescription,
    StringPropertyDescription
} from "../../components/Component";
import {s_anvil_events, s_raise_event, s_x_anvil_propagate_page_shown} from "../py-util";
import {jsComponentModules, whenEnvironmentReady} from "./common";
import { Container } from "../../components/Container";
import {kwargsToJsObject, kwargsToPyMap} from "../instantiation";
import { designerApi } from "../component-designer-api";

// TODO:
//   React.render -> ReactDOM.render
//   React.h -> React.createElement
//   Make work with React (not just Preact)
//   The crazy component-div-substitution hack mucks up the order of elements (at least with Preact)
//   Enable other component updates in container drop
//   We should support creating drop zones on demand (we can *probably* do this with a synchronous render, but...ew?)
//   I'm sure registering drop zones should be more React-y / future-proof for async


interface ComponentSpec {
    name: string;
    properties: (PropertyDescription & { defaultValue: any })[];
    events: EventDescription[];
    component(): any; // React component
    createOuterElement?(): HTMLElement; // TODO: Also pass the container properties
    container?: boolean;
}


interface ReactComponentConstructor extends ComponentConstructor {
    new (): ReactComponent;
}

interface ReactComponent extends Component {
    propertyInterface: { [prop: string]: any };
    components: { component: Component; layoutProperties: { [prop: string]: any }; key: string }[];
    dropZones: { [id: string | number]: any };
    container: boolean;
}

interface ComponentProps {
    properties: any,
    actions: any,
    outerElementRef: any,
    designerApi: any,
    components?: any,
    dropState?: any,
}

const mkComponentClass = (React: any, { name, component, properties, events, createOuterElement, container }: ComponentSpec) => {
    const pyEvents = Sk.ffi.toPy(events || []);
    const leafName = name.match(/[^.]+$/);
    let nextKey = 0;

    const cls: ReactComponentConstructor = Sk.abstr.buildNativeClass(name + "." + leafName, {
        constructor: function ReactComponent() {
            const self = this;
            const pyRaiseEvent = this.tp$getattr<pyCallable>(s_raise_event);
            const actions = {
                raiseEvent(eventName: string, args: object = {}) {
                    const pyKw: Kws = [];
                    for (const [k, v] of Object.entries(args)) {
                        pyKw.push(k, Sk.ffi.toPy(v));
                    }
                    return Sk.misceval.asyncToPromise(() =>
                        Sk.misceval.callsimOrSuspendArray(pyRaiseEvent, [new pyStr(eventName)], pyKw)
                    );
                },
            };

            this.container = !!container;
            this.components = [];
            this.dropZones = {};

            this.getInteractions = null;
            this.dropping = null;

            const rootElement = createOuterElement?.() || document.createElement("div");
            const render = (this.$render = () => {
                if (container) {
                    self.dropZones = {};
                }
                const props: ComponentProps = {
                    properties: this.propertyInterface,
                    actions,
                    outerElementRef: { current: rootElement },
                    designerApi: {
                        // Carefully subset out a supported interface
                        inDesigner: designerApi.inDesigner,
                        startEditingSubform: designerApi.startEditingSubform,
                        startInlineEditing: (
                            prop: StringPropertyDescription,
                            element: HTMLElement,
                            onFinished?: () => void
                        ) => designerApi.startInlineEditing(self, prop, element, { onFinished }),
                        useGetInteractions: (getInteractions: () => Interaction[]) => {
                            self.getInteractions = getInteractions;
                        },
                        editableRef: (propName: string, elementRef: { current: HTMLElement }) => {
                            self.getInteractions = () => [
                                {
                                    type: "whole_component",
                                    name: "Edit text",
                                    icon: "edit",
                                    default: true,
                                    callbacks: {
                                        execute() {
                                            designerApi.startInlineEditing(
                                                self,
                                                { name: propName, type: "string" },
                                                elementRef.current,
                                                { onFinished: () => (elementRef.current.innerText = "") }
                                            );
                                        },
                                    },
                                },
                            ];
                            return elementRef;
                        },
                    },
                };
                if (container) {
                    props.components = this.components;
                    if (this.dropping) {
                        props.dropState = {
                            registerDropElement(id: string | number, dropElement: { element: HTMLElement, expandable?: boolean, dropInfo: DropInfo }) {
                                if (container) {
                                    console.log("REGISTERING DZ", id, dropElement);
                                    self.dropZones[id] = dropElement;
                                }
                            },
                        };
                    }
                }
                React.render(
                    React.createElement(
                        component,
                        props,
                        []
                    ),
                    rootElement
                );
            });

            const propertyState = Object.fromEntries(properties.map(({ name, defaultValue }) => [name, defaultValue]));

            this.propertyInterface = new Proxy(propertyState, {
                set(target, p, v) {
                    target[p as keyof typeof propertyState] = v;
                    render();
                    return true;
                }
            });

            this.anvil$hooks = {
                setupDom() {
                    render();
                    return rootElement;
                },
                get domElement() {
                    return rootElement;
                },
                setDataBindingListener(listenFn) {
                    /* TODO this really does actually need to do something */
                },
                // getPropertyValues & setPropertyValues omitted
                getDesignInfo() {
                    return {
                        propertyDescriptions: properties.map((description) => ({ ...description })),
                        events: (events || []).reduce((es, e) => {es[e.name] = e; return es; }, {} as {[propName: string]: EventDescription}),
                        interactions: self.getInteractions?.() || [],
                    };
                },
                enableDropMode(dropping) {
                    if (!container) { return []; }
                    self.dropping = dropping;
                    render();
                    return Object.values(self.dropZones).map(({ element, expandable, dropInfo }) => ({
                        element,
                        expandable,
                        dropInfo,
                    }));
                },
                disableDropMode() {
                    self.dropping = null;
                    render();
                }
            };
        },
        slots: {
            tp$new(args, kws = []) {
                const self = Component.prototype.tp$new.call(this, []) as Component;
                // TODO should this be in Component anyway?
                for (let i = 0; i < kws.length; i += 2) {
                    const k = kws[i];
                    const v = kws[i + 1] as pyObject;
                    if (k !== "__ignore_property_exceptions") {
                        self.tp$setattr(new pyStr(k), v);
                    }
                }

                addEventHandler(self, s_x_anvil_propagate_page_shown, () => self.render());
                return self;
            },
        },
        base: container ? Container : Component,
        getsets: {
            ...Object.fromEntries(
                properties.map(({ name }) => [
                    name,
                    {
                        $get() {
                            return Sk.ffi.toPy(this.propertyInterface[name]);
                        },
                        $set(v) {
                            //console.log("Property descriptor", name, "set to", v, "for", this);
                            this.propertyInterface[name] = Sk.ffi.toJs(v);
                        },
                    },
                ])
            ),
        },
        methods: container ? {
            add_component: {
                $meth(args, kws) {
                    if (args.length !== 1 || !(args[0] instanceof Component)) {
                        throw new Sk.builtin.TypeError("add_component() takes only one positional argument, which must be a Component");
                    }
                    const component = args[0];
                    this.components.push({component: component, layoutProperties: kwargsToJsObject(kws), key: `${leafName}_${nextKey++}`});
                    component.anvilComponent$setParent(this, () => {
                        this.components = this.components.filter((entry:any) => entry.component !== component);
                        this.$render();
                    });
                    return chainOrSuspend(component.anvil$hooks.setupDom(), () => {
                        this.$render();
                        return pyNone;
                    });
                },
                $flags: { FastCall: true }
            },
            get_components: {
                $meth() {
                    return new pyList(this.components.map(({ component }) => component));
                },
                $flags: { NoArgs: true }
            },
        } : undefined,
        flags: { sk$klass: true },
    });
    cls.tp$setattr(s_anvil_events, pyEvents);
    initComponentSubclass(cls);
    return cls;
};

export const registerReactComponent = (React: any, component: ComponentSpec) => {
    const leafName = component.name.replace(/^.*\./, "");
    const cls = mkComponentClass(React, component);

    whenEnvironmentReady(() => {
        // // Try to import the parent package. Honestly this is a nicety
        // const pyPackage = component.name.replace(/\.[^.]+$/, "");
        // Sk.importModule(pyPackage, false, false);

        const pyModule = new Sk.builtin.module();
        const pyName = new pyStr(component.name);
        pyModule.init$dict(pyName, Sk.builtin.none.none$);
        pyModule.$d[leafName] = cls;
        Sk.sysmodules.mp$ass_subscript(pyName, pyModule);
        jsComponentModules[component.name] = pyModule;
    });
};

export const getReactComponents = (React:any, Hooks?:any) => {
    // This is a nasty series of backflips to embed a particular DOM node in React output.
    // We do this by rendering a sacrificial div, then swapping it post-update for the actual
    // component - then swapping it back if React is about to re-render us. High drama.

    Hooks = Hooks || React; // Ewwww.

    interface ComponentInReactState {
        dummy: boolean; // is the dummy div rendered?
        dummyDiv?: HTMLElement;
    }

    const replaceDomNode = (currentNode: HTMLElement, newNode: HTMLElement) => {
        //console.log("Replacing", currentNode, "with", newNode);
        if (currentNode.parentElement) {
            currentNode.parentElement.replaceChild(newNode, currentNode);
            //console.log("done");
        }
    };

    function AnvilComponent({component}: {component?: Component}) {
        const domRef = Hooks.useRef(null);
        // TODO: This works, but only once. If anything changes, such as attempting to add DropZones, the ordering will be messed up.
        Hooks.useLayoutEffect(() => {
            console.log("%cCOMPONENT", "color:red;", component);
            if (component) {
                const componentNode = component.anvil$hooks.domElement!;
                console.log("Replacing react node", domRef.current, "with component node", componentNode);
                domRef.current.replaceWith(component.anvil$hooks.domElement!);
                return () => {
                    console.log("Removing component node", componentNode, "putting react node back", domRef.current);
                    componentNode.replaceWith(domRef.current);
                }
            }
        });
        return React.createElement("div", { ref: domRef });
    }

    const ReactComponent = React.Component;

    class ComponentInReact extends ReactComponent {
        _anvilState: ComponentInReactState = { dummy: true };
        // constructor(props: any) {
        //     super(props);
        //     //console.log("CONSTRUCT:", props);
        // }
        render() {
            //console.log("RENDER!");
            return React.createElement('div', {ref: (elt:HTMLElement) => { this._anvilState.dummyDiv = elt; }});
        }

        _enterDummyMode() {
            //console.log("DUMMY MODE ON:", this._anvilState);
            // If we have a component, get it off the page before React starts diffing it
            const anvilState : ComponentInReactState = this._anvilState;
            if (anvilState.dummy) { return; }
            const component = this.props.component as Component | undefined;
            const componentElement = component?.anvil$hooks.domElement;
            if (componentElement) {
                replaceDomNode(componentElement, anvilState.dummyDiv!);
                // todo trigger removedFromPage, because there's no guarantee it's coming back
            }
            // The div may or may not be present now, but the component definitely isn't.
            // Good enough to start rendering.
            anvilState.dummy = true;
        }

        _exitDummyMode() {
            //console.log("DUMMY MODE OFF:", this._anvilState, this._anvilState.dummyDiv, this.props.component, this.props.component?.anvil$hooks.domElement);
            // If we have a component, replace the dummy with it
            const anvilState: ComponentInReactState = this._anvilState;
            if (!anvilState.dummy) { return; }
            const component = this.props.component as Component | undefined;
            const componentElement = component?.anvil$hooks.domElement;
            // TODO if the component hasn't set up its dom yet, ask it now rather than giving up
            if (componentElement) {
                replaceDomNode(anvilState.dummyDiv!, componentElement);
                // todo trigger addedToPage
            } else {
                anvilState.dummyDiv?.parentElement?.removeChild(anvilState.dummyDiv);
            }
            // The component may or may not be present now, but the dummy definitely isn't.
            // This is the end state we wanted.
            anvilState.dummy = false;
        }

        shouldComponentUpdate(nextProps: any, nextState: any) {
            //console.log("Should I update?", nextProps.component !== this.props.component, nextProps.component, this.props.component);
            return nextProps.component !== this.props.component;
        }

        componentDidMount() {
            //console.log("DID MOUNT:");
            this._exitDummyMode();
        }
        componentWillUnmount() {
            //console.log("WILL UNMOUNT:");
            this._enterDummyMode();
        }
        UNSAFE_componentWillUpdate(nextProps: any, nextState: any) {
            //console.log("UNSAFE_willUpdate:");
            this._enterDummyMode();
        }
        componentWillUpdate(nextProps: any, nextState: any) {
            //console.log("WILL UPDATE");
            this._enterDummyMode();
        }
        componentDidUpdate(prevProps: any) {
            //console.log("DID UPDATE:");
            this._exitDummyMode();
        }
    }

    const DropZone = ({dropState, dropId, expandable, dropInfo}: any) =>
        dropState && React.createElement('div', {
            ref: (element: HTMLElement) => dropState.registerDropElement(dropId, {
                element,
                expandable,
                dropInfo
            })
        });

    type Ref = any;

    const useComponentsRef = (existingRef: Ref | null, components: Component[], dropState?: any, wrapComponent?:any, createDropzoneElement?:any) => {

        const ref = existingRef || Hooks.useRef(null);

        Hooks.useLayoutEffect(() => {
            let i = 0;
            for (const {component} of components) {
                if (dropState) {
                    const element = createDropzoneElement?.() || document.createElement("div");
                    dropState.registerDropElement(i, {element, dropInfo: {childIdx: i++}});
                    ref.current.appendChild(element);
                }
                // TODO: Page events?
                ref.current.appendChild(wrapComponent?.(component.anvil$hooks.domElement!) || component.anvil$hooks.domElement!);
            }
            if (dropState) {
                const element = createDropzoneElement?.() || document.createElement("div");
                dropState.registerDropElement(i, {element, dropInfo: {childIdx: i}});
                ref.current.appendChild(element);
            }
            return () => {
                ref.current.replaceChildren();
            }
        }, [dropState, components, components?.length]);

        return ref;
    }

    const useComponentSlots = (components: any, slotPropName: string, slotNames: string[], dropState?: any) => {
        const slots: any = {};
        for (const s of slotNames) {
            slots[s] = {ref: Hooks.useRef(null), hasComponents: false};
        }

        for (const {layoutProperties} of components) {
            slots[layoutProperties[slotPropName]].hasComponents = true;
        }

        Hooks.useLayoutEffect(() => {
            let i = 0;
            for (const {component, layoutProperties} of components) {
                const slot = layoutProperties[slotPropName];
                if (dropState) {
                    const element = document.createElement("div");
                    dropState.registerDropElement(i, {element, dropInfo: {childIdx: i++, layout_properties: {[slotPropName]: slot}}});
                    slots[slot].ref.current.appendChild(element);
                }
                slots[slot].ref.current.appendChild(component.anvil$hooks.domElement);
            }
            if (dropState) {
                for (const s of slotNames) {
                    const element = document.createElement("div");
                    dropState.registerDropElement(i, {element, dropInfo: {childIdx: i++, layout_properties: {[slotPropName]: s}}});
                    slots[s].ref.current.appendChild(element);
                }
            }
            return () => {
                for (const s of slotNames) {
                    slots[s].ref.current?.replaceChildren();
                }
            }
        }, [dropState, components, components?.length]);

        return slots;
    };

    return {ComponentInReact, DropZone, AnvilComponent, useComponentsRef, useComponentSlots};
};

