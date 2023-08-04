"use strict";

import {PyHooks, ComponentTag, Component, initComponentSubclass, EMPTY_DESIGN_INFO, raiseEventOrSuspend} from "./Component";
import {designerApi} from "../runner/component-designer-api";
import {chainOrSuspend, checkOneArg, pyFunc, pyStr, toPy} from "../@Sk";
import {s_anvil_events, s_x_anvil_propagate_page_added, s_x_anvil_propagate_page_removed, s_x_anvil_propagate_page_shown} from "../runner/py-util";

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

    const universalEvents = PyDefUtils.assembleGroupEvents("ClassicComponent", ["universal"]);

    const createHookShim = (component) => {
        if (ANVIL_IN_DESIGNER) {
            return {
                // Return an implementation of the new JS API (anvil$hooks) that's backed off the old implementation (component._anvil)
                setupDom() { return component._anvil.domNode; },
                get domElement() { return component._anvil.domNode; },
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
                                hidden,
                                options,
                                iconset,
                                allowCustomValue,
                                designerHint,
                                multiline,
                                deprecated,
                                allowBindingWriteback,
                            }) => ({
                                name,
                                type,
                                group,
                                description,
                                important,
                                hidden,
                                options,
                                iconset,
                                allowCustomValue,
                                designerHint,
                                multiline,
                                deprecated,
                                supportsWriteback: allowBindingWriteback,
                            })
                        ),
                        events: {...component._anvil.eventTypes},
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
            // note a pure instance of Component doesn't have a __dict__, all subclasses do however.
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
                _anvil.layoutPropTypes = layoutPropTypes;
                _anvil.dataBindingProp = dataBindingProp;
                // backwards compatibility (anvil-extras uses this oops)
                _anvil.eventHandlers = Object.assign(self._Component.eventHandlers, _anvil.eventHandlers);
                _anvil.eventTypes = new Proxy(eventTypes ?? {}, {
                    get(target, k) {
                        return target[k];
                    },
                    set(target, k, v) {
                        target[k] = v;
                        if (v) {
                            self._Component.allowedEvents.add(k);
                        } else {
                            self._Component.allowedEvents.delete(k);
                        }
                        return true;
                    },
                });

                // We have discussed passing self to createElement.
                // This would be totally reasonable, and probably be useful, but we don't need it right now.
                const [domNode, elements] = createElement(props);
                const element = $(domNode);

                _anvil.element = element;
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
                            chainFns.push(() => this._anvil.setProp(propName, propVal));
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
                        msg +=
                            "cannot set the following readonly properties: " +
                            readOnly.map((x) => "'" + x + "'").join(", ");
                    }
                    throw new Sk.builtin.TypeError(msg);
                }
                if (chainFns.length) {
                    return Sk.misceval.chain(null, ...chainFns);
                }
            },
        },
        classmethods: {
            __init_subclass__: {
                $meth(args) {
                    // The DesignXYZ components are built with buildClass() inheritance (ie they'll trigger this
                    // method), and sometimes overwrite the propmap to do design-y things with _anvil.
                    // Isolate them, so that we can have Design and non-Design versions on the same page
                    const inheritedPropMap = this.prototype.prop$map;
                    if (inheritedPropMap) {
                        // We clone two levels deep because sometimes inheriting classes edit individual properties
                        // (eg DesignTextBox alters the "set" hook for the "text" property)
                        const clonedPropMap = Object.fromEntries(
                            Object.entries(inheritedPropMap).map(([name, entry]) => [name, { ...entry }])
                        );
                        Object.defineProperty(this.prototype, "prop$map", {
                            value: clonedPropMap,
                            writable: true,
                        });
                    }

                    return initComponentSubclass(this);
                },
                $flags: { FastCall: true },
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
            [s_anvil_events]: toPy(universalEvents),

            __new_deserialized__: PyDefUtils.mkNewDeserializedPreservingIdentity(),
        },
        flags: {
            sk$klass: true, // tell skulpt we can be treated like a regular klass for tp$setatttr
        },
    });

    PyDefUtils.initComponentClassPrototype(
        pyModule["ClassicComponent"],
        PyDefUtils.assembleGroupProperties(["user data"]),
        universalEvents, // events
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
                    setVisibility: internalParent.setVisibility
                };
            },
            set parent({pyObj, removeFn, setVisibility}) {
                self.anvilComponent$setParent(pyObj, {onRemove: removeFn, setVisibility});
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
            dataBindingWriteback(pyComponent, attrName, pyNewValue) {

                return PyDefUtils.asyncToPromise(() => chainOrSuspend(
                    pyNewValue ?? Sk.abstr.gattr(pyComponent, new pyStr(attrName), true),
                    pyNewValue => raiseEventOrSuspend(self, new pyStr("x-anvil-write-back-"+attrName), ["property",new pyStr(attrName), "value", pyNewValue])
                ));
            },

            dataBindingProp: null,

        };

        _anvil.eventHandlers[s_x_anvil_propagate_page_added] = [PyDefUtils.funcFastCall(() => _anvil.addedToPage())];
        _anvil.eventHandlers[s_x_anvil_propagate_page_removed] = [PyDefUtils.funcFastCall(() => _anvil.removedFromPage())];
        _anvil.eventHandlers[s_x_anvil_propagate_page_shown] = [PyDefUtils.funcFastCall(() => _anvil.shownOnPage())];

        return _anvil;
    }
};

/*
 * TO TEST:
 *
 *  - Methods: set_event_handler, add_event_handler, raise_event, remove_from_parent
 *
 */

