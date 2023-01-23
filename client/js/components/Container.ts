import {
    chainOrSuspend, checkOneArg, checkString, pyCall, pyCallable, pyCallOrSuspend, pyFunc, pyList, pyNone,
    pyNoneType, pyObject, pyStr, pyTypeError, Suspension
} from "../@Sk";
import {
    s_get_components,
    s_raise_event,
    s_remove_from_parent,
    s_x_anvil_propagate_page_added,
    s_x_anvil_propagate_page_removed,
    s_x_anvil_propagate_page_shown
} from "../runner/py-util";
import {addEventHandler, Component, ComponentConstructor, initComponentSubclass, raiseEventOrSuspend} from "./Component";

// The *real* base Container class.
// It's an abstract base class that provides usable implementations of clear() and raise_event_on_children(),
// relying on the implementer to provide add_component(), get_components(), and propagate page events.

const broadcast = (eventName: pyStr, container: Component) => {
    const components = pyCall(container.tp$getattr(s_get_components), []) as pyList<Component>;
    return chainOrSuspend(null, ...components.valueOf().map((c) => () => raiseEventOrSuspend(c, eventName)));
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
    },
});

initComponentSubclass(Container);