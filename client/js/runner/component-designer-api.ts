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
import type { Component, ComponentConstructor, Section, StringPropertyDescription } from "../components/Component";

const NOT_AVAILABLE = (...args: any[]) => {
    throw new Error("UI designer not available");
};

export type SectionUpdates = { [id: string]: Partial<Omit<Section, "id">> | null };

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
        prop: StringPropertyDescription,
        element: HTMLElement,
        options: { onFinished?: () => void; sectionId?: string | null }
    ): void;
    registerInteraction(
        pyComponent: Component,
        element: Element,
        event: "dblclick",
        callback: (e: MouseEvent) => void
    ): void;
    notifyInteractionsChanged(pyComponent: Component): void;
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

export const pyDesignerApi = {
    __name__: new pyStr("designer"),
    in_designer: pyFalse,
};

// we use this so that a user of this api can catch exceptions
function wrapMaybePromise(v: void | Promise<void>) {
    return promiseToSuspension(Promise.resolve(v).then(() => pyNone));
}

setUpModuleMethods("designer", pyDesignerApi, {
    get_design_name: {
        $meth(pyComponent) {
            return toPy(designerApi.getDesignName(pyComponent));
        },
        $flags: { OneArg: true },
    },
    get_designer_state: {
        $meth(pyComponent) {
            // this turns the Map into a python dict like object
            return proxy(designerApi.getDesignerState(pyComponent));
        },
        $flags: { OneArg: true },
    },
    update_component_properties: {
        $meth(pyComponent, pyProperties, pyLayoutProperties) {
            return wrapMaybePromise(
                designerApi.updateComponentProperties(pyComponent, toJs(pyProperties), toJs(pyLayoutProperties))
            );
        },
        $flags: { NamedArgs: ["component", "properties", "layout_properties"], Defaults: [new pyDict(), new pyDict()] },
    },
    update_component_sections: {
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
    start_editing_subform: {
        $meth(subForm: Component) {
            return wrapMaybePromise(designerApi.startEditingSubform(subForm));
        },
        $flags: { OneArg: true },
    },
    start_editing_form: {
        $meth(pyComponent, formId) {
            if (checkString(formId)) {
                return wrapMaybePromise(designerApi.startEditingForm(pyComponent, formId.toString()));
            }
            return pyNone;
        },
        $flags: { NamedArgs: ["requesting_component", "form_property_value"] },
    },
    register_interaction: {
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
    notify_interactions_changed: {
        $meth(pyComponent: Component) {
            return wrapMaybePromise(designerApi.notifyInteractionsChanged(pyComponent));
        },
        $flags: { OneArg: true },
    },
    get_design_component: {
        $meth: (pyComponentClass: ComponentConstructor) => designerApi.getDesignComponent(pyComponentClass),
        $flags: { OneArg: true },
    },
    request_form_property_change: {
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
    start_inline_editing: {
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
                    designerApi.startInlineEditing(pyComponent, { name: toJs(propertyName), type: "string" }, element, {
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
