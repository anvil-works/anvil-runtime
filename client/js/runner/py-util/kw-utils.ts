import type { Kws, pyObject } from "@Sk";
import { toJs, toPy } from "@Sk";

/** takes a Kws array and converts to an object with pyObject values */
export function kwsToObj(kws?: Kws): Record<string, pyObject> {
    const rv: Record<string, pyObject> = {};
    if (kws === undefined) {
        return rv;
    }
    for (let i = 0; i < kws.length; i += 2) {
        rv[kws[i] as string] = kws[i + 1] as pyObject;
    }
    return rv;
}

/** takes an object with pyObject values and converts to Kws array */
export function objToKws(obj: Record<string, pyObject>): Kws {
    const rv: Kws = [];
    for (const [argName, pyVal] of Object.entries(obj ?? {})) {
        rv.push(argName, pyVal);
    }
    return rv;
}

/** takes a Kws array and converts to an object with JS values */
export function kwsToJsObj(kws?: Kws): Record<string, any> {
    const obj: Record<string, any> = {};
    if (kws === undefined) {
        return obj;
    }
    for (let i = 0; i < kws.length; i += 2) {
        obj[kws[i] as string] = toJs(kws[i + 1] as pyObject);
    }
    return obj;
}

/** takes an object with JS values and converts to Kws array */
export function jsObjToKws(obj?: Record<string, any>): Kws {
    const kws: Kws = [];
    for (const [k, v] of Object.entries(obj ?? {})) {
        kws.push(k, toPy(v));
    }
    return kws;
}
