import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap, s_add_component, s_remove_from_parent } from "@runtime/runner/py-util";
import {
    chainOrSuspend,
    isTrue,
    pyBool,
    pyCall,
    pyCallable,
    pyIsInstance,
    pyNone,
    pyObject,
    pyStr,
    toPy,
    tryCatchOrSuspend,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { ClassicComponentConstructor, getDomPyComponent } from "./ClassicComponent";
import { ClassicContainer } from "./ClassicContainer";
import { Component, notifyVisibilityChange } from "./Component";
import { validateChild } from "./Container";
import type { DataGrid } from "./DataGrid";
import { Done, PaginateFn } from "./Paginator";

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

interface ColumnState {
    colEl: HTMLElement;
    autoRow: Component | null;
    dataGridId?: number;
    extraCol?: boolean;
}

interface DataRowPanelAnvil extends Record<string, any> {
    elements: { root: HTMLElement };
    updateColumns: (updateData?: boolean) => any;
    getColumn: (colId: string | null | undefined) => ColumnState;
    dataGrid: DataGrid | undefined;
    updateDataGridId: boolean;
    cols: Record<string, ColumnState>;
    cachedPagination: Record<string, [number, any, Done]>;
    hideOnThisPage: boolean;
    onRefreshDataBindings: () => void;
    paginate: PaginateFn;
    pagination?: { startAfter: any; rowQuota: number; rowsDisplayed: number; stoppedAt: any; done: Done };
    autoGridHeader?: boolean;
    lastChildPagination: any[];
}

export interface DataRowPanel extends ClassicContainer<DataRowPanelAnvil> {}

const DataRowPanelFactory = (pyModule: PyModMap) => {
    const ClassicContainer = pyModule["ClassicContainer"] as ClassicComponentConstructor;

    pyModule["DataRowPanel"] = PyDefUtils.mkComponentCls<DataRowPanel>(pyModule, "DataRowPanel", {
        base: ClassicContainer,

        properties: PyDefUtils.assembleGroupProperties<DataRowPanel>(
            /*!componentProps(DataRowPanel)!2*/ [
                "text",
                "layout",
                "layout_margin",
                "containers",
                "appearance",
                "tooltip",
                "user data",
            ],
            {
                visible: {
                    pyVal: true,
                    set(s, e, v) {
                        return updateVisible(s);
                    },
                },
                bold: {
                    important: true,
                    priority: 10,
                },
                spacing_above: {
                    defaultValue: new pyStr("none"),
                },
                spacing_below: {
                    defaultValue: new pyStr("none"),
                },
                text: {
                    omit: true,
                },
                item: /*!componentProp(DataRowPanel)!1*/ {
                    name: "item",
                    type: "object",
                    defaultValue: pyNone,
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
                    defaultValue: pyBool.true$,
                    pyVal: true,
                    exampleValue: true,
                    description: "Whether to automatically display data in this row.",
                    set(s, e, v) {
                        return s._anvil.updateColumns(true);
                    },
                },
            }
        ),

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
            $loc["__new__"] = PyDefUtils.mkNew<DataRowPanel>(ClassicContainer, (self) => {
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
                self._anvil.lastChildPagination = [];

                self._anvil.onRefreshDataBindings = () => {
                    return self._anvil.updateColumns(true);
                };
                return self._anvil.updateColumns();
            });

            // TODO: Add properties for orientation. Vertical for now.

            /*!defMethod(_,component,[column=None])!2*/ ("Add a component to the specified column of this DataRowPanel. TODO: If 'column' is not specified, adds the component full-width.");
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function (
                kwargs: any,
                self: DataRowPanel,
                component: Component
            ) {
                validateChild(component);

                const colId = kwargs.column;
                return chainOrSuspend(
                    component.anvil$hooks.setupDom(),
                    (childElt) => {
                        const { colEl, autoRow } = self._anvil.getColumn(colId);
                        if (autoRow !== null && autoRow !== component) {
                            pyCall(autoRow.tp$getattr<pyCallable>(s_remove_from_parent));
                        }
                        colEl.appendChild(childElt);
                        if (self._anvil.dataGrid !== undefined) {
                            component._anvil.dataGrid = self._anvil.dataGrid;
                        }
                        return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs, {
                            detachDom: () => {
                                childElt.parentElement?.removeChild?.(childElt);
                                if (!component._anvil?.isAutoRow) {
                                    self._anvil.updateColumns();
                                }
                            },
                        });
                    },
                    () => {
                        if (component._anvil?.paginate) {
                            // We only need to repaginate ourselves if the component we just added understands pagination.
                            // if we have a child that can paginate we can't cache the pagination result!
                            Object.defineProperty(self._anvil, "cachedPagination", {
                                get() {
                                    return {};
                                },
                                set() {},
                            });
                            self._anvil.paginate(component);
                        }
                        return pyNone;
                    }
                );
            });
        },
    });

    const updateVisible = (self: DataRowPanel) => {
        const d = self._anvil.domNode;
        const v = isTrue(self._anvil.getProp("visible")) && !self._anvil.hideOnThisPage;
        const prefix = getCssPrefix();
        d.classList.toggle(prefix + "visible-false", !v);
        return notifyVisibilityChange(self, v);
    };

    const updateColData = (self: DataRowPanel, colSpec: any, column: ColumnState) => {
        const existingAutoComponent = column.autoRow;
        if (existingAutoComponent) {
            pyCall(existingAutoComponent.tp$getattr<pyCallable>(s_remove_from_parent));
            column.autoRow = null;
        }

        const data = self._anvil.getProp("item") as pyObject;
        const displayData = isTrue(self._anvil.getProp("auto_display_data"));

        if (!displayData || data === pyNone || !colSpec || column.colEl.children.length !== 0) {
            return;
        }

        const dataKey = self._anvil.autoGridHeader ? String(colSpec.id) : colSpec.data_key || colSpec.id;

        return chainOrSuspend(
            tryCatchOrSuspend(
                () => Sk.abstr.objectGetItem(data, toPy(dataKey), true),
                () => undefined
            ),
            (val) => {
                if (val !== undefined) {
                    const prefix = getCssPrefix();
                    const valComponent = pyCall<Component>(pyModule["Label"], [], ["text", val]);
                    valComponent._anvil.domNode.classList.add(prefix + "auto-row-value");
                    valComponent._anvil.isAutoRow = true;
                    column.autoRow = valComponent;
                    pyCall(
                        self.tp$getattr<pyCallable>(s_add_component),
                        [valComponent],
                        ["column", Sk.ffi.remapToPy(colSpec.id)]
                    );
                }
            }
        );
    };

    const getDataGridId = (self: DataRowPanel) => {
        const dataGrid = getDataGrid(self);
        return dataGrid && dataGrid._anvil.dataGridId;
    };

    const getDataGrid = (self: DataRowPanel) => {
        let dataGrid = self._anvil.dataGrid;
        if (dataGrid === undefined) {
            const parent = self._anvil.parent;
            const dataGridEl = self._anvil.domNode.closest(".anvil-data-grid") as any;
            dataGrid =
                (parent && parent.pyObj._anvil?.dataGrid) ||
                ((ANVIL_IN_DESIGNER || parent) && getDomPyComponent<DataGrid>(dataGridEl));
            if (dataGrid) {
                self._anvil.dataGrid = dataGrid;
            } else {
                dataGrid = undefined;
            }
        }
        return dataGrid;
    };

    const DataRowCol = ({ dataGridId, colId }: { dataGridId: number | undefined; colId: string | null }) => {
        const strDataGridId = dataGridId === undefined ? "" : String(dataGridId);
        const prefix = getCssPrefix();
        return <div className={`${prefix}data-row-col`} data-grid-col-id={colId} data-grid-id={strDataGridId} />;
    };

    const getColumn = (self: DataRowPanel, colId?: string | null) => {
        colId ??= null;
        let col = self._anvil.cols[String(colId)];
        if (col === undefined) {
            const dataGridId = getDataGridId(self);
            const [colEl] = (<DataRowCol colId={colId} dataGridId={dataGridId} />) as [HTMLElement, {}];
            self._anvil.domNode.appendChild(colEl);
            if (dataGridId === undefined) {
                self._anvil.updateDataGridId = true;
            }
            if (colId === null) {
                colEl.classList.add(getCssPrefix() + "extra-column");
            }
            col = { colEl, autoRow: null, dataGridId };
            self._anvil.cols[String(colId)] = col;
        } else if (col.dataGridId === undefined) {
            const dataGridId = getDataGridId(self);
            col.dataGridId = dataGridId;
            col.colEl.setAttribute("data-grid-id", String(dataGridId));
        }
        return col;
    };

    const updateColumns = (self: DataRowPanel, updateData: boolean = false) => {
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

        const fns: Array<() => any> = [
            () =>
                PyDefUtils.raiseEventOrSuspend(
                    { data_grid: dataGrid || pyNone },
                    self,
                    "x-data-row-panel-update-columns"
                ),
        ];

        const validIds = new Set<string>();
        const dataRowCols = self._anvil.cols;
        const dataRowEl = self._anvil.domNode;
        const extraCols = { ...dataRowCols };

        // columns ordered as they currently appear in the DOM
        const children = dataRowEl.children;
        const prefix = getCssPrefix();

        dataGridCols.forEach((col: any, i: number) => {
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
            const fns: Array<() => any> = [];
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
            return chainOrSuspend(undefined, ...fns);
        });

        return chainOrSuspend(undefined, ...fns);
    };

    const paginate = (self: DataRowPanel, updatedChild: Component | null = null) => {
        const MARKER = "SHOWN_SELF_ONLY" as const;
        if (!self._anvil.pagination) {
            self._anvil.pagination = {
                startAfter: null,
                rowQuota: Infinity,
                rowsDisplayed: 0,
                stoppedAt: null,
                done: true,
            };
        }
        const pagination = self._anvil.pagination;
        return chainOrSuspend(
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
                    return [0, MARKER, true] as [number, any, Done];
                }
                // If this element isn't visible, it doesn't use up any quota.
                if (!self._anvil.getPropJS("visible")) {
                    return [0, MARKER, true] as [number, any, Done];
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
                if (pagination) {
                    if (PyDefUtils.logPagination) {
                        console.group(
                            "Repaginate DataRowPanel from",
                            pagination.startAfter,
                            ", displaying up to",
                            pagination.rowQuota,
                            "rows.",
                            self._anvil.domNode
                        );
                    }

                    const toHide = pagination.rowQuota <= 0;
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
                            if (!pyIsInstance(c.component as pyObject, pyModule["DataRowPanel"] as any)) {
                                rowsRequiredForSelf = 1;
                                break;
                            }
                        }
                    }

                    let childIdx = -1;
                    let rowQuotaForChildren = pagination.rowQuota - rowsRequiredForSelf;
                    if (updatedChild && updatedChild._anvil?.pagination) {
                        childIdx = self._anvil.components.findIndex((c) => c.component === updatedChild);
                        rowQuotaForChildren = self._anvil.lastChildPagination.reduce(
                            (remaining, child, idx) => (child && idx < childIdx ? remaining - child[0] : remaining),
                            rowQuotaForChildren
                        );
                        rowQuotaForChildren -= updatedChild._anvil.pagination.rowsDisplayed;

                        const oldChildRowCount =
                            self._anvil.lastChildPagination[childIdx] && self._anvil.lastChildPagination[childIdx][0];
                        self._anvil.lastChildPagination[childIdx] = [
                            updatedChild._anvil.pagination.rowsDisplayed,
                            updatedChild._anvil.pagination.stoppedAt,
                            updatedChild._anvil.pagination.done,
                        ];

                        if (pagination.startAfter && pagination.startAfter[0] == childIdx) {
                            // We currently start after this component. Update our idea of where *it* starts.
                            pagination.startAfter[1] = updatedChild._anvil.pagination.startAfter;
                        }
                    }

                    return chainOrSuspend(
                        PyDefUtils.repaginateChildren(
                            self,
                            childIdx + 1,
                            pagination.startAfter == MARKER ? null : pagination.startAfter,
                            rowQuotaForChildren
                        ),
                        ([rows, stoppedAt, done]) => {
                            pagination.stoppedAt = stoppedAt;
                            pagination.done = done;

                            if (rows > 0) {
                                if (PyDefUtils.logPagination) {
                                    console.log(
                                        "DataRowPanel displayed",
                                        rows,
                                        "rows.",
                                        done ? "Done" : "Interrupted",
                                        "at",
                                        stoppedAt
                                    );
                                    console.groupEnd();
                                }

                                // We displayed some children, and ourselves.
                                // We're done if our children are done.
                                pagination.rowsDisplayed = rows + rowsRequiredForSelf;
                            } else if (pagination.rowQuota > 0) {
                                if (PyDefUtils.logPagination) {
                                    console.log("DataRowPanel displayed only itself.", done ? "Done." : "Interrupted.");
                                    console.groupEnd();
                                }

                                // We didn't display any children, but we did have enough quota to display ourselves.
                                // We're done if our children are done.
                                pagination.rowsDisplayed = rowsRequiredForSelf;
                                pagination.stoppedAt = MARKER;
                            } else {
                                if (PyDefUtils.logPagination) {
                                    console.log("DataRowPanel hidden - no quota available");
                                    console.groupEnd();
                                }

                                // We didn't display any children, and had no quota available anyway.
                                pagination.rowsDisplayed = 0;
                                pagination.stoppedAt = null;
                                pagination.done = false;
                            }

                            const parent = self._anvil.parent?.pyObj;
                            const quota = [pagination.startAfter, pagination.rowQuota];

                            if (updatedChild?._anvil?.pagination && parent?._anvil?.paginate) {
                                return chainOrSuspend(parent._anvil.paginate(self), () => {
                                    const ret: [number, any, Done] = [
                                        pagination.rowsDisplayed,
                                        pagination.stoppedAt,
                                        pagination.done,
                                    ];
                                    self._anvil.cachedPagination[quota.toString()] = ret;
                                    return ret;
                                });
                            } else {
                                const ret: [number, any, Done] = [
                                    pagination.rowsDisplayed,
                                    pagination.stoppedAt,
                                    pagination.done,
                                ];
                                self._anvil.cachedPagination[quota.toString()] = ret;
                                return ret;
                            }
                        }
                    );
                } else {
                    // We don't have any pagination state yet
                    // TODO: Work out whether to draw everything or nothing, and whether to remember and do something on addedToPage. Or not.
                    return [0, null, true] as [number, any, Done];
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

export default DataRowPanelFactory;
