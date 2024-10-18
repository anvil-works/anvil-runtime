"use strict";

import { getCssPrefix } from "@runtime/runner/legacy-features";
import { setHandled } from "./events";
import { getUnsetSpacing, setElementMargin, setElementPadding } from "@runtime/runner/components-in-js/public-api/property-utils";
var PyDefUtils = require("PyDefUtils");

/*#
id: button
docs_url: /docs/client/components/basic#button
module: Anvil Components
kind: class
title: Button
tooltip: Learn more about Buttons
description: |
  ```python
  # Create a button

  b = Button(text="This is a button")
  ```

  This is an Anvil button. Drag and drop onto your form, or create one in code with the `Button` constructor:

  ![Screenshot](img/screenshots/buttons.png)

*/


module.exports = (pyModule) => {

    const {isTrue} = Sk.misceval;

    pyModule["Button"] = PyDefUtils.mkComponentCls(pyModule, "Button", {
        properties: PyDefUtils.assembleGroupProperties(
            /*!componentProps(Button)!2*/ ["layout", "layout_spacing", "interaction", "text", "appearance", "icon", "user data", "tooltip"],
            {
                align: {
                    defaultValue: new Sk.builtin.str("center"),
                    options: ["left", "center", "right", "full"],
                    set(s, e, v) {
                        v = v.toString();
                        if (v === "full") {
                            s._anvil.elements.button.style.width = "100%";
                        } else {
                            s._anvil.elements.button.style.width = "";
                            s._anvil.elements.outer.style.textAlign = v;
                        }
                        s._anvil.domNode.classList.toggle("anvil-inlinable", v !== "full");
                    },
                    description: "The position of this button in the available space.",
                    important: true,
                },
                text: {
                    dataBindingProp: true,
                    multiline: true,
                    suggested: true,
                    inlineEditElement: 'text',
                    group: undefined,
                },
                font_size: {
                    set(s, e, v) {
                        v = Sk.ffi.remapToJs(v);
                        s._anvil.elements.button.style.fontSize = typeof v === "number" ? v + "px" : "";
                    },
                },
                font: {
                    set(s, e, v) {
                        v = v.toString();
                        s._anvil.elements.button.style.fontFamily = v;
                    },
                },
                bold: {
                    set(s, e, v) {
                        v = isTrue(v);
                        s._anvil.elements.button.style.fontWeight = v ? "bold" : "";
                    },
                },
                italic: {
                    set(s, e, v) {
                        v = Sk.misceval.isTrue(v);
                        s._anvil.elements.button.style.fontStyle = v ? "italic" : "";
                    },
                },
                underline: {
                    set(s, e, v) {
                        v = Sk.misceval.isTrue(v);
                        s._anvil.elements.button.style.textDecoration = v ? "underline" : "";
                    },
                },
                background: {
                    set(s, e, v) {
                        s._anvil.elements.button.style.backgroundColor = PyDefUtils.getColor(v);
                    },
                },
                foreground: {
                    set(s, e, v) {
                        s._anvil.elements.button.style.color = PyDefUtils.getColor(v);
                    },
                },
                spacing: {
                    set(s, e, v) {
                        setElementMargin(e[0], v?.margin);
                        setElementPadding(s._anvil.elements.button, v?.padding);
                    },
                    getUnset(s, e, currentValue) {
                        return getUnsetSpacing(e[0], s._anvil.elements.button, currentValue);
                    }
                },
            }
        ),

        events: PyDefUtils.assembleGroupEvents("Button", /*!componentEvents(Button)!1*/ ["universal"], {
            /*!componentEvent(Button)!1*/
            click: {
                name: "click",
                description: "When the button is clicked",
                parameters: [
                    {
                        name: "keys",
                        description:
                            "A dictionary of keys including 'shift', 'alt', 'ctrl', 'meta'. " +
                            "Each key's value is a boolean indicating if it was pressed during the click event. " +
                            "The meta key on a mac is the Command key",
                        important: false,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
        }),

        element({ font, font_size, bold, italic, underline, background, foreground, spacing,...props }) {
            const align = props.align.toString();
            const alignStyle = align === "full" ? " width: 100%;" : "";
            const outerSpacingStyle = PyDefUtils.getOuterStyle({spacing}, false);
            const buttonPaddingStyle = PyDefUtils.getPaddingStyle({spacing});
            const buttonStyle = PyDefUtils.getOuterStyle({ font, font_size, bold, italic, underline, background, foreground });
            const buttonAttrs = !isTrue(props.enabled) ? {disabled: ""} : {};
            const inlinable = align !== "full" ? "anvil-inlinable " : "";
            const prefix = getCssPrefix();
            return (
                <PyDefUtils.OuterElement className= {inlinable + "anvil-button"} style={outerSpacingStyle} {...props}>
                    <button
                        refName="button"
                        ontouchstart=""
                        className={`${prefix}btn ${prefix}btn-default ${prefix}to-disable`}
                        style={"max-width:100%; text-overflow:ellipsis; overflow:hidden; " + buttonStyle + alignStyle + buttonPaddingStyle}
                        {...buttonAttrs}>
                        <PyDefUtils.IconComponent side="left" {...props} />
                        <span refName="text" className={`${prefix}button-text`}>
                            {Sk.builtin.checkNone(props.text) ? "" : props.text.toString()}
                        </span>
                        <PyDefUtils.IconComponent side="right" {...props} />
                    </button>
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                $(self._anvil.elements.button).on("click", (e) => {
                    setHandled(e);
                    // Search me why this is needed, but it is.
                    if (!isTrue(self._anvil.props["enabled"])) return;

                    PyDefUtils.raiseEventAsync(
                        { keys: { meta: e.metaKey, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey } },
                        self,
                        "click"
                    );
                });
            });
        },
    });

};
 /*!defClass(anvil,Button,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, interaction, text, appearance
 *  - New props: align
 *  - Override set: text, background, foreground
 *  - Event groups: universal
 *  - New events: click
 *
 */
