"use strict";

var PyDefUtils = require("PyDefUtils");
import { validateChild } from "./Container";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { isInvisibleComponent } from "./helpers";

/*#
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

    const { isTrue } = Sk.misceval;

    let nextGridId = 0;


    pyModule["DataGrid"] = PyDefUtils.mkComponentCls(pyModule, "DataGrid", {
        base: pyModule["Paginator"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(DataGrid)!1*/ ["layout", "layout_margin", "containers", "appearance", "user data", "tooltip"], {
            columns: /*!componentProp(DataGrid)!1*/ {
                name: "columns",
                type: "dataGridColumns",
                pyVal: true,
                hidden: true,
                defaultValue: Sk.builtin.none.none$,
                //exampleValue: "XXX TODO",
                description: "A list of columns to display in this Data Grid.",
                set(s, e, v) {
                    s._anvil.jsCols = Sk.ffi.toJs(v);
                    updateColumns(s, e);
                    // Gendoc blows up if we reference the function directly, so wrap it.
                },
                getJS(s, e) {
                    return s._anvil.jsCols;
                },
            },

            auto_header: /*!componentProp(DataGrid)!1*/ {
                name: "auto_header",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                exampleValue: true,
                description: "Whether to display an automatic header at the top of this Data Grid.",
                set(s, e, v) {
                    updateColumns(s, e);
                    s._anvil.onUpdateAutoHeader?.();
                },
            },

            show_page_controls: /*!componentProp(DataGrid)!1*/ {
                name: "show_page_controls",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                exampleValue: true,
                description: "Whether to display the next/previous page buttons.",
                set: (s, e, v) => (s._anvil.elements.paginationButtons.style.display = isTrue(v) ? "block" : "none"),
            },
            rows_per_page: /*!componentProp(DataGrid)!1*/ {
                name: "rows_per_page",
                type: "number",
                defaultValue: new Sk.builtin.int_(20),
                pyVal: true,
                exampleValue: 20,
                description: "The maximum number of rows to display at one time.",
                set: (s, e, v) => PyDefUtils.pyCallOrSuspend(s.tp$getattr(new Sk.builtin.str("jump_to_first_page"))),
            },
            wrap_on: /*!componentProp(DataGrid)!1*/ {
                name: "wrap_on",
                type: "enum",
                options: ["never", "mobile", "tablet"],
                description: "The largest display on which to wrap columns in this DataGrid",
                defaultValue: new Sk.builtin.str("never"),
                pyVal: true,
                important: true,
                set(self, e, v) {
                    v = v.toString();
                    const prefix = getCssPrefix();
                    const domNode = self._anvil.domNode;
                    domNode.classList.remove(prefix + "wrap-never", prefix + "wrap-tablet", prefix + "wrap-mobile");
                    domNode.classList.add(prefix + "wrap-" + v);
                },
            },

        }),

        events: PyDefUtils.assembleGroupEvents("data grid", /*!componentEvents(DataGrid)!1*/ ["universal"]),

        layouts: [
            {
                name: "pinned",
                type: "boolean",
                description: "Whether this component should show on every page of the grid",
                defaultValue: false,
                important: true,
                priority: 0,
            },
        ],

        element: ({ show_page_controls, wrap_on, ...props }) => {
            const prefix = getCssPrefix();
            return (
                <PyDefUtils.OuterElement
                    className={`anvil-container anvil-data-grid anvil-paginator ${prefix}wrap-${wrap_on}`}
                    {...props}>
                    <div refName="childPanel" className={`${prefix}data-grid-child-panel`}></div>
                    <div refName="footerPanel" className={`${prefix}data-grid-footer-panel`}>
                        <div refName="footerSlot" className={`${prefix}footer-slot`}></div>
                        <div
                            refName="paginationButtons"
                            className={`${prefix}pagination-buttons`}
                            style={"display:" + (isTrue(show_page_controls) ? "block" : "none") + ";"}>
                            <a refName="firstPage" href="javascript:void(0)" className={`${prefix}first-page ${prefix}disabled`}>
                                <i refName="iconFirst" className="fa fa-angle-double-left" />
                            </a>
                            <a refName="prevPage" href="javascript:void(0)" className={`${prefix}previous-page ${prefix}disabled`}>
                                <i refName="iconPrev" className="fa fa-angle-left" />
                            </a>
                            <a refName="nextPage" href="javascript:void(0)" className={`${prefix}next-page ${prefix}disabled`}>
                                <i refName="iconNext" className="fa fa-angle-right" />
                            </a>
                            <a refName="lastPage" href="javascript:void(0)" className={`${prefix}last-page ${prefix}disabled`}>
                                <i refName="iconLast" className="fa fa-angle-double-right" />
                            </a>
                        </div>
                    </div>
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["Paginator"], (self) => {
                self._anvil.element.data("anvil-py-component", self); // Do this early, so that early pagination will work.
                self._anvil.childPanel = $(self._anvil.elements.childPanel);
                self._anvil.footerSlot = $(self._anvil.elements.footerSlot);
                self._anvil.dataGridId = nextGridId++;
                self._anvil.dataGrid = self;

                let s = $(`style[anvil-data-grid-id=${self._anvil.dataGridId}]`);
                if (s.length === 0) {
                    s = $("<style />").attr("anvil-data-grid-id", self._anvil.dataGridId).appendTo($("head"));
                }
                self._anvil.styleSheet = s[0].sheet;
                self._anvil.updateColStyles = updateColStyles.bind(self, self);
                self._anvil.paginate = paginate.bind(self, self);

                $(self._anvil.elements.firstPage).on("click", () =>
                    PyDefUtils.asyncToPromise(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("jump_to_first_page"))))
                );
                $(self._anvil.elements.prevPage).on("click", () =>
                    PyDefUtils.asyncToPromise(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("previous_page"))))
                );
                $(self._anvil.elements.nextPage).on("click", () =>
                    PyDefUtils.asyncToPromise(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("next_page"))))
                );
                $(self._anvil.elements.lastPage).on("click", () =>
                    PyDefUtils.asyncToPromise(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("jump_to_last_page"))))
                );

                return self._anvil.setProp("columns", self._anvil.props["columns"]);
            });


            /*!defMethod(_,component,[index=None],[pinned=False])!2*/ ("Add a component to this DataGrid, in the 'index'th position. If 'index' is not specified, adds to the bottom.");
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function add_component(kwargs, self, component) {
                validateChild(component);
                
                const { index, pinned, slot } = kwargs;

                return Sk.misceval.chain(
                    component.anvil$hooks.setupDom(),
                    (celt) => {
                        if (isInvisibleComponent(component)) {
                            return pyModule["ClassicContainer"]._doAddComponent(self, component);
                        }

                        const childPanel = self._anvil.elements.childPanel;

                        if (component._anvil) {
                            // TODO: How would you do this in the new world?
                            component._anvil.dataGrid = self;
                        }
                        // celt.classList.toggle(prefix + "hide-while-paginating", !pinned);

                        const elts = self._anvil.elements.childPanel.children;
                        if (slot === "footer") {
                            self._anvil.elements.footerSlot.appendChild(celt);
                        } else if (typeof index === "number" && index < elts.length) {
                            childPanel.insertBefore(celt, elts[index]);
                        } else {
                            childPanel.appendChild(celt);
                        }
                        return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs, {
                            afterRemoval() {
                                if (component._anvil) {
                                    delete component._anvil.dataGrid;
                                }
                                return PyDefUtils.pyCallOrSuspend(self.tp$getattr(new Sk.builtin.str("repaginate")));
                            },
                        });
                    },
                    () => PyDefUtils.pyCallOrSuspend(self.tp$getattr(new Sk.builtin.str("jump_to_first_page")))
                );
            });

            // This shares an annoying amount of code with ClassicContainer.js
            // (apart from the conditional slicing off of the automatic header)
            $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity(function (self) {
                const v = [];
                for (let n in self._anvil.props) {
                    v.push(new Sk.builtin.str(n), self._anvil.props[n]);
                }
                const d = new Sk.builtin.dict(v);
                let components = self._anvil.components;
                if (self._anvil.getPropJS("auto_header")) {
                    components = components.slice(1);
                }
                components = components.map((c) => new Sk.builtin.tuple([c.component, Sk.ffi.remapToPy(c.layoutProperties)]));
                d.mp$ass_subscript(new Sk.builtin.str("$_components"), new Sk.builtin.list(components));
                return d;
            });

            // Gendoc can't handle multiple inheritance, which is why we're defining these here.

            /*!defMethod(_)!2*/ "Jump to the last page of this DataGrid"["jump_to_last_page"];
            /*!defMethod(_)!2*/ "Jump to the first page of this DataGrid"["jump_to_first_page"];
            /*!defMethod(_)!2*/ "Jump to the next page of this DataGrid"["next_page"];
            /*!defMethod(_)!2*/ "Jump to the previous page of this DataGrid"["previous_page"];
            /*!defMethod(_)!2*/ "Get the current page number of this DataGrid"["get_page"];
            /*!defMethod(_, page)!2*/ "Set the page number of this DataGrid. The page number must be positive."["set_page"];
        },
    });

    let updateColStyles = (self, cols) => {
        const prefix = getCssPrefix();
        let style = self._anvil.styleSheet;

        while(style.cssRules.length > 0) {
            style.deleteRule(0);
        }
        for (let col of cols || []) {
            let rule = `.${prefix}data-row-col[data-grid-id="${self._anvil.dataGridId}"][data-grid-col-id="${col.id}"] {`;

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
        const prefix = getCssPrefix();

        self._anvil.updateColStyles(cols);

        if (ANVIL_IN_DESIGNER && self._anvil.updateConfigHeader) {
            self._anvil.updateConfigHeader();
        }

        element.find(`.anvil-data-row-panel:not(${prefix}auto-grid-header)`)
            .map((_,e) => $(e).data("anvilPyComponent"))
            .each((_,c) => c._anvil.updateColumns(true));

        let h = element.find(`.${prefix}auto-grid-header`).map((_,e) => $(e).data("anvilPyComponent"));
        if (isTrue(self._anvil.getProp("auto_header"))) {
            let headerData = {};
            for (let c of cols || []) {
                headerData[c.id] = c.title;
            }

            if (h.length === 0) {
                h = PyDefUtils.pyCall(pyModule["DataRowPanel"], [], ["bold", Sk.builtin.bool.true$]);
                h._anvil.autoGridHeader = true;
                h._anvil.domNode.classList.add("anvil-designer-no-hit", `${prefix}auto-grid-header`);
                // h._anvil.domNode.classList.remove(prefix + "hide-while-paginating");
                PyDefUtils.pyCall(self.tp$getattr(new Sk.builtin.str("add_component")), [h], ["index", new Sk.builtin.int_(0)])
            } else {
                h = h[0];
            }
            h.tp$setattr(new Sk.builtin.str("item"), Sk.ffi.remapToPy(headerData));
        } else if (h.length > 0) {
            Sk.misceval.callsim(h[0].tp$getattr(new Sk.builtin.str("remove_from_parent")));
        }

        //self._anvil.paginate();
        self._anvil.afterUpdateColumns?.();
    }

    // self._anvil.pagination = { startAfter: object, rowQuota: number}
    let paginate = (self, updatedChild=null) => {
        if (self._anvil.pagination) {


            let childIdx = -1;
            let rowQuotaForChildren = self._anvil.pagination.rowQuota
            if (updatedChild && updatedChild._anvil.pagination) {
                childIdx = self._anvil.components.findIndex(c => c.component === updatedChild);
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

                    if (PyDefUtils.logPagination) { 
                        console.log("DataGrid displayed", rows, "rows.", done ? "Done" : "Interrupted", "at", stoppedAt, "Pagination results:", self._anvil.lastChildPagination);
                        console.groupEnd();
                    }

                    self._anvil.pagination.rowsDisplayed = rows;
                    self._anvil.pagination.stoppedAt = stoppedAt;
                    self._anvil.pagination.done = done;

                    return Sk.misceval.chain(undefined,
                        () => {
                            if (self._anvil.paginatorPages) {
                                if (done === "INVALID") {
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

};

/*!defClass(anvil,DataGrid,Container)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - Event groups: universal
 *  - Methods: add_component
 *
 */



