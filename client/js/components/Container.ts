import { topLevelForms } from "@runtime/runner/data";
import {
    chainOrSuspend,
    checkCallable,
    checkInt,
    checkOneArg,
    checkString,
    copyKeywordsToNamedArgs,
    isTrue,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyFalse,
    pyList,
    pyNone,
    pyStr,
    pySuper,
    pyTrue,
    pyTypeError,
    pyValueError,
    toJs,
    typeLookup,
    typeName,
} from "../@Sk";
import {
    initNativeSubclass,
    s_get_components,
    s_init_subclass,
    s_raise_event,
    s_remove_from_parent,
} from "../runner/py-util";
import { Component, ComponentConstructor, getPyParent, isComponent, raiseEventOrSuspend } from "./Component";

// The *real* base Container class.
// It's an abstract base class that provides usable implementations of clear() and raise_event_on_children(),
// It provides a basic implementation of add_component, get_components
// Container.get_components() is only implemented if the subclass does not implement get_components
// Container.add_component() ensures the parent/child link and this must be called by a subclass
// A subclass will need to implement adding children to the dom

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

interface ContainerConstructor extends ComponentConstructor {
    new (): Container;
}

export interface Container extends Component {
    _Container: {
        components?: Component[];
    };
}

export const Container: ContainerConstructor = Sk.abstr.buildNativeClass("anvil.Container", {
    constructor: function Container() {},
    base: Component,
    methods: {
        clear: {
            $meth() {
                const components = pyCall<pyList<Component>>(this.tp$getattr(s_get_components)).valueOf();
                const fns = components.map(
                    (c) => () => pyCallOrSuspend(c.tp$getattr<pyCallable>(s_remove_from_parent))
                );
                return chainOrSuspend(pyNone, ...fns);
            },
            $flags: { NoArgs: true },
        },
        raise_event_on_children: {
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
        get_components: {
            $meth() {
                return new pyList([...(this._Container.components ?? [])]);
            },
            $flags: { NoArgs: true },
        },
        add_component: {
            $meth(args, kws) {
                checkOneArg("add_component", args);
                const component = args[0] as Component;
                const [on_remove, on_set_visibility, mounted, index] = copyKeywordsToNamedArgs(
                    "add_component",
                    ["on_remove", "on_set_visibility", "mounted", "index"],
                    [],
                    kws,
                    [pyNone, pyNone, pyTrue, pyNone]
                );
                if (index !== pyNone && !checkInt(index)) {
                    throw new pyValueError("Container.add_component(): index must be an integer or None");
                }
                validateChild(component); // should also be called by subclasses
                const ownComponentsList = this._Container.components;
                ownComponentsList?.splice(toJs(index) ?? ownComponentsList.length, 0, component);
                const removeFromDefaultComponents =
                    ownComponentsList &&
                    (() => {
                        const idx = ownComponentsList.indexOf(component);
                        if (idx !== -1) {
                            ownComponentsList.splice(idx, 1);
                        }
                    });
                let onRemove: () => any = removeFromDefaultComponents ?? (() => null);
                if (on_remove !== pyNone) {
                    if (!checkCallable(on_remove)) {
                        throw new pyValueError(
                            `Container.add_component(): the on_remove argument must be None or a function, not ${Sk.abstr.typeName(
                                on_remove
                            )}`
                        );
                    } else {
                        onRemove = () => {
                            removeFromDefaultComponents?.();
                            return pyCall(on_remove, []);
                        };
                    }
                } else {
                    onRemove = () => {
                        removeFromDefaultComponents?.();
                        component.anvil$hooks.domElement?.remove();
                    };
                }
                let setVisibility: ((v: boolean) => void) | undefined = undefined;
                if (on_set_visibility !== pyNone) {
                    if (!checkCallable(on_set_visibility)) {
                        throw new pyValueError(
                            `Container.add_component(): the on_set_visibility argument must be None or a function, not ${Sk.abstr.typeName(
                                on_set_visibility
                            )}`
                        );
                    }
                    setVisibility = (v: boolean) => pyCall(on_set_visibility, [v ? pyTrue : pyFalse]);
                }
                return component.anvilComponent$setParent(this, {
                    onRemove,
                    setVisibility,
                    isMounted: isTrue(mounted),
                });
            },
            $flags: { FastCall: true },
        },
    },
    classmethods: {
        validate_child: {
            $meth(child: any) {
                validateChild(child);
                return pyNone;
            },
            $flags: { OneArg: true },
        },
        __init_subclass__: {
            $meth(args, kws) {
                makeContainer(this);
                const superInit = new pySuper(Container, this).tp$getattr<pyCallable>(s_init_subclass);
                return pyCallOrSuspend(superInit, args, kws);
            },
            $flags: { FastCall: true },
        },
    },
    flags: {
        sk$solidBase: false,
    },
});


const CONTAINER_GET_COMPONENTS = typeLookup(Container, s_get_components);

/**
 * We would normally want to do this in tp$new but Container isn't a solid base
 * and so tp$new isn't guaranteed to be called
 * This is a bit of a hack
 * It makes `._Container` a lazy attribute on the prototype
 * when an instance accesses the getter we override `._Container` on the instance
 */
function makeContainer(ContainerCls: ContainerConstructor) {
    const inheritsGetComponents = ContainerCls.$typeLookup(s_get_components) === CONTAINER_GET_COMPONENTS;
    const clsProto = ContainerCls.prototype;
    Object.defineProperty(clsProto, "_Container", {
        get() {
            // weird case where we do ContainerCls.prototype._Container
            if (this === clsProto) return {};
            // `this` is the instance and we use Object.defineProperty to override the inherited getter
            // we can't just do `this._Container = {};`
            Object.defineProperty(this, "_Container", { value: {}, writable: true });
            if (inheritsGetComponents) {
                this._Container.components = [];
            }
            return this._Container;
        },
        configurable: true,
    });
}

makeContainer(Container);
initNativeSubclass(Container);