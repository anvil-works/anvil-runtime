"use strict";

import { getCssPrefix, getInlineStyles } from "@runtime/runner/legacy-features";
import { setHandled } from "./events";
import { getUnsetSpacing, setElementMargin, setElementPadding } from "@runtime/runner/components-in-js/public-api/property-utils";
var PyDefUtils = require("PyDefUtils");

/*#
id: radiobutton
docs_url: /docs/client/components/basic#radiobutton
title: RadioButton
tooltip: Learn more about RadioButton
description: |
  ```python
  rb1 = RadioButton(text="Select this option")
  ```

  Radio buttons force users to select exactly one option from a list.

  Radio buttons can be divided into groups by setting the `group_name` property. The user can select one option from each group.
  (If you don't set `group_name`, then all your radio buttons will be in the default group.)

  ```python
  rb1.group_name = "mygroup"
  rb1.value = "A"

  rb2 = RadioButton(text="Or select this one", group_name="mygroup", value="B")

  # Add these radio buttons to the form
  self.add_component(rb1)
  self.add_component(rb2)

  rb1.selected = True
  print rb1.get_group_value()  # prints A

  rb2.selected = True # This will deselect the other button
  print rb2.get_group_value()  # prints B
  ```

  You can either find out each individual RadioButton's status by checking the `selected` property, or you can call
  the `get_group_value()` method to find out which button in that group is pressed. (`get_group_value()` will return
  the `value` property of the currently selected RadioButton in that group. If there are multiple RadioButtons in the
  same group with the same `value`, then you can't tell them apart this way!)

  ![Screenshot](img/screenshots/radiobuttons.png)

*/


module.exports = (pyModule) => {
    const {isTrue} = Sk.misceval;
    const inlineStyle = getInlineStyles("radio");

    pyModule["RadioButton"] = PyDefUtils.mkComponentCls(pyModule, "RadioButton", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(RadioButton)!2*/ ["text", "layout", "layout_spacing", "interaction", "appearance", "tooltip", "user data"], {
            text: {
                set(s, e, v) {
                    v = Sk.builtin.checkNone(v) ? "" : v.toString();
                    if (v) {
                        s._anvil.elements.text.textContent = v;
                    } else {
                        s._anvil.elements.text.innerHTML = "&nbsp;";
                    }
                },
                group: undefined,
                inlineEditElement: "text",
            },
            bold: {
                set(s, e, v) {
                    s._anvil.elements.text.style.fontWeight = isTrue(v) ? "bold" : "";
                },
            },
            underline: {
                set(s, e, v) {
                    s._anvil.elements.text.style.textDecoration = isTrue(v) ? "underline" : "none";
                },
            },
            selected: /*!componentProp(RadioButton)!1*/ {
                name: "selected",
                type: "boolean",
                suggested: true,
                designerHint: "toggle",
                pyVal: true,
                defaultValue: Sk.builtin.bool.false$,
                description: "The status of the radio button",
                set(s, e, v) {
                    s._anvil.elements.input.checked = isTrue(v);
                },
                get(s, e) {
                    return new Sk.builtin.bool(s._anvil.elements.input.checked);
                },
            },
            value: /*!componentProp(RadioButton)!1*/ {
                name: "value",
                type: "string",
                pyVal: true,
                defaultValue: Sk.builtin.str.$empty,
                description: "The value of the group when this radio button is selected",
                set(s, e, v) {
                    v = Sk.builtin.checkNone(v) ? null : v.toString();
                    s._anvil.elements.input.value = v;
                },
                get(s, e) {
                    // could be a str or None but nothing else
                    return Sk.ffi.toPy(s._anvil.elements.input.value);
                },
            },
            group_name: /*!componentProp(RadioButton)!1*/ {
                name: "group_name",
                type: "string",
                pyVal: true,
                defaultValue: new Sk.builtin.str("radioGroup1"),
                description: "The name of the group this radio button belongs to.",
                set(s, e, v) {
                    v = Sk.builtin.checkNone(v) ? null : v.toString();
                    s._anvil.elements.input.name = v;
                },
                get(s, e) {
                    return Sk.ffi.toPy(s._anvil.elements.input.name);
                },
            },
            spacing: {
                set(s, e, v) {
                    setElementMargin(e[0], v?.margin);
                    setElementPadding(s._anvil.elements.label, v?.padding);
                },
                getUnset(s, e, currentValue) {
                    return getUnsetSpacing(e[0], s._anvil.elements.label, currentValue);
                }
            },
        }),

        events: PyDefUtils.assembleGroupEvents("radio button", /*!componentEvents(RadioButton)!1*/ ["universal"], {
            /*!componentEvent(RadioButton)!1*/ clicked: {
                name: "clicked",
                description: "When this radio button is selected",
                parameters: [],
                important: true,
                defaultEvent: true,
            },

            change: { name: "change", description: "When this radio button is selected (but not deselected)", parameters: [], important: true, deprecated: true },
        }),

        element({ bold, underline, selected, value, group_name, ...props }) {
            const prefix = getCssPrefix();
            const style = PyDefUtils.getOuterStyle({ bold, underline });
            const inputAttrs = {};
            if (isTrue(selected)) {
                inputAttrs.checked = "";
            }
            if (!isTrue(props.enabled)) {
                inputAttrs.disabled = "";
            }
            const labelStyle = PyDefUtils.getPaddingStyle({spacing: props.spacing});
            return (
                <PyDefUtils.OuterElement refName="outer" className={prefix+"radio anvil-inlinable"} includePadding={false} {...props}>
                    <label refName="label" style={inlineStyle + labelStyle}>
                        <input
                            refName="input"
                            className={`${prefix}to-disable`}
                            type="radio"
                            name={group_name.toString()}
                            value={Sk.builtin.checkNone(value) ? "" : value.toString()}
                            {...inputAttrs}
                        />
                        <span refName="text" style={style}>
                            {Sk.builtin.checkNone(props.text) ? "" : props.text.toString()}
                        </span>
                    </label>
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                const clicked = PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "clicked");
                const change = PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "change");
                self._anvil.element.on("change", (e) => {
                    PyDefUtils.asyncToPromise(() => Sk.misceval.chain(clicked(), change));
                });
                $(self._anvil.elements.label).on("click", (e) => {
                    setHandled(e);
                });
                if (ANVIL_IN_DESIGNER) {
                    Object.defineProperty(self._anvil, "inlineEditing", {
                        set(v) {
                            // see checkbox.js
                            self._anvil.elements.input.type = v ? "hidden" : "radio";
                        }
                    });
                }
            });

            /*!defMethod(str)!2*/ "returns the value of the button in the group which is pressed."
            $loc["get_group_value"] = new Sk.builtin.func(function get_group_value(self) {
                const name = self._anvil.props["group_name"].toString();
                // @todo bug when radio buttons are not on the screen
                const v = $('input[name="' + name + '"]:checked').val();
                return v != null ? new Sk.builtin.str(v) : Sk.builtin.none.none$;
            });
        },
    });

};

/*!defClass(anvil,RadioButton,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, interaction, text, appearance
 *  - New props: selected, value, group_name
 *  - Override set: text
 *  - Event groups: universal
 *  - New events: change
 *  - Methods: get_group_value
 *
 */
