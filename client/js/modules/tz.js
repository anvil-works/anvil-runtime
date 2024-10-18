"use strict";

const {
    pyCall,
    pyTypeError,
    pyFunc,
    toPy,
    toJs,
    pyStr,
    pyNone,
    lookupSpecial,
    checkOneArg,
    buildPyClass,
} = require("../@Sk");
const { datetimeMod, kwsToObj } = require("../runner/py-util");

/*#
id: tz_module
docs_url: /docs/server#advanced
title: Timezone Module
description: |
  ```python
  import anvil.tz
  ```

*/

module.exports = function () {
    const pyMod = { __name__: new pyStr("anvil.tz") };
    const PyDefUtils = require("PyDefUtils");

    // N.B. We assume that none of this suspends.
    const timedelta = datetimeMod.timedelta;
    const tzinfo = datetimeMod.tzinfo;

    const s_offset = new pyStr("_offset");

    const init = (args, kws = []) => {
        checkOneArg("tzoffset", args);
        const self = args[0];
        const kwObj = kwsToObj(kws);
        const kwLen = kws.length / 2;

        if (kwLen > 1 || !(kwLen === 0 || "hours" in kwObj || "minutes" in kwObj || "seconds" in kwObj)) {
            throw new pyTypeError(
                "tzoffset must be initialised with precisely one of 'seconds', 'minutes' or 'hours' keyword arguments"
            );
        }

        const offset = pyCall(timedelta, [], kws);
        self.tp$setattr(s_offset, offset);
        return pyNone;
    };

    pyMod["tzoffset"] = buildPyClass(
        pyMod,
        (_, $loc) => {
            $loc["__init__"] = PyDefUtils.funcFastCall(init);
            $loc["utcoffset"] = new pyFunc((self) => self.tp$getattr(s_offset));
            $loc["dst"] = new pyFunc((_self) => pyCall(timedelta));
            $loc["tzname"] = new pyFunc((_self) => pyNone);
            $loc["__repr__"] = new pyFunc((self) => {
                const totalSecondsFunc = self.tp$getattr(s_offset).tp$getattr(toPy("total_seconds"));
                const modname = lookupSpecial(self, pyStr.$module);
                const name = self.tp$name;
                return toPy(`<${modname}.${name} (${toJs(pyCall(totalSecondsFunc)) / 3600} hour offset)>`);
            });
        },
        "tzoffset",
        [tzinfo]
    );

    pyMod["tzlocal"] = buildPyClass(
        pyMod,
        (_, $loc) => {
            $loc["__init__"] = new pyFunc((self) => init([self], ["minutes", toPy(-new Date().getTimezoneOffset())]));
            $loc["tzname"] = new pyFunc((_self) => toPy("Browser Local"));
        },
        "tzlocal",
        [pyMod["tzoffset"]]
    );

    pyMod["tzutc"] = buildPyClass(
        pyMod,
        (_, $loc) => {
            $loc["__init__"] = new pyFunc((self) => init([self], ["minutes", toPy(0)]));
            $loc["tzname"] = new pyFunc((_self) => toPy("UTC"));
            $loc["__repr__"] = new pyFunc((_self) => toPy("<anvil.tz.tzutc>"));
        },
        "tzlocal",
        [pyMod["tzoffset"]]
    );

    pyMod["UTC"] = pyCall(pyMod["tzutc"]);

    return pyMod;
};
