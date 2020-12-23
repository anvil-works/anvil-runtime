"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = function(pyModule) {

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
	pyModule["Plot"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(Plot)!2*/
            ["layout", "height", "visibility", "tooltip", "user data"],
            {                
                height: {
                    defaultValue: 450
                },
            }
        );

        var datetimeModule = Sk.importModule("datetime");
        var date = datetimeModule.tp$getattr(new Sk.builtin.str("date"));
        var datetime = datetimeModule.tp$getattr(new Sk.builtin.str("datetime"));

        var remapToJs = function(pyObj) {
            return pyObj == null ? null : PyDefUtils.remapToJs(pyObj, function(o) {
              if (o instanceof date || o instanceof datetime) {
                return new Sk.builtin.str(o).v;
              }
            });
        }

        var loadPlotly = function(self) {
          if (!window.plotlyPromise) {
            window.plotlyPromise = new Promise(function(resolve, reject) {
              var script = document.createElement("script");
              script.src = window.anvilCDNOrigin + "/runtime/js/lib/plotly-latest.min.js";
              script.onload = function() {
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

          self._anvil.element.find(".plotly-loading-spinner").show();
          return window.plotlyPromise.then(function() {
            self._anvil.element.find(".plotly-loading-spinner").hide();
            PyDefUtils.resumePrint(printKey);
          });
        }

        let selectKeysIfPresent = (map, keys) => {
            let r = {};
            for (let k of keys || []) {
              if (typeof(k) == "string") {
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
        }

        let onPlotlyClick = (self, data) => {
          PyDefUtils.raiseEventAsync({points: Sk.ffi.remapToPy(data.points.map(p => selectKeysIfPresent(p, [{curveNumber: "curve_number"}, {pointNumber: "point_number"}, {pointNumbers: "point_numbers"}, "x", "y", "z", "lat", "lon"])))}, self, "click");
          return false;
        }

        let onPlotlyDoubleClick = (self) => {
          PyDefUtils.raiseEventAsync({}, self, "double_click");
          return false;
        }

        let onPlotlySelect = (self, data) => {
          PyDefUtils.raiseEventAsync({points: Sk.ffi.remapToPy(data ? data.points.map(p => selectKeysIfPresent(p, [{curveNumber: "curve_number"}, {pointNumber: "point_number"}, {pointNumbers: "point_numbers"}, "x", "y", "z", "lat", "lon"])) : [])}, self, "select");
          return false;
        }

        let onPlotlyHover = (self, data) => {
          PyDefUtils.raiseEventAsync({points: Sk.ffi.remapToPy(data.points.map(p => selectKeysIfPresent(p, [{curveNumber: "curve_number"}, {pointNumber: "point_number"}, {pointNumbers: "point_numbers"}, "x", "y", "z", "lat", "lon"])))}, self, "hover");
          return false;
        }

        let onPlotlyUnhover = (self, data) => {
          // Probable bug in plotly: When using scattergl, data is undefined. Weird.
          PyDefUtils.raiseEventAsync({points: data && Sk.ffi.remapToPy(data.points.map(p => selectKeysIfPresent(p, [{curveNumber: "curve_number"}, {pointNumber: "point_number"}, {pointNumbers: "point_numbers"}, "x", "y", "z", "lat", "lon"])))}, self, "unhover");
          return false;
        }

        let onPlotlyAfterplot = (self) => {
          PyDefUtils.raiseEventAsync({}, self, "afterplot");
          return false;
        }

        // For some reason, this doesn't ever get called. Possibly we're on an old version of Plotly. Work it out if anyone needs it.
        // let onPlotlyLegendClick = (self, data) => {
        //   PyDefUtils.raiseEventAsync({curve_number: data.curveNumber}, self, "legend_click");
        //   return false;
        // }

        var update = function(self) {
          if (!self._anvil.layout && !self._anvil.data)
            return;

          var jsLayout = remapToJs(self._anvil.layout) || {};
          jsLayout.height = self._anvil.element.height();
          jsLayout.width = self._anvil.element.width();

          var jsData = remapToJs(self._anvil.data) || [];

          var jsConfig = remapToJs(self._anvil.config) || {displayLogo: false, displaylogo: false, staticPlot: !self._anvil.getPropJS("interactive")};

          // Do not block here. There's no need, no code depends on the result.
          // If we decide we need to block, just return a suspension here.
          loadPlotly(self).then(function() {
            Plotly.newPlot(self._anvil.element[0], jsData, jsLayout, jsConfig);
            self._anvil.element[0].on("plotly_click", onPlotlyClick.bind(null, self));
            self._anvil.element[0].on("plotly_doubleclick", onPlotlyDoubleClick.bind(null, self));
            self._anvil.element[0].on("plotly_selected", onPlotlySelect.bind(null, self));
            self._anvil.element[0].on("plotly_hover", onPlotlyHover.bind(null, self));
            self._anvil.element[0].on("plotly_unhover", onPlotlyUnhover.bind(null, self));
            self._anvil.element[0].on("plotly_afterplot", onPlotlyAfterplot.bind(null, self));

            // For some reason, this doesn't ever get called. Possibly we're on an old version of Plotly. Work it out if anyone needs it.
            //self._anvil.element[0].on("plotly_legendclick", onPlotlyLegendClick.bind(null, self));

          });
          return Sk.builtin.none.none$;
        }

        var getFigure = self => {

          let go = Sk.importModule("plotly.graph_objs").tp$getattr(new Sk.builtin.str("graph_objs"));
          let Figure = go.tp$getattr(new Sk.builtin.str("Figure"));

          return Sk.misceval.callsim(Figure, Sk.ffi.remapToPy({
            "layout": self._anvil.getProp("layout"), 
            "data":  self._anvil.getProp("data")
          }));
        };

        var setFigure = (self, pyFigure) => {
          // Replace the plot data with data from the figure
          var wl = getUtilModule().tp$getattr(new Sk.builtin.str("WrappedList"));
          self._anvil.data = Sk.misceval.callsim(wl);
          Sk.misceval.callsim(self._anvil.data.tp$getattr(new Sk.builtin.str("extend")), pyFigure.tp$getattr(new Sk.builtin.str("data")));

          // Replace the plot layout with layout from the figure
          var wd = getUtilModule().tp$getattr(new Sk.builtin.str("WrappedObject"));
          self._anvil.layout = Sk.misceval.callsim(wd, pyFigure.tp$getattr(new Sk.builtin.str("layout")));

          update(self);
        };

        var getUtilModule = function() {
          return Sk.importModule("anvil.util").tp$getattr(new Sk.builtin.str("util"));
        }

        /*!componentProp(Plot)!1*/
        properties.push({name: "data", pyVal: true, type: "object",
           //pyType: "dict",
           description: "Plot traces",
           hideFromDesigner: true,
           suggested: true,
           set: function(s,e,v) {
            // Must be set to a list. Wrap it in anvil.util.WrappedList
            var wl = getUtilModule().tp$getattr(new Sk.builtin.str("WrappedList"));
            s._anvil.data = Sk.misceval.callsim(wl);
            // TODO: Async
            if (Sk.builtin.isinstance(v, Sk.builtin.dict).v) {
              // If the user supplies a dict instead of a list, wrap it in a list and just Do The Right Thing.
              Sk.misceval.callsim(s._anvil.data.tp$getattr(new Sk.builtin.str("append")), v);
            } else {
              // Assume they passed in a list.
              Sk.misceval.callsim(s._anvil.data.tp$getattr(new Sk.builtin.str("extend")), v);
            }
            return update(s);
           },
           get: function(s,e) {
            var wl = getUtilModule().tp$getattr(new Sk.builtin.str("WrappedList"));
            s._anvil.data = s._anvil.data || Sk.misceval.callsim(wl);
            return s._anvil.data;
           },
        });

        /*!componentProp(Plot)!1*/
        properties.push({name: "layout", pyVal: true, type: "object",
           pyType: "plotly.graph_objects.Layout instance",
           description: "Plot layout",
           hideFromDesigner: true,
           set: function(s,e,v) {
            // Must be set to a dict. Wrap it in an anvil.util.WrappedDict
            var wd = getUtilModule().tp$getattr(new Sk.builtin.str("WrappedObject"));
            s._anvil.layout = Sk.misceval.callsim(wd,v);
            return update(s);
           },
           get: function(s,e) {
            var wd = getUtilModule().tp$getattr(new Sk.builtin.str("WrappedObject"));
            s._anvil.layout = s._anvil.layout || Sk.misceval.callsim(wd, Sk.ffi.remapToPy({template: {}}));
            return s._anvil.layout;
           },
        });

        /*!componentProp(Plot)!1*/
        properties.push({name: "config", pyVal: true, type: "dict",
           description: "Plot config",
           hideFromDesigner: true,
           set: function(s,e,v) {
            s._anvil.config = v;
            return update(s);
           },
           get: function(s,e) {
            s._anvil.config = s._anvil.config || Sk.ffi.remapToPy({});
            return s._anvil.config;
           },
        });


        /*!componentProp(Plot)!1*/
        properties.push({name: "figure", pyVal: true, type: "dict",
           description: "The Plotly figure to display. Specifies layout and data.",
           hideFromDesigner: true,
           set: function(s,e,v) {
            return setFigure(s,v);
           },
           get: function(s,e) {
            return getFigure(s);
           },
        });

        /*!componentProp(Plot)!1*/
        properties.push({name: "interactive", type: "boolean",
            description: "Whether this plot should be interactive",
            defaultValue: true,
            set: function(s,e,v) {
              if (!window.inAnvilDesigner)
                return update(s);
            },
        });


        var events = PyDefUtils.assembleGroupEvents("Plot", /*!componentEvents(Plot)!1*/ ["universal"]);

        events.push(/*!componentEvent(Plot)!1*/
          {name: "click", description: "when a data point is clicked.",
           parameters: [{
              name: "points",
              description: "A list of the data points that were clicked.",
              important: true,
              pyVal: true,
          }], important: true, defaultEvent: true});

        events.push(/*!componentEvent(Plot)!1*/
          {name: "double_click", description: "when the plot is double-clicked.",
           parameters: [], important: true, defaultEvent: false});

        events.push(/*!componentEvent(Plot)!1*/
          {name: "afterplot", description: "after then plot is redrawn.",
           parameters: [], important: true, defaultEvent: false});

        events.push(/*!componentEvent(Plot)!1*/
          {name: "select", description: "when a data point is selected.",
           parameters: [{
              name: "points",
              description: "A list of the data points that were selected.",
              important: true,
              pyVal: true,
          }], important: true, defaultEvent: false});

        events.push(/*!componentEvent(Plot)!1*/
          {name: "hover", description: "when a data point is hovered.",
           parameters: [{
              name: "points",
              description: "A list of the data points that were hovered.",
              important: true,
              pyVal: true,
          }], important: true, defaultEvent: false});

        events.push(/*!componentEvent(Plot)!1*/
          {name: "unhover", description: "when a data point is unhovered.",
           parameters: [{
              name: "points",
              description: "A list of the data points that were unhovered.",
              important: true,
              pyVal: true,
          }], important: true, defaultEvent: false});




		    $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div class="anvil-plot"><div class="plotly-loading-spinner"></div><div>');

            self._anvil.pageEvents = {
                add: () => { return update(self); },
                show: () => { return update(self); },
            };

        }, pyModule, $loc, properties, events, pyModule["Component"]);

        /*!defMethod(_)!2*/ "Redraws the chart. Call this function if you have updated data or layout properties."
        $loc["redraw"] = new Sk.builtin.func(function(self) {
            return update(self);
        });

        /*!defMethod(_,data,traces)!2*/ "Adds data to an existing trace."
        $loc["extend_traces"] = new Sk.builtin.func(function(self, pyData, pyIndices) {
            loadPlotly(self).then(function() {
                Plotly.extendTraces(self._anvil.element[0], remapToJs(pyData), remapToJs(pyIndices));
            });
        });

        /*!defMethod(_,data,traces)!2*/ "Prepends data to an existing trace."
        $loc["prepend_traces"] = new Sk.builtin.func(function(self, pyData, pyIndices) {
            loadPlotly(self).then(function() {
                Plotly.prependTraces(self._anvil.element[0], remapToJs(pyData), remapToJs(pyIndices));
            });
        });

        /*!defMethod(_,update,traces)!2*/ "A more efficient means of changing attributes in the data array. When restyling, you may choose to have the specified changes effect as many traces as desired."
        $loc["restyle"] = new Sk.builtin.func(function(self, pyUpdate, pyIndices) {
            loadPlotly(self).then(function() {
                Plotly.restyle(self._anvil.element[0], remapToJs(pyUpdate), pyIndices ? remapToJs(pyIndices) : undefined);
            });
        });

        /*!defMethod(_,update)!2*/ "A more efficient means of updating just the layout in a graphDiv. The call signature and arguments for relayout are similar (but simpler) to restyle."
        $loc["relayout"] = new Sk.builtin.func(function(self, pyUpdate) {
            loadPlotly(self).then(function() {
                Plotly.relayout(self._anvil.element[0], remapToJs(pyUpdate));
            });
        });

        /*!defMethod(anvil.URLMedia instance,options)!2*/ "Returns a Media object containing a snapshot of this plot. The argument is a dictionary specifying image options."
        $loc["to_image"] = new Sk.builtin.func(function(self, pyOptions) {
          return PyDefUtils.suspensionFromPromise(
            loadPlotly(self).then(function() {
                return Plotly.toImage(self._anvil.element[0], pyOptions ? remapToJs(pyOptions) : {format: "png"})
            }).then(function(i) {
              return Sk.misceval.callsim(pyModule["URLMedia"], Sk.ffi.remapToPy(i));
            }));
        })

    }, /*!defClass(anvil,Plot,Component)!*/ 'Plot', [pyModule["Component"]]);
};
