// Stubs for components' interactions with a drag-n-drop UI designer
import {
    chainOrSuspend,
    checkArgsLen,
    checkString,
    copyKeywordsToNamedArgs,
    promiseToSuspension,
    proxy,
    pyCallable,
    pyDict,
    pyFalse,
    pyNone,
    pyObject,
    pyStr,
    pyTrue,
    remapToJsOrWrap,
    setUpModuleMethods,
    toJs,
    toPy,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import type { Component, ComponentConstructor, Section } from "../components/Component";

const NOT_AVAILABLE = (...args: any[]) => {
    throw new Error("UI designer not available");
};

export type SectionUpdates = { [id: string]: Partial<Omit<Section, "id">> | null };
export interface InlineEditableProperty {
    name: string;
    multiline?: boolean;
}

export interface InlineEditingOptions {
    onFinished?: () => void;
    sectionId?: string | null;
    getPropertyValue?: (element: HTMLElement, text: string | null) => any;
}

interface DesignerApi {
    inDesigner: boolean;
    updateComponentProperties(
        self: Component,
        propertyUpdates: { [prop: string]: any },
        layoutPropertyUpdates: { [prop: string]: any }
    ): void;
    updateComponentSections(self: Component, sectionUpdates?: SectionUpdates): void;
    preEditSubform(subform: Component): void;
    startEditingSubform(subform: Component): void;
    startEditingForm(pyComponent: Component, formId: string): void;
    startInlineEditing(
        pyComponent: Component,
        prop: InlineEditableProperty,
        element: HTMLElement,
        options: InlineEditingOptions
    ): void;
    registerInteraction(
        pyComponent: Component,
        element: Element,
        event: "dblclick",
        callback: (e: MouseEvent) => void
    ): void;
    notifyInteractionsChanged(pyComponent: Component): void;
    /** @deprecated */
    notifyDomNodeChanged(pyComponent: Component): void;
    getDesignerState(pyComponent: Component): Map<string, any>;
    getDesignComponent(componentClass: ComponentConstructor): ComponentConstructor;
    requestFormPropertyChange(
        pyRequestingComponent: Component,
        formProperty: string | ComponentConstructor,
        propertyName: string,
        propertyValue: any
    ): void;
    getDesignName(pyComponent: Component): string | null;
}

export let designerApi: DesignerApi = {
    inDesigner: false,
    getDesignName: (pyComponent: Component) => null,
    updateComponentProperties: NOT_AVAILABLE,
    updateComponentSections: () => null,
    preEditSubform: NOT_AVAILABLE,
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

/*!defModuleAttr(anvil.designer)!1*/ ({
    name: "in_designer",
    description: "True when code is running in the Anvil designer, otherwise False.",
    anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
});

export const pyDesignerApi = {
    __name__: new pyStr("designer"),
    in_designer: pyFalse,
};

// we use this so that a user of this api can catch exceptions
function wrapMaybePromise(v: void | Promise<void>) {
    return promiseToSuspension(Promise.resolve(v).then(() => pyNone));
}

setUpModuleMethods("designer", pyDesignerApi, {
    /*!defBuiltinFunction(anvil.designer,!_,component)!1*/
    get_design_name: {
        $name: "get_design_name",
        $doc: "Get the design-time name for a component, if available.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(pyComponent) {
            return toPy(designerApi.getDesignName(pyComponent));
        },
        $flags: { OneArg: true },
    },
    /*!defBuiltinFunction(anvil.designer,!_,component)!1*/
    get_designer_state: {
        $name: "get_designer_state",
        $doc: "Get component-specific state managed by the designer.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(pyComponent) {
            // this turns the Map into a python dict like object
            return proxy(designerApi.getDesignerState(pyComponent));
        },
        $flags: { OneArg: true },
    },
    /*!defBuiltinFunction(anvil.designer,!None,component,[properties],[layout_properties])!1*/
    update_component_properties: {
        $name: "update_component_properties",
        $doc: "Store updated component and container properties in the designer.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(pyComponent, pyProperties, pyLayoutProperties) {
            return wrapMaybePromise(
                designerApi.updateComponentProperties(pyComponent, toJs(pyProperties), toJs(pyLayoutProperties))
            );
        },
        $flags: { NamedArgs: ["component", "properties", "layout_properties"], Defaults: [new pyDict(), new pyDict()] },
    },
    /*!defBuiltinFunction(anvil.designer,!None,component,[section_updates=None])!1*/
    update_component_sections: {
        $name: "update_component_sections",
        $doc: "Notify the designer that sections have moved, changed, or been removed.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(pyComponent, pySectionUpdates) {
            return wrapMaybePromise(
                designerApi.updateComponentSections(
                    pyComponent,
                    pySectionUpdates && pySectionUpdates !== pyNone && toJs(pySectionUpdates)
                )
            );
        },
        $flags: { NamedArgs: ["component", "section_updates"], Defaults: [pyNone] },
    },
    /*!defBuiltinFunction(anvil.designer,!None,form_component)!1*/
    start_editing_subform: {
        $name: "start_editing_subform",
        $doc: "Request that the designer start editing a nested form component.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(subForm: Component) {
            return wrapMaybePromise(designerApi.startEditingSubform(subForm));
        },
        $flags: { OneArg: true },
    },
    /*!defBuiltinFunction(anvil.designer,!None,requesting_component,form_property_value)!1*/
    start_editing_form: {
        $name: "start_editing_form",
        $doc: "Request that the designer switch to editing another form.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(pyComponent, formId) {
            if (checkString(formId)) {
                return wrapMaybePromise(designerApi.startEditingForm(pyComponent, formId.toString()));
            }
            return pyNone;
        },
        $flags: { NamedArgs: ["requesting_component", "form_property_value"] },
    },
    /*!defBuiltinFunction(anvil.designer,!None,component,dom_element,[event="dblclick"],[callback=None])!1*/
    register_interaction: {
        $name: "register_interaction",
        $doc: "Register a design-time mouse interaction callback for a component.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(pyComponent: Component, domElement: pyObject, event: pyStr | typeof pyNone, callback: pyCallable) {
            if (event !== pyNone && event.toString() !== "dblclick") {
                return pyNone;
            }
            return chainOrSuspend(toJs(domElement) || pyComponent.anvil$hooks.setupDom(), (element: Element) => {
                return wrapMaybePromise(
                    designerApi.registerInteraction(pyComponent, element, "dblclick", (e) =>
                        PyDefUtils.callAsync(callback, undefined, undefined, undefined, toPy(e))
                    )
                );
            });
        },
        $flags: {
            NamedArgs: ["component", "dom_element", "event", "callback"],
            Defaults: [new pyStr("dblclick"), pyNone],
        },
    },
    /*!defBuiltinFunction(anvil.designer,!None,component)!1*/
    notify_interactions_changed: {
        $name: "notify_interactions_changed",
        $doc: "Notify the designer that available interactions may have changed.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(pyComponent: Component) {
            return wrapMaybePromise(designerApi.notifyInteractionsChanged(pyComponent));
        },
        $flags: { OneArg: true },
    },
    /*!defBuiltinFunction(anvil.designer,_,component_class)!1*/
    get_design_component: {
        $name: "get_design_component",
        $doc: "Get the design-time class for a component class.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth: (pyComponentClass: ComponentConstructor) => designerApi.getDesignComponent(pyComponentClass),
        $flags: { OneArg: true },
    },
    /*!defBuiltinFunction(anvil.designer,!None,requesting_component,form,property_name,property_value)!1*/
    request_form_property_change: {
        $name: "request_form_property_change",
        $doc: "Request a property change on a form selected by a form-property value.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(
            requestingComponent: Component,
            formProperty: pyStr | ComponentConstructor,
            propertyName: pyStr,
            propertyValue: pyObject
        ) {
            if (checkString(formProperty)) {
                return wrapMaybePromise(
                    designerApi.requestFormPropertyChange(
                        requestingComponent,
                        formProperty.toString(),
                        propertyName.toString(),
                        toJs(propertyValue)
                    )
                );
            }
            return pyNone;
        },
        $flags: { NamedArgs: ["requesting_component", "form", "property_name", "property_value"] },
    },
    /*!defBuiltinFunction(anvil.designer,!None,component,property_name,[dom_element=None],[on_finished=None])!1*/
    start_inline_editing: {
        $name: "start_inline_editing",
        $doc: "Request inline editing for a string property in the designer.",
        /*GENDOC*
        anvil$helpLink: "/docs/client/forms/advanced-layouts/component-api/designer-module",
        //*/
        $meth(args, kws = []) {
            // TODO - we should probably add multiline support
            const [pyComponent, propertyName, domElement, on_finished] = copyKeywordsToNamedArgs(
                "start_inline_editing",
                ["component", "property_name", "dom_element", "on_finished"],
                args,
                kws,
                [pyNone, pyNone]
            );
            // on_finished is keyword only
            checkArgsLen("start_inline_editing", args, 2, 3);

            if (!checkString(propertyName)) return pyNone;

            const onFinished: any = remapToJsOrWrap(on_finished) ?? undefined;

            return chainOrSuspend(toJs(domElement) || pyComponent.anvil$hooks.setupDom(), (element: HTMLElement) => {
                return wrapMaybePromise(
                    designerApi.startInlineEditing(pyComponent, { name: toJs(propertyName) }, element, {
                        onFinished,
                    })
                );
            });
        },
        $flags: { FastCall: true },
    },
});

export function setDesignerApi(api: DesignerApi) {
    designerApi = api;
    pyDesignerApi["in_designer"] = pyTrue;
}
