"use strict";

import {getSpacingStyles, setElementSpacing} from "@runtime/runner/components-in-js/public-api/property-utils";

var PyDefUtils = require("PyDefUtils");
import { validateChild } from "./Container";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { isInvisibleComponent } from "./helpers";
import {pyNone, toJs, toPy} from "@Sk";
import {data} from "@runtime/runner/data";

/*#
id: flowpanel
docs_url: /docs/client/components/containers#flowpanel
title: FlowPanel
tooltip: Learn more about FlowPanel
description: |
  This container allows you to display components in lines with wrapping. Each component 
  will only take up the horizontal space that it needs.

  ```python
  fp = FlowPanel(align="center", spacing="small")
  # A button determines its own width
  fp.add_component(Button(text="Click me"))
  # A TextBox gets sized explicitly
  fp.add_component(TextBox(), width=100)
  ```
  Some components, like [Buttons](#button), dictate their own width in FlowPanels, based on their content. 
  For components like [TextBoxes](#textbox), that don't have a width specified by their content, you can drag
  the handle to set the width you require.

  If a component will not fit next to the previous component, it will wrap onto a new line.

  To control the space between components, set the `spacing` property.

  Like many other containers, the FlowPanel will expand vertically to fit its contents.

  ```python
  fp = FlowPanel()
  fp.add_component(Button(text="Button"))
  # Display the label to the left of the button:
  fp.add_component(Label(text="Click here:"), index=0)
  ```
  By default, components are added at the end of a FlowPanel. If you pass an `index`
  parameter to `add_component()`, the component will be inserted at the specified position.
  Index 0 is the first element in the panel, 1 is the second, etc.
*/

module.exports = (pyModule) => {

    const GAP_VALUES = ["none", "tiny", "small", "medium", "large", "huge"];

    const setGap = (s, e, v) => {
        const prefix = getCssPrefix();
        GAP_VALUES.forEach((i) => {
            s._anvil.domNode.classList.toggle(prefix + "flow-spacing-" + i, v === i);
        });
    };

    pyModule["FlowPanel"] = PyDefUtils.mkComponentCls(pyModule, "FlowPanel", {
        base: pyModule["ClassicContainer"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(FlowPanel)!1*/ ["appearance", "user data", "layout", "layout_spacing", "tooltip"], {
            align: /*!componentProp(FlowPanel)!1*/ {
                name: "align",
                important: true,
                type: "enum",
                options: ["left", "center", "right", "justify"],
                description: "Align this component's content",
                defaultValue: new Sk.builtin.str("left"),
                pyVal: true,
                designerHint: 'align-horizontal',
                set(s, e, v) {
                    v = v.toString();
                    const j = {
                        center: "center",
                        right: "flex-end",
                        justify: "space-between",
                    };
                    v = j[v] || "flex-start";
                    s._anvil.elements.gutter.style.justifyContent = v;
                },
            },
            vertical_align: /*!componentProp(FlowPanel)!1*/ {
                name: "vertical_align",
                type: "enum",
                options: ["top", "middle", "bottom", "full"],
                description: "Align this component's content",
                defaultValue: new Sk.builtin.str("full"),
                pyVal: true,
                designerHint: 'align-vertical',
                set(s, e, v) {
                    const prefix = getCssPrefix();
                    v = v.toString();
                    ["top", "middle", "bottom", "full"].forEach((i) => {
                        s._anvil.domNode.classList.toggle(prefix + "vertical-align-" + i, v === i);
                    });
                },
            },

            spacing: {
                set(s, e, v) {
                    if (GAP_VALUES.includes(v?.toString())) {
                        s._anvil.props.gap = v;
                        setGap(s, e, v);
                        setElementSpacing(e[0], null);
                    } else {
                        setElementSpacing(e[0], v);
                    }
                },
            },

            gap: /*!componentProp(FlowPanel)!1*/ {
                name: "gap",
                description: "Gap between components",
                type: "enum",
                options: ["none", "tiny", "small", "medium", "large", "huge"],
                defaultValue: Sk.builtin.none.none$, // Means look at spacing prop, otherwise use "medium". pyNone breaks gendoc.
                important: false,
                priority: 0,
                get(s, e) {
                    const currentPyGap = s._anvil.props.gap;

                    if (currentPyGap && currentPyGap !== pyNone) {
                        return currentPyGap;
                    } else {
                        const currentPySpacing = s._anvil.props.spacing;
                        if (GAP_VALUES.includes(currentPySpacing.toString())) {
                            return currentPySpacing;
                        } else {
                            return toPy("medium");
                        }
                    }
                },
                set(s, e, v) {
                    setGap(s, e, v);
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents("FlowPanel", /*!componentEvents(FlowPanel)!1*/ ["universal"]),

        layouts: [
            {
                name: "width",
                type: "number",
                description: "The width for an element that is not horizontally self-sizing",
                defaultValue: null,
                priority: 0,
                nullable: true,
            },
            {
                name: "expand",
                type: "boolean",
                description: "Expand the component",
                defaultValue: false,
                priority: 0,
            }
        ],

        element({ align, spacing, gap, vertical_align, ...props }) {
            const prefix = getCssPrefix();

            let gapClass = "flow-spacing-medium";
            const spacingJs = toJs(spacing);
            const actualGapJs = toJs(gap) ?? spacingJs;
            if (GAP_VALUES.includes(actualGapJs)) {
                gapClass = prefix + "flow-spacing-" + actualGapJs;
            }

            if (!GAP_VALUES.includes(spacingJs)) {
                props.spacing = spacing;
            }

            align =
                "justify-content: " +
                ({
                    center: "center",
                    right: "flex-end",
                    justify: "space-between",
                }[align.toString()] || "flex-start") +
                ";";
            vertical_align = prefix + "vertical-align-" + (vertical_align.toString() || 'top');

            return (
                <PyDefUtils.OuterElement className={`${prefix}flow-panel anvil-container anvil-container-overflow ${gapClass} ${vertical_align}`} {...props}>
                    <div refName="gutter" className={`${prefix}flow-panel-gutter`} style={align} />
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            const ContainerElement = ({ visible=true, width, expand }) => {
                const prefix = getCssPrefix();
                visible = !Sk.misceval.isTrue(visible) ? ` ${prefix}visible-false` : "";
                let style = "";
                if (width) {
                    style += "width: " + PyDefUtils.cssLength(width.toString()) + ";";
                }
                if (expand) {
                    style += "flex: 1;";
                }
                return <div className={`${prefix}flow-panel-item anvil-always-inline-container` + visible} style={style}></div>;
            };

            /*!defMethod(_,component,[index=],[width=],[expand=])!2*/ "Add a component to this panel. Optionally specify the position in the panel to add it, or the width to apply to components that can't self-size width-wise."
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                validateChild(component);
                const { index: idx, expand = false } = kwargs;

                return Sk.misceval.chain(
                    component.anvil$hooks.setupDom(),
                    domNode => {
                        if (isInvisibleComponent(component)) {
                            return pyModule["ClassicContainer"]._doAddComponent(self, component);
                        }
                        const gutter = self._anvil.elements.gutter;
                        const width = domNode.classList.contains("anvil-inlinable") ? "" : kwargs["width"] || "auto";
                        const [containerElement] = <ContainerElement width={width} expand={expand} />;
                        containerElement.appendChild(domNode);
                        if (typeof idx === "number" && idx < gutter.children.length) {
                            gutter.insertBefore(containerElement, gutter.children[idx]);
                            // fall through
                        } else {
                            gutter.appendChild(containerElement);
                        }
                        return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs, {
                            detachDom() {
                                $(domNode).detach();
                                containerElement.remove();
                            },
                            setVisibility(v) {
                                containerElement.classList.toggle(getCssPrefix() + "visible-false", !v);
                            }
                        });
                    }
                );
            });
        },
    });
};

/*!defClass(anvil,FlowPanel,Container)!*/
