"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = function(pyModule) {

	pyModule["Container"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

		$loc["__init__"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs, self) {
			self._anvil = self._anvil || {};
			var existingEvents = self._anvil.pageEvents || {};
			self._anvil.pageEvents = {
				add: function() {
					var fns = [undefined];
					for(var i in self._anvil.components) { fns.push(self._anvil.components[i].component._anvil.addedToPage); }
					if (existingEvents.add) fns.push(existingEvents.add);
					return Sk.misceval.chain.apply(null, fns);
				},
				remove: function() {
					var fns = [undefined];
					for (var i in self._anvil.components) { fns.push(self._anvil.components[i].component._anvil.removedFromPage); }
					if (existingEvents.remove) fns.push(existingEvents.remove);
					return Sk.misceval.chain.apply(null, fns);
				},
				show: function() {
					var fns = [undefined];
					for (var i in self._anvil.components) { fns.push(self._anvil.components[i].component._anvil.shownOnPage); }
					if (existingEvents.show) fns.push(existingEvents.show);
					return Sk.misceval.chain.apply(null, fns);
				}
			};

			var mkInvalidComponent = function(message) {
				return Sk.misceval.call(pyModule["InvalidComponent"], undefined, undefined, [new Sk.builtin.str("text"), new Sk.builtin.str(message)]);
			};

			return Sk.misceval.callOrSuspend(pyModule["Component"].prototype["__init__"], undefined, undefined, pyKwargs, self);
		}));

		/*!defMethod(_,component)!2*/ "Add a component to this container."
		$loc["add_component"] = new Sk.builtin.func(function(self, pyComponent, jsLayoutProperties/* hack because Skulpt doesn't like **args params*/) {
			if (!pyComponent || !pyComponent._anvil || !pyComponent._anvil.element) {
				throw new Sk.builtin.Exception("Argument to add_component must be a component");
			}

			if (pyComponent._anvil.parent && !self._anvil.overrideParentObj) {
				throw new Sk.builtin.Exception("This component is already added to a container; call remove_from_parent() first");
			}

			self._anvil.element.addClass("has-components");

			jsLayoutProperties = jsLayoutProperties || {};
			
			// These may have already been set if we created this component in the designer, but
			// we need to set them if we created this component at runtime. No harm setting them
			// twice, so just do it.
			pyComponent._anvil.element.addClass("anvil-component");
			pyComponent._anvil.element.data("anvil-py-component", pyComponent);

			self._anvil.components.push({component: pyComponent, layoutProperties: jsLayoutProperties});

			pyComponent._anvil.parent = {pyObj: self._anvil.overrideParentObj || self, remove: function() {
				pyComponent._anvil.element.detach();
				for (var i=0; i<self._anvil.components.length; i++) {
					if (self._anvil.components[i].component === pyComponent) {
						self._anvil.components.splice(i, 1);
						break;
					}
				}
				if (self._anvil.components.length == 0) {
					self._anvil.element.removeClass("has-components");
				}
				pyComponent._anvil.parent = null;
				if (self._anvil.onPage) {
					return pyComponent._anvil.removedFromPage();
				}
			}};


			if (pyComponent._anvil.componentSpec && !pyComponent._anvil.metadata.invisible) {
				// We're in the designer, and things will break if we don't have this set
				self._anvil.childLayoutProps[pyComponent._anvil.componentSpec.name] = jsLayoutProperties;
			}

			if (self._anvil.onPage && !pyComponent._anvil.delayAddedToPage) {
				return pyComponent._anvil.addedToPage();
			} else {
				return Sk.builtin.none.none$;
			}
		});

		/*!defMethod(_)!2*/ "Get a list of components in this container"
		$loc["get_components"] = new Sk.builtin.func(function(self) {
			var a = [];
			for (var i=0; i<self._anvil.components.length; i++) {
				a.push(self._anvil.components[i].component);
			}
			return new Sk.builtin.list(a);
		});

		/*!defMethod(_)!2*/ "Remove all components from this container"
		$loc["clear"] = new Sk.builtin.func(function(self) {
			self._anvil.element.removeClass("has-components");
			var components = self._anvil.components.slice();
			let fns = [];
			for (var i in components) {
				fns.push(components[i].component._anvil.parent.remove);
			}
			fns.push(() => Sk.builtin.none.none$);
			return Sk.misceval.chain(undefined, ...fns);
		});

	    /*!defMethod(,event_name,**event_args)!2*/ "Trigger the 'event_name' event on all children of this component. Any keyword arguments are passed to the handler function."
	    $loc["raise_event_on_children"] = PyDefUtils.funcWithRawKwargsDict(function(eventArgs, self, pyEventName) {
            var eventName = Sk.ffi.remapToJs(pyEventName);
            if (eventName in self._anvil.eventTypes || eventName in (self._anvil.customComponentEventTypes || {}) || eventName.match(/^x\-/)) {
                return Sk.misceval.chain(undefined, ...self._anvil.components.map(c => () => PyDefUtils.raiseEventOrSuspend(eventArgs, c.component, eventName)));
            } else {
                throw new Sk.builtin.Exception("Cannot raise unknown event '" + eventName + "' on " + self.tp$name + " component. Custom events must have the 'x-' prefix.");
            }
	    });

        $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity(function (self) {
            let v = [];
            for (let n in self._anvil.props) {
                v.push(new Sk.builtin.str(n), self._anvil.props[n]);
            }
            let d = new Sk.builtin.dict(v);
            let components = self._anvil.components.map(
                (c) => new Sk.builtin.tuple([c.component, Sk.ffi.remapToPy(c.layoutProperties)])
            );
            d.mp$ass_subscript(new Sk.builtin.str("$_components"), new Sk.builtin.list(components));
            return d;
        });

        $loc["__new_deserialized__"] = PyDefUtils.mkNewDeserializedPreservingIdentity(function (self, pyData) {
			const component_key = new Sk.builtin.str("$_components");
            let components = pyData.mp$subscript(component_key);
            Sk.abstr.objectDelItem(pyData, component_key);
            let addComponent = self.tp$getattr(new Sk.builtin.str("add_component"));
            return Sk.misceval.chain(
                PyDefUtils.setAttrsFromDict(self, pyData),
                () => Sk.misceval.iterFor(Sk.abstr.iter(components), (componentTuple) => {
                    let pyComponent = componentTuple.v[0];
                    let pyLayoutParams = componentTuple.v[1];
                    return Sk.misceval.callOrSuspend(addComponent, pyLayoutParams, undefined, [], pyComponent);
                })
            );
        });

	}, /*!defClass(anvil,Container,Component)!*/ 'Container', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - Methods: add_component, get_components, clear
 *
 */
