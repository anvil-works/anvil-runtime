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

module.exports = (pyModule) => {


    pyModule["GridPanel"] = PyDefUtils.mkComponentCls(pyModule, "GridPanel", {
        base: pyModule["Container"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(GridPanel)!2*/ ["layout", "containers", "appearance", "user data", "tooltip"]),

        events: PyDefUtils.assembleGroupEvents("grid panel", /*!componentEvents(GridPanel)!1*/ ["universal"]),

        element: (props) => <PyDefUtils.OuterElement className="grid-panel anvil-container" {...props} />,

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["Container"], (self) => {
                self._anvil.gridComponents = []; 
                // component = {pyComponent: (pyObj), row: (id), lastCol: {xs: 0-12, sm: 0-12, ...}
                self._anvil.rows = {}; 
                // row = {element: (jq), lastCol: {xs: 0-12, sm: 0-12, ...}}
            });

            const ContainerElement = ({ classList }) => <div className={classList} />;

            /*!defMethod(_,component,[row=],[col_xs=],[width_xs=])!2*/ "Add a component to this GridPanel"
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function add_component(kwargs, self, pyComponent) {
                pyModule["Container"]._check_no_parent(pyComponent);

                const rowName = kwargs["row"];
                let celt;

                return Sk.misceval.chain(
                    null,
                    () => {
                        // TODO set pyComponent._anvil.parent.remove to a closure that deletes the row if necessary
                        if (pyComponent._anvil.metadata.invisible) {
                            return;
                        }

                        let row = self._anvil.rows[rowName];

                        if (!row) {
                            // TODO allow a way of manually inserting into the middle rather than at the bottom?
                            row = {
                                element: $('<div class="row">').css("marginBottom", self._anvil.getPropJS("row_spacing")).data("anvil-gridpanel-row", rowName),
                                lastCol: {},
                            };
                            self._anvil.rows[rowName] = row;
                            self._anvil.element.append(row.element);
                        }

                        const component = { pyComponent: pyComponent, row: rowName, lastCol: {} };

                        let width = 12,
                            offset = 0, // Default to full-width, zero offset, inherit small-to-large
                            classList = [];
                        ["xs", "sm", "md", "lg"].forEach((size) => {
                            const w = kwargs["width_" + size];
                            if (w) {
                                width = parseInt(w);
                            }
                            classList.push("col-" + size + "-" + width);
                            const lastCol = row.lastCol[size] || 0;

                            const xRequest = kwargs["col_" + size];
                            if (xRequest && parseInt(xRequest) > lastCol) {
                                offset = parseInt(xRequest) - lastCol;
                                classList.push("col-" + size + "-offset-" + offset);
                            }
                            row.lastCol[size] = component.lastCol[size] = lastCol + width + offset;
                        });

                        [celt] = <ContainerElement classList={classList.join(" ")} />;
                        celt.appendChild(pyComponent._anvil.domNode);

                        self._anvil.gridComponents.push(component);

                        row.element.append(celt);
                    },
                    () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, pyComponent, kwargs),
                    () => {
                        const rmFn = pyComponent._anvil.parent.remove;
                        pyComponent._anvil.parent.remove = () => {
                            if (celt) {
                                celt.remove();
                            }
                            return rmFn();
                        };
                        return Sk.builtin.none.none$;
                    }
                );
            });

            $loc["clear"] = new Sk.builtin.func(function clear(self) {
                const ret = PyDefUtils.pyCallOrSuspend(pyModule["Container"].prototype.clear, [self]);

                self._anvil.element.empty();
                self._anvil.gridComponents = [];
                self._anvil.rows = {};

                return ret;
            });
        },
    });

};

/*!defClass(anvil,GridPanel,Container)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - Child layout props: full_width_row, row_background
 *  - Event groups: universal
 *  - Methods: add_component, clear
 *
 */
