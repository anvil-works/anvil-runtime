"use strict";

var PyDefUtils = require("PyDefUtils");

/**
id: datagrid
docs_url: /docs/client/components/data-grids
title: DataGrid
tooltip: Learn more about DataGrid
description: |

  ```python
  grid = DataGrid()

  ```
  The DataGrid component is great for displaying tabular data from any source. You can configure it completely by dragging and dropping into the designer from the [Toolbox](#toolbox), or you can create one in code.

  ```python
  grid.columns = [
    { "id": "A", "title": "Name", "data_key": "name" },
    { "id": "B", "title": "Address", "data_key": "address" },
  ]
  ```

  To configure DataGrid columns, use the [Property Table](#property_table), or create columns manually in code, as in the example on the right.

  Grid columns have a `data_key`, which is used by DataRowPanels to control automatic display of data. They also have a unique `id` (any string of letters and numbers), and optionally a `title` to configure automatic column headings.

  ```python
    self.data_grid_1.columns[0]['width'] = 500
    self.data_grid_1.columns = self.data_grid_1.columns
  ```

  Data Grid columns are updated when the `columns` attribute itself is set. The example on the right shows how to modify a column width in code. Once the width has been changed, the second line triggers the update of the Data Grid on the page.

  ```python
  data = [
    {"name": "Alice", "address": "1 Road Street"},
    {"name": "Bob", "address": "2 City Town"}
  ]

  for person in data:
    row = DataRowPanel(item=person)
    grid.add_component(row)
  ```
  Once you've created columns, add Data Rows using the [DataRowPanel](#datarowpanel) container or a RepeatingPanel.

  By default, the DataRowPanel component will automatically display data from its `item` property, based on the `data_key` property of each column. This is done with square-bracket lookup (ie `item[data_key]`), which makes it easy to use `dict`s or [Data Table rows](#data_tables).

  ```python
    for person in data:
      row = DataRowPanel(item=person)
      row.add_component(TextBox(text=person['name']), column="A")
      grid.add_component(row)
    
  ```

  You can add components to particular columns of the DataRowPanel by specifying the column's unique id as the `column=` argument to `add_component`, as in the final example.

  Data Grids are paginated by default, meaning they will only display some of their rows at one time. Use the page controls in the bottom right of the component to navigate between pages of data. Edit the `rows_per_page` property to adjust how many rows to display at once. Setting it to `0` or `None` will disable pagination and display all rows.

  Child [`DataRowPanels`](#datarowpanel) can be set to 'pinned' in the "Container Properties" section of their Property Table, or from code by passing `pinned=True` to `add_component()` when adding them to the DataGrid. This will cause them to be displayed on all pages of data, and is useful for headers or summary rows.

  Learn more about Data Grids in our [Data Grid Tutorials](/blog/data-grids)
*/

module.exports = function(pyModule) {

    let updateColStyles = (self, cols) => {
        let style = self._anvil.styleSheet;

        while(style.cssRules.length > 0) {
            style.deleteRule(0);
        }
        for (let col of cols || []) {
            let rule = `.data-row-col[data-grid-id="${self._anvil.dataGridId}"][data-grid-col-id="${col.id}"] {`;

            if (col.width)
                rule += `width: ${col.width}px; flex-grow: 0;`;

            if (col.expand === true) {
                rule += `flex-grow: 1;`;
            } else if (col.expand) {
                rule += `flex-grow: ${col.expand};`;
            }

            style.insertRule(rule+"}",0);
        }

    }

    let updateColumns = (self, element) => {
        let cols = self._anvil.getPropJS("columns");

        self._anvil.updateColStyles(cols);

        if (self._inDesigner && self._anvil.updateConfigHeader) {
            self._anvil.updateConfigHeader();
        }

        element.find(".anvil-data-row-panel:not(.auto-grid-header)")
            .map((_,e) => $(e).data("anvilPyComponent"))
            .each((_,c) => c._anvil.updateColumns());

        let h = element.find(".auto-grid-header").map((_,e) => $(e).data("anvilPyComponent"));
        if (self._anvil.getPropJS("auto_header")) {

            let headerData = {};
            for (let c of cols || []) {
                headerData[c.id] = c.title;
            }

            if (h.length == 0) {
                h = Sk.misceval.call(pyModule["DataRowPanel"], undefined, undefined, [
                    Sk.ffi.remapToPy("item"), Sk.ffi.remapToPy(headerData),
                    Sk.ffi.remapToPy("bold"), Sk.ffi.remapToPy(true),
                ]);
                Sk.misceval.call(self.tp$getattr(new Sk.builtin.str("add_component")), undefined, undefined, [Sk.ffi.remapToPy("index"), Sk.ffi.remapToPy(0)], h);
                h._anvil.element.addClass("no-hit auto-grid-header").removeClass("hide-while-paginating");
            } else {
                h[0].tp$setattr(new Sk.builtin.str("item"), Sk.ffi.remapToPy(headerData));
            }
        } else if (h.length > 0) {
            Sk.misceval.callsim(h[0].tp$getattr(new Sk.builtin.str("remove_from_parent")));
        }

        //self._anvil.paginate();
    }

    // self._anvil.pagination = { startAfter: object, rowQuota: number}
    let paginate = (self, updatedChild=null) => {
        if (self._anvil.pagination) {
            self._anvil.childPanel.css("min-height", self._anvil.childPanel.height() + "px");
            self._anvil.element.addClass("paginating");

            let childIdx = -1;
            let rowQuotaForChildren = self._anvil.pagination.rowQuota
            if (updatedChild && updatedChild._anvil.pagination) {
                childIdx = self._anvil.components.findIndex(c => c.component == updatedChild);
                rowQuotaForChildren = self._anvil.lastChildPagination.reduce((remaining, child, idx) => (child && idx < childIdx) ? remaining - child[0] : remaining, self._anvil.pagination.rowQuota);
                rowQuotaForChildren -= updatedChild._anvil.pagination.rowsDisplayed;

                let oldChildRowCount = self._anvil.lastChildPagination[childIdx] && self._anvil.lastChildPagination[childIdx][0];
                self._anvil.lastChildPagination[childIdx] = [updatedChild._anvil.pagination.rowsDisplayed, updatedChild._anvil.pagination.stoppedAt, updatedChild._anvil.pagination.done];

                if (self._anvil.pagination.startAfter && self._anvil.pagination.startAfter[0] == childIdx) {
                    // We currently start after this component. Update our idea of where *it* starts.
                    self._anvil.pagination.startAfter[1] = updatedChild._anvil.pagination.startAfter;
                }
            }

            return Sk.misceval.chain(PyDefUtils.repaginateChildren(self, childIdx+1, self._anvil.pagination.startAfter, rowQuotaForChildren),
                ([rows, stoppedAt, done]) => {

                    if (PyDefUtils.logPagination) console.log("DataGrid displayed", rows, "rows.", done ? "Done" : "Interrupted", "at", stoppedAt, "Pagination results:", self._anvil.lastChildPagination);
                    if (PyDefUtils.logPagination) console.groupEnd();

                    self._anvil.pagination.rowsDisplayed = rows;
                    self._anvil.pagination.stoppedAt = stoppedAt;
                    self._anvil.pagination.done = done;

                    return Sk.misceval.chain(undefined,
                        () => {
                            if (self._anvil.paginatorPages) {
                                if (done == "INVALID") {
                                    self._anvil.repaginating = false; // HACK: Allow recursive call to previous_page. Ew.
                                    return Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("previous_page")));
                                } else {
                                    self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1].rowsDisplayed = rows;
                                    self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1].stoppedAt = stoppedAt;
                                    self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1].done = done;
                                }
                            }
                        },
                        self._anvil.updatePaginationControls,
                        () => {
                            self._anvil.element.removeClass("paginating");
                            self._anvil.childPanel.css("min-height", "0px");
                        },
                        () => [rows, stoppedAt, done],
                    );
                }
            );
        } else {
            // We don't have any pagination state yet
            // TODO: Work out whether to draw everything or nothing, and whether to remember and do something on addedToPage. Or not.
            //debugger;
        }
    }

    let nextGridId = 0;

    pyModule["DataGrid"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(DataGrid)!1*/["layout", "containers", "appearance", "user data", "tooltip"]);

        /*!componentProp(DataGrid)!1*/
        properties.push({name: "columns", type: "dataGridColumns",
            pyVal: true,
            hidden: true,
            defaultValue: Sk.builtin.none.none$,
            //exampleValue: "XXX TODO",
            description: "A list of columns to display in this Data Grid.",
            set: (s,e,v) => updateColumns(s,e), // Gendoc blows up if we reference the function directly, so wrap it.
        });

        /*!componentProp(DataGrid)!1*/
        properties.push({name: "auto_header", type: "boolean",
            defaultValue: true,
            exampleValue: true,
            description: "Whether to display an automatic header at the top of this Data Grid.",
            set: (s,e,v) => updateColumns(s,e),
        });

        /*!componentProp(DataGrid)!1*/
        properties.push({name: "show_page_controls", type: "boolean",
            defaultValue: true,
            exampleValue: true,
            description: "Whether to display the next/previous page buttons.",
            set: (s,e,v) => e.find(">.data-grid-footer-panel>.pagination-buttons").toggle(v),
        });

        /*!componentProp(DataGrid)!1*/
        properties.push({name: "rows_per_page", type: "number",
            defaultValue: 20,
            exampleValue: 20,
            description: "The maximum number of rows to display at one time.",
            set: (s,e,v) => Sk.misceval.callsimOrSuspend(s.tp$getattr(new Sk.builtin.str('jump_to_first_page'))),
        });

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            
            self._anvil.element = self._anvil.element || $("<div>");
            self._anvil.element.data("anvil-py-component", self); // Do this early, so that early pagination will work.
            self._anvil.element.addClass("anvil-container anvil-data-grid anvil-paginator")

            self._anvil.childPanel = $('<div>').addClass("data-grid-child-panel");
            let footerPanel = $('<div>').addClass("data-grid-footer-panel");
            self._anvil.footerSlot = $('<div>').addClass("footer-slot").appendTo(footerPanel);
            let paginationButtonsPanel = $('<div>').addClass("pagination-buttons").appendTo(footerPanel);

            $("<a>").attr("href", "javascript:void(0)")
                     .append($(`<i class="fa fa-angle-double-left">`))
                     .addClass("first-page")
                     .addClass("disabled")
                     .on("click", () => PyDefUtils.asyncToPromise(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str('jump_to_first_page')))))   
                     .appendTo(paginationButtonsPanel);

            $("<a>").attr("href", "javascript:void(0)")
                     .append($(`<i class="fa fa-angle-left">`))
                     .addClass("previous-page")
                     .addClass("disabled")
                     .on("click", () => PyDefUtils.asyncToPromise(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str('previous_page')))))
                     .appendTo(paginationButtonsPanel);

            $("<a>").attr("href", "javascript:void(0)")
                     .append($(`<i class="fa fa-angle-right">`))
                     .addClass("next-page")
                     .addClass("disabled")
                     .on("click", () => PyDefUtils.asyncToPromise(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str('next_page')))))
                     .appendTo(paginationButtonsPanel);

            $("<a>").attr("href", "javascript:void(0)")
                     .append($(`<i class="fa fa-angle-double-right">`))
                     .addClass("last-page")
                     .addClass("disabled")
                     .on("click", () => PyDefUtils.asyncToPromise(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str('jump_to_last_page')))))
                     .appendTo(paginationButtonsPanel);

            self._anvil.element.append(self._anvil.childPanel);
            self._anvil.element.append(footerPanel);

            self._anvil.layoutPropTypes = [{
                name: "pinned",
                type: "boolean",
                description: "Whether this component should show on every page of the grid",
                defaultValue: false,
                important: true,
                priority: 0,
            }];

            self._anvil.dataGridId = nextGridId++;

            let s = $(`style[anvil-data-grid-id=${self._anvil.dataGridId}]`)
            if (s.length == 0) {
                s = $("<style/>").attr("anvil-data-grid-id", self._anvil.dataGridId).appendTo($("head"));
            }
            self._anvil.styleSheet = s[0].sheet;
            self._anvil.updateColStyles = updateColStyles.bind(self, self);

            self._anvil.paginate = paginate.bind(self, self);

            return Sk.misceval.callsimOrSuspend(pyModule["Paginator"].tp$getattr(new Sk.builtin.str("__init__")), self);

        },pyModule, $loc, properties,PyDefUtils.assembleGroupEvents("data grid", /*!componentEvents(DataGrid)!1*/["universal"]), pyModule["Container"]);


        /*!defMethod(_,component,[index=None],[pinned=False])!2*/ "Add a component to this DataGrid, in the 'index'th position. If 'index' is not specified, adds to the bottom."
        $loc["add_component"] = new PyDefUtils.funcWithKwargs(function(kwargs, self, component) {
            if (!component || !component._anvil) { throw new Sk.builtin.Exception("Argument to add_component() must be a component"); }
            return Sk.misceval.chain(undefined,
                () => {
                    if (component._anvil.metadata.invisible) { return; }

                    var celt = component._anvil.element;

                    celt.toggleClass("hide-while-paginating", !kwargs["pinned"])

                    if (typeof(kwargs["index"]) == "number") {

                        var elts = self._anvil.childPanel.children();
                        if (kwargs["index"] < elts.length) {
                            celt.insertBefore(elts[kwargs["index"]]);
                            return;
                            // else fall through and insert at the end
                        }
                    }
                    if (kwargs["slot"] == "footer") {
                        self._anvil.footerSlot.append(celt);
                    } else {
                        self._anvil.childPanel.append(celt);
                    }
                },
                () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs),
                () => {
                    // Now that we've added it to our components array, move it to the right position.
                    if (typeof(kwargs["index"]) == "number") {
                        var c = self._anvil.components.pop(); // pop off this new component (pushed on by super.add_component())
                        self._anvil.components.splice(kwargs["index"], 0, c);
                    }
                },
                // TODO: Repaginate on remove too. See DataRowPanel.
                () => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("jump_to_first_page")))
            );
        });

        // This shares an annoying amount of code with Container.js
        // (apart from the conditional slicing off of the automatic header)
        $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity(function (self) {
            let v = [];
            for (let n in self._anvil.props) {
                v.push(new Sk.builtin.str(n), self._anvil.props[n]);
            }
            let d = new Sk.builtin.dict(v);
            let components = self._anvil.components;
            if (self._anvil.getPropJS("auto_header")) {
                components = components.slice(1);
            }
            components = components.map(
                (c) => new Sk.builtin.tuple([c.component, Sk.ffi.remapToPy(c.layoutProperties)])
            );
            d.mp$ass_subscript(new Sk.builtin.str("_components"), new Sk.builtin.list(components));
            return d;
        });

        // Gendoc can't handle multiple inheritance, which is why we're defining these here.

        /*!defMethod(_)!2*/ "Jump to the last page of this DataGrid" ["jump_to_last_page"]
        /*!defMethod(_)!2*/ "Jump to the first page of this DataGrid" ["jump_to_first_page"]
        /*!defMethod(_)!2*/ "Jump to the next page of this DataGrid" ["next_page"]
        /*!defMethod(_)!2*/ "Jump to the previous page of this DataGrid" ["previous_page"]
        /*!defMethod(_)!2*/ "Get the current page number of this DataGrid" ["get_page"]

    }, /*!defClass(anvil,DataGrid,Container)!*/ "DataGrid", [pyModule["Container"], pyModule["Paginator"]]);

};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - Event groups: universal
 *  - Methods: add_component
 *
 */
