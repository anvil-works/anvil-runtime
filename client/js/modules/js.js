"use strict";

const { anvilServerMod, anvilMod } = require("@runtime/runner/py-util");

/*#
id: js_module
docs_url: /docs/server#advanced
title: JS Interop Module
description: |
  ```python
  from anvil.js import window
  ```

*/

const {
    builtin: {
        dict: pyDict,
        str: pyStr,
        func: pyFunc,
        property: pyProperty,
        none: { none$: pyNone },
        method_descriptor: methodDescriptor,
        TypeError: pyTypeError,
        ExternalError,
    },
    ffi: { proxy, toPy, toJs },
    abstr: { lookupSpecial, setUpModuleMethods, typeName, objectSetItem },
    misceval: {
        objectRepr,
        isTrue,
        promiseToSuspension,
        chain: chainOrSuspend,
        tryCatch: tryCatchOrSuspend,
        callsimOrSuspendArray: pyCallOrSuspend,
    },
} = Sk;

module.exports = function () {
    const pyMod = { __name__: new pyStr("js") };
    var PyDefUtils = require("PyDefUtils");

    const call_js = PyDefUtils.callJs.bind(null, null);
    const dummyProxy = proxy({});
    const newProxy = lookupSpecial(dummyProxy, pyStr.$new);
    const ProxyType = dummyProxy.constructor;

    async function getModule(url) {
        // we can't use import(url.toString()) because webpack won't support expressions in import statements
        // we want "./_/theme/..." and "/_/theme" to do the obvious thing
        // since runner.js loads from cdnOrigin we adjust the import to be absolute rather than relative
        url = url.toString();
        if (url.startsWith("./_/theme/")) {
            url = url.slice(1);
        }
        if (url.startsWith("/_/theme/")) {
            url = window.anvilAppOrigin + url;
        }
        const mod = await new Function("return import(" + JSON.stringify(url) + ")").call();
        return proxy(mod);
    }

    const WRAPPER_ASSIGNMENTS = ["__module__", "__name__", "__qualname__", "__doc__", "__annotations__"].map(
        (x) => new pyStr(x)
    );
    const WRAPPER_UPDATES = [new pyStr("__dict__")];
    const STR_UPDATE = new pyStr("update");
    const STR_WRAPPED = new pyStr("__wrapped__");

    // we only ever serialize from the client to the server
    // the server deserialize method returns the object literal as a dictionary
    ProxyType.prototype.__serialize__ = new methodDescriptor(ProxyType, {
        $name: "__serialize__",
        $meth(globals) {
            const as_js = this.valueOf();
            if (as_js.constructor === Object) {
                const dict = new pyDict([]);
                for (let key in this.js$wrapped) {
                    dict.mp$ass_subscript(new pyStr(key), toPy(as_js[key]));
                }
                return dict;
            }
            throw new pyTypeError("cannot serialize " + objectRepr(this));
        },
        $flags: { OneArg: true },
    });

    /*!defMethod(anvil.js.ProxyType instance)!2*/ "The type of a JavaScript object in when accessed in Python code"; "__init__";
    /*!defClass(anvil.js,ProxyType)!*/
    pyMod.ProxyType = ProxyType;

    if (!ANVIL_IN_DESIGNER) {
        // has to work in designer
        PyDefUtils.pyCall(anvilServerMod.portable_class, [ProxyType, new pyStr("anvil.js.ProxyType")]);
    }

    function exceptionReporter(e) {
        window.onerror(null, null, null, null, e);
    }

    function exceptionReporterReRaise(e) {
        exceptionReporter(e);
        throw e;
    }

    setUpModuleMethods("js", pyMod, {
        /*!defBuiltinFunction(anvil.js,!_,js_promise)!1*/
        await_promise: {
            $name: "await_promise",
            $meth(wrappedPromise) {
                const maybePromise = wrappedPromise.valueOf();
                if (
                    maybePromise instanceof Promise ||
                    (maybePromise && maybePromise.then && typeof maybePromise.then === "function")
                ) {
                    return chainOrSuspend(promiseToSuspension(maybePromise), (res) =>
                        toPy(res, { dictHook: (obj) => proxy(obj) })
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
                    return pyCallOrSuspend(maybe_proxyied.tp$getattr(pyStr.$call), args.slice(1));
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
                if (component.anvil$hooks) {
                    return Sk.misceval.chain(component.anvil$hooks.setupDom(), proxy);
                } else if (component.valueOf() instanceof Element) {
                    // we're a proxy DOM node so just return the object back to the user
                    return component;
                }
                throw new pyTypeError(
                    `get_dom_node expected an anvil Component or DOM node, (got ${typeName(component)})`
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
                return pyCallOrSuspend(newProxy, args);
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
                blob = toJs(blob);
                type = toJs(type);
                name = toJs(name);
                if (blob instanceof Blob) {
                    if (blob instanceof File) {
                        // special case
                        return PyDefUtils.pyCallOrSuspend(anvilMod.FileMedia, [blob]);
                    }
                    // else pass
                } else if (Array.isArray(blob)) {
                    // assume they've passed an array of sensible types
                    type || (type = blob[0]?.type);
                    blob = new Blob(blob, { type });
                } else if ([ArrayBuffer, Uint8Array].includes(blob.constructor)) {
                    // extend to other types if we need to
                    blob = new Blob([blob], { type });
                } else {
                    throw new pyTypeError(
                        "got an unexpected type, anvil.js.to_media() expects a Blob, ArrayBuffer, Uint8Array or an Array of those types"
                    );
                }
                const args = name ? [blob, name] : [blob];
                // use internal call to BlobMedia where the first argument can be a BlobMedia object
                // the name can also be a js string
                return PyDefUtils.pyCallOrSuspend(anvilMod.BlobMedia, args);
            },
            $doc: "Convert a javascript Blob, ArrayBuffer, Uint8Array or an Array of these types to an anvil BlobMedia object. If a Blob, or Array of Blobs, is passed the content_type will be inferred.",
            $flags: {
                NamedArgs: [null, "content_type", "name"],
                Defaults: [Sk.builtin.str.$empty, Sk.builtin.none.none$], // gendoc doesn't like pyStr.$empty, pyNone because it can't scope the vars
            },
        },

        /*!defBuiltinFunction(anvil.js,!function,wrapped_function)!1*/
        report_exceptions: {
            $name: "report_exceptions",
            $meth(pyfunc) {
                function callback_handler(args, kws) {
                    return tryCatchOrSuspend(() => PyDefUtils.pyCallOrSuspend(pyfunc, args, kws), exceptionReporter);
                }
                callback_handler.co_fastcall = true;
                const pyWrapper = new pyFunc(callback_handler);
                // assign __name__ etc
                WRAPPER_ASSIGNMENTS.forEach((attrName) => {
                    const attr = pyfunc.tp$getattr(attrName);
                    if (attr !== undefined) pyWrapper.tp$setattr(attrName, attr);
                });
                // update __dict__
                WRAPPER_UPDATES.forEach((attrName) => {
                    const attr = pyfunc.tp$getattr(attrName) || new pyDict([]);
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

        /*!defBuiltinFunction(anvil.js,!_,bool,[reraise=True])!1*/
        report_all_exceptions: {
            $name: "report_all_exceptions",
            $meth(reporting, reraise) {
                if (!isTrue(reporting)) {
                    Sk.uncaughtException = undefined;
                } else if (isTrue(reraise)) {
                    Sk.uncaughtException = exceptionReporterReRaise;
                } else {
                    Sk.uncaughtException = exceptionReporter;
                }
            },
            $doc:
                "Set the default exception reporting behaviour for Python callbacks in Javascript." +
                "When set to True all exception will be reported by anvil and then re-raised within Javascript." +
                "\nThis may mean some exceptions are reported twice, but it ensures Exceptions in your Python code are reported correctly.\n" +
                "If reraise is to False, Exceptions raised in python code will be reported by Anvil, but not re-raised in Javascript. Instead the Python callback will return undefined to Javascript.",
            $flags: {
                NamedArgs: [null, "reraise"],
                Defaults: [true],
            },
            /*GENDOC*
            anvil$helpLink: "/docs/client/javascript/accessing-javascript#capturing-exceptions-in-callbacks",
            //*/
        },

        /*!defBuiltinFunction(anvil.js,!Javascript Module,url)!1*/
        import_from: {
            $name: "import_from",
            $meth(url) {
                return promiseToSuspension(getModule(url));
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
    pyMod.window = proxy(window);
    objectSetItem(Sk.sysmodules, new pyStr("anvil.js.window"), pyMod.window);

    pyMod.ExternalError = ExternalError;
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
    pyMod.ExternalError.prototype.original_error = new pyProperty(
        new pyFunc((self) => {
            return toPy(self.nativeError, { dictHook: (obj) => proxy(obj) });
        })
    );
    /*!defClass(anvil.js,!ExternalError, __builtins__..Exception)!*/

    return pyMod;
};
