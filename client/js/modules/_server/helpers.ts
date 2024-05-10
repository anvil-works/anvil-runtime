import { isTrue, pyCall, pyIsInstance, pyStr, pyTypeError } from "@Sk";
import { anvilServerMod, datetimeMod, tzMod } from "@runtime/runner/py-util";
import type { NonJson, Path } from "./types";

export interface DTHelper {
    dateFromIso: any;
    datetimeFromIso: any;
    strftime: any;
    replace: any;
    datetimeFmt: any;
    datetimeFmtTz: any;
    dateFmt: any;
}

export const DT: DTHelper = {
    get dateFromIso() {
        delete this.dateFromIso;
        return (this.dateFromIso = datetimeMod["date"].tp$getattr(INTERNED.fromisoformat));
    },
    get datetimeFromIso() {
        delete this.datetimeFromIso;
        return (this.datetimeFromIso = datetimeMod["datetime"].tp$getattr(INTERNED.fromisoformat));
    },
    get strftime() {
        delete this.strftime;
        return (this.strftime = datetimeMod["date"].tp$getattr(INTERNED.strftime));
    },
    get replace() {
        delete this.replace;
        return (this.replace = datetimeMod["datetime"].tp$getattr(INTERNED.replace));
    },
    datetimeFmt: new pyStr("%Y-%m-%d %H:%M:%S.%f"),
    datetimeFmtTz: new pyStr("%Y-%m-%d %H:%M:%S.%f%z"),
    dateFmt: new pyStr("%Y-%m-%d"),
};

export const TZ: { tzoffset: any } = {
    get tzoffset() {
        delete this.tzoffset;
        return (this.tzoffset = tzMod["tzoffset"]);
    },
};

const strsToIntern = [
    "__serialize__",
    "__new_deserialized__",
    "__deserialize__",
    "fromisoformat",
    "get_content_type",
    "get_bytes",
    "get_name",
    "replace",
    "strftime",
    "tzinfo",
    "update",
    "utcoffset",
];

export const INTERNED = Object.fromEntries(strsToIntern.map((x) => [x, new pyStr(x)]));

export function pythonifyPath(path: Path) {
    return path.map((p) => "[" + JSON.stringify(p) + "]").join("");
}

export function pyBytesOrStr2ab(pyBytesVal: string | Uint8Array) {
    if (typeof pyBytesVal !== "string") {
        return pyBytesVal.buffer;
    }
    const str = pyBytesVal;
    const buf = new ArrayBuffer(str.length); // 1 byte for each char
    const bufView = new Uint8Array(buf);
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c > 255) {
            throw new Sk.builtin.ValueError("Cannot encode unicode character for transfer to server");
        }
        bufView[i] = c;
    }
    return buf;
}

export function throwNonStrKey(key: any, path: Path) {
    const msg = `Cannot use '${
        key.tp$name
    }' objects as the key in a dict when sending to a server-side module; only string keys are allowed (arguments ${pythonifyPath(
        path
    )})`;
    throw new pyTypeError(msg);
}

export function throwSerializationError(mapping: NonJson) {
    // We can tell the user where the bad object was!
    const name = mapping.value?.tp$name ?? "unexpected";
    const msg = `Cannot pass ${name} object to a server function: arguments ${pythonifyPath(mapping.path.slice(1))}`;
    throw pyCall(anvilServerMod["SerializationError"], [new pyStr(msg)]);
}

export function assertIsPy(mapping: NonJson) {
    if (!mapping.value?.sk$object) {
        throwSerializationError(mapping);
    }
}

export function isInstance(pyV: any, pyType: any) {
    return isTrue(pyIsInstance(pyV, pyType));
}
