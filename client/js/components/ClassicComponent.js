"use strict";

import {PyHooks, ComponentTag, Component, initComponentSubclass, EMPTY_DESIGN_INFO} from "./Component";
import {designerApi} from "../runner/component-designer-api";
import {pyFunc} from "../@Sk";
import {s_x_anvil_propagate_page_added, s_x_anvil_propagate_page_removed, s_x_anvil_propagate_page_shown} from "../runner/py-util";

var PyDefUtils = require("PyDefUtils");

module.exports = (pyModule) => {
    // TODO: pyModule["ComponentTag"] = ComponentTag
    pyModule["ComponentTag"] = Sk.misceval.buildClass(
        pyModule,
        ($gbl, $loc) => {
            $loc["__serialize__"] = new Sk.builtin.func((self) => self.$d);
            $loc["__repr__"] = new Sk.builtin.func((self) => new Sk.builtin.str("ComponentTag(" + Sk.misceval.objectRepr(self.$d) + ")"));
        },
        "ComponentTag",
        []
    );

    const createHookShim = (component) => {
        if (ANVIL_IN_DESIGNER) {
            return {
                // Return an implementation of the new JS API (anvil$hooks) that's backed off the old implementation (component._anvil)
                setupDom() { return component._anvil.domNode; },
                get domElement() { return component._anvil.domNode; },
                setDataBindingListener(listenFn) { component._anvil.dataBindingWriteback = listenFn; },
                // Designer hooks
                setPropertyValues(updates) {
                    for (const [propName, value] of Object.entries(updates)) {
                        component._anvil.setPropJS(propName, value);
                    }
                    designerApi.updateComponentProperties(component, Object.fromEntries(Object.entries(updates).map(([name, _]) => [name, component._anvil.getPropJS(name)]), {}));
                },
                updateDesignName(name) {
                    component._anvil.designName = name;
                    component._anvil.updateDesignName?.(component);
                },
                getDesignInfo(asLayout) {
                    if (asLayout) {
                        return EMPTY_DESIGN_INFO;
                    }
    
                    const info = {
                        propertyDescriptions: component._anvil.propTypes.map(
                            ({
                                name,
                                type,
                                group,
                                description,
                                important,
                                options,
                                designerHint,
                                multiline,
                                deprecated,
                            }) => ({
                                name,
                                type,
                                group,
                                description,
                                important,
                                options,
                                designerHint,
                                multiline,
                                deprecated,
                            })
                        ),
                        events: component._anvil.eventTypes,
                        interactions: component._anvil.designerInteractions || [],
                        propertyValues: Object.fromEntries(
                            Object.entries(component._anvil.props).map(([name, pyVal]) => [name, Sk.ffi.toJs(pyVal)])
                        ),
                    };
    
                    const inlineEditProp = component._anvil.propTypes.find(({inlineEditElement}) => inlineEditElement);
    
                    if (inlineEditProp) {
                        info.interactions.push({
                            type: "whole_component",
                            name: "Edit text",
                            icon: "edit",
                            callbacks: {execute() {
                                    component._anvil.inlineEditing = true;
                                    component._anvil.updateDesignName?.(component);
                                    designerApi.startInlineEditing(
                                        component,
                                        inlineEditProp,
                                        component._anvil.elements[inlineEditProp.inlineEditElement],
                                        {
                                            onFinished: () => {
                                                component._anvil.inlineEditing = false;
                                                component._anvil.updateDesignName?.(component);
                                            },
                                        }
                                    );
                                }},
                            default: true,
                        });
                    }

                    const heightAdjustment = component._anvil.propTypes.find(({ name }) => name === "height");
                    if (heightAdjustment) {
                        // Canvas, TextArea, Image, GoogleMap, Plot, Spacer, XYPanel
                        const oldSetHeight = component._anvil.propMap["height"].set;

                        component._anvil.propMap["height"].set = (s, e, v) => {
                            oldSetHeight?.(s, e, v);
                            designerApi.notifyBoundsChanged(s);
                        };

                        let originalHeight;
                        let element = component.anvil$hooks.domElement;

                        info.interactions.push({
                            type: "handle",
                            position: "bottom",
                            direction: "y",
                            callbacks: {
                                grab() {
                                    // use clientHeight since the prop might be a css value
                                    originalHeight = element.clientHeight;
                                },
                                drag(relX, relY) {
                                    component._anvil.setPropJS("height", originalHeight + relY);
                                },
                                drop(relX, relY) {
                                    const newHeight = originalHeight + relY;
                                    component._anvil.setPropJS("height", newHeight);
                                    designerApi.updateComponentProperties(component, { height: newHeight }, {});
                                },
                            },
                        });
                    }

                    return info;
                },
                getContainerDesignInfo(child) {
                    return {
                        layoutPropertyDescriptions: component._anvil.layoutPropTypes?.map(
                            ({ name, type, description, options }) => ({
                                name,
                                type,
                                options,
                                description,
                            })
                        ),
                    };
                },
            }
        } else {
            return {
                setupDom() {
                    return component._anvil.domNode;
                },
                get domElement() {
                    return component._anvil.domNode;
                },
                setDataBindingListener(listenFn) {
                    component._anvil.dataBindingWriteback = listenFn;
                },
            };
        }
    };

    // TODO: implement anvilComponent$setParent

    // We use buildNativeClass to ensure that all instances of subclasses of Component follow prototypical inheritance
    // this is enforced by python. It is the reason why you get layout conflicts when trying to inherit from str and int
    // in javascript land the winner of __base__ is the next class on the prototypical chain
    // having Component as a nativeClass means that a subclass of Component will always be the winner of __base__
    // class A(Component): pass
    // class B: pass
    // class C(B, A): pass
    // C.__base__ # A (A is the winer of __base__)  in javascript C instanceof Component // true
    // an alternative would be to implement slots and give Component a __slots__ attribute. This does the same thing as above. 

    pyModule["ClassicComponent"] = Sk.abstr.buildNativeClass("anvil.ClassicComponent", {
        constructor: function ClassicComponent() {
            this._anvil = createAnvil(this); // note a pure instance of Component doesn't have a __dict__, all subclasses do however.
            this.anvil$hooks = createHookShim(this);
            this._Component = {allowedEvents: new Set(), eventHandlers: {}, tag: new ComponentTag()};
        },
        base: Component,
        slots: {
            tp$new(args, kwargs) {
                const self = Component.prototype.tp$new.call(this, []);
                const _anvil = (self._anvil = createAnvil(self));
                self.anvil$hooks = createHookShim(self);

                kwargs = kwargs || [];
                const propsToInit = {};
                for (let i = 0; i < kwargs.length; i += 2) {
                    propsToInit[kwargs[i]] = kwargs[i + 1];
                }

                const {
                    prop$defaults: propDefaults,
                    create$element: createElement,
                    prop$map: propMap,
                    prop$types: propTypes,
                    event$types: eventTypes,
                    layout$props: layoutPropTypes,
                    prop$dataBinding: dataBindingProp,
                    props$toInitialize: propsToInitialize,
                } = self;
                // use prototypical inheritance to get these
                // this won't break since native classes demand prototypical inheritance

                const props = {};
                Object.keys(propDefaults).forEach((propName) => {
                    const propVal = propsToInit[propName] || propDefaults[propName];
                    if (propVal !== undefined) {
                        props[propName] = propVal; // we shouldn't put undefined in props see getProp
                    }
                });
                props.tag = props.tag || PyDefUtils.pyCall(pyModule["ComponentTag"]);

                _anvil.props = props;
                _anvil.propMap = propMap;
                _anvil.propTypes = propTypes;
                _anvil.eventTypes = eventTypes;
                _anvil.layoutPropTypes = layoutPropTypes;
                _anvil.dataBindingProp = dataBindingProp;



                // We have discussed passing self to createElement. 
                // This would be totally reasonable, and probably be useful, but we don't need it right now.
                const [domNode, elements] = createElement(props);
                const element = $(domNode);

                _anvil.element = element
                _anvil.elements = elements;
                _anvil.domNode = domNode;

                domNode.classList.add("anvil-component"); // this is a relatively slow operation
                element.data("anvil-py-component", self);
                // These may have already been set if we created this component in the designer, but
                // we need to set them if we created this component at runtime. No harm setting them
                // twice, so just do it.

                if (propsToInitialize && propsToInitialize.length) {
                    const fns = propsToInitialize
                        .filter((propName) => props[propName] !== undefined)
                        .map((propName) => () => _anvil.setProp(propName, props[propName]));
                    fns.push(() => self);
                    return Sk.misceval.chain(null, ...fns);
                }
                return self;
            },
            /*
             * The job of __init__ here is to be friendly to subclassing
             * We wait until __init__ to throw any exceptions
             * We only update component props that are not strictly equal to the props we received in __new__
             * This allows users to extract properties and manipulate them before calling super().__init__
             * 
             *     def __init__(self, foo, background, **properties):
             *         self.foo = foo
             *         background = 'red'
             *         super().__init__(background=background, **properties)
             */
            tp$init(args, kwargs) {
                if (args.length) {
                    throw new Sk.builtin.TypeError("Component constructor takes keyword arguments only");
                }
                if (ANVIL_IN_DESIGNER || designerApi.inDesigner) {
                    return;
                }
                kwargs = kwargs || [];
                let __ignore_property_exceptions = false;
                const badKwargs = [];
                const chainFns = [];
                const readOnly = [];
                const props = this._anvil.props;
                const propMap = this._anvil.propMap;
                for (let i = 0; i < kwargs.length; i += 2) {
                    const propName = kwargs[i];
                    const propVal = kwargs[i + 1];
                    if (propVal !== props[propName]) {
                        if (propName === "__ignore_property_exceptions") {
                            __ignore_property_exceptions = true; 
                            // this will be true for every anvil yaml component so check this first
                        } else if (!(propName in propMap)) {
                            badKwargs.push(propName);
                        } else if (propMap[propName].readOnly) {
                            readOnly.push(propName);
                        } else {
                            chainFns.push(() => this._anvil.setProp(propName, propVal))
                        }
                    }
                }
                if (!__ignore_property_exceptions && (badKwargs.length || readOnly.length)) {
                    let msg = Sk.abstr.typeName(this);
                    if (badKwargs.length) {
                        msg += " got unexpected keyword argument(s): " + badKwargs.map((x) => "'" + x + "'").join(", "); 
                    }
                    if (readOnly.length) {
                        msg += badKwargs.length ? "\n" : " ";
                        msg += "cannot set the following readonly properties: " + readOnly.map((x) => "'" + x + "'").join(", ");
                    }
                    throw new Sk.builtin.TypeError(msg);
                }
                if (chainFns.length) {
                    return Sk.misceval.chain(null, ...chainFns);
                }
            },
        },
        methods: {
            // The original, _anvil-dependent implementation of events, for compatibility
            "set_event_handler": {
                $meth: function (pyEventName, pyHandler) {
                    const eventName = this.$verifyEventName(pyEventName, "set event handler for");
                    if (Sk.builtin.checkNone(pyHandler)) {
                        // we delete as a signal that the event handlers for this event don't exist. See link click event for example
                        delete this._anvil.eventHandlers[eventName];
                    } else {
                        // replace existing handlers with the new handler
                        this.$verifyCallable(eventName, pyHandler);
                        this._anvil.eventHandlers[eventName] = [pyHandler];
                    }
                    return Sk.builtin.none.none$;
                },
                $flags: { MinArgs: 2, MaxArgs: 2 },
                $doc: "Set a function to call when the 'event_name' event happens on this component. Using set_event_handler removes all other handlers. Setting the handler function to None removes all handlers.",
            },
            "add_event_handler": {
                $meth: function (pyEventName, pyHandler) {
                    const eventName = this.$verifyEventName(pyEventName, "set event handler");
                    this.$verifyCallable(eventName, pyHandler);
                    const eventHandlers = this._anvil.eventHandlers[eventName] || (this._anvil.eventHandlers[eventName] = []);
                    eventHandlers.push(pyHandler);
                    return Sk.builtin.none.none$;
                },
                $flags: { MinArgs: 2, MaxArgs: 2 },
                $doc: "Add an event handler function to be called when the event happens on this component. Event handlers will be called in the order they are added. Adding the same event handler multiple times will mean it gets called multiple times.",
            },
            "remove_event_handler": {
                $meth: function (pyEventName, pyHandler) {
                    const eventName = this.$verifyEventName(pyEventName, "remove event handler");
                    if (pyHandler === undefined) {
                        // remove all the handlers
                        delete this._anvil.eventHandlers[eventName];
                        return Sk.builtin.none.none$;
                    }
                    this.$verifyCallable(eventName, pyHandler);
                    const currentHandlers = this._anvil.eventHandlers[eventName];
                    if (currentHandlers === undefined) {
                        throw new Sk.builtin.LookupError(`event handler '${pyHandler}' was not found in '${eventName}' event handlers for this component`);
                    }
                    const eventHandlers = currentHandlers.filter(
                        (handler) => handler !== pyHandler && Sk.misceval.richCompareBool(handler, pyHandler, "NotEq")
                    );
                    if (eventHandlers.length === currentHandlers.length) {
                        throw new Sk.builtin.LookupError(`event handler '${pyHandler}' was not found in '${eventName}' event handlers for this component`);
                    } else if (eventHandlers.length) {
                        this._anvil.eventHandlers[eventName] = eventHandlers;
                    } else {
                        // we delete as a signal that the event handlers for this event don't exist. See link click event for example
                        delete this._anvil.eventHandlers[eventName];
                    }
                    return Sk.builtin.none.none$;
                },
                $flags: { MinArgs: 1, MaxArgs: 2 },
                $doc: "Remove a specific event handler function for a given event. Calling remove_event_handler with just the event name will remove all the handlers for this event",
            },
            "raise_event": {
                $meth: function (args, kws) {
                    Sk.abstr.checkOneArg("raise_event", args);
                    const eventName = this.$verifyEventName(args[0], "raise event");
                    kws || (kws = []);
                    const eventArgs = {};
                    for (let i = 0; i < kws.length - 1; i += 2) {
                        eventArgs[kws[i].toString()] = kws[i + 1];
                    }
                    return PyDefUtils.raiseEventOrSuspend(eventArgs, this, eventName);
                },
                $flags: { FastCall: true },
                $doc: "Trigger the event on this component. Any keyword arguments are passed to the handler function.",
            },
            "get_event_handlers": {
                $meth: function (eventName) {
                    eventName = this.$verifyEventName(eventName, "get event handlers");
                    return new Sk.builtin.tuple(this._anvil.eventHandlers[eventName] || []);
                },
                $flags: { OneArg: true },
                $doc: "Get the current event_handlers for a given event_name",
            },
        },
        getsets: {
            __name__: {
                $get() {
                    return Sk.abstr.lookupSpecial(this.ob$type, Sk.builtin.str.$name);
                },
            },
        },
        proto: {
            // just use the self version
            __serialize__: PyDefUtils.mkSerializePreservingIdentity((self) => {
                let v = [];
                for (let n in self._anvil.props) {
                    v.push(new Sk.builtin.str(n), self._anvil.props[n]);
                }
                return new Sk.builtin.dict(v);
            }),

            __new_deserialized__: PyDefUtils.mkNewDeserializedPreservingIdentity(),

            $verifyEventName(eventName, msg) {
                if (!Sk.builtin.checkString(eventName)) {
                    throw new Sk.builtin.TypeError("expected the first argument to be a string");
                }
                eventName = eventName.toString();
                if (eventName in this._anvil.eventTypes || eventName in (this._anvil.customComponentEventTypes || {}) || eventName.startsWith("x-")) {
                    return eventName;
                } else {
                    throw new Sk.builtin.ValueError(`Cannot ${msg} for unknown event '${eventName}' on ${this.tp$name} component. Custom event names must start with 'x-'.`)
                }                
            },
            $verifyCallable(eventName, pyHandler) {
                if (!Sk.builtin.checkCallable(pyHandler)) {
                    throw new Sk.builtin.TypeError(`The '${eventName}' event handler added to ${this.tp$name} must be a callable, not type '${Sk.abstr.typeName(pyHandler)}'`);
                }
            },
        },
        flags: {
            sk$klass: true // tell skulpt we can be treated like a regular klass for tp$setatttr
        },
    });

    PyDefUtils.initComponentClassPrototype(
        pyModule["ClassicComponent"],
        PyDefUtils.assembleGroupProperties(["user data"]),
        [], // events
        () => <div />, // element
        [] // layoutProps
    );

    // Because __init_subclass__ isn't a thing for native types
    initComponentSubclass(pyModule["ClassicComponent"]);



    function createAnvil(self) {
        let show, hide;
        const _anvil = {
            element: null, // will be created in Component.__new__
            domNode: null, // will be created in Component.__new__
            elements: null, // will be a dict of {refName: domNode}
            // for compatibility
            // parent: null, // will be {pyObj: parent_component, removeFn: fn}
            get parent() {
                const internalParent = self._Component.parent ?? null;
                return internalParent && {
                    pyObj: internalParent.pyParent,
                    removeFn: () => internalParent.remove.forEach(f => f()),
                };
            },
            set parent({pyObj, removeFn}) {
                self.anvilComponent$setParent(pyObj, removeFn);
            },
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
            delayAddingChildrenToPage: false,
            components: [],
            addedToPage() {
                show = show || PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "show");
                self._anvil.onPage = true;
                return Sk.misceval.chain(null, self._anvil.pageEvents.add || (() => {}), show);
            },
            removedFromPage() {
                hide = hide || PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "hide");
                self._anvil.onPage = false;
                return Sk.misceval.chain(hide(), self._anvil.pageEvents.remove || (() => {}));
            },
            shownOnPage() {
                if (self._anvil.onPage) {
                    show = show || PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "show");
                    return Sk.misceval.chain(show(), self._anvil.pageEvents.show || (() => {}));
                }
            },
            pageEvents: {},
            getProp(name) {
                var prop = self._anvil.propMap[name];
                if (!prop) {
                    throw new Sk.builtin.AttributeError(self.tp$name + " component has no property called '" + name + "'");
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
                            throw new Sk.builtin.ValueError(self.tp$name + " component has no value or default for property '" + name + "'");
                        }
                    }
                }
                return v;
            },
            getPropJS(name) {
                var prop = self._anvil.propMap[name];
                if (prop && prop.getJS) {
                    return prop.getJS(self, self._anvil.element);
                } else {
                    return Sk.ffi.remapToJs(Sk.misceval.retryOptionalSuspensionOrThrow(this.getProp(name)));
                }
            },
            setProp(name, pyValue) {
                var prop = self._anvil.propMap[name];

                if (!prop) {
                    throw new Sk.builtin.AttributeError(self.tp$name + " component has no property called '" + name + "'");
                }

                if (pyValue === undefined) {
                    throw new Sk.builtin.ValueError("'undefined' is not a valid Python value");
                }

                if (prop.readOnly) {
                    throw new Sk.builtin.AttributeError("The '" + name + "' property for a " + self.tp$name + " is read-only");
                }

                var pyOldValue = self._anvil.props[name];
                pyOldValue = pyOldValue === undefined ? Sk.builtin.none.none$ : pyOldValue;
                self._anvil.props[name] = pyValue;

                var v;
                if (prop.set) {
                    v = prop.set(self, self._anvil.element, prop.pyVal ? pyValue : Sk.ffi.remapToJs(pyValue), prop.pyVal ? pyOldValue : Sk.ffi.remapToJs(pyOldValue));
                }
                return v === undefined ? Sk.builtin.none.none$ : v;
            },
            setPropJS(name, value) {
                Sk.misceval.retryOptionalSuspensionOrThrow(this.setProp(name, Sk.ffi.remapToPy(value)));
            },
            // Gets overwritten by form if this component is data-bound
            dataBindingWriteback(pyComponent, attrName, pyNewValue) {
                return Promise.resolve();
            },

            dataBindingProp: null,

        };

        _anvil.eventHandlers[s_x_anvil_propagate_page_added.toString()] = [PyDefUtils.funcFastCall(() => _anvil.addedToPage())];
        _anvil.eventHandlers[s_x_anvil_propagate_page_removed.toString()] = [PyDefUtils.funcFastCall(() => _anvil.removedFromPage())];
        _anvil.eventHandlers[s_x_anvil_propagate_page_shown.toString()] = [PyDefUtils.funcFastCall(() => _anvil.shownOnPage())];

        return _anvil;
    }
};

/*
 * TO TEST:
 *
 *  - Methods: set_event_handler, add_event_handler, raise_event, remove_from_parent
 *
 */

