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

module.exports = function(pyModule) {

    pyModule["ColumnPanel"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var setWrapClass = function(self, el) {
            var v = self._anvil.getPropJS("wrap_on");
            el.removeClass("wrap-never wrap-tablet wrap-mobile");
            if (v == "tablet") {
                el.addClass("wrap-tablet");
            } else if (v == "mobile") {
                el.addClass("wrap-mobile");
            } else {
                el.addClass("wrap-never");
            }
        };

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(ColumnPanel)!1*/["layout", "containers", "appearance", "user data", "tooltip"]);

        /*!componentProp(ColumnPanel)!1*/
        properties.push({
            name: "col_widths",
            type: "string",
            description: "Custom column widths in this panel",
            defaultValue: "",
            important: false,
            priority: 0,
            hidden: true,
            set: function(s,e,v) {
                s._anvil.element.find(".anvil-panel-row").each(function(i, row) {
                    setColumnWidths(s, $(row));
                });
            }
        });

        /*!componentProp(ColumnPanel)!1*/
        properties.push({
            name: "wrap_on",
            type: "string",
            enum: ["never", "mobile", "tablet"],
            description: "The largest display on which to wrap columns in this panel",
            defaultValue: "mobile",
            important: true,
            set: function(s,e,v) {
                s._anvil.element.find(".anvil-panel-col.belongs-to-" + s._anvil.panelId + ",.anvil-panel-row.belongs-to-" + s._anvil.panelId).each(function(i,e) {
                    setWrapClass(s,$(e));
                });
            }
        });

        /*!componentProp(ColumnPanel)!1*/
        properties.push({
            name: "col_spacing",
            description: "Space between columns",
            type: "string",
            enum: ["none", "tiny", "small", "medium", "large", "huge"],
            defaultValue: "medium",
            important: false,
            priority: 0,
            set: function(s,e,v) {
                for (let i of ["none", "tiny", "small", "medium", "large", "huge"]) {
                    e.toggleClass("col-padding-"+i, (v==i));
                }
                e.find(".col-padding.belongs-to-" + s._anvil.panelId).attr("class", "col-padding col-padding-" + v + " belongs-to-" + s._anvil.panelId);
            }
        });

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = self._anvil.element || $('<div/>');
            self._anvil.element.addClass("column-panel anvil-container");

            self._anvil.panelId = utils.getRandomStr(6);

            self._anvil.layoutPropTypes = [{
                name: "full_width_row",
                type: "boolean",
                description: "True if this grid row should fill the width of the screen.",
                defaultValue: false,
                important: false,
                priority: 0,
            },{
                name: "row_background",
                type: "color",
                description: "The background colour of this grid row.",
                defaultValue: "",
                important: false,
                priority: 0,
            }];

            self._anvil.generateNewLayoutProps = basedOn => {
                // For now, this is pretty naive. Just create a new row/col for the component.

                // TODO: Insert the new component in a row on its own below the basedOn row. Do 
                // this in a repeatable way so that multiple components copied from the same
                // row land on the same new row. Copy col_widths from the basedOn row.

                return {
                    col_widths: (basedOn && basedOn.col_widths) || {},
                    grid_position: utils.getRandomStr(6) + "," + utils.getRandomStr(6),
                    full_width_row: (basedOn && basedOn.full_width_row),
                }
            }

            self._anvil.setLayoutProperties = function(pyChild, layoutProperties) {
                var ps = {};
                // Assume this only gets called from the designer, so pyChild will have a name.
                ps[pyChild._anvil.componentSpec.name] = layoutProperties;

                var thisRow = self._anvil.childLayoutProps[pyChild._anvil.componentSpec.name].grid_position.split(",")[0];

                for (var n in self._anvil.childLayoutProps) {
                    var lps = self._anvil.childLayoutProps[n];
                    if (!lps.grid_position) {
                        // This should never happen: There should be no way of getting a component into the container without resetting its layout properties.
                        // That said, we've seen this in the wild, so we should cope with it.
                        lps = self._anvil.generateNewLayoutProps(lps);
                    }
                    if (lps.grid_position.indexOf(thisRow) == 0) {
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
                }
                updateSharedLayoutProps(self);

                return ps;
            };

            //console.log("ColumnPanel:", self._anvil.element[0]);
        },pyModule, $loc, properties,PyDefUtils.assembleGroupEvents("column panel", /*!componentEvents(ColumnPanel)!1*/["universal"]),pyModule["Container"]);

        var setColumnWidths = function(self, row) {
            // Set all the columns in this row to the right width.

            var colWidths = JSON.parse(self._anvil.getPropJS("col_widths") || "{}");

            var allCols = row.find(">.anvil-panel-col");
            var colCount = allCols.length;
            var defaultColWeight = Math.floor(60/colCount);

            var totalWeight = 0;
            allCols.each((i,e) => { totalWeight += colWidths[$(e).data("anvil-col-id")] || defaultColWeight });

            var remainder = 0
            if (Math.abs(totalWeight-12) < 0.5) {
                // This is an old ColumnPanel. Convert 12-col to 60-col
                allCols.each((i,e) => { colWidths[$(e).data("anvil-col-id")] *= 5 });
            } else if (totalWeight < 60) {
                remainder = 60 - totalWeight;
            }

            allCols.each(function(i, e) {

                var colId = $(e).data("anvil-col-id");
                var w = (colWidths[colId] || defaultColWeight);
                if (i < remainder)
                    w += 1;
                $(e).css("flex-grow", w);
            });
        }

        var updateSharedLayoutProps = function(self) {
            self._anvil.element.find(".anvil-component.belongs-to-" + self._anvil.panelId).each(function(_,e) {
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
                    let m = (""+v).match(/^theme:(.*)$/);
                    if (m) {
                        v = self._anvil.themeColors[m[1]] || '';
                    }
                }
                e.parents(".anvil-panel-section").first().css("background", v);
            });
        }

        $loc["clear"] = new Sk.builtin.func(function(self) {
            return Sk.misceval.chain(Sk.misceval.callsimOrSuspend(pyModule["Container"].tp$getattr(new Sk.builtin.str("clear")), self), function() {
                self._anvil.element.empty();
                return Sk.builtin.none.none$;
            });
        });

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
        $loc["add_component"] = new PyDefUtils.funcWithKwargs(function(kwargs, self, component) {
            if (!component || !component._anvil) { throw new Sk.builtin.Exception("Argument to add_component() must be a component"); }
            return Sk.misceval.chain(undefined, 
                () => {

                    if (component._anvil.metadata.invisible) { return; }

                    var componentElement = component._anvil.element;

                    component._anvil.layoutProps = kwargs;
                    var gridPos = kwargs["grid_position"];

                    if (!gridPos)
                        gridPos = utils.getRandomStr(6) + "," + utils.getRandomStr(6);

                    var currentParent = null; // For the first level, current parent will be sections. After that, cols.

                    var levels = gridPos.split(" ");
                    var currentPos = [];
                    for (var h in levels) {
                        var level = levels[h];
                        var p = level.split(",");

                        var rowId = p[0];
                        var colId = p[1];

                        currentPos.push({
                            row: rowId,
                            col: colId,
                        });

                        var rowElement = self._anvil.element.find(".anvil-panel-row-" + rowId + ".belongs-to-" + self._anvil.panelId);

                        if (rowElement.length == 0) {

                            if (h == 0) {
                                // We're still at the first level. Create a new section, then create the container inside that.
                                var section = $("<div/>").addClass("anvil-panel-section")
                                                         .addClass("belongs-to-" + self._anvil.panelId)
                                                         .appendTo(self._anvil.element);
                                let sectionContainer = $("<div/>").addClass("anvil-panel-section-container")
                                                           .addClass("anvil-container-overflow")
                                                           .addClass("belongs-to-" + self._anvil.panelId)
                                                           .appendTo(section);
                                let sectionGutter = $("<div/>").addClass("anvil-panel-section-gutter")
                                                           .addClass("belongs-to-" + self._anvil.panelId)
                                                           .appendTo(sectionContainer);
                                currentParent = sectionGutter;

                            }

                            // This row doesn't exist yet
                            rowElement = $("<div/>");
                            rowElement.addClass("anvil-panel-row")
                            rowElement.addClass("anvil-panel-row-" + rowId);
                            rowElement.data("anvil-row-id", rowId);
                            rowElement.addClass("belongs-to-" + self._anvil.panelId);
                            setWrapClass(self, rowElement);
                            currentParent.append(rowElement);
                        }

                        var colElement = rowElement.find(">.anvil-panel-col-" + colId);

                        if (colElement.length == 0) {
                            // This column doesn't exist yet
                            colElement = $("<div/>")
                            colElement.addClass("anvil-panel-col");
                            colElement.addClass("anvil-panel-col-" + colId);
                            colElement.data("anvil-col-id", colId);
                            colElement.addClass("belongs-to-" + self._anvil.panelId);
                            setWrapClass(self, colElement);
                            //console.debug("Creating col", currentPos, colElement);
                            rowElement.append(colElement);
                        }

                        setColumnWidths(self, rowElement);

                        currentParent = colElement;
                        //console.debug("Row:", rowElement, "Col:", colElement);
                    }
                    componentElement.data("anvil-panel-child-idx", self._anvil.components.length);
                    componentElement.addClass("belongs-to-"+self._anvil.panelId);

                    let paddingElement = $("<div/>").addClass("col-padding belongs-to-" + self._anvil.panelId + " col-padding-"+self._anvil.getPropJS("col_spacing")).appendTo(currentParent);
                    paddingElement.append(componentElement);
                    //console.debug("Appending", componentElement, "to", currentParent)
                    component._anvil.delayAddedToPage = true;
                },
                () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs),
                () => { 
                    updateSharedLayoutProps(self); 
                    if (self._anvil.onPage)
                        return component._anvil.addedToPage();
                },
                () => Sk.builtin.none.none$,
            );
        });
    }, /*!defClass(anvil,ColumnPanel,Container)!*/ "ColumnPanel", [pyModule["Container"]]);
};

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
