"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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

module.exports = function(pyModule) {

    pyModule["LinearPanel"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(LinearPanel)!1*/["layout", "containers", "appearance", "tooltip", "user data"]);

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.lpul = $('<ul/>').addClass("linear-panel");
            self._anvil.element = self._anvil.element || $("<div>");
            self._anvil.element.addClass("anvil-container").append(self._anvil.lpul);
        },pyModule, $loc, properties,PyDefUtils.assembleGroupEvents("linear panel", /*!componentEvents(LinearPanel)!1*/["universal"]), pyModule["Container"]);


        // TODO: Add properties for orientation. Vertical for now.

        /*!defMethod(_,component,[index=None])!2*/ "Add a component to this LinearPanel, in the 'index'th position. If 'index' is not specified, adds to the bottom."
        $loc["add_component"] = new PyDefUtils.funcWithKwargs(function(kwargs, self, component) {
            if (!component || !component._anvil) { throw new Sk.builtin.Exception("Argument to add_component() must be a component"); }
            var celt;
            return Sk.misceval.chain(undefined,
                () => {
                    if (component._anvil.metadata.invisible) { return; }

                    var element = component._anvil.element;

                    celt = $('<li/>').append(element);
                    if (typeof(kwargs["index"]) == "number") {

                        var elts = self._anvil.lpul.children();
                        if (kwargs["index"] < elts.length) {
                            celt.insertBefore(elts[kwargs["index"]]);
                            return;
                            // else fall through and insert at the end
                        }
                    }
                    self._anvil.lpul.append(celt);
                },
                () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs),
                () => {
                    // Now that we've added it to our components array, move it to the right position.
                    if (typeof(kwargs["index"]) == "number") {
                        var c = self._anvil.components.pop(); // pop off this new component (pushed on by super.add_component())
                        self._anvil.components.splice(kwargs["index"], 0, c);
                    }
                    let rmFn = component._anvil.parent.remove;
                    component._anvil.parent.remove = () => {
                        if (celt) {
                            celt.detach();
                        }
                        return rmFn();
                    };
                    return Sk.builtin.none.none$;
                }
            );
        });
    }, /*!defClass(anvil,LinearPanel,Container)!*/ "LinearPanel", [pyModule["Container"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - Event groups: universal
 *  - Methods: add_component
 *
 */
