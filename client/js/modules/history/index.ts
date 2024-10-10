import { pyAttributeError, pyCall, pyStr, setUpModuleMethods, toPy } from "@Sk";
import { anvilServerMod } from "@runtime/runner/py-util";
import { Location, makeHashHistory, makeHistory } from "./pymod";

const pyMod = {
    __name__: new pyStr("anvil.history"),
    __all__: toPy(["Location", "history", "hash_history"]),
    Location,
};

if (!ANVIL_IN_DESIGNER) {
    pyCall(anvilServerMod["portable_class"], [Location]);
}

let pyHistory;
let pyHashHistory;

setUpModuleMethods("anvil.history", pyMod, {
    __getattr__: {
        $meth(name) {
            const jsName = name.toString();
            if (jsName === "history") {
                // do these lazily so as to avoid messing with the history state
                return (pyHistory ??= makeHistory());
            } else if (jsName === "hash_history") {
                return (pyHashHistory ??= makeHashHistory());
            } else {
                throw new pyAttributeError(name);
            }
        },
        $flags: { OneArg: true },
    },
});

export default pyMod;
