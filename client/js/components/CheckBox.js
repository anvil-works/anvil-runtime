"use strict";

var PyDefUtils = require("PyDefUtils");
import { getCssPrefix, getInlineStyles } from "@runtime/runner/legacy-features";
import { setHandled } from "./events";

/*#
id: checkbox
docs_url: /docs/client/components/basic#checkbox
title: CheckBox
tooltip: Learn more about CheckBox
description: |
  ```python
  c = CheckBox(text="Option 1")
  ```

  A checkbox allows a boolean choice - on or off.

  ![Screenshot](img/screenshots/checkboxes.png)

prop_groups: [interaction, size, text, appearance]
extra_props: [checked]
*/

module.exports = (pyModule) => {
    const { isTrue } = Sk.misceval;
    const inlineStyle = getInlineStyles("checkbox");

    pyModule["CheckBox"] = PyDefUtils.mkComponentCls(pyModule, "CheckBox", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(CheckBox)!2*/ ["interaction", "layout", "text", "appearance", "tooltip", "user data"], {
            bold: {
                set(s, e, v) {
                    v = isTrue(v);
                    s._anvil.elements.label.style.fontWeight = v ? "bold" : "";
                },
            },
            font_size: {
                set(s, e, v) {
                    v = Sk.ffi.remapToJs(v);
                    s._anvil.elements.label.style.fontSize = typeof v === "number" ? v + "px" : "";
                },
            },
            underline: {
                set(s, e, v) {
                    v = isTrue(v);
                    s._anvil.elements.text.style.textDecoration = v ? "underline" : "none";
                },
            },
            /*!componentProp(CheckBox)!1*/
            checked: {
                name: "checked",
                type: "boolean",
                description: "The status of the checkbox",
                suggested: true,
                pyVal: true,
				important: true,
				priority: 10,
                exampleValue: true,
                defaultValue: Sk.builtin.bool.false$,
                allowBindingWriteback: true,
                dataBindingProp: true,
                set(s, e, v) {
                    if (isTrue(s._anvil.props.allow_indeterminate)) {
                        s._anvil.elements.input.indeterminate = v === Sk.builtin.none.none$;
                    }
                    s._anvil.elements.input.checked = isTrue(v);
                },
                get(s, e) {
                    if (isTrue(s._anvil.props.allow_indeterminate) && s._anvil.elements.input.indeterminate) {
                        return Sk.builtin.none.none$;
                    } else {
                        return new Sk.builtin.bool(s._anvil.elements.input.checked);
                    }                    
                },
            },
            /*!componentProp(CheckBox)!1*/
            allow_indeterminate: {
                name: "allow_indeterminate",
                type: "boolean",
                description: "Support an indeterminate state. The indeterminate state can only be set in code by setting checked=None.",
                pyVal: true,
                defaultValue: Sk.builtin.bool.false$,
                initialize: true, // we can't set this in the render method because browsers don't support this as an html attribute
                set(s, e, v) {
                    if (isTrue(v)) {
                        // access the raw checked prop to see what the user set it to
                        s._anvil.elements.input.indeterminate = s._anvil.props.checked === Sk.builtin.none.none$;
                    } else {
                        s._anvil.elements.input.indeterminate = false;
                    }
                },
            },

        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "CheckBox", ["universal"], {
            change: /*!componentEvent(CheckBox)!1*/ {
                name: "change",
                description: "When this checkbox is checked or unchecked",
                parameters: [],
                important: true,
                defaultEvent: true,
            },
        }),

        element({ underline, bold, font_size, checked, ...props }) {
            const prefix = getCssPrefix();
            let textStyle = "";
            let labelStyle = "";
            if (isTrue(underline)) {
                textStyle += " text-decoration: underline;";
            }
            if (isTrue(bold)) {
                labelStyle += " font-weight: bold;";
            }
            if (isTrue(font_size)) {
                labelStyle += " font-size: " + font_size.toString() + "px;";
            }
            const inputAttrs = {};
            if (isTrue(checked)) {
                inputAttrs.checked = "";
            }
            if (!isTrue(props.enabled)) {
                inputAttrs.disabled = "";
            }
            return (
                <PyDefUtils.OuterElement className="anvil-inlinable" {...props}>
                    <div refName="checkbox" className={prefix + "checkbox"}>
                        <label refName="label" style={inlineStyle + labelStyle}>
                            <input refName="input" className="to-disable" type="checkbox" {...inputAttrs} />
                            <span refName="text" style={"display: inline-block; min-height: 1em;" + textStyle}>
                                {Sk.builtin.checkNone(props.text) ? "" : props.text.toString()}
                            </span>
                        </label>
                    </div>
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                self._anvil.element.on("change", (e) => {
                    self._anvil
                        .dataBindingWriteback(self, "checked")
                        .finally(() => PyDefUtils.raiseEventAsync({}, self, "change"));
                });
                $(self._anvil.elements.label).on("click", (e) => {
                    setHandled(e);
                });
            });

            /*!defMethod(_)!2*/ ("Set the keyboard focus to this component");
            $loc["focus"] = new Sk.builtin.func(function focus(self) {
                self._anvil.elements.input.focus(); // since we don't have a focus event we can use vanilla js as we don't need to handle this event;
                return Sk.builtin.none.none$;
            });
        },
    });
};
/*!defClass(anvil,CheckBox,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, interaction, text, appearance
 *  - New props: checked
 *  - Override set: text
 *  - Event groups: universal
 *  - New events: change
 *
 */
