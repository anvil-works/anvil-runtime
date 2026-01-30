"use strict";

import { chainOrSuspend, checkNone, pyFunc, pyNone, toPy } from "@Sk";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap, s_x_anvil_dom_node_changed } from "@runtime/runner/py-util";
import PyDefUtils from "PyDefUtils";
import { ClassicComponentConstructor } from "./ClassicComponent";
import { ClassicContainer } from "./ClassicContainer";
import { addEventHandler, Component, removeEventHandler } from "./Component";
import { validateChild } from "./Container";
import { isInvisibleComponent } from "./helpers";

/*#
id: xypanel
docs_url: /docs/client/components/containers#xypanel
title: XY Panel
tooltip: Learn more about XYPanel
description: |
  ```python
  xy_panel = XYPanel(width=400, height=400)

  btn = Button(text="Click me!")
  xy_panel.add_component(btn, x=10, y=100)
  ```

  This container allows its child components to be placed at any position inside. Positions are measured in pixels from the top-left of the panel. To help with positioning components, you can get the width of an `XYPanel` by calling the `get_width()` function.

  #### Arguments to `add_component`:
  \* `x`: How far across the component is from the left-hand edge
  \* `y`: How far down the component is from the top edge
  \* `width`: Optional, the width of the component.

*/

interface XYPanel
    extends ClassicContainer<{
        elements: { root: HTMLElement; holder: HTMLDivElement };
        panelId: number;
        updateHatching: (v?: any) => void;
    }> {}

const XYPanelFactory = (pyModule: PyModMap) => {
    let panelId = 0;
    const ClassicContainer = pyModule["ClassicContainer"] as ClassicComponentConstructor;

    pyModule["XYPanel"] = PyDefUtils.mkComponentCls<XYPanel>(pyModule, "XYPanel", {
        base: ClassicContainer,

        properties: PyDefUtils.assembleGroupProperties<XYPanel>(
            /*!componentProps(XYPanel)!1*/ [
                "layout",
                "layout_margin",
                "height",
                "appearance",
                "align",
                "tooltip",
                "user data",
            ],
            {
                height: {
                    pyVal: true,
                    set(s, e, v) {
                        s._anvil.elements.holder.style.height = PyDefUtils.cssLength(v.toString());
                    },
                },
                align: {
                    pyVal: true,
                    set(s, e, pyV) {
                        const v = pyV.toString();
                        e.style.textAlign = v;
                        s._anvil.updateHatching();
                    },
                },
                width: /*!componentProp(XYPanel):1*/ {
                    group: null,
                    deprecated: false,
                    name: "width",
                    type: "number",
                    description: "Custom column widths in this panel",
                    defaultValue: pyNone,
                    pyVal: true,
                    important: false,
                    priority: 0,
                    set(s, e, v) {
                        // todo - should support all units
                        s._anvil.elements.holder.style.width = checkNone(v)
                            ? "100%"
                            : PyDefUtils.cssLength(v.toString());
                        s._anvil.updateHatching(v);
                    },
                },
            }
        ),

        events: PyDefUtils.assembleGroupEvents("X-Y panel", /*!componentEvents(XYPanel)!1*/ ["universal", "align"]),

        layouts: [
            {
                name: "x",
                type: "number",
                description: "The X coordinate, in pixels, where this component will be placed",
                defaultValue: 0,
                priority: 1,
            },
            {
                name: "y",
                type: "number",
                description: "The Y coordinate, in pixels, where this component will be placed",
                defaultValue: 0,
                priority: 1,
            },
            {
                name: "width",
                type: "number",
                description: "The width allocated to this component, in pixels",
                defaultValue: 0,
                priority: 0,
            },
        ],

        element({ width, height, ...props }) {
            // todo - should support all units
            const prefix = getCssPrefix();
            width = checkNone(width) ? " width: 100%;" : " width: " + PyDefUtils.cssLength(width.toString()) + ";";
            height = "height: " + PyDefUtils.cssLength(height.toString()) + ";";
            return (
                <PyDefUtils.OuterElement className={`${prefix}xy-panel anvil-container`} {...props}>
                    <div
                        refName="holder"
                        className={`${prefix}holder xypanel-${panelId}`}
                        style={"display: inline-block; position: relative;" + width + height}></div>
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<XYPanel>(ClassicContainer, (self) => {
                // updateHatching is designer only;
                self._anvil.updateHatching = () => {};
                self._anvil.panelId = panelId++;
            });

            /*!defMethod(_,component,[x=0],[y=0],[width=None])!2*/ ("Add a component to this XYPanel, at the specified coordinates. If the component's width is not specified, uses the component's default width.");
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function (
                kwargs: any,
                self: XYPanel,
                component: Component
            ) {
                validateChild(component);
                return chainOrSuspend(component.anvil$hooks.setupDom(), (rawElement) => {
                    if (isInvisibleComponent(component)) {
                        return ClassicContainer._doAddComponent(self, component);
                    }

                    const { x, y, width } = kwargs;
                    const holder = self._anvil.elements.holder;

                    const leftCss = PyDefUtils.cssLength(x || 0);
                    const topCss = PyDefUtils.cssLength(y || 0);
                    const widthSource = width ?? "";
                    const widthCss = widthSource ? PyDefUtils.cssLength(widthSource) : "";

                    let previousElement: HTMLElement | null = null;
                    let previousInlineStyles: { position: string; left: string; top: string; width: string } | null = null;

                    const cleanupStyles = () => {
                        if (!previousElement || !previousInlineStyles) {
                            previousElement = null;
                            previousInlineStyles = null;
                            return;
                        }
                        previousElement.style.position = previousInlineStyles.position;
                        previousElement.style.left = previousInlineStyles.left;
                        previousElement.style.top = previousInlineStyles.top;
                        previousElement.style.width = previousInlineStyles.width;
                        previousElement = null;
                        previousInlineStyles = null;
                    };

                    const applyStyles = () => {
                        const element = component.anvil$hooks.domElement;
                        if (!(element instanceof HTMLElement)) {
                            return;
                        }
                        if (element !== previousElement) {
                            cleanupStyles();
                            previousElement = element;
                            previousInlineStyles = {
                                position: element.style.position,
                                left: element.style.left,
                                top: element.style.top,
                                width: element.style.width,
                            };
                        }
                        element.style.position = "absolute";
                        element.style.left = leftCss;
                        element.style.top = topCss;
                        if (widthCss === "") {
                            element.style.removeProperty("width");
                        } else {
                            element.style.width = widthCss;
                        }
                        if (element.parentElement !== holder) {
                            holder.appendChild(element);
                        }
                    };

                    const beforeAdd = () => {
                        applyStyles();
                        return addEventHandler(component, s_x_anvil_dom_node_changed, applyStyles);
                    };

                    const afterRemoval = () => {
                        cleanupStyles();
                        return removeEventHandler(component, s_x_anvil_dom_node_changed, applyStyles);
                    };

                    return chainOrSuspend(beforeAdd(), () =>
                        pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs, { afterRemoval })
                    );
                });
            });

            /*!defMethod(number)!2*/ ("Get the width of this XYPanel, in pixels.");
            $loc["get_width"] = new pyFunc((self: XYPanel) => toPy(self._anvil.element.outerWidth()));
        },
    });
};

/*!defClass(anvil,XYPanel,Container)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height, appearance
 *  - Methods: add_component
 *
 */

export default XYPanelFactory;
