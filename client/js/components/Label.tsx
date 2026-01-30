import {
    getUnsetSpacing,
    setElementMargin,
    setElementPadding,
} from "@runtime/runner/components-in-js/public-api/property-utils";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap } from "@runtime/runner/py-util";
import { checkNone, isTrue } from "@Sk";
import PyDefUtils from "PyDefUtils";
import { ClassicComponent, ClassicComponentConstructor } from "./ClassicComponent";

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

interface LabelElements {
    root: HTMLDivElement;
    iconLeft: HTMLElement;
    iconRight: HTMLElement;
    text: HTMLSpanElement;
}

export interface Label extends ClassicComponent<{ elements: LabelElements }> {}

export interface LabelConstructor extends ClassicComponentConstructor {
    new (): Label;
}

const LabelFactory = (pyModule: PyModMap) => {
    pyModule["Label"] = PyDefUtils.mkComponentCls<Label>(pyModule, "Label", {
        properties: PyDefUtils.assembleGroupProperties<Label>(
            /*!componentProps(Label)!2*/ [
                "layout",
                "layout_spacing",
                "text",
                "appearance",
                "icon",
                "tooltip",
                "user data",
            ],
            {
                text: {
                    // override the default
                    dataBindingProp: true,
                    multiline: true,
                    suggested: true,
                    inlineEditElement: "text",
                    group: undefined,
                },
                spacing: {
                    pyVal: false,
                    set(s, e, v) {
                        setElementMargin(e, v?.margin);
                        setElementPadding(s._anvil.elements.text, v?.padding);
                    },
                    getUnset(s, e, currentValue) {
                        return getUnsetSpacing(e, s._anvil.elements.text, currentValue);
                    },
                },
            }
        ),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "Label", ["universal"]),

        element: (props) => {
            const prefix = getCssPrefix();
            const textPaddingStyle = PyDefUtils.getPaddingStyle({ spacing: props.spacing });
            return (
                <PyDefUtils.OuterElement className="anvil-label anvil-inlinable" includePadding={false} {...props}>
                    <PyDefUtils.IconComponent side="left" {...props} />
                    <span
                        refName="text"
                        className={`${prefix}label-text`}
                        style={(isTrue(props.underline) ? "text-decoration: underline;" : "") + textPaddingStyle}>
                        {checkNone(props.text) ? "" : props.text.toString()}
                    </span>
                    <PyDefUtils.IconComponent side="right" {...props} />
                </PyDefUtils.OuterElement>
            );
        },
    });
};

export default LabelFactory;

/*!defClass(anvil,Label,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, text, appearance
 *  - Override set: text
 *  - Event groups: universal
 *
 */
