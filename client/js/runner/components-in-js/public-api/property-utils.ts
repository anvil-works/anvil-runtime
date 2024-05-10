import { MarginPropertyValue, PaddingPropertyValue, SpacingPropertyValue } from "@runtime/components/Component";
import { getSpacingObject } from "@runtime/runner/component-property-utils-api";

export const getMarginStyles = (margin: MarginPropertyValue) => getSpacingObject(margin, "margin");
export const getPaddingStyles = (padding: PaddingPropertyValue) => getSpacingObject(padding, "padding");
export const getSpacingStyles = (spacing: SpacingPropertyValue) => ({
    ...getSpacingObject(spacing?.margin as MarginPropertyValue, "margin"),
    ...getSpacingObject(spacing?.padding as PaddingPropertyValue, "padding"),
});

export const setElementMargin = (element: HTMLElement, margin: MarginPropertyValue) =>
    Object.assign(element.style, getMarginStyles(margin));
export const setElementPadding = (element: HTMLElement, padding: PaddingPropertyValue) =>
    Object.assign(element.style, getPaddingStyles(padding));
export const setElementSpacing = (element: HTMLElement, spacing: SpacingPropertyValue) =>
    Object.assign(element.style, getSpacingStyles(spacing));

export function setElementVisibility(element: HTMLElement, visible: boolean) {
    if (!visible) {
        element.setAttribute("anvil-visible-false", "");
    } else {
        element.removeAttribute("anvil-visible-false");
    }
}
