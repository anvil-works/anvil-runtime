// Remap Python to JS, with special handlers for certain types
function pythonifyPath(path) {
    var s = "";
    for (var i in path) {
        s += "[" + JSON.stringify(path[i]) + "]";
    }
    return s;
}

// Remap from python to js, extracting all non-JSON-able bits
function remapToJSWithWrapper(obj, keySeq, unknownTypeWrapper, firstLookWrapper) {
    if (firstLookWrapper) {
        var w = firstLookWrapper(obj, keySeq);
        if (w !== undefined) return w;
    }
    if (obj instanceof Sk.builtin.dict) {
        var ret = {};
        for (var iter = obj.tp$iter(), k = iter.tp$iternext(); k !== undefined; k = iter.tp$iternext()) {
            if (!(k instanceof Sk.builtin.str)) {
                throw new Sk.builtin.TypeError(
                    "Cannot use '" +
                        k.tp$name +
                        "' objects as the key in a dict when sending to a server-side module; only string keys are allowed (arguments" +
                        pythonifyPath(keySeq) +
                        ")"
                );
            }
            var jsk = Sk.ffi.toJs(k);
            keySeq.push(jsk);
            ret[jsk] = remapToJSWithWrapper(obj.mp$subscript(k), keySeq, unknownTypeWrapper, firstLookWrapper);
            keySeq.pop();
        }
        return ret;
    } else if (obj instanceof Sk.builtin.list || obj instanceof Sk.builtin.tuple) {
        const ret = [];
        for (var i = 0; i < obj.v.length; i++) {
            keySeq.push(i);
            ret.push(remapToJSWithWrapper(obj.v[i], keySeq, unknownTypeWrapper, firstLookWrapper));
            keySeq.pop();
        }
        return ret;
    } else if (obj instanceof Sk.builtin.bool) {
        return obj.v ? true : false;
    } else if (obj instanceof Sk.builtin.str) {
        return obj.v;
    } else if (obj instanceof Sk.builtin.int_ || obj instanceof Sk.builtin.float_) {
        return Sk.builtin.asnum$(obj);
    } else if (obj instanceof Sk.builtin.none) {
        return null;
    } else if (typeof obj === "string") {
        return obj;
    } else if (typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype) {
        const ret = {};
        for (let i in obj) {
            keySeq.push(i);
            ret[i] = remapToJSWithWrapper(obj[i], keySeq, unknownTypeWrapper, firstLookWrapper);
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
            throw new Sk.builtin.Exception(
                "Cannot accept '" +
                    (obj && obj.tp$name ? obj.tp$name : typeof obj) +
                    "' object here (x" +
                    pythonifyPath(keySeq) +
                    ")"
            );
        }
        return w;
    }
}

export function remapToJs(pyObj, unknownTypeWrapper, firstLookWrapper) {
    return remapToJSWithWrapper(pyObj, [], unknownTypeWrapper, firstLookWrapper);
}
