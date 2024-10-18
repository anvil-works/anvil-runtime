"use strict";

import { data } from "@runtime/runner/data";
import { hasLegacyDict } from "@runtime/runner/legacy-features";
import { chainOrSuspend, isTrue, pyCallOrSuspend, pyDict, pyNone, pyStr, pySuper } from "../@Sk";
import { designerApi } from "../runner/component-designer-api";
import {
    initNativeSubclass,
    kwsToObj,
    s_init_subclass,
    s_x_anvil_classic_hide,
    s_x_anvil_classic_show,
    s_x_anvil_page_added,
    s_x_anvil_page_removed,
    s_x_anvil_page_shown,
} from "../runner/py-util";
import { Component, getListenerCallbacks, raiseWritebackEventOrSuspend } from "./Component";

var PyDefUtils = require("PyDefUtils");

const hasOwnProperty = Object.prototype.hasOwnProperty;

module.exports = (pyModule) => {
    // TODO: pyModule["ComponentTag"] = ComponentTag
    pyModule["ComponentTag"] = Sk.misceval.buildClass(
        pyModule,
        ($gbl, $loc) => {
            $loc["__serialize__"] = new Sk.builtin.func((self) => self.$d);
            $loc["__repr__"] = new Sk.builtin.func(
                (self) => new Sk.builtin.str("ComponentTag(" + Sk.misceval.objectRepr(self.$d) + ")")
            );
        },
        "ComponentTag",
        []
    );

    const propNameMap = [
        ["name", "name"],
        ["type", "type"],
        ["group", "group"],
        ["description", "description"],
        ["important", "important"],
        ["hidden", "hidden"],
        ["options", "options"],
        ["accept", "accept"],
        ["iconsets", "iconsets"],
        ["allowCustomValue", "allowCustomValue"],
        ["designerHint", "designerHint"],
        ["multiline", "multiline"],
        ["deprecated", "deprecated"],
        ["allowBindingWriteback", "supportsWriteback"],
        ["includeNoneOption", "includeNoneOption"],
        ["noneOptionLabel", "noneOptionLabel"],
        ["defaultBindingProp", "defaultBindingProp"],
        ["priority", "priority"],
        ["showInDesignerWhen", "showInDesignerWhen"],
    ];

    function propertyDescriptionMapper(property) {
        const rv = {};
        for (const [sourceCodeName, designerName] of propNameMap) {
            if (sourceCodeName in property) {
                rv[designerName] = property[sourceCodeName];
            }
        }
        if (property.deprecateFromRuntimeV3 && data.app.runtime_options.version >= 3) {
            rv.deprecated = true;
        }
        return rv;
    }

    function getPropertyDescriptions(rawPropDescriptions) {
        return rawPropDescriptions.map(propertyDescriptionMapper);
    }

    const universalEvents = PyDefUtils.assembleGroupEvents("ClassicComponent", ["universal"]);

    const createHookSpec = (cls) => {
        let hookSpec;
        if (ANVIL_IN_DESIGNER) {
            hookSpec = {
                // Return an implementation of the new JS API (anvil$hooks) that's backed off the old implementation (component._anvil)
                setupDom() {
                    return this._anvil.domNode;
                },
                getDomElement() {
                    return this._anvil.domNode;
                },
                // Designer hooks
                updateDesignName(name) {
                    this._anvil.designName = name;
                    this._anvil.updateDesignName?.(this);
                },
                getInteractions() {
                    const interactions = [];
                    const inlineEditProp = this._anvil.propTypes.find(({ inlineEditElement }) => inlineEditElement);
                    if (inlineEditProp) {
                        interactions.push({
                            type: "whole_component",
                            name: "Edit text",
                            icon: "edit",
                            callbacks: {
                                execute: () => {
                                    this._anvil.inlineEditing = true;
                                    this._anvil.updateDesignName?.(this);
                                    designerApi.startInlineEditing(
                                        this,
                                        inlineEditProp,
                                        this._anvil.elements[inlineEditProp.inlineEditElement],
                                        {
                                            onFinished: () => {
                                                this._anvil.inlineEditing = false;
                                                this._anvil.updateDesignName?.(this);
                                            },
                                        }
                                    );
                                },
                            },
                            default: true,
                        });
                    }
                    const heightAdjustment = this._anvil.propTypes.find(({ name }) => name === "height");
                    if (heightAdjustment) {
                        // Canvas, TextArea, Image, GoogleMap, Plot, Spacer, XYPanel
                        const oldSetHeight = this._anvil.propMap["height"].set;

                        this._anvil.propMap["height"].set = (s, e, v) => {
                            oldSetHeight?.(s, e, v);
                        };

                        let originalHeight;
                        let element = this.anvil$hooks.domElement;

                        interactions.push({
                            type: "handle",
                            position: "bottom",
                            direction: "y",
                            callbacks: {
                                grab() {
                                    // use clientHeight since the prop might be a css value
                                    originalHeight = element.clientHeight;
                                },
                                drag: (relX, relY) => {
                                    this._anvil.setPropJS("height", originalHeight + relY);
                                },
                                drop: (relX, relY) => {
                                    const newHeight = originalHeight + relY;
                                    this._anvil.setPropJS("height", newHeight);
                                    designerApi.updateComponentProperties(this, { height: newHeight }, {});
                                },
                            },
                        });
                    }
                    return interactions;
                },
                getUnsetPropertyValues() {
                    return Object.fromEntries(
                        Object.entries(this._anvil.propMap)
                            .map(([name, { getUnset }]) => [
                                name,
                                getUnset?.(this, this._anvil.element, this._anvil.props[name]),
                            ])
                            .filter(([_, unset]) => unset)
                    );
                },
                getProperties() {
                    // we don't use _anvil because 'this' might be the prototype
                    return getPropertyDescriptions(this._anvilClassic$propTypes);
                },
                getEvents() {
                    return Object.values(this._anvilClassic$eventTypes);
                },
                getContainerDesignInfo(child) {
                    return {
                        layoutPropertyDescriptions: this._anvil.layoutPropTypes?.map(
                            ({ name, type, description, options }) => ({
                                name,
                                type,
                                options,
                                description,
                            })
                        ),
                    };
                },
            };
        } else {
            hookSpec = {
                setupDom() {
                    return this._anvil.domNode;
                },
                getDomElement() {
                    return this._anvil.domNode;
                },
                getProperties() {
                    // we don't use _anvil because 'this' might be the cls.prototype
                    return getPropertyDescriptions(this._anvilClassic$propTypes);
                },
                getEvents() {
                    return Object.values(this._anvilClassic$eventTypes);
                },
            };
        }
        cls.prototype.anvil$hookSpec = hookSpec;
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
                if (!self.$d && hasLegacyDict()) {
                    self.$d = new pyDict();
                }
                const _anvil = (self._anvil = createAnvil(self));

                kwargs = kwargs || [];
                const propsToInit = {};
                for (let i = 0; i < kwargs.length; i += 2) {
                    propsToInit[kwargs[i]] = kwargs[i + 1];
                }

                const {
                    _anvilClassic$propDefaults: propDefaults,
                    _anvilClassic$createElement: createElement,
                    _anvilClassic$propMap: propMap,
                    _anvilClassic$propTypes: propTypes,
                    _anvilClassic$eventTypes: eventTypes,
                    _anvilClassic$layoutProps: layoutPropTypes,
                    _anvilClassic$dataBindingProps: dataBindingProps,
                    _anvilClassic$propsToInitialize: propsToInitialize,
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
                _anvil.dataBindingProp = dataBindingProps;
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

                // special case visible - since we need to notify parent
                if ("visible" in props && "visible" in propMap) {
                    self._Component.pageState.currentlyVisible = isTrue(props.visible);
                }

                if (propsToInitialize?.length) {
                    const fns = propsToInitialize
                        .filter((propName) => propName in props)
                        .map((propName) => () => _anvil.setProp(propName, props[propName]));
                    return chainOrSuspend(null, ...fns, () => self);
                } else {
                    return self;
                }
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
                $meth(args, kws) {
                    const kwObj = kwsToObj(kws);
                    PyDefUtils.initClassicComponentClassPrototype(this, kwObj._anvil_classic ?? {});
                    if (kwObj._anvil_classic && !hasOwnProperty.call(this, "anvil$hookSpec")) {
                        createHookSpec(this);
                    }
                    const superInit = new pySuper(pyModule["ClassicComponent"], this).tp$getattr(s_init_subclass);
                    return pyCallOrSuspend(superInit, args, kws);
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
            __new_deserialized__: PyDefUtils.mkNewDeserializedPreservingIdentity(),
        },
        flags: {
            sk$klass: true, // tell skulpt we can be treated like a regular klass for tp$setatttr
        },
    });

    PyDefUtils.initClassicComponentClassPrototype(pyModule["ClassicComponent"], {
        properties: PyDefUtils.assembleGroupProperties(["user data"]),
        events: universalEvents, // events
        element: () => <div />, // element
        layouts: [], // layoutProps
    });

    Object.defineProperties(pyModule["ClassicComponent"].prototype, {
        anvil$properties: {
            get() {
                return getPropertyDescriptions(this._anvilClassic$propTypes);
            },
            configurable: true,
        },
        anvil$events: {
            get() {
                return Object.values(this._anvilClassic$eventTypes);
            },
            configurable: true,
        },
    });

    // Because __init_subclass__ isn't a thing for native types
    createHookSpec(pyModule["ClassicComponent"]);
    initNativeSubclass(pyModule["ClassicComponent"]);

    function createAnvil(self) {
        const _anvil = {
            element: null, // will be created in Component.__new__
            domNode: null, // will be created in Component.__new__
            elements: null, // will be a dict of {refName: domNode}
            // for compatibility
            // parent: null, // will be {pyObj: parent_component, removeFn: fn}
            get parent() {
                const internalParent = self._Component.parent ?? null;
                return (
                    internalParent && {
                        pyObj: internalParent.pyParent,
                        removeFn: () => internalParent.remove.forEach((f) => f()),
                        setVisibility: internalParent.setVisibility,
                    }
                );
            },
            set parent({ pyObj, removeFn, setVisibility }) {
                // this shouldn't be called directly - leave here for legacy
                self._Component.parent = { pyParent: pyObj, onRemove: [removeFn], setVisibility };
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
            components: [],
            addedToPage() {
                self._anvil.onPage = true;
                return self._anvil.pageEvents.add?.();
            },
            removedFromPage() {
                self._anvil.onPage = false;
                return self._anvil.pageEvents.remove?.();
            },
            shownOnPage() {
                if (self._anvil.onPage) {
                    return self._anvil.pageEvents.show?.();
                }
            },
            pageEvents: {},
            getProp(name) {
                var prop = self._anvil.propMap[name];
                if (!prop) {
                    throw new Sk.builtin.AttributeError(
                        self.tp$name + " component has no property called '" + name + "'"
                    );
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
                            throw new Sk.builtin.ValueError(
                                self.tp$name + " component has no value or default for property '" + name + "'"
                            );
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
                    throw new Sk.builtin.AttributeError(
                        self.tp$name + " component has no property called '" + name + "'"
                    );
                }

                if (pyValue === undefined) {
                    throw new Sk.builtin.ValueError("'undefined' is not a valid Python value");
                }

                if (prop.readOnly) {
                    throw new Sk.builtin.AttributeError(
                        "The '" + name + "' property for a " + self.tp$name + " is read-only"
                    );
                }

                var pyOldValue = self._anvil.props[name];
                pyOldValue = pyOldValue === undefined ? Sk.builtin.none.none$ : pyOldValue;
                self._anvil.props[name] = pyValue;

                var v;
                if (prop.set) {
                    v = prop.set(
                        self,
                        self._anvil.element,
                        prop.pyVal ? pyValue : Sk.ffi.remapToJs(pyValue),
                        prop.pyVal ? pyOldValue : Sk.ffi.remapToJs(pyOldValue)
                    );
                }
                return v === undefined ? Sk.builtin.none.none$ : v;
            },
            setPropJS(name, value) {
                Sk.misceval.retryOptionalSuspensionOrThrow(this.setProp(name, Sk.ffi.remapToPy(value)));
            },
            dataBindingWriteback(pyComponent, attrName, pyNewValue) {
                return PyDefUtils.asyncToPromise(() =>
                    raiseWritebackEventOrSuspend(pyComponent, new pyStr(attrName), pyNewValue)
                );
            },

            dataBindingProp: null,
        };

        _anvil.eventHandlers[s_x_anvil_page_added] = [PyDefUtils.funcFastCall(() => _anvil.addedToPage())];
        _anvil.eventHandlers[s_x_anvil_page_removed] = [PyDefUtils.funcFastCall(() => _anvil.removedFromPage())];
        _anvil.eventHandlers[s_x_anvil_page_shown] = [PyDefUtils.funcFastCall(() => _anvil.shownOnPage())];
        _anvil.eventHandlers[s_x_anvil_classic_show] = [
            PyDefUtils.funcFastCall(() => {
                if (_anvil.onPage) {
                    const cbs = getListenerCallbacks(self, "show");
                    if (cbs.length) return chainOrSuspend(null, ...cbs);
                }
                return pyNone;
            }),
        ];
        _anvil.eventHandlers[s_x_anvil_classic_hide] = [
            PyDefUtils.funcFastCall(() => {
                if (!_anvil.onPage) {
                    const cbs = getListenerCallbacks(self, "hide");
                    if (cbs.length) return chainOrSuspend(null, ...cbs);
                }
                return pyNone;
            }),
        ];

        return _anvil;
    }
};

/*
 * TO TEST:
 *
 *  - Methods: set_event_handler, add_event_handler, raise_event, remove_from_parent
 *
 */
