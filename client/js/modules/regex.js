"use strict";

module.exports = function() {

    var pyMod = {"__name__": new Sk.builtin.str("re")};

    pyMod["replace"] = new Sk.builtin.func(function(pyS, pyRegex, pyNewSubStr) {
        var s = Sk.ffi.remapToJs(pyS);
        var regex = Sk.ffi.remapToJs(pyRegex);
        var newSubStr = Sk.ffi.remapToJs(pyNewSubStr);

        var r = s.replace(new RegExp(regex, 'g'), newSubStr);

        return Sk.ffi.remapToPy(r);
    });

    return pyMod;
}

/*
 * TO TEST:
 * 
 *  - Methods: replace
 *
 */