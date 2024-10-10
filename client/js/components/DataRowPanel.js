"use strict";

var PyDefUtils = require("PyDefUtils");
const {pyNone, pyStr, pyBool, pyCall} = require("@Sk");
const { validateChild } = require("./Container");
const { getCssPrefix } = require("@runtime/runner/legacy-features");
const { notifyVisibilityChange } = require("./Component");

/*#
id: datarowpanel
docs_url: /docs/client/components/containers#datarowpanel
title: DataRowPanel
tooltip: Learn more about DataRowPanel
description: |
  The DataRowPanel is a special Anvil container, designed to work with the [DataGrid](#datagrid) component. In particular, DataRowPanels understand the column-based layout of their parent DataGrids, so they can arrange their child components appropriately. There are two main features of DataRowPanels that make them different to other Anvil containers:

  \* DataRowPanels have a 'slot' for each column of the table they are in, meaning other Anvil components can be dropped into particular columns. They also behave like [LinearPanels](#linearpanel), in that you can drop components below the column-specific slots to have them take up the full width of the table. This is useful for section headers and other advanced layouts.
  \* DataRowPanels can automatically display data from their `item` property, based on the columns of their DataGrid. DataGrid columns each have a `data_key`, which is used to get the data from the `item` of each DataRowPanel.

  For more information, see the [documentation for the `DataGrid` component](#datagrid), or our [`DataGrid` Tutorials](/blog/data-grids)
*/
module.exports = function(pyModule) {

    const { isTrue } = Sk.misceval;
    const str_add_component = new Sk.builtin.str("add_component");
    const str_remove_from_parent = new Sk.builtin.str("remove_from_parent");

    pyModule["DataRowPanel"] = PyDefUtils.mkComponentCls(pyModule, "DataRowPanel", {
        base: pyModule["ClassicContainer"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(DataRowPanel)!2*/ ["text", "layout", "layout_margin", "containers", "appearance", "tooltip", "user data"], {
            visible: {
                set(s, e, v) {
                    return updateVisible(s);
                },
            },
            bold: {
                important: true,
                priority: 10,
            },
            spacing_above: {
                defaultValue: new Sk.builtin.str("none"),
            },
            spacing_below: {
                defaultValue: new Sk.builtin.str("none"),
            },
            text: {
                omit: true,
            },
            item: /*!componentProp(DataRowPanel)!1*/ {
                name: "item",
                type: "object",
                defaultValue: Sk.builtin.none.none$,
                pyVal: true,
                exampleValue: "",
                description: "The data to display in this row by default.",
                set(self, e, v) {
                    return self._anvil.updateColumns(true);
                },
            },
            auto_display_data: /*!componentProp(DataRowPanel)!1*/ {
                name: "auto_display_data",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                exampleValue: true,
                description: "Whether to automatically display data in this row.",
                set(s, e, v) {
                    return s._anvil.updateColumns(true);
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents("data row panel", /*!componentEvents(DataRowPanel)!1*/ ["universal"]),

        layouts: [
            {
                name: "column",
                type: "string",
                description: "The id of the column where this component will be placed",
                defaultValue: "",
                important: true,
                priority: 0,
            },
        ],

        element: (props) => <PyDefUtils.OuterElement className="anvil-container anvil-data-row-panel" {...props} />,

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicContainer"], (self) => {
                self._anvil.pageEvents = {
                    add() {
                        // TODO: Cope with not finding a parent data grid.
                        if (self._anvil.updateDataGridId === true) {
                            self._anvil.updateDataGridId = false;
                            return self._anvil.updateColumns(true);
                        }
                    },
                    remove() {
                        if (!self._anvil.parent) {
                            self._anvil.dataGrid = undefined;
                            self._anvil.updateDataGridId = true;
                        }
                    },
                    show() {},
                };
                self._anvil.updateColData = updateColData.bind(self, self);
                self._anvil.updateColumns = updateColumns.bind(self, self);
                self._anvil.getColumn = getColumn.bind(self, self);

                self._anvil.dataGrid = undefined;
                self._anvil.updateDataGridId = true;
                self._anvil.cols = {};
                self._anvil.paginate = paginate.bind(self, self);
                self._anvil.hideOnThisPage = false;
                self._anvil.cachedPagination = {}; // previous argument to pagination, previous response

                self._anvil.onRefreshDataBindings = () => {
                    return self._anvil.updateColumns(true);
                };
                return self._anvil.updateColumns();
            });

            // TODO: Add properties for orientation. Vertical for now.

            /*!defMethod(_,component,[column=None])!2*/ "Add a component to the specified column of this DataRowPanel. TODO: If 'column' is not specified, adds the component full-width.";
            $loc["add_component"] = new PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                validateChild(component);

                const colId = kwargs.column;
                return Sk.misceval.chain(
                    component.anvil$hooks.setupDom(),
                    (childElt) => {
                        const { colEl, autoRow } = self._anvil.getColumn(colId);
                        if (autoRow !== null && autoRow !== component) {
                            PyDefUtils.pyCall(autoRow.tp$getattr(str_remove_from_parent));
                        }
                        colEl.appendChild(childElt);
                        if (self._anvil.dataGrid !== undefined) {
                            component._anvil.dataGrid = self._anvil.dataGrid;
                        }
                        return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs,
                            {detachDom: () => {
                                childElt.parentElement?.removeChild?.(childElt);
                                if (!component._anvil?.isAutoRow) {
                                    self._anvil.updateColumns();
                                }
                            }});
                    },
                    () => {
                        if (component._anvil?.paginate) {
                            // We only need to repaginate ourselves if the component we just added understands pagination.
                            // if we have a child that can paginate we can't cache the pagination result!
                            Object.defineProperty(self._anvil, "cachedPagination", {
                                get() {
                                    return {};
                                },
                                set() {}
                            });
                            self._anvil.paginate(component);
                        }
                        return Sk.builtin.none.none$;
                    }
                );
            });
        },
    });


    const updateVisible = self => {
        const d = self._anvil.domNode;
        const v = isTrue(self._anvil.getProp("visible")) && !self._anvil.hideOnThisPage;
        const prefix = getCssPrefix();
        d.classList.toggle(prefix + "visible-false", !v);
        return notifyVisibilityChange(self, v);
    };

    const updateColData = (self, colSpec, column) => {

        const existingAutoComponent = column.autoRow;
        if (existingAutoComponent) {
            PyDefUtils.pyCall(existingAutoComponent.tp$getattr(str_remove_from_parent));
            column.autoRow = null;
        }

        const data = self._anvil.getProp("item");
        const displayData = isTrue(self._anvil.getProp("auto_display_data"));

        if (
            !displayData ||
            data === Sk.builtin.none.none$ ||
            !colSpec ||
            column.colEl.children.length !== 0
        ) {
            return;
        }

        const dataKey = self._anvil.autoGridHeader ? String(colSpec.id) : colSpec.data_key || colSpec.id;

        return Sk.misceval.chain(
            Sk.misceval.tryCatch(
                () => Sk.abstr.objectGetItem(data, Sk.ffi.remapToPy(dataKey), true),
                () => undefined
            ),
            (val) => {
                if (val !== undefined) {
                    const prefix = getCssPrefix();
                    const valComponent = PyDefUtils.pyCall(pyModule["Label"], [], ["text", val]);
                    valComponent._anvil.domNode.classList.add(prefix + "auto-row-value");
                    valComponent._anvil.isAutoRow = true;
                    column.autoRow = valComponent;
                    PyDefUtils.pyCall(
                        self.tp$getattr(str_add_component),
                        [valComponent],
                        ["column", Sk.ffi.remapToPy(colSpec.id)]
                    );
                }
            },
        );
    };

    const getDataGridId = (self) => {
        const dataGrid =  getDataGrid(self);
        return dataGrid && dataGrid._anvil.dataGridId;
    };

    const getDataGrid = (self) => {
        let dataGrid = self._anvil.dataGrid;
        if (dataGrid === undefined) {
            const parent = self._anvil.parent;
            dataGrid =
                (parent && parent.pyObj._anvil?.dataGrid) ||
                ((ANVIL_IN_DESIGNER || parent) &&
                    self._anvil.element.closest(".anvil-data-grid").data("anvilPyComponent"));
            if (dataGrid) {
                self._anvil.dataGrid = dataGrid;
            } else {
                dataGrid = undefined;
            }
        } 
        return dataGrid;
    };

    const DataRowCol = ({ dataGridId, colId }) => {
        dataGridId = dataGridId === undefined ? "" : dataGridId;
        const prefix = getCssPrefix();
        return <div className={`${prefix}data-row-col`} data-grid-col-id={colId} data-grid-id={dataGridId} />;
    };

    const getColumn = (self, colId) => {
        colId ??= null;
        let col = self._anvil.cols[colId];
        if (col === undefined) {
            const dataGridId = getDataGridId(self);
            const [colEl] = <DataRowCol colId={colId} dataGridId={dataGridId} />;
            self._anvil.domNode.appendChild(colEl);
            if (dataGridId === undefined) {
                self._anvil.updateDataGridId = true;
            }
            if (colId === null) {
                colEl.classList.add(getCssPrefix() + "extra-column");
            }
            col =  { colEl, autoRow: null , dataGridId};
            self._anvil.cols[colId] = col;
        } else if (col.dataGridId === undefined) {
            const dataGridId = getDataGridId(self);
            col.dataGridId = dataGridId;
            col.colEl.setAttribute("data-grid-id", dataGridId);
        }
        return col;
    };


    const updateColumns = (self, updateData) => {
        const dataGrid = getDataGrid(self);
        if (dataGrid === undefined) {
            return;
        }

        const dataGridCols = dataGrid._anvil.getPropJS("columns");

        if (!dataGridCols) {
            return;
        }

        if (updateData) {
            self._anvil.cachedPagination = {};
        }


        const fns = [() => PyDefUtils.raiseEventOrSuspend({data_grid: dataGrid || pyNone}, self, "x-data-row-panel-update-columns")];

        const validIds = new Set();
        const dataRowCols = self._anvil.cols;
        const dataRowEl = self._anvil.domNode;
        const extraCols = {...dataRowCols};

        // columns ordered as they currently appear in the DOM
        const children = dataRowEl.children;
        const prefix = getCssPrefix();
        
        dataGridCols.forEach((col, i) => {
            const id = col.id;
            validIds.add(String(id));
            const currentEl = children[i];
            const column = self._anvil.getColumn(id); // find or create a new column with this id
            const colEl = column.colEl;
            const updateEl = currentEl !== colEl;
            if (updateEl) {
                // This column is in the wrong place. Swap in the right one
                dataRowEl.insertBefore(colEl, currentEl);
            } 
            if (ANVIL_IN_DESIGNER || updateData || updateEl) {
                if (column.extraCol) {
                    column.extraCol = false;
                    colEl.classList.remove(prefix + "extra-column");
                }
                fns.push(() => self._anvil.updateColData(col, column));
            }
        });

        fns.push(() => {
            const fns = [];
            Object.keys(extraCols).forEach((id) => {
                if (validIds.has(id)) {
                    return;
                }
                const column = extraCols[id];
                if (id !== "null" && column.autoRow !== null) {
                    column.colEl.remove();
                    delete dataRowCols[id];
                } else {
                    column.extraCol = true;
                    column.colEl.classList.add(prefix + "extra-column");
                    if (column.dataGridId === undefined) {
                        self._anvil.getColumn(id);
                    }
                    fns.push(() => self._anvil.updateColData(null, column));
                }
            });
            return Sk.misceval.chain(undefined, ...fns);
        });

        return Sk.misceval.chain(undefined, ...fns);
    };

    const paginate = (self, updatedChild = null) => {
        const MARKER = "SHOWN_SELF_ONLY";
        return Sk.misceval.chain(
            undefined,
            () => {
                if (self._anvil.updateDataGridId === true && getDataGrid(self) !== undefined) {
                    self._anvil.updateDataGridId = false;
                    return self._anvil.updateColumns(true);
                }
            },
            () => {
                // If this element is the auto-header, it doesn't use up any quota.
                if (self._anvil.autoGridHeader) {
                    return [0, MARKER, true];
                }
                // If this element isn't visible, it doesn't use up any quota.
                if (!self._anvil.getPropJS("visible")) {
                    return [0, MARKER, true];
                }
                if (self._anvil.pagination) {
                    const quota = [self._anvil.pagination.startAfter, self._anvil.pagination.rowQuota];
                    const cached = self._anvil.cachedPagination[quota.toString()];
                    if (cached) {
                        return cached;
                    } else {
                        self._anvil.cachedPagination = {}; // reset the cache now;
                    }
                }
            },
            (cached) => {
                if (cached !== undefined) {
                    return cached;
                }
                if (self._anvil.pagination) {
                    if (PyDefUtils.logPagination) {
                        console.group(
                            "Repaginate DataRowPanel from",
                            self._anvil.pagination.startAfter,
                            ", displaying up to",
                            self._anvil.pagination.rowQuota,
                            "rows.",
                            self._anvil.domNode
                        );
                    }

                    const toHide = self._anvil.pagination.rowQuota <= 0;
                    if (toHide !== self._anvil.hideOnThisPage) {
                        self._anvil.hideOnThisPage = toHide;
                        updateVisible(self);
                    }

                    // Work out whether we need any row quota to display ourselves. We only need some if we're auto-displaying data or if we have any children that aren't DataRowPanels.
                    let rowsRequiredForSelf = 0;
                    if (self._anvil.getPropJS("auto_display_data")) {
                        rowsRequiredForSelf = 1;
                    } else {
                        for (const c of self._anvil.components || []) {
                            if (!Sk.builtin.isinstance(c.component, pyModule["DataRowPanel"]).v) {
                                rowsRequiredForSelf = 1;
                                break;
                            }
                        }
                    }

                    let childIdx = -1;
                    let rowQuotaForChildren = self._anvil.pagination.rowQuota - rowsRequiredForSelf;
                    if (updatedChild && updatedChild._anvil?.pagination) {
                        childIdx = self._anvil.components.findIndex((c) => c.component === updatedChild);
                        rowQuotaForChildren = self._anvil.lastChildPagination.reduce(
                            (remaining, child, idx) => (child && idx < childIdx ? remaining - child[0] : remaining),
                            rowQuotaForChildren
                        );
                        rowQuotaForChildren -= updatedChild._anvil.pagination.rowsDisplayed;

                        const oldChildRowCount = self._anvil.lastChildPagination[childIdx] && self._anvil.lastChildPagination[childIdx][0];
                        self._anvil.lastChildPagination[childIdx] = [
                            updatedChild._anvil.pagination.rowsDisplayed,
                            updatedChild._anvil.pagination.stoppedAt,
                            updatedChild._anvil.pagination.done,
                        ];

                        if (self._anvil.pagination.startAfter && self._anvil.pagination.startAfter[0] == childIdx) {
                            // We currently start after this component. Update our idea of where *it* starts.
                            self._anvil.pagination.startAfter[1] = updatedChild._anvil.pagination.startAfter;
                        }
                    }

                    return Sk.misceval.chain(
                        PyDefUtils.repaginateChildren(
                            self,
                            childIdx + 1,
                            self._anvil.pagination.startAfter == MARKER ? null : self._anvil.pagination.startAfter,
                            rowQuotaForChildren
                        ),
                        ([rows, stoppedAt, done]) => {
                            self._anvil.pagination.stoppedAt = stoppedAt;
                            self._anvil.pagination.done = done;

                            if (rows > 0) {
                                if (PyDefUtils.logPagination) {console.log("DataRowPanel displayed", rows, "rows.", done ? "Done" : "Interrupted", "at", stoppedAt);console.groupEnd();}

                                // We displayed some children, and ourselves.
                                // We're done if our children are done.
                                self._anvil.pagination.rowsDisplayed = rows + rowsRequiredForSelf;
                            } else if (self._anvil.pagination.rowQuota > 0) {
                                if (PyDefUtils.logPagination) {console.log("DataRowPanel displayed only itself.", done ? "Done." : "Interrupted.");console.groupEnd();}

                                // We didn't display any children, but we did have enough quota to display ourselves.
                                // We're done if our children are done.
                                self._anvil.pagination.rowsDisplayed = rowsRequiredForSelf;
                                self._anvil.pagination.stoppedAt = MARKER;
                            } else {
                                if (PyDefUtils.logPagination) {console.log("DataRowPanel hidden - no quota available");console.groupEnd();}

                                // We didn't display any children, and had no quota available anyway.
                                self._anvil.pagination.rowsDisplayed = 0;
                                self._anvil.pagination.stoppedAt = null;
                                self._anvil.pagination.done = false;
                            }

                            const parent = self._anvil.parent?.pyObj;
                            const quota = [self._anvil.pagination.startAfter, self._anvil.pagination.rowQuota];

                            if (updatedChild?._anvil?.pagination && parent?._anvil?.paginate) {
                                return Sk.misceval.chain(parent._anvil.paginate(self), () => {
                                    const ret = [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done];
                                    self._anvil.cachedPagination[quota.toString()] = ret;
                                    return ret;
                                });
                            } else {
                                const ret = [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done];
                                self._anvil.cachedPagination[quota.toString()] = ret;
                                return ret;
                            }
                        }
                    );
                } else {
                    // We don't have any pagination state yet
                    // TODO: Work out whether to draw everything or nothing, and whether to remember and do something on addedToPage. Or not.
                    return [0, null, true];
                }
            }
        );
    };


};

/*!defClass(anvil,DataRowPanel,Container)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - Event groups: universal
 *  - Methods: add_component
 *
 */
