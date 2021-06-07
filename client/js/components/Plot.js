"use strict";

/**
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

  ![An example plot](/doc/img/screenshots/plot-example.png)

  See [the Plotly documentation](https://plot.ly/python/) for more details and examples.


*/


var PyDefUtils = require("PyDefUtils");

module.exports = (pyModule) => {

    const go = {
        get Figure() {
            delete this.Figure;
            const go = Sk.importModule("plotly.graph_objs").tp$getattr(new Sk.builtin.str("graph_objs"));
            return (this.Figure = go.tp$getattr(new Sk.builtin.str("Figure")));
        },
    };

    const util = {
        get WrappedList() {
            delete this.WrappedList;
            const ut = Sk.importModule("anvil.util").tp$getattr(new Sk.builtin.str("util"));
            return (this.WrappedList = ut.tp$getattr(new Sk.builtin.str("WrappedList")));
        },
        get WrappedObject() {
            delete this.WrappedObject;
            const ut = Sk.importModule("anvil.util").tp$getattr(new Sk.builtin.str("util"));
            return (this.WrappedObject = ut.tp$getattr(new Sk.builtin.str("WrappedObject")));
        },
    };


    const datetimeModule = Sk.importModule("datetime");
    const date = datetimeModule.tp$getattr(new Sk.builtin.str("date"));
    const datetime = datetimeModule.tp$getattr(new Sk.builtin.str("datetime"));

    const remapToJs = (pyObj) => {
        if (pyObj == null) {
            return null;
        }
        return PyDefUtils.remapToJs(pyObj, (o) => {
            if (o instanceof date || o instanceof datetime) {
                return o.toString();
            }
        });
    };

    // There are several places in the component model where we directly access the props
    // Plot.js does this a lot
    // It might be a good idea to avoid doing this
    // See closed pr #2890 which has one possible approach using a beforeSet hook
    
    pyModule["Plot"] = PyDefUtils.mkComponentCls(pyModule, "Plot", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(Plot)!2*/ ["layout", "height", "visibility", "tooltip", "user data"], {
            height: {
                defaultValue: new Sk.builtin.int_(450),
            },
            data: /*!componentProp(Plot)!1*/ {
                name: "data",
                pyVal: true,
                type: "object",
                //pyType: "dict",
                description: "Plot traces",
                hideFromDesigner: true,
                suggested: true,
                initialize: true,
                set(s, e, v) {
                    // Must be set to a list. Wrap it in anvil.util.WrappedList
                    if (v instanceof Sk.builtin.dict) {
                        // If the user supplies a dict instead of a list, wrap it in a list and just Do The Right Thing.
                        s._anvil.props.data = PyDefUtils.pyCall(util.WrappedList, [new Sk.builtin.list([v])]);
                    } else if (!(v instanceof util.WrappedList)) {
                        // Assume they passed in something iterable.
                        s._anvil.props.data = PyDefUtils.pyCall(util.WrappedList, [v]);
                    } else {
                        // Assume they passed in a WrappedList
                        s._anvil.props.data = v;
                    }
                    return update(s);
                },
                get(s, e) {
                    s._anvil.props.data = s._anvil.props.data || PyDefUtils.pyCall(util.WrappedList);
                    return s._anvil.props.data;
                },
            },

            layout: /*!componentProp(Plot)!1*/ {
                name: "layout",
                pyVal: true,
                type: "object",
                pyType: "plotly.graph_objs.Layout instance",
                description: "Plot layout",
                hideFromDesigner: true,
                initialize: true,
                set(s, e, v) {
                    // Must be set to a dict. Wrap it in an anvil.util.WrappedDict
                    if (v instanceof util.WrappedObject) {
                        s._anvil.props.layout = v;
                    } else {
                        s._anvil.props.layout = PyDefUtils.pyCall(util.WrappedObject, [v]);
                    }
                    return update(s);
                },
                get(s, e) {
                    s._anvil.props.layout = s._anvil.props.layout || PyDefUtils.pyCall(util.WrappedObject, [Sk.ffi.remapToPy({ template: {} })]);
                    return s._anvil.props.layout;
                },
            },

            config: /*!componentProp(Plot)!1*/ {
                name: "config",
                pyVal: true,
                type: "dict",
                description: "Plot config",
                hideFromDesigner: true,
                initialize: true,
                set(s, e, v) {
                    s._anvil.props.config = v;
                    return update(s);
                },
                get(s, e) {
                    s._anvil.props.config = s._anvil.props.config || Sk.ffi.remapToPy({});
                    return s._anvil.props.config;
                },
            },

            figure: /*!componentProp(Plot)!1*/ {
                name: "figure",
                pyVal: true,
                type: "dict",
                description: "The Plotly figure to display. Specifies layout and data.",
                hideFromDesigner: true,
                initialize: true,
                set(s, e, pyFigure) {
                    if (!(pyFigure instanceof util.WrappedObject)) {
                        // they may have supplied a dict so turn it into a wrapped object
                        pyFigure = PyDefUtils.pyCall(util.WrappedObject, [pyFigure]);
                    }

                    // Replace the plot layout with layout from the figure - this wil be a wrapped object
                    s._anvil.props.layout = PyDefUtils.pyCall(util.WrappedObject, [pyFigure.tp$getattr(new Sk.builtin.str("layout"))]);

                    // Replace the plot data with data from the figure and let data call update
                    return s._anvil.setProp("data", pyFigure.tp$getattr(new Sk.builtin.str("data")));
                },
                get(self, e) {
                    return PyDefUtils.pyCall(go.Figure, [
                        Sk.ffi.remapToPy({
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
                    if (!window.inAnvilDesigner) return update(s);
                },
            },
        }),

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
                <div refName="spinner" className="plotly-loading-spinner" />
            </PyDefUtils.OuterElement>
        ),

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["Component"], (self) => {
                self._anvil.pageEvents = {
                    add() {
                        self._anvil.initialized = true;
                        return update(self);
                    },
                    show() {
                        return update(self);
                    },
                };
            });

            /*!defMethod(_)!2*/ "Redraws the chart. Call this function if you have updated data or layout properties."
            $loc["redraw"] = new Sk.builtin.func(function redraw(self) {
                return update(self);
            });

            /*!defMethod(_,data,traces)!2*/ "Adds data to an existing trace."
            $loc["extend_traces"] = new Sk.builtin.func(function extend_traces(self, pyData, pyIndices) {
                loadPlotly(self).then(() => Plotly.extendTraces(self._anvil.domNode, remapToJs(pyData), remapToJs(pyIndices)));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,data,traces)!2*/ "Prepends data to an existing trace."
            $loc["prepend_traces"] = new Sk.builtin.func(function prepend_traces(self, pyData, pyIndices) {
                loadPlotly(self).then(() => Plotly.prependTraces(self._anvil.domNode, remapToJs(pyData), remapToJs(pyIndices)));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,update,traces)!2*/ "A more efficient means of changing attributes in the data array. When restyling, you may choose to have the specified changes effect as many traces as desired."
            $loc["restyle"] = new Sk.builtin.func(function restyle(self, pyUpdate, pyIndices) {
                loadPlotly(self).then(() => Plotly.restyle(self._anvil.domNode, remapToJs(pyUpdate), pyIndices ? remapToJs(pyIndices) : undefined));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,update)!2*/ "A more efficient means of updating just the layout in a graphDiv. The call signature and arguments for relayout are similar (but simpler) to restyle."
            $loc["relayout"] = new Sk.builtin.func(function relayout(self, pyUpdate) {
                loadPlotly(self).then(() => Plotly.relayout(self._anvil.domNode, remapToJs(pyUpdate)));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(anvil.URLMedia instance,options)!2*/ "Returns a Media object containing a snapshot of this plot. The argument is a dictionary specifying image options."
            $loc["to_image"] = new Sk.builtin.func(function to_image(self, pyOptions) {
                return PyDefUtils.suspensionFromPromise(
                    loadPlotly(self)
                        .then(() => Plotly.toImage(self._anvil.domNode, pyOptions ? remapToJs(pyOptions) : { format: "png" }))
                        .then((i) => PyDefUtils.pyCall(pyModule["URLMedia"], [Sk.ffi.remapToPy(i)]))
                );
            });
        },
    });

    

    function loadPlotly(self) {
        if (!window.plotlyPromise) {
            window.plotlyPromise = new Promise(function (resolve, reject) {
                var script = document.createElement("script");
                script.src = window.anvilCDNOrigin + "/runtime/js/lib/plotly-latest.min.js";
                script.onload = function () {
                    // Plotly clobbers window.Promise. Ew.
                    // https://github.com/plotly/plotly.js/issues/1032
                    window.Promise = RSVP.Promise;
                    resolve();
                };
                document.body.appendChild(script);
            });
        }

        let printKey = `Plotly ${Math.random()}`;
        PyDefUtils.delayPrint(printKey);

        self._anvil.elements.spinner.style.display = "block";
        return window.plotlyPromise.then(() => {
            self._anvil.elements.spinner.style.display = "none";
            PyDefUtils.resumePrint(printKey);
        });
    }

    let selectKeysIfPresent = (map, keys) => {
        let r = {};
        for (let k of keys || []) {
            if (typeof k == "string") {
                if (k in map) {
                    r[k] = map[k];
                }
            } else {
                // map of old name -> new name
                for (let j in k) {
                    if (j in map) {
                        r[k[j]] = map[j];
                    }
                    break;
                }
            }
        }
        return r;
    };

    let onPlotlyClick = (self, data) => {
        PyDefUtils.raiseEventAsync(
            {
                points: Sk.ffi.remapToPy(
                    data.points.map((p) =>
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

    let onPlotlyDoubleClick = (self) => {
        PyDefUtils.raiseEventAsync({}, self, "double_click");
        return false;
    };

    let onPlotlySelect = (self, data) => {
        PyDefUtils.raiseEventAsync(
            {
                points: Sk.ffi.remapToPy(
                    data
                        ? data.points.map((p) =>
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

    let onPlotlyHover = (self, data) => {
        PyDefUtils.raiseEventAsync(
            {
                points: Sk.ffi.remapToPy(
                    data.points.map((p) =>
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

    let onPlotlyUnhover = (self, data) => {
        // Probable bug in plotly: When using scattergl, data is undefined. Weird.
        PyDefUtils.raiseEventAsync(
            {
                points:
                    data &&
                    Sk.ffi.remapToPy(
                        data.points.map((p) =>
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

    let onPlotlyAfterplot = (self) => {
        PyDefUtils.raiseEventAsync({}, self, "afterplot");
        return false;
    };

    // For some reason, this doesn't ever get called. Possibly we're on an old version of Plotly. Work it out if anyone needs it.
    // let onPlotlyLegendClick = (self, data) => {
    //   PyDefUtils.raiseEventAsync({curve_number: data.curveNumber}, self, "legend_click");
    //   return false;
    // }

    function update(self) {
        if (!self._anvil.initialized || (!self._anvil.props.layout && !self._anvil.props.data)) return;

        const jsLayout = remapToJs(self._anvil.props.layout) || {};
        jsLayout.height = self._anvil.element.height();
        jsLayout.width = self._anvil.element.width();

        const jsData = remapToJs(self._anvil.props.data) || [];

        const jsConfig = remapToJs(self._anvil.props.config) || { displayLogo: false, displaylogo: false, staticPlot: !self._anvil.getPropJS("interactive") };

        // Do not block here. There's no need, no code depends on the result.
        // If we decide we need to block, just return a suspension here.
        loadPlotly(self).then(() => {
            const outerEl = self._anvil.elements.outer;
            Plotly.newPlot(outerEl, jsData, jsLayout, jsConfig);
            outerEl.on("plotly_click", onPlotlyClick.bind(null, self));
            outerEl.on("plotly_doubleclick", onPlotlyDoubleClick.bind(null, self));
            outerEl.on("plotly_selected", onPlotlySelect.bind(null, self));
            outerEl.on("plotly_hover", onPlotlyHover.bind(null, self));
            outerEl.on("plotly_unhover", onPlotlyUnhover.bind(null, self));
            outerEl.on("plotly_afterplot", onPlotlyAfterplot.bind(null, self));

            // For some reason, this doesn't ever get called. Possibly we're on an old version of Plotly. Work it out if anyone needs it.
            //self._anvil.element[0].on("plotly_legendclick", onPlotlyLegendClick.bind(null, self));
        });
        return Sk.builtin.none.none$;
    };






};

/*!defClass(anvil,Plot,Component)!*/