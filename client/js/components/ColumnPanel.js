"use strict";

import { chainOrSuspend, pyCallOrSuspend, pyNone, pyStr } from "@Sk";
import { getRandomStr } from "../utils";
import { isInvisibleComponent } from "./helpers";
import { validateChild } from "./Container";
import { getCssPrefix } from "@runtime/runner/legacy-features";

var PyDefUtils = require("PyDefUtils");

/*#
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
        base: pyModule["ClassicContainer"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(ColumnPanel)!1*/ ["layout", "layout_spacing", "containers", "appearance", "user data", "tooltip"], {
            col_widths: /*!componentProp(ColumnPanel)!1*/ {
                name: "col_widths",
                type: "string",
                description: "Custom column widths in this panel",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                important: false,
                priority: 0,
                hidden: true,
                set(self, e, v) {
                    Object.values(self._anvil.rows).forEach((rowContainer) => {
                        const rowElement = rowContainer.el;
                        setColumnWidths(self, rowElement);
                    });
                },
            },

            wrap_on: /*!componentProp(ColumnPanel)!1*/ {
                name: "wrap_on",
                type: "enum",
                options: ["never", "mobile", "tablet"],
                description: "The largest display on which to wrap columns in this panel",
                defaultValue: new Sk.builtin.str("mobile"),
                pyVal: true,
                important: true,
                set(self, e, v) {
                    v = v.toString();
                    const prefix = getCssPrefix();
                    Object.values(self._anvil.rows).forEach((rowContainer) => {
                        const rowElement = rowContainer.el;
                        rowElement.classList.remove(prefix + "wrap-never", prefix + "wrap-tablet", prefix + "wrap-mobile");
                        rowElement.classList.add(prefix + "wrap-" + v);
                    });
                    Object.values(self._anvil.cols).forEach((colContainer) => {
                        const colElement = colContainer.el;
                        colElement.classList.remove(prefix + "wrap-never", prefix + "wrap-tablet", prefix + "wrap-mobile");
                        colElement.classList.add(prefix + "wrap-" + v);
                    });
                },
            },

            col_spacing: /*!componentProp(ColumnPanel)!1*/ {
                name: "col_spacing",
                description: "Space between columns",
                type: "enum",
                options: ["none", "tiny", "small", "medium", "large", "huge"],
                defaultValue: new Sk.builtin.str("medium"),
                pyVal: true,
                important: false,
                priority: 0,
                set(s, e, v) {
                    const prefix = getCssPrefix();
                    v = v.toString();
                    for (let i of ["none", "tiny", "small", "medium", "large", "huge"]) {
                        s._anvil.domNode.classList.toggle(prefix + "col-padding-" + i, v === i);
                    }
                    s._anvil.components.forEach(({ component }) => {
                        const el = component.anvil$hooks.domElement;
                        if (!el.parentElement) return;
                        el.parentElement.className = `${prefix}col-padding ${prefix}col-padding-${v} belongs-to-${s._anvil.panelId}`;
                    });
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents("column panel", /*!componentEvents(ColumnPanel)!1*/ ["universal"]),

        element({ col_spacing, ...props }) {
            const prefix = getCssPrefix();
            const colSpacing = ` ${prefix}col-padding-${col_spacing}`;
            return <PyDefUtils.OuterElement className={`${prefix}column-panel anvil-container ${colSpacing}`} {...props} />;
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
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicContainer"], (self) => {
                self._anvil.panelId = getRandomStr(6);
                self._anvil.rows = {};
                self._anvil.cols = {};

                self._anvil.componentColumnContainers = new WeakMap();

                self._anvil.generateNewLayoutProps = (basedOn) => {
                    // For now, this is pretty naive. Just create a new row/col for the component.

                    // TODO: Insert the new component in a row on its own below the basedOn row. Do
                    // this in a repeatable way so that multiple components copied from the same
                    // row land on the same new row. Copy col_widths from the basedOn row.

                    return {
                        col_widths: (basedOn && basedOn.col_widths) || {},
                        grid_position: getRandomStr(6) + "," + getRandomStr(6),
                        full_width_row: basedOn && basedOn.full_width_row,
                    };
                };

                self._anvil.setLayoutProperties = function (pyChild, layoutProperties) {
                    const ps = {};
                    // Assume this only gets called from the designer, so pyChild will have a name (and be a ClassicComponent)
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
                const superClear = pyModule["ClassicContainer"].tp$getattr(new pyStr("clear"));
                return chainOrSuspend(pyCallOrSuspend(superClear, [self]), () => {
                    self._anvil.element.empty();
                    self._anvil.rows = {};
                    self._anvil.cols = {};
                    return pyNone;
                });
            });



            const Section = ({ panelId, full_width_row, row_background }) => {
                const prefix = getCssPrefix();
                const fwrClass = full_width_row ? prefix + "full-width-row" : "";
                const background = row_background ? "background:" + PyDefUtils.getColor(row_background) + ";" : "";
                return (
                    <div refName="section" className={`anvil-panel-section belongs-to-${panelId}`} style={background}>
                        <div refName="sectionContainer" className={`anvil-panel-section-container anvil-container-overflow belongs-to-${panelId} ${fwrClass}`}>
                            <div refName="sectionGutter" className={`anvil-panel-section-gutter belongs-to-${panelId}`}></div>
                        </div>
                    </div>
                );
            };

            const Row = ({ rowId, panelId, wrap_on }) => {
                const prefix = getCssPrefix();
                wrap_on = prefix + "wrap-" + wrap_on.toString();
                return <div refName="row" data-anvil-row-id={rowId} className={`anvil-panel-row anvil-panel-row-${rowId} belongs-to-${panelId} ${wrap_on}`}></div>;
            };

            const Column = ({ colId, panelId, wrap_on }) => {
                const prefix = getCssPrefix();
                wrap_on = prefix + "wrap-" + wrap_on.toString();
                return <div refName="col" data-anvil-col-id={colId} className={`anvil-panel-col anvil-panel-col-${colId} belongs-to-${panelId} ${wrap_on}`}></div>;
            };


            class PanelContainer {
                constructor(columnPanel, el, slotEl = null) {
                    this.columnPanel = columnPanel;
                    this.parent = null;
                    this.children = 0;
                    this.el = el;
                    this.slotEl = slotEl || el;
                }
                appendChildContainer(childContainer) {
                    this.children++;
                    this.slotEl.appendChild(childContainer.el);
                    childContainer.parent = this;
                }
                appendChild(child) {
                    this.children++;
                    this.slotEl.appendChild(child);
                }
                remove() {
                    this.children--;
                    if (this.children === 0) {
                        this.el.remove();
                        this.cleanup();
                        this.parent?.remove();
                    }
                }
                cleanup() {}
            }
            class ColContainer extends PanelContainer {
                constructor(columnPanel, colId, props) {
                    const [el] = <Column colId={colId} {...props} />;
                    super(columnPanel, el);
                    columnPanel._anvil.cols[colId] = this;
                    this.colId = colId;
                }
                cleanup() {
                    delete this.columnPanel._anvil.cols[this.colId];
                }
            }

            class RowContainer extends PanelContainer {
                constructor(columnPanel, rowId, props) {
                    const [el] = <Row rowId={rowId} {...props} />;
                    super(columnPanel, el);
                    columnPanel._anvil.rows[rowId] = this;
                    this.rowId = rowId;
                }
                cleanup() {
                    delete this.columnPanel._anvil.rows[this.rowId];
                }
            }

            class SectionContainer extends PanelContainer {
                constructor(columnPanel, props) {
                    const [section, sectionElements] = <Section {...props} />;
                    super(columnPanel, section, sectionElements.sectionGutter);
                }
            }

            /*
                ColumnPanel DOM structure:
    
                .anvil-container.(anvil-)column-panel                  The main container
                    .anvil-panel-section                               Section deals with full-width-row and row-background, etc. Each top-level row is in its own section
                    |   .anvil-panel-section-container                 Sets width based on responsive breakpoints
                    |       .anvil-panel-section-gutter                Negative margins for columns
                    |           .anvil-panel-row                       Container for columns
                    |               .anvil-panel-col                   Column
                    |               |    .anvil-panel-row              Rows and columns can be arbitrarily nested
                    |               |        .anvil-panel-col
                    |               |            .(anvil-)col-padding  Column spacing only in innermost column, around component.
                    |               |                <Component>
                    |               |
                    |               *
                    | 
                    *   
            */

            /*!defMethod(_,component,full_width_row=False,**layout_props)!2*/ "Add a component to the bottom of this ColumnPanel. Useful layout properties:\n\n  full_width_row = True|False\n  row_background = [colour]"
            $loc["add_component"] = new PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                validateChild(component);

                return Sk.misceval.chain(
                    component.anvil$hooks.setupDom(),
                    (_rawComponentElement) => {
                        if (isInvisibleComponent(component)) {
                            return pyModule["ClassicContainer"]._doAddComponent(self, component);
                        }
                        const prefix = getCssPrefix();

                        const panelId = self._anvil.panelId;
                        const wrap_on = self._anvil.props["wrap_on"];

                        const {index, ...layoutProps} = kwargs;

                        if (component._anvil) { // this had better be for the designer's benefit only
                            component._anvil.layoutProps = layoutProps;
                        }

                        const _add = (component, layoutProps, childIdx) => {
                            const componentElement = component.anvil$hooks.domElement;
                            componentElement.classList.add("belongs-to-" + panelId);
                            const {grid_position: gridPos, full_width_row, row_background} = layoutProps;
                            const props = {panelId, wrap_on, full_width_row, row_background};

                            const levels = gridPos?.split(" ") || [getRandomStr(6) + "," + getRandomStr(6)];
                            let currentColContainer = undefined;
                            for (const level of levels) {
                                const [rowId, colId] = level.split(",");

                                let rowContainer = self._anvil.rows[rowId];
                                if (rowContainer === undefined) {
                                    // This row doesn't exist yet
                                    rowContainer = new RowContainer(self, rowId, props);
                                    if (currentColContainer === undefined) {
                                        // We're still at the first level. Create a new section, then append the Row inside that
                                        currentColContainer = new SectionContainer(self, props);
                                        self._anvil.domNode.appendChild(currentColContainer.el);
                                    }
                                    currentColContainer.appendChildContainer(rowContainer);
                                }
                                let colContainer = self._anvil.cols[colId];
                                if (colContainer === undefined) {
                                    // This column doesn't exist yet
                                    colContainer = new ColContainer(self, colId, props);
                                    rowContainer.appendChildContainer(colContainer);
                                }
                                currentColContainer = colContainer;
                                setColumnWidths(self, rowContainer.el);
                            }
                            
                            if (ANVIL_IN_DESIGNER) {
                                componentElement.dataset.anvilDesignerPanelChildIdx = childIdx;
                                componentElement.dataset.anvilDesignerPanelGridPos = gridPos;
                                componentElement.dataset.anvilDesignerColumnpanelComponent = ""; // So we can use a selector to find all components in this columnpanel later.
                            }

                            const paddingClassName = `${prefix}col-padding belongs-to-${panelId} ${prefix}col-padding-${self._anvil.getPropJS("col_spacing")}`;
                            const [paddingElement] = <div refName="padding"
                                                          className={paddingClassName}/>;
                            self._anvil.componentColumnContainers.set(component, currentColContainer);
                            currentColContainer.appendChild(paddingElement);
                            paddingElement.appendChild(componentElement);
                        }

                        if (index == null || index === self._anvil.components.length) {

                            _add(component, layoutProps, self._anvil.components.length);

                        } else {
                            // We're inserting this component in the middle of the ColumnPanel. We can't really do that, so rebuild it from scratch. Carefully.
                            self._anvil.element[0].innerHTML = ''; // Can't use jQuery .empty() here, because that will nuke component event handlers. Sigh.
                            self._anvil.rows = {};
                            self._anvil.cols = {};

                            const withNewComponent = [...self._anvil.components];
                            withNewComponent.splice(index, 0, {component, layoutProperties: layoutProps});
                            withNewComponent.map(({component, layoutProperties}, idx) => _add(component, layoutProperties, idx));
                        }

                        return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs, {
                            detachDom: () => {
                                const componentElement = component.anvil$hooks.domElement;

                                if (ANVIL_IN_DESIGNER) {
                                    // Adjust the cached childIdx on all later children.
                                    const oldChildIdx = parseInt(componentElement.dataset.anvilDesignerPanelChildIdx);

                                    for (const el of self._anvil.domNode.querySelectorAll(
                                        "[data-anvil-designer-columnpanel-component].belongs-to-" + self._anvil.panelId
                                    )) {
                                        const currentIdx = parseInt(el.dataset.anvilDesignerPanelChildIdx);
                                        if (currentIdx > oldChildIdx) {
                                            el.dataset.anvilDesignerPanelChildIdx = currentIdx - 1;
                                        }
                                    }
                                    delete componentElement.dataset.anvilDesignerPanelChildIdx;
                                    delete componentElement.dataset.anvilDesignerPanelGridPos;
                                    delete componentElement.dataset.anvilDesignerColumnpanelComponent;
                                }

                                // Remove this child, it's associated wrappers and columnPanel data.
                                componentElement.parentElement?.remove();
                                componentElement.classList.remove("belongs-to-" + self._anvil.panelId);
                                // Possibly remove the entire col container, if this was the last child.
                                self._anvil.componentColumnContainers.get(component)?.remove?.();
                            },
                        });
                    }
                );
            });
        },
    });

    function setColumnWidths(self, row) {
        // Set all the columns in this row to the right width.
        const clientFailMsg = "The col_widths property is created from the design layout and should not be called in code";
        let colWidths;
        try {
            colWidths = JSON.parse(self._anvil.getPropJS("col_widths") || "{}");
        } catch {
            throw new Sk.builtin.TypeError(clientFailMsg);
        }
        if (typeof colWidths !== "object") {
            // don't throw since there may be existing projects quietly using the col_widths property
            Sk.builtin.print([clientFailMsg]);
        }
        const allCols = row.querySelectorAll(":scope >.anvil-panel-col");
        const colCount = allCols.length;
        const defaultColWeight = Math.floor(60 / colCount);

        let totalWeight = 0;
        allCols.forEach((e) => {
            totalWeight += colWidths[e.dataset.anvilColId] || defaultColWeight;
        });

        let remainder = 0;
        if (Math.abs(totalWeight - 12) < 0.5) {
            // This is an old ColumnPanel. Convert 12-col to 60-col
            allCols.forEach((e) => {
                colWidths[e.dataset.anvilColId] *= 5;
            });
        } else if (totalWeight < 60) {
            remainder = 60 - totalWeight;
        }

        allCols.forEach((e, i) => {
            const colId = e.dataset.anvilColId;
            let w = colWidths[colId] || defaultColWeight;
            if (i < remainder) {
                w += 1;
            }
            e.style.setProperty("flex-grow", w);
        });
    }


    // This should only get called from the designer
    function updateSharedLayoutProps(self) {
        const prefix = getCssPrefix();

        self._anvil.element.find(".anvil-component.belongs-to-" + self._anvil.panelId).each(function (_, e) {
            e = $(e);
            var c = e.data("anvil-py-component");

            var lps = c._anvil.layoutProps || {};
            if (lps.full_width_row) {
                e.parents(".anvil-panel-section-container").first().addClass(prefix + "full-width-row");
            } else {
                e.parents(".anvil-panel-section-container").first().removeClass(prefix + "full-width-row");
            }
            let v = "transparent";
            if (lps.row_background) {
                v = PyDefUtils.getColor(lps.row_background);
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
