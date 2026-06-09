import {
    Args,
    Kws,
    buildPyClass,
    checkOneArg,
    lookupSpecial,
    pyCall,
    pyCallable,
    pyFunc,
    pyNewableType,
    pyNone,
    pyObject,
    pyStr,
    pyTypeError,
    toJs,
    toPy,
} from "@Sk";
import { PyModMap, datetimeMod, funcFastCall, kwsToObj } from "../runner/py-util";

/*#
id: tz_module
docs_url: /docs/server#advanced
title: Timezone Module
description: |
  ```python
  import anvil.tz
  ```

*/

const tz = () => {
    const pyMod: PyModMap = { __name__: new pyStr("anvil.tz") };

    // N.B. We assume that none of this suspends.
    const timedelta = datetimeMod.timedelta;
    const tzinfo = datetimeMod.tzinfo as pyNewableType;

    const s_offset = new pyStr("_offset");

    const init = (args: Args<[pyObject]>, kws: Kws = []) => {
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

    const tzoffset = buildPyClass(
        pyMod,
        (_, $loc) => {
            $loc["__init__"] = funcFastCall(init);
            $loc["utcoffset"] = new pyFunc((self: pyObject) => self.tp$getattr(s_offset)!);
            $loc["dst"] = new pyFunc((_self: pyObject) => pyCall(timedelta));
            $loc["tzname"] = new pyFunc((_self: pyObject) => pyNone);
            $loc["__repr__"] = new pyFunc((self: pyObject) => {
                const totalSecondsFunc = self
                    .tp$getattr<pyCallable>(s_offset)
                    .tp$getattr<pyCallable>(toPy("total_seconds"));
                const modname = lookupSpecial(self, pyStr.$module);
                const name = self.tp$name;
                const totalSeconds = toJs(pyCall(totalSecondsFunc)) as number;
                return toPy(`<${modname}.${name} (${totalSeconds / 3600} hour offset)>`);
            });
        },
        "tzoffset",
        [tzinfo]
    );
    pyMod["tzoffset"] = tzoffset;

    const tzlocal = buildPyClass(
        pyMod,
        (_, $loc) => {
            $loc["__init__"] = new pyFunc((self: pyObject) =>
                init([self], ["minutes", toPy(-new Date().getTimezoneOffset())])
            );
            $loc["tzname"] = new pyFunc((_self: pyObject) => toPy("Browser Local"));
        },
        "tzlocal",
        [tzoffset as pyNewableType]
    );
    pyMod["tzlocal"] = tzlocal;

    const tzutc = buildPyClass(
        pyMod,
        (_, $loc) => {
            $loc["__init__"] = new pyFunc((self: pyObject) => init([self], ["minutes", toPy(0)]));
            $loc["tzname"] = new pyFunc((_self: pyObject) => toPy("UTC"));
            $loc["__repr__"] = new pyFunc((_self: pyObject) => toPy("<anvil.tz.tzutc>"));
        },
        "tzlocal",
        [tzoffset]
    );
    pyMod["tzutc"] = tzutc;

    pyMod["UTC"] = pyCall(tzutc as pyCallable);

    return pyMod;
};

export default tz;
