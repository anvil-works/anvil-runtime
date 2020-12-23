"use strict";

var PyDefUtils = require("PyDefUtils");

/**
id: label
docs_url: /docs/client/components/basic#label
title: Label
tooltip: Learn more about Label
description: |
  ```python
  c = Label(text="This is my label")
  ```

  Labels are useful for displaying text on a form. The user cannot edit text in a label.
*/

module.exports = function(pyModule) {

	pyModule["Label"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(Label)!2*/["layout", "text", "appearance", "icon", "tooltip", "user data"], {
            text: {
                pyVal: true,
                defaultValue: new Sk.builtin.str(""),
                set: function(s,e,v) {
                    v = new Sk.builtin.str(v).v;
                    e.toggleClass("has-text", v ? true : false);
                    e.find("span").text(v);
                },
                multiline: true,
                suggested: true,
            },
        });

		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div><i class="anvil-component-icon fa left"></i><span class="label-text"></span><i class="anvil-component-icon fa right"></i>').addClass("anvil-label anvil-inlinable");
            self._anvil.dataBindingProp = "text";
        }, pyModule, $loc, properties, PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/"Label", ["universal"]), pyModule["Component"]);

    }, /*!defClass(anvil,Label,Component)!*/ 'Label', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, text, appearance
 *  - Override set: text
 *  - Event groups: universal
 *
 */
