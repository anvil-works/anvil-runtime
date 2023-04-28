import * as PyDefUtils from "../PyDefUtils";
import { addFormComponentsToLayout, setupFormComponents, SetupResult } from "./component-creation";
import type { ComponentYaml, DataBindingYaml, FormContainerYaml, FormLayoutYaml, FormYaml } from "./data";
import {
    kwToObj,
    PyModMap,
    s_add_component,
    s_add_event_handler,
    s_anvil_events,
    s_item,
    s_raise_event,
    s_refreshing_data_bindings,
    s_slots,
} from "./py-util";
import { WithLayout } from "./python-objects";
import {
    Args,
    chainOrSuspend,
    iterForOrSuspend,
    pyBaseException,
    pyBuiltinFunctionOrMethod,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyIter,
    pyKeyError,
    pyList,
    pyDict,
    pyNewableType,
    pyNone,
    pyStr,
    retryOptionalSuspensionOrThrow,
    Suspension,
    toPy,
    tryCatchOrSuspend,
} from "../@Sk";
import type { pyObject, pyTuple, Kws } from "../@Sk";
import { AnvilHooks, Component, setDefaultDepId } from "../components/Component";
import {getAnvilComponentClass, kwargsToJsObject, objectToKwargs, resolveStringComponent} from "./instantiation"; // for type stub
import { BindingError, CustomAnvilError, isCustomAnvilError } from "./error-handling";
import { designerApi } from "./component-designer-api";

const walkComponents = (
    yaml: FormYaml,
    fn: (c: ComponentYaml) => void,
    containerFn: ((c: FormContainerYaml) => void) | null = null
) => {
    const walkComponent = (yaml: ComponentYaml) => {
        fn(yaml);
        yaml.components?.forEach(walkComponent);
    };
    if (yaml.container) {
        containerFn?.(yaml.container);
        yaml.components?.forEach(walkComponent);
    } else {
        Object.values(yaml.components_by_slot ?? [])
            .flat()
            .forEach(walkComponent);
    }
};

export interface DataBinding extends DataBindingYaml {
    pyUpdate?: pyCallable;
    pyClear?: pyCallable;
    pySave?: pyCallable;
    pyComponent: Component;
    componentName: string;
}
interface DataBindings {
    [componentName: string]: DataBinding[];
}

// typeguard to distinguish between ComponentYaml and FormContainerYaml
const isComponent = (yaml: ComponentYaml | FormContainerYaml): yaml is ComponentYaml => "name" in yaml;

const setupDataBindings = (yaml: FormYaml) => {
    const dataBindings: DataBindings = {};
    const walk = (component: ComponentYaml | FormContainerYaml) => {
        const thisComponentBindings = [];
        for (const binding of component.data_bindings || []) {
            if(!binding.code) { continue; }
            const readCode = "def update_val(self, _anvil_component):\n" +
                "  _anvil_component." + binding.property + " = " + binding.code + "\n" +
                "def clear_val(self, _anvil_component):\n" +
                "  _anvil_component." + binding.property + " = None\n";
            // TODO: Check whether we actually allowBindingWriteback on this binding property. This is not as simple as
            // looking at the propMap of binding.pyComponent, because they could be custom component properties, which
            // aren't registered anywhere on the instance.
            const writeCode = (binding.writeback ?
                "def save_val(self, _anvil_component):\n" +
                "  " + binding.code + " = _anvil_component." + binding.property + "\n"
                : "");

            let modlocs;
            let bmod;
            try {
                bmod = Sk.compile(readCode + writeCode, "update_binding.py", "exec", true);
            } catch (e) {
                const name = isComponent(component) ? `self.${component.name}` : "self";
                // Usability: detect the "chose writeback but didn't give an lvalue" situation
                if (binding.writeback) {
                    let readCompiledOk = false;
                    try {
                        Sk.compile(readCode, "update_binding.py", "exec", true);
                        readCompiledOk = true;
                    } catch (e) {
                        // ignore compile error
                    }
                    if (readCompiledOk) {
                        throw new Sk.builtin.SyntaxError("Can't assign to data binding expression for " + name + "." + binding.property + ", but writeback is enabled for this data binding.");
                    }
                }
                throw new Sk.builtin.SyntaxError("Syntax error in data binding for " + name + "." + binding.property);
            }
            modlocs = eval(bmod.code + "\n" + bmod.funcname + "({__name__: new Sk.builtin.str('update_binding')});\n");
            modlocs = Sk.misceval.retryOptionalSuspensionOrThrow(modlocs);

            thisComponentBindings.push({
                pyUpdate: modlocs["update_val"],
                pyClear: modlocs["clear_val"],
                pySave: modlocs["save_val"],
                ...binding,
            });
        }
        dataBindings[isComponent(component) ? component.name : ""] = thisComponentBindings as DataBinding[];
    };
    walkComponents(yaml, walk, walk);
    return dataBindings;
};

const applyBindings = (pyForm: FormTemplate, dataBindings: DataBindings) => {
    const writeBackChildBoundData = async (bindingsForThisComponent: DataBinding[], pyComponent: Component, attrName: string) => {
        for (const binding of bindingsForThisComponent) {
            if (binding.pyComponent === pyComponent && binding.property === attrName && binding.pySave) {
                try {
                    return await PyDefUtils.callAsyncWithoutDefaultError(binding.pySave, undefined, undefined, undefined, pyForm, pyComponent);
                } catch (e) {
                    if (e instanceof Sk.builtin.KeyError) {
                        return; // Unremarkable
                    }
                    console.error(e);
                    if (e instanceof Sk.builtin.BaseException && e.args.v[0] instanceof Sk.builtin.str) {
                        const name = binding.componentName ? `self.${binding.componentName}` : "self";
                        e.args.v[0] = new Sk.builtin.str(e.args.v[0].v + "\n while setting " + binding.code + " = " + name + "." + binding.property + "\n in a data binding for " + name);
                    }
                    window.onerror(null, null, null, null, e);
                }
            }
        }
    };

    for (const [componentName, bindings] of Object.entries(dataBindings)) {
        const pyComponent = componentName ? (pyForm.$d.quick$lookup(new pyStr(componentName)) as Component) : pyForm;
        for (const binding of bindings) {
            binding.pyComponent = pyComponent;
            binding.componentName = componentName;
        }
        (pyComponent as Component).anvil$hooks.setDataBindingListener((pyComponent: Component, attrName: string) =>
            writeBackChildBoundData(bindings, pyComponent, attrName)
        );
    }
};

// TODO we're walking the component graph a few too many times here (bindings and this).
// We might want to use a visitor pattern with createComponents.
const getComponentNames = (formYaml: FormYaml) => {
    const componentNames = new Set();
    walkComponents(formYaml, (yaml: ComponentYaml) => componentNames.add(yaml.name));
    return componentNames;
};

export const FORM_EVENTS = [
    {name: "show", description: "When the form is shown on the page",
        parameters: [], important: true},
    {name: "hide", description: "When the form is removed from the page",
        parameters: [], important: true},
    {name: "refreshing_data_bindings", important: true, parameters: [],
        description: "When refresh_data_bindings is called"},
];
const FORM_EVENTS_BY_NAME = Object.fromEntries(FORM_EVENTS.map(event => [event.name, event]));

/*!componentProp(form)!1*/
export const ITEM_PROPERTY = {
    name: "item",
    type: "dict",
    description: "A dictionary-like object connected to this form",
    pyVal: true,
};

export function setupCustomComponentHooks(yaml: FormYaml, c: Component, kws: Kws, passive = false) {
    if (!ANVIL_IN_DESIGNER) return;

    const oldHooks = c.anvil$hooks;
    c.anvil$hooks = {
        setupDom: oldHooks.setupDom,
        get domElement() { return oldHooks.domElement },
        setDataBindingListener: oldHooks.setDataBindingListener,
        enableDropMode: oldHooks.enableDropMode,
        disableDropMode: oldHooks.disableDropMode,
    };
    // TODO: include the item property here

    if (!yaml.custom_component) {
        c.anvil$hooks.getDesignInfo = () => ({
            propertyDescriptions: [ITEM_PROPERTY],
            propertyValues: {item: null},
            events: FORM_EVENTS_BY_NAME,
            interactions: [],
        });
        return;
    }

    const { properties = [], events = [] } = yaml;

    const kwsObj = kwargsToJsObject(kws);

    Object.assign(c.anvil$hooks, {
        getDesignInfo: () => ({
            propertyDescriptions: properties,
            events: {
                ...FORM_EVENTS_BY_NAME,
                ...Object.fromEntries(events.map(({ name, description, parameters, default_event: defaultEvent }) => [
                    name,
                    {
                        name,
                        description,
                        parameters,
                        defaultEvent,
                    },
                ]))
            },
            propertyValues: Object.fromEntries(
                properties.map(({ name, default_value }) => [name, name in kwsObj ? kwsObj[name] : default_value])
            ),
            interactions: [],
        }),
        setPropertyValues(updates) {
            Object.assign(kwsObj, updates);
            designerApi.updateComponentProperties(c, updates, {});
            if (passive) return;
            for (const [key, val] of Object.entries(updates)) {
                c.tp$setattr(new pyStr(key), toPy(val));
            }
        },
    } as Partial<AnvilHooks>);
}

type FormTemplateConstructor = pyNewableType<FormTemplate>;

export interface FormTemplate extends Component {
    $d: pyDict;
    anvil$formState: {
        refreshOnItemSet: boolean;
        dataBindings: DataBinding[];
        slotDict: pyDict;
    };
    anvil$itemValue?: pyObject;
    _anvil?: any;
}

export const createFormTemplateClass = (
    yaml: FormYaml,
    depId: string | null,
    className: string,
    anvilModule: PyModMap
): FormTemplateConstructor => {
    const pyBase = yaml.container ? (
        getAnvilComponentClass(anvilModule, yaml.container.type)!
        || resolveStringComponent(yaml.container.type.substring(5), depId)
    ) : WithLayout;

    // Legacy bits of _anvil we can't get rid of yet
    const _anvil: any = {};
    if (yaml.custom_component) {
        _anvil.customComponentEventTypes = Object.fromEntries((yaml.events || []).map((e) => [e.name, e]));
        _anvil.customComponentProperties = yaml.properties;
    }

    const dataBindings = setupDataBindings(yaml);
    const componentNames = getComponentNames(yaml);

    // "item" is a special descriptor that triggers the underlying descriptor on write if there is one.
    const pyBaseItem = pyBase.$typeLookup(s_item);

    return PyDefUtils.mkComponentCls(anvilModule, className + "Template", {
        base: pyBase,

        kwargs: yaml.layout ? ["layout", { type: yaml.layout.type, defaultDepId: depId }] : undefined,

        /*!componentEvents(form)!1*/
        events: FORM_EVENTS,

        properties: [],

        locals($loc: { [key: string]: pyObject }) {
            // The setup code is *mostly* in common between __new__ and __new_deserialized__, except for
            // components (__new_deserialized__ already has the objects, whereas __new__ needs to
            // instantiate them), so we keep it mostly in common

            const baseConstructionArgs: Args = [];
            if (!yaml.container) {
                const onCreateLayout = new pyBuiltinFunctionOrMethod({
                    $meth(pyLayout: Component, pyForm: WithLayout) {
                        return chainOrSuspend(addFormComponentsToLayout(yaml, pyForm, pyLayout), () => pyNone);
                    },
                    $flags: { MinArgs: 2, MaxArgs: 2 },
                });
                baseConstructionArgs.push(onCreateLayout);
            }
            const subYaml = yaml.container || yaml.layout as FormContainerYaml | FormLayoutYaml;
            const baseConstructionKwargs: Kws = objectToKwargs({__ignore_property_exceptions: true, ...(subYaml.properties || {})});
            const baseNew = Sk.abstr.typeLookup<pyCallable>(pyBase, Sk.builtin.str.$new);

            const skeletonNew = (cls: FormTemplateConstructor) => {
                setDefaultDepId(depId);
                return pyCallOrSuspend<FormTemplate>(baseNew, [cls, ...baseConstructionArgs], baseConstructionKwargs);
            };

            // Back half of __new__ for conventionally constructed objects;
            // __deserialize__ for deserialized ones
            const commonSetup = (c: FormTemplate, setupComponents: (c: FormTemplate) => void | Suspension | Component | SetupResult) => {

                // Set up legacy things
                if (c._anvil) {
                    Object.assign(c._anvil, _anvil);
                    c._anvil.props["item"] = new Sk.builtin.dict([]);
                }


                c.anvil$formState = {
                    refreshOnItemSet: true,
                    dataBindings: [],
                    slotDict: new pyDict(),
                };

                return chainOrSuspend(setupComponents(c),
                    () => {
                        applyBindings(c, dataBindings);
                        return c;
                    }
                );
            };

            $loc["__new__"] = new Sk.builtin.func(
                PyDefUtils.withRawKwargs((kws: Kws, cls: FormTemplateConstructor) => {
                    return chainOrSuspend(skeletonNew(cls), (c) =>
                        commonSetup(c, (c: FormTemplate) =>
                            chainOrSuspend(setupFormComponents(yaml, c), (setupResult) => {
                                if (setupResult.slots) {
                                    for (const [name, slot] of Object.entries(setupResult.slots)) {
                                        c.anvil$formState.slotDict.mp$ass_subscript(new pyStr(name), slot);
                                    }
                                }
                                setupCustomComponentHooks(yaml, c, kws);
                            })
                        )
                    );
                })
            );


            $loc["__new_deserialized__"] = PyDefUtils.mkNewDeserializedPreservingIdentity((self: FormTemplate, pyData: pyDict, _pyGlobalData: any) => {
                const pyComponents = pyData.mp$subscript(new Sk.builtin.str("c"));
                const pyLocalDict = pyData.mp$subscript(new Sk.builtin.str("d"));
                const pyAttrs = pyData.mp$subscript(new Sk.builtin.str("a"));

                function setupComponents(c: FormTemplate) {
                    const addComponent = c.tp$getattr<pyCallable>(s_add_component);
                    return Sk.misceval.chain(
                        // First, add_component() all our contents
                        Sk.misceval.iterFor(Sk.abstr.iter(pyComponents), (pyC: pyTuple<[Component, pyDict]>) => {
                            const [pyComponent, pyLayoutProps] = pyC.v;
                            return Sk.misceval.apply(addComponent, pyLayoutProps, undefined, [], [pyComponent]);
                        }),
                        // Set up our __dict__, then
                        // crawl all over our component tree, wiring up
                        // events
                        () => {
                            const update = c.$d.tp$getattr<pyCallable>(new pyStr("update"));
                            pyCall(update, [pyLocalDict]);

                            function wireUpEvents(pyComponent: Component, yaml: FormContainerYaml | ComponentYaml) {
                                const addEventHandler = pyComponent.tp$getattr<pyCallable>(s_add_event_handler);
                                for (const eventName in yaml.event_bindings) {
                                    const pyHandler = c.tp$getattr(new pyStr(yaml.event_bindings[eventName]));
                                    if (pyHandler) {
                                        pyCall(addEventHandler, [new pyStr(eventName), pyHandler]);
                                    }
                                }
                            }

                            if (yaml.container) {
                                wireUpEvents(c, yaml.container);
                            }

                            function walkComponents(components: ComponentYaml[]) {
                                for (const yaml of components || []) {
                                    const pyComponent = c.tp$getattr(new pyStr(yaml.name)) as Component;
                                    wireUpEvents(pyComponent, yaml);
                                    if (yaml.components) {
                                        walkComponents(yaml.components);
                                    }
                                }
                            }

                            walkComponents(yaml.components ?? []);

                            applyBindings(c, dataBindings);
                        },
                        // We set our component attrs last (this could trigger user code that expects
                        // everything to be in its place)
                        () => {
                            const items = pyAttrs.tp$getattr<pyCallable>(new pyStr("items"));
                            return iterForOrSuspend(pyIter<pyTuple<[pyStr, pyObject]>>(pyCall(items)), (pyItem) => {
                                const [pyName, pyValue] = pyItem.v;
                                return c.tp$setattr(pyName, pyValue, true);
                            });
                        },
                    );
                }

                return commonSetup(self, setupComponents);
            }, skeletonNew);


            $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity(function (self: FormTemplate) {
                // We serialise our components, our object dict, and the properties of our container
                // type separately

                const d = self.$d;
                try {
                    Sk.abstr.objectDelItem(d, new Sk.builtin.str("_serialization_key"));
                } catch (e) {
                    // ignore KeyError
                }

                const a = new Sk.builtin.dict();
                let components = [];
                // Serialise legacy _anvil
                if (self._anvil) {
                    for (const n in self._anvil.props) {
                        a.mp$ass_subscript(new Sk.builtin.str(n), self._anvil.props[n]);
                    }

                    components = self._anvil.components.map(
                        (c: { component: Component; layoutProperties: { [prop: string]: any } }) =>
                            new Sk.builtin.tuple([c.component, toPy(c.layoutProperties)])
                    );
                }

                // Custom component properties need no special handling - they are reflected in
                // __dict__ or elsewhere

                return new Sk.builtin.dict([
                    new Sk.builtin.str("d"), d,
                    new Sk.builtin.str("a"), a,
                    new Sk.builtin.str("c"), new Sk.builtin.list(components),
                ]);

            });


            // Kept for backwards compatibility.
            $loc["init_components"] = $loc["__init__"] = PyDefUtils.funcFastCall(function __init__(args: Args, pyKwargs?: Kws) {
                Sk.abstr.checkArgsLen("init_components", args, 1, 1);
                const self = args[0] as FormTemplate;
                // Sort out property attrs.
                const validKwargs = new Set(["item"]);

                const propMap = kwToObj(pyKwargs);

                if (yaml.custom_component) {
                    for (const {name, type, default_value} of yaml.properties || []) {
                        validKwargs.add(name);
                        if (type !== "object" && !(name in propMap)) {
                            propMap[name] = toPy(default_value);
                        }
                    }
                }

                const propAttrs: [string, pyObject][] = [];
                // Overwrite any valid props we were given as kwargs.
                for (const [propName, pyPropVal] of Object.entries(propMap)) {
                    if (validKwargs.has(propName)) {
                        propAttrs.push([propName, pyPropVal]);
                    } else if (propName !== "__ignore_property_exceptions") {
                        console.log("Ignoring form constructor kwarg: ", propName);
                    }
                }

                return Sk.misceval.chain(
                    undefined,
                    () => {
                        self.anvil$formState.refreshOnItemSet = false;
                    },
                    ...propAttrs.map(([propName, pyPropVal]) => () => self.tp$setattr(new Sk.builtin.str(propName), pyPropVal, true)),
                    () => {
                        self.anvil$formState.refreshOnItemSet = true;
                    },
                    () =>
                        Sk.misceval.tryCatch(
                            () => PyDefUtils.pyCallOrSuspend(self.tp$getattr(new Sk.builtin.str("refresh_data_bindings"))),
                            (e) => {
                                if (e instanceof Sk.builtin.BaseException && e.args.v[0] instanceof Sk.builtin.str) {
                                    e.args.v[0] = new Sk.builtin.str(
                                        e.args.v[0].v + ". Did you initialise all data binding sources before initialising this component?"
                                    );
                                }
                                throw e;
                            }
                        )
                );
            });

            if (yaml.custom_component) {
                // Create property descriptors for custom properties.
                (yaml.properties || []).forEach((pt) => {
                    $loc[pt.name] = PyDefUtils.pyCall(anvilModule["CustomComponentProperty"], [new pyStr(pt.name), toPy(pt.default_value || null)]);
                });
            }

            if (yaml.slots) {
                $loc["slots"] = new Sk.builtin.property(
                    new Sk.builtin.func((self: FormTemplate) => {
                        return self.anvil$formState.slotDict;
                    })
                );
            }

            $loc["refresh_data_bindings"] = new Sk.builtin.func(function (self) {

                const bindingErrors: BindingError[] = [];

                // TODO: Confirm that we want to refresh even if 'item' is None - we don't necessarily just bind to item.
                //var item = self.tp$getattr(new Sk.builtin.str("item"));
                //if (!item || item === Sk.builtin.none.none$) { return Sk.builtin.none.none$; }

                const chained: (() => pyObject | void | Suspension)[] = [() => pyCallOrSuspend(self.tp$getattr(s_raise_event), [s_refreshing_data_bindings])];

                if (self._anvil?.onRefreshDataBindings) {
                    chained.push(self._anvil.onRefreshDataBindings);
                }

                for (const [componentName, bindings] of Object.entries(dataBindings)) {
                    const pyComponent = self.$d.quick$lookup(new pyStr(componentName));

                    const tryCatchBinding = ({ property, code, pyUpdate, pyClear }: DataBinding) => {
                        const doUpdate = () => pyUpdate && pyCallOrSuspend(pyUpdate, [self, pyComponent]);

                        const handleErr = (e: any) => {
                            if (e instanceof pyKeyError) {
                                return pyClear && pyCallOrSuspend(pyClear, [self, pyComponent]);
                            }
                            if (!(e instanceof pyBaseException) || !(e.args.v[0] instanceof pyStr)) {
                                // Not sure what sort of error this was. Throw it to be safe.
                                throw e;
                            }
                            e.traceback.pop();
                            // This error could contain multiple other binding errors (eg from interior forms) - flatten the list.
                            if (isCustomAnvilError(e) && e._anvil.errorObj.bindingErrors) {
                                bindingErrors.push(...e._anvil.errorObj.bindingErrors);
                                // Special case: Preserve the exception object itself in case it's the only one
                                // and we need to re-throw it
                                if (bindingErrors.length === 1) {
                                    bindingErrors[0].exception = e;
                                }
                            } else {
                                bindingErrors.push({
                                    exception: e,
                                    traceback: e.traceback,
                                    message: e.args.v[0].toString(),
                                    formName: yaml.class_name,
                                    binding: {
                                        component_name: componentName,
                                        property,
                                        code,
                                    },
                                });
                            }
                        };

                        return () => tryCatchOrSuspend(doUpdate, handleErr);
                    };

                    chained.push(...bindings.map(tryCatchBinding));
                }

                chained.push(() => {
                    // If there's only one error, we throw the original exception object (so it has the right type etc).
                    // If there were multiple errors, we throw a generic Exception saying "5 errors in this data binding".
                    if (bindingErrors.length === 1) {
                        // because we support deletion of the exception we have to make this optional
                        // assert that .exception exists here
                        const err = bindingErrors[0].exception!;
                        if (!err._anvil) {
                            err._anvil = { errorObj: { type: err.tp$name } };
                        } else if (!err._anvil.errorObj) {
                            err._anvil.errorObj = { type: err.tp$name };
                        }
                        err._anvil.errorObj.bindingErrors = bindingErrors;
                        delete bindingErrors[0].exception;

                        throw err;
                    } else if (bindingErrors.length > 0) {
                        const err = new Sk.builtin.RuntimeError(
                            `Data Binding update failed with ${bindingErrors.length} error${
                                bindingErrors.length > 1 ? "s" : ""
                            }`
                        );
                        (err as CustomAnvilError)._anvil = {
                            errorObj: {
                                type: "Exception",
                                bindingErrors: bindingErrors,
                            },
                        };
                        for (const e of bindingErrors) {
                            delete e.exception;
                        }
                        throw err;
                    }
                });

                return chainOrSuspend(null, ...chained, () => pyNone);
            });

            // Hand-build a special "item" descriptor
            interface ItemDescriptor extends pyObject {}

            const ItemDescriptor: pyNewableType<ItemDescriptor> = Sk.abstr.buildNativeClass("ItemDescriptor", {
                constructor: function ItemDescriptor() {},
                slots: {
                    tp$descr_get(obj: FormTemplate | null, type) {
                        if (obj == null) return this;
                        // TODO - are we ok just assigining this onto the object?
                        return (obj.anvil$itemValue ??= new Sk.builtin.dict());
                    },
                    tp$descr_set(obj: FormTemplate, value, canSuspend) {
                        obj.anvil$itemValue = value;
                        const rv = chainOrSuspend(
                            pyBaseItem?.tp$descr_set?.(obj, value),
                            () =>
                                obj.anvil$formState.refreshOnItemSet &&
                                pyCallOrSuspend($loc["refresh_data_bindings"], [obj])
                        );
                        return canSuspend ? rv : retryOptionalSuspensionOrThrow(rv);
                    },
                },
            });
            $loc["item"] = new ItemDescriptor();


            $loc["__setattr__"] = new Sk.builtin.func(function(self, pyName, pyValue) {
                const name = Sk.ffi.toJs(pyName);
                if (componentNames.has(name)) {
                    throw new Sk.builtin.AttributeError("Cannot set attribute '" + name + "' on '" + self.tp$name + "' form. There is already a component with this name.");
                }
                return chainOrSuspend(Sk.generic.setAttr.call(self, pyName, pyValue, true), () => pyNone);
            });


            const object_getattribute = Sk.abstr.typeLookup<pyCallable>(Sk.builtin.object, Sk.builtin.str.$getattribute);

            $loc["__getattribute__"] = new Sk.builtin.func(function(self, pyName) {
                const name = Sk.ffi.toJs(pyName);
                // we prioritise the component over descriptors
                // i.e. we guarantee that if you name a component parent you will get the component and not the parent
                if (componentNames.has(name)) {
                    const dict = self.$d;
                    const component = dict && dict.quick$lookup(pyName);
                    if (component !== undefined) {
                        return component;
                    }
                }
                // use object.__getattribute__ because it will throw an attribute error
                // unlike Sk.generic.getAttr which returns undefined
                return PyDefUtils.pyCallOrSuspend(object_getattribute, [self, pyName]);
            });

            // Set up form-specific events (refreshing_data_bindings) in case we inherit from a new-style component
            const existingEvents = pyBase.tp$getattr(s_anvil_events);
            const formEvents = new pyList([s_refreshing_data_bindings]);
            $loc[s_anvil_events.toString()] = existingEvents ? formEvents.sq$concat(existingEvents) : formEvents;
       }
    }) as FormTemplateConstructor;
};

