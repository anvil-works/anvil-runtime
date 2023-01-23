"use strict";

import {
    s_parent,
    s_raise_event,
    s_remove_from_parent,
    s_x_anvil_propagate_page_added,
    s_x_anvil_propagate_page_removed, s_x_anvil_propagate_page_shown
} from "../runner/py-util";
import * as PyDefUtils from "../PyDefUtils";
import {getPyParent, raiseEventOrSuspend} from "./Component";
import {pyCallOrSuspend} from "../@Sk";

module.exports = function(pyModule) {

    pyModule["ClassicContainer"] = PyDefUtils.mkComponentCls(pyModule, "ClassicContainer", {
        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                // we override the addedToPage here our children don't know about us yet
                const superAddedToPage = self._anvil.addedToPage;
                const superRemoveFromPage = self._anvil.removedFromPage;
                const superShownOnPage = self._anvil.shownOnPage;

                Object.assign(self._anvil, {
                    addedToPage() {
                        const beforeAdd = self._anvil.pageEvents.beforeAdd || (() => {});
                        const fns = self._anvil.components.map(({component}) => () => raiseEventOrSuspend(component, s_x_anvil_propagate_page_added));
                        return Sk.misceval.chain(null, beforeAdd, ...fns, superAddedToPage);
                    },
                    removedFromPage() {
                        const fns = self._anvil.components.map(({component}) => () => raiseEventOrSuspend(component, s_x_anvil_propagate_page_removed));
                        return Sk.misceval.chain(superRemoveFromPage(), ...fns);
                    },
                    shownOnPage() {
                        if (self._anvil.onPage) {
                            const fns = self._anvil.components.map(({component}) => () => raiseEventOrSuspend(component, s_x_anvil_propagate_page_shown));
                            return Sk.misceval.chain(superShownOnPage(), ...fns);
                        }
                    }
                })
            });
    
            /*!defMethod(_,component)!2*/ "Add a component to this container."
            $loc["add_component"] = new Sk.builtin.func(function(self, pyComponent, jsLayoutProperties/* hack because Skulpt doesn't like **args params*/) {
                return doAddComponent(self, pyComponent, jsLayoutProperties);
            });
    
            /*!defMethod(_)!2*/ "Get a list of components in this container"
            $loc["get_components"] = new Sk.builtin.func(function(self) {
                return new Sk.builtin.list(self._anvil.components.map(c => c.component));
            });
    
            /*!defMethod(_)!2*/ "Remove all components from this container"
            $loc["clear"] = new Sk.builtin.func(function (self) {
                self._anvil.domNode.classList.remove("has-components");
                const removeFns = self._anvil.components.map(
                    ({ component }) =>
                        () =>
                            Sk.misceval.callsimOrSuspendArray(component.tp$getattr(s_remove_from_parent), [])
                );
                return Sk.misceval.chain(undefined, ...removeFns, () => Sk.builtin.none.none$);
            });
    
            /*!defMethod(,event_name,**event_args)!2*/ "Trigger the 'event_name' event on all children of this component. Any keyword arguments are passed to the handler function."
            $loc["raise_event_on_children"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(kwargs, self, pyEventName) {
                const eventName = Sk.ffi.remapToJs(pyEventName);
                if (eventName in self._anvil.eventTypes || eventName in (self._anvil.customComponentEventTypes || {}) || eventName.match(/^x\-/)) {
                    return Sk.misceval.chain(Sk.builtin.none.none$, ...self._anvil.components.map(({component}) => () => Sk.misceval.callsimOrSuspendArray(component.tp$getattr(s_raise_event), [pyEventName], kwargs)));
                } else {
                    throw new Sk.builtin.ValueError("Cannot raise unknown event '" + eventName + "' on " + self.tp$name + " component. Custom events must have the 'x-' prefix.");
                }
            }));

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
        }
    });

    // private methods since they're directly on the class - python can't introspect this.
    pyModule["ClassicContainer"]._check_no_parent = _check_no_parent;
    pyModule["ClassicContainer"]._doAddComponent = doAddComponent;
    
    function _check_no_parent(pyComponent) {
        if (!pyComponent?.anvil$hooks) {
            throw new Sk.builtin.TypeError("Argument to add_component must be a component");
        }
        if (getPyParent(pyComponent)) {
            throw new Sk.builtin.ValueError("This component is already added to a container, call remove_from_parent() first");
        }
        return Sk.builtin.none.none$;
    }

    function doAddComponent(self, pyComponent, jsLayoutProperties = {}, { detachDom, afterRemoval } = {}) {
        /**
         * subclasses should:
         *  - call pyModule["ClassicContainer"]._check_no_parent(pyComponent) (private js function to ensure that it is a component and does not have a parent)
         *  - add the pyComponent._anvil.domNode to their own ._anvil.domNode (however they wish and this *must* be done before calling this function)
         *  - (pyComponent should be added to the screen before calling this function otherwise show event might be raised before the component is on the screen)
         *  - call this function
         *  - make any adjustments to pyComponent e.g. ._anvil.parent.remove function or their own list of ._anvil.components
         *  - return None
         */
        _check_no_parent(pyComponent); // this is a cheap check - so we do this again even though a subclass did this
        // who knows someone might try to call this function directly!?

        if (self._anvil.components.length === 0) {
            self._anvil.domNode.classList.add("has-components");
        }

        const c = { component: pyComponent, layoutProperties: jsLayoutProperties };
        const components = self._anvil.components;
        const { index } = jsLayoutProperties;
        if (typeof index === "number" && index >= 0 && index < components.length) {
            components.splice(index, 0, c);
        } else {
            components.push(c);
        }

        pyComponent.anvilComponent$setParent(self._anvil.overrideParentObj || self, () => {
            if (detachDom) {
                detachDom();
            } else {
                const elt = pyComponent.anvil$hooks.domElement;
                elt.parentElement?.removeChild?.(elt);
            }

            for (var i = 0; i < self._anvil.components.length; i++) {
                if (self._anvil.components[i].component === pyComponent) {
                    self._anvil.components.splice(i, 1);
                    break;
                }
            }
            if (self._anvil.components.length === 0) {
                self._anvil.domNode.classList.remove("has-components");
            }
            if (self._anvil.onPage) {
                return Sk.misceval.chain(raiseEventOrSuspend(pyComponent, s_x_anvil_propagate_page_removed), () => afterRemoval?.());
            } else {
                return afterRemoval?.();
            }
        });

        if (pyComponent._anvil?.componentSpec && !pyComponent._anvil.metadata.invisible) {
            // We're in the designer, and things will break if we don't have this set
            self._anvil.childLayoutProps[pyComponent._anvil.componentSpec.name] = jsLayoutProperties;
        }

        if (self._anvil.onPage && !self._anvil.delayAddingChildrenToPage) {
            // a subclass might set this flag so that the show event fires correctly
            // if a subclass does set this flag then the subclass is responsible for calling pyComponent._anvil.addedToPage();
            return Sk.misceval.chain(raiseEventOrSuspend(pyComponent, s_x_anvil_propagate_page_added), () => Sk.builtin.none.none$);
        } else {
            return Sk.builtin.none.none$;
        }
    }
};
/*!defClass(anvil,Container,Component)!*/ 

/*
 * TO TEST:
 *
 *  - Methods: add_component, get_components, clear
 *
 */
