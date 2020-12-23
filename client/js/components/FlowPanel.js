"use strict";

var PyDefUtils = require("PyDefUtils");
/**
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

module.exports = function(pyModule) {

	pyModule["FlowPanel"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(FlowPanel)!1*/["appearance", "user data", "layout", "tooltip"], {
        });


        /*!componentProp(FlowPanel)!1*/
        properties.push({
            name: "align",
            important: true,
            type: "string",
            enum: ["left", "center", "right", "justify"],
            description: "Align this component's content",
            defaultValue: "left",
            set: function(s,e,v) {
                let j = {
                    "center": "center",
                    "right": "flex-end",
                    "justify": "space-between",
                }
                v = j[v] || "flex-start";
                e.find(">.flow-panel-gutter").css("justify-content", v);
            }
        })


        /*!componentProp(FlowPanel)!1*/
        properties.push({
            name: "spacing",
            description: "Space between components",
            type: "string",
            enum: ["none", "tiny", "small", "medium", "large", "huge"],
            defaultValue: "medium",
            important: false,
            priority: 0,
            set: function(s,e,v) {
                for (let i of ["none", "tiny", "small", "medium", "large", "huge"]) {
                    e.toggleClass("flow-spacing-"+i, (v==i));
                }
            }
        });


		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {

            self._anvil.element = $('<div>').addClass("flow-panel anvil-container anvil-container-overflow");
            self._anvil.gutter = $('<div>').addClass("flow-panel-gutter");
            self._anvil.element.append(self._anvil.gutter);

            self._anvil.layoutPropTypes = [{
                name: "width",
                type: "number",
                description: "The width for an element that is not horizontally self-sizing",
                defaultValue: null,
                priority: 0,
            }];

        },pyModule, $loc, properties,PyDefUtils.assembleGroupEvents("FlowPanel", /*!componentEvents(FlowPanel)!1*/["universal"]), pyModule["Container"]);

        /*!defMethod(_,component,[index=],[width=])!2*/ "Add a component to this panel. Optionally specify the position in the panel to add it, or the width to apply to components that can't self-size width-wise."
        $loc["add_component"] = new PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
            if (!component || !component._anvil) {
                throw new Sk.builtin.Exception("Argument to add_component() must be a component");
            }
            return Sk.misceval.chain(Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs), () => {


                let element = component._anvil.element;
                let celt;
                const idx = kwargs["index"];

                if (!component._anvil.metadata.invisible) {
                    celt = $("<div>")
                        .addClass("flow-panel-item")
                        .addClass("anvil-always-inline-container")
                        .addClass("hide-with-component")
                        .append(element);

                    if ("visible" in component._anvil.propMap && !component._anvil.getPropJS("visible")) {
                        celt.addClass("visible-false");
                    }

                    if (!element.hasClass("anvil-inlinable")) {
                        celt.width(kwargs["width"] || "auto");
                    }

                    if (typeof idx == "number") {
                        const elts = self._anvil.gutter.children();
                        if (idx < elts.length) {
                            celt.insertBefore(elts[idx]);
                        } else {
                            self._anvil.gutter.append(celt);
                        }
                    } else {
                        self._anvil.gutter.append(celt);
                    }
                }

                if (typeof idx == "number") {
                    const c = self._anvil.components.pop(); // pop off this new component (pushed on by super.add_component())
                    self._anvil.components.splice(idx, 0, c);
                }

                let rmFn = component._anvil.parent.remove;
                component._anvil.parent.remove = () => {
                    if (celt) {
                        celt.detach();
                    }
                    return rmFn();
                };

                return Sk.builtin.none.none$;
            });
        });

    }, /*!defClass(anvil,FlowPanel,Container)!*/ "FlowPanel", [pyModule["Container"]]);
};
