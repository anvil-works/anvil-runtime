"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = function(pyModule) {

	pyModule["ComponentTag"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        $loc["__serialize__"] = new Sk.builtin.func((self) => self.$d);
	}, "ComponentTag", []);

	pyModule["Component"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

		// All components have a set of properties, supplied in self._anvil.propMap
		// and self_anvil.propTypes (defaulting to empty). PyDefUtils containers
		// convenience methods for setting up these properties, as well as
		// generating an __init__() method that calls Component.__init__().
		//
		// Component.__init__() checks that only valid properties
		// were supplied and initialises them all, and __getattr__ and __setattr__
		// read and write those properties using the supplied 'set' and 'get'
		// functions.
		// As a convenience for Anvil components, the getter function will be supplied
		// with the component's  DOM element pre-looked-up.
		// (ie the arguments are (self, self._anvil.element))
		// Likewise, the setter function is passed (self, element, newValue).

		/*!defMethod(,**properties)!2*/ "You can set properties on a new component by passing them as keyword arguments. For example:\n\nx = Label(text='Hello')"
	    $loc["__init__"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs, self) {

	        if (arguments.length > 2) {
	            throw new Sk.builtin.Exception("Components take only keyword arguments (eg Label(text=\"Hello\"))");
	        }

	        var a = {
	            element: $('<div/>'),
	            parent: null, // will be {pyObj: parent_component, remove: fn}
	            eventTypes: {},
	            eventHandlers: {},
	            props: {},
	            propTypes: [],
	            propMap: {},
	            layoutPropTypes: [],
	            childLayoutProps: {},
	            metadata: {},
	            defaultWidth: null,
	            onPage: false,
	            components: [],
				addedToPage: function() {
					self._anvil.onPage = true;
					self._anvil.delayAddedToPage = false;
					return Sk.misceval.chain(undefined,
						self._anvil.pageEvents.add || function() { },
						PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "show")
					);
				},
				removedFromPage: function() {
					self._anvil.onPage = false;
					return Sk.misceval.chain(undefined,
						PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "hide"),
						self._anvil.pageEvents.remove || function() { }
					);
				},
				shownOnPage: function() {
					if (self._anvil.onPage) {
						return Sk.misceval.chain(undefined,
							PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "show"),
							self._anvil.pageEvents.show || function() { }
						);
					}
				},
	            pageEvents: {},
	            getProp: function(name) {
	                var prop = self._anvil.propMap[name];
	                if (!prop) {
	                    throw new Sk.builtin.AttributeError(self.tp$name + " component has no property called '"+name+"'");
	                }
	                var v;
	                if (prop.get) {
	                    v = prop.get(self, self._anvil.element);
	                    v = prop.pyVal ? v : Sk.ffi.remapToPy(v);
	                } else {
	                	if (name in self._anvil.props) {
		                    v = self._anvil.props[name];
	                	} else {
	                		v = prop.pyVal ? prop.defaultValue : Sk.ffi.remapToPy(prop.defaultValue);
		                    if (v === undefined) {
		                        throw new Sk.builtin.Exception(self.tp$name + " component has no value or default for property '"+name+"'");
		                    }
	                	}

	                }
	                return v;
	            },
	            getPropJS: function(name) {
	                var prop = self._anvil.propMap[name];
	                if (prop && prop.getJS) {
	                    return prop.getJS(self, self._anvil.element);
	                } else {
	                    return Sk.ffi.remapToJs(Sk.misceval.retryOptionalSuspensionOrThrow(this.getProp(name)));
	                }
	            },
	            setProp: function(name, pyValue) {
	                var prop = self._anvil.propMap[name];

	                if (!prop) {
	                    throw new Sk.builtin.AttributeError(self.tp$name + " component has no property called '"+name+"'");
	                }

	                if (pyValue === undefined) {
	                    throw new Sk.builtin.Exception("'undefined' is not a valid Python value");
	                }

	                if (prop.readOnly) {
	                    throw new Sk.builtin.Exception("The '"+name+"' property for a " + self.tp$name + " is read-only");
	                }

	                var pyOldValue = self._anvil.props[name];
	                pyOldValue = (pyOldValue === undefined ? Sk.builtin.none.none$ : pyOldValue);
	                self._anvil.props[name] = pyValue;

	                var v;
	                if (prop.set) {
	                    v = prop.set(self, self._anvil.element, prop.pyVal ? pyValue : Sk.ffi.remapToJs(pyValue), prop.pyVal ? pyOldValue : Sk.ffi.remapToJs(pyOldValue));
	                }
	                return (v === undefined) ? Sk.builtin.none.none$ : v;
	            },
	            setPropJS: function(name, value) {
	                Sk.misceval.retryOptionalSuspensionOrThrow(this.setProp(name, Sk.ffi.remapToPy(value)));
	            },
	            // Gets overwritten by form if this component is data-bound
	            dataBindingWriteback: function(pyComponent, attrName, pyNewValue) { return Promise.resolve(); },

	            dataBindingProp: null,

	            // Ew
	            themeColors: pyModule["Component"].$_anvilThemeColors,
	        };

			if (self._anvil) {
				for (var i in a) {
					if (!(i in self._anvil)) {
						self._anvil[i] = a[i];
					}
				}
			} else {
				self._anvil = a;
			}

	        var setPropFns = [undefined];
	        
	        // Set all properties to their default values.
	        for (var p in self._anvil.propMap) {
	            var pp = self._anvil.propMap[p];
	            if ("defaultValue" in pp && !pp.deprecated) {
	                setPropFns.push(function(p,pp) {
	                    return self._anvil.setProp(p, pp.pyVal ? pp.defaultValue : Sk.ffi.remapToPy(pp.defaultValue));
	                }.bind(null, p, pp));
	            }
	        }
	        self.tp$setattr(new Sk.builtin.str("tag"), Sk.misceval.callsim(pyModule['ComponentTag']));

            var quietOnPropertyExceptions = false;
	        for (var i=0; i < pyKwargs.length; i+=2) {
	            var k = pyKwargs[i].v, pyV = pyKwargs[i+1];

	            if (k == "__ignore_property_exceptions") { quietOnPropertyExceptions = true; continue; }

	            var prop = self._anvil.propMap[k];
	            if (!prop) {
	                if (quietOnPropertyExceptions) {
	                    console.error("No such property '"+k+"' for this component");
	                } else {
	                    throw new Sk.builtin.KeyError("No such property '"+k+"' for this component");
	                }
	            } else if (prop.readOnly) {
	            	// Don't initialise read-only properties.
	            } else {
	                setPropFns.push(function(k,pyV) {
                        if (quietOnPropertyExceptions) {
                            return Sk.misceval.tryCatch(function() { return self._anvil.setProp(k, pyV) }, function(e) {
                                console.error("Exception setting '",k,"' to ",pyV,":\n", e);
                            });
                        } else {
	                        return self._anvil.setProp(k, pyV)
                        }
	                }.bind(null,k,pyV));
	            }
	        }

			setPropFns.push(function() { return Sk.builtin.none.none$; });

	        return Sk.misceval.chain.apply(null, setPropFns);
	    }));
	    $loc["__getattr__"] = new Sk.builtin.func(function(self, pyName) {

	        var name = Sk.ffi.remapToJs(pyName);

	        if (self._anvil && name == "parent") {
                return self._anvil.parent ? self._anvil.parent.pyObj : Sk.builtin.none.none$;
	        }

            throw new Sk.builtin.AttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
	    });
	    

	    $loc["__setattr__"] = new Sk.builtin.func(function(self, pyName, pyValue) {

	        if (pyName.v == "parent") {
	            throw new Sk.builtin.AttributeError("Cannot set a '" + self.tp$name + "' component's parent this way - use 'add_component' on the container instead");
	        }

	        return Sk.builtin.object.prototype.tp$setattr.call(self, pyName, pyValue, true);
	    });

	    /*!defMethod(,event_name, handler_func:callable)!2*/ "Set a function to call when the 'event_name' event happens on this component."
	    $loc["set_event_handler"] = new Sk.builtin.func(function(self, pyEventName, pyHandler) {
            const eventName = Sk.ffi.remapToJs(pyEventName);
            if (eventName in self._anvil.eventTypes || eventName in (self._anvil.customComponentEventTypes || {}) || eventName.match(/^x\-/)) {
				if (Sk.builtin.checkNone(pyHandler)) {
					delete self._anvil.eventHandlers[eventName];
				} else {
					self._anvil.eventHandlers[eventName] = pyHandler;
				}                
            } else {
                throw new Sk.builtin.Exception("Cannot set event handler for unknown event '" + eventName + "' on " + self.tp$name + " component.");
            }
	    });

	    /*!defMethod(,event_name,**event_args)!2*/ "Trigger the 'event_name' event on this component. Any keyword arguments are passed to the handler function."
	    $loc["raise_event"] = PyDefUtils.funcWithRawKwargsDict(function(eventArgs, self, pyEventName) {
            var eventName = Sk.ffi.remapToJs(pyEventName);
            if (eventName in self._anvil.eventTypes || eventName in (self._anvil.customComponentEventTypes || {}) || eventName.match(/^x\-/)) {
                return PyDefUtils.raiseEventOrSuspend(eventArgs, self, eventName);
            } else {
                throw new Sk.builtin.Exception("Cannot raise unknown event '" + eventName + "' on " + self.tp$name + " component. Custom events must have the 'x-' prefix.");
            }
	    });

	    /*!defMethod(_)!2*/ "Remove this component from its parent container."
        $loc["remove_from_parent"] = new Sk.builtin.func(function(self) {
            if (self._anvil.parent) {
                return self._anvil.parent.remove();
			}
			return Sk.builtin.none.none$;
        });

        /*!defMethod(_)!2*/ "Scroll the window to make sure this component is in view."
        $loc["scroll_into_view"] = new Sk.builtin.func((self, smooth) => {
       		self._anvil.element[0].scrollIntoView({ behavior: smooth && smooth.v ? "smooth" : "instant", block: "center", inline: "center" });
        });

        $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity((self) => {
        	let v = [];
        	for (let n in self._anvil.props) {
        		v.push(new Sk.builtin.str(n), self._anvil.props[n]);
        	}
        	return new Sk.builtin.dict(v);
        });

		$loc["__new_deserialized__"] = PyDefUtils.mkNewDeserializedPreservingIdentity();

		$loc["__name__"] = new Sk.builtin.property(new Sk.builtin.func((self) => Sk.abstr.lookupSpecial(self.ob$type, Sk.builtin.str.$name)));

	}, /*!defClass(anvil)!1*/ "Component", []);
	// Ew. This global should be somewhere else.
	pyModule["Component"].$_anvilThemeColors = {};
};

/*
 * TO TEST:
 *
 *  - Methods: set_event_handler, raise_event, remove_from_parent
 *
 */
