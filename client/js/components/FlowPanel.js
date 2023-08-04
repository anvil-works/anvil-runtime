"use strict";

var PyDefUtils = require("PyDefUtils");
import { validateChild } from "./Container";
import { isInvisibleComponent } from "./helpers";

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


    pyModule["FlowPanel"] = PyDefUtils.mkComponentCls(pyModule, "FlowPanel", {
        base: pyModule["ClassicContainer"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(FlowPanel)!1*/ ["appearance", "user data", "layout", "tooltip"], {
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

            spacing: /*!componentProp(FlowPanel)!1*/ {
                name: "spacing",
                description: "Space between components",
                type: "enum",
                options: ["none", "tiny", "small", "medium", "large", "huge"],
                defaultValue: new Sk.builtin.str("medium"),
                pyVal: true,
                important: false,
                priority: 0,
                set(s, e, v) {
                    v = v.toString();
                    ["none", "tiny", "small", "medium", "large", "huge"].forEach((i) => {
                        s._anvil.domNode.classList.toggle("flow-spacing-" + i, v === i);
                    });
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

        element({ align, spacing, ...props }) {
            spacing = " flow-spacing-" + spacing.toString();
            align =
                "justify-content: " +
                ({
                    center: "center",
                    right: "flex-end",
                    justify: "space-between",
                }[align.toString()] || "flex-start") +
                ";";

            return (
                <PyDefUtils.OuterElement className={"flow-panel anvil-container anvil-container-overflow" + spacing} {...props}>
                    <div refName="gutter" className="flow-panel-gutter" style={align} />
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            const ContainerElement = ({ visible, width, expand }) => {
                visible = !Sk.misceval.isTrue(visible) ? " visible-false" : "";
                let style = "";
                if (width) {
                    style += "width: " + PyDefUtils.cssLength(width.toString()) + ";";
                }
                if (expand) {
                    style += "flex: 1;";
                }
                return <div className={"flow-panel-item anvil-always-inline-container hide-with-component" + visible} style={style}></div>;
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
                        // TODO: How should components signal visibility to their parents?
                        const visible = (component._anvil && ("visible" in component._anvil.propMap)) ? component._anvil.getProp("visible") : Sk.builtin.bool.true$;
                        const width = domNode.classList.contains("anvil-inlinable") ? "" : kwargs["width"] || "auto";
                        const [containerElement] = <ContainerElement visible={visible} width={width} expand={expand} />;
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
                        });
                    }
                );
            });
        },
    });

};

/*!defClass(anvil,FlowPanel,Container)!*/
