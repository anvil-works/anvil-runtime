import { checkString, isTrue, toJs } from "@Sk";
import { ClassicComponent, ClassicPropertyDescription } from "@runtime/components/ClassicComponent";
import { PaddingPropertyValue, notifyVisibilityChange } from "@runtime/components/Component";
import {
    getUnsetMargin,
    getUnsetPadding,
    getUnsetSpacing,
    getUnsetValue,
    setElementMargin,
    setElementPadding,
    setElementSpacing,
} from "@runtime/runner/components-in-js/public-api/property-utils";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { mapGetter, mapSetter } from "./map-overlays";
import { applyRole, cssLength, getColor } from "./styling";

export interface PropertyGroup {
    [key: string]: {
        [key: string]: ClassicPropertyDescription<
            ClassicComponent<{ elements: { root: HTMLElement; [key: string]: HTMLElement } }>
        >;
    };
}

/*!propGroups()!1*/
export const propertyGroups: PropertyGroup = {
    text: {
        text: {
            name: "text",
            type: "string",
            description: "The text displayed on this component",
            defaultValue: Sk.builtin.str.$empty,
            exampleValue: "Hello",
            important: true,
            pyVal: true,
            priority: 10,
            set(s, e, pyVal) {
                const v = Sk.builtin.checkNone(pyVal) ? "" : pyVal.toString();
                const prefix = getCssPrefix();
                const { text } = s._anvil.elements;
                e.classList.toggle(prefix + "has-text", !!v);
                text.textContent = v;
            },
        },
        align: {
            name: "align",
            type: "enum",
            options: ["left", "center", "right"],
            description: "Align this component's text",
            defaultValue: new Sk.builtin.str("left"),
            designerHint: "align-horizontal",
            pyVal: true,
            set(s, e, pyVal) {
                const v = pyVal.toString();
                const prefix = getCssPrefix();
                e.classList.remove(prefix + "align-left", prefix + "align-center", prefix + "align-right");
                e.style.textAlign = v;
                if (["left", "center", "right"].includes(v)) {
                    e.classList.add(prefix + "align-" + v);
                }
            },
        },
        font_size: {
            name: "font_size",
            type: "number",
            description: "The height of text displayed on this component in pixels",
            defaultValue: Sk.builtin.none.none$,
            pyVal: true,
            exampleValue: 16,
            set(s, e, pyVal) {
                const v = toJs(pyVal);
                e.style.fontSize = typeof v === "number" ? `${v}px` : "";
            },
            getUnset(s, e, currentValue) {
                const jsVal = toJs(currentValue);
                if (jsVal === null || jsVal === undefined || jsVal === "") {
                    return getUnsetValue(e, "fontSize");
                }
            },
        },
        font: {
            name: "font",
            type: "string",
            description: "The font to use for this component.",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            exampleValue: "Arial",
            set(s, e, v) {
                e.style.fontFamily = v.toString();
            },
        },
        bold: {
            name: "bold",
            type: "boolean",
            description: "Display this component's text in bold",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            exampleValue: true,
            designerHint: "font-bold",
            set(s, e, v) {
                e.style.fontWeight = isTrue(v) ? "bold" : "";
            },
        },
        italic: {
            name: "italic",
            type: "boolean",
            description: "Display this component's text in italics",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            exampleValue: true,
            designerHint: "font-italic",
            set(s, e, v) {
                e.style.fontStyle = isTrue(v) ? "italic" : "";
            },
        },
        underline: {
            name: "underline",
            type: "boolean",
            description: "Display this component's text underlined",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            exampleValue: true,
            designerHint: "font-underline",
            set(s, e, v) {
                const textDecoration = isTrue(v) ? "underline" : "";
                e.style.textDecoration = textDecoration;
                const children = e.querySelectorAll("span, div");
                children.forEach((child) => {
                    (child as HTMLElement).style.textDecoration = textDecoration;
                });
            },
        },
    },

    icon: {
        icon: {
            name: "icon",
            type: "icon",

            iconsets: ["font-awesome-4.7.0"],

            defaultValue: Sk.builtin.str.$empty,
            exampleValue: "fa:user",
            description: "The icon to display on this component. Either a URL, or a FontAwesome Icon, e.g. 'fa:user'.",
            pyVal: true,
            important: true,
            set(s, e, pyVal) {
                e.classList.remove("anvil-component-icon-present");
                const elements = s._anvil.elements;
                let addIcon = (i: HTMLElement) => {};
                if (checkString(pyVal)) {
                    const v = pyVal.toString();
                    if (v) {
                        const faclass = v.split(":");
                        if (faclass.length === 2 && faclass[0].startsWith("fa")) {
                            addIcon = (i: HTMLElement) => {
                                i.classList.add(faclass[0]); // IE doesn't support classList.add(...args)
                                i.classList.add("fa-" + faclass[1]);
                            };
                        } else {
                            addIcon = (i: HTMLElement) => {
                                const img = document.createElement("img");
                                img.src = v;
                                img.style.cssText = "height: 1em; vertical-align: text-bottom;";
                                i.appendChild(img);
                            };
                        }
                        e.classList.add("anvil-component-icon-present");
                    }
                } else {
                    // console.log(v);
                }

                const iconKeys = Object.keys(elements).filter((key: string) => key.startsWith("icon"));

                iconKeys.forEach((key) => {
                    const i = elements[key];
                    i.className = i.className
                        .split(" ")
                        .filter((x: string) => !x.startsWith("fa"))
                        .join(" ");
                    while (i.firstChild) {
                        i.removeChild(i.firstChild); // equiv of i.empty;
                    }
                    addIcon(i);
                });
            },
        },
        icon_align: {
            name: "icon_align",
            description:
                "The alignment of the icon on this component. Set to 'top' for a centred icon on a component with no text.",
            type: "enum",
            defaultValue: new Sk.builtin.str("left"),
            pyVal: true,
            options: ["left_edge", "left", "top", "right", "right_edge"],
            set(s, e, v) {
                const prefix = getCssPrefix();
                const remove = ["right_edge", "left_edge", "top", "right", "left"].map((x) => prefix + x + "-icon");

                e.classList.remove(...remove);
                const iconElements = Array.from(e.querySelectorAll<HTMLElement>(".anvil-component-icon")).filter(
                    function (iconEl) {
                        let parentComponent = iconEl.closest(".anvil-component");
                        return parentComponent === null || parentComponent === e;
                    }
                );
                iconElements.forEach((iconEl) => {
                    iconEl.classList.remove(...remove);
                });

                e.classList.add(prefix + v + "-icon");
                iconElements.forEach((iconEl) => {
                    iconEl.classList.add(prefix + v + "-icon");
                });
            },
        },
    },

    align: {
        align: {
            name: "align",
            type: "enum",
            options: ["left", "center", "right"],
            description: "Align this component's content",
            defaultValue: new Sk.builtin.str("center"),
            set(s, e, v) {
                e.style.textAlign = v.toString();
            },
            important: true,
        },
    },

    appearance: {
        background: {
            name: "background",
            type: "color",
            description: "The background colour of this component.",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            exampleValue: "#ff0000",
            designerHint: "background-color",
            set(s, e, v) {
                e.style.backgroundColor = getColor(v);
            },
        },
        foreground: {
            name: "foreground",
            type: "color",
            description: "The foreground colour of this component.",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            exampleValue: "#ff0000",
            designerHint: "foreground-color",
            set(s, e, v) {
                e.style.color = getColor(v);
            },
        },
        border: {
            name: "border",
            type: "string",
            description: "The border of this component. Can take any valid CSS border value.",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            exampleValue: "1px solid #888888",
            designerHint: "border",
            set(s, e, v) {
                e.style.border = isTrue(v) ? v.toString() : "";
            },
        },
        visible: {
            name: "visible",
            important: true,
            type: "boolean",
            description: "Should this component be displayed?",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            exampleValue: false,
            designerHint: "visible",
            set(s, e, v) {
                // Don't just set "display" property - this needs to behave differently in
                // designer and runner.
                const visible = isTrue(v);
                e.classList.toggle(getCssPrefix() + "visible-false", !visible);
                return notifyVisibilityChange(s, visible);
            },
        },
        role: {
            name: "role",
            important: false,
            type: "themeRole",
            description: "Choose how this component can appear, based on your app's visual theme.",
            defaultValue: Sk.builtin.none.none$,
            pyVal: true,
            exampleValue: "title",
            set(s, e, v) {
                applyRole(v, e);
            },
        },
    },

    visibility: {
        visible: {
            name: "visible",
            important: true,
            type: "boolean",
            description: "Should this component be displayed?",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            exampleValue: false,
            designerHint: "visible",
            set(s, e, v) {
                // Don't just set "display" property - this needs to behave differently in
                // designer and runner.
                const visible = isTrue(v);
                e.classList.toggle(getCssPrefix() + "visible-false", !visible);
                return notifyVisibilityChange(s, visible);
            },
        },
    },

    interaction: {
        enabled: {
            name: "enabled",
            important: true,
            type: "boolean",
            description: "True if this component should allow user interaction.",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            exampleValue: false,
            designerHint: "enabled",
            set(s, e, v) {
                const prefix = getCssPrefix();
                const toDisable = e.querySelector(`.${prefix}to-disable`);
                if (!isTrue(v)) {
                    e.setAttribute("disabled", "");
                    if (toDisable !== null) {
                        toDisable.setAttribute("disabled", "");
                    }
                } else {
                    e.removeAttribute("disabled");
                    if (toDisable !== null) {
                        toDisable.removeAttribute("disabled");
                    }
                }
            },
        },
    },

    height: {
        height: {
            name: "height",
            type: "string",
            defaultValue: Sk.builtin.str.$empty,
            exampleValue: new Sk.builtin.str("100"),
            description: "The height of this component.",
            pyVal: true,
            set(s, e, v) {
                e.style.height = cssLength(v.toString());
            },
        },
    },

    layout: {
        width: {
            name: "width",
            type: "string",
            defaultValue: new Sk.builtin.str("default"),
            pyVal: true,
            description: 'The width of this {{component}}, or "default" to have the width set by the container.',
            deprecated: true,
            set(s, e, v) {
                e.style.width = cssLength(v.toString());
            },
        },

        spacing_above: {
            name: "spacing_above",
            type: "enum",
            options: ["none", "small", "medium", "large"],
            defaultValue: new Sk.builtin.str("small"),
            pyVal: true,
            deprecateFromRuntimeV3: true, // Once you have margins, this is no longer needed. But we can't remove it entirely, because people might have used it. Hide from designer, allow override via margin property.
            description: "The vertical space above this component.",
            set(s, e, pyVal) {
                const v = pyVal.toString();
                var vals = ["none", "small", "medium", "large"];
                for (var i = 0; i < vals.length; i++) {
                    var cls = "anvil-spacing-above-" + vals[i];
                    if (v === vals[i]) {
                        e.classList.add(cls);
                    } else {
                        e.classList.remove(cls);
                    }
                }
            },
        },
        spacing_below: {
            name: "spacing_below",
            type: "enum",
            options: ["none", "small", "medium", "large"],
            defaultValue: new Sk.builtin.str("small"),
            pyVal: true,
            deprecateFromRuntimeV3: true, // Once you have margins, this is no longer needed. But we can't remove it entirely, because people might have used it. Hide from designer, allow override via margin property.
            description: "The vertical space below this component.",
            set(s, e, pyVal) {
                const v = pyVal.toString();
                var vals = ["none", "small", "medium", "large"];
                for (var i = 0; i < vals.length; i++) {
                    var cls = "anvil-spacing-below-" + vals[i];
                    if (v === vals[i]) {
                        e.classList.add(cls);
                    } else {
                        e.classList.remove(cls);
                    }
                }
            },
        },
    },

    layout_spacing: {
        spacing: {
            group: "layout", // Override group for this property
            name: "spacing",
            type: "spacing",
            description:
                "Margin and padding for this container. Only available in apps that have been migrated to use Layouts.",
            defaultValue: Sk.builtin.none.none$,
            important: true,
            priority: 0,
            set(s, e, v) {
                setElementSpacing(e, v);
            },
            getUnset(s, e, currentValue) {
                return getUnsetSpacing(e, e, currentValue);
            },
        },
    },

    layout_margin: {
        margin: {
            group: "layout", // Override group for this property
            name: "margin",
            type: "margin",
            description: "Margin for this component. Only available in apps that have been migrated to use Layouts.",
            defaultValue: Sk.builtin.none.none$,
            important: true,
            priority: 0,
            set(s, e, v) {
                setElementMargin(e, v);
            },
            getUnset(s, e, v) {
                return getUnsetMargin(e, v);
            },
        },
    },

    layout_padding: {
        padding: {
            group: "layout", // Override group for this property
            name: "padding",
            type: "padding",
            description: "Padding for this component. Only available in apps that have been migrated to use Layouts.",
            defaultValue: Sk.builtin.none.none$,
            important: true,
            priority: 0,
            set(s, e, v) {
                setElementPadding(e, v);
            },
            getUnset(s, e, v) {
                return getUnsetPadding(e, v as PaddingPropertyValue);
            },
        },
    },

    containers: {
        row_spacing: {
            name: "row_spacing",
            deprecated: true,
            important: true,
            priority: 9,
            type: "number",
            description: "The spacing between rows of components in this container, in pixels.",
            defaultValue: new Sk.builtin.int_(10),
            pyVal: true,
        },
    },

    "user data": {
        tag: {
            name: "tag",
            defaultValue: null,
            important: false,
            type: "object",
            description: "Use this property to store any extra information about this component",
        },
    },

    tooltip: {
        tooltip: {
            name: "tooltip",
            important: false,
            type: "string",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            description: "Text to display when you hover the mouse over this component",
            set(s, e, v) {
                if (isTrue(v)) {
                    e.setAttribute("title", v.toString());
                } else {
                    e.removeAttribute("title");
                }
            },
        },
    },

    mapOverlays: {
        clickable: {
            name: "clickable",
            important: true,
            type: "boolean",
            description: "True if this overlay raises mouse events.",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            mapProp: true,
            set: mapSetter("clickable", isTrue),
            get: mapGetter("getClickable", Sk.builtin.bool),
        },
        draggable: {
            name: "draggable",
            type: "boolean",
            important: true,
            description: "True if this overlay can be dragged.",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            mapProp: true,
            set: mapSetter("draggable", isTrue),
            get: mapGetter("getDraggable", Sk.builtin.bool),
        },
        visible: {
            name: "visible",
            type: "boolean",
            important: true,
            description: "True if this overlay should be displayed.",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            mapProp: true,
            // NB: we don't need to worry about notifying parent of visibility
            // a map overlay can only be a child of a Google Map and it doesn't care
            set: mapSetter("visible", isTrue),
            get: mapGetter("getVisible", Sk.builtin.bool),
        },
        z_index: {
            name: "z_index",
            type: "number",
            important: true,
            description: "The z-index compared to other overlays.",
            mapProp: true,
            set: mapSetter("zIndex"),
            get: mapGetter("getZIndex"),
        },
    },

    mapPolyOverlays: {
        editable: {
            name: "editable",
            type: "boolean",
            important: true,
            description: "True if this overlay can be edited by the user.",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            mapProp: true,
            set: mapSetter("editable", isTrue),
        },
        stroke_color: {
            name: "stroke_color",
            type: "string",
            important: true,
            description: "The color to draw the overlay outline.",
            mapProp: true,
            set: mapSetter("strokeColor"),
        },
        stroke_opacity: {
            name: "stroke_opacity",
            type: "number",
            important: true,
            description: "The opacity of the overlay outline.",
            mapProp: true,
            set: mapSetter("strokeOpacity"),
        },
        stroke_weight: {
            name: "stroke_weight",
            type: "number",
            important: true,
            description: "The weight of the overlay outline",
            mapProp: true,
            set: mapSetter("strokeWeight"),
        },
    },

    mapAreaOverlays: {
        // @ts-expect-error - pyType is not a valid type for this property
        stroke_position: {
            name: "stroke_position",
            pyType: "anvil.GoogleMap.StrokePosition",
            important: true,
            description: "The stroke position. Defaults to CENTER.",
            mapProp: true,
            set: mapSetter("strokePosition"),
        },
        fill_color: {
            name: "fill_color",
            type: "string",
            important: true,
            description: "The color to draw the overlay outline.",
            mapProp: true,
            set: mapSetter("fillColor"),
        },
        fill_opacity: {
            name: "fill_opacity",
            type: "number",
            important: true,
            description: "The opacity of the overlay outline.",
            mapProp: true,
            set: mapSetter("fillOpacity"),
        },
    },
};
