"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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


module.exports = function(pyModule) {

	pyModule["RadioButton"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(RadioButton)!2*/["text", "layout", "interaction", "appearance", "tooltip", "user data"], {
          text: {
            set: function(s,e,v) {
              if (v.length > 0) {
                e.find("span").text(v);
              } else {
                e.find("span").html("&nbsp;");
              }
            },
          },
          bold: {
            set: function(s,e,v) {
                e.find("span").css("font-weight", v ? "bold" : "");
            }
          },
          underline: {
            set: function(s,e,v) {
                e.find("span").css("text-decoration", v ? "underline" : "none");
            }
          },
        });
        /*!componentProp(RadioButton)!1*/
        properties.push({name: "selected", type: "boolean",
             suggested: true,
             description: "The status of the radio button",
             set: function(s,e,v) { e.find("input").prop("checked", v); },
             get: function(s,e) { return e.find("input").prop("checked"); }});
        /*!componentProp(RadioButton)!1*/
        properties.push({name: "value", type: "string",
             description: "The value of the group when this radio button is selected",
             set: function(s,e,v) { e.find("input").val(v); },
             get: function(s,e) { return e.find("input").val(); }});
        /*!componentProp(RadioButton)!1*/
        properties.push({name: "group_name", type: "string",
             description: "The name of the group this radio button belongs to.",
             set: function(s,e,v) { e.find("input").attr("name", v); },
             get: function(s,e) { return e.find("input").attr("name"); }});

        var events = PyDefUtils.assembleGroupEvents("radio button", /*!componentEvents(RadioButton)!1*/ ["universal"]);

        /*!componentEvent(RadioButton)!1*/
        events.push({name: "clicked", description: "When this radio button is selected",
                     parameters: [], important: true, defaultEvent: true});

        events.push({name: "change", description: "When this radio button is selected (but not deselected)",
                     parameters: [], important: true, deprecated: true});

		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div class="radio anvil-inlinable"><label style="padding: 7px 7px 7px 20px"><input class="to-disable" type="radio" name="radioGroup1" value=""/><span></span></label></div>')
                .on("change", function(e) {
                    PyDefUtils.asyncToPromise(function() {
                        return Sk.misceval.chain(undefined,
                          PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "clicked"),
                          PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "change")
                        );
                    })
                });

        }, pyModule, $loc, properties, events, pyModule["Component"]);

        $loc["get_group_value"] = new Sk.builtin.func(function(self) {
            var v = $("input[name=\"" + self._anvil.element.find("input").attr("name") + "\"]:checked").val();
            return v != null ? Sk.ffi.remapToPy(v) : Sk.builtin.none.none$;
        })

    }, /*!defClass(anvil,RadioButton,Component)!*/ 'RadioButton', [pyModule["Component"]]);
};

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
