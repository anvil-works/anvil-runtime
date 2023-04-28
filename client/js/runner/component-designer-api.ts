// Stubs for components' interactions with a drag-n-drop UI designer

import { pyFalse, pyTrue, toJs, toPy, pyFunc, chainOrSuspend, pyNone, pyStr } from "../@Sk";
import type {Component, Interaction, PropertyDescriptionBase, Section, StringPropertyDescription} from "../components/Component";
import {ComponentProperties} from "../components/Component";

const NOT_AVAILABLE = (...args: any[]) => {
    throw new Error("UI designer not available");
};

export type SectionUpdates = {[id: string]: Partial<Omit<Section, "id">> | null} | true;

export interface DesignerState {
    [key:string]: any;
}

interface DesignerApi {
    inDesigner: boolean;
    updateComponentProperties(
        self: Component,
        propertyUpdates: { [prop: string]: any },
        layoutPropertyUpdates: { [prop: string]: any },
        sectionUpdates?: SectionUpdates
    ): void;
    startEditingSubform(subform: Component): void;
    startEditingForm(formId: string): void;
    startInlineEditing(
        pyComponent: Component,
        prop: StringPropertyDescription,
        element: HTMLElement,
        options: { onFinished?: () => void; sectionId?: string | null }
    ): void;
    allowDirectInteraction(pyComponent: Component): void;
    notifyBoundsChanged(pyComponent: Component): void;
    notifyInteractionsChanged(pyComponent: Component): void;
    notifyDomNodeChanged(pyComponent: Component): void;
    getDesignerState(pyComponent: Component): DesignerState;
}

export let designerApi: DesignerApi = {
    inDesigner: false,
    updateComponentProperties: NOT_AVAILABLE,
    startEditingSubform: NOT_AVAILABLE,
    startInlineEditing: NOT_AVAILABLE,
    startEditingForm: NOT_AVAILABLE,
    allowDirectInteraction: NOT_AVAILABLE,
    notifyBoundsChanged: NOT_AVAILABLE,
    notifyInteractionsChanged: NOT_AVAILABLE,
    notifyDomNodeChanged: NOT_AVAILABLE,
    getDesignerState: NOT_AVAILABLE,
};

export const pyDesignerApi = {
    __name__: new pyStr("designer"),
    in_designer: pyFalse,
    update_component_properties: new pyFunc((pyComponent, pyProperties, pyLayoutProperties, pySections) => {
        designerApi.updateComponentProperties(pyComponent, toJs(pyProperties), toPy(pyLayoutProperties), pySections && toPy(pySections));
        return pyNone;
    }),
    start_editing_subform: new Sk.builtin.func((subForm: Component) => {
        designerApi.startEditingSubform(subForm);
        return pyNone;
    }),
    start_editing_form: new Sk.builtin.func((formId: pyStr) => {
        designerApi.startEditingForm(formId.toString())
        return pyNone;
    }),
    allow_direct_interaction: new Sk.builtin.func((pyComponent: Component) => {
        designerApi.allowDirectInteraction(pyComponent);
        return pyNone;
    }),
    notify_bounds_changed: new Sk.builtin.func((pyComponent: Component) => {
        designerApi.notifyBoundsChanged(pyComponent);
        return pyNone;
    })
    // TODO: start_inline_editing. How do we pass the element?
};

export function setDesignerApi(api: DesignerApi) {
    designerApi = api;
    pyDesignerApi["in_designer"] = pyTrue;
}
