"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = function(pyModule) {

	pyModule["HtmlPanel"] = pyModule["HtmlTemplate"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(HtmlTemplate)!1*/["user data", "tooltip", "appearance"]);

        // Returns removeFn if it feels like it.
        var addComponentToDom = function(self, pyComponent, slotName) {

            var elt = self._anvil.element, celt = pyComponent._anvil.element;

            var delEmptyMarkers = function() {
                var excludeMarkers = elt.find(".anvil-component [anvil-if-slot-empty], .anvil-component [anvil-hide-if-slot-empty]")
                var markers = elt.find("[anvil-if-slot-empty]").not(excludeMarkers).filter(function() {
                    return $(this).attr("anvil-if-slot-empty") == slotName;
                });
                markers.detach(); // TODO detach then reattach on delete

                var toShow = elt.find("[anvil-hide-if-slot-empty]").not(excludeMarkers).filter(function() {
                    return $(this).attr("anvil-hide-if-slot-empty") == slotName;
                });
                toShow.removeClass("anvil-force-hidden");
            };

            // Is there a spec for this slot
            var slotElt = elt.find("[anvil-slot]").filter(function() { return $(this).attr("anvil-slot") == slotName; }).first();
            if (slotElt.length != 0) {
                delEmptyMarkers();
                slotElt.addClass("anvil-inline-container");
                slotElt.append(celt);
                return;
            }

            var slotRepeat = elt.find("[anvil-slot-repeat]").filter(function() { return $(this).attr("anvil-slot-repeat") == slotName; }).first();
            if (slotRepeat.length == 0) {
                slotRepeat = elt.find("[anvil-slot-repeat=default]").first();
            }
            if (slotRepeat.length != 0) {
                var s = slotRepeat.clone().removeAttr("anvil-slot-repeat").attr("anvil-slot-repeated", slotName); // remove the visible:false
                var dropZone = s.find("[anvil-slot]").first();
                if (dropZone.length != 0) {
                    dropZone.addClass("anvil-inline-container").append(celt);
                    dropZone.data("anvil-slot-repeat-parent", s);
                } else {
                    s.addClass("anvil-inline-container").append(celt);
                }
                s.insertBefore(slotRepeat);
                delEmptyMarkers();

                return () => {
                    s.detach();
                    return Sk.builtin.none.none$;
                };
            }

            if (slotName == "default") {
                // fall-through to appending to ourselves!
                elt.append(celt);
            } else {
                return addComponentToDom(self, pyComponent, "default");
            }
        };

        properties.push({name: "html",
                         type: "html",
                         defaultValue: "",
                         exampleValue: "<b>Hello</b>",
                         description: "The HTML from which this panel is defined",
                         important: true,
                         set: function(s,e,v) {
                             for (var i in s._anvil.components) {
                                 s._anvil.components[i].component._anvil.element.detach();
                             }
                             v = ""+v;
                             var m = v.match(/^@theme:(.*)$/);
                             if (m) {
                                v = pyModule["HtmlTemplate"].$_anvilThemeAssets[m[1]] || "";
                             }
                             try {
                                e.html(v);
                             } catch(exc) {
                                console.log("Probably irrelevant HTML/Javascript-parsing exception:", exc);
                             }
                             // Loading CSS can cause height changes
                             e.find("link").on("load", function(e) {
                                if (PyDefUtils.updateHeight)
                                    PyDefUtils.updateHeight();
                             });
                             e.find("[anvil-hide-if-slot-empty]").addClass("anvil-force-hidden");
                             for (var i in s._anvil.components) {
                                 let component = s._anvil.components[i].component;
                                 let removeFn = addComponentToDom(s, component, s._anvil.components[i].layoutProperties["slot"]);
                                 if (component.parent) {
                                    component.parent.removeFn = removeFn;
                                 }
                             }
                         }
                        });

		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {

            self._anvil.element = $('<div>').addClass("html-templated-panel anvil-container anvil-always-inline-container");

            self._anvil.element.on("_anvil-call", function(e, resolve, reject, fn/*, arg1, arg2, ...*/) {
                var args = [].slice.call(arguments,4);
                
                var err = function(msg) {
                    var ex = new Sk.builtin.Exception(msg);
                    ex.traceback = [{filename: "<template>", lineno: "<unknown>"}];
                    window.onerror(null, null, null, null, ex);
                    reject(msg);
                }

                e.stopPropagation();

                var pyFn = self.tp$getattr(new Sk.builtin.str(fn));
                if(pyFn === undefined) {
                    err("Attempted to call non-existent method from Javascript: <" + Sk.abstr.typeName(self) + " object> has no attribute '" + fn + "'.");
                    return;
                }

                var pyArgs = [];
                for (var i = 0; i < args.length; i++) {
                    try {
                        pyArgs[i] = Sk.ffi.remapToPy(args[i]);
                    } catch (e) {
                        err("Could not convert argument " + i + " (type '" + typeof(args[i]) + "') to Python when calling '" + fn + "' from JavaScript.");
                        return;
                    }
                }

                PyDefUtils.callAsync.apply(null,[pyFn, undefined, undefined, undefined].concat(pyArgs)).then(function(r) {
                    jsR = undefined;
                    try {
                        var jsR = PyDefUtils.remapToJsOrWrap(r);
                    } catch (e) { }

                    if (jsR === undefined) {
                        err("Could not convert return value from function '"+ fn + "' to JavaScript. Return value was of type '" + r.tp$name + "'");
                        return;
                    }

                    resolve(jsR);
                }).catch(function(e) {
                    reject(e);
                });
            })

            self._anvil.layoutPropTypes = [{
                name: "slot",
                type: "string",
                description: "The name of the template slot where this component will be placed",
                defaultValue: "",
                important: true,
                priority: 0,
            }];

            // Shared by DesignHtmlPanel and DesignHtmlTemplate (ew)
            self._anvil.setLayoutProperties = function(pyChild, layoutProperties) {
                var slot;
                if ("slot" in layoutProperties) {
                    slot = layoutProperties["slot"];
                    pyChild._anvil.element.detach();
                    if (pyChild._anvil.parent.removeFn) pyChild._anvil.parent.removeFn();
                    pyChild._anvil.parent.removeFn = addComponentToDom(self, pyChild, slot);
                } else {
                    slot = self._anvil.childLayoutProps[pyChild._anvil.componentSpec.name].slot;
                }

                var ps = {};
                ps [pyChild._anvil.componentSpec.name] = {slot: slot, data_binding: layoutProperties["data_binding"]};
                return ps;
            };

        },pyModule, $loc, properties,PyDefUtils.assembleGroupEvents("HTML panel", /*!componentEvents(HtmlTemplate)!1*/["universal"]), pyModule["Container"]);

        /*!defMethod(_,component,[slot="default"])!2*/ "Add a component to the named slot of this HTML templated panel. If no slot is specified, the 'default' slot will be used."
        $loc["add_component"] = new PyDefUtils.funcWithKwargs(function(kwargs, self, component) {
            if (!component || !component._anvil) { throw new Sk.builtin.Exception("Argument to add_component() must be a component"); }
            var removeFn = null;
            return Sk.misceval.chain(undefined, 
                () => {
                    if (component._anvil.metadata.invisible) { return; }

                    var element = component._anvil.element;

                    removeFn = addComponentToDom(self, component, kwargs["slot"]);
                },
                () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs),
                () => {
                    let rmFn = component._anvil.parent.remove;
                    component._anvil.parent.remove = () => {
                        if (removeFn) removeFn();
                        return rmFn();
                    };
                    return Sk.builtin.none.none$;
                }
            );
        });

        $loc["clear"] = new PyDefUtils.funcWithKwargs(function(kwargs, self) {
            var components = self._anvil.components.slice();
            var slot = kwargs["slot"];

            var fns = [];
            for (let i in components) {
                if (!slot || components[i].layoutProperties["slot"] == slot) {
                    fns.push(() => Sk.misceval.callsimOrSuspend(components[i].component.tp$getattr(new Sk.builtin.str("remove_from_parent"))));
                }
            }
            fns.push(() => Sk.builtin.none.none$);

            return Sk.misceval.chain(undefined, ...fns);
        });

        /*!defMethod(_,js_function_name,*args)!2*/ "Call a Javascript function"
        $loc["call_js"] = new Sk.builtin.func(PyDefUtils.callJs);

        // We document it under the HtmlTemplate name
    }, /*!defClass(anvil,HtmlTemplate,Container)!*/ "HtmlTemplate", [pyModule["Container"]]);

    // Initialise the theme HTML asset map (will be overwritten after load)
    pyModule["HtmlTemplate"].$_anvilThemeAssets = {};
};

/*
 * TO TEST:
 *
 *  - New props: html
 *  - Methods: add_component
 *  - Child layout props: slot
 *
 */
