"use strict";

/**
id: js_module
docs_url: /docs/server#advanced
title: JS Interop Module
description: |
  ```python
  from anvil.js import call_js
  ```

*/

module.exports = function () {
    const pyMod = { __name__: new Sk.builtin.str("js") };
    var PyDefUtils = require("PyDefUtils");

    const call_js = PyDefUtils.callJs.bind(null, null);

    const dummyProxy = Sk.ffi.proxy({});
    const newProxy = Sk.abstr.lookupSpecial(dummyProxy, Sk.builtin.str.$new);

    /*!defFunction(anvil.js,!_,js_function_or_name,*args)!2*/ "Call a global Javascript function by name, translating arguments and return values from Python to Javascript." ["call"]

    /*!defFunction(anvil.js,!_,component)!2*/ "Get the Javascript DOM node for a particular component, to manipulate from Python." ["get_dom_node"]

    /*!defFunction(anvil.js,!_,js_class,*args)!2*/ "Given a Javascript class (aka function object) that's been passed into Python, construct a new instance of it." ["new"]

    /*!defModuleAttr(anvil.js)!1*/ ;({name: "window", description: "The Javascript global 'window' object, wrapped and accessible from Python."});

    Sk.abstr.setUpModuleMethods("js", pyMod, {
        call_$rw$: {
            $meth(args) {
                const maybe_proxyied = args[0];
                if (maybe_proxyied && maybe_proxyied.constructor === dummyProxy.constructor) {
                    return Sk.misceval.callsimOrSuspendArray(maybe_proxyied.tp$getattr(Sk.builtin.str.$call), args.slice(1));
                }
                return call_js(...args);
            },
            $flags: { FastCall: true, NoKwargs: true },
        },
        get_dom_node: {
            $meth(component) {
                if (component._anvil === undefined) {
                    throw new Sk.builtin.TypeError("get_dom_node expected an anvil Component not " + Sk.abstr.typeName(component));
                }
                return Sk.ffi.proxy(component._anvil.element[0]);
            },
            $flags: { OneArg: true },
        },
        new_$rw$: {
            $meth(...args) {
                // jsProxy.__new__ will throw the appropriate errors so let it handle this
                return Sk.misceval.callsimOrSuspendArray(newProxy, args);
            },
            $flags: { MinArgs: 1 },
        },
    });
    pyMod.call_js = pyMod.call_$rw$;
    
    pyMod.window = Sk.ffi.proxy(window);
    Sk.abstr.objectSetItem(Sk.sysmodules, new Sk.builtin.str("anvil.js.window"), pyMod.window);


    return pyMod;
};
