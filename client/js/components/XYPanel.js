"use strict";

var PyDefUtils = require("PyDefUtils");
import { validateChild } from "./Container";
import { getCssPrefix } from "@runtime/runner/legacy-features";
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

module.exports = (pyModule) => {

    let panelId = 0;

    pyModule["XYPanel"] = PyDefUtils.mkComponentCls(pyModule, "XYPanel", {
        base: pyModule["ClassicContainer"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(XYPanel)!1*/ ["layout", "layout_margin", "height", "appearance", "align", "tooltip", "user data"], {
            height: {
                set(s, e, v) {
                    s._anvil.elements.holder.style.height = PyDefUtils.cssLength(v.toString());
                },
            },
            align: {
                set(s, e, v) {
                    v = v.toString();
                    s._anvil.elements.outer.style.textAlign = v;
                    s._anvil.updateHatching();
                },
            },
            width: /*!componentProp(XYPanel):1*/ {
                group: null,
                deprecated: false,
                name: "width",
                type: "number",
                nullable: true,
                description: "Custom column widths in this panel",
                defaultValue: Sk.builtin.none.none$,
                pyVal: true,
                important: false,
                priority: 0,
                set(s, e, v) {
                    // todo - should support all units like jquery does
                    s._anvil.elements.holder.style.width = Sk.builtin.checkNone(v) ? "100%" : PyDefUtils.cssLength(v.toString());
                    s._anvil.updateHatching(v);
                },
            },
        }),

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
            // todo - should support all units like jquery does
            const prefix = getCssPrefix();
            width = Sk.builtin.checkNone(width) ? " width: 100%;" : " width: " + PyDefUtils.cssLength(width.toString()) + ";";
            height = "height: " + PyDefUtils.cssLength(height.toString()) + ";"
            return (
                <PyDefUtils.OuterElement className={`${prefix}xy-panel anvil-container` }{...props}>
                    <div refName="holder" className={`${prefix}holder xypanel-${panelId}`} style={"display: inline-block; position: relative;" + width + height}></div>
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicContainer"], (self) => {
                // updateHatching is designer only;
                self._anvil.updateHatching = () => {};
                self._anvil.panelId = panelId++;
            });

            /*!defMethod(_,component,[x=0],[y=0],[width=None])!2*/ "Add a component to this XYPanel, at the specified coordinates. If the component's width is not specified, uses the component's default width."
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                validateChild(component);
                return Sk.misceval.chain(
                    component.anvil$hooks.setupDom(),
                    rawElement => {
                        if (isInvisibleComponent(component)) {
                            return pyModule["ClassicContainer"]._doAddComponent(self, component);
                        }

                        const { x, y, width } = kwargs;
                        const celt = $(rawElement);
                        celt.css({ position: "absolute", left: x || 0, top: y || 0, width: width || "" });
                        self._anvil.elements.holder.appendChild(celt[0]);
                        return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs);
                    }
                );
            });

            /*!defMethod(number)!2*/ "Get the width of this XYPanel, in pixels."
            $loc["get_width"] = new Sk.builtin.func((self) => Sk.ffi.remapToPy(self._anvil.element.outerWidth()));
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
