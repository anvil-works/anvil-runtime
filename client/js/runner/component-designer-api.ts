// Stubs for components' interactions with a drag-n-drop UI designer

import {
    pyFalse,
    pyTrue,
    toJs,
    toPy,
    pyFunc,
    chainOrSuspend,
    pyNone,
    pyStr,
    pyCallable,
    Kws,
    pyObject,
    setUpModuleMethods,
    pyDict,
    checkString
} from "../@Sk";
import type {Component, ComponentConstructor, Interaction, PropertyDescriptionBase, Section, StringPropertyDescription} from "../components/Component";
import {ComponentProperties} from "../components/Component";
import {getFormInstantiator} from "@runtime/runner/instantiation";
import PyDefUtils from "PyDefUtils";

const NOT_AVAILABLE = (...args: any[]) => {
    throw new Error("UI designer not available");
};

export type SectionUpdates = {[id: string]: Partial<Omit<Section, "id">> | null};

interface DesignerApi {
    inDesigner: boolean;
    updateComponentProperties(
        self: Component,
        propertyUpdates: { [prop: string]: any },
        layoutPropertyUpdates: { [prop: string]: any },
    ): void;
    updateComponentSections(
        self: Component,
        sectionUpdates?: SectionUpdates
    ): void;
    startEditingSubform(subform: Component): void;
    startEditingForm(pyComponent: Component, formId: string): void;
    startInlineEditing(
        pyComponent: Component,
        prop: StringPropertyDescription,
        element: HTMLElement,
        options: { onFinished?: () => void; sectionId?: string | null }
    ): void;
    registerInteraction(pyComponent: Component, element: Element, event: "dblclick", callback: (e: MouseEvent)=>void): void;
    notifyInteractionsChanged(pyComponent: Component): void;
    notifyDomNodeChanged(pyComponent: Component): void;
    getDesignerState(pyComponent: Component): Map<string, any>;
    getDesignComponent(componentClass: ComponentConstructor): ComponentConstructor;
    requestFormPropertyChange(pyRequestingComponent: Component, formProperty: string|ComponentConstructor, propertyName: string, propertyValue: any): void;
    getDesignName(pyComponent: Component): string | null;
}

export let designerApi: DesignerApi = {
    inDesigner: false,
    getDesignName: (pyComponent: Component) => null,
    updateComponentProperties: NOT_AVAILABLE,
    updateComponentSections: () => null,
    startEditingSubform: NOT_AVAILABLE,
    startInlineEditing: NOT_AVAILABLE,
    startEditingForm: NOT_AVAILABLE,
    registerInteraction: () => null,
    notifyInteractionsChanged: () => null,
    notifyDomNodeChanged: () => null,
    getDesignerState: NOT_AVAILABLE,
    getDesignComponent: (componentClass) => componentClass,
    requestFormPropertyChange: () => null,
};

export const pyDesignerApi = {
    __name__: new pyStr("designer"),
    in_designer: pyFalse,
};

setUpModuleMethods("designer", pyDesignerApi, {
    get_design_name: {
        $meth(pyComponent) {
            return toPy(designerApi.getDesignName(pyComponent));
        },
        $flags: { OneArg: true},
    },
    update_component_properties: {
        $meth(pyComponent, pyProperties, pyLayoutProperties) {
            designerApi.updateComponentProperties(pyComponent, toJs(pyProperties), toJs(pyLayoutProperties));
            return pyNone;
        },
        $flags: { NamedArgs: ["component", "properties", "layout_properties"], Defaults: [new pyDict(), new pyDict()] },
    },
    update_component_sections: {
        $meth(pyComponent, pySectionUpdates) {
            designerApi.updateComponentSections(pyComponent, pySectionUpdates && pySectionUpdates !== pyNone && toJs(pySectionUpdates));
            return pyNone;
        },
        $flags: { NamedArgs: ["component", "section_updates"], Defaults: [pyNone]}
    },
    start_editing_subform: {
        $meth(subForm: Component) {
            designerApi.startEditingSubform(subForm);
            return pyNone;
        },
        $flags: { OneArg: true }
    },
    start_editing_form: {
        $meth(pyComponent, formId) {
            if (checkString(formId)) {
                designerApi.startEditingForm(pyComponent, formId.toString())
            }
            return pyNone;
        },
        $flags: { NamedArgs: ["requesting_component", "form_property_value"] }
    },
    register_interaction: {
        $meth(pyComponent: Component, domElement: pyObject, event: pyStr | typeof pyNone, callback: pyCallable) {
            if (event !== pyNone && event.toString() !== "dblclick") {
                return pyNone;
            }
            return chainOrSuspend(toJs(domElement) || pyComponent.anvil$hooks.setupDom(), (element: Element) => {
                designerApi.registerInteraction(pyComponent, element, "dblclick", (e) => PyDefUtils.callAsync(callback, undefined, undefined, undefined, toPy(e)));
                return pyNone;
            });
        },
        $flags: { NamedArgs: ["component", "dom_element", "event", "callback"], Defaults: [new pyStr("dblclick"), pyNone] }
    },
    notify_interactions_changed: {
        $meth(pyComponent: Component) {
            designerApi.notifyInteractionsChanged(pyComponent);
            return pyNone;
        },
        $flags: { OneArg: true },
    },
    get_constructor_for_form_property: {
        $meth: (parentForm: Component, formProperty: pyStr | ComponentConstructor | (pyCallable & { anvil$isFormInstantiator: true })) =>
            formProperty?.anvil$isFormInstantiator ?
                formProperty :
                chainOrSuspend(getFormInstantiator({requestingComponent: parentForm}, formProperty as pyStr | ComponentConstructor), instantiate => {
                    const r = new Sk.builtin.func(PyDefUtils.withRawKwargs((kws: Kws, pathStep?: pyObject) =>
                        chainOrSuspend(instantiate(kws, pathStep ? toJs(pathStep) as string | number : undefined))));
                    r.anvil$isFormInstantiator = true;
                    return r;
                }),
        $flags: { NamedArgs: ["parent_form", "property_value"] }
    },
    get_design_component: {
        $meth: ((pyComponentClass: ComponentConstructor) =>
            designerApi.getDesignComponent(pyComponentClass)),
        $flags: { OneArg: true }
    },
    request_form_property_change: {
        $meth(requestingComponent: Component, formProperty: pyStr | ComponentConstructor, propertyName: pyStr, propertyValue: pyObject) {
            if (checkString(formProperty)) {
                designerApi.requestFormPropertyChange(requestingComponent, formProperty.toString(), propertyName.toString(), toJs(propertyValue));
            }
            return pyNone;
        },
        $flags: { NamedArgs: ["requesting_component", "form", "property_name", "property_value"] }
    },
    start_inline_editing: {
        $meth(pyComponent: Component, propertyName: any, domElement: pyObject) {
            if (checkString(propertyName)) {
                return chainOrSuspend(toJs(domElement) || pyComponent.anvil$hooks.setupDom(), (element: HTMLElement) => {
                    designerApi.startInlineEditing(pyComponent, {name: toJs(propertyName), type: 'string'}, element, {});
                    return pyNone;
                });

            }
            return pyNone;
        },
        $flags: { NamedArgs: ["component", "property_name", "dom_element"], Defaults: [pyNone]},
    }
});

export function setDesignerApi(api: DesignerApi) {
    designerApi = api;
    pyDesignerApi["in_designer"] = pyTrue;
}
