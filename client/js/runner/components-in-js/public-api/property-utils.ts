import { MarginPropertyValue, PaddingPropertyValue, SpacingPropertyValue } from "@runtime/components/Component";
import {
    getSpacingObject,
    getUnsetMargin,
    getUnsetPadding,
    getUnsetSpacing,
    getUnsetValue,
} from "@runtime/runner/component-property-utils-api";

export const getMarginStyles = (margin: MarginPropertyValue | undefined) => getSpacingObject(margin, "margin");
export const getPaddingStyles = (padding: PaddingPropertyValue | undefined) => getSpacingObject(padding, "padding");
export const getSpacingStyles = (spacing: SpacingPropertyValue | null | undefined) => ({
    ...getSpacingObject(spacing?.margin, "margin"),
    ...getSpacingObject(spacing?.padding, "padding"),
});

export const styleObjectToString = (style: any) => {
    const s = Object.entries(style)
        .map(([key, value]) => `${key.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${value}`)
        .join("; ");
    return s ? s + ";" : "";
};

export const setElementMargin = (element: HTMLElement, margin: MarginPropertyValue | undefined) =>
    Object.assign(element.style, getMarginStyles(margin));
export const setElementPadding = (element: HTMLElement, padding: PaddingPropertyValue | undefined) =>
    Object.assign(element.style, getPaddingStyles(padding));
export const setElementSpacing = (element: HTMLElement, spacing: SpacingPropertyValue | null | undefined) =>
    Object.assign(element.style, getSpacingStyles(spacing));

export function setElementVisibility(element: Element, visible: boolean) {
    if (!visible) {
        element.setAttribute("anvil-visible-false", "");
    } else {
        element.removeAttribute("anvil-visible-false");
    }
}

export { getUnsetMargin, getUnsetPadding, getUnsetSpacing, getUnsetValue };
