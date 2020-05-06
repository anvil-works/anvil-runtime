"use strict";

module.exports = function() {

	var b64 = require("../lib/b64");

    var PyDefUtils = require("PyDefUtils");

    var pyMod = {"__name__": new Sk.builtin.str("base64")};

    var ni = new Sk.builtin.func(function() {
    	throw new Sk.builtin.NotImplementedError("The 'base64' module in Anvil forms is limited to simple use of b64encode() and b64decode(). For full functionality, use a server module.");
    });

    pyMod["b32encode"] = ni;
    pyMod["b32decode"] = ni;
    pyMod["b16encode"] = ni;
    pyMod["b16decode"] = ni;

    pyMod["encode"] = ni;
    pyMod["decode"] = ni;

    pyMod["b64encode"] = pyMod["encodestring"] = new Sk.builtin.func(function(s) {
		Sk.builtin.pyCheckArgs("b64encode", arguments, 1, 1);
		Sk.builtin.pyCheckType("b64encode", "s", Sk.builtin.checkString(s));

    	return new Sk.builtin.str(b64.base64EncStr(s.v));
    });

    pyMod["b64decode"] = pyMod["decodestring"] = new Sk.builtin.func(function(s) {
		Sk.builtin.pyCheckArgs("b64decode", arguments, 1, 1);
		Sk.builtin.pyCheckType("b64decode", "s", Sk.builtin.checkString(s));

    	return new Sk.builtin.str(b64.base64DecToStr(s.v));
    });

    return pyMod;
}

/*
 * TO TEST:
 * 
 *  - Methods: b64encode, b64decode
 *
 */