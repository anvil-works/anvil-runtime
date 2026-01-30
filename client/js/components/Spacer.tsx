import PyDefUtils from "PyDefUtils";
import { PyModMap } from "@runtime/runner/py-util";

/*#
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

const SpacerFactory = (pyModule: PyModMap) => {
    pyModule["Spacer"] = PyDefUtils.mkComponentCls(pyModule, "Spacer", {
        properties: PyDefUtils.assembleGroupProperties(
            /*!componentProps(Spacer)!1*/ ["visibility", "layout", "height", "tooltip", "user data"],
            {
                height: {
                    defaultValue: new Sk.builtin.str("32"),
                },
            }
        ),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "Spacer", ["universal"]),

        element: (props) => <PyDefUtils.OuterElement className="anvil-spacer" {...props} />,
    });
};

export default SpacerFactory;

/*!defClass(anvil,Spacer,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height
 *  - Event groups: universal
 *
 */
