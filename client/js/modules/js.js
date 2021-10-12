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

    async function getModule(url) {
        // we can't use import(url.toString()) because webpack won't support expressions in import statements
        const mod = await new Function("return import(" + JSON.stringify(url.toString()) + ")").call();
        return Sk.ffi.proxy(mod);
    }

    const WRAPPER_ASSIGNMENTS = ["__module__", "__name__", "__qualname__", "__doc__", "__annotations__"].map(
        (x) => new Sk.builtin.str(x)
    );
    const WRAPPER_UPDATES = [new Sk.builtin.str("__dict__")];
    const STR_UPDATE = new Sk.builtin.str("update");
    const STR_WRAPPED = new Sk.builtin.str("__wrapped__");

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
        /*!defBuiltinFunction(anvil.js,!_,js_promise)!1*/
        await_promise: {
            $name: "await_promise",
            $meth(wrappedPromise) {
                const maybePromise = wrappedPromise.valueOf();
                if (
                    maybePromise instanceof Promise ||
                    (maybePromise && maybePromise.then && typeof maybePromise.then === "function")
                ) {
                    return Sk.misceval.chain(Sk.misceval.promiseToSuspension(maybePromise), (res) =>
                        Sk.ffi.toPy(res, { dictHook: (obj) => Sk.ffi.proxy(obj) })
                    );
                }
                // we weren't given a wrapped promise so just return the argument we were given :shrug:
                return wrappedPromise;
            },
            $flags: { OneArg: true },
            $doc: "Await the result of a Javascript Promise in Python. This function will block until the promise resolves or rejects. If the promise resolves, it will return the resolved value. If the promise rejects, it will raise the rejected value as an exception",
            /*GENDOC*
            anvil$helpLink: "/docs/client/javascript/accessing-javascript#calling-asynchronous-javascript-apis",
            //*/
        },
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
        /*!defBuiltinFunction(anvil.js,!DOM node,component)!1*/
        get_dom_node: {
            $name: "get_dom_node",
            $meth(component) {
                if (component._anvil && component._anvil.domNode) {
                    return Sk.ffi.proxy(component._anvil.domNode);
                } else if (component.valueOf() instanceof Element) {
                    // we're a proxy DOM node so just return the object back to the user
                    return component;
                }
                throw new Sk.builtin.TypeError(
                    `get_dom_node expected an anvil Component or DOM node, (got ${Sk.abstr.typeName(component)})`
                );
            },
            $flags: { OneArg: true },
            $doc: "Returns the Javascript DOM node for an Anvil component. If a DOM node is passed to the function it will be returned. Anything else throws a TypeError",
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
                const pyWrapper = new Sk.builtin.func(callback_handler);
                // assign __name__ etc
                WRAPPER_ASSIGNMENTS.forEach((attrName) => {
                    const attr = pyfunc.tp$getattr(attrName);
                    if (attr !== undefined) pyWrapper.tp$setattr(attrName, attr);
                });
                // update __dict__
                WRAPPER_UPDATES.forEach((attrName) => {
                    const attr = pyfunc.tp$getattr(attrName) || new Sk.builtin.dict([]);
                    const update_meth = pyWrapper.tp$getattr(attrName).tp$getattr(STR_UPDATE);
                    PyDefUtils.pyCall(update_meth, [attr]);
                });
                pyWrapper.tp$setattr(STR_WRAPPED, pyfunc);
                return pyWrapper;
            },
            $doc: "Use @anvil.js.report_exceptions as a decorator for any function used as a javascript callback. Error handling may be suppressed by an external javascript libary. This decorator makes sure that errors in your python code are reported.",
            $flags: { OneArg: true },
            /*GENDOC*
            anvil$helpLink: "/docs/client/javascript/accessing-javascript#capturing-exceptions-in-callbacks",
            //*/
        },

        /*!defBuiltinFunction(anvil.js,!Javascript Module,url)!1*/
        import_from: {
            $name: "import_from",
            $meth(url) {
                return Sk.misceval.promiseToSuspension(getModule(url));
            },
            $doc: "use anvil.js.import_from(url) to dynamically import a Javascript Module. Accessing the attributes of a Javascript Module vary depending on the Module. See the documentation for examples",
            $flags: { OneArg: true },
            /*GENDOC*
            anvil$helpLink: "/docs/client/javascript/accessing-javascript#javascript-modules",
            //*/
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

    pyMod.ExternalError = Sk.builtin.ExternalError;
    /*!defMethod(_,)!2*/ ({
        $doc: "An Error that occurs in Javascript will be raised in Python as an anvil.js.ExternalError. Typically used in a try/except block to catch a Javascript Error",
        anvil$helpLink: "/docs/client/javascript/accessing-javascript#catching-exceptions",
    });
    ["__init__"];
    /*!defAttr()!1*/ ({
        name: "original_error",
        type: "Javascript object",
        description: "The original Javascript error that was raised.",
    });
    pyMod.ExternalError.prototype.original_error = new Sk.builtin.property(
        new Sk.builtin.func((self) => {
            return Sk.ffi.toPy(self.nativeError, { dictHook: (obj) => Sk.ffi.proxy(obj) });
        })
    );
    /*!defClass(anvil.js,!ExternalError, __builtins__..Exception)!*/

    return pyMod;
};
