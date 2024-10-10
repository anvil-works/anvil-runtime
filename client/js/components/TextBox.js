"use strict";

const { getCssPrefix } = require("@runtime/runner/legacy-features");
var PyDefUtils = require("PyDefUtils");

/*#
id: textbox
docs_url: /docs/client/components/basic#textbox
title: TextBox
tooltip: Learn more about TextBox
description: |
  ```python
  c = TextBox(text="Some editable text")
  ```

  Text boxes allow users to edit text on your forms.

  A TextBox can only edit a single line of text. If you want to accept multiple lines of input, use a [TextArea](#textarea)

  ![Screenshot](img/screenshots/textbox.png)

  Set a TextBox to have focus by calling its `focus()` method. Select all its text with the `select()` method.

  The `type` property of a TextBox is a hint to the browser, which may constrain or suggest how to edit a text box (for example, only allowing digits in a `number` TextBox, or displaying a dial-pad when editing a `tel` TextBox).

  When a TextBox's `type` property is set to `"number"`, its `text` property will always return either a number or `None`.
  
  The `text` property of a TextBox can trigger write-back of data bindings. This occurs before the `lost_focus` and `pressed_enter` events.
*/

module.exports = (pyModule) => {

    const { isTrue } = Sk.misceval;


    pyModule["TextBox"] = PyDefUtils.mkComponentCls(pyModule, "TextBox", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(TextBox)!2*/ ["layout", "layout_margin", "text", "interaction", "appearance", "tooltip", "user data"], {
            text: {
                dataBindingProp: true,
                get(self, e) {
                    if (self._anvil.inputType === "number") {
                        const r = Number.parseFloat(self._anvil.elements.input.value);
                        return Sk.ffi.remapToPy(isNaN(r) ? null : r);
                    } else {
                        return new Sk.builtin.str(self._anvil.elements.input.value);
                    }
                },
                set(s, e, v) {
                    v = Sk.builtin.checkNone(v) ? "" : v.toString();
                    s._anvil.elements.input.value = v;
                    s._anvil.lastChangeVal = v;
                },
                allowBindingWriteback: true,
                suggested: true,
                inlineEditElement: 'input'
            },
            placeholder: /*!componentProp(TextBox)!1*/ {
                name: "placeholder",
                type: "string",
                description: "The text to be displayed when the component is empty.",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                exampleValue: "Enter text here",
                important: true,
                set(self, e, v) {
                    v = Sk.builtin.checkNone(v) ? "" : v.toString();
                    self._anvil.elements.input.setAttribute("placeholder", v);
                },
            },
            hide_text: /*!componentProp(TextBox)!1*/ {
                name: "hide_text",
                type: "boolean",
                description: "Display stars instead of the text in this box",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                set(self, e, v) {
                    self._anvil.hiddenInput = isTrue(v);
                    self._anvil.updateType();
                },
            },
            type: /*!componentProp(TextBox)!1*/ {
                name: "type",
                type: "enum",
                options: ["text", "number", "email", "tel", "url"],
                description: "What type of data will be entered into this box?",
                defaultValue: new Sk.builtin.str("text"),
                pyVal: true,
                exampleValue: "number",
                set(self, e, v) {
                    v = v.toString();
                    v = ["text", "number", "tel", "url", "email"].includes(v) ? v : "text";
                    self._anvil.inputType = v;
                    self._anvil.updateType();
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "TextBox", ["universal", "focus"], {
            change: /*!componentEvent(TextBox)!1*/ {
                name: "change",
                description: "When the text in this text box is edited",
                parameters: [],
                important: true,
            },
            pressed_enter: /*!componentEvent(TextBox)!1*/ {
                name: "pressed_enter",
                description: "When the user presses Enter in this text box",
                parameters: [],
                important: true,
                defaultEvent: true,
            },
        }),

        element({ hide_text, type, placeholder, text, ...props }) {
            const prefix = getCssPrefix();
            const outerClass = PyDefUtils.getOuterClass(props);
            const outerStyle = PyDefUtils.getOuterStyle(props);
            const outerAttrs = PyDefUtils.getOuterAttrs(props);
            placeholder = Sk.builtin.checkNone(placeholder) ? "" : placeholder.toString();
            type = type.toString();
            text = Sk.builtin.checkNone(text) ? "" : text.toString();
            if (isTrue(hide_text)) {
                type = "password";
            } else {
                type = ["text", "number", "tel", "url", "email"].includes(type) ? type : "text";
            }
            return (
                <input
                    refName="input"
                    type={type}
                    className={`${prefix}form-control ${prefix}to-disable anvil-text-box ${outerClass}`}
                    style={outerStyle}
                    value={text}
                    placeholder={placeholder}
                    {...outerAttrs}
                />
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                self._anvil.element
                    .on("propertychange change keyup paste input", function (e) {
                        if (e.type !== "change")
                            // Happens just before we tab away
                            this.focus();
                        const lc = self._anvil.elements.input.value;
                        if (lc !== self._anvil.lastChangeVal) {
                            self._anvil.lastChangeVal = lc;
                            PyDefUtils.raiseEventAsync({}, self, "change");
                        }
                    })
                    .on("keydown", (e) => {
                        if (e.which == 13) {
                            self._anvil.dataBindingWriteback(self, "text").finally(function () {
                                return PyDefUtils.raiseEventAsync({}, self, "pressed_enter");
                            });
                            e.stopPropagation();
                            e.preventDefault();
                        }
                    })
                    .on("focus", function (e) {
                        PyDefUtils.raiseEventAsync({}, self, "focus");
                    })
                    .on("blur", function (e) {
                        self._anvil.dataBindingWriteback(self, "text").finally(() => setTimeout(() => PyDefUtils.raiseEventAsync({}, self, "lost_focus")));
                    });

                const type = self._anvil.props["type"].toString();
                self._anvil.inputType = ["text", "number", "tel", "url", "email"].includes(type) ? type : "text";
                self._anvil.hiddenInput = isTrue(self._anvil.props["hide_text"]);
                self._anvil.updateType = () => {
                    self._anvil.elements.input.setAttribute("type", self._anvil.hiddenInput ? "password" : self._anvil.inputType);
                };
            });

            /*!defMethod(_)!2*/ "Set the keyboard focus to this TextBox"
            $loc["focus"] = new Sk.builtin.func(function focus(self) {
                // vanilla javascript doesn't dispatch this event so use jquery
                self._anvil.element.trigger("focus");
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ "Select the text in this TextBox"
            $loc["select"] = new Sk.builtin.func(function select(self, pySelectionStart, pySelectionEnd, pyDirection) {
                if (pySelectionStart && pySelectionEnd) {
                    let selectionStart = Sk.ffi.remapToJs(pySelectionStart);
                    let selectionEnd = Sk.ffi.remapToJs(pySelectionEnd);
                    let direction = pyDirection ? Sk.ffi.remapToJs(pyDirection) : undefined;
                    self._anvil.elements.input.setSelectionRange(selectionStart, selectionEnd, direction);
                } else {
                    self._anvil.element.trigger("select");
                }
                return Sk.builtin.none.none$;
            });
        },
    });

};

/*!defClass(anvil,TextBox,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, interaction, text, appearance
 *  - New props: placeholder
 *  - Override set: text
 *  - Event groups: universal
 *  - New events: change, pressed_enter
 *
 */
