import type { Kws, pyNoneType, pyObject, pyTuple } from "../@Sk";
import {
    Args,
    Suspension,
    buildNativeClass,
    buildPyClass,
    chainOrSuspend,
    checkArgsLen,
    checkOneArg,
    iterForOrSuspend,
    lookupSpecial,
    promiseToSuspension,
    pyBaseException,
    pyBuiltinFunctionOrMethod,
    pyCall,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyFunc,
    pyIter,
    pyKeyError,
    pyList,
    pyNewableType,
    pyNone,
    pyStr,
    pySuper,
    pyType,
    retryOptionalSuspensionOrThrow,
    toPy,
    tryCatchOrSuspend,
} from "../@Sk";
import * as PyDefUtils from "../PyDefUtils";
import {
    AnvilHooks,
    Component,
    EventDescription,
    PropertyDescription,
    PropertyDescriptionBase,
    raiseWritebackEventOrSuspend,
} from "../components/Component";
import {
    SetupResult,
    addEventHandlers,
    addFormComponentsToLayout,
    getAndCheckNextCreationStack,
    removeEventHandlers,
    setupFormComponents,
} from "./component-creation";
import type {
    ComponentYaml,
    CustomComponentEvents,
    DataBindingYaml,
    FormContainerYaml,
    FormLayoutYaml,
    FormYaml,
} from "./data";
import { BindingError, CustomAnvilError, isCustomAnvilError } from "./error-handling";
import { getAnvilComponentClass, getFormClassObject, resolveFormSpec } from "./instantiation";
// for type stub
import {
    PyModMap,
    funcFastCall,
    jsObjToKws,
    kwsToObj,
    objToKws,
    pyPropertyFromGetSet,
    s_add_component,
    s_add_event_handler,
    s_anvil_events,
    s_anvil_get_interactions,
    s_anvil_properties,
    s_item,
    s_raise_event,
    s_refreshing_data_bindings,
    s_remove_event_handler,
} from "./py-util";
import { Slot, WithLayout } from "./python-objects";

const walkComponents = (
    yaml: FormYaml,
    fn: (c: ComponentYaml) => void,
    containerOrLayoutFn: ((c: FormContainerYaml) => void) | null = null
) => {
    const walkComponent = (yaml: ComponentYaml) => {
        fn(yaml);
        yaml.components?.forEach(walkComponent);
    };
    if (yaml.container) {
        containerOrLayoutFn?.(yaml.container);
        yaml.components?.forEach(walkComponent);
    } else {
        containerOrLayoutFn?.(yaml.layout!);
        Object.values(yaml.components_by_slot ?? [])
            .flat()
            .forEach(walkComponent);
    }
};

const propNameMap = [
    ["name", "name"],
    ["type", "type"],
    ["default_value", "defaultValue"],
    ["description", "description"],
    ["important", "important"],
    ["group", "group"],
    ["options", "options"],
    ["accept", "accept"],
    ["multiline", "multiline"],
    ["allow_binding_writeback", "supportsWriteback"],
    ["include_none_option", "includeNoneOption"],
    ["none_option_label", "noneOptionLabel"],
    ["priority", "priority"],
    ["designer_hint", "designerHint"],
    ["default_binding_prop", "defaultBindingProp"],
    ["show_in_designer_when", "showInDesignerWhen"],
    ["iconsets", "iconsets"],
] as const;

function cleanPropertyDescription(property: NonNullable<FormYaml["properties"]>[number]): PropertyDescription {
    const cleaned = {} as PropertyDescription;
    for (const [yamlName, designerName] of propNameMap) {
        if (yamlName in property) {
            // @ts-ignore
            cleaned[designerName] = property[yamlName];
        }
    }
    if (cleaned.priority == null) {
        delete cleaned.priority; // prefer undefined when treating as a number
    } else {
        /* In case it's a string in the YAML */
        cleaned.priority = parseFloat(cleaned.priority as unknown as string);
    }
    return cleaned;
}

function cleanPropertyDescriptions(properties: FormYaml["properties"]): PropertyDescription[] {
    return properties?.map(cleanPropertyDescription) ?? [];
}

function cleanEventDescriptions(events: FormYaml["events"]): EventDescription[] {
    return (
        events?.map(({ name, description, parameters, default_event: defaultEvent }) => ({
            name,
            description,
            parameters,
            defaultEvent,
        })) ?? []
    );
}

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
            if (!binding.code) {
                continue;
            }
            const readCode =
                "def update_val(self, _anvil_component):\n" +
                "  _anvil_component." +
                binding.property +
                " = " +
                binding.code +
                "\n" +
                "def clear_val(self, _anvil_component):\n" +
                "  _anvil_component." +
                binding.property +
                " = None\n";
            // TODO: Check whether we actually allowBindingWriteback on this binding property. This is not as simple as
            // looking at the propMap of binding.pyComponent, because they could be custom component properties, which
            // aren't registered anywhere on the instance.
            const writeCode = binding.writeback
                ? "def save_val(self, _anvil_component):\n" +
                  "  " +
                  binding.code +
                  " = _anvil_component." +
                  binding.property +
                  "\n"
                : "";

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
                        throw new Sk.builtin.SyntaxError(
                            "Can't assign to data binding expression for " +
                                name +
                                "." +
                                binding.property +
                                " in " +
                                yaml.class_name +
                                ", but writeback is enabled for this data binding."
                        );
                    }
                }
                throw new Sk.builtin.SyntaxError(
                    `Syntax error in data binding for ${name}.${binding.property} in form ${yaml.class_name}`
                );
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

const setupDataBindingWritebackListeners = (pyForm: FormTemplate, dataBindings: DataBindings, isLayout: boolean) => {
    const writeBackChildBoundData = async (binding: DataBinding, pyComponent: Component): Promise<pyObject> => {
        try {
            return (await PyDefUtils.callAsyncWithoutDefaultError(
                binding.pySave,
                undefined,
                undefined,
                undefined,
                pyForm,
                pyComponent
            )) as pyObject;
        } catch (e) {
            if (e instanceof Sk.builtin.KeyError) {
                return pyNone; // Unremarkable
            }
            console.error(e);
            if (e instanceof Sk.builtin.BaseException && e.args.v[0] instanceof Sk.builtin.str) {
                const name = binding.componentName ? `self.${binding.componentName}` : "self";
                e.args.v[0] = new Sk.builtin.str(
                    e.args.v[0].v +
                        "\n while setting " +
                        binding.code +
                        " = " +
                        name +
                        "." +
                        binding.property +
                        "\n in a data binding for " +
                        name
                );
            }
            window.onerror(null, null, null, null, e);
            return pyNone;
        }
    };

    const removers: (() => void)[] = [];
    for (const [componentName, bindings] of Object.entries(dataBindings)) {
        //const pyComponent = componentName ? (pyForm.$d.quick$lookup(new pyStr(componentName)) as Component) : (isLayout ? pyForm.tp$getattr(s_layout)! as Component : pyForm);
        let pyComponent: Component;
        if (componentName) {
            pyComponent = pyForm.$d.quick$lookup(new pyStr(componentName)) as Component;
        } else if (isLayout) {
            if (pyForm._withLayout.pyLayout) {
                pyComponent = pyForm._withLayout.pyLayout;
            } else {
                // We are a WithLayout form that hasn't had its layout instantiated yet. Don't force it to
                // instantiate just because we happen to have a data binding.
                continue;
            }
        } else {
            pyComponent = pyForm;
        }

        for (const binding of bindings) {
            binding.pyComponent = pyComponent;
            binding.componentName = componentName;
            if (binding.writeback) {
                const handler = new pyFunc(
                    PyDefUtils.withRawKwargs(() => promiseToSuspension(writeBackChildBoundData(binding, pyComponent)))
                );

                pyCall((pyComponent as Component).tp$getattr(s_add_event_handler)!, [
                    new pyStr("x-anvil-write-back-" + binding.property),
                    handler,
                ]);
                removers.push(() => {
                    pyCall((pyComponent as Component).tp$getattr(s_remove_event_handler)!, [
                        new pyStr("x-anvil-write-back-" + binding.property),
                        handler,
                    ]);
                });
            }
        }
    }
    return () => {
        for (const remover of removers) {
            remover();
        }
    };
};

const refreshDataBindings = (yaml: FormYaml, self: Component, dataBindings: DataBindings): Suspension | pyNoneType => {
    const chained: (() => pyObject | void | Suspension)[] = [];
    const bindingErrors: BindingError[] = [];
    for (const [componentName, bindings] of Object.entries(dataBindings)) {
        let pyComponent: Component;
        if (componentName) {
            pyComponent = self.$d.quick$lookup(new pyStr(componentName));
        } else if (yaml.layout) {
            if (self._withLayout.pyLayout) {
                pyComponent = self._withLayout.pyLayout;
            } else {
                // We are a WithLayout form that hasn't had its layout instantiated yet. Don't force it to
                // instantiate just because we happen to have a data binding.
                continue;
            }
        } else {
            pyComponent = self;
        }

        const tryCatchBinding = ({ property, code, pyUpdate, pyClear }: DataBinding) => {
            const doUpdate = () => {
                return pyUpdate && pyCallOrSuspend(pyUpdate, [self, pyComponent]);
            };

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
                `Data Binding update failed with ${bindingErrors.length} error${bindingErrors.length > 1 ? "s" : ""}`
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
};

// TODO we're walking the component graph a few too many times here (bindings and this).
// We might want to use a visitor pattern with createComponents.
const getComponentNames = (formYaml: FormYaml) => {
    const componentNames = new Set();
    walkComponents(formYaml, (yaml: ComponentYaml) => componentNames.add(yaml.name));
    return componentNames;
};

export const FORM_SHOW_EVENT = {
    name: "show",
    description: "When the form is shown on the page",
    parameters: [],
    important: true,
};

export const FORM_HIDE_EVENT = {
    name: "hide",
    description: "When the form is removed from the page",
    parameters: [],
    important: true,
};

export const FORM_REFRESH_DATA_BINDINGS_EVENT = {
    name: "refreshing_data_bindings",
    important: true,
    parameters: [],
    description: "When refresh_data_bindings is called",
};

const FORM_REFRESH_DATA_BINDINGS_EVENT_HIDDEN = { ...FORM_REFRESH_DATA_BINDINGS_EVENT, hidden: true };

export const FORM_EVENTS: CustomComponentEvents[] = [
    FORM_SHOW_EVENT,
    FORM_HIDE_EVENT,
    FORM_REFRESH_DATA_BINDINGS_EVENT,
];
export const FORM_EVENT_NAMES = FORM_EVENTS.map(({ name }) => name);

/*!componentProp(form)!1*/
export const ITEM_PROPERTY = {
    name: "item",
    type: "dict",
    description: "A dictionary-like object connected to this form",
} as const;

function setupDropHooks(yaml: FormYaml, c: Component) {
    const oldEnableDropMode = c.anvil$hooks.enableDropMode;
    if (yaml.custom_component_container) {
        // Custom container support. It's a hack for a special case.
        //
        // Custom containers are designer-created custom components that also expose the container behaviour of their root
        // container at design time. This allows Anvil developers to create their own containers without going low-level.
        // The catch here is that the custom form might have its own components, so custom containers need to constrain their
        // drag-and-drop behaviour to insert components at the *start* of the list, where component and designer agree on
        // component indices. We do this by:
        //
        //   1. Overriding add_component to add all components via a Slot at index 0, reusing the slot's bookkeeping to
        //      keep inserts before existing components
        //
        //   2. Overriding the enableDropMode hook to filter out drop zones that lie outside the slot. (We can't use the
        //      Slot's enableDropMode() for this directly, because it would attempt to call _our_ enableDropMode(), and
        //      cause infinite recursion, so we do it ourselves; it's not hard.)
        //
        // We do this with a grungy hack - overwriting add_component on the instance itself, after already having
        // added components from the YAML. We could attempt to de-grunge this by splitting this into two implementations:
        // one for YAML carriers, doing essentially what we do here, and one for FormTemplates, providing an actual override
        // for add_component. This would involve duplication, and the FormTemplate version wouldn't be much cleaner (it
        // still needs to switch implementations after initial component construction), so we're leaving this like this
        // for now. If someone fancies cleaning this up in the future, that would be lovely.

        const slot = new Slot(() => c, 0);
        // A little massage - get the slot to look up our current/original addComponent before we overwrite it
        retryOptionalSuspensionOrThrow(slot._slotState.fillCache());
        const slotAddComponent = slot.tp$getattr(s_add_component) as pyCallable;
        c.$d.mp$ass_subscript(s_add_component, slotAddComponent);
        c.anvil$hooks.enableDropMode = (dropping, flags) =>
            (oldEnableDropMode?.(dropping, flags) ?? []).filter(
                ({ dropInfo: { minChildIdx } = {} }) =>
                    minChildIdx === undefined || minChildIdx <= slot._slotState.components.length
            );
    } else {
        c.anvil$hooks.enableDropMode = (dropping, flags) =>
            flags?.asComponent ? [] : oldEnableDropMode?.(dropping, flags) ?? [];
    }
}

export function setupPassiveHooks(yaml: FormYaml, c: Component) {
    if (!ANVIL_IN_DESIGNER) return;

    const propertyDescriptions: PropertyDescription[] = [ITEM_PROPERTY];
    const events: EventDescription[] = [];
    if (yaml.custom_component || yaml.slots) {
        const { properties: yamlProperties = [], events: yamlEvents = [] } = yaml;
        propertyDescriptions.push(...cleanPropertyDescriptions(yamlProperties));
        events.push(...cleanEventDescriptions(yamlEvents));
    }

    // do this now since it overrides the current anvil$hooks;
    setupDropHooks(yaml, c);
    const oldHooks = c.anvil$hooks;

    const newHooks: AnvilHooks = {
        setupDom: oldHooks.setupDom,
        get domElement() {
            return oldHooks.domElement;
        },
        enableDropMode: oldHooks.enableDropMode,
        disableDropMode: oldHooks.disableDropMode,
        properties: propertyDescriptions,
        events,
        getInteractions: () => [],
    };

    c.anvil$hooks = newHooks;
}

type FormTemplateConstructor = pyNewableType<FormTemplate>;

export interface FormTemplate extends Component {
    $d: pyDict;
    anvil$formState: {
        refreshOnItemSet: boolean;
        dataBindings: DataBinding[];
        slotDict: pyDict;
        removeDataBindingWritebackListeners?: () => void;
    };
    anvil$itemValue?: pyObject;
    // used by CustomComponentProperty
    anvil$customProps?: { [name: string]: pyObject };
    anvil$customPropsDefaults: { [name: string]: pyObject };
    _anvil?: any;
}

const MetaCustomComponent: pyNewableType<FormTemplateConstructor> = buildNativeClass("anvil.MetaCustomComponent", {
    constructor: function () {},
    base: pyType,
    slots: {
        tp$call(args, kws) {
            const customProps = this.prototype.anvil$customPropsDefaults;
            if (customProps) {
                const asMap = kwsToObj(kws);
                for (const propName in customProps) {
                    if (propName in asMap) continue;
                    asMap[propName] = customProps[propName];
                }
                kws = objToKws(asMap);
            }
            return pyType.prototype.tp$call.call(this, args, kws);
        },
    },
});

export const createFormTemplateClass = (
    yaml: FormYaml,
    depAppId: string | null,
    className: string,
    anvilModule: PyModMap
): FormTemplateConstructor => {
    const pyBase = yaml.container
        ? getAnvilComponentClass(anvilModule, yaml.container.type) ||
          retryOptionalSuspensionOrThrow(
              getFormClassObject(resolveFormSpec(yaml.container.type.substring(5), depAppId))
          )!
        : WithLayout;

    // Legacy bits of _anvil we can't get rid of yet
    const _anvil: any = {};
    const events: EventDescription[] = [];
    const properties: PropertyDescriptionBase[] = [ITEM_PROPERTY];
    if (yaml.custom_component || yaml.slots) {
        events.push(...cleanEventDescriptions(yaml.events));
        properties.push(...cleanPropertyDescriptions(yaml.properties));
    }
    if (!events.some(({ name }) => name === "refreshing_data_bindings")) {
        events.push(FORM_REFRESH_DATA_BINDINGS_EVENT_HIDDEN);
    }

    const dataBindings = setupDataBindings(yaml);
    const componentNames = getComponentNames(yaml);

    // "item" is a special descriptor that triggers the underlying descriptor on write if there is one.
    const pyBaseItem = pyBase.$typeLookup(s_item);

    const kwargs = [];
    if (yaml.layout) {
        kwargs.push("layout", { type: yaml.layout.type, defaultDepId: depAppId });
    }
    if (yaml.custom_component || yaml.slots) {
        kwargs.push("metaclass", MetaCustomComponent);
    }

    const FormTemplate = buildPyClass(
        anvilModule,
        ($gbl, $loc) => {
            // The setup code is *mostly* in common between __new__ and __new_deserialized__, except for
            // components (__new_deserialized__ already has the objects, whereas __new__ needs to
            // instantiate them), so we keep it mostly in common

            const baseConstructionArgs: Args = [];
            if (!yaml.container) {
                const onAssociateLayout = new pyBuiltinFunctionOrMethod({
                    $meth(pyLayout: Component, pyForm: FormTemplate) {
                        addEventHandlers(pyLayout, pyForm, "", yaml.layout!.event_bindings);
                        const layoutBindings = { "": dataBindings[""] ?? [] };
                        pyForm.anvil$formState.removeDataBindingWritebackListeners = setupDataBindingWritebackListeners(
                            pyForm,
                            layoutBindings,
                            true
                        );
                        return chainOrSuspend(
                            null,
                            () => refreshDataBindings(yaml, pyForm, layoutBindings),
                            () => addFormComponentsToLayout(yaml, pyForm, pyLayout),
                            () => pyNone
                        );
                    },
                    $flags: { MinArgs: 2, MaxArgs: 2 },
                });
                const onDissociateLayout = new pyBuiltinFunctionOrMethod({
                    $meth(pyLayout: Component, pyForm: FormTemplate) {
                        removeEventHandlers(pyLayout, pyForm, yaml.layout!);
                        pyForm.anvil$formState.removeDataBindingWritebackListeners?.();
                        return pyNone;
                    },
                    $flags: { MinArgs: 2, MaxArgs: 2 },
                });
                baseConstructionArgs.push(onAssociateLayout, onDissociateLayout);
            }
            const subYaml = yaml.container || (yaml.layout as FormContainerYaml | FormLayoutYaml);
            const baseConstructionKwargs: Kws = jsObjToKws({
                __ignore_property_exceptions: true,
                ...(subYaml.properties || {}),
            });
            const baseNew = Sk.abstr.typeLookup<pyCallable>(pyBase, Sk.builtin.str.$new);

            const skeletonNew = (cls: FormTemplateConstructor) =>
                pyCallOrSuspend<FormTemplate>(baseNew, [cls, ...baseConstructionArgs], baseConstructionKwargs);

            // Back half of __new__ for conventionally constructed objects;
            // __deserialize__ for deserialized ones
            const commonSetup = (
                c: FormTemplate,
                setupComponents: (c: FormTemplate) => void | Suspension | Component | SetupResult
            ) => {
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

                return chainOrSuspend(setupComponents(c), () => {
                    setupDataBindingWritebackListeners(c, dataBindings, !!yaml.layout);
                    return c;
                });
            };

            $loc["__new__"] = new Sk.builtin.func(
                PyDefUtils.withRawKwargs((kws: Kws, cls: FormTemplateConstructor) =>
                    chainOrSuspend(skeletonNew(cls), (c) => {
                        const yamlStack = getAndCheckNextCreationStack(yaml.class_name, depAppId);
                        return commonSetup(c, (c: FormTemplate) =>
                            chainOrSuspend(setupFormComponents(yaml, c, depAppId, yamlStack), (setupResult) => {
                                if (setupResult.slots) {
                                    for (const [name, slot] of Object.entries(setupResult.slots)) {
                                        c.anvil$formState.slotDict.mp$ass_subscript(new pyStr(name), slot);
                                    }
                                }
                                setupDropHooks(yaml, c);
                            })
                        );
                    })
                )
            );

            $loc["__new_deserialized__"] = PyDefUtils.mkNewDeserializedPreservingIdentity(
                (self: FormTemplate, pyData: pyDict, _pyGlobalData: any) => {
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

                                setupDataBindingWritebackListeners(c, dataBindings, !!yaml.layout);
                            },
                            // We set our component attrs last (this could trigger user code that expects
                            // everything to be in its place)
                            () => {
                                const items = pyAttrs.tp$getattr<pyCallable>(new pyStr("items"));
                                return iterForOrSuspend(pyIter<pyTuple<[pyStr, pyObject]>>(pyCall(items)), (pyItem) => {
                                    const [pyName, pyValue] = pyItem.v;
                                    return c.tp$setattr(pyName, pyValue, true);
                                });
                            }
                        );
                    }

                    return commonSetup(self, setupComponents);
                },
                skeletonNew
            );

            $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity(function (self: FormTemplate) {
                // We serialise our components, our object dict, and the properties of our container
                // type separately

                // we don't have a __dict__ but our subclass should i.e. class Form1(Form1Template):
                const d = lookupSpecial(self, pyStr.$dict) ?? new pyDict();
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
                    new Sk.builtin.str("d"),
                    d,
                    new Sk.builtin.str("a"),
                    a,
                    new Sk.builtin.str("c"),
                    new Sk.builtin.list(components),
                ]);
            });

            // Kept for backwards compatibility.
            $loc["init_components"] = $loc["__init__"] = funcFastCall(function __init__(args: Args, pyKwargs?: Kws) {
                checkOneArg("init_components", args);
                const self = args[0] as FormTemplate;
                const baseInit = pyBase.tp$getattr(pyStr.$init) as pyCallable;
                // Sort out property attrs.
                const validKwargs = new Set(["item"]);

                const propMap = kwsToObj(pyKwargs);

                if (yaml.custom_component || yaml.slots) {
                    for (const { name } of yaml.properties ?? []) {
                        validKwargs.add(name);
                    }
                }

                let anvilProps: PropertyDescriptionBase[];
                const shouldInstantiateProp = (propName: string) => {
                    if (propName === "__ignore_property_exceptions") return false;
                    if (validKwargs.has(propName)) return true;
                    anvilProps ??= self.anvil$hooks.properties ?? [];
                    if (anvilProps.some(({ name }) => name === propName)) return true;

                    console.log("Ignoring form constructor kwarg: ", propName);
                    return false;
                };
                const propAttrs: [string, pyObject][] = [];
                // Overwrite any valid props we were given as kwargs.
                for (const [propName, pyPropVal] of Object.entries(propMap)) {
                    if (shouldInstantiateProp(propName)) {
                        propAttrs.push([propName, pyPropVal]);
                    }
                }

                return Sk.misceval.chain(
                    pyCallOrSuspend(baseInit, [self]),
                    () => {
                        self.anvil$formState.refreshOnItemSet = false;
                    },
                    ...propAttrs.map(
                        ([propName, pyPropVal]) =>
                            () =>
                                self.tp$setattr(new Sk.builtin.str(propName), pyPropVal, true)
                    ),
                    () => {
                        self.anvil$formState.refreshOnItemSet = true;
                    },
                    () =>
                        Sk.misceval.tryCatch(
                            () => pyCallOrSuspend(self.tp$getattr(new Sk.builtin.str("refresh_data_bindings"))),
                            (e) => {
                                if (e instanceof Sk.builtin.BaseException && e.args.v[0] instanceof Sk.builtin.str) {
                                    e.args.v[0] = new Sk.builtin.str(
                                        e.args.v[0].v +
                                            ". Did you initialise all data binding sources before initialising this component?"
                                    );
                                }
                                throw e;
                            }
                        )
                );
            });

            if (yaml.custom_component || yaml.slots) {
                // Create property descriptors for custom properties.
                (yaml.properties || []).forEach((pt) => {
                    $loc[pt.name] = pyCall(anvilModule["CustomComponentProperty"], [
                        new pyStr(pt.name),
                        toPy(pt.default_value || null),
                    ]);
                });
            }

            if (yaml.slots) {
                $loc["slots"] = pyPropertyFromGetSet((self: FormTemplate) => {
                    return self.anvil$formState.slotDict;
                });
            }

            $loc["raise_event"] = funcFastCall((args: Args<[FormTemplate, pyStr]>, kws?: Kws) => {
                const [self, pyEventName] = args;
                checkArgsLen("raise_event", args, 2, 2);
                const eventName = String(pyEventName);
                const superRaise = new pySuper(FormTemplate, self).tp$getattr<pyCallable>(s_raise_event);
                if (!yaml.custom_component && !yaml.slots) {
                    return pyCallOrSuspend(superRaise, [pyEventName], kws);
                }
                const chainedFns = (yaml.properties ?? [])
                    .filter((p) => (p.binding_writeback_events ?? []).includes(eventName))
                    .map((p) => () => raiseWritebackEventOrSuspend(self, new pyStr(p.name)));

                return chainOrSuspend(pyNone, ...chainedFns, () => pyCallOrSuspend(superRaise, [pyEventName], kws));
            });

            $loc["refresh_data_bindings"] = new Sk.builtin.func(function (self) {
                // TODO: Confirm that we want to refresh even if 'item' is None - we don't necessarily just bind to item.
                //var item = self.tp$getattr(new Sk.builtin.str("item"));
                //if (!item || item === Sk.builtin.none.none$) { return Sk.builtin.none.none$; }

                const chained: (() => pyObject | void | Suspension)[] = [
                    () => pyCallOrSuspend(self.tp$getattr(s_raise_event), [s_refreshing_data_bindings]),
                ];

                if (self._anvil?.onRefreshDataBindings) {
                    chained.push(self._anvil.onRefreshDataBindings);
                }

                return chainOrSuspend(
                    null,
                    ...chained,
                    () => refreshDataBindings(yaml, self, dataBindings),
                    () => pyNone
                );
            });

            // Hand-build a special "item" descriptor
            type ItemDescriptor = pyObject;

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

            $loc["__setattr__"] = new Sk.builtin.func(function (self, pyName, pyValue) {
                const name = Sk.ffi.toJs(pyName);
                if (componentNames.has(name)) {
                    throw new Sk.builtin.AttributeError(
                        "Cannot set attribute '" +
                            name +
                            "' on '" +
                            self.tp$name +
                            "' form. There is already a component with this name."
                    );
                }
                return chainOrSuspend(Sk.generic.setAttr.call(self, pyName, pyValue, true), () => pyNone);
            });

            const object_getattribute = Sk.abstr.typeLookup<pyCallable>(
                Sk.builtin.object,
                Sk.builtin.str.$getattribute
            );

            $loc["__getattribute__"] = new Sk.builtin.func(function (self, pyName) {
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
                return pyCallOrSuspend(object_getattribute, [self, pyName]);
            });

            $loc[s_anvil_get_interactions.toString()] = funcFastCall(() => new pyList([]));
            $loc[s_anvil_properties.toString()] = toPy(properties);
            $loc[s_anvil_events.toString()] = toPy(events);
        },
        className,
        [pyBase],
        undefined,
        kwargs as Kws
    ) as FormTemplateConstructor;

    FormTemplate.prototype.anvil$customPropsDefaults = Object.fromEntries(
        (yaml.properties ?? []).filter((pt) => pt.type !== "object").map((pt) => [pt.name, toPy(pt.default_value)])
    );

    return FormTemplate;
};
