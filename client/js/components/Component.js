"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = (pyModule) => {
    pyModule["ComponentTag"] = Sk.misceval.buildClass(
        pyModule,
        ($gbl, $loc) => {
            $loc["__serialize__"] = new Sk.builtin.func((self) => self.$d);
            $loc["__repr__"] = new Sk.builtin.func((self) => new Sk.builtin.str("ComponentTag(" + Sk.misceval.objectRepr(self.$d) + ")"));
        },
        "ComponentTag",
        []
    );

    // We use buildNativeClass to ensure that all instances of subclasses of Component follow prototypical inheritance
    // this is enforced by python. It is the reason why you get layout conflicts when trying to inherit from str and int
    // in javascript land the winner of __base__ is the next class on the prototypical chain
    // having Component as a nativeClass means that a subclass of Component will always be the winner of __base__
    // class A(Component): pass
    // class B: pass
    // class C(B, A): pass
    // C.__base__ # A (A is the winer of __base__)  in javascript C instanceof Component // true
    // an alternative would be to implement slots and give Component a __slots__ attribute. This does the same thing as above. 
    const inDesigner = window.anvilInDesigner;

    pyModule["Component"] = Sk.abstr.buildNativeClass("anvil.Component", {
        constructor: function Component() {
            this._anvil = {}; // note a pure instance of Component doesn't have a __dict__, all subclasses do however.
        },
        slots: {
            tp$new(args, kwargs) {
                const cls = this.constructor; // this is the prototype of an Anvil Component Class (this.prototype.tp$new)
                const self = new cls();
                const _anvil = (self._anvil = createAnvil(self));

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
            tp$init(args, kwargs) {
                if (args.length) {
                    throw new Sk.builtin.TypeError("Component constructor takes keyword arguments only");
                }
                if (inDesigner) {
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
            /*!defBuiltinMethod(,event_name, handler_func:callable)!2*/
            "set_event_handler": {
                $meth: function (pyEventName, pyHandler) {
                    const eventName = this.$verifyEventName(pyEventName, "set event handler for");
                    if (Sk.builtin.checkNone(pyHandler)) {
                        // we delete as a signal that the event handlers for this event don't exist. See link click event for example
                        delete this._anvil.eventHandlers[eventName];
                    } else {
                        // replace existing handlers with the new handler
                        verifyCallableHandler(pyHandler);
                        this._anvil.eventHandlers[eventName] = [pyHandler];
                    }
                    return Sk.builtin.none.none$;
                },
                $flags: { MinArgs: 2, MaxArgs: 2 },
                $doc: "Set a function to call when the 'event_name' event happens on this component. Using set_event_hanlder removes all other handlers. Seting the handler function to None removes all handlers.",
            },
            /*!defBuiltinMethod(,event_name, handler_func:callable)!2*/
            "add_event_handler": {
                $meth: function (pyEventName, pyHandler) {
                    const eventName = this.$verifyEventName(pyEventName, "set event handler");
                    verifyCallableHandler(pyHandler);
                    const eventHandlers = this._anvil.eventHandlers[eventName] || (this._anvil.eventHandlers[eventName] = []);
                    eventHandlers.push(pyHandler);
                    return Sk.builtin.none.none$;
                },
                $flags: { MinArgs: 2, MaxArgs: 2 },
                $doc: "Add an event handler function to be called when the event happens on this component. Event handlers will be called in the order they are added. Adding the same event handler multiple times will mean it gets called multiple times.",
            },
            /*!defBuiltinMethod(,event_name, [handler_func:callable])!2*/
            "remove_event_handler": {
                $meth: function (pyEventName, pyHandler) {
                    const eventName = this.$verifyEventName(pyEventName, "remove event handler");
                    if (pyHandler === undefined) {
                        // remove all the handlers
                        delete this._anvil.eventHandlers[eventName];
                        return Sk.builtin.none.none$;
                    }
                    verifyCallableHandler(pyHandler);
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
            /*!defBuiltinMethod(,event_name,**event_args)!2*/
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
            /*!defBuiltinMethod(_)!2*/
            "remove_from_parent": {
                $meth: function () {
                    if (this._anvil.parent) {
                        return this._anvil.parent.remove();
                    }
                    return Sk.builtin.none.none$;
                },
                $flags: { NoArgs: true },
                $doc: "Remove this component from its parent container.",
            },
            /*!defBuiltinMethod(,smooth=False)!2*/
            "scroll_into_view": {
                $meth: function (smooth) {
                    this._anvil.domNode.scrollIntoView({ behavior: Sk.misceval.isTrue(smooth) ? "smooth" : "instant", block: "center", inline: "center" });
                    return Sk.builtin.none.none$;
                },
                $flags: { NamedArgs: ["smooth"], Defaults: [Sk.builtin.bool.false$] },
                $doc: "Scroll the window to make sure this component is in view.",
            },
            /*!defBuiltinMethod(tuple_of_event_handlers, event_name)!2*/
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
            parent: {
                $get() {
                    return this._anvil.parent ? this._anvil.parent.pyObj : Sk.builtin.none.none$;
                },
                $set() {
                    throw new Sk.builtin.AttributeError("Cannot set a '" + this.tp$name + "' component's parent this way - use 'add_component' on the container instead");
                },
            },
            __name__: {
                $get() {
                    return Sk.abstr.lookupSpecial(this.ob$type, Sk.builtin.str.$name);
                },
            },
            tag: {
                $get() {
                    return this._anvil.props.tag || Sk.builtin.none.none$;
                },
                $set(val) {
                    this._anvil.props.tag = val;
                },
                $doc: "Use this property to store any extra information about this component",
            }
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
                if (eventName in this._anvil.eventTypes || eventName in (this._anvil.customComponentEventTypes || {}) || eventName.match(/^x\-/)) {
                    return eventName;
                } else {
                    throw new Sk.builtin.ValueError(`Cannot ${msg} for unknown event '${eventName}' on ${self.tp$name} component. Custom event names must start with 'x-'.`)
                }                
            },
        },
        flags: {
            // Ew. This global should be somewhere else.
            $_anvilThemeColors: {},
            sk$klass: true // tell skulpt we can be treated like a regular klass for tp$setatttr
        },
    });

    PyDefUtils.initComponentClassPrototype(
        pyModule["Component"],
        PyDefUtils.assembleGroupProperties(["user data"]),
        [], // events
        () => <div />, // element
        [] // layoutProps
    );

    /*!defClass(anvil,Component)!*/

    function verifyCallableHandler(pyHandler) {
        if (!Sk.builtin.checkCallable(pyHandler)) {
            throw new Sk.builtin.TypeError("The event handler must be a callable, not type '" + Sk.abstr.typeName(pyHandler) + "'");
        }
    }
    

    function createAnvil(self) {
        let show, hide;
        return {
            element: null, // will be created in Component.__new__
            domNode: null, // will be created in Component.__new__
            elements: null, // will be a dict of {refName: domNode}
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
            delayAddedToPage: false,
            components: [],
            addedToPage() {
                show = show || PyDefUtils.raiseEventOrSuspend.bind(null, {}, self, "show");
                self._anvil.onPage = true;
                self._anvil.delayAddedToPage = false;
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

            // Ew
            themeColors: pyModule["Component"].$_anvilThemeColors,
        };
    }
};

/*
 * TO TEST:
 *
 *  - Methods: set_event_handler, add_event_handler, raise_event, remove_from_parent
 *
 */

