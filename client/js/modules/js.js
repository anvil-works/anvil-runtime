"use strict";

/**
id: js_module
docs_url: /docs/server#advanced
title: JS Interop Module
description: |
  ```python
  from anvil.js import window
  ```

*/

module.exports = function () {
    const pyMod = { __name__: new Sk.builtin.str("js") };
    var PyDefUtils = require("PyDefUtils");

    const call_js = PyDefUtils.callJs.bind(null, null);
    const servermod = PyDefUtils.getModule("anvil.server");

    const dummyProxy = Sk.ffi.proxy({});
    const newProxy = Sk.abstr.lookupSpecial(dummyProxy, Sk.builtin.str.$new);
    const ProxyType = dummyProxy.constructor;

    // we only ever serialize from the client to the server
    // the server deserialize method returns the object literal as a dictionary
    ProxyType.prototype.__serialize__ = new Sk.builtin.method_descriptor(ProxyType, {
        $name: "__serialize__",
        $meth(globals) {
            const as_js = this.valueOf();
            if (as_js.constructor === Object) {
                const dict = new Sk.builtin.dict([]);
                for (let key in this.js$wrapped) {
                    dict.mp$ass_subscript(new Sk.builtin.str(key), Sk.ffi.toPy(as_js[key]));
                }
                return dict;
            }
            throw new Sk.builtin.TypeError("cannot serialize " + Sk.misceval.objectRepr(this));
        },
        $flags: { OneArg: true },
    });

    const portable_class = servermod.tp$getattr(new Sk.builtin.str("portable_class"));
    PyDefUtils.pyCall(portable_class, [ProxyType, new Sk.builtin.str("anvil.js.ProxyType")]);

    Sk.abstr.setUpModuleMethods("js", pyMod, {
        /*!defBuiltinFunction(anvil.js,!_,js_function_or_name,*args)!1*/
        call_$rw$: {
            $name: "call",
            $meth(args) {
                const maybe_proxyied = args[0];
                if (maybe_proxyied && maybe_proxyied.constructor === dummyProxy.constructor) {
                    return Sk.misceval.callsimOrSuspendArray(
                        maybe_proxyied.tp$getattr(Sk.builtin.str.$call),
                        args.slice(1)
                    );
                }
                return call_js(...args);
            },
            $flags: { FastCall: true, NoKwargs: true },
            $doc: "Call a global Javascript function by name, translating arguments and return values from Python to Javascript.",
            /*GENDOC*
            anvil$helpLink: "/docs/client/javascript/accessing-javascript#calling-proxyobjects",
            //*/
        },
        /*!defBuiltinFunction(anvil.js,!_,component)!1*/
        get_dom_node: {
            $name: "get_dom_node",
            $meth(component) {
                if (component._anvil === undefined) {
                    throw new Sk.builtin.TypeError(
                        "get_dom_node expected an anvil Component not " + Sk.abstr.typeName(component)
                    );
                }
                return Sk.ffi.proxy(component._anvil.domNode);
            },
            $flags: { OneArg: true },
            $doc: "Get the Javascript DOM node for a particular component, to manipulate from Python.",
            /*GENDOC*
            anvil$helpLink: "/docs/client/javascript/accessing-javascript#accessing-a-dom-node",
            //*/
        },
        /*!defBuiltinFunction(anvil.js,!_,js_class,*args)!1*/
        new_$rw$: {
            $name: "new",
            $meth(...args) {
                // jsProxy.__new__ will throw the appropriate errors so let it handle this
                return Sk.misceval.callsimOrSuspendArray(newProxy, args);
            },
            $flags: { MinArgs: 1 },
            $doc: "Given a Javascript class (aka function object) that's been passed into Python, construct a new instance of it.",
            /*GENDOC*
            anvil$helpLink: "/docs/client/javascript/accessing-javascript#calling-with-new",
            //*/
        },
        /*!defBuiltinFunction(anvil.js,!anvil.BlobMedia instance,blob,[content_type=""],[name=None])!1*/
        to_media: {
            $name: "to_media",
            $meth(blob, type, name) {
                blob = Sk.ffi.toJs(blob);
                type = Sk.ffi.toJs(type);
                name = Sk.ffi.toJs(name);
                if (blob instanceof Blob) {
                    // pass
                } else if (Array.isArray(blob)) {
                    // assume they've passed an array of sensible types
                    type || (type = blob[0]?.type);
                    blob = new Blob(blob, { type: type });
                } else if ([ArrayBuffer, Uint8Array].includes(blob.constructor)) {
                    // extend to other types if we need to
                    blob = new Blob([blob], { type: type });
                } else {
                    throw new Sk.builtin.TypeError(
                        "got an unexpected type, anvil.js.to_media() expects a Blob, ArrayBuffer, Uint8Array or an Array of those types"
                    );
                }
                const args = name ? [blob, name] : [blob];
                // use internal call to BlobMedia where the first argument can be a BlobMedia object
                // the name can also be a js string
                return PyDefUtils.pyCallOrSuspend(anvil.BlobMedia, args);
            },
            $doc: "Convert a javascript Blob, ArrayBuffer, Uint8Array or an Array of these types to an anvil BlobMedia object. If a Blob, or Array of Blobs, is passed the content_type will be inferred.",
            $flags: {
                NamedArgs: [null, "content_type", "name"],
                Defaults: [Sk.builtin.str.$empty, Sk.builtin.none.none$],
            },
        },

        /*!defBuiltinFunction(anvil.js,!function,wrapped_function)!1*/
        report_exceptions: {
            $name: "report_exceptions",
            $meth(pyfunc) {
                function callback_handler(args, kws) {
                    return Sk.misceval.tryCatch(
                        () => PyDefUtils.pyCallOrSuspend(pyfunc, args, kws),
                        (e) => {
                            window.onerror(null, null, null, null, e);
                        }
                    );
                }
                callback_handler.co_fastcall = true;
                return Sk.misceval.chain(
                    functools.wraps,
                    () => PyDefUtils.pyCallOrSuspend(functools.wraps, [pyfunc]),
                    (wrapper) => PyDefUtils.pyCallOrSuspend(wrapper, [new Sk.builtin.func(callback_handler)])
                );
            },
            $doc: "Use @anvil.js.report_exceptions as a decorator for any function used as a javascript callback. Error handling may be suppressed by an external javascript libary. This decorator makes sure that errors in your python code are reported.",
            $flags: { OneArg: true },
        },
    });

    // backwards compatibility
    pyMod.call_js = pyMod.call_$rw$;

    /*!defModuleAttr(anvil.js)!1*/ ({
        name: "window",
        description: "The Javascript global 'window' object, wrapped and accessible from Python.",
    });
    pyMod.window = Sk.ffi.proxy(window);
    const oldLookup = pyMod.window.$lookup;
    const strParent = new Sk.builtin.str("parent");
    // override the internal method $lookup
    // it's a bit of a hack but accessing window.parent throws cross origin errors 
    // since the default implementation of $lookup uses toPy
    // which accesses attributes that end up getting blocked
    pyMod.window.$lookup = function (pyName) {
        if (pyName === strParent) {
            const parent = Sk.ffi.proxy(this.js$wrapped.parent, { name: "ParentWindow" });
            parent.$lookup = pyMod.window.$lookup;
            return parent;
        }
        return oldLookup.call(this, pyName);
    };
    Sk.abstr.objectSetItem(Sk.sysmodules, new Sk.builtin.str("anvil.js.window"), pyMod.window);
    const anvil = {
        get BlobMedia() {
            delete this.BlobMedia;
            return (this.BlobMedia = Sk.importModule("anvil").tp$getattr(new Sk.builtin.str("BlobMedia")));
        },
    };

    const functools = {
        get wraps() {
            delete this.wraps;
            return Sk.misceval.chain(
                Sk.importModule("functools", false, true),
                (f) => (this.wraps = f.tp$getattr(new Sk.builtin.str("wraps")))
            );

        }
    }
        
    return pyMod;

};
        