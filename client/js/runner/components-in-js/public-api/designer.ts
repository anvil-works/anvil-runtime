/**
 * This Module is a thin wrapper around the private designAPI internals
 * We put this API in the window.anvil namespace
 * We can then wrap this API in other frameworks like React/Solid etc
 *
 */

import { ComponentConstructor, StringPropertyDescription } from "@runtime/components/Component";
import { SectionUpdates, designerApi } from "@runtime/runner/component-designer-api";
import { JsComponent } from "./component";
import { assert, toPyComponent } from "./utils";

// @ts-ignore
export const inDesigner: boolean = window.anvilInDesigner;

export function getDesignName(jsComponent: JsComponent) {
    return designerApi.getDesignName(toPyComponent(jsComponent));
}

export function updateComponentProperties(
    jsComponent: JsComponent,
    propertyUpdates: { [prop: string]: any },
    layoutPropertyUpdates: { [prop: string]: any }
) {
    return designerApi.updateComponentProperties(toPyComponent(jsComponent), propertyUpdates, layoutPropertyUpdates);
}

export function updateComponentSections(jsComponent: JsComponent, sectionUpdates?: SectionUpdates) {
    designerApi.updateComponentSections(toPyComponent(jsComponent), sectionUpdates);
}

export function startEditingSubform(jsComponent: JsComponent) {
    designerApi.startEditingSubform(toPyComponent(jsComponent));
}

export function startEditingForm(jsComponent: JsComponent, formPropertyValue: string) {
    assert(typeof formPropertyValue === "string", "formPropertyValue must be a string");
    designerApi.startEditingForm(toPyComponent(jsComponent), formPropertyValue);
}

export async function registerInteraction(
    jsComponent: JsComponent,
    {
        event = "dblclick",
        callback,
        element,
    }: { event: "dblclick"; callback: (e: MouseEvent) => void; element?: HTMLElement }
) {
    if (event !== "dblclick") return;
    if (!element) element = await jsComponent._anvilSetupDom();
    return designerApi.registerInteraction(toPyComponent(jsComponent), element, event, callback);
}

export function notifyInteractionsChanged(jsComponent: JsComponent) {
    designerApi.notifyInteractionsChanged(toPyComponent(jsComponent));
}

export function notifyDomNodeChanged(jsComponent: JsComponent) {
    designerApi.notifyDomNodeChanged(toPyComponent(jsComponent));
}

export function getConstructorForFormProperty() {
    // TODO
}

export function getDesignComponent(pyComponentClass: ComponentConstructor) {
    // TODO - how would you get a pyComponentClass from javascript?
    return designerApi.getDesignComponent(pyComponentClass);
}

export function requestFormPropertyChange() {
    // TODO
}

export interface InlineEditingOptions {
    onFinished?: () => void;
    sectionId?: string | null;
}

export function startInlineEditing(
    jsComponent: JsComponent,
    prop: StringPropertyDescription,
    element: HTMLElement,
    options: InlineEditingOptions = {}
) {
    return designerApi.startInlineEditing(toPyComponent(jsComponent), prop, element, options);
}

export function getDesignerState(jsComponent: JsComponent) {
    return designerApi.getDesignerState(toPyComponent(jsComponent));
}
