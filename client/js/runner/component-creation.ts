import {
    chainOrSuspend,
    isTrue,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyException,
    pyHasAttr,
    pyIsInstance,
    pyNoneType,
    pyStr,
    pyTrue,
    Suspension,
    toPy,
    tryCatchOrSuspend
} from "../@Sk";
import type {pyDict, pyObject, Kws} from "../@Sk";
import * as PyDefUtils from "../PyDefUtils";
import {ComponentYaml, data, FormContainerYaml, FormYaml, SlotTarget, SlotTargetType} from "./data";
import * as py from "./py-util";
import {Slot} from "./python-objects";
import {s_add_component, s_layout, s_slots, strError} from "./py-util";
import {instantiateComponentFromYamlSpec, objectToKwargs, yamlSpecToQualifiedFormName} from "./instantiation";
import {Component, getDefaultDepId, LayoutProperties, ToolboxItem} from "../components/Component";
import { FormTemplate } from "./forms";

const warnedAboutEventBinding = new Set();


export function mkInvalidComponent(message: string) {
    return pyCall(py.getValue("anvil", "InvalidComponent"), [], ["text", new pyStr(message)]);
}

export interface SetupResult {
    components: {[name:string]: {component: Component, layoutProperties: LayoutProperties, index: number, targetSlot?: string}};
    slots?: {[name:string]: Slot};
    form: Component;
}

// TODO: This code will need some sort of loop prevention

function addEventHandlers(pyComponent: Component, pyForm: Component, yaml: ComponentYaml | FormContainerYaml) {
    let pyAddEventHandler = null;
    const bindingsYaml = yaml.event_bindings || {};
    for (const [eventName, methodName] of Object.entries(bindingsYaml)) {
        pyAddEventHandler = pyAddEventHandler || Sk.abstr.gattr(pyComponent, py.s_add_event_handler);

        const pyHandler = Sk.generic.getAttr.call(pyForm, new pyStr(methodName)) as pyObject; // use object.__getattribute__ for performance
        if (Sk.builtin.checkCallable(pyHandler)) {
            try {
                PyDefUtils.pyCall(pyAddEventHandler, [new pyStr(eventName), pyHandler]);
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

        const warningPath = `${pyForm.tp$name}.${(yaml as ComponentYaml).name}.${eventName}`;
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
            }: cannot set the '${eventName}' event handler of self${
                (yaml as ComponentYaml).name ? "." + (yaml as ComponentYaml).name : ""
            }.`;
        } else {
            // Trying to set the event handler to an attribute - ignore but give a warning - e.g. Form1.tooltip
            warningMsg = `Warning: "${methodName}" in form ${
                pyForm.tp$name
            } is not a method: cannot set the '${eventName}' event handler of self${
                (yaml as ComponentYaml).name ? "." + (yaml as ComponentYaml).name : ""
            }. Expected a callable function, (found type '${Sk.abstr.typeName(pyHandler)}').`;
        }
        Sk.builtin.print([warningMsg]);
    }
}

function createComponents(formYaml: FormYaml, pyForm: Component, setupHandlers: boolean) {
    const setupResult : SetupResult = {components: {}, form: pyForm};
    const setupComponent = (yaml: ComponentYaml, pyAddToParent: pyObject | null, index: number, targetSlot?: string): Suspension | null | pyNoneType =>
        chainOrSuspend(
            tryCatchOrSuspend(
                () => instantiateComponentFromYamlSpec(pyForm, yaml.type, {__ignore_property_exceptions: true, ...yaml.properties}, yaml.name),
                (exception) => {
                    console.error(`Error instantiating ${yaml?.name}`, ": ", exception, "YAML:", yaml, "\n", strError(exception));
                    return mkInvalidComponent(`Error instantiating "${yaml?.name}": ${strError(exception)}`);
                }
            ),
            (pyComponent) =>
                tryCatchOrSuspend(
                    () => {
                        if (yaml.name) {
                            setupResult.components[yaml.name] = {component: pyComponent, layoutProperties: yaml.layout_properties || {}, index, targetSlot};
                        }

                        if (setupHandlers) {
                            addEventHandlers(pyComponent, pyForm, yaml);
                        }

                        if (yaml.components && !isTrue(pyIsInstance(pyComponent, py.getValue("anvil", "InvalidComponent")))) {
                            const pyAddComponent = Sk.abstr.gattr(pyComponent, py.s_add_component);
                            return chainOrSuspend(
                                null,
                                ...yaml.components.map((subYaml, index) => () => setupComponent(subYaml, pyAddComponent, index)),
                                () => pyComponent
                            );
                        } else {
                            return pyComponent;
                        }
                    },
                    (exception) => {
                        console.error(`Error setting up component '${yaml?.name}' on ${pyForm?.tp$name}:`, exception, "\nYAML: ", yaml, "Python err: ", strError(exception));
                        // This exception is almost certainly user code, so we should produce helpful stack traces here
                        window.onerror(null, null, null, null, exception);
                        return mkInvalidComponent(`Error setting up component "${yaml?.name}": ${strError(exception)}`);
                    }
                ),
            (pyComponent) => {
                const layoutArgs = [];
                if (yaml.layout_properties) {
                    for (const [k, v] of Object.entries(yaml.layout_properties)) {
                        layoutArgs.push(new pyStr(k), toPy(v));
                    }
                }
                return pyAddToParent && pyCallOrSuspend<pyNoneType>(pyAddToParent, [pyComponent], layoutArgs);
            }
        );

    // A bit late to be setting this, really, but it's mostly used for loop detection within this module, so ~\o/~
    window.anvilCurrentlyConstructingForms.push({name: formYaml.class_name, pyForm});

    // Delay slot setup because we need the components.
    const setupSlotsAndCleanUp = () => {
        if (formYaml.slots) {
            setupResult.slots = {};
            const slotsByTarget: { container: {[containerName: string]: Slot[]}, slot: {[slotName: string]: Slot[]} } = {
                container: {},
                slot: {},
            };
            for (const [name, { set_layout_properties, one_component, template, target, index }] of Object.entries(formYaml.slots)) {
                let getContainer: () => Suspension | pyObject;
                if (target.type === "container") {
                    const pyContainer = target.name ? setupResult.components[target.name].component : pyForm;
                    if (!pyContainer) {
                        // TODO should we throw a real error here rather than a string?
                        throw `No such target container "${target.name}" for slot "${name}"`;
                    }
                    getContainer = () => pyContainer;
                } else {
                    getContainer = () => chainOrSuspend(
                        Sk.abstr.gattr(pyForm, s_layout, true),
                        pyLayout => Sk.abstr.gattr(pyLayout, s_slots, true),
                        (slots: pyDict<pyStr,Slot>) => {
                            const slot = slots.quick$lookup(new pyStr(target.name));
                            if (!slot) { throw `No such target slot ${target.name} for slot ${name}`; }
                            return slot;
                        });
                }
                let templateToolboxItem: ToolboxItem | undefined;
                if (template) {
                    templateToolboxItem = {
                        component: {...template, type: template.type.startsWith("form:") ? yamlSpecToQualifiedFormName(template.type.substring(5), getDefaultDepId(pyForm)) : `anvil.${template.type}`},
                        title: "Template",
                    }
                }
                const slot = new Slot(getContainer, index || 0, set_layout_properties, !!one_component, templateToolboxItem);
                setupResult.slots[name] = slot;

                // Make sure slots in the same container coexist happily (earlier slots affect insertion index of later slots)
                const slots = (slotsByTarget[target.type][target.name] ||= []);
                for (const s of slots) {
                    if (s._slotState.insertionIndex > slot._slotState.insertionIndex) {
                        s._slotState.earlierSlots.push(slot);
                    } else if (s._slotState.insertionIndex < slot._slotState.insertionIndex) {
                        slot._slotState.earlierSlots.push(s);
                    }
                }
                slots.push(slot);
            }
        }
        window.anvilCurrentlyConstructingForms.pop();
        return setupResult;
    };

    // Does this form use a layout, or not?
    if (formYaml.layout) {
        //let componentsBySlot: {[slotName:string]: {pyComponent: pyObject, layout_properties: object}} = {};

        return chainOrSuspend(
            undefined,
            ...Object.entries(formYaml.components_by_slot ?? []).map(([slotName, components], index) => () => {
                return chainOrSuspend(null, ...components.map((yaml) => () => setupComponent(yaml, null, index, slotName)));
            }),
            setupSlotsAndCleanUp
        );
    } else {
        // No layout; this form inherits from a container class directly
        addEventHandlers(pyForm, pyForm, formYaml.container as FormContainerYaml);

        const pyAddToForm = Sk.abstr.gattr(pyForm, py.s_add_component);
        return chainOrSuspend(
            null,
            ...(formYaml.components ?? []).map((yaml, index) => () => setupComponent(yaml, pyAddToForm, index)),
            setupSlotsAndCleanUp
        );
    }
}


export function setupFormComponents(formYaml: FormYaml, pyForm: Component, setupHandlers=true) {
    const pyFormDict = Sk.abstr.lookupSpecial(pyForm, pyStr.$dict) as pyDict;
    return chainOrSuspend(createComponents(formYaml, pyForm, setupHandlers), (setupResult: SetupResult) => {
        for (const [name, {component}] of Object.entries(setupResult.components)) {
            const pyName = new pyStr(name);
            if (isTrue(pyHasAttr(pyForm, pyName))) {
                Sk.builtin.print([
                    new pyStr(
                        `Warning: ${pyForm.tp$name} has a method or attribute '${name}' and a component called '${name}'. The method or attribute will be inaccessible. This is probably not what you want.`
                    ),
                ]);
            }
            // add it to the dunder dict
            pyFormDict.mp$ass_subscript(pyName, component);
        }
        return setupResult;
    });
}

export function addFormComponentsToLayout(formYaml: FormYaml, pyForm: Component, pyLayout: Component, setupHandlers=true) {
    const pyFormDict = Sk.abstr.lookupSpecial(pyForm, pyStr.$dict) as pyDict;
    const pySlots = Sk.abstr.gattr(pyLayout, s_slots) as pyDict<pyStr, Component>;
    return chainOrSuspend(
        null,
        ...Object.entries(formYaml.components_by_slot ?? []).map(([slotName, components]) => () => {
            let pySlot;
            try {
                pySlot = pySlots.mp$subscript(new pyStr(slotName));
            } catch (e: any) {
                if (e instanceof Sk.builtin.KeyError) {
                    window.onerror(null, null, null, null, new pyException(`Could not add components to slot '${slotName}': Slot not found`));
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
                                objectToKwargs(layout_properties)
                            )
                )
            );
        })
    );
}