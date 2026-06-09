import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap } from "@runtime/runner/py-util";
import { chainOrSuspend, pyCallOrSuspend, pyFunc } from "@Sk";
import PyDefUtils from "PyDefUtils";
import { ClassicComponentConstructor } from "./ClassicComponent";
import { ClassicContainer } from "./ClassicContainer";
import { Component } from "./Component";
import { validateChild } from "./Container";
import { isInvisibleComponent } from "./helpers";

/*#
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

interface GridPanelRow {
    element: HTMLDivElement;
    lastCol: { xs?: number; sm?: number; md?: number; lg?: number };
}

interface GridPanelComponent {
    pyComponent: Component;
    row: string;
    lastCol: { xs?: number; sm?: number; md?: number; lg?: number };
    layoutProperties: any;
}

interface GridPanelAnvil {
    gridComponents: GridPanelComponent[];
    getContainerClassList?: (row: GridPanelRow, component: GridPanelComponent) => string[];
    rows: { [rowName: string]: GridPanelRow };
}

interface GridPanel extends ClassicContainer<GridPanelAnvil> {}

const GridPanelFactory = (pyModule: PyModMap) => {
    const ClassicContainer = pyModule["ClassicContainer"] as ClassicComponentConstructor;

    pyModule["GridPanel"] = PyDefUtils.mkComponentCls<GridPanel>(pyModule, "GridPanel", {
        base: ClassicContainer,

        properties: PyDefUtils.assembleGroupProperties<GridPanel>(
            /*!componentProps(GridPanel)!2*/ [
                "layout",
                "layout_spacing",
                "containers",
                "appearance",
                "user data",
                "tooltip",
            ]
        ),

        events: PyDefUtils.assembleGroupEvents("grid panel", /*!componentEvents(GridPanel)!1*/ ["universal"]),

        element: (props) => (
            <PyDefUtils.OuterElement className={`${getCssPrefix()}grid-panel anvil-container`} {...props} />
        ),

        layouts: [
            { name: "row", type: "string", description: "The name of the row to add the component to.", hidden: true },
            ...(["xs", "sm", "md", "lg"] as const).flatMap((size) => [
                { name: `col_${size}`, type: "number" as const, description: `The starting column on ${size} screens, in the range 0-11.`, hidden: true },
                { name: `width_${size}`, type: "number" as const, description: `The width in columns on ${size} screens, in the range 1-12.`, hidden: true },
            ]),
        ],

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<GridPanel>(ClassicContainer, (self) => {
                self._anvil.gridComponents = [];
                if (ANVIL_IN_DESIGNER) {
                    self._anvil.getContainerClassList = getContainerClassList;
                }
                // component = {pyComponent: (pyObj), row: (id), lastCol: {xs: 0-12, sm: 0-12, ...}
                self._anvil.rows = {};
                // row = {element: (div), lastCol: {xs: 0-12, sm: 0-12, ...}}
            });

            const ContainerElement = ({ classList }: { classList: string }) => <div className={classList} />;

            /*!defMethod(_,component,[row=],[col_xs=],[width_xs=])!2*/ ("Add a component to this GridPanel");
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function add_component(
                kwargs: any,
                self: GridPanel,
                pyComponent: Component
            ) {
                validateChild(pyComponent);

                const rowName = kwargs["row"];
                let celt: HTMLDivElement;

                return chainOrSuspend(pyComponent.anvil$hooks.setupDom(), (domNode) => {
                    // TODO set pyComponent._anvil.parent.remove to a closure that deletes the row if necessary
                    if (isInvisibleComponent(pyComponent)) {
                        return ClassicContainer._doAddComponent(self, pyComponent);
                    }

                    let row = self._anvil.rows[rowName];

                    if (!row) {
                        const prefix = getCssPrefix();
                        // TODO allow a way of manually inserting into the middle rather than at the bottom?
                        const element = document.createElement("div");
                        element.className = prefix + "row";
                        element.style.marginBottom = PyDefUtils.cssLength(self._anvil.getPropJS("row_spacing"));
                        element.setAttribute("data-anvil-gridpanel-row", rowName);
                        row = { element, lastCol: {} };
                        self._anvil.rows[rowName] = row;
                        self._anvil.domNode.appendChild(row.element);
                    }

                    const component: GridPanelComponent = {
                        pyComponent: pyComponent,
                        row: rowName,
                        lastCol: {},
                        layoutProperties: kwargs,
                    };

                    const classList = getContainerClassList(row, component);

                    const [containerElement] = (<ContainerElement classList={classList.join(" ")} />) as [
                        HTMLDivElement,
                        {}
                    ];
                    celt = containerElement;
                    celt.appendChild(domNode);

                    if (ANVIL_IN_DESIGNER) {
                        // only ever used in the designer.
                        self._anvil.gridComponents.push(component);
                    }

                    row.element.appendChild(celt);

                    return ClassicContainer._doAddComponent(self, pyComponent, kwargs, {
                        detachDom() {
                            celt.remove();
                            if (row.element.children.length === 0) {
                                delete self._anvil.rows[rowName];
                                row.element.remove();
                            }
                        },
                    });
                });
            });

            $loc["clear"] = new pyFunc(function clear(self: GridPanel) {
                const ret = pyCallOrSuspend(ClassicContainer.prototype.clear, [self]);

                self._anvil.domNode.innerHTML = "";
                self._anvil.gridComponents = [];
                self._anvil.rows = {};

                return ret;
            });
        },
    });

    function getContainerClassList(row: GridPanelRow, component: GridPanelComponent): string[] {
        let width = 12,
            offset = 0, // Default to full-width, zero offset, inherit small-to-large
            classList: string[] = [];
        const kwargs = component.layoutProperties;
        const prefix = getCssPrefix();
        ["xs", "sm", "md", "lg"].forEach((size) => {
            const w = kwargs["width_" + size];
            if (w) {
                width = parseInt(w);
            }
            classList.push(prefix + "col-" + size + "-" + width);
            const lastCol = row.lastCol[size as keyof typeof row.lastCol] || 0;

            const xRequest = kwargs["col_" + size];
            if (xRequest && parseInt(xRequest) > lastCol) {
                offset = parseInt(xRequest) - lastCol;
                classList.push(prefix + "col-" + size + "-offset-" + offset);
            }
            const newLastCol = lastCol + width + offset;
            row.lastCol[size as keyof typeof row.lastCol] = newLastCol;
            component.lastCol[size as keyof typeof component.lastCol] = newLastCol;
        });

        return classList;
    }
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

export default GridPanelFactory;
