import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap } from "@runtime/runner/py-util";
import PyDefUtils from "PyDefUtils";
import { ClassicComponentConstructor } from "./ClassicComponent";
import { ClassicContainer } from "./ClassicContainer";
import { Component } from "./Component";
import { indexInRange, validateChild } from "./Container";
import { isInvisibleComponent } from "./helpers";

/*#
id: linearpanel
docs_url: /docs/client/components/containers#linearpanel
title: LinearPanel
tooltip: Learn more about LinearPanel
description: |
    ```python
    lp = LinearPanel()
    lp.add_component(Label(text="Hello"))
    lp.add_component(Button(text="Click me"))
    ```

    This container arranges its child components vertically, each filling the whole width of the panel by default.

    It takes no extra arguments for `add_component`: each component is added to the bottom of the LinearPanel.

    The LinearPanel will expand vertically to fit its contents.

    ```python
    # self.linear_panel_1 is a LinearPanel
    lp.add_component(Button(text="Button"))
    # This label will be added above the Button.
    lp.add_component(Label(text="Label"), index=0)
    ```

    By default, components are added at the end of a LinearPanel.
    If you add an `index` layout parameter to the `add_component()` call, the component will be added at that index. Index 0 is the first element in the panel, 1 is the second, etc.
*/

interface LinearPanel extends ClassicContainer<{ elements: { root: HTMLElement; lpul: HTMLUListElement } }> {}

const LinearPanelFactory = (pyModule: PyModMap) => {
    const ClassicContainer = pyModule["ClassicContainer"] as ClassicComponentConstructor;

    pyModule["LinearPanel"] = PyDefUtils.mkComponentCls<LinearPanel>(pyModule, "LinearPanel", {
        base: ClassicContainer,

        properties: PyDefUtils.assembleGroupProperties(
            /*!componentProps(LinearPanel)!1*/ [
                "layout",
                "layout_spacing",
                "containers",
                "appearance",
                "tooltip",
                "user data",
            ]
        ),

        events: PyDefUtils.assembleGroupEvents("linear panel", /*!componentEvents(LinearPanel)!1*/ ["universal"]),

        element: (props) => (
            <PyDefUtils.OuterElement className="anvil-container" {...props}>
                <ul refName="lpul" className={`${getCssPrefix()}linear-panel`}></ul>
            </PyDefUtils.OuterElement>
        ),

        locals($loc) {
            // TODO: Add properties for orientation. Vertical for now.

            const ContainerElement = () => {
                return <li></li>;
            };

            /*!defMethod(_,component,[index=None])!2*/ ("Add a component to this LinearPanel, in the 'index'th position. If 'index' is not specified, adds to the bottom.");
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function (
                kwargs: any,
                self: LinearPanel,
                component: Component
            ) {
                validateChild(component);

                let celt: HTMLLIElement;
                let idx = kwargs["index"];
                idx = indexInRange(idx, self);

                return Sk.misceval.chain(component.anvil$hooks.setupDom(), (element) => {
                    if (isInvisibleComponent(component)) {
                        return ClassicContainer._doAddComponent(self, component);
                    }

                    [celt] = (<ContainerElement />) as [HTMLLIElement, { lpul: HTMLUListElement }];
                    celt.appendChild(element);
                    const lpul = self._anvil.elements.lpul;
                    if (typeof idx === "number") {
                        lpul.insertBefore(celt, lpul.children[idx]);
                    } else {
                        lpul.appendChild(celt);
                    }
                    return ClassicContainer._doAddComponent(self, component, kwargs, {
                        detachDom() {
                            celt.remove();
                            // polyfilled in RichText.tsx
                            celt.replaceChildren();
                        },
                    });
                });
            });
        },
    });
};

/*!defClass(anvil,LinearPanel,Container)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - Event groups: universal
 *  - Methods: add_component
 *
 */

export default LinearPanelFactory;
