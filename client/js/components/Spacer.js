"use strict";

var PyDefUtils = require("PyDefUtils");

/**
id: spacer
docs_url: /docs/client/components/basic#spacer
title: Spacer
tooltip: Learn more about Spacers
description: |
  ```python
  c = Spacer(height=50)
  ```

  Spacers add empty space to a form. Use them to fill a column with blank space,
  or to make vertical space on your form.
*/

module.exports = function(pyModule) {

    pyModule["Spacer"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(Spacer)!1*/["visibility", "layout", "height", "tooltip", "user data"]);

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div/>').addClass("anvil-spacer");
        }, pyModule, $loc, properties, PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/"Spacer", ["universal"]), pyModule["Component"]);

    }, /*!defClass(anvil,Spacer,Component)!*/ 'Spacer', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height
 *  - Event groups: universal
 *
 */
