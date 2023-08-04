import { topLevelForms } from "@runtime/runner/data";
import {
    chainOrSuspend,
    checkCallable,
    checkOneArg,
    checkString,
    copyKeywordsToNamedArgs,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyFalse,
    pyList,
    pyNone,
    pyObject,
    pyStr,
    pyTrue,
    pyTypeError,
    pyValueError,
    typeName,
} from "../@Sk";
import {
    s_get_components,
    s_raise_event,
    s_remove_from_parent,
    s_x_anvil_propagate_page_added,
    s_x_anvil_propagate_page_removed,
    s_x_anvil_propagate_page_shown
} from "../runner/py-util";
import { addEventHandler, Component, ComponentConstructor, getPyParent, initComponentSubclass, isComponent, raiseEventOrSuspend } from "./Component";

// The *real* base Container class.
// It's an abstract base class that provides usable implementations of clear() and raise_event_on_children(),
// relying on the implementer to provide add_component(), get_components(), and propagate page events.

const broadcast = (eventName: pyStr, container: Component) => {
    const components = pyCall(container.tp$getattr(s_get_components), []) as pyList<Component>;
    return chainOrSuspend(null, ...components.valueOf().map((c) => () => raiseEventOrSuspend(c, eventName)));
};

export const validateChild = (c: any, fn = "add_component") => {
    if (!isComponent(c)) {
        throw new pyTypeError(`Argument to ${fn} must be a component, not ` + typeName(c));
    }
    if (getPyParent(c)) {
        throw new pyValueError("This component is already added to a container, call remove_from_parent() first");
    }
    if (topLevelForms.has(c)) {
        const msg = topLevelForms.openForm === c ? "is the open_form" : "is already inside an alert";
        throw new pyValueError(`This component ${msg} and cannot be added to a container`);
    }
};

interface ContainerConstructor extends ComponentConstructor {}
export interface Container extends Component {}

export const Container: ContainerConstructor = Sk.abstr.buildNativeClass("anvil.Container", {
    constructor: function Container() {},
    base: Component,
    slots: {
        tp$new() {
            const self = Component.prototype.tp$new.call(this, []) as Component;

            /** @todo Put this state somewhere where we can examine it to know if we should actually raise this event or not */
            const state = { onPage: false };

            addEventHandler(self, s_x_anvil_propagate_page_added, () => {
                state.onPage = true;
                return broadcast(s_x_anvil_propagate_page_added, self);
            });

            addEventHandler(self, s_x_anvil_propagate_page_removed, () => {
                state.onPage = false;
                return broadcast(s_x_anvil_propagate_page_removed, self);
            });

            addEventHandler(self, s_x_anvil_propagate_page_shown, () =>
                broadcast(s_x_anvil_propagate_page_shown, self)
            );

            return self;
        }
    },
    flags: {
        sk$solidBase: false,
    },
    methods: {
        "clear": {
            $meth() {
                const components = pyCall<pyList<Component>>(this.tp$getattr(s_get_components)).valueOf();
                const fns = components.map((c) => () => pyCallOrSuspend(c.tp$getattr<pyCallable>(s_remove_from_parent)));
                return chainOrSuspend(null, ...fns);
            },
            $flags: { NoArgs: true },
        },
        "raise_event_on_children": {
            $meth(args, kws) {
                checkOneArg("raise_event_on_children", args);
                const pyEventName = args[0];
                if (!checkString(pyEventName)) {
                    throw new pyTypeError("event_name must be a string");
                }
                const components = pyCall<pyList<Component>>(this.tp$getattr(s_get_components)).valueOf();
                const fns = components.map(
                    (c) => () => pyCallOrSuspend(c.tp$getattr<pyCallable>(s_raise_event), [pyEventName], kws)
                );
                return chainOrSuspend(null, ...fns);
            },
            $flags: { FastCall: true },
        },
        "add_component": {
            $meth(args, kws) {
                checkOneArg("add_component", args);
                const component = args[0] as Component;
                const [on_remove, on_set_visibility] = copyKeywordsToNamedArgs(
                    "add_component",
                    ["on_remove", "on_set_visibility"],
                    [],
                    kws,
                    [pyNone, pyNone]
                );
                validateChild(component); // should also be called by subclasses
                let onRemove: () => any = () => null;
                if (on_remove !== pyNone) {
                    if (!checkCallable(on_remove)) {
                        throw new pyValueError(`Container.add_component(): the on_remove argument must be None or a function, not ${Sk.abstr.typeName(on_remove)}`);
                    } else {
                        onRemove = () => pyCall(on_remove, []);
                    }
                } else {
                    onRemove = () => component.anvil$hooks.domElement?.remove();
                }
                let setVisibility: ((v:boolean)=>void) | undefined = undefined;
                if (on_set_visibility !== pyNone) {
                    if (!checkCallable(on_set_visibility)) {
                        throw new pyValueError(`Container.add_component(): the on_set_visibility argument must be None or a function, not ${Sk.abstr.typeName(on_set_visibility)}`);
                    }
                    setVisibility = (v: boolean) => pyCall(on_set_visibility, [v ? pyTrue : pyFalse]);
                }
                return component.anvilComponent$setParent(this, { onRemove, setVisibility });
            },
            $flags: { FastCall: true }
        }
    },
    classmethods: {
        validate_child: {
            $meth(child: any) {
                validateChild(child);
                return pyNone;
            },
            $flags: { OneArg: true }
        }
    }
});

initComponentSubclass(Container);