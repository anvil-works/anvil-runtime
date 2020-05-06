"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = function(pyModule) {

/**
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
	pyModule["Button"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(Button)!2*/
            ["layout", "interaction", "text", "appearance", "icon", "user data", "tooltip"],
            {
                align: {
                    defaultValue: "center",
                    enum: ["left", "center", "right", "full"],
                    set: function(s,e,v) {
                        if (v == "full") {
                            e.find("button").css("width", "100%");
                        } else {
                            e.find("button").css("width", "");
                            e.css("text-align", v);
                        }
                    },
                    description: "The position of this button in the available space.",
                    important: true
                },
                text: {
                    set: function(s,e,v) {
                        e.find("button>span").text(v);
                        e.toggleClass("has-text", v ? true : false);
                    },
                    multiline: true,
                    suggested: true,
                },
                font_size: {
                    set: function(s,e,v) { e.find("button").css("font-size", v ? (""+(+v)+"px") : ""); }
                },
                font: {
                    set: function(s,e,v) { e.find("button").css("font-family", v); }
                },
                bold: {
                    set: function(s,e,v) { e.find("button").css("font-weight", v ? "bold" : ""); }
                },
                italic: {
                    set: function(s,e,v) { e.find("button").css("font-style", v ? "italic" : ""); }
                },
                underline: {
                    set: function(s,e,v) { e.find("button").css("text-decoration", v ? "underline" : ""); }
                },
                background: {
                    set: function(s,e,v) {
                        let m = (""+v).match(/^theme:(.*)$/);
                        if (m) {
                            v = s._anvil.themeColors[m[1]] || '';
                        }
                        e.find("button").css("background-color", v);
                    }
                },
                foreground: {
                    set: function(s,e,v) {
                        let m = (""+v).match(/^theme:(.*)$/);
                        if (m) {
                            v = s._anvil.themeColors[m[1]] || '';
                        }
                        e.find("button").css("color", v);
                    }
                }
            }
        );

        /*! componentProp(Button)!1*/ // This is deliberately broken to prevent the "justify" property from being documented.
        /*properties.push({name: "justify", type: "string", enum: ["left", "center", "right", "full"],
             description: "The position of the radio button",
             set: function(s,e,v) {

                 e.find("input").prop("checked", v);
             },
             get: function(s,e) { return e.find("input").prop("checked"); }});
        */

        var events = PyDefUtils.assembleGroupEvents("Button", /*!componentEvents(Button)!1*/ ["universal"]);

        events.push(/*!componentEvent(Button)!1*/
            {name: "click", description: "When the button is clicked",
             parameters: [], important: true, defaultEvent: true}
        );

		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            // The ontouchstart="" is there to make :active work on iOS safari. Sigh.
            self._anvil.element = $('<div class="anvil-inlinable anvil-button"><button ontouchstart="" class="btn btn-default to-disable" style="max-width:100%; text-overflow:ellipsis; overflow:hidden;"><i class="anvil-component-icon fa left"></i><span class="button-text">Button</span><i class="anvil-component-icon fa right"></i></button></div>');
            self._anvil.dataBindingProp = "text";

            self._anvil.element.find('button').on("click", PyDefUtils.funcWithPopupOK(function(e) {
                if (self._anvil.getPropJS('enabled')) { // Search me why this is needed, but it is.
                  PyDefUtils.raiseEventAsync({}, self, "click");
                }
            }));
        },
        pyModule, $loc, properties, events, pyModule["Component"]);

    }, /*!defClass(anvil,Button,Component)!*/ 'Button', [pyModule["Component"]]);
};

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
