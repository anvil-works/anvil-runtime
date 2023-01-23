"use strict";

module.exports = function() {

    var PyDefUtils = require("PyDefUtils");

    var pyMod = {"__name__": new Sk.builtin.str("json")};

    var ni = new Sk.builtin.func(function() {
        throw new Sk.builtin.NotImplementedError("The 'json' module in Anvil is limited to simple use of json.dumps() and json.loads()");
    });

    pyMod["dump"] = ni;
    pyMod["load"] = ni;
    pyMod["JSONEncoder"] = ni;
    pyMod["JSONDecoder"] = ni;

    var barelyImplemented = function(kwargs, arglen) {
        if(arglen !== 2 || Object.keys(kwargs).length !== 0) {
            throw new Sk.builtin.NotImplementedError("The 'json' module in Anvil is limited. You may only use a single argument to json.dumps() and json.loads(). json.dumps() also accepts an indent keyword argument.");
        }
    };

    pyMod["dumps"] = PyDefUtils.funcWithKwargs(function(kwargs, pyObj) {
        const indent = kwargs.indent || null;
        delete kwargs.indent;
        barelyImplemented(kwargs, arguments.length);
        return new Sk.builtin.str(JSON.stringify(Sk.ffi.remapToJs(pyObj), null, indent));
    });

    pyMod["loads"] = PyDefUtils.funcWithKwargs(function(kwargs, pyS) {
        barelyImplemented(kwargs, arguments.length);
		Sk.builtin.pyCheckType("loads", "s", Sk.builtin.checkString(pyS));

        return Sk.ffi.remapToPy(JSON.parse(pyS.v));
    });

    return pyMod;
};

/*
 * TO TEST:
 * 
 *  - Methods: dumps, loads
 *
 */