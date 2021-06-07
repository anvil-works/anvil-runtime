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

module.exports = (pyModule) => {
    pyModule["Spacer"] = PyDefUtils.mkComponentCls(pyModule, "Spacer", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(Spacer)!1*/ ["visibility", "layout", "height", "tooltip", "user data"]),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "Spacer", ["universal"]),

        element: (props) => <PyDefUtils.OuterElement className="anvil-spacer" {...props} />,
    });
};

/*!defClass(anvil,Spacer,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height
 *  - Event groups: universal
 *
 */
