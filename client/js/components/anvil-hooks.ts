import {
    WrapperDescriptorDef,
    buildNativeClass,
    chainOrSuspend,
    checkNoArgs,
    checkOneArg,
    copyKeywordsToNamedArgs,
    pyAttributeError,
    pyCallOrSuspend,
    pyDict,
    pyGetSetDescriptor,
    pyObject,
    pyStr,
    pyType,
    pyValueError,
    pyWrapperDescriptor,
    retryOptionalSuspensionOrThrow,
    toJs,
    toPy,
    type Suspension,
    remapToJsOrWrap,
} from "@Sk";
import {
    s_anvil_disable_drop_mode,
    s_anvil_dom_element,
    s_anvil_enable_drop_mode,
    s_anvil_events,
    s_anvil_get_container_design_info,
    s_anvil_get_interactions,
    s_anvil_get_section_dom_element,
    s_anvil_get_sections, s_anvil_get_unset_property_values,
    s_anvil_properties,
    s_anvil_set_section_property_values,
    s_anvil_setup_dom,
    s_anvil_update_design_name,
    s_anvil_update_layout_properties,
} from "@runtime/runner/py-util";
import {AnvilHookSpec, AnvilHooks, Component, ComponentConstructor, UnsetPropertyValues} from "./Component";

/**
# The Anvil hook machinery

Every Anvil component has a set of "hooks" that support the component contract.
In the runner this is pretty simple (just getting DOM nodes, basically), but the
designer has a bunch of them (describing properties, interactions, drag-n-drop,
etc).

The goal: These can be called from the JS runtime as JS functions. From Python,
the hooks can be treated as a set of Python methods and attributes prefixed with
_anvil_xxx_, and can be called or overridden by Python code. This machinery is
about making both views of the system correct and consistent.

setupInstanceHooks() is responsible for setting up the anvil$hooks of each
instance of a Component subclass.

JS-defined components set an "anvil$hookSpec" property on the class's prototype.
If present, Component's initSubclass() function uses these to create the Python
methods[*]. When initialising an instance of a class with an anvil$hookSpec
(ie fully defined in JS) setupInstanceHooks() uses these to create anvil$hooks.

[*] In fact, it only does this for own-properties, so a hookSpec can use
    Object.create(...) to inherit hooks from another class without redefining
    every Python wrapper at this level. It's not strictly necessary, but cute.

Python-defined components override none, some or all of the _anvil_xxx_ methods and
attrs. This naturally takes care of the Python side (the Python attrs are either
defined normally or inherited from a Python wrapper of a JS hook on a JS component).
When initialising an instance of a Python-defined component, setupInstanceHooks()
creates a JS proxy object for anvil$hooks. The proxy is responsible for looking up
the corresponding _anvil_xxx_ Python method (via the standard Python method lookup,
so respecting MRO etc) and calling it. The proxy also contains a shortcut for the
case where the Python method it finds is in fact a Python wrapper of a JS hook, so
it calls the JS hook directly.

Thus, when a Python-defined component inherits hooks from a JS-defined component,
it follows all the normal rules for Python method inheritance, but the only actual
overhead is the method resolution (we don't have to convert every arg between JS
and Python).

Forms have a few corner cases:

FormTemplates are a case where a JS-defined component class might inherit from a
Python-defined container. They therefore cannot use the anvil$hookSpec mechanism, as
that would override *all* the parent's hooks. They must therefore specify their
properties, interactions and events in Python-land.

HTML Custom Containers are an edge case, as they redefine add_component() and the
enableDropMode() hook *after* components are created, which means dynamic setup-time
surgery on the anvil$hooks instance. The proxy implementation has set() support
specifically to make this nastiness work. The drawback is that if you inherit from
an HTML custom container, you could get some nasty surprises, as this behaviour will
not respect your overrides. It would be nicer to refactor the HTML Custom Container
logic to be less rude (@todo).

Passive YAML carriers (that is, form YAML being displayed without instantiating the
form itself) are created by instantiating the superclass (ie the container or
WithLayout), then dynamically replacing some anvil$hooks. We could consider
instantiating the FormTemplate instead; that could be less alarming.

Active YAML carriers (that is, the designer view of the editing Form) are created
by instantiating the superclass, then dynamically replacing some anvil$hooks. Namely,
adding the `refreshing_data_bindings` event and `item` property.
*/

type AnvilKeys = keyof AnvilHookSpec;

function wrapNoArgs(name: string, canSuspend?: boolean): WrapperDescriptorDef<Component>["$wrapper"] {
    return function (self, args, kws) {
        checkNoArgs(name, args, kws);
        const rv = this.call(self);
        return canSuspend ? toPy(retryOptionalSuspensionOrThrow(rv)) : chainOrSuspend(rv, toPy);
    };
}
const NoArgs = { NoArgs: true } as const;
const OneArg = { OneArg: true } as const;

const anvilHookPyWrapperDescriptors: Partial<Record<AnvilKeys, WrapperDescriptorDef<Component>>> = {
    setupDom: {
        $name: "_anvil_setup_dom_",
        $wrapper: wrapNoArgs("_anvil_setup_dom_", true),
        $flags: NoArgs,
    },
    updateDesignName: {
        $name: "_anvil_update_design_name_",
        $wrapper(self, args, kws) {
            checkOneArg("_anvil_update_design_name_", args, kws);
            return toPy(this.call(self, args[0].toString()));
        },
        $flags: OneArg,
    },
    getInteractions: {
        $name: "_anvil_get_interactions_",
        $wrapper: wrapNoArgs("_anvil_get_interactions_"),
        $flags: NoArgs,
    },
    getUnsetPropertyValues: {
        $name: "_anvil_get_unset_property_values_",
        $wrapper: wrapNoArgs("_anvil_get_unset_property_values_"),
        $flags: NoArgs,
    },
    getContainerDesignInfo: {
        $name: "_anvil_get_container_design_info_",
        $wrapper(self, args, kws) {
            checkOneArg("_anvil_get_container_design_info_", args, kws);
            const forChild = args[0];
            if (!(forChild instanceof Component)) {
                throw new pyValueError("for_child must be a Component instance");
            }
            return toPy(this.call(self, forChild));
        },
        $flags: OneArg,
    },
    enableDropMode: {
        $name: "_anvil_enable_drop_mode_",
        $wrapper(self, args, _kws) {
            return toPy(this.call(self, toJs(args[0]), toJs(args[1])));
        },
        $flags: {MinArgs: 2, MaxArgs: 2},
    },
    disableDropMode: {
        $name: "_anvil_disable_drop_mode_",
        $wrapper: wrapNoArgs("_anvil_disable_drop_mode_"),
        $flags: NoArgs,
    },
    updateLayoutProperties: {
        $name: "_anvil_update_layout_properties_",
        $wrapper(self, args, kws) {
            const [forChild, updates] = copyKeywordsToNamedArgs(
                "_anvil_update_layout_properties_",
                ["for_child", "updates"],
                args,
                kws,
                []
            );
            if (!(forChild instanceof Component)) {
                throw new pyValueError("for_child must be a Component instance");
            }
            if (!(updates instanceof pyDict)) {
                throw new pyValueError("updates must be a dictionary");
            }
            return toPy(this.call(self, forChild, toJs(updates)));
        },
        $flags: { NamedArgs: ["for_child", "updates"], Defaults: [] },
    },
    getSections: {
        $name: "_anvil_get_sections_",
        $wrapper: wrapNoArgs("_anvil_get_sections_"),
        $flags: NoArgs,
    },
    getSectionDomElement: {
        $name: "_anvil_get_section_dom_element_",
        $wrapper(self, args, kws) {
            const [sectionId] = copyKeywordsToNamedArgs(
                "_anvil_get_section_dom_element_",
                ["section_id"],
                args,
                kws,
                []
            );
            return toPy(this.call(self, toJs(sectionId)));
        },
        $flags: { NamedArgs: ["section_id"], Defaults: [] },
    },
    setSectionPropertyValues: {
        $name: "_anvil_set_section_property_values_",
        $wrapper(self, args, kws) {
            const [sectionId, updates] = copyKeywordsToNamedArgs(
                "_anvil_set_section_property_values_",
                ["section_id", "updates"],
                args,
                kws,
                []
            );
            return toPy(this.call(self, toJs(sectionId), toJs(updates)));
        },
        $flags: { NamedArgs: ["section_id", "updates"], Defaults: [] },
    },
};

const anvilHookPyGetSetDescriptors = {
    getDomElement: (getter: (this: Component) => any) => ({
        $name: "_anvil_dom_element_",
        $get(this: Component) {
            return toPy(getter.call(this));
        },
        $wrapped: getter,
    }),
} as const;

const ObjectHasOwnProp = Object.prototype.hasOwnProperty;

function hasOwnProperty(obj: any, prop: string) {
    return ObjectHasOwnProp.call(obj, prop);
}

const CLS_ATTR_PY_NAME = {
    getProperties: s_anvil_properties,
    getEvents: s_anvil_events,
} as const;

interface _AnvilMagicDescriptor extends pyObject {
    $wrapped(this: Component): any;
}

type PropertyOrEventGetter = NonNullable<AnvilHookSpec["getProperties"] | AnvilHookSpec["getEvents"]>;

interface _AnvilMagicDescriptorConstructor extends pyType<_AnvilMagicDescriptor> {
    new (getter: PropertyOrEventGetter): _AnvilMagicDescriptor;
}

const _AnvilMagicDescriptor: _AnvilMagicDescriptorConstructor = buildNativeClass("anvil.AnvilMagicDescriptor", {
    constructor: function (getter) {
        this.$wrapped = getter;
    },
    slots: {
        tp$descr_get(obj: null | Component, obType) {
            let rv;
            if (obj != null) {
                rv = this.$wrapped.call(obj);
            } else if (obType != null) {
                rv = this.$wrapped.call(obType.prototype as Component);
            }
            if (!rv) return;
            return toPy(rv);
        },
        tp$descr_set(obj, value, canSuspend) {
            throw new pyAttributeError("readonly");
        },
    },
});

function setUpPythonWrappers(cls: ComponentConstructor) {
    const clsProto = cls.prototype;
    const anvilHookSpec = clsProto.anvil$hookSpec as AnvilHookSpec;
    for (const hook of Object.getOwnPropertyNames(anvilHookSpec) as AnvilKeys[]) {
        if (hook === "getDomElement") {
            const pyGetSetCreator = anvilHookPyGetSetDescriptors[hook];
            const jsGetter = anvilHookSpec[hook];
            const pyGetSetDef = pyGetSetCreator(jsGetter);
            cls.tp$setattr(new pyStr(pyGetSetDef.$name), new pyGetSetDescriptor(cls, pyGetSetDef));
        } else if (hook in CLS_ATTR_PY_NAME) {
            const pyName = CLS_ATTR_PY_NAME[hook as keyof typeof CLS_ATTR_PY_NAME];
            const jsGetter = anvilHookSpec[hook] as PropertyOrEventGetter;
            cls.tp$setattr(pyName, new _AnvilMagicDescriptor(jsGetter));
        } else {
            const pyWrapperDef = anvilHookPyWrapperDescriptors[hook];
            if (pyWrapperDef) {
                cls.tp$setattr(
                    new pyStr(pyWrapperDef.$name),
                    new pyWrapperDescriptor(cls, pyWrapperDef, anvilHookSpec[hook])
                );
            }
        }
    }
}

export function setupClsHooks(cls: ComponentConstructor) {
    const clsProto = cls.prototype;
    if (hasOwnProperty(clsProto, "anvil$hookSpec")) {
        setUpPythonWrappers(cls);
    }
}

const noSuspensionWrapper = (rv: pyObject | Suspension) => remapToJsOrWrap(retryOptionalSuspensionOrThrow(rv));

const jsCallWrappers = {
    setupDom: (rv: pyObject | Suspension) => {
        return chainOrSuspend(rv, (pyElement) => {
            const element = toJs(pyElement);
            if (!element) {
                throw new pyValueError(`_anvil_setup_dom_ cannot return None`);
            }
            return element;
        });
    },
    updateDesignName: noSuspensionWrapper,
    getContainerDesignInfo: noSuspensionWrapper,
    enableDropMode: noSuspensionWrapper,
    disableDropMode: noSuspensionWrapper,
    updateLayoutProperties: noSuspensionWrapper,
    getSections: noSuspensionWrapper,
    getSectionDomElement: noSuspensionWrapper,
    setSectionPropertyValues: noSuspensionWrapper,
    getInteractions: noSuspensionWrapper,
    getUnsetPropertyValues: noSuspensionWrapper,
};

const jsToPyName = {
    setupDom: s_anvil_setup_dom,
    domElement: s_anvil_dom_element,
    updateDesignName: s_anvil_update_design_name,
    getContainerDesignInfo: s_anvil_get_container_design_info,
    enableDropMode: s_anvil_enable_drop_mode,
    disableDropMode: s_anvil_disable_drop_mode,
    updateLayoutProperties: s_anvil_update_layout_properties,
    getSections: s_anvil_get_sections,
    getSectionDomElement: s_anvil_get_section_dom_element,
    setSectionPropertyValues: s_anvil_set_section_property_values,
    properties: s_anvil_properties,
    events: s_anvil_events,
    getInteractions: s_anvil_get_interactions,
    getUnsetPropertyValues: s_anvil_get_unset_property_values,
};

function setUpHookProxy(self: Component, cls: ComponentConstructor) {
    const anvil$hooks = new Proxy({} as any, {
        get(target, p) {
            if (p in target) {
                return target[p];
            }
            const pyName = jsToPyName[p as keyof typeof jsToPyName];
            if (pyName === undefined) return;
            const pyAnvilHook = cls.$typeLookup(pyName);
            if (pyAnvilHook === undefined) return;
            const obType = pyAnvilHook.ob$type;
            if (obType === pyWrapperDescriptor) {
                // fast path
                return (...args: any) => pyAnvilHook.d$wrapped.call(self, ...args);
            } else if (obType === pyGetSetDescriptor) {
                // fast path
                return pyAnvilHook.d$def.$wrapped.call(self);
            } else if (obType === _AnvilMagicDescriptor) {
                return pyAnvilHook.$wrapped.call(self);
            } else {
                // we are a python function/descriptor do the slow thing
                const pyValue = pyAnvilHook?.tp$descr_get?.(self, cls) ?? pyAnvilHook;
                if (p in jsCallWrappers) {
                    const jsCallWrapper = jsCallWrappers[p as keyof typeof jsCallWrappers];
                    return (...args: any) => jsCallWrapper(pyCallOrSuspend(pyValue, args.map(toPy)));
                } else {
                    return toJs(pyValue);
                }
            }
        },
        set(target, p, v) {
            target[p] = v;
            return true;
        },
    });

    self.anvil$hooks = anvil$hooks;
}

const specNameToHookName: Record<keyof AnvilHookSpec, keyof AnvilHooks> = {
    setupDom: "setupDom",
    getDomElement: "domElement",
    getProperties: "properties",
    getEvents: "events",
    updateDesignName: "updateDesignName",
    getInteractions: "getInteractions",
    getUnsetPropertyValues: "getUnsetPropertyValues",
    getContainerDesignInfo: "getContainerDesignInfo",
    updateLayoutProperties: "updateLayoutProperties",
    getSections: "getSections",
    getSectionDomElement: "getSectionDomElement",
    setSectionPropertyValues: "setSectionPropertyValues", // 'true' means we don't have a useful update for you. Reload everything.
    cleanupLayoutProperties: "cleanupLayoutProperties",
    enableDropMode: "enableDropMode",
    disableDropMode: "disableDropMode",
};

function setUpHooksFromSpec(self: Component, cls: ComponentConstructor) {
    const clsProto = cls.prototype;

    const anvil$hooks: AnvilHooks = {} as AnvilHooks;
    const hookSpec = clsProto.anvil$hookSpec;
    for (const specName in hookSpec) {
        const hookName = specNameToHookName[specName as keyof AnvilHookSpec];
        const hookSpecFunc = hookSpec[specName].bind(self);
        if (hookName === specName) {
            anvil$hooks[hookName] = hookSpecFunc;
        } else {
            Object.defineProperty(anvil$hooks, hookName, {
                get() {
                    return hookSpecFunc();
                },
                set(v) {
                    delete anvil$hooks[hookName];
                    anvil$hooks[hookName] = v;
                },
                configurable: true,
            });
        }
    }
    self.anvil$hooks = anvil$hooks;
}

export function setupInstanceHooks(self: Component, cls: ComponentConstructor) {
    if (hasOwnProperty(cls.prototype, "anvil$hookSpec")) {
        setUpHooksFromSpec(self, cls);
    } else {
        setUpHookProxy(self, cls);
    }
}
