import { pyFunc, pyObject, pyStr, toJs, toPy } from "@Sk";
import { PyModMap } from "@runtime/runner/py-util";

const regex = () => {
    const pyMod: PyModMap = { __name__: new pyStr("re") };

    pyMod["replace"] = new pyFunc(function (pyS: pyStr, pyRegex: pyStr, pyNewSubStr: pyStr) {
        const s = toJs(pyS);
        const regex = toJs(pyRegex);
        const newSubStr = toJs(pyNewSubStr);

        const r = s.replace(new RegExp(regex, "g"), newSubStr);

        return toPy(r);
    });

    return pyMod;
};

export default regex;

/*
 * TO TEST:
 *
 *  - Methods: replace
 *
 */
