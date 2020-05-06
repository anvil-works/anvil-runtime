"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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

module.exports = function(pyModule) {

    pyModule["CheckBox"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(CheckBox)!2*/
          ["interaction", "layout", "text", "appearance", "tooltip", "user data"], {
            text: {
                set: function(s,e,v) { e.find("span").text(v); },
            },
            bold: {
                set: function(s,e,v) { e.find("label").css("font-weight", (v ? "bold" : "")); },
            },
            font_size: {
                set: function(s,e,v) { e.find("label").css("font-size", v ? (""+v+"px") : ""); },
            },
            underline: {
              set: function(s,e,v) {
                  e.find("span").css("text-decoration", v ? "underline" : "none");
              }
            },
        });

        var events = PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/"CheckBox", ["universal"]);

        events.push(/*!componentEvent(CheckBox)!1*/{name: "change", description: "When this checkbox is checked or unchecked",
                                                    parameters: [], important: true, defaultEvent: true});


        /*!componentProp(CheckBox)!1*/
        properties.push({name: "checked", type: "boolean",
             description: "The status of the checkbox",
             suggested: true,
             exampleValue: true,
             allowBindingWriteback: true,
             set: function(s,e,v) { e.find("input").prop("checked", v); },
             get: function(s,e) { return e.find("input").prop("checked"); }});

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div class="anvil-inlinable"><div class="checkbox"><label style="padding:7px 7px 7px 20px;"><input class="to-disable" type="checkbox"/><span style="display: inline-block; min-height: 1em"></span></label></div>')
                .on("change", function(e) {
                    self._anvil.dataBindingWriteback(self, "checked").finally(function() {
                      return PyDefUtils.raiseEventAsync({}, self, "change");
                    });
                });
            self._anvil.dataBindingProp = "checked";
        }, pyModule, $loc, properties, events, pyModule["Component"]);

        /*!defMethod(_)!2*/ "Set the keyboard focus to this component"
        $loc["focus"] = new Sk.builtin.func(function(self) {
            self._anvil.element.find("input").trigger("focus");
        });

    }, /*!defClass(anvil,CheckBox,Component)!*/ 'CheckBox', [pyModule["Component"]]);
};

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
