"use strict";

const {
    Args,
    Kws,
    Suspension,
    pyCall,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyList,
    pyObject,
    pyStaticMethod,
    pyStr,
    pyTuple,
    pyTypeError,
    remapToJsOrWrap,
    toJs,
    toPy,
} = require("@Sk");
const { notifyVisibilityChange } = require("./components/Component");
const {
    getMarginStyles,
    getPaddingStyles,
    getUnsetMargin,
    getUnsetPadding,
    getUnsetSpacing,
    getUnsetValue,
    setElementMargin,
    setElementPadding,
    setElementSpacing,
    styleObjectToString,
} = require("./runner/components-in-js/public-api/property-utils");
const { getCssPrefix, hasLegacyDict } = require("./runner/legacy-features");
const { funcFastCall, getImportedModule, kwsToObj, pyTryFinally, s_raise_event, jsObjToKws } = require("./runner/py-util");
const { defer } = require("./utils");

var PyDefUtils = {};

/**
 * A little hack to make a Javascript-implemented Python module
 * This meddles with Skulpt internals and is liable to break.
 * It doesn't handle dotted names
 * 
 * @param {string} name 
 * @param {{[attr: string]: pyObject}} modvars 
 */
PyDefUtils.loadModule = function(name, modvars) {

    const pyModule = new Sk.builtin.module();
    Sk.sysmodules.mp$ass_subscript(new Sk.builtin.str(name), pyModule);
    pyModule.$js = "/* source code not available */";
    pyModule.$d = modvars;

    // If it's a submodule, we assume the parent has already
    // been loaded, and add it as an attribute to the parent
    const dottedSplit = /^(.*)\.([^.]+)$/.exec(name);
    if (dottedSplit) {
        const parent = PyDefUtils.getModule(dottedSplit[1]);
        parent.$d[dottedSplit[2]] = pyModule;
    }
};

// Get a previously-loaded module. Throws exception if not already loaded.
PyDefUtils.getModule = getImportedModule;

PyDefUtils.staticmethod = (pyFunc) => new pyStaticMethod(pyFunc);

PyDefUtils.keywordArrayToHashMap = kwsToObj; 

// Skulpt functions that take keyword arguments must be marked with the
// co_kwargs property, and will receive an array of alternating keys and values
// as their first argument. withKwargs() takes a Javascript function that
// expects a Javascript object of keyword keys/values as its first argument,
// and turns it into the sort of function Skulpt will accept.
PyDefUtils.withKwargs = function (f) {
    var rf = function (pyKwarray, more_function_args) {
        var kwargs = {};
        for (var i = 0; i < pyKwarray.length - 1; i += 2) kwargs[pyKwarray[i].v] = Sk.ffi.remapToJs(pyKwarray[i + 1]);

        return f.apply(this, [kwargs].concat(Array.prototype.slice.call(arguments, 1)));
    };
    rf.co_kwargs = true;
    return rf;
};

PyDefUtils.funcWithKwargs = function (f) {
    return new Sk.builtin.func(PyDefUtils.withKwargs(f));
};

// Sometimes, you don't want the kwargs transformed into Javascript.
// Just mark the function as taking kwargs.
PyDefUtils.withRawKwargs = function (f) {
    f.co_kwargs = true;
    return f;
};

PyDefUtils.funcWithRawKwargsDict = function (f) {
    var rf = function (pyKwarray, more_function_args) {
        const kwargs = PyDefUtils.keywordArrayToHashMap(pyKwarray);
        return f.apply(this, [kwargs].concat(Array.prototype.slice.call(arguments, 1)));
    };
    rf.co_kwargs = true;
    return new Sk.builtin.func(rf);
};


/** @deprecated use funcFastCall from py-util */
PyDefUtils.funcFastCall = funcFastCall;

/** @deprecated use pyCall from Sk module */
PyDefUtils.pyCall = pyCall;

/** @deprecated use pyCallOrSuspend from Sk module */
PyDefUtils.pyCallOrSuspend = pyCallOrSuspend;


// Remap Python to JS, with special handlers for certain types
var pythonifyPath = function(path) {
    var s = "";
    for (var i in path) {
        s += "[" + JSON.stringify(path[i]) + "]";
    }
    return s;
};

// Remap from python to js, extracting all non-JSON-able bits
var remapToJSWithWrapper = function(obj, keySeq, unknownTypeWrapper, firstLookWrapper) {
    if (firstLookWrapper) {
        var w = firstLookWrapper(obj, keySeq);
        if (w !== undefined)
            return w;
    }
    if (obj instanceof Sk.builtin.dict) {
        var ret = {};
        for (var iter = obj.tp$iter(), k = iter.tp$iternext(); k !== undefined; k = iter.tp$iternext()) {

            if (!(k instanceof Sk.builtin.str)) {
                throw new Sk.builtin.TypeError("Cannot use '" + k.tp$name + "' objects as the key in a dict when sending to a server-side module; only string keys are allowed (arguments"+pythonifyPath(keySeq)+")");
            }
            var jsk = Sk.ffi.toJs(k);
            keySeq.push(jsk);
            ret[jsk] = remapToJSWithWrapper(obj.mp$subscript(k), keySeq, unknownTypeWrapper, firstLookWrapper);
            keySeq.pop();
        }
        return ret;
    } else if (obj instanceof Sk.builtin.list || obj instanceof Sk.builtin.tuple) {
        const ret = [];
        for (var i=0; i < obj.v.length; i++) {
            keySeq.push(i);
            ret.push(remapToJSWithWrapper(obj.v[i], keySeq, unknownTypeWrapper, firstLookWrapper));
            keySeq.pop();
        }
        return ret;
    } else if (obj instanceof Sk.builtin.bool) {
        return obj.v ? true : false;
    } else if (obj instanceof Sk.builtin.str) {
        return obj.v;
    } else if (obj instanceof Sk.builtin.int_ || obj instanceof Sk.builtin.float_) {
        return Sk.builtin.asnum$(obj);
    } else if (obj instanceof Sk.builtin.none) {
        return null;
    } else if (typeof obj === "string") {
        return obj;
    } else if (typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype) {
        const ret = {};
        for (let i in obj) {
            keySeq.push(i);
            ret[i] = remapToJSWithWrapper(obj[i], keySeq, unknownTypeWrapper, firstLookWrapper);
            keySeq.pop();
        }
        return ret;
    } else if(obj instanceof Array) {
        const ret = [];
        for (let i=0; i < obj.length; i++) {
            keySeq.push(i);
            ret.push(remapToJSWithWrapper(obj[i], keySeq, unknownTypeWrapper, firstLookWrapper));
            keySeq.pop();
        }
        return ret;
    } else {
        // Not JSONable
        const w = unknownTypeWrapper(obj, keySeq);
        if (w === undefined) {
            throw new Sk.builtin.Exception("Cannot accept '" + ((obj && obj.tp$name) ? obj.tp$name : typeof(obj)) + "' object here (x" + pythonifyPath(keySeq) + ")");
        }
        return w;
    }
};

PyDefUtils.remapToJs = function(pyObj, unknownTypeWrapper, firstLookWrapper) {
    return remapToJSWithWrapper(pyObj, [], unknownTypeWrapper, firstLookWrapper);
}

const getInheritedEventsTypes = (events, baseEvents) => {
    if (!events) return;
    baseEvents ??= {};
    const eventTypes = { ...baseEvents };
    events.forEach((event) => {
        eventTypes[event.name] = event;
    });
    return eventTypes;
};

/** Should only be used for classic components */
PyDefUtils.mkComponentCls = function mkComponentCls(anvilModule, name, params) {
    let { base, properties, events, layouts, element, locals, kwargs, slots=true } = params;

    // used by ClassicComponent __init_subclass__
    kwargs ??= [];
    kwargs.push("_anvil_classic", { properties, events, element, layouts });

    let bases;
    base ??= anvilModule["ClassicComponent"];
    if (Array.isArray(base)) {
        bases = base;
    } else {
        bases = [base];
    }

    events ??= [];
    properties ??= [];
    locals ??= () => {};


    const ComponentCls = Sk.misceval.buildClass(
        anvilModule,
        ($gbl, $loc) => {
            if (slots && !hasLegacyDict()) {
                $loc.__slots__ = new pyList();
            }
            locals($loc);
            PyDefUtils.mkGettersSetters($loc, properties, anvilModule);
        },
        name,
        bases,
        undefined,
        kwargs
    );

    return ComponentCls;
};


PyDefUtils.mkNew = (superClass, callback) => {

    const superNew = Sk.abstr.typeLookup(superClass, Sk.builtin.str.$new);

    return PyDefUtils.funcFastCall(function __new__(args, kwargs) {
        let self = PyDefUtils.pyCallOrSuspend(superNew, args, kwargs);
        return Sk.misceval.chain(
            self,
            (s) => {
                self = s;
                return callback ? callback(self) : null;
            },
            () => self
        );
    });
};

PyDefUtils.mkGettersSetters = function mkGettersSetters($loc, properties, anvilModule) {
    (properties || []).forEach((prop) => {
        $loc[prop.name] = PyDefUtils.pyCall(anvilModule["ComponentProperty"], [prop.name]);
    });
}

/** Called by ClassicComponent.__init_subclass__ */
PyDefUtils.initClassicComponentClassPrototype = function (cls, options = {}) {
    const { properties = [], events, element: Element, layouts: layoutProperties } = options;

    const clsProto = cls.prototype;

    const inheritedDefaults = clsProto._anvilClassic$propDefaults || {};
    const inheritedPropMap = clsProto._anvilClassic$propMap || {};
    const inheritedPropTypes = clsProto._anvilClassic$propTypes || [];
    const inheritedEvents = clsProto._anvilClassic$eventTypes || {};
    const inheritedLayouts = clsProto._anvilClassic$layoutProps || [];
    let propToBind = clsProto._anvilClassic$dataBindingProps;

    const propMap = {};
    // create a copy
    // some design elements directly manipulate the prototype propMap
    // and we use the properties to override the prop map.
    Object.entries(inheritedPropMap).forEach(([name, entry]) => {
        propMap[name] = { ...entry };
    });
    const propTypes = [...inheritedPropTypes];

    properties.forEach((entry) => {
        const { name, type, description, group, dataBindingProp } = entry;
        propMap[name] = { ...entry };
        const propType = { name, type, description, group };
        [
            "options",
            "nullable",
            "multiline",
            "important",
            "priority",
            "hidden",
            "deprecated",
            "deprecateFromRuntimeVersion",
            "pyVal",
            "hideFromDesigner",
            "allowBindingWriteback",
            "showInDesignerWhen",
            "inlineEditElement",
            "designerHint",
            "iconsets",
            "allowCustomValue",
            "accept",
        ].forEach((prop) => {
            if (entry[prop]) {
                propType[prop] = entry[prop];
            }
        });
        const i = propTypes.findIndex((item) => item.name === name);
        if (i === -1) {
            propTypes.push(propType);
        } else {
            propTypes[i] = propType;
        }
        if (dataBindingProp) {
            propToBind = name;
        }
    });

    const propsToInit = Object.keys(propMap).filter((key) => propMap[key].initialize);

    const eventTypes = getInheritedEventsTypes(events, inheritedEvents);
    let layoutPropTypes;
    if (layoutProperties) {
        layoutPropTypes = [...inheritedLayouts];
        layoutPropTypes.push(...layoutProperties);
    }

    const propDefaults = Object.assign(
        {},
        inheritedDefaults,
        Object.fromEntries(properties.filter((prop) => !prop.readOnly).map((prop) => [prop.name, prop.defaultValue]))
    );

    Object.defineProperties(clsProto, {
        _anvilClassic$propDefaults: {
            value: propDefaults,
            writable: true,
        },
        _anvilClassic$propMap: {
            value: propMap,
            writable: true,
        },
        _anvilClassic$propTypes: {
            value: propTypes,
            writable: true,
        },
        _anvilClassic$propsToInitialize: {
            value: propsToInit,
            writable: true,
        },
    });
    if (eventTypes) {
        Object.defineProperty(clsProto, "_anvilClassic$eventTypes", {
            value: eventTypes,
            writable: true,
        });
    }
    if (Element) {
        Object.defineProperty(clsProto, "_anvilClassic$createElement", {
            value: (props) => <Element {...props} />,
            writable: true,
        });
    }
    if (layoutProperties) {
        Object.defineProperty(clsProto, "_anvilClassic$layoutProps", {
            value: layoutPropTypes,
            writable: true,
        });
    }
    if (propToBind) {
        Object.defineProperty(clsProto, "_anvilClassic$dataBindingProps", {
            value: propToBind,
            writable: true,
        });
    }
};    


const appendChild = (parent, child, def) => {
    if (Array.isArray(child)) {
        child.forEach((nestedChild) => appendChild(parent, nestedChild, def));
    } else if (typeof child === "string") {
        child = document.createTextNode(child);
        parent.appendChild(child);
    } else {
        const [childEl, childDef] = child;
        parent.appendChild(childEl);
        Object.assign(def, childDef);
    }
};

PyDefUtils.h = PyDefUtils.createElement = function createElement (tag, _props, ..._children) {
    if (typeof tag === "function") {
        return tag(_props, ..._children);
    }
    const {refName, children, style, className, innerHTML, ...props} = _props || {};
    const element = document.createElement(tag);
    const def = { [refName]: element };
    _children = children || _children;

    if (style) {
        element.style.cssText = style;
    }
    if (className) {
        element.className = className;
    }
    if (innerHTML) {
        element.innerHTML = innerHTML;
    }

    Object.keys(props).forEach((propName) => {
        const propValue = props[propName];
        if (propName === "value") {
            element.value = propValue;
        } else {
            element.setAttribute(propName, propValue == null ? propValue : propValue.toString() );
        }
    });

    _children.forEach((child) => {
        if (typeof child === "string" || typeof child === "number") {
            element.appendChild(document.createTextNode(child));
        } else if (child === true || !child) {
            // pass
        } else {
            const [childEl, childDef] = child;
            element.appendChild(childEl);
            Object.assign(def, childDef);
        }
    });

    return [element, def];
};

// useful helper - used by auth.js files so needs to be accessible via window
PyDefUtils.defer = defer;

PyDefUtils.suspensionFromPromise = function(p) {
    var newSuspension = new Sk.misceval.Suspension();
    newSuspension.resume = function() {
        // Need to allow resolving to undefined or null here, so anything that isn't an error is a result:
        if (newSuspension.data.error) {
            throw newSuspension.data.error;
        } else {
            return newSuspension.data.result;
        }
    }
    newSuspension.data = {type: "Sk.promise", promise: p};

    return newSuspension;
}

/** @param {ConstructorParameters<PromiseConstructor>[0]} fn */
PyDefUtils.suspensionPromise = function(fn) {
    var p = new Promise(fn);
    return PyDefUtils.suspensionFromPromise(p);
}

/** @type {{[suspensionType: string]: (s: Suspension) => (Promise<any> | null | undefined | void)}} */
PyDefUtils.suspensionHandlers = {
    timer: function(r) {
        return new Promise(function(resolve, reject) {
            setTimeout(function() {
                resolve(r.resume());
            }, r.data["delay"]*1000);
        });
    }
};


PyDefUtils.callAsyncWithoutDefaultError = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(PyDefUtils.suspensionHandlers);
    return Sk.misceval.callAsync.apply(null, args);
};

/**
 * @template {pyObject} T
 * @param {pyObject | pyCallable<pyObject | Suspension>} func
 * @param {pyDict=} kwDict
 * @param {pyTuple=} varargseq
 * @param {Kws=} kws
 * @param {Args} args
 * @returns {Promise<T>}
 */
PyDefUtils.callAsync = (func, kwDict, varargseq, kws, ...args) =>
    Sk.misceval.callAsync(PyDefUtils.suspensionHandlers, func, kwDict, varargseq, kws, ...args).catch((e) => {
        // unhandled errors are caught by window.onunhandledrejection
        throw e;
    });

// When we internally call asyncToPromise,
// we ignore the first optional supsension
// this is perfect for event handlers that may have not fired since the previous Sk.lastYield
// otherwise handlers may immediately throw an optional Sk.yield suspension (if Sk.yieldLimit is configured)
//
// Note we could continue to resume optional suspensions in a while loop
// (see WrappedPyCallable)
// but since the next optional suspension we hit
// will be the result of long running code we only ignore the first one.
function ignoreFirstOptionalSuspension(susp) {
    // TODO: Work out whether this will affect optional debug suspensions
    if (susp instanceof Sk.misceval.Suspension && susp.optional && susp.data.type !== "Sk.debug") {
        susp = susp.resume();
    }
    return susp;
}

// This is really "suspensionToPromise."
/**
 * @template T
 * @param {() => T | Suspension} fn 
 * @returns {Promise<T>}
 */
PyDefUtils.asyncToPromise = (fn) => {
    const suspendablefn = () => ignoreFirstOptionalSuspension(fn());
    return Sk.misceval.asyncToPromise(suspendablefn, PyDefUtils.suspensionHandlers).catch((e) => {
        // unhandled errors are caught by window.onunhandledrejection
        throw e;
    });
};

// CLASSIC COMPONENTS ONLY:
// Raise the named event with the specified arguments
// (expects a Javascript object as first parameter, keys are JS, vals are Python if pyVal is true, otherwise JS.
/** @deprecated */
PyDefUtils.raiseEventOrSuspend = function(eventArgs, self, eventName) {
    return pyCallOrSuspend(self.tp$getattr(s_raise_event), [new pyStr(eventName)], jsObjToKws(eventArgs));
};

PyDefUtils.raiseEventAsync = function(eventArgs, self, eventName) {
    return PyDefUtils.asyncToPromise(() => PyDefUtils.raiseEventOrSuspend(eventArgs, self, eventName));
};

PyDefUtils.whileOrSuspend = function(testFn, bodyFn, elseFn) {
    function gotBodyReturn(bodyRet) {
        if (bodyRet instanceof Sk.misceval.Suspension) {
            return new Sk.misceval.Suspension(gotBodyReturn, bodyRet);
        }

        if (bodyRet === Sk.misceval.Break || bodyRet instanceof Sk.misceval.Break) {
            return bodyRet.brValue; // We're done!
        }

        // We're done with this iteration
        return gotTestResult(testFn());
    }

    function gotTestResult(testResult) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (testResult instanceof Sk.misceval.Suspension) {
                return new Sk.misceval.Suspension(gotTestResult, testResult);
            }

            if (!testResult) { return elseFn ? elseFn() : undefined; } // We're done!

            var bodyRet = bodyFn();

            if (bodyRet instanceof Sk.misceval.Suspension) {
                return new Sk.misceval.Suspension(gotBodyReturn, bodyRet);
            }

            if (bodyRet === Sk.misceval.Break || bodyRet instanceof Sk.misceval.Break) {
                return bodyRet.brValue; // We're done!
            }

            testResult = testFn();
        }
    }

    return gotTestResult(testFn());
};

PyDefUtils.mapSetter = function(name, remapFn) {
    return function(s,e,v) {
        var m = {};
        m[name] = remapFn ? remapFn(v) : v;
        s._jsVal.setOptions(m);
    }
}
PyDefUtils.mapGetter = function(name, remapFn) {
    return function(s,e) {
        let getter = s._jsVal[name];
        if (getter) {
            let v = getter.call(s._jsVal);
            return remapFn ? remapFn(v) : v;
        }
    }
}


PyDefUtils.setAttrsFromDict = function (obj, dict) {
    let items = dict.tp$getattr(new Sk.builtin.str("items"));
    return Sk.misceval.iterFor(Sk.abstr.iter(Sk.misceval.call(items)),
        (pyItem) => obj.tp$setattr(pyItem.v[0], pyItem.v[1], true));
}

// Temporary, to get form init half-working enough to test layouts: Separate this out so it will work with
// buildNativeClass
PyDefUtils.mkNewDeserializedPreservingIdentityInner = (deserialize, newFn) => (cls, pyData, pyGlobals) => {
    let pyClsname = new Sk.builtin.str(cls.anvil$serializableName);
    // JS object in a Python dict - the outside world should never see it
    let jsCache;
    try {
        jsCache = pyGlobals.mp$subscript(pyClsname);
        //console.log("Cache hit for", pyClsname.v, "in", Sk.builtin.repr(pyGlobals));
    } catch(e) {
        //console.log("Cache miss for", pyClsname.v, "in", Sk.builtin.repr(pyGlobals));
        jsCache = {}
        pyGlobals.mp$ass_subscript(pyClsname, jsCache);
        //console.log("New cache:", Sk.builtin.repr(pyGlobals));
    }
    let myId = pyData.v[0].v;
    let obj = jsCache[myId];
    if (!obj) {
        //console.log("Constructing a fresh", cls.tp$name);
        obj = jsCache[myId] = newFn ? newFn(cls) : Sk.misceval.callsim(cls);
    }

    if (pyData.v.length <= 1) {
        //console.log("Returning from cache:", cls.tp$name);
        return obj;
    } else if (deserialize) {
        //console.log("Custom deserializing", cls.tp$name);
        return Sk.misceval.chain(deserialize(obj, pyData.v[1], pyGlobals), () => obj);
    } else {
        //console.log("Default deserializing", cls.tp$name);
        return Sk.misceval.chain(PyDefUtils.setAttrsFromDict(obj, pyData.v[1]), () => obj);
    }
};

PyDefUtils.mkNewDeserializedPreservingIdentity = function(deserialize, newFn) {
    return new Sk.builtin.classmethod(new Sk.builtin.func(PyDefUtils.mkNewDeserializedPreservingIdentityInner(deserialize, newFn)));
};

// ClassicComponent ONLY
PyDefUtils.mkSerializePreservingIdentityInner = (serialize) => (self, pyGlobals) => {
    let lsk = self._anvil.$lastSerialKey;
    if (lsk && lsk.pyGlobals === pyGlobals) { return new Sk.builtin.list([lsk.pyId]); }

    let clsname = self.constructor.anvil$serializableName;
    let pyMaxKey = new Sk.builtin.str(clsname+"_max");
    let pyMyId;
    try {
        pyMyId = pyGlobals.mp$subscript(pyMaxKey);
    } catch (e) {
        pyMyId = new Sk.builtin.int_(0);
    }
    pyGlobals.mp$ass_subscript(pyMaxKey, new Sk.builtin.int_(pyMyId.v+1));

    self._anvil.$lastSerialKey = {pyId: pyMyId, pyGlobals: pyGlobals};

    let val = serialize ? serialize(self) : (Sk.abstr.lookupSpecial(self, Sk.builtin.str.$dict) ?? new pyDict());
    return Sk.misceval.chain(val, (val) =>  new Sk.builtin.list([pyMyId, val]));
};

// ClassicComponent ONLY
PyDefUtils.mkSerializePreservingIdentity = function(serialize) {
    return new Sk.builtin.func(PyDefUtils.mkSerializePreservingIdentityInner(serialize));
};

const { isTrue } = Sk.misceval;

PyDefUtils.getOuterClass = function getOuterClass({
    align,
    icon,
    icon_align,
    role,
    spacing_above,
    spacing_below,
    text,
    visible,
}) {
    const prefix = getCssPrefix();
    const classList = [];
    const spacing = ["none", "small", "medium", "large"];

    if (isTrue(align) && ["center", "right", "left"].includes(align.toString())) {
        classList.push("align-" + align.toString());
    }
    if (isTrue(spacing_above) && spacing.includes(spacing_above.toString())) {
        classList.push("anvil-spacing-above-" + spacing_above.toString());
    }
    if (isTrue(spacing_below) && spacing.includes(spacing_below.toString())) {
        classList.push("anvil-spacing-below-" + spacing_below.toString());
    }
    if (isTrue(icon)) {
        classList.push("anvil-component-icon-present");
    }
    if (isTrue(icon_align)) {
        classList.push(icon_align + "-icon");
    }
    if (visible !== undefined && !isTrue(visible)) {
        classList.push(prefix + "visible-false");
    }
    if (isTrue(role)) {
        for (let r of PyDefUtils.applyRole(role)) {
            classList.push("anvil-role-" + r);
        }
    }
    if (isTrue(text)) {
        classList.push(prefix + "has-text");
    }
    return classList.join(" ");
}

const hasUnits = /[a-zA-Z%]/g
PyDefUtils.cssLength = (len) => (len === "default" || !len ? "" : ("" + len).match(hasUnits) ? len : len + "px");

const ROLE_REGEX = /[^A-Za-z0-9_-]/g

/** Cleans roles for css and returns the roles as list of strings. If a domNode is provided the classList and anvil-role attribute is updated. */
PyDefUtils.applyRole = (role, domNode = null) => {
    // get all the classes that that are not anvil-roles
    role = Sk.ffi.toJs(role);

    const newRoles = [];

    if (role === null) {
        // pass
    } else if (Array.isArray(role)) {
        for (let r of role) {
            if (!(typeof r === "string")) {
                throw new Sk.builtin.TypeError("role must be None, a string, or a list of strings");
            }
            newRoles.push(r.replace(ROLE_REGEX, ""));
        }
    } else if (typeof role === "string") {
        newRoles.push(role.replace(ROLE_REGEX, ""));
    } else {
        throw new Sk.builtin.TypeError("role must be None, a string, or a list of strings");
    }

    if (domNode !== null) {
        const hasPrevRoles = domNode.getAttribute("anvil-role") !== null;
        const hasNewRoles = newRoles.length !== 0;
        if (hasNewRoles && !hasPrevRoles) {
            domNode.setAttribute("anvil-role", newRoles.join(" "));
            domNode.className = domNode.className + " anvil-role-" + newRoles.join(" anvil-role-");
        } else if (hasNewRoles) {
            domNode.setAttribute("anvil-role", newRoles.join(" "));
            domNode.className =
                Array.prototype.filter.call(domNode.classList, (c) => !c.startsWith("anvil-role-")).join(" ") +
                " anvil-role-" +
                newRoles.join(" anvil-role-");
        } else if (hasPrevRoles) {
            domNode.removeAttribute("anvil-role");
            domNode.className = Array.prototype.filter
                .call(domNode.classList, (c) => !c.startsWith("anvil-role-"))
                .join(" ");
        } else {
            // nothing to do - no roles to add and no roles to remove;
        }
    }

    return newRoles;
};

PyDefUtils.getColor = (v) => {
    v = Sk.builtin.checkNone(v) ? "" : v.toString();
    const m = v.match(/^theme:(.*)$/);
    if (!m) {
        return v;
    } else {
        const cssVar = window.anvilThemeVars[m[1]];
        return cssVar ? `var(${cssVar})` : "";
    }
};

/**
 * 
 * @param {string} url 
 * @param {() => void} [onload] 
 * @returns {Promise}
 */
PyDefUtils.loadScript = (url, onload) => {
    const script = document.createElement("script");
    script.src = url;
    const p = new Promise((resolve, reject) => {
        script.onload = () => {
            resolve(null);
            onload?.();
        };
        script.onerror = reject;
    });
    document.body.appendChild(script);
    return p;
};

PyDefUtils.getPaddingStyle = function getPaddingStyle({padding, spacing}) {
    const style = {};

    if (isTrue(padding)) {
        Object.assign(style, getPaddingStyles(toJs(padding)));
    } else if (isTrue(spacing)) {
        const p = toJs(spacing).padding;
        if (p) {
            Object.assign(style, getPaddingStyles(p));
        }
    }

    return styleObjectToString(style);
};

PyDefUtils.getOuterStyle = function getOuterStyle({ align, font_size, font, bold, italic, underline, background, foreground, border, border_radius, height, width, spacing, margin, padding }, includePadding = true) {
    const style = {};
    if (isTrue(align)) {
        style["text-align"] = align.toString();
    }
    font_size = Sk.ffi.remapToJs(font_size); // skulpt behaviour only accepts number types for font_size
    if (typeof font_size === "number") {
        style["font-size"] = font_size + "px";
    }
    if (isTrue(font)) {
        style["font-family"] = font.toString();
    }
    if (isTrue(bold)) {
        style["font-weight"] = "bold";
    }
    if (isTrue(italic)) {
        style["font-style"] = "italic";
    }
    if (isTrue(underline)) {
        style["text-decoration"] = "underline";
    }
    if (isTrue(background)) {
        style["background-color"] = PyDefUtils.getColor(background);
    }
    if (isTrue(foreground)) {
        style["color"] = PyDefUtils.getColor(foreground);
    }
    if (isTrue(border)) {
        style["border"] = border.toString();
    }
    if (isTrue(border_radius)) {
        style["border-radius"] = PyDefUtils.cssLength(border_radius.toString());
    }
    if (isTrue(height)) {
        style["height"] = PyDefUtils.cssLength(height.toString()); 
    }
    if (isTrue(width)) {
        style["width"] = PyDefUtils.cssLength(width.toString());
    }

    if (isTrue(spacing)) {
        const jsSpacing = toJs(spacing);
        if (jsSpacing.margin) {
            Object.assign(style, getMarginStyles(jsSpacing.margin));
        }
        if (includePadding && jsSpacing.padding) {
            Object.assign(style, getPaddingStyles(jsSpacing.padding));
        }
    } else {
        if (isTrue(margin)) {
            Object.assign(style, getMarginStyles(toJs(margin)));
        }
        if (includePadding && isTrue(padding)) {
            Object.assign(style, getPaddingStyles(toJs(padding)));
        }
    }

    return styleObjectToString(style);
};

PyDefUtils.getOuterAttrs = function getOuterAttrs ({tooltip, source, role, enabled}) {
    const attrs = {};
    if (isTrue(tooltip)) {
        attrs["title"] = tooltip.toString();
    }
    if (isTrue(source)) {
        attrs["src"] = source.toString();
    }
    if (isTrue(role)) {
        const roles = PyDefUtils.applyRole(role);
        attrs["anvil-role"] = roles.join(" ");
    }
    if (enabled !== undefined && !isTrue(enabled)) {
        attrs["disabled"] = ""; // we currently add this to the outer div so do it here too
    }
    return attrs;
}


PyDefUtils.IconComponent = ({side, icon, icon_align}) => {
    side = side ? side.toString() : "";
    let iconClass = "";
    let img = false;
    if (isTrue(icon)) {
        icon = icon.toString();
        const faclass = icon.split(":");
        if (faclass.length === 2 && faclass[0].startsWith("fa")) {
            iconClass = faclass[0] + " fa-" + faclass[1];
        } 
        else {
            img = true;
        }
    } 
    const refName = "icon" + side[0].toUpperCase() + side.slice(1);
    const prefix = getCssPrefix();
    icon_align = isTrue(icon_align) ? prefix + icon_align.toString() + "-icon" : "";
    side = prefix + side;
    if (img) {
        return (
            <i refName={refName} className={`anvil-component-icon ${side} ${icon_align}`}>
                <img src={icon} style="height: 1em; vertical-align: text-bottom;" />
            </i>
        );
    }
    return <i refName={refName} className={`anvil-component-icon ${side} ${iconClass} ${icon_align}`}/>;
}

PyDefUtils.OuterElement = ({refName, includePadding=true, style, className, ...props}, ...children) => {
    const outerClass = PyDefUtils.getOuterClass(props) + (className ? " " + className : "");
    const outerStyle = PyDefUtils.getOuterStyle(props, includePadding) + (style ? " " + style : "");
    const outerAttrs = PyDefUtils.getOuterAttrs(props);
    return (
        <div refName={refName || "outer"} className={outerClass} style={outerStyle} {...outerAttrs} children={children}/>
    );

};



/*!propGroups()!1*/
var propertyGroups = {
    text: {
        text: {
            name: "text",
            type: "string",
            description: "The text displayed on this component",
            defaultValue: Sk.builtin.str.$empty,
            exampleValue: "Hello",
            important: true,
            pyVal: true,
            priority: 10,
            set(s, e, v) {
                v = Sk.builtin.checkNone(v) ? "" : v.toString();
                const prefix = getCssPrefix();
                const {outer, text} = s._anvil.elements;
                outer.classList.toggle(prefix + "has-text", !!v);
                text.textContent = v;
            },
        },
        align: {
            name: "align",
            type: "enum",
            options: ["left", "center", "right"],
            description: "Align this component's text",
            defaultValue: new Sk.builtin.str("left"),
            designerHint: 'align-horizontal',
            pyVal: true,
            set(s, e, v) {
                v = v.toString();
                const domNode = s._anvil.domNode;
                const prefix = getCssPrefix();
                domNode.classList.remove(prefix + "align-left", prefix + "align-center", prefix + "align-right");
                domNode.style.textAlign = v;
                if (["left", "center", "right"].includes(v)) {
                    domNode.classList.add(prefix + "align-" + v);
                }
            },
        },
        font_size: {
            name: "font_size",
            type: "number",
            nullable: true,
            description: "The height of text displayed on this component in pixels",
            defaultValue: Sk.builtin.none.none$,
            pyVal: true,
            exampleValue: 16,
            set(s, e, v) {
                v = Sk.ffi.remapToJs(v);
                e.css("font-size", typeof v === "number" ? v + "px" : "");
            },
            getUnset(s, e, currentValue) {
                const el = e[0];
                const jsVal = toJs(currentValue);
                if (jsVal === null || jsVal === undefined || jsVal === "") {
                    return getUnsetValue(el, "font-size");
                }
            },
        },
        font: {
            name: "font",
            type: "string",
            description: "The font to use for this component.",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            exampleValue: "Arial",
            set(s, e, v) {
                e.css("font-family", v.toString());
            },
        },
        bold: {
            name: "bold",
            type: "boolean",
            description: "Display this component's text in bold",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            exampleValue: true,
            designerHint: 'font-bold',
            set(s, e, v) {
                e.css("font-weight", isTrue(v) ? "bold" : "");
            },
        },
        italic: {
            name: "italic",
            type: "boolean",
            description: "Display this component's text in italics",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            exampleValue: true,
            designerHint: 'font-italic',
            set(s, e, v) {
                e.css("font-style", isTrue(v) ? "italic" : "");
            },
        },
        underline: {
            name: "underline",
            type: "boolean",
            description: "Display this component's text underlined",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            exampleValue: true,
            designerHint: 'font-underline',
            set(s, e, v) {
                e.add(e.children("span, div")).css("text-decoration", isTrue(v) ? "underline" : "");
            },
        },
    },

    icon: {
        icon: {
            name: "icon",
            type: "icon",

            iconsets: ["font-awesome-4.7.0"],

            defaultValue: Sk.builtin.str.$empty,
            exampleValue: "fa:user",
            description: "The icon to display on this component. Either a URL, or a FontAwesome Icon, e.g. 'fa:user'.",
            pyVal: true,
            important: true,
            set(s, e, v) {
                e.removeClass("anvil-component-icon-present");
                const elements = s._anvil.elements;
                let addIcon = () => {};
                if (v instanceof Sk.builtin.str) {
                    v = v.toString();
                    if (v) {
                        const faclass = v.split(":");
                        if (faclass.length === 2 && faclass[0].startsWith("fa")) {
                            addIcon = (i) => {
                                i.classList.add(faclass[0]); // IE doesn't support classList.add(...args)
                                i.classList.add("fa-" + faclass[1])
                            };
                        } else {
                            addIcon = (i) => {
                                const img = document.createElement("img");
                                img.src = v;
                                img.style.cssText = "height: 1em; vertical-align: text-bottom;";
                                i.appendChild(img);
                            };
                        }
                        e.addClass("anvil-component-icon-present");
                    }
                } else {
                    // console.log(v);
                }

                const iconKeys = Object.keys(elements).filter((key) => key.startsWith("icon"));

                iconKeys.forEach((key) => {
                    const i = elements[key];
                    i.className = i.className.split(" ").filter((x) => !x.startsWith("fa")).join(" ");
                    while (i.firstChild) {
                        i.removeChild(i.firstChild); // equiv of i.empty;
                    }
                    addIcon(i);
                });
            },
        },
        icon_align: {
            name: "icon_align",
            description: "The alignment of the icon on this component. Set to 'top' for a centred icon on a component with no text.",
            type: "enum",
            defaultValue: new Sk.builtin.str("left"),
            pyVal: true,
            options: ["left_edge", "left", "top", "right", "right_edge"],
            set(s, e, v) {
                const prefix = getCssPrefix();
                const remove = ["right_edge", "left_edge", "top", "right", "left"]
                    .map((x) => prefix + x + "-icon");
                
                const domNode = s._anvil.domNode;

                domNode.classList.remove(...remove);
                let iconElements = e.find(".anvil-component-icon").filter(function () {
                    let parentComponent = $(this).closest(".anvil-component");
                    return parentComponent.length == 0 || parentComponent[0] == e[0];
                });
                iconElements.removeClass(remove);

                e.addClass(prefix + v + "-icon");
                iconElements.addClass(prefix + v + "-icon");
            },
        },
    },

    align: {
        align: {
            name: "align",
            type: "enum",
            options: ["left", "center", "right"],
            description: "Align this component's content",
            defaultValue: new Sk.builtin.str("center"),
            set(s, e, v) {
                e.css("text-align", v.toString());
            },
            important: true,
        },
    },

    appearance: {
        background: {
            name: "background",
            type: "color",
            description: "The background colour of this component.",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            exampleValue: "#ff0000",
            designerHint: 'background-color',
            set(s, e, v) {
                s._anvil.domNode.style.backgroundColor = PyDefUtils.getColor(v);
            },
        },
        foreground: {
            name: "foreground",
            type: "color",
            description: "The foreground colour of this component.",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            exampleValue: "#ff0000",
            designerHint: 'foreground-color',
            set(s, e, v) {
                s._anvil.domNode.style.color = PyDefUtils.getColor(v);
            },
        },
        border: {
            name: "border",
            type: "string",
            description: "The border of this component. Can take any valid CSS border value.",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            exampleValue: "1px solid #888888",
            designerHint: 'border',
            set(s, e, v) {
                e.css("border", isTrue(v) ? v.toString() : "");
            },
        },
        visible: {
            name: "visible",
            important: true,
            type: "boolean",
            description: "Should this component be displayed?",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            exampleValue: false,
            designerHint: 'visible',
            set(s, e, v) {
                // Don't just set "display" property - this needs to behave differently in
                // designer and runner.
                const visible = isTrue(v);
                e.toggleClass(getCssPrefix() + "visible-false", !visible);
                return notifyVisibilityChange(s, visible);
            },
        },
        role: {
            name: "role",
            important: false,
            type: "themeRole",
            description: "Choose how this component can appear, based on your app's visual theme.",
            defaultValue: Sk.builtin.none.none$,
            pyVal: true,
            exampleValue: "title",
            set(s, e, v) {
                PyDefUtils.applyRole(v, s._anvil.domNode);
            },
        },
    },

    visibility: {
        visible: {
            name: "visible",
            important: true,
            type: "boolean",
            description: "Should this component be displayed?",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            exampleValue: false,
            designerHint: 'visible',
            set(s, e, v) {
                // Don't just set "display" property - this needs to behave differently in
                // designer and runner.
                const visible = isTrue(v);
                e.toggleClass(getCssPrefix() + "visible-false", !visible);
                return notifyVisibilityChange(s, visible);
            },
        },
    },

    interaction: {
        enabled: {
            name: "enabled",
            important: true,
            type: "boolean",
            description: "True if this component should allow user interaction.",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            exampleValue: false,
            designerHint: 'enabled',
            set(s, e, v) {
                const domNode = s._anvil.domNode;
                const prefix = getCssPrefix();
                const toDisable = domNode.querySelector(`.${prefix}to-disable`);
                if (!isTrue(v)) {
                    domNode.setAttribute("disabled", "");
                    if (toDisable !== null) {
                       toDisable.setAttribute("disabled", ""); 
                    }
                } else {
                    domNode.removeAttribute("disabled");
                    if (toDisable !== null) {
                        toDisable.removeAttribute("disabled"); 
                    } 
                }
            },
        },
    },

    height: {
        height: {
            name: "height",
            type: "string",
            defaultValue: Sk.builtin.str.$empty,
            exampleValue: new Sk.builtin.str("100"),
            description: "The height of this component.",
            pyVal: true,
            set(s, e, v) {
                e.css("height", PyDefUtils.cssLength(v.toString()));
            },
        },
    },

    layout: {
        width: {
            name: "width",
            type: "string",
            defaultValue: new Sk.builtin.str("default"),
            pyVal: true,
            description: 'The width of this {{component}}, or "default" to have the width set by the container.',
            deprecated: true,
            set(s, e, v) {
                e.css("width", PyDefUtils.cssLength(v.toString()));
            },
        },

        spacing_above: {
            name: "spacing_above",
            type: "enum",
            options: ["none", "small", "medium", "large"],
            defaultValue: new Sk.builtin.str("small"),
            pyVal: true,
            deprecateFromRuntimeV3: true, // Once you have margins, this is no longer needed. But we can't remove it entirely, because people might have used it. Hide from designer, allow override via margin property.
            description: "The vertical space above this component.",
            set(s, e, v) {
                v = v.toString();
                var vals = ["none", "small", "medium", "large"];
                for (var i = 0; i < vals.length; i++) {
                    var cls = "anvil-spacing-above-" + vals[i];
                    if (v == vals[i]) {
                        e.addClass(cls);
                    } else {
                        e.removeClass(cls);
                    }
                }
            },
        },
        spacing_below: {
            name: "spacing_below",
            type: "enum",
            options: ["none", "small", "medium", "large"],
            defaultValue: new Sk.builtin.str("small"),
            pyVal: true,
            deprecateFromRuntimeV3: true, // Once you have margins, this is no longer needed. But we can't remove it entirely, because people might have used it. Hide from designer, allow override via margin property.
            description: "The vertical space below this component.",
            set(s, e, v) {
                v = v.toString();
                var vals = ["none", "small", "medium", "large"];
                for (var i = 0; i < vals.length; i++) {
                    var cls = "anvil-spacing-below-" + vals[i];
                    if (v == vals[i]) {
                        e.addClass(cls);
                    } else {
                        e.removeClass(cls);
                    }
                }
            },
        },
    },

    layout_spacing: {
        spacing: {
            group: "layout", // Override group for this property
            name: "spacing",
            type: "spacing",
            description: "Margin and padding for this container. Only available in apps that have been migrated to use Layouts.",
            defaultValue: Sk.builtin.none.none$,
            important: true,
            priority: 0,
            set(s, e, v) {
                setElementSpacing(e[0], v);
            },
            getUnset(s, e, currentValue) {
                return getUnsetSpacing(e[0], e[0], currentValue);
            },
        }
    },

    layout_margin: {
        margin: {
            group: "layout", // Override group for this property
            name: "margin",
            type: "margin",
            description: "Margin for this component. Only available in apps that have been migrated to use Layouts.",
            defaultValue: Sk.builtin.none.none$,
            important: true,
            priority: 0,
            set(s, e, v) {
                setElementMargin(e[0], v);
            },
            getUnset(s, e, v) {
                return getUnsetMargin(e[0], v);
            },
        }
    },

    layout_padding: {
        padding: {
            group: "layout", // Override group for this property
            name: "padding",
            type: "padding",
            description: "Padding for this component. Only available in apps that have been migrated to use Layouts.",
            defaultValue: Sk.builtin.none.none$,
            important: true,
            priority: 0,
            set(s, e, v) {
                setElementPadding(e[0], v);
            },
            getUnset(s, e, v) {
                return getUnsetPadding(e[0], v);
            },
        }
    },

    containers: {
        row_spacing: {
            name: "row_spacing",
            deprecated: true,
            important: true,
            priority: 9,
            type: "number",
            description: "The spacing between rows of components in this container, in pixels.",
            defaultValue: new Sk.builtin.int_(10),
            pyVal: true,
        },
    },

    "user data": {
        tag: {
            name: "tag",
            defaultValue: null,
            important: false,
            type: "object",
            description: "Use this property to store any extra information about this component",
        },
    },

    tooltip: {
        tooltip: {
            name: "tooltip",
            important: false,
            type: "string",
            defaultValue: Sk.builtin.str.$empty,
            pyVal: true,
            description: "Text to display when you hover the mouse over this component",
            set(s, e, v) {
                e.attr("title", isTrue(v) ? v.toString() : null);
            },
        },
    },

    mapOverlays: {
        clickable: {
            name: "clickable",
            important: true,
            type: "boolean",
            description: "True if this overlay raises mouse events.",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            mapProp: true,
            set: PyDefUtils.mapSetter("clickable", isTrue),
            get: PyDefUtils.mapGetter("clickable", Sk.builtin.bool),
        },
        draggable: {
            name: "draggable",
            type: "boolean",
            important: true,
            description: "True if this overlay can be dragged.",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            mapProp: true,
            set: PyDefUtils.mapSetter("draggable", isTrue),
            get: PyDefUtils.mapGetter("draggable", Sk.builtin.bool),
        },
        visible: {
            name: "visible",
            type: "boolean",
            important: true,
            description: "True if this overlay should be displayed.",
            defaultValue: Sk.builtin.bool.true$,
            pyVal: true,
            mapProp: true,
            // NB: we don't need to worry about notifying parent of visibility
            // a map overlay can only be a child of a Google Map and it doesn't care
            set: PyDefUtils.mapSetter("visible", isTrue),
            get: PyDefUtils.mapGetter("visible", Sk.builtin.bool),
        },
        z_index: {
            name: "z_index",
            type: "number",
            important: true,
            description: "The z-index compared to other overlays.",
            mapProp: true,
            set: PyDefUtils.mapSetter("zIndex"),
            get: PyDefUtils.mapGetter("zIndex"),
        },
    },

    mapPolyOverlays: {
        editable: {
            name: "editable",
            type: "boolean",
            important: true,
            description: "True if this overlay can be edited by the user.",
            defaultValue: Sk.builtin.bool.false$,
            pyVal: true,
            mapProp: true,
            set: PyDefUtils.mapSetter("editable", isTrue),
        },
        stroke_color: {
            name: "stroke_color",
            type: "string",
            important: true,
            description: "The color to draw the overlay outline.",
            mapProp: true,
            set: PyDefUtils.mapSetter("strokeColor"),
        },
        stroke_opacity: {
            name: "stroke_opacity",
            type: "number",
            important: true,
            description: "The opacity of the overlay outline.",
            mapProp: true,
            set: PyDefUtils.mapSetter("strokeOpacity"),
        },
        stroke_weight: {
            name: "stroke_weight",
            type: "number",
            important: true,
            description: "The weight of the overlay outline",
            mapProp: true,
            set: PyDefUtils.mapSetter("strokeWeight"),
        },
    },

    mapAreaOverlays: {
        stroke_position: {
            name: "stroke_position",
            pyType: "anvil.GoogleMap.StrokePosition",
            important: true,
            description: "The stroke position. Defaults to CENTER.",
            mapProp: true,
            set: PyDefUtils.mapSetter("strokePosition"),
        },
        fill_color: {
            name: "fill_color",
            type: "string",
            important: true,
            description: "The color to draw the overlay outline.",
            mapProp: true,
            set: PyDefUtils.mapSetter("fillColor"),
        },
        fill_opacity: {
            name: "fill_opacity",
            type: "number",
            important: true,
            description: "The opacity of the overlay outline.",
            mapProp: true,
            set: PyDefUtils.mapSetter("fillOpacity"),
        },
    },
};

/*!eventGroups()!1*/
var eventGroups = {

    universal: [
        {name: "show", description: "When the {{component}} is shown on the screen",
         parameters: []
        },
        {name: "hide", description: "When the {{component}} is removed from the screen",
         parameters: []
        }
    ],

    focus: [
        {name: "focus", description: "When the {{component}} gets focus", parameters: []},
        {name: "lost_focus", description: "When the {{component}} loses focus", parameters: []},
    ],

    mouse: [
        {
            name: "mouse_enter",
            description: "When the mouse cursor enters this component",
            parameters: [{
                name: "x",
                description: "The x coordinate of the mouse pointer, within this component",
                important: true,
            }, {
                name: "y",
                description: "The y coordinate of the mouse pointer, within this component",
                important: true,
            }]
        }, {
            name: "mouse_leave",
            description: "When the mouse cursor leaves this component",
            parameters: [{
                name: "x",
                description: "The x coordinate of the mouse pointer relative to this component",
                important: true,
            }, {
                name: "y",
                description: "The y coordinate of the mouse pointer relative to this component",
                important: true,
            }]
        }, {
            name: "mouse_move",
            description: "When the mouse cursor moves over this component",
            parameters: [{
                name: "x",
                description: "The x coordinate of the mouse pointer within this component",
                important: true,
            }, {
                name: "y",
                description: "The y coordinate of the mouse pointer within this component",
                important: true,
            }],
            important: true,
        }, {
            name: "mouse_down",
            description: "When a mouse button is pressed on this component",
            parameters: [{
                name: "x",
                description: "The x coordinate of the mouse pointer within this component",
                important: true,
            }, {
                name: "y",
                description: "The y coordinate of the mouse pointer within this component",
                important: true,
            }, {
                name: "button",
                description: "The button that was pressed (1 = left, 2 = middle, 3 = right)",
                important: true,
            }, {
                name: "keys",
                description:
                    "A dictionary of keys including 'shift', 'alt', 'ctrl', 'meta'. " +
                    "Each key's value is a boolean indicating if it was pressed during the click event. " +
                    "The meta key on a mac is the Command key",
            }],
            important: true,
        }, {
            name: "mouse_up",
            description: "When a mouse button is released on this component",
            parameters: [{
                name: "x",
                description: "The x coordinate of the mouse pointer within this component",
                important: true,
            }, {
                name: "y",
                description: "The y coordinate of the mouse pointer within this component",
                important: true,
            }, {
                name: "button",
                description: "The button that was released (1 = left, 2 = middle, 3 = right)",
                important: true,
            }, {
                name: "keys",
                description:
                    "A dictionary of keys including 'shift', 'alt', 'ctrl', 'meta'. " +
                    "Each key's value is a boolean indicating if it was pressed during the click event. " +
                    "The meta key on a mac is the Command key",
                important: false,
            }],
            important: true,
        }
    ],
    mapOverlays: [
      {name: "click", description: "when an overlay is clicked.",
       parameters: [{
          name: "lat_lng",
          description: "The position that was clicked.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "dblclick", description: "when an overlay is double clicked.",
       parameters: [{
          name: "lat_lng",
          description: "The position that was double-clicked.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "drag", description: "while the user drags an overlay.",
       parameters: [{
          name: "lat_lng",
          description: "The position of the cursor.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "dragend", description: "when the user stops dragging an overlay.",
       parameters: [{
          name: "lat_lng",
          description: "The position of the cursor.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "dragstart", description: "when the user starts dragging an overlay.",
       parameters: [{
          name: "lat_lng",
          description: "The position of the cursor.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "mousedown", description: "for a mousedown on an overlay.",
       parameters: [{
          name: "lat_lng",
          description: "The position of the cursor.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "mouseout", description: "when the mouse leaves the area of an overlay icon.",
       parameters: [{
          name: "lat_lng",
          description: "The position of the cursor.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "mouseover", description: "when the mouse enters the area of an overlay icon.",
       parameters: [{
          name: "lat_lng",
          description: "The position of the cursor.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "mouseup", description: "for a mouseup on an overlay.",
       parameters: [{
          name: "lat_lng",
          description: "The position of the cursor.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
      {name: "rightclick", description: "for a right-click on an overlay.",
       parameters: [{
          name: "lat_lng",
          description: "The position of the cursor.",
          important: true,
          pyVal: true,
       }], important: true, defaultEvent: true},
    ]
};


const component_regex = /\{\{component\}\}/g;

PyDefUtils.assembleGroups = function assembleGroups(groups, componentName, groupList, overrides) {
    overrides = overrides || {};

    const props = [],
        seenProps = {};

    groupList.forEach((groupName) => {
        const groupProps = groups[groupName];
        for (let i in groupProps) {
            let prop = groupProps[i];
            prop.group ||= groupName; // Allow properties defined in one group (above) to actually appear in another group
            const override = overrides[prop.name] || {};
            prop = { ...prop, ...override };
            if (prop.description) {
                prop.description = prop.description.replace(component_regex, componentName);
            }
            if (!override.omit) {
                props.push(prop);
            }
            seenProps[prop.name] = true;
        }
    });

    Object.keys(overrides).forEach((propName) => {
        if (!seenProps[propName]) {
            overrides[propName].name = propName;
            props.push(overrides[propName]);
        }
    });

    return props;
};

PyDefUtils.assembleGroupEvents = function(componentName, groupList, overrides) {
    return PyDefUtils.assembleGroups(eventGroups, componentName, groupList, overrides);
};

PyDefUtils.assembleGroupProperties = function(groupList, overrides) {
    return PyDefUtils.assembleGroups(propertyGroups, "component", groupList, overrides);
};

PyDefUtils.setupDefaultMouseEvents = function(self) {
    self._anvil.element.on("mouseenter", (e) => {
        const offset = self._anvil.element.offset();
        PyDefUtils.raiseEventAsync({x: e.pageX - offset.left, y: e.pageY - offset.top}, self, "mouse_enter");
    });

    self._anvil.element.on("mouseleave", (e) => {
        const offset = self._anvil.element.offset();
        PyDefUtils.raiseEventAsync({x: e.pageX - offset.left, y: e.pageY - offset.top}, self, "mouse_leave");
    });

    self._anvil.element.on("mousemove", (e) => {
        const offset = self._anvil.element.offset();
        PyDefUtils.raiseEventAsync({x: e.pageX - offset.left, y: e.pageY - offset.top, button: -1/*e.which is weird/broken*/}, self, "mouse_move");
    });

    self._anvil.element.on("touchmove", (e) => {
        const offset = self._anvil.element.offset();
        const has_handler = self._anvil.eventHandlers["mouse_move"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent.changedTouches[0].pageY - offset.top
            PyDefUtils.raiseEventAsync({ x, y, button: -1 /*e.which is weird/broken*/ }, self, "mouse_move");
            e.stopPropagation();
            e.preventDefault();
        }
    });

    self._anvil.element.on("touchend", (e) => {
        const offset = self._anvil.element.offset();
        const has_handler = self._anvil.eventHandlers["mouse_up"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent.changedTouches[0].pageY - offset.top;
            PyDefUtils.raiseEventAsync(
                {
                    x,
                    y,
                    button: e.which,
                    keys: { meta: false, shift: false, ctrl: false, alt: false },
                },
                self,
                "mouse_up"
            );
            e.stopPropagation();
            e.preventDefault();
        }
    });

    self._anvil.element.on("mouseup", (e) => {
        const offset = self._anvil.element.offset();
        PyDefUtils.raiseEventAsync(
            {
                x: e.pageX - offset.left,
                y: e.pageY - offset.top,
                button: e.which,
                keys: { meta: e.metaKey, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey },
            },
            self,
            "mouse_up"
        );
    });

    self._anvil.element.on("touchstart", (e) => {
        const offset = self._anvil.element.offset();
        const has_handler = self._anvil.eventHandlers["mouse_down"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent.changedTouches[0].pageY - offset.top;
            PyDefUtils.raiseEventAsync(
                {
                    x,
                    y,
                    button: e.which,
                    keys: { meta: false, shift: false, ctrl: false, alt: false },
                },
                self,
                "mouse_down"
            );
            e.stopPropagation();
            e.preventDefault();
        }
    });

    self._anvil.element.on("mousedown", (e) => {
        const offset = self._anvil.element.offset();
        PyDefUtils.raiseEventAsync(
            {
                x: e.pageX - offset.left,
                y: e.pageY - offset.top,
                button: e.which,
                keys: { meta: e.metaKey, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey },
            },
            self,
            "mouse_down"
        );
    });
};

PyDefUtils.calculateHeight = function() {
    var toMeasure = $(".anvil-measure-content").children();


    if (toMeasure.length == 0) {
        toMeasure = $("#components,#appGoesHere,.modal-dialog,.anvil-measure-this");
    }

    var reportHeight = 0;

    toMeasure.each(function(_,e) {
        e = $(e);
        var extra = e.hasClass("modal-dialog") ? 30 : 0;
        reportHeight = Math.max(reportHeight, e.offset().top + e.outerHeight() + extra);
    });

    return reportHeight;
};

PyDefUtils.addHeightHandle = function(_anvil) {
    // only relevant in the designer
    if (!ANVIL_IN_DESIGNER) return;

    _anvil.getHandles = function() {
        var offset = _anvil.element.offset();
        var w = _anvil.element.outerWidth();
        var h = _anvil.element.outerHeight();

        return [{
            x: offset.left + w/2 - 5,
            y: offset.top+h,
            width: 10,
            height: 10,
            cursor: "ns",
            owner: _anvil.componentSpec.name,
        }];
    };

    _anvil.handleGrab = function(handle, mouseX, mouseY) {
        return {
            mouseY: mouseY,
            originalHandleY: handle.y,
            originalHeight: _anvil.element.height(),
            originalHeightProp: parseFloat(_anvil.getPropJS("height") || _anvil.element.outerHeight()),
        };
    };

    _anvil.handleDrag = function(handle, grab, mouseX, mouseY) {

        var totalDy = mouseY - grab.mouseY;
        handle.y = grab.originalHandleY + totalDy;
        _anvil.element.height(grab.originalHeight + totalDy);

        if (PyDefUtils.updateHeight)
            PyDefUtils.updateHeight();
        return handle;
    };

    _anvil.handleDrop = function(handle, grab, mouseX, mouseY) {
        var r = { properties: {}};
        var totalDy = mouseY - grab.mouseY;

        var selfName = _anvil.componentSpec.name;
        r.properties[selfName] = {
            height: Math.max(0,grab.originalHeightProp + totalDy),
        };

        return r;
    };
};

// Problem: We can only pop up windows (eg Google auth) in response to synchronous events.
// Track whether we are currently executing a synchronous click event.
let popupOK = false;
document.addEventListener(
    "click",
    () => {
        popupOK = true;
        setTimeout(() => {
            popupOK = false; // fail safe incase the bubble phase stopped propagation
        });
    },
    true
);
document.addEventListener("click", () => {
    popupOK = false;
});

PyDefUtils.isPopupOK = () => popupOK;


// A common pattern is turning Media objects into a URL we can feed to
// an <img> or <a> tag. This may require allocating a Blob, which will
// then need to be released.
//
// This function may suspend, and returns:
// {getUrl: <function->url>, release: <function>, blob: <maybe-blob>}
PyDefUtils.getUrlForMedia = function(pyMedia, kws=[]) {

    const wrapBlob = (blob) => {
        let url = null;
        return {
            getUrl() {
                if (url === null) {
                    url = window.URL.createObjectURL(blob);
                }
                return url;
            },
            release() {
                if (url !== null) {
                    window.URL.revokeObjectURL(url);
                    url = null;
                }
            },
            blob,
        };
    };

    if (!pyMedia || pyMedia === Sk.builtin.none.none$) {
        return { getUrl: () => "", release: () => {} };
    }

    if (pyMedia._data instanceof Blob) {
        // It's already a BlobMedia; we can do this directly.
        return wrapBlob(pyMedia._data);
    }

    // Does it already have a permanent URL?
    const getMediaUrl = Sk.abstr.gattr(pyMedia, new Sk.builtin.str("get_url"));

    return Sk.misceval.chain(Sk.misceval.callsimOrSuspendArray(getMediaUrl, [], kws), (pyUrl) => {
        if (pyUrl instanceof Sk.builtin.str) {
            return { getUrl: () => pyUrl.toString(), release() {} };
        } else {
            let contentType;

            // No. Ick. We pull the content out as a binary JS string, then turn it
            // into a Blob.

            return Sk.misceval.chain(
                Sk.abstr.gattr(pyMedia, new Sk.builtin.str("content_type"), true),
                (ct) => {
                    contentType = ct;
                    return Sk.misceval.callsimOrSuspend(Sk.abstr.gattr(pyMedia, new Sk.builtin.str("get_bytes")));
                },
                (c) => {
                    const bytes = PyDefUtils.getUint8ArrayFromPyBytes(c);
                    const blob = new Blob([bytes], { type: contentType.toString() });
                    return wrapBlob(blob);
                }
            );
        }
    });
};

PyDefUtils.getUint8ArrayFromPyBytes = function(bytesOrStr) {
    if (Sk.__future__.python3) {
        return new Uint8Array(bytesOrStr.v);
    } else {
        const bytes = new Uint8Array(bytesOrStr.v.length);
        for (var i=0; i < bytesOrStr.v.length; i++) {
            bytes[i] = bytesOrStr.v.charCodeAt(i);
        }
        return bytes;
    }
}

PyDefUtils.logPagination = false;

PyDefUtils.repaginateChildren = (self, skip, startAfter, remainingRowQuota) => {
    if (PyDefUtils.logPagination) console.log("Repaginate children starting from", startAfter, "with quota", remainingRowQuota);

    let startAfterIdx = null;
    let startAfterValue = null;
    let startAfterDone = false;
    if (startAfter) {
        [startAfterIdx, startAfterValue, startAfterDone] = startAfter;
    }

    let passedResumePoint = (startAfter == null);
    let pyComponents = [...self._anvil.components];
    self._anvil.lastChildPagination = self._anvil.lastChildPagination || new Array(pyComponents.length);

    // Iterate through my components, asking them to paginate in turn until we run out of rows.
    return Sk.misceval.chain(undefined,
        () => Sk.misceval.iterArray(pyComponents, ({component, layoutProperties}, idx) => {
            if (layoutProperties.pinned && component._anvil?.paginate) {
                component._anvil.pagination = {
                    startAfter: null,
                    rowQuota: remainingRowQuota,
                }
                return Sk.misceval.chain(component._anvil.paginate(),
                    ([rows,,]) => {
                        self._anvil.lastChildPagination[idx] = undefined;
                        remainingRowQuota -= rows;
                    },
                    () => idx + 1,
                );
            }
            return idx + 1;
        }, /* idx = */ 0),
        () => Sk.misceval.iterArray(pyComponents, ({component, layoutProperties}, idx) => {

            // We only care about this component if it's a ClassicComponet with a paginate function.
            if (!layoutProperties.pinned && component._anvil?.paginate) {

                // We need to display this child if we're either past the resume point or if the resume 
                // point *is* this child and it wasn't done.

                let atResumePoint = (startAfter && (idx == startAfterIdx));

                if (idx < skip) {
                    return idx + 1;
                }

                if (passedResumePoint || (atResumePoint && !startAfterDone)) {

                    // If our start point is this child, pass on state so that *it* can resume from the correct point.
                    let startAfterThisComponent = startAfter && (startAfter[0] == idx);

                    component._anvil.pagination = {
                        startAfter: startAfterThisComponent ? startAfter[1] : null,
                        rowQuota: remainingRowQuota,
                    }
                    return Sk.misceval.chain(component._anvil.paginate(),
                        ([rows, stoppedAt, done]) => {
                            self._anvil.lastChildPagination[idx] = [rows, stoppedAt, done];
                            if (rows > 0) {
                                remainingRowQuota -= rows;
                            }
                            passedResumePoint = true;
                        },
                        () => idx + 1,
                    );
                } else {
                    component._anvil.pagination = {
                        startAfter: null,
                        rowQuota: 0,
                    }
                    return Sk.misceval.chain(component._anvil.paginate(),
                        () => {
                            self._anvil.lastChildPagination[idx] = undefined;
                            passedResumePoint = passedResumePoint || atResumePoint;
                        },
                        () => idx + 1,
                    );
                }
            }
            return idx + 1;
        }, /* idx = */ 0),
        () => {
            // The total number of rows is just the sum of all the rows displayed by children.
            let rows = self._anvil.lastChildPagination.reduce((sum, child) => sum+ (child ? child[0] : 0), 0);
            // We stopped at the last child who displayed any rows.
            let stoppedAt = self._anvil.lastChildPagination.reduce((stoppedAt, child, idx) => (child && child[0]) ? [idx, child[1], child[2]] : stoppedAt, null);
            // We're done if all children are done
            let done = true;
            for (let child of self._anvil.lastChildPagination) {
                if (child && child[2] === false) {
                    done = false;
                } else if (child && child[2] === "INVALID") {
                    done = "INVALID";
                    break;
                }
            }
           
            if (PyDefUtils.logPagination) console.log("Children displayed", rows, "rows.", done ? "Done" : "Interrupted", "at", stoppedAt);
            return [rows, stoppedAt, done];
            // Done iterating through my components
        }
    );
    
};

/** @deprecated */
PyDefUtils.remapToJsOrWrap = remapToJsOrWrap;
/** @deprecated */
PyDefUtils.unwrapOrRemapToPy = toPy; // keep this around even though it is just an alias

PyDefUtils.callJs = (pyComponent, pyFnName, ...pyArgs) => {

    const fnName = Sk.ffi.toJs(pyFnName);

    let fn;
    try {
        fn = Function(`return (${fnName})`)();
    } catch (e) {
        if (!(e instanceof ReferenceError && e.message.includes(fnName))) {
            throw e;
        }
        let msg = `Could not find global JS function '${fnName}'.`;
        // This hint is only available in ClassicComponents - but that's probably OK because this mechanism
        // is deprecated anyway.
        if (pyComponent?._anvil && !pyComponent._anvil.onPage) {
            msg +=
                " This form is not currently visible - " +
                "to call functions defined in its HTML on load, " +
                "use call_js in the form 'show' event handler.";
        }
        throw new Sk.builtin.NameError(msg);
    }
    if (typeof fn !== "function") {
        throw new pyTypeError(`${fnName} is not callable, got ${typeof fn}`);
    }

    const domElement = pyComponent?.anvil$hooks?.domElement;
    const jqueryWrapped = domElement && $(domElement);

    let rv = fn.apply(jqueryWrapped, pyArgs.map(PyDefUtils.remapToJsOrWrap));
    if (rv instanceof Promise) {
        rv = PyDefUtils.suspensionFromPromise(rv.then(toPy));
    } else {
        rv = toPy(rv);
    }
    return rv;
};

/**
 * @param {Promise} p
 * @returns {Promise}
 */
PyDefUtils.withDelayPrint = (p) => {
    if (!window.outstandingPrintDelayPromises) return p;
    const key = Math.random().toString(36).substring(6);
    const d = defer();
    window.outstandingPrintDelayPromises[key] = d;
    return p.then(d.resolve);
};

PyDefUtils.delayPrint = key => {
    if (window.outstandingPrintDelayPromises) {
        window.outstandingPrintDelayPromises[key] = defer();
    }
};

PyDefUtils.resumePrint = key => {
    if (window.outstandingPrintDelayPromises && window.outstandingPrintDelayPromises[key]) {
        window.outstandingPrintDelayPromises[key].resolve();
    }
};

PyDefUtils.pyTryFinally = pyTryFinally;

module.exports = PyDefUtils;

// jQuery 3 migration.

// CLICK needed by old Dashboard template
// MOUSEOVER/MOUSEOUT needed by bootstrap-notify
let oldJQueryFns = ["click", "mouseover", "mouseout"];

for (let f of oldJQueryFns) {
    $.fn[f] = function(...args) {
        return this.on(f, ...args);
    }
}

// End of migration stuff

// Shamelessly copied from http://www.henryalgus.com/reading-binary-files-using-jquery-ajax/

// use this transport for "binary" data type
$.ajaxTransport("+binary", function(options, originalOptions, jqXHR){
    // check for conditions and support for blob / arraybuffer response type
    if (window.FormData && ((options.dataType && (options.dataType == 'binary')) || (options.data && ((window.ArrayBuffer && options.data instanceof ArrayBuffer) || (window.Blob && options.data instanceof Blob)))))
    {
        return {
            // create new XMLHttpRequest
            send: function(headers, callback){

                // setup all variables
                var xhr = new XMLHttpRequest(),
                url = options.url,
                type = options.type,
                async = options.async || true,
                // blob or arraybuffer. Default is blob
                dataType = options.responseType || "blob",
                data = options.data || null,
                username = options.username || null,
                password = options.password || null;

                xhr.addEventListener('load', function(){
                    var data = {};
                    data[options.dataType] = xhr.response;
                    // make callback and send data
                    callback(xhr.status, xhr.statusText, data, xhr.getAllResponseHeaders());
                });

                xhr.open(type, url, async, username, password);

                // setup custom headers
                for (var i in headers ) {
                    xhr.setRequestHeader(i, headers[i] );
                }

                xhr.responseType = dataType;
                xhr.send(data);
            },
            abort: function(){
                jqXHR.abort();
            }
        };
    }
});

/*
 * TO TEST:
 *
 *
 * - Property Group "text": text, align, font_size, font, bold, italic, underline
 * - Property Group "align": align
 * - Property Group "appearance": background, foreground, visible
 * - Property Group "height": height
 * - Property Group "layout": width, spacing_above, spacing_below
 * - Property Group "interaction": enabled
 * - Property Group "containers": row_spacing
 *
 * - Event Group "universal": show, hide
 * - Event Group "mouse": mouse_enter, mouse_leave, mouse_move, mouse_down, mouse_up
 *
 */
