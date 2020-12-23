"use strict";

/**
id: tz_module
docs_url: /docs/server#advanced
title: Timezone Module
description: |
  ```python
  import anvil.tz
  ```

*/

module.exports = function() {

    var pyMod = {"__name__": new Sk.builtin.str("tz")};
    var PyDefUtils = require("PyDefUtils");

    // N.B. We assume that none of this suspends.
    var anvilmod = PyDefUtils.getModule("anvil");

    var datetime = Sk.importModule("datetime");
    var timedelta = datetime.tp$getattr(new Sk.builtin.str("timedelta"));

    pyMod["tzoffset"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {

        $loc["__init__"] = PyDefUtils.funcWithKwargs(function(kwargs, self) {
            if(Object.keys(kwargs).length > 1 || !(Object.keys(kwargs).length == 0|| 'hours' in kwargs || 'minutes' in kwargs || 'seconds' in kwargs)) {
                throw new Sk.builtin.Exception("tzoffset must be initialised with precisely one of 'seconds', 'minutes' or 'hours' keyword arguments");
            }

            var offset = Sk.misceval.call(timedelta, Sk.ffi.remapToPy(kwargs), undefined, []);

            self.tp$setattr(new Sk.builtin.str("_offset"), offset);
            return Sk.builtin.none.none$;
        });

        $loc["utcoffset"] = new Sk.builtin.func(function(self) {
            return self.tp$getattr(new Sk.builtin.str("_offset"));
        });

        $loc["dst"] = new Sk.builtin.func(function(self) {
            return Sk.misceval.call(timedelta);
        });

        $loc["tzname"] = new Sk.builtin.func(function(self) {
            return Sk.ffi.remapToPy("");
        });

        $loc["__repr__"] = new Sk.builtin.func(function(self) {
            var totalSecondsFunc = self.tp$getattr(new Sk.builtin.str("_offset")).tp$getattr(new Sk.builtin.str("total_seconds"));
            return Sk.ffi.remapToPy("<anvil.tz.tzoffset (" + Sk.misceval.call(totalSecondsFunc).v / 3600 + " hours)>");
        });


    }, "tzoffset", [datetime.tp$getattr(new Sk.builtin.str("tzinfo"))]);

    pyMod["tzlocal"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {

        $loc["__init__"] = new Sk.builtin.func(function(self) {
            return Sk.misceval.call(pyMod["tzoffset"].prototype["__init__"], undefined, undefined, ["minutes", Sk.ffi.remapToPy(-new Date().getTimezoneOffset())], self);
        })

        $loc["tzname"] = new Sk.builtin.func(function(self) {
            return Sk.ffi.remapToPy("Browser Local");
        });

        $loc["__repr__"] = new Sk.builtin.func(function(self) {
            var totalSecondsFunc = self.tp$getattr(new Sk.builtin.str("_offset")).tp$getattr(new Sk.builtin.str("total_seconds"));
            return Sk.ffi.remapToPy("<anvil.tz.tzlocal (" + Sk.misceval.call(totalSecondsFunc).v / 3600 + " hour offset)>");
        });

    }, "tzlocal", [pyMod["tzoffset"]]);

    pyMod["tzutc"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {

        $loc["__init__"] = new Sk.builtin.func(function(self) {
            return Sk.misceval.call(pyMod["tzoffset"].prototype["__init__"], undefined, undefined, ["minutes", Sk.ffi.remapToPy(0)], self);
        })

        $loc["tzname"] = new Sk.builtin.func(function(self) {
            return Sk.ffi.remapToPy("UTC");
        });

        $loc["__repr__"] = new Sk.builtin.func(function(self) {
            var totalSecondsFunc = self.tp$getattr(new Sk.builtin.str("_offset")).tp$getattr(new Sk.builtin.str("total_seconds"));
            return Sk.ffi.remapToPy("<anvil.tz.tzutc>");
        });

    }, "tzlocal", [pyMod["tzoffset"]]);

    pyMod["UTC"] = Sk.misceval.callsim(pyMod["tzutc"]);

    return pyMod;
}
