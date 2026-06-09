import {
    pyAsNum,
    pyBool,
    pyDict,
    pyException,
    pyFloat,
    pyInt,
    pyList,
    pyNoneType,
    pyStr,
    pyTuple,
    pyTypeError,
    toJs,
} from "@Sk";

// Remap Python to JS, with special handlers for certain types
type KeyPath = Array<string | number>;
type Wrapper = (obj: unknown, keySeq: KeyPath) => unknown;

function pythonifyPath(path: KeyPath) {
    let out = "";
    for (const segment of path) {
        out += `[${JSON.stringify(segment)}]`;
    }
    return out;
}

// Remap from python to js, extracting all non-JSON-able bits
function remapToJSWithWrapper(
    obj: unknown,
    keySeq: KeyPath,
    unknownTypeWrapper: Wrapper,
    firstLookWrapper?: Wrapper
): unknown {
    if (firstLookWrapper) {
        const w = firstLookWrapper(obj, keySeq);
        if (w !== undefined) return w;
    }
    if (obj instanceof pyDict) {
        const ret: Record<string, unknown> = {};
        for (let iter = obj.tp$iter(), k = iter.tp$iternext(); k !== undefined; k = iter.tp$iternext()) {
            if (!(k instanceof pyStr)) {
                throw new pyTypeError(
                    "Cannot use '" +
                        k.tp$name +
                        "' objects as the key in a dict when sending to a server-side module; only string keys are allowed (arguments" +
                        pythonifyPath(keySeq) +
                        ")"
                );
            }
            const jsk = toJs(k);
            keySeq.push(jsk);
            ret[jsk] = remapToJSWithWrapper(obj.mp$subscript(k), keySeq, unknownTypeWrapper, firstLookWrapper);
            keySeq.pop();
        }
        return ret;
    } else if (obj instanceof pyList || obj instanceof pyTuple) {
        const ret = [];
        const objLength = obj.v.length;
        const objArray = obj.v;
        for (let i = 0; i < objLength; i++) {
            keySeq.push(i);
            ret.push(remapToJSWithWrapper(objArray[i], keySeq, unknownTypeWrapper, firstLookWrapper));
            keySeq.pop();
        }
        return ret;
    } else if (obj instanceof pyBool) {
        return obj.v ? true : false;
    } else if (obj instanceof pyStr) {
        return obj.v;
    } else if (obj instanceof pyInt || obj instanceof pyFloat) {
        return pyAsNum(obj);
    } else if (obj instanceof pyNoneType) {
        return null;
    } else if (typeof obj === "string") {
        return obj;
    } else if (typeof obj === "object" && obj !== null && Object.getPrototypeOf(obj) === Object.prototype) {
        const ret: Record<string, unknown> = {};
        for (let i in obj) {
            const objKey = i as keyof typeof obj;
            keySeq.push(i);
            ret[i] = remapToJSWithWrapper(obj[objKey], keySeq, unknownTypeWrapper, firstLookWrapper);
            keySeq.pop();
        }
        return ret;
    } else if (obj instanceof Array) {
        const ret = [];
        for (let i = 0; i < obj.length; i++) {
            keySeq.push(i);
            ret.push(remapToJSWithWrapper(obj[i], keySeq, unknownTypeWrapper, firstLookWrapper));
            keySeq.pop();
        }
        return ret;
    } else {
        // Not JSONable
        const w = unknownTypeWrapper(obj, keySeq);
        if (w === undefined) {
            throw new pyException(
                "Cannot accept '" +
                    (obj && typeof obj === "object" && "tp$name" in obj ? obj.tp$name : typeof obj) +
                    "' object here (x" +
                    pythonifyPath(keySeq) +
                    ")"
            );
        }
        return w;
    }
}

export function remapToJs(pyObj: unknown, unknownTypeWrapper: Wrapper, firstLookWrapper?: Wrapper) {
    return remapToJSWithWrapper(pyObj, [], unknownTypeWrapper, firstLookWrapper);
}
