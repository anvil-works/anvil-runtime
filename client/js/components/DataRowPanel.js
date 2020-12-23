"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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
let i = 0;
module.exports = function(pyModule) {

    let updateVisible = self => {
        let e = self._anvil.element;
        let v = self._anvil.getPropJS("visible") && !self._anvil.hideOnThisPage;
        if (v) {
            e.removeClass("visible-false");
            e.parent(".hide-with-component").removeClass("visible-false");
            // Trigger events for components that need to update themselves when visible
            // (eg Maps, Canvas)
            return self._anvil.shownOnPage();
        } else {
            e.addClass("visible-false");
            e.parent(".hide-with-component").addClass("visible-false");
        }
    };

    let updateColData = (self, colSpec, colElement) => {

        let existingAutoComponent = colElement.find(">.auto-row-value")
        if (existingAutoComponent.length > 0) {
            let pyC = existingAutoComponent.data("anvilPyComponent");
            Sk.misceval.callsim(pyC.tp$getattr(new Sk.builtin.str("remove_from_parent")));
        }

        let data = self._anvil.getProp("item");
        let displayData = self._anvil.getPropJS("auto_display_data");

        if (!displayData || !data || data == Sk.builtin.none.none$ || !colSpec || (colSpec.data_key == "" && colElement.closest(".auto-grid-header").length == 0) || colElement.find(":not(.auto-row-value)").length > 0) {
            return;
        }

        let dataKey = self._anvil.element.hasClass("auto-grid-header") ? colSpec.id : (colSpec.data_key || colSpec.id);

        return Sk.misceval.chain(
            Sk.misceval.tryCatch(
                () => Sk.abstr.objectGetItem(data, Sk.ffi.remapToPy(dataKey), true),
                () => undefined
            ),
            val => {
                if (val !== undefined) {
                    let valComponent = Sk.misceval.call(pyModule["Label"], undefined, undefined, [Sk.ffi.remapToPy("text"), val]);
                    valComponent._anvil.element.addClass("auto-row-value");
                    return Sk.misceval.call(self.tp$getattr(new Sk.builtin.str("add_component")), undefined, undefined, [Sk.ffi.remapToPy("column"), Sk.ffi.remapToPy(colSpec.id)], valComponent);
                }
            }
        );
    }

    let getColElement = (self, colId) => {
        let col = self._anvil.element.find(`>.data-row-col[data-grid-col-id='${colId}']`)
        if (col.length == 0) {
            col = $("<div/>").addClass("data-row-col").attr("data-grid-col-id", colId);
            self._anvil.element.append(col);
        }
        if (self._anvil.dataGrid) {
            col.attr("data-grid-id", self._anvil.dataGrid._anvil.dataGridId)
        }
        return col;
    }

    let updateColumns = self => {
        if (!self._anvil.dataGrid) {
            self._anvil.dataGrid = self._anvil.element.closest(".anvil-data-grid").data("anvilPyComponent");
        }

        if (!self._anvil.dataGrid) {
            return;
        }

        let cols = self._anvil.dataGrid._anvil.getPropJS("columns");

        if (!cols) {
            return;
        }

        self._anvil.element.find(">.data-row-col").addClass("extra-column");

        let fns = [];

        let validIds = [];
        // Create/reorder columns.
        for(let i = 0; i < cols.length; i++) {
            let c = self._anvil.element.find(">.data-row-col").eq(i);
            if (c.attr("data-grid-col-id") != cols[i].id) {
                // This column is in the wrong place. Swap in the right one.
                // Find or create the required element.
                let el = getColElement(self, cols[i].id);
                if (el.index() != i) {
                    el.insertBefore(c);
                }
                c = el;
            } else if (self._anvil.dataGrid) {
                c.attr("data-grid-id", self._anvil.dataGrid._anvil.dataGridId)
            }
            c.removeClass("extra-column");
            fns.push(() => self._anvil.updateColData(cols[i], c));
            validIds.push(cols[i].id);
        }

        fns.push(() => {
            let fns = [];
            self._anvil.element.find(".extra-column").each((_,e) => {
                e = $(e);
                if (e.attr("data-grid-col-id") && e.find(">:not(.auto-row-value,.col-value-preview)").length == 0 && !validIds.includes(e.attr("data-grid-col-id"))) {
                    e.remove();
                } else {
                    fns.push(() => self._anvil.updateColData(null, e));
                }
            });
            return Sk.misceval.chain(undefined, ...fns);
        })

        return Sk.misceval.chain(undefined, ...fns);

    }

    let paginate = (self, updatedChild=null) => {
        let MARKER = "SHOWN_SELF_ONLY";

        return Sk.misceval.chain(undefined, () => self._anvil.updateColumns(),
            () => {

                // If this element is the auto-header, it doesn't use up any quota.
                if (self._anvil.element.hasClass("auto-grid-header")) {
                    return [0, MARKER, true];
                }

                // If this element isn't visible, it doesn't use up any quota.
                if (!self._anvil.getPropJS("visible")) {
                    
                    return [0, MARKER, true];
                }

                if (self._anvil.pagination) {
                    if (PyDefUtils.logPagination) console.group("Repaginate DataRowPanel from", self._anvil.pagination.startAfter, ", displaying up to", self._anvil.pagination.rowQuota, "rows.", self._anvil.element[0]);

                    if (self._anvil.pagination.rowQuota > 0) {
                        self._anvil.hideOnThisPage = false;
                    } else {
                        self._anvil.hideOnThisPage = true;
                    }
                    updateVisible(self);

                    // Work out whether we need any row quota to display ourselves. We only need some if we're auto-displaying data or if we have any children that aren't DataRowPanels.
                    let rowsRequiredForSelf = 0;
                    if (self._anvil.getPropJS("auto_display_data")) {
                        rowsRequiredForSelf = 1;
                    } else {
                        for (let c of self._anvil.components || []) {
                            if (!(Sk.builtin.isinstance(c.component, pyModule["DataRowPanel"]).v)) {
                                rowsRequiredForSelf = 1;
                                break;
                            }
                        }
                    }

                    let childIdx = -1;
                    let rowQuotaForChildren = self._anvil.pagination.rowQuota - rowsRequiredForSelf;
                    if (updatedChild && updatedChild._anvil.pagination) {
                        childIdx = self._anvil.components.findIndex(c => c.component == updatedChild);
                        rowQuotaForChildren = self._anvil.lastChildPagination.reduce((remaining, child, idx) => (child && idx < childIdx) ? remaining - child[0] : remaining, rowQuotaForChildren);
                        rowQuotaForChildren -= updatedChild._anvil.pagination.rowsDisplayed;

                        let oldChildRowCount = self._anvil.lastChildPagination[childIdx] && self._anvil.lastChildPagination[childIdx][0];
                        self._anvil.lastChildPagination[childIdx] = [updatedChild._anvil.pagination.rowsDisplayed, updatedChild._anvil.pagination.stoppedAt, updatedChild._anvil.pagination.done];

                        if (self._anvil.pagination.startAfter && self._anvil.pagination.startAfter[0] == childIdx) {
                            // We currently start after this component. Update our idea of where *it* starts.
                            self._anvil.pagination.startAfter[1] = updatedChild._anvil.pagination.startAfter;
                        }
                    }

                    return Sk.misceval.chain(PyDefUtils.repaginateChildren(self, childIdx+1, (self._anvil.pagination.startAfter == MARKER) ? null : self._anvil.pagination.startAfter, rowQuotaForChildren),
                        ([rows, stoppedAt, done]) => {

                            self._anvil.pagination.stoppedAt = stoppedAt;
                            self._anvil.pagination.done = done;

                            if (rows > 0) {
                                if (PyDefUtils.logPagination) console.log("DataRowPanel displayed", rows, "rows.", done ? "Done" : "Interrupted", "at", stoppedAt);
                                if (PyDefUtils.logPagination) console.groupEnd();

                                // We displayed some children, and ourselves.
                                // We're done if our children are done.
                                self._anvil.pagination.rowsDisplayed = rows + rowsRequiredForSelf;
                            } else if (self._anvil.pagination.rowQuota > 0) {
                                if (PyDefUtils.logPagination) console.log("DataRowPanel displayed only itself.", done ? "Done." : "Interrupted.");
                                if (PyDefUtils.logPagination) console.groupEnd();
                                
                                // We didn't display any children, but we did have enough quota to display ourselves.
                                // We're done if our children are done.
                                self._anvil.pagination.rowsDisplayed = rowsRequiredForSelf;
                                self._anvil.pagination.stoppedAt = MARKER;
                            } else {
                                if (PyDefUtils.logPagination) console.log("DataRowPanel hidden - no quota available");
                                if (PyDefUtils.logPagination) console.groupEnd();
                                
                                // We didn't display any children, and had no quota available anyway.
                                self._anvil.pagination.rowsDisplayed = 0;
                                self._anvil.pagination.stoppedAt = null;
                                self._anvil.pagination.done = false;
                            }

                            let parent = self._anvil.parent && self._anvil.parent.pyObj;
                            if (updatedChild && updatedChild._anvil.pagination && parent && parent._anvil.paginate) {


                                return Sk.misceval.chain(parent._anvil.paginate(self),
                                    () => [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done]
                                );
                            } else {
                                return [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done];
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

    }

    pyModule["DataRowPanel"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(DataRowPanel)!1*/["text", "layout", "containers", "appearance", "tooltip", "user data"], {
            visible: {
                set: (s,e,v) => {
                    return updateVisible(s);
                }
            }
        });

        properties = properties.filter(x => x.name != "text");
        Object.assign(properties.filter(x => x.name == "bold")[0], {
            important: true, 
            priority: 10
        });
        Object.assign(properties.filter(x => x.name == "spacing_above")[0], {
            defaultValue: "none", 
        });
        Object.assign(properties.filter(x => x.name == "spacing_below")[0], {
            defaultValue: "none", 
        });


        /*!componentProp(DataRowPanel)!1*/
        properties.push({name: "item", type: "object",
            defaultValue: Sk.builtin.none.none$,
            pyVal: true,
            exampleValue: "",
            description: "The data to display in this row by default.",
            set: function(self,e,v) {
                return self._anvil.updateColumns();
            }
        });

        /*!componentProp(DataGrid)!1*/
        properties.push({name: "auto_display_data", type: "boolean",
            defaultValue: true,
            exampleValue: true,
            description: "Whether to automatically display data in this row.",
            set: (s,e,v) => updateColumns(s,e),
        });


        for (let prop of properties || []) {
            $loc[prop.name] = Sk.misceval.callsim(pyModule['ComponentProperty'], prop.name);
        }

        $loc["__new__"] = new Sk.builtin.func(PyDefUtils.withRawKwargs((pyKwargs, cls) => {
            return Sk.misceval.chain(Sk.misceval.callOrSuspend(Sk.builtin.object.prototype["__new__"], undefined, undefined, undefined, cls),
                c => {
                    PyDefUtils.addProperties(c, properties);
                    return c;
                }
            );
        }));

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = self._anvil.element || $("<div>");
            self._anvil.element.addClass("anvil-container anvil-data-row-panel");

            self._anvil.layoutPropTypes = [{
                name: "column",
                type: "string",
                description: "The id of the column where this component will be placed",
                defaultValue: "",
                important: true,
                priority: 0,
            }];

            self._anvil.pageEvents = {
                add: () => {
                    // TODO: Cope with not finding a parent data grid.
                    return self._anvil.updateColumns();
                },
                remove: () => { },
                show: () => { },
            };

            self._anvil.updateColData = updateColData.bind(self, self);
            self._anvil.updateColumns = updateColumns.bind(self, self);
            self._anvil.getColElement = getColElement.bind(self, self);

            self._anvil.paginate = paginate.bind(self, self);

            self._anvil.onRefreshDataBindings = () => self._anvil.updateColumns();

        },pyModule, $loc, [], PyDefUtils.assembleGroupEvents("data row panel", /*!componentEvents(DataRowPanel)!1*/["universal"]), pyModule["Container"]);


        // TODO: Add properties for orientation. Vertical for now.

        /*!defMethod(_,component,[column=None])!2*/ "Add a component to the specified column of this DataRowPanel. TODO: If 'column' is not specified, adds the component full-width."
        $loc["add_component"] = new PyDefUtils.funcWithKwargs(function(kwargs, self, component) {
            if (!component || !component._anvil) { throw new Sk.builtin.Exception("Argument to add_component() must be a component"); }
            let colId = kwargs.column;
            return Sk.misceval.chain(undefined,
                () => {
                    let col = getColElement(self, colId);
                    for (let c of col.find(".auto-row-value").map((_,e) => $(e).data("anvilPyComponent")).toArray()) {
                        Sk.misceval.callsim(c.tp$getattr(new Sk.builtin.str("remove_from_parent")));
                    }
                    col.append(component._anvil.element);
                },
                () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs),
                () => {
                    let oldRemove = component._anvil.parent.remove;
                    component._anvil.parent.remove = () => {
                        let r = oldRemove();
                        return Sk.misceval.chain(component._anvil.element.hasClass("auto-row-value") || self._anvil.updateColumns(),
                            // TODO: Repaginate.
                            () => r,
                        );
                    }
                },
                () => {
                    if (component._anvil.paginate) {
                        // We only need to repaginate ourselves if the component we just added understands pagination.
                        self._anvil.paginate(component)
                    }
                    return Sk.builtin.none.none$;
                },
            );
        });

    }, /*!defClass(anvil,DataRowPanel,Container)!*/ "DataRowPanel", [pyModule["Container"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - Event groups: universal
 *  - Methods: add_component
 *
 */
