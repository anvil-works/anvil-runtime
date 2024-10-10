"use strict";
/* global google */

var PyDefUtils = require("PyDefUtils");
const { s_get_components } = require("@runtime/runner/py-util");
const { pyFunc } = require("@Sk");

/*#
id: googlemap
docs_url: /docs/client/components/maps
title: GoogleMap
tooltip: Learn more about the GoogleMap component
description: |

  ```python
  map = GoogleMap()

  map.center = GoogleMap.LatLng(52.2053, 0.1218)
  map.zoom = 13
  ```

  You can display interactive Google Maps on your Anvil form with the GoogleMap component.

  ```python
  marker = GoogleMap.Marker(
    animation=GoogleMap.Animation.DROP,
    position=GoogleMap.LatLng(52.2053, 0.1218)
  )

  map.add_component(marker)
  ```

  GoogleMap components are containers. You can add various Map Overlay components to a 
  map. In this example, we add a marker at a particular position and with a 'drop' animation.

  <img src="img/maps/marker_1.png" style="border: 1px solid #ccc; margin: 10px 0;">

  ```python
  def marker_click(sender, **event_args):
    i =GoogleMap.InfoWindow(content=Label(text="This is Cambridge!"))
    i.open(map, sender)

  marker.add_event_handler("click", marker_click)
  ```

  Markers (and other overlays) can respond to mouse events. Here we display an 
  InfoWindow anchored to the marker when the marker is clicked.

  InfoWindows have a `content` property, which can be set to a string or an Anvil Component such as a label or an entire form.

  <img src="img/maps/infowindow_1.png" style="border: 1px solid #ccc; margin: 10px 0;">


  ```python
    p = GoogleMap.Polyline(
      path=[
        GoogleMap.LatLng(52.215, 0.14),
        GoogleMap.LatLng(52.195, 0.12),
        GoogleMap.LatLng(52.21, 0.10),
      ],
      stroke_color='blue',
      stroke_weight=2,
      icons=[
        GoogleMap.IconSequence(
          icon=GoogleMap.Symbol(
            path=GoogleMap.SymbolPath.FORWARD_OPEN_ARROW,
            scale=2
          )
        )
      ]
    )
  ```

  To draw a line between positions on a map, add a GoogleMap.Polyline component to the map. In this example, we also add an arrow icon.

  <img src="img/maps/polyline_1.png" style="border: 1px solid #ccc; margin: 10px 0;">

  Here is a complete list of the available map overlay components, and their most important properties:

  \* **`GoogleMap.Marker`** - Mark a particular point on the map. Draws a red pin by default.

    Properties

    \* **`animation`:** `GoogleMap.Animation` - Specifies the animation of this marker. Set to `GoogleMap.Animation.DROP`, or `GoogleMap.Animation.BOUNCE`.
    \* **`icon`:** `GoogleMap.Symbol` - Specifies the icon to display. If unset, a red pin is displayed.
    \* **`label`:** `GoogleMap.MarkerLabel | String` - Describes the text label of this marker.
    \* **`position`:** `GoogleMap.LatLng` - Specifies the position of this marker.

       <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#Marker">Learn more about Markers in the Google Maps documentation <i class="fa fa-external-link"></i></a>


  \* **`GoogleMap.InfoWindow`** - Display a popup on the map at a particular position.

    Properties

    \* **`position`:** `GoogleMap.LatLng` - Specifies the position of the popup. Not required if this popup is anchored to a component (see the `open` method, below).
    \* **`content`:** `anvil.Component | string` - The content of the popup. Can be a string, or an Anvil Component.

    Methods

    \* **`open(map, [anchor])`** - Display this InfoWindow on the specified map. If `anchor` is specified, the InfoWindow does not need to have its own `position` property set.
    \* **`close()`** - Hide this InfoWindow. The user can also cause this to happen by clicking the close button in the top-right of the popup.

       <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#InfoWindow">Learn more about InfoWindows in the Google Maps documentation <i class="fa fa-external-link"></i></a>


  \* **`GoogleMap.Polyline`** - Draw a line on the map.

    Properties

    \* **`icons`:** `list of GoogleMap.IconSequence` - Specifies the icons to display along this line.
    \* **`path`:** `list of GoogleMap.LatLng` - A list of points along the line.
    \* **`geodesic`:** `boolean` - Whether this line should follow the curvature of the Earth. Default `False`.

       <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#Polyline">Learn more about Polylines in the Google Maps documentation <i class="fa fa-external-link"></i></a>


  \* **`GoogleMap.Polygon`** - Draw a closed polygon on the map.

    Properties

    \* **`path`:** `list of GoogleMap.LatLng` - A list of vertices.
    \* **`geodesic`:** `boolean` - Whether the outline of this polygon should follow the curvature of the Earth. Default `False`.

       <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#Polygon">Learn more about Polygons in the Google Maps documentation <i class="fa fa-external-link"></i></a>


  \* **`GoogleMap.Rectangle`** - Draw a rectangle on the map.

    Properties

    \* **`bounds`:** `GoogleMap.LatLngBounds` - Specifies the position and size of this rectangle.

       <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#Rectangle">Learn more about Rectangles in the Google Maps documentation <i class="fa fa-external-link"></i></a>


  \* **`GoogleMap.Circle`** - Draw a circle on the map.

    Properties

    \* **`center`:** `GoogleMap.LatLng` - The position of the circle.
    \* **`radius`:** `number` - The radius of the circle, in meters.

       <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#Circle">Learn more about Circles in the Google Maps documentation <i class="fa fa-external-link"></i></a>


  In addition to the properties specified above, all overlays have `clickable`, `draggable`, 
  and `visible` properties. Overlays with outlines also have `editable`, `stroke_color`, 
  `stroke_weight` and `stroke_opacity` properties. Those with area have `fill_color` and 
  `fill_opacity` properties. See <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#MarkerOptions">the official Google Maps documentation</a> for more details.

  ### Data Visualisation

  ```python
  map.map_data.add(GoogleMap.Data.Feature(
    geometry=GoogleMap.Data.Point(
      GoogleMap.LatLng(52.2,0.1))))

  map.map_data.add(GoogleMap.Data.Feature(
    geometry=GoogleMap.Data.Point(
      GoogleMap.LatLng(52.21,0.12))))

  map.map_data.add(GoogleMap.Data.Feature(
    geometry=GoogleMap.Data.Point(
      GoogleMap.LatLng(52.201,0.135))))

  map.map_data.style = GoogleMap.Data.StyleOptions(
    icon=GoogleMap.Symbol(
      path=GoogleMap.SymbolPath.CIRCLE,
      scale=30,
      fill_color='red',
      fill_opacity=0.3,
      stroke_opacity=1,
      stroke_weight=1
    )
  )
  ```

  It is possible to use <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/datalayer">the Data Layer</a> 
  to visualise location-based data instead of Overlays. In this example, we add point features to the `map_data` object, then set a rendering styles for all features at once.

  <img src="img/maps/data_1.png" style="border: 1px solid #ccc; margin: 10px 0;">

  ```python
  def get_style(feature):
    point = feature.geometry.get()
    color = 'red' if point.lng() < 0.12 else 'blue'

    return GoogleMap.Data.StyleOptions(
      icon=GoogleMap.Symbol(
        path=GoogleMap.SymbolPath.CIRCLE,
        scale=30,
        fill_color=color,
        fill_opacity=0.3,
        stroke_opacity=1,
        stroke_weight=1
      )
    )

  map.map_data.style = get_style
  ```

  We could also generate feature styles dynamically by assigning a 'styling function' to the `map_data.style` property. 
  The function will be called once for every feature, and should return a corresponding style. In this example,
  we choose the color of the circle based on the longitude of the feature.

  <img src="img/maps/data_2.png" style="border: 1px solid #ccc; margin: 10px 0;">

  Here we used GoogleMap.Data.Point geometries, but there are several others available:

  \* `GoogleMap.Data.Point(lat_lng)` - Features are respresented by a particular position.
  \* `GoogleMap.Data.MultiPoint([lat_lng_1, lat_lng_2, ...])` - Features are respresented by a set of positions.
  \* `GoogleMap.Data.LineString([lat_lng_1, lat_lng_2, ...])` - Features are respresented by a line with specified vertices.
  \* `GoogleMap.Data.MultiLineString([line_string_1, line_string_2, ...])` - Features are respresented by a multiple LineString geometries.
  \* `GoogleMap.Data.LinearRing([lat_lng_1, lat_lng_2, ...])` - Features are respresented by a closed loop of vertices.
  \* `GoogleMap.Data.Polygon([linear_ring_1, linear_ring_2, ...])` - Features are respresented by a set of closed loops. Additional loops denote 'holes' in the polygon.
  \* `GoogleMap.Data.MultiPolygon([polygon_1, polygon_2, ...])` - Features are respresented by multiple polygons.
  \* `GoogleMap.Data.GeometryCollection([geometry_1, geometry_2, ...])` - Features are respresented by an arbitrary set of geometries defined above.

  See <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#Data.Geometry">the official Google Maps documentation <i class="fa fa-external-link"></i></a> for more information.

  ### Geocoding

  ```python
  results = GoogleMap.geocode(address="Cambridge, UK")

  m = Marker(position=results[0].geometry.location)
  map.add_component(m)
  ```

  You can look up addresses from locations, and vice-versa, using the `GoogleMap.geocode` function.
  This function returns a `GoogleMap.GeocoderResult` array. In this example, we look up a location from an address, then display a marker.

  ```python
  results = GoogleMap.geocode(
    location=GoogleMap.LatLng(52.2053, 0.1218)
  )

  print results[0].formatted_address
  ```

  In this example, we look up an address for a given lat/long.

  There are several other properties available on the `GoogleMap.GeocoderResult` object. 
  See <a target="_blank" href="https://developers.google.com/maps/documentation/javascript/reference#GeocoderResult">the official Google documentation</a> for details.

  ### Utilities

  ```python
  # Calculate the length of the line.
  GoogleMap.calculate_length([
    GoogleMap.LatLng(52.215, 0.14),
    GoogleMap.LatLng(52.195, 0.12),
    GoogleMap.LatLng(52.21, 0.10),
  ])

  # Calculate the area of the polygon.
  GoogleMap.calculate_length([
    GoogleMap.LatLng(52.215, 0.14),
    GoogleMap.LatLng(52.195, 0.12),
    GoogleMap.LatLng(52.21, 0.10),
  ])
  ```

  The GoogleMap Component provides utilities for calculating length and area:

  \* `GoogleMap.calculate_length([pos_1, pos_2, ...])` - returns the length of the line going through the specified points.
  \* `GoogleMap.calculate_area([vertex_1, vertex_2, ...])` - returns the area of the polygon with the specified vertices.

  ### The GoogleMap Component
*/

module.exports = function(pyModule) {

    const {
        misceval: { isTrue, callsimArray: pyCall, callsimOrSuspendArray: pyCallOrSuspend, chain: chainOrSuspend },
        builtin: {
            none: { none$: pyNone },
            str: pyStr,
            tuple: pyTuple,
            isinstance: pyIsInstance,
            checkString,
        },
    } = Sk;

    const S_ADD_COMPONENT = new pyStr("add_component");
    const S_REMOVE_FROM_PARENT = new pyStr("remove_from_parent");
    const S_CLEAR = new pyStr("clear");


    // UTILS
    const remapTypes = [];
    const lazyEnums = [];

    let googleLoaded = false;

    async function loadGoogleMapsAsync() {
        await PyDefUtils.loadScript(
            `https://maps.googleapis.com/maps/api/js?key=${window.anvilGoogleApiKey}&v=3&libraries=geometry`
        );
        if (!window.google) {
            console.warn("Google unavailable, not loading GoogleMap component");
            throw new Sk.builtin.RuntimeError("Google maps is unavailable");
        }
    }

    const loadLazyEnumsRemapTypes = () => {
        const GoogleMapProto = pyModule["GoogleMap"].prototype;
        for (let lazyEnum of lazyEnums) {
            GoogleMapProto[lazyEnum] = GoogleMapProto[lazyEnum]();
        }
        for (let remapType of remapTypes) {
            remapType.jsType = remapType.jsType();
        }
        googleLoaded = true;
    };

    function loadGoogleMaps() {
        if (googleLoaded) {
            return;
        }
        window.gm_authFailure = (e) => {
            window.googleMapsAuthFailure = true;
        };
        if (window.google) {
            return loadLazyEnumsRemapTypes();
        }
        return Sk.misceval.chain(Sk.misceval.promiseToSuspension(loadGoogleMapsAsync()), loadLazyEnumsRemapTypes);
    }

    let suspensionLoadGoogleMaps = (...fn) => {
        return Sk.misceval.chain(loadGoogleMaps(), ...fn);
    };

    function registerRemapType(lazyJsType, pyType) {
        remapTypes.push({ jsType: lazyJsType, pyType: pyType });

        // implement protocol for Sk.ffi.toJs to convert to a javascript object
        Object.defineProperty(pyType.prototype, "valueOf", {
            value() {
                if (this._toJsVal) {
                    return this._toJsVal();
                } else {
                    return this._jsVal;
                }
            },
            writable: true,
        });
    }

    const unhandledHook = (pyObj) => {
        for (let remapType of remapTypes || []) {
            if (pyObj instanceof remapType.pyType) {
                if (pyObj._toJsVal) {
                    return pyObj._toJsVal();
                } else {
                    return pyObj._jsVal;
                }
            }
        }
    };

    function remapToJs(pyObj) {
        return Sk.ffi.toJs(pyObj, {unhandledHook});
    }

    const proxyHook = (jsObj) => {
        for (const remapType of remapTypes || []) {
            if (jsObj instanceof remapType.jsType) {
                return jsObj._pyVal ?? Sk.misceval.callsim(remapType.pyType, jsObj);
            }
        }
        return Sk.ffi.proxy(jsObj);
    };

    function remapToPy(jsObj) {
        return Sk.ffi.toPy(jsObj, { proxyHook });
    }


    function snakeToCamelCase(pyName) {
        return pyName.replace(/_(.)/g, (_, c) => c.toUpperCase());
    }

    function unwrapKwargs(kwargs, into) {
        into ??= {};
        for (let k in kwargs) {
            const unwrappedName = snakeToCamelCase(k);
            into[unwrappedName] = remapToJs(kwargs[k]);
        }
        return into;
    }

    function registerMethods($class, methods) {
        for (var fn in methods) {
            var fwk = methods[fn].transformRawArgs ? PyDefUtils.funcWithRawKwargsDict : PyDefUtils.funcWithKwargs;
            $class[fn] = fwk(
                function (pyFnName, method, kwargs, self) {
                    var transformArgs =
                        method.transformArgs ||
                        method.transformRawArgs ||
                        function (kwargs, self /*, arg1, arg2, ... */) {
                            var a = [];
                            var args = Array.prototype.slice.call(arguments, 2);
                            for (var i in args) {
                                a.push(remapToJs(args[i]));
                            }
                            return a;
                        };
                    var transformResult = method.transformResult || remapToPy;
                    var args = Array.prototype.slice.call(arguments, 2);

                    var unwrappedArgs = transformArgs.apply(null, args);

                    var fnName = method.fn || snakeToCamelCase(pyFnName);
                    //console.debug("Calling function", fnName, "with args", unwrappedArgs);

                    var jsResult = self._jsVal[fnName].apply(self._jsVal, unwrappedArgs);

                    //console.debug("Got result", jsResult);
                    return chainOrSuspend(method.callback?.(self), () => transformResult(jsResult));
                }.bind(null, fn, methods[fn])
            );
        }
    }

    function initFnWithJsObjOrPyArgs(lazyJsType, initFn, afterInitFromJs) {
        return function (/* kwargs?, self, arg1, arg2, ... */) {
            var args = Array.prototype.slice.call(arguments, 0);
            // First argument is either kwargs (a JS object) or self (a python object)
            var firstArgIndex = 1;
            if (!args[0].tp$name) {
                firstArgIndex++;
            }
            var self = args[firstArgIndex - 1];
            const jsType = lazyJsType();
            if (args[firstArgIndex] && args[firstArgIndex] instanceof jsType) {
                self._jsVal = args[firstArgIndex];
                if (afterInitFromJs) {
                    afterInitFromJs(self, self._jsVal);
                }
            } else {
                initFn.apply(null, args);
            }
            self._jsVal._pyVal = self;
            Object.defineProperties(self._jsVal, {
                $isPyWrapped: { value: true, writable: true },
                unwrap: {
                    value() {
                        return self;
                    },
                    writable: true,
                },
            });
        };
    }




    // COMPONENT

    // similar to the logic in Component __new__ but jsVal doesn't exist in component new so we set these props in GoogleMap.__new__
    function setMapProps(self) {
        const fns = [null];
        const _anvilClassic$propMap = self._anvilClassic$propMap;
        Object.keys(_anvilClassic$propMap).forEach((propName) => {
            if (!_anvilClassic$propMap[propName].mapProp) {
                return;
            }
            const current_val = self._anvil.props[propName];
            if (current_val !== undefined) {
                fns.push(() => self._anvil.setProp(propName, current_val));
            }
        });

        return Sk.misceval.chain(...fns);
    }

    pyModule["GoogleMap"] = PyDefUtils.mkComponentCls(pyModule, "GoogleMap", {
        base: pyModule["ClassicContainer"],

        element: (props) => <PyDefUtils.OuterElement className="anvil-google-map" style="min-height:40px;" {...props} />,

        locals: GoogleMapLocals,

        // MAP PROPERTIES
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(GoogleMap)!1*/ ["layout", "layout_margin", "height", "visibility", "user data"], {
            /*!componentProp(GoogleMap)!1*/
            map_data: {
                name: "map_data",
                pyVal: true,
                type: "object",
                pyType: "anvil.GoogleMap.Data instance",
                description: "Map data",
                hideFromDesigner: true,
                mapProp: true,
                set(s, e, v) {
                    s._jsVal.data = remapToJs(v);
                },
                get(s, e) {
                    return s._jsVal ? remapToPy(s._jsVal.data) : Sk.builtin.none.none$;
                },
            },

            /*!componentProp(GoogleMap)!1*/
            background_color: {
                name: "background_color",
                description: "Color used for the background of the Map div. This color will be visible when tiles have not yet loaded as the user pans.",
                type: "string",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("backgroundColor", String),
            },

            /*!componentProp(GoogleMap)!1*/
            center: {
                name: "center",
                description: "The Map center.",
                hideFromDesigner: true,
                type: "object",
                pyType: "anvil.GoogleMap.LatLng instance",
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("center", remapToJs),
                get: PyDefUtils.mapGetter("getCenter", remapToPy),
            },

            /*!componentProp(GoogleMap)!1*/
            clickable_icons: {
                name: "clickable_icons",
                description: "When false, map icons are not clickable. A map icon represents a point of interest",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("clickableIcons", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            disable_default_ui: {
                name: "disable_default_ui",
                description: "Enables/disables all default UI.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("disableDefaultUI", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            disable_double_click_zoom: {
                name: "disable_double_click_zoom",
                description: "Enables/disables zoom and center on double click.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("disableDoubelClickZoom", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            draggable: {
                name: "draggable",
                description: "If false, prevents the map from being dragged.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("draggable", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            draggable_cursor: {
                name: "draggable_cursor",
                description: "The name or url of the cursor to display when mousing over a draggable map.",
                type: "string",
                defaultValue: new Sk.builtin.str("auto"),
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("draggableCursor", String),
            },

            /*!componentProp(GoogleMap)!1*/
            dragging_cursor: {
                name: "dragging_cursor",
                description: "The name or url of the cursor to display when the map is being dragged.",
                type: "string",
                defaultValue: new Sk.builtin.str("auto"),
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("draggingCursor", String),
            },

            /*!componentProp(GoogleMap)!1*/
            fullscreen_control: {
                name: "fullscreen_control",
                description: "The enabled/disabled state of the Fullscreen control.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("fullscreenControl", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            fullscreen_control_options: {
                name: "fullscreen_control_options",
                description: "The display options for the Fullscreen control.",
                hideFromDesigner: true,
                type: "object",
                pyType: "anvil.GoogleMap.FullscreenControlOptions instance",
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("fullscreenControlOptions", remapToJs),
            },

            /*!componentProp(GoogleMap)!1*/
            gesture_handling: {
                name: "gesture_handling",
                description: "This setting controls how gestures on the map are handled.",
                type: "string",
                defaultValue: new Sk.builtin.str("auto"),
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("gestureHandling", String),
            },

            /*!componentProp(GoogleMap)!1*/
            heading: {
                name: "heading",
                description: "The heading for aerial imagery in degrees measured clockwise from cardinal direction North. ",
                type: "number",
                defaultValue: new Sk.builtin.int_(0),
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("heading", (v) => (isTrue(v) ? v : 0)),
                get: (self, e) => (ANVIL_IN_DESIGNER ? self._anvil.props["heading"] : PyDefUtils.mapGetter("getHeading", remapToPy)(self, e)),
            },

            /*!componentProp(GoogleMap)!1*/
            keyboard_shortcuts: {
                name: "keyboard_shortcuts",
                description: "If false, prevents the map from being controlled by the keyboard.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("keyboardShortcuts", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            map_type_control: {
                name: "map_type_control",
                description: "The enabled/disabled state of the Map type control.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("mapTypeControl", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            map_type_control_options: {
                name: "map_type_control_options",
                description: "The display options for the Map type control.",
                hideFromDesigner: true,
                type: "object",
                pyType: "anvil.GoogleMap.MapTypeControlOptions instance",
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("mapTypeControlOptions", remapToJs),
            },

            /*!componentProp(GoogleMap)!1*/
            map_type_id: {
                name: "map_type_id",
                description: "The map type ID. Defaults to MapTypeId.ROADMAP",
                hideFromDesigner: true,
                type: "object",
                pyType: "anvil.GoogleMap.MapTypeId",
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("mapTypeId", remapToJs),
            },

            /*!componentProp(GoogleMap)!1*/
            max_zoom: {
                name: "max_zoom",
                description: "The maximum zoom level which will be displayed on the map.",
                type: "number",
                defaultValue: new Sk.builtin.int_(18),
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("maxZoom", remapToJs),
            },

            /*!componentProp(GoogleMap)!1*/
            min_zoom: {
                name: "min_zoom",
                description: "The minimum zoom level which will be displayed on the map.",
                type: "number",
                defaultValue: new Sk.builtin.int_(0),
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("minZoom", remapToJs),
            },

            /*!componentProp(GoogleMap)!1*/
            rotate_control: {
                name: "rotate_control",
                description: "The enabled/disabled state of the rotate control.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("rotateControl", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            rotate_control_options: {
                name: "rotate_control_options",
                description: "The display options for the rotate control.",
                hideFromDesigner: true,
                type: "object",
                pyType: "anvil.GoogleMap.RotateControlOptions instance",
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("rotateControlOptions", remapToJs),
            },

            /*!componentProp(GoogleMap)!1*/
            scale_control: {
                name: "scale_control",
                description: "The enabled/disabled state of the scale control.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("scaleControl", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            scale_control_options: {
                name: "scale_control_options",
                description: "The display options for the scale control.",
                hideFromDesigner: true,
                type: "object",
                pyType: "anvil.GoogleMap.ScaleControlOptions instance",
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("scaleControlOptions", remapToJs),
            },

            /*!componentProp(GoogleMap)!1*/
            scroll_wheel: {
                name: "scroll_wheel",
                description: "If false, disables scrollwheel zooming on the map.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("scaleControl", isTrue),
            },

            // TODO: Add StreetView props

            /*!componentProp(GoogleMap)!1*/
            street_view_control: {
                name: "street_view_control",
                description: "The enabled/disabled state of the street view control.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("streetViewControl", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            street_view_control_options: {
                name: "street_view_control_options",
                description: "The display options for the street view control.",
                hideFromDesigner: true,
                type: "object",
                pyType: "anvil.GoogleMap.StreetViewControlOptions instance",
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("streetViewControlOptions", remapToJs),
            },

            // TODO: Add styles

            /*componentProp(GoogleMap)!1*/
            // TILT CAUSES THE MAP TO EXPLODE WITH A STACK OVERFLOW. NO IDEA WHY.
            // tilt: {
            //   name: "tilt",
            //   description: "Controls the automatic switching behavior for the angle of incidence of the map. The only allowed values are 0 and 45.",
            //   type: "number",
            //   defaultValue: 45,
            //   set: PyDefUtils.mapSetter("minZoom"),
            // }

            /*!componentProp(GoogleMap)!1*/
            zoom: {
                name: "zoom",
                description: "The map zoom level.",
                type: "number",
                defaultValue: new Sk.builtin.int_(2),
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("zoom", (v) => (isTrue(v) ? remapToJs(v) : 2)),
                get: (self, e) => (ANVIL_IN_DESIGNER ? self._anvil.props["zoom"] : PyDefUtils.mapGetter("getZoom", remapToPy)(self, e)),
            },

            /*!componentProp(GoogleMap)!1*/
            zoom_control: {
                name: "zoom_control",
                description: "The enabled/disabled state of the zoom control.",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("zoomControl", isTrue),
            },

            /*!componentProp(GoogleMap)!1*/
            zoom_control_options: {
                name: "zoom_control_options",
                description: "The display options for the zoom control.",
                hideFromDesigner: true,
                type: "object",
                pyType: "anvil.GoogleMap.ZoomControlOptions instance",
                pyVal: true,
                mapProp: true,
                set: PyDefUtils.mapSetter("zoomControlOptions", remapToJs),
            },
        }),

        // MAP EVENTS
        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "GoogleMap", ["universal"], {
            /*!componentEvent(GoogleMap)!1*/
            bounds_changed: { name: "bounds_changed", description: "when the viewport bounds have changed.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            center_changed: { name: "center_changed", description: "when the map center property changes.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            click: {
                name: "click",
                description: "when the user clicks on the map.",
                parameters: [
                    {
                        name: "lat_lng",
                        description: "The position that was clicked.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "pixel",
                        description: "The position that was clicked.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            dbl_click: {
                name: "dbl_click",
                description: "when the user double-clicks on the map.",
                parameters: [
                    {
                        name: "lat_lng",
                        description: "The position that was double-clicked.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "pixel",
                        description: "The position that was double-clicked.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            drag: { name: "drag", description: "This event is repeatedly fired while the user drags the map.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            dragend: { name: "dragend", description: "when the user stops dragging the map.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            dragstart: { name: "dragstart", description: "when the user starts dragging the map.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            heading_changed: { name: "heading_changed", description: "when the map heading property changes.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            idle: { name: "idle", description: "when the map becomes idle after panning or zooming.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            maptypeid_changed: { name: "maptypeid_changed", description: "when the mapTypeId property changes.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            mousemove: {
                name: "mousemove",
                description: "whenever the user's mouse moves over the map container.",
                parameters: [
                    {
                        name: "lat_lng",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "pixel",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            mouseout: {
                name: "mouseout",
                description: "when the user's mouse exits the map container.",
                parameters: [
                    {
                        name: "lat_lng",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "pixel",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            mouseover: {
                name: "mouseover",
                description: "when the user's mouse enters the map container.",
                parameters: [
                    {
                        name: "lat_lng",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "pixel",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            projection_changed: { name: "projection_changed", description: "when the projection has changed.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            rightclick: {
                name: "rightclick",
                description: "when the user right-clicks on the map container.",
                parameters: [
                    {
                        name: "lat_lng",
                        description: "The position that was right-clicked.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "pixel",
                        description: "The position that was right-clicked.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            tilesloaded: { name: "tilesloaded", description: "when the visible tiles have finished loading.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            tilt_changed: { name: "tilt_changed", description: "when the map tilt property changes.", parameters: [], important: true, defaultEvent: true },
            /*!componentEvent(GoogleMap)!1*/
            zoom_changed: { name: "zoom_changed", description: "when the map zoom property changes.", parameters: [], important: true, defaultEvent: true },

            // DATA EVENTS

            /*!componentEvent(GoogleMap)!1*/
            data_addfeature: {
                name: "data_addfeature",
                description: "when the viewport bounds have changed.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature that was added.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_click: {
                name: "data_click",
                description: "for a click on the geometry.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature that was clicked.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "lat_lng",
                        description: "The position that was clicked.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_dbl_click: {
                name: "data_dbl_click",
                description: "for a double click on the geometry.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature that was double-clicked.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "lat_lng",
                        description: "The position that was double-clicked.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_mousedown: {
                name: "data_mousedown",
                description: "for a mousedown on the geometry.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature the mouse is over.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "lat_lng",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_mouseout: {
                name: "data_mouseout",
                description: "when the mouse leaves the area of the geometry.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature the mouse left.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "lat_lng",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_mouseover: {
                name: "data_mouseover",
                description: "when the mouse enters the area of the geometry.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature the mouse is over.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "lat_lng",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_mouseup: {
                name: "data_mouseup",
                description: "for a mouseup on the geometry.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature the mouse is over.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "lat_lng",
                        description: "The position of the cursor.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_removefeature: {
                name: "data_removefeature",
                description: "when a feature is removed from the collection.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature that was removed.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_removeproperty: {
                name: "data_removeproperty",
                description: "when a feature's property is removed.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature whose property was removed.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "name",
                        description: "The name of the property that was removed.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "old_value",
                        description: "The old value of the property that was removed.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_rightclick: {
                name: "data_rightclick",
                description: "for a right-click on the geometry.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature that was right-clicked.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "lat_lng",
                        description: "The position that was right-clicked.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_setgeometry: {
                name: "data_setgeometry",
                description: "when a feature's geometry is set.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature that was removed.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "new_geometry",
                        description: "The geometry that was set.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "old_geometry",
                        description: "The geometry that was replaced.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
            /*!componentEvent(GoogleMap)!1*/
            data_setproperty: {
                name: "data_setproperty",
                description: "when a feature's property is set.",
                parameters: [
                    {
                        name: "feature",
                        description: "The feature whose property was set.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "name",
                        description: "The name of the property that was set.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "new_value",
                        description: "The new value of the property that was set.",
                        important: true,
                        pyVal: true,
                    },
                    {
                        name: "old_value",
                        description: "The old value of the property that was set.",
                        important: true,
                        pyVal: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
        }),


    });

    // hack to lazy load on the first call to getattr
    const oldGetAttr = pyModule["GoogleMap"].tp$getattr;
    pyModule["GoogleMap"].tp$getattr = function(name, canSuspend) {
        if (canSuspend) {
            return suspensionLoadGoogleMaps(() => {
                delete pyModule["GoogleMap"].tp$getattr;
                return this.tp$getattr(name, canSuspend);
            });
        }
        return oldGetAttr.call(this, name, canSuspend);
    };


    function GoogleMapLocals($Map) {

        $Map["__new__"] = PyDefUtils.mkNew(pyModule["ClassicContainer"], (self) => {
            let mkJsVals;

            if (ANVIL_IN_DESIGNER) {
                mkJsVals = () => {
                    self._jsVal = {
                        setOptions: () => {},
                        getCenter: () => {},
                    };
                };
            } else {
                mkJsVals = () => {
                    // This is set in DesignGoogleMap.js before calling this constructor.
                    self._jsVal = new google.maps.Map(self._anvil.domNode, {
                        center: { lat: 50, lng: -45 },
                    });
                    self._jsVal.addListener("bounds_changed", function () {
                        PyDefUtils.raiseEventAsync({}, self, "bounds_changed");
                    });
                    self._jsVal.addListener("center_changed", function () {
                        PyDefUtils.raiseEventAsync({}, self, "center_changed");
                    });
                    self._jsVal.addListener("click", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng), pixel: remapToPy(e.pixel) }, self, "click");
                    });
                    self._jsVal.addListener("dbl_click", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng), pixel: remapToPy(e.pixel) }, self, "dbl_click");
                    });
                    self._jsVal.addListener("drag", function () {
                        PyDefUtils.raiseEventAsync({}, self, "drag");
                    });
                    self._jsVal.addListener("dragend", function () {
                        PyDefUtils.raiseEventAsync({}, self, "dragend");
                    });
                    self._jsVal.addListener("dragstart", function () {
                        PyDefUtils.raiseEventAsync({}, self, "dragstart");
                    });
                    self._jsVal.addListener("heading_changed", function () {
                        PyDefUtils.raiseEventAsync({}, self, "heading_changed");
                    });
                    self._jsVal.addListener("idle", function () {
                        PyDefUtils.raiseEventAsync({}, self, "idle");
                    });
                    self._jsVal.addListener("maptypeid_changed", function () {
                        PyDefUtils.raiseEventAsync({}, self, "maptypeid_changed");
                    });
                    self._jsVal.addListener("mousemove", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng), pixel: remapToPy(e.pixel) }, self, "mousemove");
                    });
                    self._jsVal.addListener("mouseout", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng), pixel: remapToPy(e.pixel) }, self, "mouseout");
                    });
                    self._jsVal.addListener("mouseover", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng), pixel: remapToPy(e.pixel) }, self, "mouseover");
                    });
                    self._jsVal.addListener("projection_changed", function () {
                        PyDefUtils.raiseEventAsync({}, self, "projection_changed");
                    });
                    self._jsVal.addListener("rightclick", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng), pixel: remapToPy(e.pixel) }, self, "rightclick");
                    });
                    self._jsVal.addListener("tilesloaded", function () {
                        PyDefUtils.raiseEventAsync({}, self, "tilesloaded");
                    });
                    self._jsVal.addListener("tilt_changed", function () {
                        PyDefUtils.raiseEventAsync({}, self, "tilt_changed");
                    });
                    self._jsVal.addListener("zoom_changed", function () {
                        PyDefUtils.raiseEventAsync({}, self, "zoom_changed");
                    });
                    self._jsVal._pyVal = self;
                    self._anvil.mapData = Sk.misceval.callsim($Map["Data"], self._jsVal.data);
                };
            }
            // we do this now because self._jsVal only exists here
            return suspensionLoadGoogleMaps(mkJsVals, () => setMapProps(self));

        });



        // OBJECT SPECS

        function objectSpec() { }

        $Map["ObjectSpec"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            $loc["__init__"] = PyDefUtils.funcWithRawKwargsDict(function(kwargs, self) {
                self._jsVal = new objectSpec();
                self._jsVal = kwargs;

                self._toJsVal = function() {
                    return unwrapKwargs(self._jsVal);
                };
            });

            $loc["__setattr__"] = new Sk.builtin.func(function(self, pyName, pyValue) {

                var name = Sk.ffi.toJs(pyName);

                self._jsVal[name] = pyValue;

                return Sk.builtin.object.prototype.tp$setattr.call(self, pyName, pyValue);

            });

            $loc["__getattr__"] = new Sk.builtin.func(function(self, pyName) {

                var name = Sk.ffi.toJs(pyName);

                if (name in self._jsVal) {
                    return self._jsVal[name];
                }
                throw new Sk.builtin.AttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
            });

        }, "GoogleMap.ObjectSpec", []);
        registerRemapType(() => objectSpec, $Map["ObjectSpec"]);

        $Map["LatLngLiteral"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "lat",
                type: "number",
                description: "The latitude in degrees."
            }, /*!defAttr()!1*/{
                name: "lng",
                type: "number",
                description: "The longitude in degrees."
            },];

            /*!defInitFromAttrs()!1*/ "Create a new LatLngLiteral object at the specified latitude and longitude.";
        }, /*!defClass(anvil.GoogleMap,LatLngLiteral)!*/ "GoogleMap.LatLngLiteral", [$Map["ObjectSpec"]]);

        $Map["LatLngBoundsLiteral"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "north",
                type: "number",
                description: "The latitude of the north edge of the bounds, in degrees."
            }, /*!defAttr()!1*/{
                name: "east",
                type: "number",
                description: "The longitude of the east edge of the bounds, in degrees."
            }, /*!defAttr()!1*/{
                name: "south",
                type: "number",
                description: "The latitude of the south edge of the bounds, in degrees."
            }, /*!defAttr()!1*/{
                name: "west",
                type: "number",
                description: "The longitude of the west edge of the bounds, in degrees."
            },];
            /*!defInitFromAttrs()!1*/ "Construct a LatLngBoundsLiteral with the specified edges.";
        }, /*!defClass(anvil.GoogleMap,LatLngBoundsLiteral)!*/ "GoogleMap.LatLngBoundsLiteral", [$Map["ObjectSpec"]]);

        $Map["Icon"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "anchor",
                pyType: "anvil.GoogleMap.Point instance",
                description: "The position at which to anchor an image in correspondence to the location of the marker on the map. By default, the anchor is located along the center point of the bottom of the image."
            },/*!defAttr()!1*/{
                name: "label_origin",
                type: "anvil.GoogleMap.Point instance",
                description: "The origin of the label relative to the top-left corner of the icon image, if a label is supplied by the marker. By default, the origin is located in the center point of the image."
            },/*!defAttr()!1*/{
                name: "origin",
                type: "anvil.GoogleMap.Point instance",
                description: "The position of the image within a sprite, if any. By default, the origin is located at the top left corner of the image (0, 0)."
            },/*!defAttr()!1*/{
                name: "scaled_size",
                pyType: "anvil.GoogleMap.Size instance",
                description: "The size of the entire image after scaling, if any. Use this property to stretch/shrink an image or a sprite."
            },/*!defAttr()!1*/{
                name: "size",
                pyType: "anvil.GoogleMap.Size instance",
                description: "The display size of the sprite or image. When using sprites, you must specify the sprite size. If the size is not provided, it will be set when the image loads."
            },/*!defAttr()!1*/{
                name: "url",
                type: "string",
                description: "The URL of the image or sprite sheet."
            },];
            /*!defInitFromAttrs()!1*/ "Construct an Icon with the specified options.";
        }, /*!defClass(anvil.GoogleMap,Icon)!*/ "GoogleMap.Icon", [$Map["ObjectSpec"]]);

        $Map["Symbol"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "anchor",
                pyType: "anvil.GoogleMap.Point instance",
                description: "The position of the symbol relative to the marker or polyline."
            },/*!defAttr()!1*/{
                name: "fill_color",
                type: "string",
                description: "The fill color of this symbol."
            },/*!defAttr()!1*/{
                name: "fill_opacity",
                type: "number",
                description: "The fill opacity of this symbol. Defaults to 0."
            },/*!defAttr()!1*/{
                name: "label_origin",
                pyType: "anvil.GoogleMap.Point instance",
                description: "The origin of the label relative to the origin of the path, if label is supplied by the marker."
            },/*!defAttr()!1*/{
                name: "path",
                pyType: "anvil.GoogleMap.SymbolPath",
                description: "The symbol's path, which is a built-in symbol path, or a custom path expressed using SVG path notation."
            },/*!defAttr()!1*/{
                name: "rotation",
                type: "number",
                description: "The angle by which to rotate the symbol, expressed clockwise in degrees. "
            },/*!defAttr()!1*/{
                name: "scale",
                type: "number",
                description: "The amount by which the symbol is scaled in size."
            },/*!defAttr()!1*/{
                name: "strokeColor",
                type: "string",
                description: "The symbol's stroke color."
            },/*!defAttr()!1*/{
                name: "strokeOpacity",
                type: "number",
                description: "The symbol's stroke opacity."
            },/*!defAttr()!1*/{
                name: "strokeWeight",
                type: "number",
                description: "The symbol's stroke weight."
            },];
            /*!defInitFromAttrs()!1*/ "Construct a Symbol with the specified options.";
        }, /*!defClass(anvil.GoogleMap,Symbol)!*/ "GoogleMap.Symbol", [$Map["ObjectSpec"]]);

        $Map["IconSequence"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "icon",
                pyType: "anvil.GoogleMap.Symbol instance",
                description: "The icon to render on the line."
            },/*!defAttr()!1*/{
                name: "fixed_rotation",
                type: "boolean",
                description: "If true, each icon in the sequence has the same fixed rotation regardless of the angle of the edge on which it lies. Defaults to false."
            },/*!defAttr()!1*/{
                name: "offset",
                type: "number",
                description: "The distance from the start of the line at which an icon is to be rendered."
            },/*!defAttr()!1*/{
                name: "repeat",
                type: "string",
                description: "The distance between consecutive icons on the line."
            },];
            /*!defInitFromAttrs()!1*/ "Construct a new IconSequence with the specified options.";
        }, /*!defClass(anvil.GoogleMap,IconSequence)!*/ "GoogleMap.IconSequence", [$Map["ObjectSpec"]]);

        $Map["FullscreenControlOptions"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "position",
                pyType: "anvil.GoogleMap.ControlPosition",
                description: "Position of the controls."
            },];
            /*!defInitFromAttrs()!1*/ "Construct new FullscreenControlOptions with the specified options.";
        }, /*!defClass(anvil.GoogleMap,FullscreenControlOptions)!*/ "GoogleMap.FullscreenControlOptions", [$Map["ObjectSpec"]]);

        $Map["MapTypeControlOptions"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "position",
                pyType: "anvil.GoogleMap.ControlPosition",
                description: "Position of the controls."
            },/*!defAttr()!1*/{
                name: "style",
                pyType: "anvil.GoogleMap.MapTypeControlStyle",
                description: "Used to select what style of map type control to display."
            },/*!defAttr()!1*/{
                name: "map_type_ids",
                type: "list(string)",
                description: "IDs of map types to show in the control."
            },];
            /*!defInitFromAttrs()!1*/ "Construct new MapTypeControlOptions with the specified options.";
        }, /*!defClass(anvil.GoogleMap,MapTypeControlOptions)!*/ "GoogleMap.MapTypeControlOptions", [$Map["ObjectSpec"]]);

        $Map["MotionTrackingControlOptions"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "position",
                pyType: "anvil.GoogleMap.ControlPosition",
                description: "Position of the controls."
            },];
            /*!defInitFromAttrs()!1*/ "Construct new MotionTrackingControlOptions with the specified options.";
        }, /*!defClass(anvil.GoogleMap,MotionTrackingControlOptions)!*/ "GoogleMap.MotionTrackingControlOptions", [$Map["ObjectSpec"]]);

        $Map["RotateControlOptions"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "position",
                pyType: "anvil.GoogleMap.ControlPosition",
                description: "Position of the controls."
            },];
            /*!defInitFromAttrs()!1*/ "Construct new RotateControlOptions with the specified options.";
        }, /*!defClass(anvil.GoogleMap,RotateControlOptions)!*/ "GoogleMap.RotateControlOptions", [$Map["ObjectSpec"]]);

        $Map["ScaleControlOptions"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "position",
                pyType: "anvil.GoogleMap.ControlPosition",
                description: "Position of the controls."
            },];
            /*!defInitFromAttrs()!1*/ "Construct new ScaleControlOptions with the specified options.";
        }, /*!defClass(anvil.GoogleMap,ScaleControlOptions)!*/ "GoogleMap.ScaleControlOptions", [$Map["ObjectSpec"]]);

        $Map["StreetViewControlOptions"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "position",
                pyType: "anvil.GoogleMap.ControlPosition",
                description: "Position of the controls."
            },];
            /*!defInitFromAttrs()!1*/ "Construct new StreetViewControlOptions with the specified options.";
        }, /*!defClass(anvil.GoogleMap,StreetViewControlOptions)!*/ "GoogleMap.StreetViewControlOptions", [$Map["ObjectSpec"]]);

        $Map["ZoomControlOptions"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "position",
                pyType: "anvil.GoogleMap.ControlPosition",
                description: "Position of the controls."
            },];
            /*!defInitFromAttrs()!1*/ "Construct new ZoomControlOptions with the specified options.";
        }, /*!defClass(anvil.GoogleMap,ZoomControlOptions)!*/ "GoogleMap.ZoomControlOptions", [$Map["ObjectSpec"]]);

        $Map["MarkerLabel"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "color",
                type: "string",
                description: "The color of the label text. Default color is black."
            },/*!defAttr()!1*/{
                name: "font_family",
                type: "string",
                description: "The font family of the label text."
            },/*!defAttr()!1*/{
                name: "font_size",
                type: "string",
                description: "The font size of the label text."
            },/*!defAttr()!1*/{
                name: "font_weight",
                type: "string",
                description: "The font weight of the label text."
            },/*!defAttr()!1*/{
                name: "text",
                type: "string",
                description: "The text to be displayed in the label."
            },];
            /*!defInitFromAttrs()!1*/ "Construct a new MarkerLabel with the specified options.";
        }, /*!defClass(anvil.GoogleMap,MarkerLabel)!*/ "GoogleMap.MarkerLabel", [$Map["ObjectSpec"]]);

        $Map["GeocoderResult"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "address_components",
                pyType: "list(anvil.GoogleMap.GeocoderAddressComponent instance)",
                description: "An array of GeocoderAddressComponents"
            },/*!defAttr()!1*/{
                name: "formatted_address",
                type: "string",
                description: "A string containing the human-readable address of this location."
            },/*!defAttr()!1*/{
                name: "geometry",
                pyType: "anvil.GoogleMap.GeocoderGeometry instance",
                description: "A GeocoderGeometry object"
            },/*!defAttr()!1*/{
                name: "partial_match",
                type: "boolean",
                description: "Whether the geocoder did not return an exact match for the original request, though it was able to match part of the requested address."
            },/*!defAttr()!1*/{
                name: "place_id",
                type: "string",
                description: "The place ID associated with the location. Place IDs uniquely identify a place in the Google Places database and on Google Maps."
            },/*!defAttr()!1*/{
                name: "postcode_localities",
                type: "list(string)",
                description: "An array of strings denoting all the localities contained in a postal code. This is only present when the result is a postal code that contains multiple localities."
            },/*!defAttr()!1*/{
                name: "types",
                type: "list(string)",
                description: "An array of strings denoting the type of the returned geocoded element."
            },];
            // No init function for this. Should never be constructed manually.
            /*!defClass(anvil.GoogleMap,GeocoderResult)!*/
        },  "GoogleMap.GeocoderResult", [$Map["ObjectSpec"]]);

        $Map["GeocoderAddressComponent"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "long_name",
                type: "string",
                description: "The full text of the address component"
            },/*!defAttr()!1*/{
                name: "short_name",
                type: "string",
                description: "The abbreviated, short text of the given address component."
            },/*!defAttr()!1*/{
                name: "types",
                type: "list(string)",
                description: "An array of strings denoting the type of this address component."
            }];
            // No init function for this. Should never be constructed manually.
            /*!defClass(anvil.GoogleMap,GeocoderAddressComponent)!*/
        },  "GoogleMap.GeocoderAddressComponent", [$Map["ObjectSpec"]]);

        $Map["GeocoderGeometry"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

            [ /*!defAttr()!1*/{
                name: "bounds",
                pyType: "anvil.GoogleMap.LatLngBounds instance",
                description: "The precise bounds of this GeocoderResult, if applicable."
            },/*!defAttr()!1*/{
                name: "location",
                pyType: "anvil.GoogleMap.LatLng instance",
                description: "The latitude/longitude coordinates of this result."
            },/*!defAttr()!1*/{
                name: "location_type",
                pyType: "anvil.GoogleMap.GeocoderLocationType",
                description: "The type of location returned."
            },/*!defAttr()!1*/{
                name: "viewport",
                pyType: "anvil.GoogleMap.LatLngBounds instance",
                description: "The bounds of the recommended viewport for displaying this GeocoderResult."
            }];
            // No init function for this. Should never be constructed manually.
            /*!defClass(anvil.GoogleMap,GeocoderGeometry)!*/
        },  "GoogleMap.GeocoderGeometry", [$Map["ObjectSpec"]]);

        // NESTED CLASSES

        $Map["LatLng"] = Sk.misceval.buildClass(pyModule, function($$gbl, $LatLng) {

            /*!defMethod(,lat,lng)!2*/ "Create a new LatLng object at the specified latitude and longitude.";
            $LatLng["__init__"] = new Sk.builtin.func(initFnWithJsObjOrPyArgs(() => google.maps.LatLng,
                function(self, pyLat, pyLng, pyNoWrap) {
                    var lat = Sk.ffi.toJs(pyLat);
                    var lng = Sk.ffi.toJs(pyLng);
                    var noWrap = pyNoWrap ? Sk.ffi.toJs(pyNoWrap) : false;
                    self._jsVal = new google.maps.LatLng(lat, lng, noWrap);
                }));

            $LatLng["__repr__"] = new Sk.builtin.func(function(self) {
                return Sk.ffi.toPy("<GoogleMap.LatLng: " + self._jsVal.toUrlValue() + ">");
            });

            /*!defMethod(number,)!2*/ "Returns the latitude in degrees." ["lat"];
            /*!defMethod(number,)!2*/ "Returns the longitude in degrees." ["lng"];
            registerMethods($LatLng, {
                lat: { },
                lng: { },
            });

        }, /*!defClass(anvil.GoogleMap,LatLng)!*/ "GoogleMap.LatLng", []);
        registerRemapType(() => google.maps.LatLng, $Map["LatLng"]);

        $Map["LatLngBounds"] = Sk.misceval.buildClass(pyModule, function($$gbl, $LatLngBounds) {

            /*!defMethod(,south_west, north_east)!2*/ "Create a new LatLngBounds object with the specified corners.";
            $LatLngBounds["__init__"] = new Sk.builtin.func(initFnWithJsObjOrPyArgs(() => google.maps.LatLngBounds,
                function(self, pySw, pyNe) {
                    var sw = remapToJs(pySw);
                    var ne = remapToJs(pyNe);
                    self._jsVal = new google.maps.LatLngBounds(sw, ne);
                }));

            $LatLngBounds["__repr__"] = new Sk.builtin.func(function(self) {
                var pySw = Sk.misceval.callsim($Map["LatLng"], self._jsVal.getSouthWest());
                var pyNe = Sk.misceval.callsim($Map["LatLng"], self._jsVal.getNorthEast());
                return Sk.ffi.toPy("<GoogleMap.LatLngBounds sw=" + Sk.ffi.toJs(Sk.builtin.str(pySw)) + ", ne=" + Sk.ffi.toJs(Sk.builtin.str(pyNe)) + ">");
            });

            /*!defMethod(boolean,point)!2*/ "Returns True if the given lat/lng is in this bounds." ["contains"];
            /*!defMethod(boolean,other)!2*/ "Returns True if this bounds approximately equals the given bounds." ["equals"];
            /*!defMethod(None,point)!2*/ "Extends this bounds to contain the given point." ["extend"];
            /*!defMethod(anvil.GoogleMap.LatLng instance,)!2*/ "Computes the center of this LatLngBounds" ["get_center"];
            /*!defMethod(anvil.GoogleMap.LatLng instance,)!2*/ "Returns the north-east corner of this bounds." ["get_north_east"];
            /*!defMethod(anvil.GoogleMap.LatLng instance,)!2*/ "Returns the south-west corner of this bounds." ["get_south_west"];
            /*!defMethod(boolean,other)!2*/ "Returns True if this bounds shares any points with the other bounds." ["intersects"];
            /*!defMethod(boolean,)!2*/ "Returns True if the bounds are empty." ["is_empty"];
            /*!defMethod(string,)!2*/ "Converts to JSON representation." ["to_json"];
            /*!defMethod(anvil.GoogleMap.LatLng instance,)!2*/ "Converts the given map bounds to a lat/lng span." ["to_span"];
            /*!defMethod(string,precision=6)!2*/ "Returns a string of the form 'lat_lo,lng_lo,lat_hi,lng_hi' for this bounds." ["to_url_value"];
            /*!defMethod(anvil.GoogleMap.LatLngBounds instance,other)!2*/ "Extends this bounds to contain the union of this and the given bounds." ["union"];
            registerMethods($LatLngBounds, {
                contains: { },
                equals: { },
                extend: { },
                get_center: { },
                get_north_east: { },
                get_south_west: { },
                intersects: { },
                is_empty: { },
                to_json: { fn: "toJSON" },
                to_span: { },
                to_url_value: { },
                union: { },
            });
        }, /*!defClass(anvil.GoogleMap,LatLngBounds)!*/ "GoogleMap.LatLngBounds", []);
        registerRemapType(() => google.maps.LatLngBounds, $Map["LatLngBounds"]);

        $Map["Point"] = Sk.misceval.buildClass(pyModule, function($$gbl, $Point) {

            /*!defMethod(,x,y)!2*/ "Create a new Point at the specified coordinates.";
            $Point["__init__"] = new Sk.builtin.func(initFnWithJsObjOrPyArgs(() => google.maps.Point,
                function(self, pyX, pyY) {
                    var x = Sk.ffi.toJs(pyX);
                    var y = Sk.ffi.toJs(pyY);
                    self._jsVal = new google.maps.Point(x,y);
                }));

            // TODO: Add methods and attributes
        }, /*!defClass(anvil.GoogleMap,Point)!*/ "GoogleMap.Point", []);
        registerRemapType(() => google.maps.Point, $Map["Point"]);

        $Map["Size"] = Sk.misceval.buildClass(pyModule, function($$gbl, $Size) {

            /*!defMethod(,x,y)!2*/ "Create a new Size at the specified coordinates.";
            $Size["__init__"] = new Sk.builtin.func(initFnWithJsObjOrPyArgs(() => google.maps.Size,
                function(self, pyWidth, pyHeight) {
                    var width = Sk.ffi.toJs(pyWidth);
                    var height = Sk.ffi.toJs(pyHeight);
                    self._jsVal = new google.maps.Size(width,height);
                }));

            // TODO: Add methods and attributes
        }, /*!defClass(anvil.GoogleMap,Size)!*/ "GoogleMap.Size", []);
        registerRemapType(() => google.maps.Size, $Map["Size"]);

        // ENUMS
        $Map["GeocoderLocationType"] = () => Sk.misceval.buildClass(pyModule, function($$gbl, $GeocoderLocationType) {
            [ /*!defClassAttr()!1*/ {
                name: "APPROXIMATE",
                type: "Built-in GeocoderLocationType",
                description: "The returned result is approximate."
            },/*!defClassAttr()!1*/ {
                name: "GEOMETRIC_CENTER",
                type: "Built-in GeocoderLocationType",
                description: "The returned result is the geometric center of a result such a line (e.g. street) or polygon (region)."
            },/*!defClassAttr()!1*/ {
                name: "RANGE_INTERPOLATED",
                type: "Built-in GeocoderLocationType",
                description: "The returned result reflects an approximation (usually on a road) interpolated between two precise points (such as intersections)."
            },/*!defClassAttr()!1*/ {
                name: "ROOFTOP",
                type: "Built-in GeocoderLocationType",
                description: "The returned result reflects a precise geocode."
            },];
            $GeocoderLocationType["APPROXIMATE"] = Sk.ffi.toPy(google.maps.GeocoderLocationType.APPROXIMATE);
            $GeocoderLocationType["GEOMETRIC_CENTER"] = Sk.ffi.toPy(google.maps.GeocoderLocationType.GEOMETRIC_CENTER);
            $GeocoderLocationType["RANGE_INTERPOLATED"] = Sk.ffi.toPy(google.maps.GeocoderLocationType.RANGE_INTERPOLATED);
            $GeocoderLocationType["ROOFTOP"] = Sk.ffi.toPy(google.maps.GeocoderLocationType.ROOFTOP);
            /*!defClassNoConstructor(anvil.GoogleMap,GeocoderLocationType)!1*/ "Describes the type of location returned from a geocode.";
        },  "GoogleMap.GeocoderLocationType", []);
        lazyEnums.push("GeocoderLocationType");

        $Map["SymbolPath"] = () => Sk.misceval.buildClass(pyModule, function($$gbl, $SymbolPath) {
            [ /*!defClassAttr()!1*/ {
                name: "BACKWARD_CLOSED_ARROW",
                type: "Built-in SymbolPath",
            },/*!defClassAttr()!1*/ {
                name: "BACKWARD_OPEN_ARROW",
                type: "Built-in SymbolPath",
            },/*!defClassAttr()!1*/ {
                name: "CIRCLE",
                type: "Built-in SymbolPath",
            },/*!defClassAttr()!1*/ {
                name: "FORWARD_CLOSED_ARROW",
                type: "Built-in SymbolPath",
            },/*!defClassAttr()!1*/ {
                name: "FORWARD_OPEN_ARROW",
                type: "Built-in SymbolPath",
            },];
            $SymbolPath["BACKWARD_CLOSED_ARROW"] = Sk.ffi.toPy(google.maps.SymbolPath.BACKWARD_CLOSED_ARROW);
            $SymbolPath["BACKWARD_OPEN_ARROW"] = Sk.ffi.toPy(google.maps.SymbolPath.BACKWARD_OPEN_ARROW);
            $SymbolPath["CIRCLE"] = Sk.ffi.toPy(google.maps.SymbolPath.CIRCLE);
            $SymbolPath["FORWARD_CLOSED_ARROW"] = Sk.ffi.toPy(google.maps.SymbolPath.FORWARD_CLOSED_ARROW);
            $SymbolPath["FORWARD_OPEN_ARROW"] = Sk.ffi.toPy(google.maps.SymbolPath.FORWARD_OPEN_ARROW);
            /*!defClassNoConstructor(anvil.GoogleMap,SymbolPath)!1*/ "An object containing pre-defined symbol paths for use on maps.";
        },  "GoogleMap.SymbolPath", []);
        lazyEnums.push("SymbolPath");

        $Map["Animation"] = () => Sk.misceval.buildClass(pyModule, function($$gbl, $Animation) {
            [ /*!defClassAttr()!1*/ {
                name: "BOUNCE",
                type: "Animation",
                description: "Marker bounces until animation is stopped.",
            },/*!defClassAttr()!1*/ {
                name: "DROP",
                type: "Animation",
                description: "Marker falls from the top of the map ending with a small bounce.",
            },];

            $Animation["BOUNCE"] = Sk.ffi.toPy(google.maps.Animation.BOUNCE);
            $Animation["DROP"] = Sk.ffi.toPy(google.maps.Animation.DROP);
            /*!defClassNoConstructor(anvil.GoogleMap,Animation)!1*/ "An object containing pre-defined animations for use with Markers.";
        }, "GoogleMap.Animation", []);
        lazyEnums.push("Animation");

        $Map["MapTypeId"] = () => Sk.misceval.buildClass(pyModule, function($$gbl, $MapTypeId) {
            [ /*!defClassAttr()!1*/ {
                name: "HYBRID",
                type: "MapTypeId",
                description: "This map type displays a transparent layer of major streets on satellite images.",
            },/*!defClassAttr()!1*/ {
                name: "ROADMAP",
                type: "MapTypeId",
                description: "This map type displays a normal street map.",
            },/*!defClassAttr()!1*/ {
                name: "SATELLITE",
                type: "MapTypeId",
                description: "This map type displays satellite images.",
            },/*!defClassAttr()!1*/ {
                name: "TERRAIN",
                type: "MapTypeId",
                description: "This map type displays maps with physical features such as terrain and vegetation.",
            },];

            $MapTypeId["HYBRID"] = Sk.ffi.toPy(google.maps.MapTypeId.HYBRID);
            $MapTypeId["ROADMAP"] = Sk.ffi.toPy(google.maps.MapTypeId.ROADMAP);
            $MapTypeId["SATELLITE"] = Sk.ffi.toPy(google.maps.MapTypeId.SATELLITE);
            $MapTypeId["TERRAIN"] = Sk.ffi.toPy(google.maps.MapTypeId.TERRAIN);
            /*!defClassNoConstructor(anvil.GoogleMap,MapTypeId)!1*/ "An object containing pre-defined map types.";
        }, "GoogleMap.MapTypeId", []);
        lazyEnums.push("MapTypeId");

        $Map["StrokePosition"] = () => Sk.misceval.buildClass(pyModule, function($$gbl, $StrokePosition) {
            [ /*!defClassAttr()!1*/ {
                name: "CENTER",
                type: "Built-in StrokePosition",
            },/*!defClassAttr()!1*/ {
                name: "INSIDE",
                type: "Built-in StrokePosition",
            },/*!defClassAttr()!1*/ {
                name: "OUTSIDE",
                type: "Built-in StrokePosition",
            },];

            $StrokePosition["CENTER"] = Sk.ffi.toPy(google.maps.StrokePosition.CENTER);
            $StrokePosition["INSIDE"] = Sk.ffi.toPy(google.maps.StrokePosition.INSIDE);
            $StrokePosition["OUTSIDE"] = Sk.ffi.toPy(google.maps.StrokePosition.OUTSIDE);
            /*!defClassNoConstructor(anvil.GoogleMap,StrokePosition)!1*/ "An object containing pre-defined stroke positions for shape outlines.";
        }, "GoogleMap.StrokePosition", []);
        lazyEnums.push("StrokePosition");

        $Map["MapTypeControlStyle"] = () => Sk.misceval.buildClass(pyModule, function($$gbl, $MapTypeControlStyle) {
            [ /*!defClassAttr()!1*/ {
                name: "DEFAULT",
                type: "MapTypeControlStyle",
            },/*!defClassAttr()!1*/ {
                name: "DROPDOWN_MENU",
                type: "MapTypeControlStyle",
            },/*!defClassAttr()!1*/ {
                name: "HORIZONTAL_BAR",
                type: "MapTypeControlStyle",
            },];
            $MapTypeControlStyle["DEFAULT"] = Sk.ffi.toPy(google.maps.MapTypeControlStyle.DEFAULT);
            $MapTypeControlStyle["DROPDOWN_MENU"] = Sk.ffi.toPy(google.maps.MapTypeControlStyle.DROPDOWN_MENU);
            $MapTypeControlStyle["HORIZONTAL_BAR"] = Sk.ffi.toPy(google.maps.MapTypeControlStyle.HORIZONTAL_BAR);
            /*!defClassNoConstructor(anvil.GoogleMap,MapTypeControlStyle)!1*/ "An object containing pre-defined control styles.";
        }, "GoogleMap.MapTypeControlStyle", []);
        lazyEnums.push("MapTypeControlStyle");

        $Map["ControlPosition"] = () => Sk.misceval.buildClass(pyModule, function($$gbl, $ControlPosition) {
            [ /*!defClassAttr()!1*/ {
                name: "BOTTOM_CENTER",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "BOTTOM_LEFT",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "BOTTOM_RIGHT",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "LEFT_BOTTOM",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "LEFT_CENTER",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "LEFT_TOP",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "RIGHT_BOTTOM",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "RIGHT_CENTER",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "RIGHT_TOP",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "TOP_CENTER",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "TOP_LEFT",
                type: "ControlPosition",
            },/*!defClassAttr()!1*/ {
                name: "TOP_RIGHT",
                type: "ControlPosition",
            },];
            $ControlPosition["BOTTOM_CENTER"] = Sk.ffi.toPy(google.maps.ControlPosition.BOTTOM_CENTER);
            $ControlPosition["BOTTOM_LEFT"] = Sk.ffi.toPy(google.maps.ControlPosition.BOTTOM_LEFT);
            $ControlPosition["BOTTOM_RIGHT"] = Sk.ffi.toPy(google.maps.ControlPosition.BOTTOM_RIGHT);
            $ControlPosition["LEFT_BOTTOM"] = Sk.ffi.toPy(google.maps.ControlPosition.LEFT_BOTTOM);
            $ControlPosition["LEFT_CENTER"] = Sk.ffi.toPy(google.maps.ControlPosition.LEFT_CENTER);
            $ControlPosition["LEFT_TOP"] = Sk.ffi.toPy(google.maps.ControlPosition.LEFT_TOP);
            $ControlPosition["RIGHT_BOTTOM"] = Sk.ffi.toPy(google.maps.ControlPosition.RIGHT_BOTTOM);
            $ControlPosition["RIGHT_CENTER"] = Sk.ffi.toPy(google.maps.ControlPosition.RIGHT_CENTER);
            $ControlPosition["RIGHT_TOP"] = Sk.ffi.toPy(google.maps.ControlPosition.RIGHT_TOP);
            $ControlPosition["TOP_CENTER"] = Sk.ffi.toPy(google.maps.ControlPosition.TOP_CENTER);
            $ControlPosition["TOP_LEFT"] = Sk.ffi.toPy(google.maps.ControlPosition.TOP_LEFT);
            $ControlPosition["TOP_RIGHT"] = Sk.ffi.toPy(google.maps.ControlPosition.TOP_RIGHT);
            /*!defClassNoConstructor(anvil.GoogleMap,ControlPosition)!1*/ "An object containing pre-defined control positions.";
        }, "GoogleMap.ControlPosition", []);
        lazyEnums.push("ControlPosition");

        // DATA
        $Map["Data"] = Sk.misceval.buildClass(pyModule, function($$gbl, $Data) {


            [/*!defClassAttr()!1*/{
                name: "StyleOptions",
                pyType: "anvil.GoogleMap.Data.StyleOptions",
            }];
            $Data["StyleOptions"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

                [ /*!defAttr()!1*/{
                    name: "clickable",
                    type: "boolean",
                    description: "If true, the marker receives mouse and touch events. Default value is true."
                },/*!defAttr()!1*/{
                    name: "cursor",
                    type: "string",
                    description: "Mouse cursor to show on hover. Only applies to point geometries."
                },/*!defAttr()!1*/{
                    name: "draggable",
                    type: "boolean",
                    description: "If true, the object can be dragged across the map and the underlying feature will have its geometry updated."
                },/*!defAttr()!1*/{
                    name: "editable",
                    type: "boolean",
                    description: "If true, the object can be edited by dragging control points and the underlying feature will have its geometry updated."
                },/*!defAttr()!1*/{
                    name: "fill_color",
                    type: "string",
                    description: "The fill color."
                },/*!defAttr()!1*/{
                    name: "fill_opacity",
                    type: "number",
                    description: "The fill opacity between 0.0 and 1.0."
                },/*!defAttr()!1*/{
                    name: "icon",
                    pyType: "anvil.GoogleMap.Symbol instance",
                    description: "Icon for the foreground."
                },/*!defAttr()!1*/{
                    name: "stroke_color",
                    type: "string",
                    description: "The stroke color."
                },/*!defAttr()!1*/{
                    name: "stroke_opacity",
                    type: "number",
                    description: "The stroke opacity between 0.0 and 1.0."
                },/*!defAttr()!1*/{
                    name: "stroke_weight",
                    type: "number",
                    description: "The stroke width in pixels."
                },/*!defAttr()!1*/{
                    name: "title",
                    type: "string",
                    description: "Rollover text."
                },/*!defAttr()!1*/{
                    name: "visible",
                    type: "boolean",
                    description: "Whether the feature is visible."
                },/*!defAttr()!1*/{
                    name: "z_index",
                    type: "number",
                    description: "All features are displayed on the map in order of their zIndex, with higher values displaying in front of features with lower values."
                },];
            /*!defInitFromAttrs()!*/
            }, /*!defClass(anvil.GoogleMap.Data,StyleOptions)!*/ "GoogleMap.Data.StyleOptions", [$Map["ObjectSpec"]]);


            [/*!defClassAttr()!1*/{
                name: "Geometry",
                pyType: "anvil.GoogleMap.Data.Geometry",
            }];
            $Data["Geometry"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $Geometry) {

                /*defMethod(None)!2*/ "Repeatedly invokes the given function, passing a point from the geometry to the function on each invocation." ["for_each_lat_lng"];
                /*!defMethod(string)!2*/ "Returns the type of the geometry object." ["get_type"];
                registerMethods($Geometry, {
                    //for_each_lat_lng,
                    get_type: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,Geometry)!*/ "GoogleMap.Data.Geometry", []);

            [/*!defClassAttr()!1*/{
                name: "Point",
                pyType: "anvil.GoogleMap.Data.Point",
            }];
            $Data["Point"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $Point) {
            /*!defMethod(,lat_lng)!2*/ "Create a new Point at the specified position.";
                $Point["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data.Point,
                    function(kwargs, self, pyLatLng) {
                        self._jsVal = new google.maps.Data.Point(remapToJs(pyLatLng));
                    }));

                /*!defMethod(anvil.GoogleMap.LatLng instance)!2*/ "Returns the contained LatLng." ["get"];
                registerMethods($Point, {
                    get: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,Point,Geometry)!*/ "GoogleMap.Data.Point", [$Data["Geometry"]]);
            registerRemapType(() => google.maps.Data.Point, $Data["Point"]);

            [/*!defClassAttr()!1*/{
                name: "MultiPoint",
                pyType: "anvil.GoogleMap.Data.MultiPoint",
            }];
            $Data["MultiPoint"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $MultiPoint) {
            /*!defMethod(,points)!2*/ "Create a new MultiPoint geometry containing the specified points.";
                $MultiPoint["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data.MultiPoint,
                    function(kwargs, self, pyLatLngArr) {
                        self._jsVal = new google.maps.Data.MultiPoint(remapToJs(pyLatLngArr));
                    }));

                /*!defMethod(list[anvil.GoogleMap.LatLng instance])!2*/ "Returns an array of the contained LatLngs. A new array is returned each time get_array() is called." ["get_array"];
                /*!defMethod(anvil.GoogleMap.LatLng instance,n)!2*/ "Returns the n-th contained LatLng." ["get_at"];
                /*!defMethod(number)!2*/ "Returns the number of contained LatLngs." ["get_length"];
                registerMethods($MultiPoint, {
                    //for_each_lat_lng: ,
                    get_array: { },
                    get_at: { },
                    get_length: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,MultiPoint,Geometry)!*/ "GoogleMap.Data.MultiPoint", [$Data["Geometry"]]);
            registerRemapType(() => google.maps.Data.MultiPoint, $Data["MultiPoint"]);

            [/*!defClassAttr()!1*/{
                name: "LineString",
                pyType: "anvil.GoogleMap.Data.LineString",
            }];
            $Data["LineString"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $LineString) {
            /*!defMethod(,points)!2*/ "Create a new LineString geometry from the specified points.";
                $LineString["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data.LineString,
                    function(kwargs, self, pyLatLngArr) {
                        self._jsVal = new google.maps.Data.LineString(remapToJs(pyLatLngArr));
                    }));

                /*!defMethod(list[anvil.GoogleMap.LatLng instance])!2*/ "Returns an array of the contained LatLngs. A new array is returned each time get_array() is called." ["get_array"];
                /*!defMethod(anvil.GoogleMap.LatLng instance,n)!2*/ "Returns the n-th contained LatLng." ["get_at"];
                /*!defMethod(number)!2*/ "Returns the number of contained LatLngs." ["get_length"];
                registerMethods($LineString, {
                    //for_each_lat_lng: ,
                    get_array: { },
                    get_at: { },
                    get_length: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,LineString,Geometry)!*/ "GoogleMap.Data.LineString", [$Data["Geometry"]]);
            registerRemapType(() => google.maps.Data.LineString, $Data["LineString"]);

            [/*!defClassAttr()!1*/{
                name: "MultiLineString",
                pyType: "anvil.GoogleMap.Data.MultiLineString",
            }];
            $Data["MultiLineString"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $MultiLineString) {
            /*!defMethod(,points)!2*/ "Constructs a Data.MultiLineString from the given Data.LineStrings or arrays of positions.";
                $MultiLineString["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data.MultiLineString,
                    function(kwargs, self, pyLineStringArr) {
                        self._jsVal = new google.maps.Data.MultiLineString(remapToJs(pyLineStringArr));
                    }));

                /*!defMethod(list[anvil.GoogleMap.Data.LineString instance])!2*/ "Returns an array of the contained Data.LineStrings. A new array is returned each time get_array() is called." ["get_array"];
                /*!defMethod(anvil.GoogleMap.Data.LineString,n)!2*/ "Returns the n-th contained Data.LineString." ["get_at"];
                /*!defMethod(number)!2*/ "Returns the number of contained Data.LineStrings." ["get_length"];
                registerMethods($MultiLineString, {
                    //for_each_lat_lng: ,
                    get_array: { },
                    get_at: { },
                    get_length: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,MultiLineString,Geometry)!*/ "GoogleMap.Data.MultiLineString", [$Data["Geometry"]]);
            registerRemapType(() => google.maps.Data.MultiLineString, $Data["MultiLineString"]);

            [/*!defClassAttr()!1*/{
                name: "LinearRing",
                pyType: "anvil.GoogleMap.Data.LinearRing",
            }];
            $Data["LinearRing"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $LinearRing) {
            /*!defMethod(,points)!2*/ "Constructs a Data.LinearRing from the given LatLngs";
                $LinearRing["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data.LinearRing,
                    function(kwargs, self, pyLatLngArr) {
                        self._jsVal = new google.maps.Data.LinearRing(remapToJs(pyLatLngArr));
                    }));

                /*!defMethod(list[anvil.GoogleMap.LatLng instance])!2*/ "Returns an array of the contained LatLngs. A new array is returned each time get_array() is called." ["get_array"];
                /*!defMethod(anvil.GoogleMap.LatLng instance,n)!2*/ "Returns the n-th contained LatLng." ["get_at"];
                /*!defMethod(number)!2*/ "Returns the number of contained LatLngs." ["get_length"];
                registerMethods($LinearRing, {
                    //for_each_lat_lng: ,
                    get_array: { },
                    get_at: { },
                    get_length: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,LinearRing,Geometry)!*/ "GoogleMap.Data.LinearRing", [$Data["Geometry"]]);
            registerRemapType(() => google.maps.Data.LinearRing, $Data["LinearRing"]);

            [/*!defClassAttr()!1*/{
                name: "Polygon",
                pyType: "anvil.GoogleMap.Data.Polygon",
            }];
            $Data["Polygon"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $Polygon) {
            /*!defMethod(,points)!2*/ "Constructs a Data.Polygon from the given LinearRings or arrays of positions.";
                $Polygon["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data.Polygon,
                    function(kwargs, self, pyLinearRingArr) {
                        self._jsVal = new google.maps.Data.Polygon(remapToJs(pyLinearRingArr));
                    }));

                /*!defMethod(list[anvil.GoogleMap.Data.LinearRing instance])!2*/ "Returns an array of the contained LinearRings. A new array is returned each time get_array() is called." ["get_array"];
                /*!defMethod(anvil.GoogleMap.Data.LinearRing instance,n)!2*/ "Returns the n-th contained LinearRing." ["get_at"];
                /*!defMethod(number)!2*/ "Returns the number of contained LinearRings." ["get_length"];
                registerMethods($Polygon, {
                    //for_each_lat_lng: ,
                    get_array: { },
                    get_at: { },
                    get_length: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,Polygon,Geometry)!*/ "GoogleMap.Data.Polygon", [$Data["Geometry"]]);
            registerRemapType(() => google.maps.Data.Polygon, $Data["Polygon"]);

            [/*!defClassAttr()!1*/{
                name: "MultiPolygon",
                pyType: "anvil.GoogleMap.Data.MultiPolygon",
            }];
            $Data["MultiPolygon"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $MultiPolygon) {
            /*!defMethod(,points)!2*/ "Constructs a Data.MultiPolygon from the given Polygons or arrays of positions.";
                $MultiPolygon["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data.MultiPolygon,
                    function(kwargs, self, pyPolygonArr) {
                        self._jsVal = new google.maps.Data.MultiPolygon(remapToJs(pyPolygonArr));
                    }));

                /*!defMethod(list[anvil.GoogleMap.Data.Polygon instance])!2*/ "Returns an array of the contained Polygons. A new array is returned each time get_array() is called." ["get_array"];
                /*!defMethod(anvil.GoogleMap.Data.Polygon instance,n)!2*/ "Returns the n-th contained Polygon." ["get_at"];
                /*!defMethod(number)!2*/ "Returns the number of contained Polygons." ["get_length"];
                registerMethods($MultiPolygon, {
                    //for_each_lat_lng: ,
                    get_array: { },
                    get_at: { },
                    get_length: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,MultiPolygon,Geometry)!*/ "GoogleMap.Data.MultiPolygon", [$Data["Geometry"]]);
            registerRemapType(() => google.maps.Data.MultiPolygon, $Data["MultiPolygon"]);

            [/*!defClassAttr()!1*/{
                name: "GeometryCollection",
                pyType: "anvil.GoogleMap.Data.GeometryCollection",
            }];
            $Data["GeometryCollection"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $GeometryCollection) {
            /*!defMethod(,points)!2*/ "Constructs a Data.GeometryCollection from the given geometry objects or LatLngs.";
                $GeometryCollection["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data.GeometryCollection,
                    function(kwargs, self, pyGeomArr) {
                        self._jsVal = new google.maps.Data.GeometryCollection(remapToJs(pyGeomArr));
                    }));

                /*!defMethod(list[anvil.GoogleMap.Data.Geometry instance])!2*/ "Returns an array of the contained Geometries. A new array is returned each time get_array() is called." ["get_array"];
                /*!defMethod(anvil.GoogleMap.Data.Geometry instance,n)!2*/ "Returns the n-th contained Geometry." ["get_at"];
                /*!defMethod(number)!2*/ "Returns the number of contained Geometries." ["get_length"];
                registerMethods($GeometryCollection, {
                    //for_each_lat_lng: ,
                    get_array: { },
                    get_at: { },
                    get_length: { },
                });
            }, /*!defClass(anvil.GoogleMap.Data,GeometryCollection,Geometry)!*/ "GoogleMap.Data.GeometryCollection", [$Data["Geometry"]]);
            registerRemapType(() => google.maps.Data.GeometryCollection, $Data["GeometryCollection"]);

            // Register superclass last so that subclasses get matched first when remapping
            registerRemapType(() => google.maps.Data.Geometry, $Data["Geometry"]);

            [/*!defClassAttr()!1*/{
                name: "Feature",
                pyType: "anvil.GoogleMap.Data.Feature",
            }];
            $Data["Feature"] = Sk.misceval.buildClass(pyModule, function($$$gbl, $Feature) {
            /*!defMethod(,[geometry=None],[id=None],[properties=None])!2*/ "Create a new Feature.";
                $Feature["__init__"] = PyDefUtils.funcWithRawKwargsDict(initFnWithJsObjOrPyArgs(() => google.maps.Data.Feature,
                    function(kwargs, self) {
                        self._jsVal = new google.maps.Data.Feature(unwrapKwargs(kwargs));
                    }));

                [ /*!defAttr()!1*/{
                    name: "geometry",
                    pyType: "anvil.GoogleMap.Data.Geometry instance",
                    description: "The feature geometry."
                }, /*!defAttr()!1*/{
                    name: "id",
                    type: "string",
                    description: "Feature ID is optional."
                }];

                $Feature["__setattr__"] = new Sk.builtin.func(function(self, pyName, pyValue) {

                    var name = Sk.ffi.toJs(pyName);

                    switch(name) {
                        case "geometry":
                            self._jsVal.setGeometry(remapToJs(pyValue));
                            break;
                        case "id":
                            self._jsVal.setId(remapToJs(pyValue));
                            break;
                        default:
                            Sk.builtin.object.prototype.tp$setattr.call(self, pyName, pyValue);
                            break;
                    }
                });

                $Feature["__getattr__"] = new Sk.builtin.func(function(self, pyName) {

                    var name = Sk.ffi.toJs(pyName);

                    switch(name) {
                        case "geometry":
                            return remapToPy(self._jsVal.getGeometry());
                        case "id":
                            return remapToPy(self._jsVal.getId());
                        default:
                            throw new Sk.builtin.AttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
                    }
                });

                // TODO: Document __getitem__ et al.

                $Feature["__getitem__"] = new Sk.builtin.func(function(self, pyName) {
                    var name = Sk.ffi.toJs(pyName);

                    return remapToPy(self._jsVal.getProperty(name));
                });

                $Feature["__setitem__"] = new Sk.builtin.func(function(self, pyName, pyVal) {
                    var name = Sk.ffi.toJs(pyName);

                    self._jsVal.setProperty(remapToJs(pyVal));
                });

                /*!defMethod(string)!2*/ "Exports this feature as a GeoJSON object.";
                $Feature["to_geo_json"] = new Sk.builtin.func(function(self) {
                    return PyDefUtils.suspensionPromise(function(resolve, reject) {
                        self._jsVal.toGeoJson(function(json) {
                            resolve(Sk.ffi.toPy(json));
                        });
                    });
                });

                registerMethods($Feature, {
                    //for_each_property,
                });
            }, /*!defClass(anvil.GoogleMap.Data,Feature)!*/ "GoogleMap.Data.Feature", []);
            registerRemapType(() => google.maps.Data.Feature, $Data["Feature"]);

            var addListeners = function(jsVal) {
                var jsMap = jsVal.getMap();
                if (jsMap) {
                    var pyMap = jsMap._pyVal;
                    jsVal.addListener("addfeature", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature) }, pyMap, "data_addfeature");
                    });
                    jsVal.addListener("click", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), lat_lng: remapToPy(e.latLng) }, pyMap, "data_click");
                    });
                    jsVal.addListener("dblclick", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), lat_lng: remapToPy(e.latLng) }, pyMap, "data_dblclick");
                    });
                    jsVal.addListener("mousedown", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), lat_lng: remapToPy(e.latLng) }, pyMap, "data_mousedown");
                    });
                    jsVal.addListener("mouseout", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), lat_lng: remapToPy(e.latLng) }, pyMap, "data_mouseout");
                    });
                    jsVal.addListener("mouseover", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), lat_lng: remapToPy(e.latLng) }, pyMap, "data_mouseover");
                    });
                    jsVal.addListener("mouseup", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), lat_lng: remapToPy(e.latLng) }, pyMap, "data_mouseup");
                    });
                    jsVal.addListener("removefeature", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature) }, pyMap, "data_removefeature");
                    });
                    jsVal.addListener("removeproperty", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), name: remapToPy(e.name), old_value: remapToPy(e.oldValue) }, pyMap, "data_removeproperty");
                    });
                    jsVal.addListener("rightclick", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), lat_lng: remapToPy(e.latLng) }, pyMap, "data_rightclick");
                    });
                    jsVal.addListener("setgeometry", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), new_geometry: remapToPy(e.newGeometry), old_geometry: remapToPy(e.oldGeometry) }, pyMap, "data_setgeometry");
                    });
                    jsVal.addListener("setproperty", function(e) {
                        PyDefUtils.raiseEventAsync({ feature: remapToPy(e.feature), name: remapToPy(e.name), new_value: remapToPy(e.newValue), old_value: remapToPy(e.oldValue) }, pyMap, "data_setproperty");
                    });
                }
            };

            /*!defMethod()!2*/ "Create a new Data object with the specified options. Not fully implemented.";
            $Data["__init__"] = PyDefUtils.funcWithKwargs(initFnWithJsObjOrPyArgs(() => google.maps.Data,
                function(kwargs, self) {
                    // Load options from kwargs
                    // NOT FULLY IMPLEMENTED. Will basically never be used.
                    self._jsVal = new google.maps.Data(kwargs);
                }, function afterInitFromJs(self, jsVal) {
                    addListeners(jsVal);
                }));

            [ /*!defAttr()!1*/{
                name: "control_position",
                pyType: "anvil.GoogleMap.ControlPosition",
                description: "The position of the drawing controls on the map."
            }, /*!defAttr()!1*/{
                name: "controls",
                type: "list(string)",
                description: "Describes which drawing modes are available for the user to select, in the order they are displayed. Possible drawing modes are \"Point\", \"LineString\" or \"Polygon\"."
            }, /*!defAttr()!1*/{
                name: "drawing_mode",
                type: "string",
                description: "The current drawing mode of the given Data layer. Possible drawing modes are \"Point\", \"LineString\" or \"Polygon\"."
            }, /*!defAttr()!1*/{
                name: "style",
                pyType: "anvil.GoogleMap.Data.StyleOptions instance",
                description: "Style for all features in the collection. May be a styling function or a GoogleMap.Data.StyleOptions object."
            },];

            $Data["__setattr__"] = new Sk.builtin.func(function(self, pyName, pyValue) {

                var name = Sk.ffi.toJs(pyName);

                switch(name) {
                    case "control_position":
                        self._jsVal.setControlPosition(remapToJs(pyValue));
                        break;
                    case "controls":
                        self._jsVal.setControls(remapToJs(pyValue));
                        break;
                    case "drawing_mode":
                        self._jsVal.setDrawingMode(remapToJs(pyValue));
                        break;
                    case "style":
                        if (pyValue && Sk.builtin.callable(pyValue).v) {
                            var fn = function(feature) {
                                return remapToJs(Sk.misceval.callsim(pyValue, remapToPy(feature)));
                            };
                            fn._pyVal = pyValue;
                            self._jsVal.setStyle(fn);
                        } else {
                            self._jsVal.setStyle(remapToJs(pyValue));
                        }
                        break;
                    default:
                        Sk.builtin.object.prototype.tp$setattr.call(self, pyName, pyValue);
                        break;
                }
            });

            $Data["__getattr__"] = new Sk.builtin.func(function(self, pyName) {

                var name = Sk.ffi.toJs(pyName);

                switch(name) {
                    case "control_position":
                        return remapToPy(self._jsVal.getControlPosition());
                    case "controls":
                        return remapToPy(self._jsVal.getControls());
                    case "drawing_mode":
                        return remapToPy(self._jsVal.getDrawingMode());
                    case "style":
                        return remapToPy(self._jsVal.getStyle());
                    default:
                        throw new Sk.builtin.AttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
                }
            });


            /*!defMethod(anvil.GoogleMap.Data.Feature instance,[feature],geometry=,id=,properties=)!2*/ "Adds a feature to the collection, and returns the added feature.";
            $Data["add"] = PyDefUtils.funcWithRawKwargsDict(function(kwargs, self, pyFeature) {

                if (pyFeature && Sk.builtin.isinstance(pyFeature, $Data["Feature"]).v) {
                    const rtn = self._jsVal.add(pyFeature._jsVal);
                    pyFeature._jsVal = rtn;
                    return pyFeature;
                } else {
                    var u = unwrapKwargs(kwargs);

                    const rtn = self._jsVal.add(u);
                    return Sk.misceval.callsim($Data["Feature"], rtn);
                }
            });

            /*!defMethod(None,feature,clickable=,cursor=,draggable=,editable=,fillColor=,fillOpacity=,icon=,shape=,strokeColor=,strokeOpacity=,strokeWeight=,title=,visible=,zIndex=)!2*/ "Sets the style for all features in the collection. Styles specified on a per-feature basis via override_style() continue to apply.";
            $Data["override_style"] = PyDefUtils.funcWithRawKwargsDict(function(kwargs, self, pyFeature, pyStyle) {
                self._jsVal.overrideStyle(pyFeature._jsVal, pyStyle ? remapToJs(pyStyle) : unwrapKwargs(kwargs));
            });

            // NB: This is synchronous :)
            /*!defMethod(string)!2*/ "Exports the features in the collection to a GeoJSON object.";
            $Data["to_geo_json"] = new Sk.builtin.func(function(self) {
                return PyDefUtils.suspensionPromise(function(resolve, reject) {
                    self._jsVal.toGeoJson(function(json) {
                        resolve(Sk.ffi.toPy(json));
                    });
                });
            });

            /*!defMethod(list[anvil.GoogleMap.Data.Feature instance],geo_json,[id_property_name=id])!2*/ "Adds GeoJSON features to the collection. Give this method a parsed JSON. The imported features are returned.";
            $Data["add_geo_json"] = PyDefUtils.funcWithKwargs(function(kwargs, self, obj) {
                if (kwargs["id_property_name"]) {
                    var opts = {idPropertyName: kwargs["id_property_name"]};
                }
                self._jsVal.addGeoJson(Sk.ffi.toJs(obj), opts);
            });


            /*!defMethod(boolean,feature)!2*/ "Checks whether the given feature is in the collection." ["contains"];
            /*!defMethod(anvil.GoogleMap.Data.Feature instance,id)!2*/ "Returns the feature with the given ID, if it exists in the collection." ["get_feature_by_id"];
            /*!defMethod(None,url,[id_property_name=id])!2*/ "Loads GeoJSON from a URL, and adds the features to the collection." ["load_geo_json"];
            /*!defMethod(None,feature)!2*/ "Removes a feature from the collection." ["remove"];
            /*!defMethod(None,feature)!2*/ "Removes the effect of previous override_style() calls. The style of the given feature reverts to the style specified by set_style()." ["revert_style"];
            registerMethods($Data, {
                contains: { },
                //for_each: ,
                get_feature_by_id: { },
                load_geo_json: { transformRawArgs: function(kwargs, self, url) {
                    if(kwargs["id_property_name"]) {
                        var opts = { idPropertyName: Sk.ffi.toJs(kwargs["id_property_name"]) };
                    }
                    if(kwargs["callback"]) {
                        var callback = function(features) {
                            var pyFeatures = new Sk.builtin.list();
                            for (var i in features) {
                                Sk.misceval.callsim(pyFeatures.tp$getattr(new Sk.builtin.str("append")), Sk.misceval.callsim($Data["Feature"], features[i]));
                            }
                            Sk.misceval.callsim(kwargs["callback"], pyFeatures);
                        };
                    }
                    return [Sk.ffi.toJs(url), opts, callback];
                }},
                remove: { },
                revert_style: { },
            });

        }, /*!defClass(anvil.GoogleMap,Data)!*/ "GoogleMap.Data", []);
        registerRemapType(() => google.maps.Data, $Map["Data"]);



        // METHODS


        /*!defMethod(None,lat_lng_bounds, [padding])!2*/ "Sets the viewport to contain the given bounds. Adds some padding around the bounds by default - set padding to 0 to match the bounds exactly." ["fit_bounds"];
        /*!defMethod(anvil.GoogleMap.LatLngBounds instance)!2*/ "Returns the lat/lng bounds of the current viewport." ["get_bounds"];
        /*!defMethod(None,dx,dy)!2*/ "Changes the center of the map by the given distance in pixels." ["pan_by"];
        /*!defMethod(None,position)!2*/ "Changes the center of the map to the given LatLng position." ["pan_to"];
        /*!defMethod(None,lat_lng_bounds, [padding])!2*/ "Pans the map by the minimum amount necessary to contain the given LatLngBounds. Adds some padding around the bounds by default - set padding to 0 to match the bounds exactly." ["pan_to_bounds"];
        registerMethods($Map, {
            fit_bounds: { },
            get_bounds: { },
            pan_by: { },
            pan_to: { },
            pan_to_bounds: { },
        });

        /*!defMethod(anvil.Component instance,map_component)!2*/ "Add a map component to this GoogleMap";
        $Map["add_component"] = PyDefUtils.funcWithKwargs(function(kwargs, self, pyObj) {
            if (!pyObj || !isTrue(pyIsInstance(pyObj, new pyTuple([$Map["AbstractOverlay"], $Map["InfoWindow"]])))) {
            // For now, until we have the arbitrary overlay layer.
                throw new Sk.builtin.TypeError("Cannot add component. Only GoogleMap overlay components may be added to a GoogleMap instance.");
            }

            return pyCallOrSuspend(pyModule["ClassicContainer"].prototype.add_component, [self, pyObj, kwargs]);
        });



        // OVERLAYS

        const mkOverlayClass = (name, superClass, google_map_type, properties, events, new_callback, loc_callback) => {
            const klass = PyDefUtils.mkComponentCls(pyModule, name, {
                properties,
                events,
                base: superClass,
                locals($loc) {
                    if (new_callback) {
                        $loc["__new__"] = PyDefUtils.mkNew(superClass, new_callback);
                    }
                    if (loc_callback) {
                        loc_callback($loc);
                    }
                },
            });
            if (google_map_type) {
                Object.defineProperty(klass.prototype, "$google_map_type", {
                    value: google_map_type,
                    writable: true,
                });
                registerRemapType(() => google_map_type, klass);
            }

            return klass;
        };


        $Map["AbstractOverlay"] = mkOverlayClass(
            "GoogleMap.AbstractOverlay",
            pyModule["ClassicComponent"],
            null,
            PyDefUtils.assembleGroupProperties(/*!componentProps(anvil.GoogleMap.AbstractOverlay)!2*/ ["mapOverlays"]),
            PyDefUtils.assembleGroupEvents(
                "GoogleMap.AbstractOverlay",
                /*!componentEvents(anvil.googleMap.AbstractOverlay)!1*/ ["universal", "mapOverlays"]
            ),
            (self) => {
                if (self.$google_map_type) {
                    const googleMapType = self.$google_map_type();
                    self._jsVal = new googleMapType();
                    self._jsVal.addListener("click", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "click");
                    });
                    self._jsVal.addListener("dblclick", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "dblclick");
                    });
                    self._jsVal.addListener("drag", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "drag");
                    });
                    self._jsVal.addListener("dragend", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "dragend");
                    });
                    self._jsVal.addListener("dragstart", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "dragstart");
                    });
                    self._jsVal.addListener("mousedown", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "mousedown");
                    });
                    self._jsVal.addListener("mouseout", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "mouseout");
                    });
                    self._jsVal.addListener("mouseover", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "mouseover");
                    });
                    self._jsVal.addListener("mouseup", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "mouseup");
                    });
                    self._jsVal.addListener("rightclick", function (e) {
                        PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "rightclick");
                    });
                }
                self._anvil.pageEvents = {
                    add() {
                        if (!Sk.misceval.isTrue(Sk.builtin.isinstance(self._anvil.parent.pyObj, pyModule["GoogleMap"]))) {
                            throw new Sk.builtin.TypeError("Map components can only be added to maps.");
                        }
                        self._jsVal.setMap(self._anvil.parent.pyObj._jsVal);
                    },

                    remove() {
                        self._jsVal.setMap(null);
                    },
                };


                return setMapProps(self);
            },
        );
        /*!defClass(anvil.GoogleMap,AbstractOverlay,anvil.Component)!*/


        $Map["Marker"] = mkOverlayClass(
            "GoogleMap.Marker",
            $Map["AbstractOverlay"],
            () => google.maps.Marker,
            PyDefUtils.assembleGroupProperties(/*!componentProps(anvil.GoogleMap.Marker)!2*/ [], {
                /*!componentProp(anvil.GoogleMap.Marker)!1*/
                animation: {
                    name: "animation",
                    type: "anvil.GoogleMap.Animation",
                    important: true,
                    description: "The animation of this Marker.",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("animation", remapToJs),
                    get: PyDefUtils.mapGetter("getAnimation", remapToPy),
                },
                /*!componentProp(anvil.GoogleMap.Marker)!1*/
                position: {
                    name: "position",
                    pyType: "anvil.GoogleMap.LatLng instance",
                    important: true,
                    description: "The LatLng position of this Marker",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("position", remapToJs),
                    get: PyDefUtils.mapGetter("getPosition", remapToPy),
                },
                /*!componentProp(anvil.GoogleMap.Marker)!1*/
                icon: {
                    name: "icon",
                    pyType: "anvil.GoogleMap.Symbol instance", // TODO: This is actually a union type string|Icon|Symbol
                    description: "The icon to display at the position of this Marker.",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("icon", remapToJs),
                    get: PyDefUtils.mapGetter("getIcon", remapToPy),
                },
                /*!componentProp(anvil.GoogleMap.Marker)!1*/
                label: {
                    name: "label",
                    pyType: "anvil.GoogleMap.MarkerLabel instance",
                    description: "The label to display on this Marker.",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("label", remapToJs),
                    get: PyDefUtils.mapGetter("getLabel", remapToPy),
                },
                /*!componentProp(anvil.GoogleMap.Marker)!1*/
                title: {
                    name: "title",
                    description: "The tooltip text for this Marker.",
                    type: "string",
                    mapProp: true,
                    set: PyDefUtils.mapSetter("title"),
                    get: PyDefUtils.mapGetter("getTitle", remapToPy),
                },
                /*!componentProp(anvil.GoogleMap.Marker)!1*/
                cursor: {
                    name: "cursor",
                    description: "The cursor to display over this Marker.",
                    type: "string",
                    mapProp: true,
                    set: PyDefUtils.mapSetter("cursor"),
                    get: PyDefUtils.mapGetter("getCursor", remapToPy),
                },
                /*!componentProp(anvil.GoogleMap.Marker)!1*/
                opacity: {
                    name: "opacity",
                    description: "The opacity of this Marker.",
                    type: "number",
                    mapProp: true,
                    set: PyDefUtils.mapSetter("opacity"),
                    get: PyDefUtils.mapGetter("getOpacity", remapToPy),
                },
            }),
            PyDefUtils.assembleGroupEvents("GoogleMap.Marker", /*!componentEvents(anvil.GoogleMap.Marker)!1*/ []).concat(
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "animation_changed",
                    description: "When the animation of this Marker changes.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "clickable_changed",
                    description: "When the 'clickable' property of this Marker changes.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "cursor_changed",
                    description: "When the 'cursor' property of this Marker changes.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "draggable_changed",
                    description: "When the 'draggable' property of this Marker changes.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "icon_changed",
                    description: "When the 'icon' property of this Marker changes.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "position_changed",
                    description: "When the position of this Marker changes, i.e. when it is moved.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "shape_changed",
                    description: "When the 'shape' property of this Marker changes, i.e. when it is moved.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "title_changed",
                    description: "When the 'title' property of this Marker changes, i.e. when it is moved.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "visible_changed",
                    description: "When the 'visible' property of this Marker changes, i.e. when it is moved.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Marker)!1*/ {
                    name: "z_index_changed",
                    description: "When the 'z_index' property of this Marker changes, i.e. when it is moved.",
                    parameters: [],
                }
            ),
            (self) => {
                self._jsVal.addListener("animation_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "animation_changed");
                });
                self._jsVal.addListener("clickable_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "clickable_changed");
                });
                self._jsVal.addListener("cursor_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "cursor_changed");
                });
                self._jsVal.addListener("draggable_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "draggable_changed");
                });
                self._jsVal.addListener("icon_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "icon_changed");
                });
                self._jsVal.addListener("position_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "position_changed");
                });
                self._jsVal.addListener("shape_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "shape_changed");
                });
                self._jsVal.addListener("title_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "title_changed");
                });
                self._jsVal.addListener("visible_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "visible_changed");
                });
                self._jsVal.addListener("zindex_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "z_index_changed");
                });
            }
        );
        /*!defClass(anvil.GoogleMap,Marker,anvil.GoogleMap.AbstractOverlay)!*/

        $Map["Polyline"] = mkOverlayClass(
            "GoogleMap.Polyline",
            $Map["AbstractOverlay"],
            () => google.maps.Polyline,
            PyDefUtils.assembleGroupProperties(/*!componentProps(anvil.GoogleMap.Polyline)!2*/ ["mapPolyOverlays"], {
                /*!componentProp(anvil.GoogleMap.Polyline)!1*/
                icons: {
                    name: "icons",
                    important: true,
                    description: "The icons to be rendered along the polyline.",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("icons", remapToJs),
                },
                /*!componentProp(anvil.GoogleMap.Polyline)!1*/
                path: {
                    name: "path",
                    pyType: "list(anvil.GoogleMap.LatLng instance)",
                    important: true,
                    description: "The ordered sequence of LatLng coordinates of the Polyline.",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("path", remapToJs),
                },
                /*!componentProp(anvil.GoogleMap.Polyline)!1*/
                geodesic: {
                    name: "geodesic",
                    description: "When true, edges of the polygon are interpreted as geodesic and will follow the curvature of the Earth.",
                    type: "boolean",
                    defaultValue: false,
                    mapProp: true,
                    pyVal: true,
                    set: PyDefUtils.mapSetter("geodesic", isTrue),
                },
            }),
            PyDefUtils.assembleGroupEvents("GoogleMap.Polyline", /*!componentEvents(anvil.GoogleMap.Polyline)!1*/ []),
        );
        /*!defClass(anvil.GoogleMap,Polyline,anvil.GoogleMap.AbstractOverlay)!*/


        $Map["Polygon"] = mkOverlayClass(
            "GoogleMap.Polygon",
            $Map["AbstractOverlay"],
            () => google.maps.Polygon,
            PyDefUtils.assembleGroupProperties(/*!componentProps(anvil.GoogleMap.Polygon)!2*/ ["mapPolyOverlays", "mapAreaOverlays"], {
                /*!componentProp(anvil.GoogleMap.Polygon)!1*/
                path: {
                    name: "path",
                    pyType: "list(anvil.GoogleMap.LatLng instance)",
                    important: true,
                    description: "The ordered sequence of LatLng coordinates of the Polygon.",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("path", remapToJs),
                },
                /*!componentProp(anvil.GoogleMap.Polygon)!1*/
                geodesic: {
                    name: "geodesic",
                    description: "When true, edges of the polygon are interpreted as geodesic and will follow the curvature of the Earth.",
                    type: "boolean",
                    defaultValue: Sk.builtin.bool.false$,
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("geodesic", isTrue),
                },
            }),
            PyDefUtils.assembleGroupEvents("GoogleMap.Polygon", /*!componentEvents(anvil.GoogleMap.Polygon)!1*/ []),
        );
        /*!defClass(anvil.GoogleMap,Polygon,anvil.GoogleMap.AbstractOverlay)!*/

        $Map["Rectangle"] = mkOverlayClass(
            "GoogleMap.Rectangle",
            $Map["AbstractOverlay"],
            () => google.maps.Rectangle,
            PyDefUtils.assembleGroupProperties(/*!componentProps(anvil.GoogleMap.Rectangle)!2*/ ["mapPolyOverlays", "mapAreaOverlays"], {
                /*!componentProp(anvil.GoogleMap.Rectangle)!1*/
                bounds: {
                    name: "bounds",
                    pyType: "anvil.GoogleMap.LatLngBounds instance",
                    important: true,
                    description: "The bounds of the Rectangle.",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("bounds", remapToJs),
                    get: PyDefUtils.mapGetter("getBounds", remapToPy),
                },
            }),
            PyDefUtils.assembleGroupEvents("GoogleMap.Rectangle", /*!componentEvents(anvil.GoogleMap.Rectangle)!1*/ []).concat(
                /*!componentEvent(anvil.GoogleMap.Rectangle)!1*/ {
                    name: "bounds_changed",
                    description: "When the bounds of this rectangle change, i.e. when it is moved or resized.",
                    parameters: [],
                }
            ),
            (self) => {
                self._jsVal.addListener("center_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "center_changed");
                });
                self._jsVal.addListener("radius_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "radius_changed");
                });
            }
        );
        /*!defClass(anvil.GoogleMap,Rectangle,anvil.GoogleMap.AbstractOverlay)!*/


        $Map["Circle"] = mkOverlayClass(
            "GoogleMap.Circle",
            $Map["AbstractOverlay"],
            () => google.maps.Circle,
            PyDefUtils.assembleGroupProperties(/*!componentProps(anvil.GoogleMap.Circle)!2*/ ["mapPolyOverlays", "mapAreaOverlays"], {
                /*!componentProp(anvil.GoogleMap.Circle)!1*/
                center: {
                    name: "center",
                    pyType: "anvil.GoogleMap.LatLng instance",
                    important: true,
                    description: "The center of the Circle.",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("center", remapToJs),
                    get: PyDefUtils.mapGetter("getCenter", remapToPy),
                },
                /*!componentProp(anvil.GoogleMap.Circle)!1*/
                radius: {
                    name: "radius",
                    type: "number",
                    important: true,
                    description: "The radius of the Circle.",
                    mapProp: true,
                    set: PyDefUtils.mapSetter("radius"),
                    get: PyDefUtils.mapGetter("getRadius", remapToPy),
                },
            }),
            PyDefUtils.assembleGroupEvents("GoogleMap.Circle", /*!componentEvents(anvil.GoogleMap.Circle)!1*/ []).concat(
                /*!componentEvent(anvil.GoogleMap.Circle)!1*/ {
                    name: "center_changed",
                    description: "When the center position of this circle changes, i.e. when it is moved.",
                    parameters: [],
                },
                /*!componentEvent(anvil.GoogleMap.Circle)!1*/ {
                    name: "radius_changed",
                    description: "When the radius of this circle changes, i.e. when it is resized.",
                    parameters: [],
                }
            ),
            (self) => {
                self._jsVal.addListener("center_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "center_changed");
                });
                self._jsVal.addListener("radius_changed", function () {
                    PyDefUtils.raiseEventAsync({}, self, "radius_changed");
                });
            }
        );
        /*!defClass(anvil.GoogleMap,Circle,anvil.GoogleMap.AbstractOverlay)!*/


        $Map["InfoWindow"] = mkOverlayClass(
            "GoogleMap.InfoWindow",
            pyModule["ClassicComponent"],
            () => google.maps.InfoWindow,
            PyDefUtils.assembleGroupProperties(/*!componentProps(anvil.GoogleMap.InfoWindow)!2*/ [], {
                /*!componentProp(anvil.GoogleMap.InfoWindow)!1*/
                content: {
                    name: "content",
                    pyType: "anvil.Component instance",
                    pyVal: true,
                    important: true,
                    description: "Content to display in the InfoWindow. Can be a string or an Anvil Component",
                    mapProp: true,
                    set(s, e, v) {
                        const pyHiddenContainer = s._anvil.pyHiddenContainer;
                        let content;
                        if (checkString(v)) {
                            content = v.toString();
                        } else {
                            content = v.anvil$hooks.setupDom();
                        }
                        return chainOrSuspend(pyCallOrSuspend(pyHiddenContainer.tp$getattr(S_CLEAR)), () => {
                            s._jsVal.setOptions({ content });
                            return typeof content === "string"
                                ? pyNone
                                : pyCallOrSuspend(pyHiddenContainer.tp$getattr(S_ADD_COMPONENT), [v]);
                        });
                    },
                    get(s, e) {
                        const v = s._jsVal.getContent();
                        if (typeof v === "string") {
                            return new pyStr(v);
                        }
                        return $(v).data("anvil-py-component") || pyNone;
                    },
                },
                /*!componentProp(anvil.GoogleMap.InfoWindow)!1*/
                disable_auto_pan: {
                    name: "disable_auto_pan",
                    description: "Disable auto-pan on open.",
                    type: "boolean",
                    defaultValue: Sk.builtin.bool.false$,
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("disableAutoPan", isTrue),
                },
                /*!componentProp(anvil.GoogleMap.InfoWindow)!1*/
                max_width: {
                    name: "max_width",
                    description: "Maximum width of the infowindow, regardless of content's width.",
                    type: "number",
                    mapProp: true,
                    set: PyDefUtils.mapSetter("maxWidth"),
                },
                /*!componentProp(anvil.GoogleMap.InfoWindow)!1*/
                pixel_offset: {
                    name: "pixel_offset",
                    description:
                        "The offset, in pixels, of the tip of the info window from the point on the map at whose geographical coordinates the info window is anchored.",
                    pyType: "anvil.GoogleMap.Size instance",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("pixelOffset", remapToJs),
                },
                /*!componentProp(anvil.GoogleMap.InfoWindow)!1*/
                position: {
                    name: "position",
                    description: "The LatLng at which to display this InfoWindow. Not required if this popup is anchored to a component",
                    pyType: "anvil.GoogleMap.LatLng instance",
                    pyVal: true,
                    mapProp: true,
                    set: PyDefUtils.mapSetter("position", remapToJs),
                },
                /*!componentProp(anvil.GoogleMap.InfoWindow)!1*/
                z_index: {
                    name: "z_index",
                    description:
                        "All InfoWindows are displayed on the map in order of their zIndex, with higher values displaying in front of InfoWindows with lower values.",
                    type: "number",
                    mapProp: true,
                    set: PyDefUtils.mapSetter("zIndex"),
                },
            }),
            PyDefUtils.assembleGroupEvents("GoogleMap.InfoWindow", /*!componentEvents(anvil.GoogleMap.InfoWindow)!1*/ ["universal"]),
            (self) => {
                self._jsVal = new google.maps.InfoWindow();
                self._anvil.pyHiddenContainer = PyDefUtils.pyCall(pyModule["ClassicContainer"]);
                self._anvil.pyHiddenContainer._anvil.overrideParentObj = self;

                self._anvil.pageEvents = {
                    add() {
                        if (!isTrue(pyIsInstance(self._anvil.parent.pyObj, pyModule["GoogleMap"]))) {
                            throw new Sk.builtin.TypeError("Map components can only be added to maps.");
                        }
                        self._jsVal.setMap(self._anvil.parent.pyObj._jsVal);
                    },
                    remove() {
                        self._jsVal.setMap(null);
                    },
                };

                self._jsVal.addListener("rightclick", (e) => {
                    PyDefUtils.raiseEventAsync({ lat_lng: remapToPy(e.latLng) }, self, "rightclick");
                });

                self._jsVal.addListener("closeclick", () => {
                    PyDefUtils.asyncToPromise(() => pyCallOrSuspend(self.tp$getattr(S_REMOVE_FROM_PARENT, [])));
                });

                return setMapProps(self);
            },
            ($loc) => {
                /*!defMethod(None,map,[anchor])!2*/ "Display this InfoWindow on the specified map. If anchor is specified, the InfoWindow does not need to have its own position property set."[
                    "open"
                ];
                /*!defMethod(None,)!2*/ "Hide this InfoWindow. The user can also cause this to happen by clicking the close button in the top-right of the popup."["close"];
                registerMethods($loc, {
                    open: {
                        callback(self) {
                            const Map = self._jsVal.getMap()?._pyVal;
                            const addComponent = Map?.tp$getattr(S_ADD_COMPONENT);
                            if (!addComponent) return;
                            const parent = self._anvil.parent?.pyObj;
                            if (parent && parent === Map) return;
                            return chainOrSuspend(
                                parent && pyCallOrSuspend(self.tp$getattr(S_REMOVE_FROM_PARENT, [])),
                                () => pyCallOrSuspend(addComponent, [self])
                            );
                        },
                    },
                    close: {
                        callback(self) {
                            return pyCallOrSuspend(self.tp$getattr(S_REMOVE_FROM_PARENT, []));
                        },
                    },
                });
                $loc["get_components"] = new pyFunc((self) => {
                    return pyCall(self._anvil.pyHiddenContainer.tp$getattr(s_get_components));
                });
            }
        );
        /*!defClass(anvil.GoogleMap,InfoWindow,anvil.Component)!*/


        // These class methods are documented above, so that they end up on the GoogleMap defClass.
        $Map["geocode"] = new Sk.builtin.staticmethod(
            PyDefUtils.funcWithRawKwargsDict(function (kwargs) {
                var geocoder = new google.maps.Geocoder();
                return PyDefUtils.suspensionPromise(function (resolve, reject) {
                    if (window.googleMapsAuthFailure) {
                        reject("Google Maps authorization failed - is the API key invalid?");
                        return;
                    }
                    geocoder.geocode(unwrapKwargs(kwargs), function (results, status) {
                        if (status == "OK") {
                            // This is a completely manual remapToPy of a GeocodeResult array. There *must* be a better way.
                            var pyResults = [];
                            for (var i in results) {
                                var kws = [];
                                var addressComponents = [];

                                for (var j in results[i].address_components) {
                                    var ac = results[i].address_components[j];
                                    var acKws = [
                                        Sk.ffi.toPy("long_name"),
                                        remapToPy(ac.long_name),
                                        Sk.ffi.toPy("short_name"),
                                        remapToPy(ac.short_name),
                                        Sk.ffi.toPy("types"),
                                        remapToPy(ac.types),
                                    ];
                                    var pyAc = Sk.misceval.call(pyModule["GoogleMap"].prototype["GeocoderAddressComponent"], undefined, undefined, acKws);
                                    addressComponents.push(pyAc);
                                }

                                kws.push(Sk.ffi.toPy("address_components"));
                                kws.push(new Sk.builtin.list(addressComponents));

                                kws.push(Sk.ffi.toPy("formatted_address"));
                                kws.push(remapToPy(results[i].formatted_address));

                                var geomKws = [
                                    Sk.ffi.toPy("bounds"),
                                    remapToPy(results[i].geometry.bounds),
                                    Sk.ffi.toPy("location"),
                                    remapToPy(results[i].geometry.location),
                                    Sk.ffi.toPy("location_type"),
                                    remapToPy(results[i].geometry.location_type),
                                    Sk.ffi.toPy("viewport"),
                                    remapToPy(results[i].geometry.viewport),
                                ];

                                kws.push(Sk.ffi.toPy("geometry"));
                                kws.push(Sk.misceval.call(pyModule["GoogleMap"].prototype["GeocoderGeometry"], undefined, undefined, geomKws));

                                kws.push(Sk.ffi.toPy("partial_match"));
                                kws.push(remapToPy(results[i].partial_match));

                                kws.push(Sk.ffi.toPy("place_id"));
                                kws.push(remapToPy(results[i].place_id));

                                kws.push(Sk.ffi.toPy("postcode_localities"));
                                kws.push(remapToPy(results[i].postcode_localities));

                                kws.push(Sk.ffi.toPy("types"));
                                kws.push(remapToPy(results[i].types));

                                var pyResult = Sk.misceval.call(pyModule["GoogleMap"].prototype["GeocoderResult"], undefined, undefined, kws);

                                pyResults.push(pyResult);
                            }
                            resolve(new Sk.builtin.list(pyResults));
                        } else {
                            reject("Geocode failed: " + status);
                        }
                    });
                });
            })
        );

        /*!defMethod(_)!2*/ "Returns the area of a closed path in square meters."
        $Map["compute_area"] = new Sk.builtin.staticmethod(
            new Sk.builtin.func(function (path) {
                return remapToPy(google.maps.geometry.spherical.computeArea(remapToJs(path)));
            })
        );

        /*!defMethod(_)!2*/ "Returns the length of a path in meters."
        $Map["compute_length"] = new Sk.builtin.staticmethod(
            new Sk.builtin.func(function (path) {
                return remapToPy(google.maps.geometry.spherical.computeLength(remapToJs(path)));
            })
        );

    }

    // ATTRIBUTES

    [/*!defClassAttr()!1*/{
        name: "LatLng", pyType: "anvil.GoogleMap.LatLng",
    }, /*!defClassAttr()!1*/{
        name: "LatLngLiteral", pyType: "anvil.GoogleMap.LatLngLiteral",
    }, /*!defClassAttr()!1*/{
        name: "LatLngBounds", pyType: "anvil.GoogleMap.LatLngBounds",
    }, /*!defClassAttr()!1*/{
        name: "LatLngBoundsLiteral", pyType: "anvil.GoogleMap.LatLngBoundsLiteral",
    }, /*!defClassAttr()!1*/{
        name: "Point", pyType: "anvil.GoogleMap.Point",
    }, /*!defClassAttr()!1*/{
        name: "Size", pyType: "anvil.GoogleMap.Size",
    }, /*!defClassAttr()!1*/{
        name: "Symbol", pyType: "anvil.GoogleMap.Symbol",
    }, /*!defClassAttr()!1*/{
        name: "Icon", pyType: "anvil.GoogleMap.Icon",
    }, /*!defClassAttr()!1*/{
        name: "IconSequence", pyType: "anvil.GoogleMap.IconSequence",
    }, /*!defClassAttr()!1*/{
        name: "Animation", pyType: "anvil.GoogleMap.Animation",
    }, /*!defClassAttr()!1*/{
        name: "StrokePosition", pyType: "anvil.GoogleMap.StrokePosition",
    }, /*!defClassAttr()!1*/{
        name: "SymbolPath", pyType: "anvil.GoogleMap.SymbolPath",
    }, /*!defClassAttr()!1*/{
        name: "MarkerLabel", pyType: "anvil.GoogleMap.MarkerLabel",
    }, /*!defClassAttr()!1*/{
        name: "MapTypeControlStyle", pyType: "anvil.GoogleMap.MapTypeControlStyle",
    }, /*!defClassAttr()!1*/{
        name: "MapTypeId", pyType: "anvil.GoogleMap.MapTypeId",
    }, /*!defClassAttr()!1*/{
        name: "ControlPosition", pyType: "anvil.GoogleMap.ControlPosition",
    }, /*!defClassAttr()!1*/{
        name: "Marker", pyType: "anvil.GoogleMap.Marker",
    }, /*!defClassAttr()!1*/{
        name: "Polyline", pyType: "anvil.GoogleMap.Polyline",
    }, /*!defClassAttr()!1*/{
        name: "Polygon", pyType: "anvil.GoogleMap.Polygon",
    }, /*!defClassAttr()!1*/{
        name: "Rectangle", pyType: "anvil.GoogleMap.Rectangle",
    }, /*!defClassAttr()!1*/{
        name: "Circle", pyType: "anvil.GoogleMap.Circle",
    }, /*!defClassAttr()!1*/{
        name: "InfoWindow", pyType: "anvil.GoogleMap.InfoWindow",
    }, /*!defClassAttr()!1*/{
        name: "Data", pyType: "anvil.GoogleMap.Data",
    }, /*!defClassAttr()!1*/{
        name: "geocode",
        description: "Geocode the given location or address",
        callable: {
            returns: {
                name: "list(anvil.GoogleMap.GeocoderResult instance)",
                iter: { $ref: "anvil.GoogleMap.GeocoderResult instance" },
                allItems: {$ref: "anvil.GoogleMap.GeocoderResult instance" },
            },
            args: [{ name: "address", type: "keyword", optional: true },
                { name: "location", type: "keyword", optional: true }],
        },
    }, /*!defClassAttr()!1*/{
        name: "compute_area",
        description: "Returns the area of a closed path in square meters.",
        callable: {
            returns: { name: "number" },
            args: [{ name: "path" }],
        },
    }, /*!defClassAttr()!1*/{
        name: "compute_length",
        description: "Returns the length of a path in meters.",
        callable: {
            returns: { name: "number" },
            args: [{ name: "path" }],
        },
    }];


    /*!defClass(anvil,GoogleMap,Container)!*/
    registerRemapType(() => google.maps.Map, pyModule["GoogleMap"]);

};

