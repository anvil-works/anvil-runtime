"use strict";

const { getCssPrefix } = require("@runtime/runner/legacy-features");
var PyDefUtils = require("PyDefUtils");
const { setElementMargin, setElementPadding, getUnsetSpacing } = require("@runtime/runner/components-in-js/public-api/property-utils");
const {
    misceval: { isTrue },
} = Sk;

/*#
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

module.exports = (pyModule) => {
    pyModule["Label"] = PyDefUtils.mkComponentCls(pyModule, "Label", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(Label)!2*/ ["layout", "layout_spacing", "text", "appearance", "icon", "tooltip", "user data"], {
            text: { // override the default
                dataBindingProp: true,
                multiline: true,
                suggested: true,
                inlineEditElement: "text",
                group: undefined,
            },
            spacing: {
                set(s, e, v) {
                    setElementMargin(e[0], v?.margin);
                    setElementPadding(s._anvil.elements.text, v?.padding);
                },
                getUnset(s, e, currentValue) {
                    return getUnsetSpacing(e[0], s._anvil.elements.text, currentValue);
                }
            },
        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "Label", ["universal"]),

        element: (props) => {
            const prefix = getCssPrefix();
            const textPaddingStyle = PyDefUtils.getPaddingStyle({spacing: props.spacing});
            return (
                <PyDefUtils.OuterElement className="anvil-label anvil-inlinable" includePadding={false} {...props}>
                    <PyDefUtils.IconComponent side="left" {...props} />
                    <span
                        refName="text"
                        className={`${prefix}label-text`}
                        style={(isTrue(props.underline) ? "text-decoration: underline;" : "") + textPaddingStyle}>
                        {Sk.builtin.checkNone(props.text) ? "" : props.text.toString()}
                    </span>
                    <PyDefUtils.IconComponent side="right" {...props} />
                </PyDefUtils.OuterElement>
            );
         },
    });
};

/*!defClass(anvil,Label,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, text, appearance
 *  - Override set: text
 *  - Event groups: universal
 *
 */


 

