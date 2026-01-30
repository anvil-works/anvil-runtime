import { getCssPrefix } from "@runtime/runner/legacy-features";
import { isTrue, pyObject } from "@Sk";
import * as styling from "./styling";
import { createElement } from "./dom-helpers";

// Shim PyDefUtils object so JSX transform can use PyDefUtils.h
// This avoids dependency on window.PyDefUtils while keeping JSX readable
const PyDefUtils = {
    h: createElement,
    Fragment: undefined, // Not used, but JSX transform may reference it
};

interface IconComponentProps {
    side?: string;
    icon?: pyObject;
    icon_align?: pyObject;
}

export function IconComponent({ side, icon: pyIcon, icon_align: pyIconAlign }: IconComponentProps) {
    side = side ? side : "";
    let icon;
    let iconClass = "";
    let img = false;
    if (isTrue(pyIcon)) {
        icon = pyIcon!.toString();
        const faclass = icon.split(":");
        if (faclass.length === 2 && faclass[0].startsWith("fa")) {
            iconClass = faclass[0] + " fa-" + faclass[1];
        } else {
            img = true;
        }
    }
    const refName = "icon" + side[0].toUpperCase() + side.slice(1);
    const prefix = getCssPrefix();
    const icon_align = isTrue(pyIconAlign) ? prefix + pyIconAlign!.toString() + "-icon" : "";
    side = prefix + side;
    if (img) {
        return (
            <i refName={refName} className={`anvil-component-icon ${side} ${icon_align}`}>
                <img src={icon} style="height: 1em; vertical-align: text-bottom;" />
            </i>
        );
    }
    return <i refName={refName} className={`anvil-component-icon ${side} ${iconClass} ${icon_align}`} />;
}

interface OuterElementProps {
    refName?: string;
    includePadding?: boolean;
    style?: string;
    className?: string;
    [key: string]: any;
}

export function OuterElement(
    { refName, includePadding = true, style, className, ...props }: OuterElementProps,
    ...children: JSX.Element[]
) {
    const outerClass = styling.getOuterClass(props as any) + (className ? " " + className : "");
    const outerStyle = styling.getOuterStyle(props as any, includePadding) + (style ? " " + style : "");
    const outerAttrs = styling.getOuterAttrs(props as any);
    return (
        <div
            refName={refName || "root"}
            className={outerClass}
            style={outerStyle}
            {...outerAttrs}
            children={children}
        />
    );
}
