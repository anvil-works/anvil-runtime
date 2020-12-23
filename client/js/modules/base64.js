"use strict";

module.exports = function() {

    var b64 = require("../lib/b64");

    var PyDefUtils = require("PyDefUtils");

    const pyMod = { __name__: new Sk.builtin.str("base64") };

    const ni = new Sk.builtin.func(function() {
    	throw new Sk.builtin.NotImplementedError("The 'base64' module in Anvil forms is limited to simple use of b64encode() and b64decode(). For full functionality, use a server module.");
    });

    pyMod["b32encode"] = ni;
    pyMod["b32decode"] = ni;
    pyMod["b16encode"] = ni;
    pyMod["b16decode"] = ni;

    pyMod["encode"] = ni;
    pyMod["decode"] = ni;

    let byteString, checkByteString;
    if (Sk.__future__.python3) {
        byteString = Sk.builtin.bytes;
        checkByteString = Sk.builtin.checkBytes;
    } else {
        byteString = Sk.builtin.str;
        checkByteString = Sk.builtin.checkString;
    }

    pyMod["b64encode"] = pyMod["encodebytes"] = pyMod["encodestring"] = new Sk.builtin.func(function (s) {
        Sk.builtin.pyCheckArgs("b64encode", arguments, 1, 1);
        Sk.builtin.pyCheckType("argument", "bytes-like object", checkByteString(s));
        return new byteString(b64.base64EncStr(s.$jsstr()));
    });

    // b64decode allows str or bytes (the str should be all ascii characters)
    pyMod["b64decode"] = new Sk.builtin.func(function b64decode(s) {
        Sk.builtin.pyCheckArgs("b64decode", arguments, 1, 1);
        Sk.builtin.pyCheckType("argument", "bytes-like object or ASCII string", Sk.builtin.checkBytes(s) || Sk.builtin.checkString(s));
        return new byteString(b64.base64DecToStr(s.$jsstr()));
    });
    

    // decodestring is an alias for decodebytes only allows bytes (decodestring is legacy and removed in 3.8+)
    pyMod["decodestring"] = pyMod["decodebytes"] = new Sk.builtin.func(function decodebytes(s) {
        Sk.builtin.pyCheckArgs("b64decode", arguments, 1, 1);
        Sk.builtin.pyCheckType("argument", "bytes-like object", checkByteString(s));
        return new byteString(b64.base64DecToStr(s.$jsstr()));
    });
        

    return pyMod;
}

/*
 * TO TEST:
 * 
 *  - Methods: b64encode, b64decode
 *
 */