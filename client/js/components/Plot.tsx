/* global Plotly */

/*#
id: plot
docs_url: /docs/client/components/plots
module: Anvil Components
kind: class
title: Plot
tooltip: Learn more about Plots
description: |
  ```python
  # Create a plot

  b = Plot()
  ```

  This is a Plotly Plot. Drag and drop onto your form, or create one in code with the `Plot` constructor.

  Plots are interactive - move the mouse over a plot to see the available tools.

  ```python
  from plotly import graph_objects as go

  # Configure the plot layout
  self.plot_1.layout.title = 'Simple Example'
  self.plot_1.layout.xaxis.title = 'time'
  self.plot_1.layout.annotations = [
      dict(
        text = 'Simple annotation',
        x = 0,
        xref = 'paper',
        y = 0,
        yref = 'paper'
      )
  ]

  # Plot some data
  self.plot_1.data = [
    go.Scatter(
      x = [1, 2, 3],
      y = [3, 1, 6],
      marker = dict(
        color= 'rgb(16, 32, 77)'
      )
    ),
    go.Bar(
      x = [1, 2, 3],
      y = [3, 1, 6],
      name = 'Bar Chart Example'
    )
  ]
  ```

  Plots are configured using utility classes from the plotly.graph_objects module. Display a plot by setting the `data` and `layout` 
  properties of the Plot component. The `data` property should be set to a list of traces as [described in the plotly documentation](https://plot.ly/python/reference/). 
  The `layout` property should be set to a dictionary describing the layout of the plot.

  Plots are interactive by default - you can handle events raised when the user clicks, selects or hovers over data points. The `click`, `select`, `hover` and `unhover` events all provide a `points` keyword argument. This is a list of dictionaries, each with the following keys:
  \* `curve_number` - the index of the data series that was clicked.
  \* `point_number` - the index of the data point that was clicked. Not available for histograms.
  \* `point_numbers` - a list of indices of the points aggregated into the clicked bin. Only available for histograms.
  \* `x`, `y`, `z`, `lat`, `lon` - the position of the point that was clicked, depending on the plot type.

  Plots are interactive by default. Create a static plot by setting the `interactive` property to `False`.

  See [the Plotly documentation](https://plot.ly/python/) for more details and examples.


*/
import { SpinnerLoader, appendSvgSpinner } from "@runtime/runner/loading-spinner";
import { PyModMap, datetimeMod, pyLazyMod } from "@runtime/runner/py-util";
import {
    promiseToSuspension,
    proxy,
    pyCall,
    pyDict,
    pyFunc,
    pyInt,
    pyList,
    pyNone,
    pyStr,
    pyType,
    toJs,
    toPy,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { PostponedResizeObserver } from "../utils";
import { ClassicComponent, ClassicComponentConstructor } from "./ClassicComponent";

interface PlotAnvil {
    elements: { root: HTMLDivElement; spinner: HTMLElement };
    plotlyUpdated: boolean;
    initialized: boolean;
    spinnerLoader: SpinnerLoader;
}

interface Plot extends ClassicComponent<PlotAnvil> {}

const PlotFactory = (pyModule: PyModMap) => {
    const go = pyLazyMod("plotly.graph_objs");
    const util = pyLazyMod("anvil.util");
    const date = datetimeMod.date as pyType;
    const datetime = datetimeMod.datetime as pyType;

    const remapToJs = (pyObj: any): any => {
        if (pyObj == null) {
            return null;
        }
        return PyDefUtils.remapToJs(pyObj, (o: any) => {
            if (o instanceof date || o instanceof datetime) {
                return o.toString();
            }
        });
    };

    const Templates: { [key: string]: any } = {
        none: {},
        default: "none",
        // backwards compatibility
        get rally() {
            return this.rally_dark;
        },
    };

    const PLOTLY_FETCHABLE_TEMPLATES = [
        "plotly",
        "plotly_white",
        "plotly_dark",
        "presentation",
        "ggplot2",
        "seaborn",
        "simple_white",
        "gridon",
        "xgridoff",
        "ygridoff",
    ];
    const ANVIL_FETCHABLE_TEMPLATES = [
        "rally_dark",
        "rally_light",
        "manarola_light",
        "manarola_dark",
        "mykonos_light",
        "mykonos_dark",
        "material_light",
        "material_dark",
    ];

    async function templateGetter(templateName: string): Promise<any> {
        const resp = await fetch(`${window.anvilAppOrigin}/_/static/runtime/js/lib/templates/${templateName}.json`);
        return await resp.json();
    }

    function defineLazyTemplate(templateName: string): void {
        Object.defineProperty(Templates, templateName, {
            get() {
                // lazy template
                delete this[templateName];
                return (this[templateName] = new Promise(async (resolve) => {
                    try {
                        resolve((this[templateName] = await templateGetter(templateName)));
                    } catch (err) {
                        console.error(err);
                        resolve((this[templateName] = {}));
                    }
                }));
            },
            enumerable: true,
            configurable: true,
        });
    }
    PLOTLY_FETCHABLE_TEMPLATES.forEach(defineLazyTemplate);
    ANVIL_FETCHABLE_TEMPLATES.forEach(defineLazyTemplate);

    // There are several places in the component model where we directly access the props
    // Plot.js does this a lot
    // It might be a good idea to avoid doing this
    // See closed pr #2890 which has one possible approach using a beforeSet hook

    const ClassicComponent = pyModule["ClassicComponent"] as ClassicComponentConstructor;

    pyModule["Plot"] = PyDefUtils.mkComponentCls<Plot>(pyModule, "Plot", {
        base: ClassicComponent,
        properties: PyDefUtils.assembleGroupProperties<Plot>(
            /*!componentProps(Plot)!2*/ ["layout", "layout_margin", "height", "visibility", "tooltip", "user data"],
            {
                height: {
                    defaultValue: new pyInt(450),
                },
                data: /*!componentProp(Plot)!1*/ {
                    name: "data",
                    pyVal: true,
                    type: "object",
                    //pyType: "dict",
                    description: "Plot traces",
                    hidden: true,
                    suggested: true,
                    initialize: true,
                    set(s, e, v) {
                        const WrappedList = util.WrappedList as pyType;
                        // Must be set to a list. Wrap it in anvil.util.WrappedList
                        if (v instanceof pyDict) {
                            // If the user supplies a dict instead of a list, wrap it in a list and just Do The Right Thing.
                            s._anvil.props.data = pyCall(WrappedList, [new pyList([v])]);
                        } else if (!(v instanceof WrappedList)) {
                            // Assume they passed in something iterable.
                            s._anvil.props.data = pyCall(WrappedList, [v]);
                        } else {
                            // Assume they passed in a WrappedList
                            s._anvil.props.data = v;
                        }
                        return update(s);
                    },
                    get(s, e) {
                        s._anvil.props.data = s._anvil.props.data || pyCall(util.WrappedList);
                        return s._anvil.props.data;
                    },
                },

                layout: /*!componentProp(Plot)!1*/ {
                    name: "layout",
                    pyVal: true,
                    type: "object",
                    pyType: "plotly.graph_objs.Layout instance",
                    description: "Plot layout",
                    hidden: true,
                    initialize: true,
                    set(s, e, v) {
                        const WrappedObject = util.WrappedObject as pyType;
                        // Must be set to a dict. Wrap it in an anvil.util.WrappedDict
                        if (v instanceof WrappedObject) {
                            s._anvil.props.layout = v;
                        } else {
                            // use go.Layout to clean up any plotly properties
                            s._anvil.props.layout = pyCall(go.Layout, [v]);
                        }
                        return update(s);
                    },
                    get(s, e) {
                        s._anvil.props.layout = s._anvil.props.layout || pyCall(go.Layout, [toPy({ template: {} })]);
                        return s._anvil.props.layout;
                    },
                },

                config: /*!componentProp(Plot)!1*/ {
                    name: "config",
                    pyVal: true,
                    type: "dict",
                    description: "Plot config",
                    hidden: true,
                    initialize: true,
                    set(s, e, v) {
                        s._anvil.props.config = v;
                        return update(s);
                    },
                    get(s, e) {
                        s._anvil.props.config = s._anvil.props.config || toPy({});
                        return s._anvil.props.config;
                    },
                },

                figure: /*!componentProp(Plot)!1*/ {
                    name: "figure",
                    pyVal: true,
                    type: "dict",
                    description: "The Plotly figure to display. Specifies layout and data.",
                    hidden: true,
                    initialize: true,
                    set(s, e, pyFigure) {
                        const WrappedObject = util.WrappedObject as pyType;
                        if (!(pyFigure instanceof WrappedObject)) {
                            // they may have supplied a dict so turn it into a wrapped object
                            pyFigure = pyCall(go.Figure, [pyFigure]);
                        }

                        // Replace the plot layout with layout from the figure - this wil be a wrapped object
                        s._anvil.props.layout = pyCall(go.Layout, [pyFigure.tp$getattr(new pyStr("layout"))]);

                        // Replace the plot data with data from the figure and let data call update
                        return s._anvil.setProp("data", pyFigure.tp$getattr(new pyStr("data")));
                    },
                    get(self, e) {
                        return pyCall(go.Figure, [
                            toPy({
                                layout: self._anvil.getProp("layout"),
                                data: self._anvil.getProp("data"),
                            }),
                        ]);
                    },
                },
                interactive: /*!componentProp(Plot)!1*/ {
                    name: "interactive",
                    type: "boolean",
                    description: "Whether this plot should be interactive",
                    defaultValue: Sk.builtin.bool.true$,
                    pyVal: true,
                    set(s, e, v) {
                        if (!ANVIL_IN_DESIGNER) return update(s);
                    },
                },
            }
        ),

        events: PyDefUtils.assembleGroupEvents("Plot", /*!componentEvents(Plot)!1*/ ["universal"], {
            click: /*!componentEvent(Plot)!1*/ {
                name: "click",
                description: "when a data point is clicked.",
                parameters: [
                    {
                        name: "points",
                        description: "A list of the data points that were clicked.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            double_click: /*!componentEvent(Plot)!1*/ {
                name: "double_click",
                description: "when the plot is double-clicked.",
                parameters: [],
                important: true,
                defaultEvent: false,
            },
            afterplot: /*!componentEvent(Plot)!1*/ {
                name: "afterplot",
                description: "after then plot is redrawn.",
                parameters: [],
                important: true,
                defaultEvent: false,
            },
            select: /*!componentEvent(Plot)!1*/ {
                name: "select",
                description: "when a data point is selected.",
                parameters: [
                    {
                        name: "points",
                        description: "A list of the data points that were selected.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: false,
            },
            hover: /*!componentEvent(Plot)!1*/ {
                name: "hover",
                description: "when a data point is hovered.",
                parameters: [
                    {
                        name: "points",
                        description: "A list of the data points that were hovered.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: false,
            },

            unhover: /*!componentEvent(Plot)!1*/ {
                name: "unhover",
                description: "when a data point is unhovered.",
                parameters: [
                    {
                        name: "points",
                        description: "A list of the data points that were unhovered.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: false,
            },
        }),

        element: (props) => (
            <PyDefUtils.OuterElement className="anvil-plot" {...props}>
                <div refName="spinner" className="plotly-loading-spinner anvil-spinner" style="opacity:0" />
            </PyDefUtils.OuterElement>
        ),

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<Plot>(ClassicComponent, (self) => {
                self._anvil.plotlyUpdated = false;
                self._anvil.initialized = false;
                appendSvgSpinner(self._anvil.elements.spinner);
                self._anvil.spinnerLoader = SpinnerLoader.getOrCreate(self._anvil.elements.spinner);

                const resizeObserver = new PostponedResizeObserver(() => {
                    if (self._anvil.onPage) {
                        relayout(self);
                    }
                });

                self._anvil.pageEvents = {
                    add() {
                        self._anvil.initialized = true;
                        resizeObserver.observe(self._anvil.domNode);
                        return update(self);
                    },
                    remove() {
                        resizeObserver.disconnect();
                    },
                };
            });

            /*!defAttr()!1*/ ({
                name: "templates",
                type: "mapping",
                description:
                    "plotly templates, see plotly docs for valid template names. Set the default template using Plot.templates.default = 'seaborn'.",
            });
            $loc["templates"] = proxy(
                new Proxy(Templates, {
                    get(t: typeof Templates, v: string | symbol): any {
                        const rv = t[v as string];
                        if (!(rv instanceof Promise)) return rv;
                        return promiseToSuspension(rv);
                    },
                    set(t: typeof Templates, k: string | symbol, v: any): boolean {
                        (t as any)[k] = v;
                        return true;
                    },
                })
            );

            /*!defMethod(_)!2*/ ("Redraws the chart. Call this function if you have updated data or layout properties.");
            $loc["redraw"] = new pyFunc(function redraw(self: Plot) {
                return update(self);
            });

            /*!defMethod(_,data,traces)!2*/ ("Adds data to an existing trace.");
            $loc["extend_traces"] = new pyFunc(function extend_traces(self: Plot, pyData: any, pyIndices: any) {
                loadPlotly(self).then(() =>
                    Plotly.extendTraces(self._anvil.domNode, remapToJs(pyData), remapToJs(pyIndices))
                );
                return pyNone;
            });

            /*!defMethod(_,data,traces)!2*/ ("Prepends data to an existing trace.");
            $loc["prepend_traces"] = new pyFunc(function prepend_traces(self: Plot, pyData: any, pyIndices: any) {
                loadPlotly(self).then(() =>
                    Plotly.prependTraces(self._anvil.domNode, remapToJs(pyData), remapToJs(pyIndices))
                );
                return pyNone;
            });

            /*!defMethod(_,update,traces)!2*/ ("A more efficient means of changing attributes in the data array. When restyling, you may choose to have the specified changes effect as many traces as desired.");
            $loc["restyle"] = new pyFunc(function restyle(self: Plot, pyUpdate: any, pyIndices: any) {
                loadPlotly(self).then(() =>
                    Plotly.restyle(
                        self._anvil.domNode,
                        remapToJs(pyUpdate),
                        pyIndices ? remapToJs(pyIndices) : undefined
                    )
                );
                return pyNone;
            });

            /*!defMethod(_,update)!2*/ ("A more efficient means of updating just the layout in a graphDiv. The call signature and arguments for relayout are similar (but simpler) to restyle.");
            $loc["relayout"] = new pyFunc(function relayout(self: Plot, pyUpdate: any) {
                loadPlotly(self).then(() => Plotly.relayout(self._anvil.domNode, remapToJs(pyUpdate)));
                return pyNone;
            });

            /*!defMethod(anvil.URLMedia instance,options)!2*/ ("Returns a Media object containing a snapshot of this plot. The argument is a dictionary specifying image options.");
            $loc["to_image"] = new pyFunc(function to_image(self: Plot, pyOptions: any) {
                return PyDefUtils.suspensionFromPromise(
                    loadPlotly(self)
                        .then(() =>
                            Plotly.toImage(self._anvil.domNode, pyOptions ? remapToJs(pyOptions) : { format: "png" })
                        )
                        .then((i) => pyCall(pyModule["URLMedia"], [toPy(i)]))
                );
            });
        },
    });

    let plotlyPromise: Promise<void> | undefined;

    function loadPlotly(self: Plot): Promise<void> {
        const plotlySrc =
            window.anvilAppOrigin + "/_/static/runtime/js/lib/plotly-latest.min.js?buildTime=" + BUILD_TIME;
        plotlyPromise ??= PyDefUtils.loadScript(plotlySrc);
        const spinnerLoader = self._anvil.spinnerLoader;
        return PyDefUtils.withDelayPrint(spinnerLoader.withIndicator(plotlyPromise));
    }

    const selectKeysIfPresent = (map: any, keys: any): any => {
        const r: any = {};
        for (const k of keys || []) {
            if (typeof k == "string") {
                if (k in map) {
                    r[k] = map[k];
                }
            } else {
                // map of old name -> new name
                for (const j in k) {
                    if (j in map) {
                        r[k[j]] = map[j];
                    }
                    break;
                }
            }
        }
        return r;
    };

    const onPlotlyClick = (self: Plot, data: any): boolean => {
        PyDefUtils.raiseEventAsync(
            {
                points: toPy(
                    data.points.map((p: any) =>
                        selectKeysIfPresent(p, [
                            { curveNumber: "curve_number" },
                            { pointNumber: "point_number" },
                            { pointNumbers: "point_numbers" },
                            "x",
                            "y",
                            "z",
                            "lat",
                            "lon",
                        ])
                    )
                ),
            },
            self,
            "click"
        );
        return false;
    };

    const onPlotlyDoubleClick = (self: Plot): boolean => {
        PyDefUtils.raiseEventAsync({}, self, "double_click");
        return false;
    };

    const onPlotlySelect = (self: Plot, data: any): boolean => {
        PyDefUtils.raiseEventAsync(
            {
                points: toPy(
                    data
                        ? data.points.map((p: any) =>
                              selectKeysIfPresent(p, [
                                  { curveNumber: "curve_number" },
                                  { pointNumber: "point_number" },
                                  { pointNumbers: "point_numbers" },
                                  "x",
                                  "y",
                                  "z",
                                  "lat",
                                  "lon",
                              ])
                          )
                        : []
                ),
            },
            self,
            "select"
        );
        return false;
    };

    const onPlotlyHover = (self: Plot, data: any): boolean => {
        PyDefUtils.raiseEventAsync(
            {
                points: toPy(
                    data.points.map((p: any) =>
                        selectKeysIfPresent(p, [
                            { curveNumber: "curve_number" },
                            { pointNumber: "point_number" },
                            { pointNumbers: "point_numbers" },
                            "x",
                            "y",
                            "z",
                            "lat",
                            "lon",
                        ])
                    )
                ),
            },
            self,
            "hover"
        );
        return false;
    };

    const onPlotlyUnhover = (self: Plot, data: any): boolean => {
        // Probable bug in plotly: When using scattergl, data is undefined. Weird.
        PyDefUtils.raiseEventAsync(
            {
                points:
                    data &&
                    toPy(
                        data.points.map((p: any) =>
                            selectKeysIfPresent(p, [
                                { curveNumber: "curve_number" },
                                { pointNumber: "point_number" },
                                { pointNumbers: "point_numbers" },
                                "x",
                                "y",
                                "z",
                                "lat",
                                "lon",
                            ])
                        )
                    ),
            },
            self,
            "unhover"
        );
        return false;
    };

    const onPlotlyAfterplot = (self: Plot): boolean => {
        PyDefUtils.raiseEventAsync({}, self, "afterplot");
        return false;
    };

    // For some reason, this doesn't ever get called. Possibly we're on an old version of Plotly. Work it out if anyone needs it.
    // let onPlotlyLegendClick = (self, data) => {
    //   PyDefUtils.raiseEventAsync({curve_number: data.curveNumber}, self, "legend_click");
    //   return false;
    // }
    function notReady(self: Plot): boolean {
        return !self._anvil.initialized || (!self._anvil.props.layout && !self._anvil.props.data);
    }

    function getJsLayout(self: Plot): any {
        const jsLayout = remapToJs(self._anvil.props.layout) || {};
        jsLayout.height = self._anvil.element.height();
        jsLayout.width = self._anvil.element.width();
        return jsLayout;
    }

    function update(self: Plot): any {
        if (notReady(self)) return;

        const jsLayout = getJsLayout(self);

        async function getTemplate(): Promise<void> {
            // In Figure objects that came from the server, template will be an empty object {}. Treat this as if it's missing entirely.
            let template: any =
                jsLayout.template && Object.keys(jsLayout.template).length > 0 ? jsLayout.template : Templates.default;
            if (typeof template === "string") {
                try {
                    template = toJs(await Templates[template as string]);
                    jsLayout.template = template;
                } catch (e) {
                    console.warn(e);
                }
            }
        }

        const jsData = remapToJs(self._anvil.props.data) || [];
        const jsConfig = remapToJs(self._anvil.props.config) || {
            displayLogo: false,
            displaylogo: false,
            staticPlot: !self._anvil.getPropJS("interactive"),
        };

        // Do not block here. There's no need, no code depends on the result.
        // If we decide we need to block, just return a suspension here.
        PyDefUtils.withDelayPrint(
            loadPlotly(self)
                .then(getTemplate)
                .then(async () => {
                    const outerEl = self._anvil.domNode;
                    // react is faster than newPlot on the same div element
                    const plotlyEl = await Plotly.react(outerEl, jsData, jsLayout, jsConfig);
                    if (!self._anvil.plotlyUpdated) {
                        plotlyEl.on("plotly_click", onPlotlyClick.bind(null, self));
                        plotlyEl.on("plotly_doubleclick", onPlotlyDoubleClick.bind(null, self));
                        plotlyEl.on("plotly_selected", onPlotlySelect.bind(null, self));
                        plotlyEl.on("plotly_hover", onPlotlyHover.bind(null, self));
                        plotlyEl.on("plotly_unhover", onPlotlyUnhover.bind(null, self));
                        plotlyEl.on("plotly_afterplot", onPlotlyAfterplot.bind(null, self));
                    }
                    self._anvil.plotlyUpdated = true;
                    // For some reason, this doesn't ever get called. Possibly we're on an old version of Plotly. Work it out if anyone needs it.
                    //self._anvil.element[0].on("plotly_legendclick", onPlotlyLegendClick.bind(null, self));
                })
        );
        return pyNone;
    }

    function relayout(self: Plot): void {
        if (typeof Plotly === "undefined" || !self._anvil.plotlyUpdated) return;
        // only relayout the width and height
        const width = self._anvil.element.width();
        const height = self._anvil.element.height();
        try {
            // relayout returns a Promise, the errors are part of the syncronous code
            Plotly.relayout(self._anvil.domNode, { width, height });
        } catch (e) {
            console.warn(e);
        }
    }
};

/*!defClass(anvil,Plot,Component)!*/

export default PlotFactory;
