"use strict";

var PyDefUtils = require("PyDefUtils");

/**
id: gridpanel
docs_url: /docs/client/components/containers#gridpanel
title: GridPanel
tooltip: Learn more about GridPanel
description: |
  ```python
  gp = GridPanel()

  gp.add_component(Label(text="Name:"),
                   row="A", col_xs=0, width_xs=2)

  gp.add_component(TextBox(),
                   row="A", col_xs=2, width_xs=6)

  gp.add_component(Button(text="Submit"),
                   row="B", col_xs=3, width_xs=2)
  ```

  This container lays out components on a grid. Each row has twelve columns, and a component can span multiple
  columns. Components occupying the same columns in different rows will be aligned.

  #### Arguments to `add_component`:
  \* `row`: The name of the row to which this component will be added. If this is the first component with this
      row name, a new row will be created at the bottom of the GridPanel.

  \* `col_xs`: What's the first column this component occupies? (0-11, default 0)

  \* `width_xs`: How many columns does this component occupy? (1-12, default 12)

  \**Note: When adding multiple components to the same row in code, components must be added left-to-right.**

*/

module.exports = function(pyModule) {

	pyModule["GridPanel"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(GridPanel)!2*/["layout", "containers", "appearance", "user data", "tooltip"], {
          row_spacing: {
            set: function(s, e, v) {
              e.children("div.row").css("marginBottom", v);
            },
          },
        });


		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div/>').addClass("grid-panel anvil-container");
            self._anvil.lastRow = null;
            self._anvil.gridComponents = []; // component = {pyComponent: (pyObj), row: (id), lastCol: {xs: 0-12, sm: 0-12, ...}
            self._anvil.rows = {}; // row = {element: (jq), lastCol: {xs: 0-12, sm: 0-12, ...}}
        },pyModule, $loc, properties,PyDefUtils.assembleGroupEvents("grid panel", /*!componentEvents(GridPanel)!1*/["universal"]), pyModule["Container"]);

        /*!defMethod(_,component,[row=],[col_xs=],[width_xs=])!2*/ "Add a component to this GridPanel"
        $loc["add_component"] = PyDefUtils.funcWithKwargs(function(kwargs, self, pyComponent) {
            var celt;
            if (!pyComponent || !pyComponent._anvil) { throw new Sk.builtin.Exception("Argument to add_component() must be a component"); }
            return Sk.misceval.chain(undefined, () => {
                // TODO set pyComponent._anvil.parent.remove to a closure that deletes the row if necessary
                if (pyComponent._anvil.metadata.invisible) { return; }

                var rowName = kwargs["row"];
                var row = self._anvil.rows[rowName];

                if (!row) {
                    // TODO allow a way of manually inserting into the middle rather than at the bottom?
                    row = {element: $('<div class="row">').css("marginBottom", self._anvil.getPropJS("row_spacing")).data("anvil-gridpanel-row", rowName),
                           lastCol: {}};
                    self._anvil.rows[rowName] = row;
                    self._anvil.element.append(row.element);
                }

                celt = $('<div>').append(pyComponent._anvil.element);

                var component = {pyComponent: pyComponent, row: rowName, lastCol: {}};

                var sizes = ["xs", "sm", "md", "lg"];
                var width = 12, offset = 0; // Default to full-width, zero offset, inherit small-to-large
                for (var i in sizes) {
                    var size = sizes[i];
                    var w = kwargs["width_"+size];
                    if (w) {
                        width = parseInt(w);
                    }
                    celt.addClass("col-"+size+"-"+width);

                    var lastCol = (row.lastCol[size] || 0);

                    var xRequest = kwargs["col_"+size];
                    if (xRequest && parseInt(xRequest) > lastCol) {
                        offset = parseInt(xRequest) - lastCol;
                        celt.addClass("col-" + sizes[i] + "-offset-" + offset);
                    }

                    row.lastCol[size] = component.lastCol[size] = lastCol + width + offset;
                }

                self._anvil.gridComponents.push(component);

                row.element.append(celt);
            },
            () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, pyComponent, kwargs),
            () => {
                let rmFn = pyComponent._anvil.parent.remove;
                pyComponent._anvil.parent.remove = () => {
                    if (celt) {
                        celt.detach();
                    }
                    return rmFn();
                };
                return Sk.builtin.none.none$;
            });
        });

        $loc["clear"] = new Sk.builtin.func(function(self) {

            let x = Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.clear, self);

            self._anvil.element.empty();
            self._anvil.lastRow = null;
            self._anvil.gridComponents = [];
            self._anvil.rows = {};

            return x;
        });
    }, /*!defClass(anvil,GridPanel,Container)!*/ "GridPanel", [pyModule["Container"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - Child layout props: full_width_row, row_background
 *  - Event groups: universal
 *  - Methods: add_component, clear
 *
 */
