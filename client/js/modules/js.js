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

module.exports = function() {

    var pyMod = {"__name__": new Sk.builtin.str("js")};
    var PyDefUtils = require("PyDefUtils");

    /*!defFunction(anvil.js,!_,js_function_name,*args)!2*/ "Call a global Javascript function."
    pyMod["call_js"] = new Sk.builtin.func(PyDefUtils.callJs.bind(null,null));

    return pyMod;
}
