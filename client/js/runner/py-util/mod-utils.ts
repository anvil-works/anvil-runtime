import type { Suspension, pyAttributeError, pyModule, pyObject } from "@Sk";
import { chainOrSuspend, pyList, pyStr, retryOptionalSuspensionOrThrow } from "@Sk";

/** Retrieve a module from sys modules - @throws {pyKeyError} if not found */
export function getImportedModule(name: string) {
    const pyName = new pyStr(name);
    // retrieve the module sys.modules to account for a nested module e.g. anvil.util
    return Sk.sysmodules.mp$subscript(pyName);
}

/** gets the module from sys modules - imports the module if it's not there */
export function getModule(name: string): pyModule;
export function getModule(name: string, canSuspend: true): pyModule | Suspension;
export function getModule(name: string, canSuspend = false) {
    const pyName = new pyStr(name);
    // retrieve the module sys.modules to account for a nested module e.g. anvil.util
    const lookup = () => Sk.sysmodules.quick$lookup(pyName) as pyModule;
    const rv = lookup();
    if (rv !== undefined) return rv;
    const imported = Sk.importModule(name, false, true);
    if (canSuspend) {
        return chainOrSuspend(imported, lookup);
    } else {
        retryOptionalSuspensionOrThrow(imported);
        return lookup();
    }
}

export function importFrom<T extends pyObject = pyObject>(modName: string, attr: string) {
    const pyModule = getModule(modName);
    return Sk.abstr.gattr<T>(pyModule, new pyStr(attr));
}

interface LazyModule {
    [attr: string]: pyObject;
}

/**
 * On first attribute access, gets the module from sys module, or imports it.
 * If attribute does not exist @throws {pyAttributeError}
 * Can use `attr in lazyMod`
 */
export function pyLazyMod(modName: string) {
    let mod: pyModule;
    return new Proxy({} as LazyModule, {
        get(target, attr: string): any {
            mod ??= getModule(modName);
            return (target[attr] ??= Sk.abstr.gattr(mod, new pyStr(attr)));
        },
        set(target, attr: string, v: pyObject) {
            mod ??= getModule(modName);
            target[attr] = v;
            mod.tp$setattr(new pyStr(attr), v);
            return true;
        },
        has(target, attr) {
            mod ??= getModule(modName);
            return attr in mod.$d;
        },
    });
}

/** @throws {pyAttributeError} on attribute lookup. Can use `attr in anvilMod` */
export const anvilMod = pyLazyMod("anvil");
export const anvilServerMod = pyLazyMod("anvil.server");
export const anvilJsMod = pyLazyMod("anvil.js");
export const datetimeMod = pyLazyMod("datetime");
export const tzMod = pyLazyMod("anvil.tz");

export type PyModMap = { __all__: pyList<pyStr>; [varName: string]: pyObject };
