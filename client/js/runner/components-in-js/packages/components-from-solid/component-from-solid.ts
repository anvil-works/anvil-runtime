// Archived experimental implementation moved under components-in-js/packages.
// Not wired into runtime entrypoints and excluded from runtime tsconfig checks.

import {
    buildNativeClass,
    chainOrSuspend,
    Kws,
    pyCallable,
    pyCallOrSuspend,
    pyNone,
    pyObject,
    pyStr,
    pyTypeError,
    suspensionToPromise,
    toJs,
    toPy,
    typeLookup,
} from "@Sk";
import {
    Component,
    ComponentConstructor,
    CustomComponentSpec,
    EventDescription,
    IGNORE_PROPERTY_EXCEPTIONS_KW,
    PropertyDescription,
} from "../../../../components/Component";
import { Container } from "../../../../components/Container";
import PyDefUtils from "PyDefUtils";
import { designerApi } from "../../../component-designer-api";
import { initNativeSubclass, kwsToJsObj, s_raise_event } from "../../../py-util";
import { registerModule } from "../../common";

const solid: any = {};

let _loaded = false;

async function loadSolid() {
    if (_loaded) return;
    const getModule = new Function("url", "return import(url);");
    Object.assign(solid, await getModule("https://cdn.skypack.dev/solid-js"), {
        web: await getModule("https://cdn.skypack.dev/solid-js/web"),
        store: await getModule("https://cdn.skypack.dev/solid-js/store"),
        html: (await getModule("https://cdn.skypack.dev/solid-js/html")).default,
    });
    _loaded = true;
}

interface SolidComponentDefinition extends CustomComponentSpec {
    component(props: any): any;
}

interface SolidComponentConstructor extends ComponentConstructor {
    new (): SolidComponent;
}

interface SolidComponent extends Component {
    rootElement: HTMLElement;
}

const pyRaiseEvent = typeLookup<pyCallable>(Component, s_raise_event);

function raiseEvent(this: SolidComponent, eventName: string, kws: object = {}) {
    const pyKw: Kws = [];
    for (const [k, v] of Object.entries(kws)) {
        pyKw.push(k, toPy(v));
    }
    return suspensionToPromise(() => pyCallOrSuspend(pyRaiseEvent, [this, new pyStr(eventName)], pyKw));
}

function mkComponentClass({
    name,
    events = [],
    properties = [],
    component = () => {},
    container = false,
}: SolidComponentDefinition) {
    const pyEvents = toPy(events || []);
    const leafName = name.match(/[^.]+$/);

    const initPropertyState = Object.fromEntries(properties.map(({ name, defaultValue }) => [name, defaultValue]));

    const SolidComponent: SolidComponentConstructor = buildNativeClass(name + "." + leafName, {
        base: container ? Container : Component,
        constructor: function SolidComponent() {
            const dropZones: { [id: string | number]: any } = {};

            const actions = { raiseEvent: raiseEvent.bind(this) };
            const [props, setProps] = solid.store.createStore({ ...initPropertyState });
            const [dropState, setDropState] = solid.createSignal(null);
            const [components, setComponents] = solid.store.createStore([]);
            Object.assign(this, { components, setComponents, props, setProps, dropZones, dropState, setDropState });

            Object.defineProperty(this, "rootElement", {
                get() {
                    delete this.rootElement;
                    return (this.rootElement = solid.createRoot(() => component({ actions, props, dropState, components })));
                },
                configurable: true,
            });
        },
        slots: {
            tp$new(args, kws = []) {
                const p = loadSolid().then(() => {
                    const self = Component.prototype.tp$new.call(this, args, kws);
                    for (let i = 0; i < kws.length; i += 2) {
                        const k = kws[i];
                        const v = kws[i + 1] as pyObject;
                        if (k !== IGNORE_PROPERTY_EXCEPTIONS_KW) {
                            self.tp$setattr(new pyStr(k), v);
                        }
                    }
                    return self;
                });
                return PyDefUtils.suspensionFromPromise(p);
            },
        },
        methods: {
            add_component: {
                $meth(args, kws) {
                    if (args.length !== 1 || !(args[0] instanceof Component)) {
                        throw new pyTypeError(
                            "add_component() takes only one positional argument, which must be a Component"
                        );
                    }
                    const component = args[0];
                    component.anvilComponent$setParent(this, {
                        onRemove: () => {
                            this.setComponents(this.components.filter((entry: any) => entry.component !== component));
                        },
                    });
                    const layoutProperties = kwsToJsObj(kws);
                    return chainOrSuspend(component.anvil$hooks.setupDom(), (element) => {
                        this.setComponents(this.components.length, { component, element, layoutProperties });
                        return pyNone;
                    });
                },
                $flags: { FastCall: true },
            },
        },
        getsets: Object.fromEntries(
            properties.map(({ name }) => [
                name,
                {
                    $get() {
                        return toPy(this.props[name]);
                    },
                    $set(v) {
                        this.setProps(name, toJs(v));
                    },
                },
            ])
        ),
        flags: { sk$klass: true },
        proto: {
            anvil$events: pyEvents,
            anvil$hookSpec: {
                setupDom(this: SolidComponent) {
                    return this.rootElement;
                },
                getDomElement() {
                    return (this as unknown as SolidComponent).rootElement;
                },
                getProperties() {
                    return properties;
                },
                getEvents() {
                    return events;
                },
                getInteractions(this: SolidComponent) {
                    return this.getInteractions?.() || [];
                },
                getContainerDesignInfo(this: SolidComponent) {
                    return {
                        layoutPropertyDescriptions: [{ name: "classes", type: "string", isLayoutProperty: true }],
                    };
                },
                updateLayoutProperties(this: SolidComponent, forChild: Component, newValues: any) {
                    const idx = this.components.findIndex(({ component }: any) => component === forChild);
                    this.setComponents(idx, (prev: any) => ({
                        ...prev,
                        layoutProperties: { ...prev.layoutProperties, ...newValues },
                    }));
                    return newValues;
                },
                enableDropMode(this: SolidComponent, dropping: any) {
                    if (!container) return [];
                    this.setDropState({
                        registerDropElement(id: string | number, dropElement: any) {
                            this.dropZones[id] = dropElement;
                        },
                    });
                    return Object.values(this.dropZones).map((entry: any) => ({
                        element: entry.element,
                        expandable: entry.expandable,
                        dropInfo: entry.dropInfo,
                    }));
                },
                disableDropMode(this: SolidComponent) {
                    this.setDropState(null);
                    this.dropZones = {};
                },
            },
        },
    });

    initNativeSubclass(SolidComponent);
    return SolidComponent;
}

const solidComponentToSpec = ({
    name,
    events,
    container,
    layoutProperties,
    properties,
    showInToolbox,
}: SolidComponentDefinition) => ({ name, events, container, layoutProperties, properties, showInToolbox });

export const registerSolidComponent = (component: SolidComponentDefinition) => {
    const leafName = component.name.replace(/^.*\./, "");
    registerModule(component.name, { [leafName]: mkComponentClass(component) }, solidComponentToSpec(component));
};

function maybeCallable(p: any) {
    return typeof p === "function" ? p() : p;
}

function DropZone(props: any) {
    return () => {
        const dropState = maybeCallable(props.dropState);
        return (
            dropState &&
            solid.html`<div class=${() => maybeCallable(props.class) ?? ""}
            ref=${(element: any) =>
                dropState.registerDropElement(maybeCallable(props.dropId), {
                    element,
                    expandable: maybeCallable(props.expandable),
                    dropInfo: maybeCallable(props.dropInfo),
                })}
        ></div>`
        );
    };
}

export const solidComponents = { DropZone };

// Kept only as a handy reference for future experiments.
// This module is intentionally not used by the active runtime.
void designerApi;
