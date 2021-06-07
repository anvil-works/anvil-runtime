"use strict";

var PyDefUtils = require("PyDefUtils");
var utils = require("utils");
/**
id: columnpanel
docs_url: /docs/client/components/containers#columnpanel
title: ColumnPanel
tooltip: Learn more about ColumnPanel
description: |
  This container allows you to drag and drop components into rows and columns. ColumnPanel is the 
  default layout used for Anvil forms you create.

  Components added at runtime using the `add_component` method will each be added to their own row.
  In this respect, the ColumnPanel behaves the same as the LinearPanel at runtime. There are no special arguments
  to pass to `add_component`.

  Like the `LinearPanel`, the ColumnPanel will expand to fit its contents.

  Components in a ColumnPanel have several container properties, which can be set in the Properties dialog:

  \* `full_width_row`: When `True`, this row of components will stretch to the full width of the screen. (Default `False`)

  \* `row_background`: Set to a CSS color for the background of this row. Note that the background stretches to the full with of the browser. (Default: none)

*/

module.exports = (pyModule) => {


    pyModule["ColumnPanel"] = PyDefUtils.mkComponentCls(pyModule, "ColumnPanel", {
        base: pyModule["Container"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(ColumnPanel)!1*/ ["layout", "containers", "appearance", "user data", "tooltip"], {
            col_widths: /*!componentProp(ColumnPanel)!1*/ {
                name: "col_widths",
                type: "string",
                description: "Custom column widths in this panel",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                important: false,
                priority: 0,
                hidden: true,
                set(s, e, v) {
                    s._anvil.element.find(".anvil-panel-row").each(function (i, row) {
                        setColumnWidths(s, $(row));
                    });
                },
            },

            wrap_on: /*!componentProp(ColumnPanel)!1*/ {
                name: "wrap_on",
                type: "string",
                enum: ["never", "mobile", "tablet"],
                description: "The largest display on which to wrap columns in this panel",
                defaultValue: new Sk.builtin.str("mobile"),
                pyVal: true,
                important: true,
                set(self, e, v) {
                    v = v.toString();
                    Object.values(self._anvil.rows).forEach((rowElement) => {
                        rowElement.classList.remove("wrap-never", "wrap-tablet", "wrap-mobile");
                        rowElement.classList.add("wrap-" + v);
                    });
                    Object.values(self._anvil.cols).forEach((colElement) => {
                        colElement.classList.remove("wrap-never", "wrap-tablet", "wrap-mobile");
                        colElement.classList.add("wrap-" + v);
                    });
                },
            },

            col_spacing: /*!componentProp(ColumnPanel)!1*/ {
                name: "col_spacing",
                description: "Space between columns",
                type: "string",
                enum: ["none", "tiny", "small", "medium", "large", "huge"],
                defaultValue: new Sk.builtin.str("medium"),
                pyVal: true,
                important: false,
                priority: 0,
                set(s, e, v) {
                    v = v.toString();
                    for (let i of ["none", "tiny", "small", "medium", "large", "huge"]) {
                        e.toggleClass("col-padding-" + i, v === i);
                    }
                    e.find(".col-padding.belongs-to-" + s._anvil.panelId).attr("class", "col-padding col-padding-" + v + " belongs-to-" + s._anvil.panelId);
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents("column panel", /*!componentEvents(ColumnPanel)!1*/ ["universal"]),

        element({ col_spacing, ...props }) {
            const colSpacing = " col-padding-" + col_spacing.toString();
            return <PyDefUtils.OuterElement className={"column-panel anvil-container" + colSpacing} {...props} />;
        },

        layouts: [
            {
                name: "full_width_row",
                type: "boolean",
                description: "True if this grid row should fill the width of the screen.",
                defaultValue: false,
                important: false,
                priority: 0,
            },
            {
                name: "row_background",
                type: "color",
                description: "The background colour of this grid row.",
                defaultValue: "",
                important: false,
                priority: 0,
            },
        ],

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["Container"], (self) => {
                self._anvil.panelId = utils.getRandomStr(6);
                self._anvil.rows = {};
                self._anvil.cols = {};

                self._anvil.generateNewLayoutProps = (basedOn) => {
                    // For now, this is pretty naive. Just create a new row/col for the component.

                    // TODO: Insert the new component in a row on its own below the basedOn row. Do
                    // this in a repeatable way so that multiple components copied from the same
                    // row land on the same new row. Copy col_widths from the basedOn row.

                    return {
                        col_widths: (basedOn && basedOn.col_widths) || {},
                        grid_position: utils.getRandomStr(6) + "," + utils.getRandomStr(6),
                        full_width_row: basedOn && basedOn.full_width_row,
                    };
                };

                self._anvil.setLayoutProperties = function (pyChild, layoutProperties) {
                    const ps = {};
                    // Assume this only gets called from the designer, so pyChild will have a name.
                    const name = pyChild._anvil.componentSpec.name;
                    ps[name] = layoutProperties;

                    const thisRow = self._anvil.childLayoutProps[name].grid_position.split(",")[0];

                    Object.entries(self._anvil.childLayoutProps).forEach(([n, lps]) => {
                        if (!lps.grid_position) {
                            // This should never happen: There should be no way of getting a component into the container without resetting its layout properties.
                            // That said, we've seen this in the wild, so we should cope with it.
                            lps = self._anvil.generateNewLayoutProps(lps);
                        }
                        if (lps.grid_position.indexOf(thisRow) === 0) {
                            // This component is on the same top-level row as us. Mirror the shared layout props.
                            if ("full_width_row" in layoutProperties) {
                                ps[n] = ps[n] || {};
                                ps[n]["full_width_row"] = layoutProperties["full_width_row"];
                                lps["full_width_row"] = layoutProperties["full_width_row"];
                            }
                            if ("row_background" in layoutProperties) {
                                ps[n] = ps[n] || {};
                                ps[n]["row_background"] = layoutProperties["row_background"];
                                lps["row_background"] = layoutProperties["row_background"];
                            }
                        }
                    });
                    updateSharedLayoutProps(self);
                    return ps;
                };
            });


            $loc["clear"] = new Sk.builtin.func(function (self) {
                return Sk.misceval.chain(Sk.misceval.callsimOrSuspend(pyModule["Container"].tp$getattr(new Sk.builtin.str("clear")), self), function () {
                    self._anvil.element.empty();
                    self._anvil.rows = {};
                    self._anvil.cols = {};
                    return Sk.builtin.none.none$;
                });
            });

            const Section = ({ panelId, full_width_row, row_background }) => {
                const fwrClass = full_width_row ? " full-width-row" : "";
                const background = row_background ? "background:" + row_background + ";" : "";
                return (
                    <div refName="section" className={"anvil-panel-section belongs-to-" + panelId} style={background}>
                        <div refName="sectionContainer" className={"anvil-panel-section-container anvil-container-overflow belongs-to-" + panelId + fwrClass}>
                            <div refName="sectionGutter" className={"anvil-panel-section-gutter belongs-to-" + panelId}></div>
                        </div>
                    </div>
                );
            };

            const Row = ({ rowId, panelId, wrap_on }) => {
                wrap_on = " wrap-" + wrap_on.toString();
                return <div refName="row" className={"anvil-panel-row anvil-panel-row-" + rowId + " belongs-to-" + panelId + wrap_on}></div>;
            };

            const Column = ({ colId, panelId, wrap_on }) => {
                wrap_on = " wrap-" + wrap_on.toString();
                return <div refName="col" className={"anvil-panel-col anvil-panel-col-" + colId + " belongs-to-" + panelId + wrap_on}></div>;
            };

            /*
                ColumnPanel DOM structure:
    
                .anvil-container.column-panel                     The main container
                    .anvil-panel-section                          Section deals with full-width-row and row-background, etc. Each top-level row is in its own section
                    |   .anvil-panel-section-container            Sets width based on responsive breakpoints
                    |       .anvil-panel-section-gutter           Negative margins for columns
                    |           .anvil-panel-row                  Container for columns
                    |               .anvil-panel-col              Column
                    |               |    .anvil-panel-row         Rows and columns can be arbitrarily nested
                    |               |        .anvil-panel-col
                    |               |            .col-padding     Column spacing only in innermost column, around component.
                    |               |                <Component>
                    |               |
                    |               *
                    | 
                    *   
            */

            /*!defMethod(_,component,full_width_row=False,**layout_props)!2*/ "Add a component to the bottom of this ColumnPanel. Useful layout properties:\n\n  full_width_row = True|False\n  row_background = [colour]"
            $loc["add_component"] = new PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                pyModule["Container"]._check_no_parent(component);

                return Sk.misceval.chain(
                    undefined,
                    () => {
                        if (component._anvil.metadata.invisible) {
                            return;
                        }

                        const componentElement = component._anvil.element;
                        const wrap_on = self._anvil.props["wrap_on"];
                        const panelId = self._anvil.panelId;

                        component._anvil.layoutProps = kwargs;
                        const gridPos = kwargs["grid_position"] || utils.getRandomStr(6) + "," + utils.getRandomStr(6);
                        const f_w_r = kwargs["full_width_row"];
                        const row_bg = kwargs["row_background"];

                        let currentParent; // For the first level, current parent will be sections. After that, cols.

                        const levels = gridPos.split(" ");
                        levels.forEach((level, h) => {
                            const [rowId, colId] = level.split(",");
                            // let rowElement = self._anvil.element.find(".anvil-panel-row-" + rowId + ".belongs-to-" + panelId);
                            let rowElement = self._anvil.rows[rowId];

                            if (rowElement === undefined) {
                                if (h === 0) {
                                    // We're still at the first level. Create a new section, then create the container inside that.
                                    const [section, sectionElements] = <Section panelId={panelId} full_width_row={f_w_r} row_background={row_bg} />;
                                    self._anvil.elements.outer.appendChild(section);
                                    currentParent = sectionElements.sectionGutter;
                                }

                                // This row doesn't exist yet
                                [rowElement] = <Row {...{ panelId, rowId, wrap_on }} />;
                                self._anvil.rows[rowId] = rowElement;
                                $(rowElement).data("anvil-row-id", rowId);
                                currentParent.appendChild(rowElement);
                            }

                            // let colElement = rowElement.find(">.anvil-panel-col-" + colId);
                            let colElement = self._anvil.cols[colId];

                            if (colElement === undefined) {
                                // This column doesn't exist yet
                                [colElement] = <Column {...{ panelId, colId, wrap_on }} />;
                                self._anvil.cols[colId] = colElement;
                                $(colElement).data("anvil-col-id", colId);
                                //console.debug("Creating col", currentPos, colElement);
                                rowElement.appendChild(colElement);
                            }

                            setColumnWidths(self, $(rowElement));

                            currentParent = colElement;
                        });

                        componentElement.data("anvil-panel-child-idx", self._anvil.components.length);
                        componentElement.addClass("belongs-to-" + panelId);

                        const [paddingElement] = <div refName="padding" className={"col-padding belongs-to-" + panelId + " col-padding-" + self._anvil.getPropJS("col_spacing")} />;
                        currentParent.appendChild(paddingElement);
                        paddingElement.appendChild(componentElement[0]);

                        //console.debug("Appending", componentElement, "to", currentParent)
                        component._anvil.delayAddedToPage = true;
                    },
                    () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs),
                    () => {
                        if (self._anvil.onPage) return component._anvil.addedToPage();
                        // todo add a remove function that removes cols/rows if they are empty
                    },
                    () => Sk.builtin.none.none$
                );
            });
        },
    });

    function setColumnWidths(self, row) {
        // Set all the columns in this row to the right width.

        const colWidths = JSON.parse(self._anvil.getPropJS("col_widths") || "{}");

        const allCols = row.find(">.anvil-panel-col");
        const colCount = allCols.length;
        const defaultColWeight = Math.floor(60 / colCount);

        let totalWeight = 0;
        allCols.each((i, e) => {
            totalWeight += colWidths[$(e).data("anvil-col-id")] || defaultColWeight;
        });

        let remainder = 0;
        if (Math.abs(totalWeight - 12) < 0.5) {
            // This is an old ColumnPanel. Convert 12-col to 60-col
            allCols.each((i, e) => {
                colWidths[$(e).data("anvil-col-id")] *= 5;
            });
        } else if (totalWeight < 60) {
            remainder = 60 - totalWeight;
        }

        allCols.each(function (i, e) {
            const colId = $(e).data("anvil-col-id");
            let w = colWidths[colId] || defaultColWeight;
            if (i < remainder) {
                w += 1;
            }
            $(e).css("flex-grow", w);
        });
    }


    // This should only get called from the designer
    function updateSharedLayoutProps(self) {
        self._anvil.element.find(".anvil-component.belongs-to-" + self._anvil.panelId).each(function (_, e) {
            e = $(e);
            var c = e.data("anvil-py-component");

            var lps = c._anvil.layoutProps || {};
            if (lps.full_width_row) {
                e.parents(".anvil-panel-section-container").first().addClass("full-width-row");
            } else {
                e.parents(".anvil-panel-section-container").first().removeClass("full-width-row");
            }
            let v = "transparent";
            if (lps.row_background) {
                v = lps.row_background;
                let m = ("" + v).match(/^theme:(.*)$/);
                if (m) {
                    v = window.anvilThemeColors[m[1]] || "";
                }
            }
            e.parents(".anvil-panel-section").first().css("background", v);
        });
    }


};
/*!defClass(anvil,ColumnPanel,Container)!*/ 

/*
 * TO TEST:
 *
 *  - Prop groups: layout, containers, appearance
 *  - New props: col_widths
 *  - Child layout props: full_width_row, row_background
 *  - Event groups: universal
 *  - Methods: add_component
 *
 */
