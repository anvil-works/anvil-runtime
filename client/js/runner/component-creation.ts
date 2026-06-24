import {
    Suspension,
    chainOrSuspend,
    isTrue,
    pyCall,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyException,
    pyHasAttr,
    pyIsInstance,
    pyNewableType,
    pyNone,
    pyNoneType,
    pyObject,
    pyRecursionError,
    pyStr,
    toPy,
    tryCatchOrSuspend,
} from "@Sk";
import {
    Component,
    IGNORE_PROPERTY_EXCEPTIONS_KW,
    LayoutProperties,
    ToolboxItem,
    setDefaultDepAppIdForNextComponent,
} from "../components/Component";
import { ComponentYaml, FormContainerYaml, FormYaml } from "./data";
import { FormTemplate } from "./forms";
import {
    ParsedFormSpec,
    YamlInstantiationContext,
    getAnvilComponentInstantiator,
    getNamedFormInstantiator,
    maybeParseCustomComponentSpecForInstantiation,
} from "./instantiation";
import {
    anvilMod,
    jsObjToKws,
    reportError,
    s_add_component,
    s_add_event_handler,
    s_layout,
    s_remove_event_handler,
    s_slots,
    strError,
} from "./py-util";
import { Slot } from "./python-objects";
import { warn } from "./warnings";

const warnedAboutEventBinding = new Set();

export type YamlCreationStack =
    | {
          parsedFormSpec: ParsedFormSpec;
          prev: YamlCreationStack;
      }
    | undefined;

let nextCreationStack: YamlCreationStack;
export const setNextCreationStack = (ncs: YamlCreationStack) => {
    nextCreationStack = ncs;
};
export const getAndCheckNextCreationStack = (formName: string, depAppId: string | null) => {
    let yamlStack = nextCreationStack;
    nextCreationStack = undefined;
    // console.log("Creating", formName, depAppId, "with stack", JSON.stringify(yamlStack));
    if (yamlStack?.parsedFormSpec.appLocalFormName === formName && yamlStack.parsedFormSpec.depAppId === depAppId) {
        // console.log("It's me!");
    } else {
        yamlStack = undefined;
    }
    let ys = yamlStack?.prev;
    while (ys) {
        if (ys.parsedFormSpec.appLocalFormName === formName && ys.parsedFormSpec.depAppId === depAppId) {
            throw new pyRecursionError(`Cannot nest ${formName} inside itself`);
        }
        ys = ys.prev;
    }

    return yamlStack;
};

// Instrumentation hook
let wrapFormEventHandler: (handler: pyCallable) => pyCallable<pyObject | Suspension> = (x) => x;
export const setInstrumentationHooks = (wfeh?: (handler: pyCallable) => pyCallable<pyObject | Suspension>) => {
    wrapFormEventHandler = wfeh ?? wrapFormEventHandler;
};

export function mkInvalidComponent(message: string) {
    return pyCall<Component>(anvilMod.InvalidComponent, [], ["text", new pyStr(message)]);
}

export interface SetupResult {
    components: {
        [name: string]: {
            component: Component;
            layoutProperties: LayoutProperties;
            index: number;
            targetSlot?: string;
            ancestors: Component[];
        };
    };
    orphanedComponents: string[];
    slots?: { [name: string]: Slot };
    form: Component;
}

export function removeEventHandlers(
    pyComponent: Component,
    pyForm: Component,
    yaml: ComponentYaml | FormContainerYaml
) {
    let pyRemoveEventHandler;
    const bindingsYaml = yaml.event_bindings || {};
    for (const [eventName, methodName] of Object.entries(bindingsYaml)) {
        pyRemoveEventHandler ??= Sk.abstr.gattr(pyComponent, s_remove_event_handler);
        const pyHandler = Sk.generic.getAttr.call(pyForm, new pyStr(methodName)) as pyObject; // use object.__getattribute__ for performance
        pyCall(pyRemoveEventHandler, [new pyStr(eventName), pyHandler]);
    }
}

/** We can't use the wrapped function else we break equality of event handlers
 * but we can use a proxy, this way they are python equal */
function ensureWrappedFunctionEquality(wrappedFn: pyCallable<pyObject | Suspension>, originalFn: pyCallable) {
    if (wrappedFn === originalFn) return wrappedFn;
    return new Proxy(originalFn, {
        get(target, prop: PropertyKey) {
            if (prop === "tp$call") {
                // call the wrapped version of tp$call
                return wrappedFn.tp$call;
            }
            return (target as any)[prop];
        },
        set(target, prop: PropertyKey, value) {
            (target as any)[prop] = value;
            return true;
        },
    });
}

export function addEventHandlers(
    pyComponent: Component,
    pyForm: Component,
    componentName: string,
    eventBindings: [string, string][]
) {
    let pyAddEventHandler = null;
    for (const [eventName, methodName] of eventBindings) {
        pyAddEventHandler ??= Sk.abstr.gattr(pyComponent, s_add_event_handler);

        const pyHandler = Sk.generic.getAttr.call(pyForm, new pyStr(methodName)) as pyObject; // use object.__getattribute__ for performance
        if (Sk.builtin.checkCallable(pyHandler)) {
            const wrappedPyHandler = ensureWrappedFunctionEquality(wrapFormEventHandler(pyHandler), pyHandler);
            try {
                pyCall(pyAddEventHandler, [new pyStr(eventName), wrappedPyHandler]);
            } catch (e) {
                // bad yaml event name - ignore ValueError
                // TODO this should be a more specific exception type
                if (!(e instanceof Sk.builtin.ValueError)) {
                    throw e;
                }
            }
            continue;
        }
        // pyHandler did not specify a callable object. Print an appropriate warning.

        const warningPath = `${pyForm.tp$name}.${componentName}.${eventName}`;
        if (warnedAboutEventBinding.has(warningPath)) {
            // we've already warned about this componenent/event don't do it again
            // (could be a component in a repeating panel)
            continue;
        }
        warnedAboutEventBinding.add(warningPath);

        let warningMsg;
        if (pyHandler === undefined) {
            warningMsg = `Warning: No method "${methodName}" in form ${
                pyForm.tp$name
            }: cannot set the '${eventName}' event handler of self${componentName ? "." + componentName : ""}.`;
        } else {
            // Trying to set the event handler to an attribute - ignore but give a warning - e.g. Form1.tooltip
            warningMsg = `Warning: "${methodName}" in form ${
                pyForm.tp$name
            } is not a method: cannot set the '${eventName}' event handler of self${
                componentName ? "." + componentName : ""
            }. Expected a callable function, (found type '${Sk.abstr.typeName(pyHandler)}').`;
        }
        warn(warningMsg);
    }
}

const pyAlwaysThrow = new Sk.builtin.func(() => {
    throw new Sk.builtin.Exception();
});

export const instantiateComponentFromYamlSpec = (
    context: YamlInstantiationContext,
    yamlSpec: string,
    properties: { [prop: string]: any },
    yamlStack: YamlCreationStack,
    name?: string
) => {
    const parsedFormSpec = maybeParseCustomComponentSpecForInstantiation(yamlSpec, context.defaultDepAppId);
    if (parsedFormSpec) {
        return chainOrSuspend(getNamedFormInstantiator(parsedFormSpec, context.requestingComponent), (instantiate) => {
            // Tell this component it was created by YAML from this app, so if it has any form
            // properties it knows how to look them up
            setDefaultDepAppIdForNextComponent(context.defaultDepAppId);
            nextCreationStack = { parsedFormSpec, prev: yamlStack };
            return instantiate(jsObjToKws(properties), name);
        });
    } else {
        const instantiate = getAnvilComponentInstantiator(context, yamlSpec);
        setDefaultDepAppIdForNextComponent(context.defaultDepAppId);
        return instantiate(jsObjToKws(properties), name);
    }
};

function createComponents(
    formYaml: FormYaml,
    pyForm: Component,
    defaultDepAppId: string | null,
    setupHandlers: boolean,
    yamlStack: YamlCreationStack,
    rootComponent?: Component
) {
    const { eventHandlers: formEventHandlers } = pyForm.ob$type._ComponentClass;

    const buildEventBindings = (componentName: string, yamlBindings?: Record<string, string>): [string, string][] => {
        const remaining = { ...(yamlBindings ?? {}) };
        const bindings: [string, string][] = [];
        const componentEventHandlers = formEventHandlers.get(componentName) || [];
        for (const { event, handler } of componentEventHandlers) {
            bindings.push([event, handler]);
            delete remaining[event];
        }
        bindings.unshift(...Object.entries(remaining));
        return bindings;
    };

    const instantiationContext: YamlInstantiationContext = {
        requestingComponent: pyForm,
        fromYaml: true,
        defaultDepAppId,
    };
    const setupResult: SetupResult = { components: {}, orphanedComponents: [], form: pyForm };
    const setupComponent = (
        yaml: ComponentYaml,
        pyAddToParent: pyObject | null,
        ancestors: Component[],
        index: number,
        targetSlot?: string
    ): Suspension | null | pyNoneType =>
        chainOrSuspend(
            tryCatchOrSuspend(
                () =>
                    instantiateComponentFromYamlSpec(
                        instantiationContext,
                        yaml.type,
                        { [IGNORE_PROPERTY_EXCEPTIONS_KW]: true, ...yaml.properties },
                        yamlStack,
                        yaml.name
                    ),
                (exception) => {
                    console.error(
                        `Error instantiating ${yaml?.name}`,
                        ": ",
                        exception,
                        "YAML:",
                        yaml,
                        "\n",
                        strError(exception)
                    );
                    reportError(exception);
                    return mkInvalidComponent(`Error instantiating "${yaml?.name}": ${strError(exception)}`);
                }
            ),
            (pyComponent) =>
                tryCatchOrSuspend(
                    () => {
                        if (yaml.name) {
                            if (yaml.name in setupResult.components) {
                                warn(
                                    `Warning: detected ${formYaml.class_name} has two components named "${yaml.name}". This shouldn't happen.`
                                );
                            }
                            setupResult.components[yaml.name] = {
                                component: pyComponent,
                                layoutProperties: yaml.layout_properties || {},
                                index,
                                ancestors,
                                targetSlot,
                            };
                        }

                        if (setupHandlers) {
                            // We support multiple handlers for a single event, BUT if there are any @handle decorators for
                            // an event, we ignore YAML event bindings for that event.

                            // If an event handler is set in the YAML and with a decorator, the decorator wins.
                            const eventBindings = buildEventBindings(yaml.name, yaml.event_bindings);

                            addEventHandlers(pyComponent, pyForm, yaml.name, eventBindings);
                        }

                        if (
                            yaml.components &&
                            !isTrue(pyIsInstance(pyComponent, anvilMod.InvalidComponent as pyNewableType<Component>))
                        ) {
                            let pyAddComponent = pyAlwaysThrow;
                            try {
                                pyAddComponent = Sk.abstr.gattr(pyComponent, s_add_component);
                            } catch {
                                // pass;
                            }
                            return chainOrSuspend(
                                null,
                                ...yaml.components.map(
                                    (subYaml, index) => () =>
                                        setupComponent(subYaml, pyAddComponent, [pyComponent, ...ancestors], index)
                                ),
                                () => pyComponent
                            );
                        } else {
                            return pyComponent;
                        }
                    },
                    (exception) => {
                        console.error(
                            `Error setting up component '${yaml?.name}' on ${pyForm?.tp$name}:`,
                            exception,
                            "\nYAML: ",
                            yaml,
                            "Python err: ",
                            strError(exception)
                        );
                        // This exception is almost certainly user code, so we should produce helpful stack traces here
                        reportError(exception);
                        return mkInvalidComponent(`Error setting up component "${yaml?.name}": ${strError(exception)}`);
                    }
                ),
            (pyComponent) =>
                chainOrSuspend(
                    pyComponent.anvilComponent$registerWithForm?.(pyForm as FormTemplate),
                    () => pyComponent
                ),
            (pyComponent) => {
                const layoutArgs: any = [];
                if (yaml.layout_properties) {
                    for (const [k, v] of Object.entries(yaml.layout_properties)) {
                        layoutArgs.push(new pyStr(k), toPy(v));
                    }
                }
                return (
                    pyAddToParent &&
                    tryCatchOrSuspend(
                        () => pyCallOrSuspend<pyNoneType>(pyAddToParent, [pyComponent], layoutArgs),
                        (exception) => {
                            reportError(exception);
                            setupResult.orphanedComponents.push(yaml.name);
                            return pyNone;
                        }
                    )
                );
            }
        );

    // A bit late to be setting this, really, but it's mostly used for loop detection within this module, so ~\o/~
    window.anvilCurrentlyConstructingForms.push({ name: formYaml.class_name, pyForm });

    // Delay slot setup because we need the components.
    const setupSlotsAndCleanUp = () => {
        if (formYaml.slots) {
            setupResult.slots = {};
            const slotsByTarget: {
                container: { [containerName: string]: Slot[] };
                slot: { [slotName: string]: Slot[] };
            } = {
                container: {},
                slot: {},
            };
            const sortedSlots = Object.entries(formYaml.slots).sort(
                ([nameA, { index: indexA }], [nameB, { index: indexB }]) =>
                    indexA === indexB ? nameA.localeCompare(nameB, "en") : indexA - indexB
            );
            for (const [
                name,
                { set_layout_properties, one_component, placeholder_text, template, target, index },
            ] of sortedSlots) {
                let getContainer: () => Suspension | pyObject;
                if (target.type === "container") {
                    const pyContainer = target.name ? setupResult.components[target.name]?.component : pyForm;
                    if (!pyContainer) {
                        // TODO should we throw a real error here rather than a string?
                        throw `No such target container "${target.name}" for slot "${name}"`;
                    }
                    getContainer = () => pyContainer;
                } else {
                    getContainer = () =>
                        chainOrSuspend(
                            Sk.abstr.gattr(pyForm, s_layout, true),
                            (pyLayout) => Sk.abstr.gattr(pyLayout, s_slots, true),
                            (slots: pyDict<pyStr, Slot>) => {
                                const slot = slots.quick$lookup(new pyStr(target.name));
                                if (!slot) {
                                    throw `No such target slot ${target.name} for slot ${name}`;
                                }
                                return slot;
                            }
                        );
                }
                let templateToolboxItem: ToolboxItem | undefined;
                if (template) {
                    const templateParsedFormSpec = maybeParseCustomComponentSpecForInstantiation(
                        template.type,
                        defaultDepAppId
                    );
                    templateToolboxItem = {
                        component: {
                            ...template,
                            type: templateParsedFormSpec
                                ? templateParsedFormSpec.packageQualifiedFormName
                                : `anvil.${template.type}`,
                        },
                        title: "Template",
                    };
                }
                const slot = new Slot(
                    getContainer,
                    index || 0,
                    set_layout_properties,
                    !!one_component,
                    templateToolboxItem
                );
                if (placeholder_text) {
                    slot._slotState.placeholderText = placeholder_text;
                }
                setupResult.slots[name] = slot;

                // Make sure slots in the same container coexist happily (earlier slots affect insertion index of later slots)
                const slots = (slotsByTarget[target.type][target.name] ||= []);
                slot._slotState.earlierSlots.push(...slots);
                slots.push(slot);
            }
        }
        window.anvilCurrentlyConstructingForms.pop();
        return setupResult;
    };

    // Does this form use a layout, or not?
    if (formYaml.layout) {
        //let componentsBySlot: {[slotName:string]: {pyComponent: pyObject, layout_properties: object}} = {};
        if (setupHandlers) {
            addEventHandlers(pyForm, pyForm, "", buildEventBindings("", formYaml.layout.form_event_bindings));
        }

        return chainOrSuspend(
            undefined,
            ...Object.entries(formYaml.components_by_slot ?? []).map(([slotName, components], index) => () => {
                return chainOrSuspend(
                    null,
                    ...components.map((yaml) => () => setupComponent(yaml, null, [rootComponent!], index, slotName))
                );
            }),
            setupSlotsAndCleanUp
        );
    } else {
        // No layout; this form inherits from a container class directly
        if (setupHandlers) {
            addEventHandlers(pyForm, pyForm, "", buildEventBindings("", formYaml.container!.event_bindings));
        }

        let pyAddToForm = pyAlwaysThrow;
        try {
            pyAddToForm = Sk.abstr.gattr(pyForm, s_add_component);
        } catch {
            // pass
        }
        return chainOrSuspend(
            null,
            ...(formYaml.components ?? []).map(
                (yaml, index) => () => setupComponent(yaml, pyAddToForm, [rootComponent!], index)
            ),
            setupSlotsAndCleanUp
        );
    }
}

export function setupFormComponents(
    formYaml: FormYaml,
    pyForm: Component,
    defaultDepAppId: string | null,
    yamlStack: YamlCreationStack,
    setupHandlers = true,
    rootComponent?: Component
) {
    const pyFormDict = Sk.abstr.lookupSpecial(pyForm, pyStr.$dict) as pyDict;
    return chainOrSuspend(
        createComponents(formYaml, pyForm, defaultDepAppId, setupHandlers, yamlStack, rootComponent),
        (setupResult: SetupResult) => {
            for (const [name, { component }] of Object.entries(setupResult.components)) {
                const pyName = new pyStr(name);
                if (isTrue(pyHasAttr(pyForm, pyName))) {
                    Sk.builtin.print([
                        new pyStr(
                            `Warning: ${pyForm.tp$name} has a method or attribute '${name}' and a component called '${name}'. The method or attribute will be inaccessible. This is probably not what you want.`
                        ),
                    ]);
                }
                // add it to the dunder dict IF we have one. If pyForm was created by a YAML carrier, it might not have one.
                if (pyFormDict) {
                    pyFormDict.mp$ass_subscript(pyName, component);
                }
            }
            return setupResult;
        }
    );
}

// Returns a list of names of orphaned components (those that couldn't be added to their desired slot)
export function addFormComponentsToLayout(formYaml: FormYaml, pyForm: Component, pyLayout: Component) {
    const pyFormDict = Sk.abstr.lookupSpecial(pyForm, pyStr.$dict) as pyDict;
    const pySlots = Sk.abstr.gattr(pyLayout, s_slots) as pyDict<pyStr, Component>;
    const orphanedComponents: string[] = [];
    return chainOrSuspend(
        null,
        ...Object.entries(formYaml.components_by_slot ?? []).map(([slotName, components]) => () => {
            // don't try to get the the slot if there are no components to fill it
            // it might have been deleted by the layout - TODO - need a way to clean these up from the yaml
            if (!components.length) return;
            let pySlot;
            try {
                pySlot = pySlots.mp$subscript(new pyStr(slotName));
            } catch (e: any) {
                if (e instanceof Sk.builtin.KeyError) {
                    reportError(
                        new pyException(
                            `Could not add component(s) ${components
                                .map((c) => `'${c.name}'`)
                                .join(", ")} to slot '${slotName}' in ${formYaml.class_name}: Slot not found in ${
                                pyLayout.tp$name
                            } layout. It may have been renamed or deleted.`
                        )
                    );
                    orphanedComponents.push(...components.map(({ name }) => name));
                    // Carry on, because there may just be one bad slot.
                    return;
                } else {
                    throw e;
                }
            }
            const pyAddToSlot = Sk.abstr.gattr(pySlot, s_add_component);
            return chainOrSuspend(
                null,
                ...components.map(
                    ({ name, layout_properties }) =>
                        () =>
                            pyCallOrSuspend(
                                pyAddToSlot,
                                [pyFormDict.mp$subscript(new pyStr(name))],
                                jsObjToKws(layout_properties)
                            )
                )
            );
        }),
        () => orphanedComponents
    );
}
