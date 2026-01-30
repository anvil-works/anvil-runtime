import { toJs, isTrue, pyObject, checkNone } from "@Sk";
import { MarginPropertyValue, PaddingPropertyValue, SpacingPropertyValue } from "@runtime/components/Component";
import {
    getMarginStyles,
    getPaddingStyles,
    styleObjectToString,
} from "@runtime/runner/components-in-js/public-api/property-utils";
import { getCssPrefix } from "@runtime/runner/legacy-features";

const isPyTrue = (obj: any): obj is pyObject => isTrue(obj);

export interface GetOuterClassParams {
    align?: pyObject;
    icon?: pyObject;
    icon_align?: pyObject;
    role?: pyObject;
    spacing_above?: pyObject;
    spacing_below?: pyObject;
    text?: pyObject;
    visible?: pyObject;
}

const spacing: readonly string[] = ["none", "small", "medium", "large"];

export function getOuterClass({
    align,
    icon,
    icon_align,
    role,
    spacing_above,
    spacing_below,
    text,
    visible,
}: GetOuterClassParams) {
    const prefix = getCssPrefix();
    const classList: string[] = [];

    if (isPyTrue(align) && ["center", "right", "left"].includes(align.toString())) {
        classList.push(prefix + "align-" + align.toString());
    }
    if (isPyTrue(spacing_above) && spacing.includes(spacing_above.toString())) {
        classList.push("anvil-spacing-above-" + spacing_above.toString());
    }
    if (isPyTrue(spacing_below) && spacing.includes(spacing_below.toString())) {
        classList.push("anvil-spacing-below-" + spacing_below.toString());
    }
    if (isPyTrue(icon)) {
        classList.push("anvil-component-icon-present");
    }
    if (isPyTrue(icon_align)) {
        classList.push(prefix + icon_align + "-icon");
    }
    if (visible !== undefined && !isPyTrue(visible)) {
        classList.push(prefix + "visible-false");
    }
    if (isPyTrue(role)) {
        for (let r of applyRole(role)) {
            classList.push("anvil-role-" + r);
        }
    }
    if (isPyTrue(text)) {
        classList.push(prefix + "has-text");
    }
    return classList.join(" ");
}

const hasUnits = /[a-zA-Z%]/g;

const lenHasUnits = (len?: string | number | null): len is string => {
    return typeof len === "string" && len.match(hasUnits) !== null;
};
export const cssLength = (len?: string | number | null): string => {
    return len === "default" || !len ? "" : lenHasUnits(len) ? len : len + "px";
};

const ROLE_REGEX = /[^A-Za-z0-9_-]/g;

const filterArrayLike = Array.prototype.filter as (
    this: ArrayLike<string>,
    predicate: (value: string) => boolean
) => string[];

export function applyRole(pyRole: pyObject, domNode: HTMLElement | null = null) {
    // get all the classes that that are not anvil-roles
    let role = toJs(pyRole);

    const newRoles: string[] = [];

    if (role === null) {
        // pass
    } else if (Array.isArray(role)) {
        for (let r of role) {
            if (!(typeof r === "string")) {
                throw new Sk.builtin.TypeError("role must be None, a string, or a list of strings");
            }
            newRoles.push(r.replace(ROLE_REGEX, ""));
        }
    } else if (typeof role === "string") {
        newRoles.push(role.replace(ROLE_REGEX, ""));
    } else {
        throw new Sk.builtin.TypeError("role must be None, a string, or a list of strings");
    }

    if (domNode !== null) {
        const hasPrevRoles = domNode.getAttribute("anvil-role") !== null;
        const hasNewRoles = newRoles.length !== 0;
        if (hasNewRoles && !hasPrevRoles) {
            domNode.setAttribute("anvil-role", newRoles.join(" "));
            domNode.className = domNode.className + " anvil-role-" + newRoles.join(" anvil-role-");
        } else if (hasNewRoles) {
            domNode.setAttribute("anvil-role", newRoles.join(" "));
            domNode.className =
                filterArrayLike.call(domNode.classList, (c: string) => !c.startsWith("anvil-role-")).join(" ") +
                " anvil-role-" +
                newRoles.join(" anvil-role-");
        } else if (hasPrevRoles) {
            domNode.removeAttribute("anvil-role");
            domNode.className = filterArrayLike.call(domNode.classList, (c) => !c.startsWith("anvil-role-")).join(" ");
        } else {
            // nothing to do - no roles to add and no roles to remove;
        }
    }

    return newRoles;
}

export const getColor = (pyValue: pyObject | string) => {
    const v = checkNone(pyValue) ? "" : pyValue.toString();
    const m = v.match(/^theme:(.*)$/);
    if (!m) {
        return v;
    } else {
        const cssVar = window.anvilThemeVars[m[1]];
        return cssVar ? `var(${cssVar})` : "";
    }
};

export const loadScript = (url: string, onload?: () => void) => {
    const script = document.createElement("script");
    script.src = url;
    const p = new Promise<void>((resolve, reject) => {
        script.onload = () => {
            resolve();
            onload?.();
        };
        script.onerror = reject;
    });
    document.body.appendChild(script);
    return p;
};

export function getPaddingStyle({ padding, spacing }: { padding?: pyObject; spacing?: pyObject }) {
    const style: Record<string, string> = {};

    if (isPyTrue(padding)) {
        Object.assign(style, getPaddingStyles(toJs(padding) as PaddingPropertyValue));
    } else if (isPyTrue(spacing)) {
        const spacingJs = toJs(spacing) as SpacingPropertyValue;
        if (spacingJs.padding) {
            Object.assign(style, getPaddingStyles(spacingJs.padding));
        }
    }

    return styleObjectToString(style);
}

export interface GetOuterStyleParams {
    align?: pyObject;
    font_size?: pyObject;
    font?: pyObject;
    bold?: pyObject;
    italic?: pyObject;
    underline?: pyObject;
    background?: pyObject;
    foreground?: pyObject;
    border?: pyObject;
    border_radius?: pyObject;
    height?: pyObject;
    width?: pyObject;
    spacing?: pyObject;
    margin?: pyObject;
    padding?: pyObject;
}
export function getOuterStyle(
    {
        align,
        font_size,
        font,
        bold,
        italic,
        underline,
        background,
        foreground,
        border,
        border_radius,
        height,
        width,
        spacing,
        margin,
        padding,
    }: GetOuterStyleParams,
    includePadding = true
) {
    const style: Record<string, string> = {};
    if (isPyTrue(align)) {
        style["text-align"] = align.toString();
    }
    const fontSizeJs = toJs(font_size); // skulpt behaviour only accepts number types for font_size
    if (typeof fontSizeJs === "number") {
        style["font-size"] = fontSizeJs + "px";
    }
    if (isPyTrue(font)) {
        style["font-family"] = font.toString();
    }
    if (isPyTrue(bold)) {
        style["font-weight"] = "bold";
    }
    if (isPyTrue(italic)) {
        style["font-style"] = "italic";
    }
    if (isPyTrue(underline)) {
        style["text-decoration"] = "underline";
    }
    if (isPyTrue(background)) {
        style["background-color"] = getColor(background);
    }
    if (isPyTrue(foreground)) {
        style["color"] = getColor(foreground);
    }
    if (isPyTrue(border)) {
        style["border"] = border.toString();
    }
    if (isPyTrue(border_radius)) {
        style["border-radius"] = cssLength(border_radius.toString());
    }
    if (isPyTrue(height)) {
        style["height"] = cssLength(height.toString());
    }
    if (isPyTrue(width)) {
        style["width"] = cssLength(width.toString());
    }

    if (isPyTrue(spacing)) {
        const jsSpacing = toJs(spacing) as SpacingPropertyValue;
        if (jsSpacing.margin) {
            Object.assign(style, getMarginStyles(jsSpacing.margin));
        }
        if (includePadding && jsSpacing.padding) {
            Object.assign(style, getPaddingStyles(jsSpacing.padding));
        }
    } else {
        if (isPyTrue(margin)) {
            Object.assign(style, getMarginStyles(toJs(margin) as MarginPropertyValue));
        }
        if (includePadding && isPyTrue(padding)) {
            Object.assign(style, getPaddingStyles(toJs(padding) as PaddingPropertyValue));
        }
    }

    return styleObjectToString(style);
}

export interface GetOuterAttrsParams {
    tooltip?: pyObject;
    source?: pyObject;
    role?: pyObject;
    enabled?: pyObject;
}

export function getOuterAttrs({ tooltip, source, role, enabled }: GetOuterAttrsParams) {
    const attrs: Record<string, string> = {};
    if (isPyTrue(tooltip)) {
        attrs["title"] = tooltip.toString();
    }
    if (isPyTrue(source)) {
        attrs["src"] = source.toString();
    }
    if (isPyTrue(role)) {
        const roles = applyRole(role);
        attrs["anvil-role"] = roles.join(" ");
    }
    if (enabled !== undefined && !isPyTrue(enabled)) {
        attrs["disabled"] = ""; // we currently add this to the outer div so do it here too
    }
    return attrs;
}
