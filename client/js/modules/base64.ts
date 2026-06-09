import {
    checkBytes,
    checkString,
    pyBytes,
    pyCheckArgs,
    pyCheckType,
    pyFunc,
    pyNotImplementedError,
    pyObject,
    pyStr,
} from "@Sk";
import * as b64 from "../lib/b64";

const base64 = () => {
    const pyMod: Record<string, pyObject> = { __name__: new pyStr("base64") };
    const toBase64Input = (s: pyBytes | pyStr) => s.$jsstr();

    const ni = new pyFunc(function () {
        throw new pyNotImplementedError(
            "The 'base64' module in Anvil forms is limited to simple use of b64encode() and b64decode(). For full functionality, use a server module."
        );
    });

    pyMod["b32encode"] = ni;
    pyMod["b32decode"] = ni;
    pyMod["b16encode"] = ni;
    pyMod["b16decode"] = ni;

    pyMod["encode"] = ni;
    pyMod["decode"] = ni;

    let byteString: typeof pyBytes | typeof pyStr;
    let checkByteString: (value: unknown) => boolean;
    if (Sk.__future__.python3) {
        byteString = pyBytes;
        checkByteString = checkBytes;
    } else {
        byteString = pyStr;
        checkByteString = checkString;
    }

    pyMod["b64encode"] =
        pyMod["encodebytes"] =
        pyMod["encodestring"] =
            new pyFunc(function (s: pyBytes | pyStr) {
                pyCheckArgs("b64encode", arguments, 1, 1);
                pyCheckType("argument", "bytes-like object", checkByteString(s));
                return new byteString(b64.base64EncStr(toBase64Input(s)));
            });

    // b64decode allows str or bytes (the str should be all ascii characters)
    pyMod["b64decode"] = new pyFunc(function b64decode(s: pyBytes | pyStr) {
        pyCheckArgs("b64decode", arguments, 1, 1);
        pyCheckType("argument", "bytes-like object or ASCII string", checkBytes(s) || checkString(s));
        return new byteString(b64.base64DecToStr(toBase64Input(s)));
    });

    // decodestring is an alias for decodebytes only allows bytes (decodestring is legacy and removed in 3.8+)
    pyMod["decodestring"] = pyMod["decodebytes"] = new pyFunc(function decodebytes(s: pyBytes | pyStr) {
        pyCheckArgs("decodebytes", arguments, 1, 1);
        pyCheckType("argument", "bytes-like object", checkByteString(s));
        return new byteString(b64.base64DecToStr(toBase64Input(s)));
    });

    return pyMod;
};

export default base64;

/*
 * TO TEST:
 *
 *  - Methods: b64encode, b64decode
 *
 */
