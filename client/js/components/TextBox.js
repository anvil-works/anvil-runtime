"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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

module.exports = function(pyModule) {

	pyModule["TextBox"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(TextBox)!2*/["layout", "text", "interaction", "appearance", "tooltip", "user data"], {
          text: {
            get: function get(self,e) {
                if (self._anvil.inputType == 'number') {
                    let r = Number.parseFloat(e.val());
                    return isNaN(r) ? null : r;
                } else {
                    return e.val();
                }
            },
            set: function set(s,e,v) { 
                e.val(v); 
                s._anvil.lastChangeVal = v;
            },
            allowBindingWriteback: true,
            suggested: true,
          },
        });

        /*!componentProp(TextBox)!1*/
        properties.push({
            name: "placeholder",
            type: "string",
            description: "The text to be displayed when the component is empty.",
            defaultValue: "",
            exampleValue: "Enter text here",
            set: function(self,e,v) {
              e.attr("placeholder", v);
            },
        });

        /*!componentProp(TextBox)!1*/
        properties.push({
            name: "hide_text",
            type: "boolean",
            description: "Display stars instead of the text in this box",
            defaultValue: false,
            set: function(self,e,v) {
                self._anvil.hiddenInput = !!v;
                self._anvil.updateType();
            },
        });

        /*!componentProp(TextBox)!1*/
        properties.push({
            name: "type",
            type: "string",
            enum: ["text", "number", "email", "tel", "url"],
            description: "What type of data will be entered into this box?",
            defaultValue: "text",
            exampleValue: "number",
            set: function(self,e,v) {
                if (v != 'number' && v != 'tel' && v != 'url' && v != 'email') {
                    v = "text";
                }
                self._anvil.inputType = v;
                self._anvil.updateType();
            }
        });

        var events = PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "TextBox", ["universal", "focus"]);

        /*!componentEvent(TextBox)!1*/
        events.push({name: "change", description: "When the text in this text box is edited",
                     parameters: [], important: true});
        /*!componentEvent(TextBox)!1*/
        events.push({name: "pressed_enter", description: "When the user presses Enter in this text box",
                     parameters: [], important: true, defaultEvent: true });

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<input type="text" class="form-control to-disable anvil-text-box"/>')
                .on("propertychange change keyup paste input", function(e) {
                    if (e.type != "change") // Happens just before we tab away
                        this.focus();
                    var lc = self._anvil.element.val();
                    if (lc != self._anvil.lastChangeVal) {
                        self._anvil.lastChangeVal = self._anvil.element.val();
                        PyDefUtils.raiseEventAsync({}, self, "change");
                    }
                }).on("keydown", function(e) {
                    if (e.which == 13) {
                        self._anvil.dataBindingWriteback(self, "text").finally(function() {
                            return PyDefUtils.raiseEventAsync({}, self, "pressed_enter");
                        });
                        e.stopPropagation();
                        e.preventDefault();
                    }
                }).on("focus", function(e) {
                    PyDefUtils.raiseEventAsync({}, self, "focus");
                }).on("blur", function(e) {
                    setTimeout(
                        () => self._anvil.dataBindingWriteback(self, "text").finally(
                            () => PyDefUtils.raiseEventAsync({}, self, "lost_focus")));
                });

            self._anvil.inputType = 'text';
            self._anvil.hiddenInput = false;
            self._anvil.updateType = function() {
                self._anvil.element.attr("type", self._anvil.hiddenInput ? "password" : self._anvil.inputType);
            }
            self._anvil.dataBindingProp = "text";
        }, pyModule, $loc, properties, events, pyModule["Component"]);


        /*!defMethod(_)!2*/ "Set the keyboard focus to this TextBox"
        $loc["focus"] = new Sk.builtin.func(function(self) {
            self._anvil.element.trigger("focus");
        });

        /*!defMethod(_)!2*/ "Select the text in this TextBox"
        $loc["select"] = new Sk.builtin.func(function(self, pySelectionStart, pySelectionEnd, pyDirection) {
            if (pySelectionStart && pySelectionEnd) {
                let selectionStart = Sk.ffi.remapToJs(pySelectionStart);
                let selectionEnd = Sk.ffi.remapToJs(pySelectionEnd);
                let direction = pyDirection ? Sk.ffi.remapToJs(pyDirection) : undefined;
                self._anvil.element[0].setSelectionRange(selectionStart, selectionEnd, direction);
            } else {
                self._anvil.element.trigger("select");
            }
        });

    }, /*!defClass(anvil,TextBox,Component)!*/ 'TextBox', [pyModule["Component"]]);
};

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
