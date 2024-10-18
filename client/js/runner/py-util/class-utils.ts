import type { Suspension, pyCallable, pyObject, pyType } from "@Sk";
import { chainOrSuspend, pyCall, pyFunc, pyNone, pyProperty, pySuper } from "@Sk";
import { s_init_subclass } from "./interned";

/** Because buildNativeClass doesn't call __init_subclass__ */
export function initNativeSubclass(cls: pyType) {
    const superInit = new pySuper(cls, cls).tp$getattr<pyCallable>(s_init_subclass);
    return pyCall(superInit);
}

/** Allows you to write a python property from a getter and setter function */
export function pyPropertyFromGetSet<T = pyObject>(
    getter: (self: T) => pyObject | Suspension,
    setter?: (self: T, value: pyObject) => void
) {
    const pyGetter = new pyFunc((self) => getter(self));
    let pySetter;
    if (setter) {
        pySetter = new pyFunc((self, value) => chainOrSuspend(setter(self, value), () => pyNone));
    }
    return new pyProperty(pyGetter, pySetter);
}
