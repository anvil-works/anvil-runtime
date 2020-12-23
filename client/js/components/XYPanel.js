"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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

*/

module.exports = function(pyModule) {

    let panelId = 0;

    pyModule["XYPanel"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(XYPanel)!1*/["layout", "height", "appearance", "align", "tooltip", "user data"], {
            height: {
                set: function(s,e,v) {
                    v = +v;
                    e.find(`.holder.xypanel-${s._anvil.panelId}`).css("height", v);
                }
            },
            align: {
                set: function(s,e,v) {
                    e.css("text-align", v);
                    s._anvil.updateHatching();
                }
            }
        });

        /*!componentProp(XYPanel):1*/
        properties.push({
            name: "width",
            type: "number",
            nullable: true,
            description: "Custom column widths in this panel",
            defaultValue: null,
            important: false,
            priority: 0,
            set: function(s,e,v) {
                e.find(`.holder.xypanel-${s._anvil.panelId}`).css("width", (v === null) ? "100%" : v);
                s._anvil.updateHatching(v);
            }
        });

        var events = PyDefUtils.assembleGroupEvents("X-Y panel", /*!componentEvents(XYPanel)!1*/["universal", "align"]);

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.updateHatching = () => {};
            self._anvil.panelId = panelId++;
            self._anvil.element = $(`<div><div class="holder xypanel-${self._anvil.panelId}"></div></div>`).addClass("xy-panel anvil-container");
            self._anvil.element.find(`.holder.xypanel-${self._anvil.panelId}`)
                .css({display: "inline-block", position: "relative"});

            self._anvil.layoutPropTypes = [{
                name: "x",
                type: "number",
                description: "The X coordinate, in pixels, where this component will be placed",
                defaultValue: 0,
                priority: 1,
            }, {
                name: "y",
                type: "number",
                description: "The Y coordinate, in pixels, where this component will be placed",
                defaultValue: 0,
                priority: 1,
            }, {
                name: "width",
                type: "number",
                description: "The width allocated to this component, in pixels",
                defaultValue: 0,
                priority: 0,
            }];

            self._anvil.setLayoutProperties = function(pyChild, layoutProperties) {
                var elt = pyChild._anvil.element;
                var lp = {};
                if ("x" in layoutProperties) {
                    elt.css({left: layoutProperties.x});
                    lp.x = layoutProperties.x;
                }
                if ("y" in layoutProperties) {
                    elt.css({top: layoutProperties.y});
                    lp.y = layoutProperties.y;
                }
                if ("width" in layoutProperties) {
                    elt.css({width: layoutProperties.width});
                    lp.y = layoutProperties.y;
                }

                var ps = {};
                ps [pyChild._anvil.componentSpec.name] = lp;
                return ps;
            };
        }, pyModule, $loc, properties, events, pyModule["Container"]);

        /*!defMethod(_,component,[x=0],[y=0],[width=None])!2*/ "Add a component to this XYPanel, at the specified coordinates. If the component's width is not specified, uses the component's default width."
        $loc["add_component"] = PyDefUtils.funcWithKwargs(function(kwargs, self, component) {
            if (!component || !component._anvil) { throw new Sk.builtin.Exception("Argument to add_component() must be a component"); }
            return Sk.misceval.chain(undefined,
                () => {
                    if (component._anvil.metadata.invisible) { return; }

                    var x = kwargs["x"] || 0;
                    var y = kwargs["y"] || 0;
                    var w = kwargs["width"] || "";
                    var celt = component._anvil.element;

                    celt.css({position: "absolute", left: x, top: y, width: w});

                    self._anvil.element.find(`.holder.xypanel-${self._anvil.panelId}`).append(celt);
                },
                () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs)
            );
        });

        /*!defMethod(number)!2*/ "Get the width of this XYPanel, in pixels."
        $loc["get_width"] = new Sk.builtin.func(self => Sk.ffi.remapToPy(self._anvil.element.outerWidth()));

    }, /*!defClass(anvil,XYPanel,Container)!*/ "XYPanel", [pyModule["Container"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height, appearance
 *  - Methods: add_component
 *
 */
