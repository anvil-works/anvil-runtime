import type { Args, Kws, Suspension, pyAttributeError, pyCallable, pyModule, pyObject, pyType } from "@Sk";
import {
    chainOrSuspend,
    promiseToSuspension,
    pyBaseException,
    pyCall,
    pyFunc,
    pyList,
    pyStr,
    pySuper,
    retryOptionalSuspensionOrThrow,
    toJs,
    toPy,
    tryCatchOrSuspend,
} from "@Sk";
import { Deferred, defer } from "@runtime/utils";

export const s_add_event_handler = new pyStr("add_event_handler"),
    s_remove_event_handler = new pyStr("remove_event_handler"),
    s_add_component = new pyStr("add_component"),
    s_remove_from_parent = new pyStr("remove_from_parent"),
    s_raise_event = new pyStr("raise_event"),
    s_parent = new pyStr("parent"),
    s_slots = new pyStr("slots"),
    s_slot = new pyStr("slot"),
    s_layout = new pyStr("layout"),
    s_item = new pyStr("item"),
    s_refresh_data_bindings = new pyStr("refresh_data_bindings"),
    s_refreshing_data_bindings = new pyStr("refreshing_data_bindings"),
    s_init = new pyStr("__init__"),
    s_new = new pyStr("__new__"),
    s_init_subclass = new pyStr("__init_subclass__"),
    s_setattr = new pyStr("__setattr__"),
    s_get_attribute = new pyStr("__getattribute__"),
    s_anvil_dom_element = new pyStr("_anvil_dom_element_"),
    s_anvil_setup_dom = new pyStr("_anvil_setup_dom_"),
    s_anvil_set_property_values = new pyStr("_anvil_set_property_values_"),
    s_anvil_update_design_name = new pyStr("_anvil_update_design_name_"),
    s_anvil_get_container_design_info = new pyStr("_anvil_get_container_design_info_"),
    s_anvil_update_layout_properties = new pyStr("_anvil_update_layout_properties_"),
    s_anvil_get_sections = new pyStr("_anvil_get_sections_"),
    s_anvil_get_section_dom_element = new pyStr("_anvil_get_section_dom_element_"),
    s_anvil_set_section_property_values = new pyStr("_anvil_set_section_property_values_"),
    s_anvil_enable_drop_mode = new pyStr("_anvil_enable_drop_mode_"),
    s_anvil_disable_drop_mode = new pyStr("_anvil_disable_drop_mode_"),
    s_set_parent = new pyStr("set_parent"),
    s_page_added = new pyStr("page_added"),
    s_page_removed = new pyStr("page_removed"),
    s_page_shown = new pyStr("page_shown"),
    s_set_data_binding_listener = new pyStr("set_data_binding_listener"),
    s_get_components = new pyStr("get_components"),
    s_anvil_events = new pyStr("_anvil_events_"),
    s_anvil_properties = new pyStr("_anvil_properties_"),
    s_anvil_get_interactions = new pyStr("_anvil_get_interactions_"),
    s_anvil_get_unset_property_values = new pyStr("_anvil_get_unset_property_values_"),
    s_name = new pyStr("name"),
    s_form = new pyStr("form"),
    s_builtin = new pyStr("builtin"),
    s_properties = new pyStr("properties"),
    s_clear = new pyStr("clear"),
    s_notify_mounted_by_parent = new pyStr("_notify_mounted_by_parent"),
    s_notify_visibility_change = new pyStr("_notify_visibility_change"),
    s_x_anvil_page_added = new pyStr("x-anvil-page-added"),
    s_x_anvil_page_removed = new pyStr("x-anvil-page-removed"),
    s_x_anvil_page_shown = new pyStr("x-anvil-page-shown"),
    s_x_anvil_page_hidden = new pyStr("x-anvil-page-hidden"),
    s_x_anvil_classic_show = new pyStr("x-anvil-classic-show"),
    s_x_anvil_classic_hide = new pyStr("x-anvil-classic-hide"),
    s_show = new pyStr("show"),
    s_hide = new pyStr("hide"),
    s_update = new pyStr("update"),
    s_setdefault = new pyStr("setdefault");

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

/** takes a Kws array and converts to an object where values are pyObjects */
export const kwToObj = (kws?: Kws) => {
    const rv: { [argName: string]: pyObject } = {};
    if (!kws) return rv;
    for (let i = 0; i < kws.length; i += 2) {
        rv[kws[i] as string] = kws[i + 1] as pyObject;
    }
    return rv;
};

/** takes an object with values as pyObject and converts to Kws array */
export const objToKw = (obj: { [argName: string]: pyObject }) => {
    const rv: Kws = [];
    for (const [argName, pyVal] of Object.entries(obj)) {
        rv.push(argName, pyVal);
    }
    return rv;
};

export type PyModMap = { __all__: pyList<pyStr>; [varName: string]: pyObject };

export const strError = (err: any) =>
    typeof err === "string" ? err : err instanceof Sk.builtin.BaseException ? err.toString() : "<Internal error>";

export function reportError(err: pyBaseException) {
    // @ts-ignore
    window.onerror(null, null, null, null, err);
}

/** takes a JS object and converts to Kws array */
export const objectToKwargs = (obj?: { [key: string]: any }) => {
    const kwargs: Kws = [];
    for (const [k, v] of Object.entries(obj || {})) {
        kwargs.push(k, toPy(v));
    }
    return kwargs;
};

/** takes a JS object and converts all values to Python */
export const objectToPyMap = (obj?: { [key: string]: any }) =>
    Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, toPy(v)]));

/** takes a Kws array and converts to an object where values are pyObjects */
export const kwargsToPyMap = (kws?: Kws) => {
    const obj: { [key: string]: pyObject } = {};
    if (kws === undefined) return obj;
    for (let i = 0; i < kws.length; i += 2) {
        obj[kws[i] as string] = kws[i + 1] as pyObject;
    }
    return obj;
};

/** takes a Kws array and converts to Js object (with JS Values) */
export const kwargsToJsObject = (kws?: Kws) => {
    const obj: any = {};
    if (kws === undefined) {
        return obj;
    }
    for (let i = 0; i < kws.length; i += 2) {
        obj[kws[i] as string] = toJs(kws[i + 1] as pyObject);
    }
    return obj;
};

/** takes an object with values as pyObject and converts to Kws array */
export const pyMapToKwargs = (obj: { [name: string]: pyObject }) => {
    const kwargs: Kws = [];
    for (const [k, v] of Object.entries(obj)) {
        kwargs.push(k, v);
    }
    return kwargs;
};

export function pyTryFinally<T>(f: () => T | Suspension, doFinally: () => void) {
    let completed = false,
        result: T;
    return tryCatchOrSuspend(
        () =>
            chainOrSuspend(
                f(),
                (rv) => {
                    completed = true;
                    result = rv;
                    return doFinally();
                },
                () => result
            ),
        (e) =>
            chainOrSuspend(!completed && doFinally(), () => {
                throw e;
            })
    );
}

class LazySuspension {
    _complete = false;
    _deferred: null | Deferred<null> = null;
    _suspension: null | Suspension = null;
    get suspension() {
        if (this._complete) return null;
        this._deferred ??= defer();
        this._suspension ??= promiseToSuspension(this._deferred.promise);
        return this._suspension;
    }
    done() {
        this._complete = true;
        this._deferred?.resolve(null);
    }
}

export class Mutex {
    _prev: LazySuspension | null = null;
    withLock<T>(runFn: () => T | Suspension) {
        const prev = this._prev;
        const curr = new LazySuspension();
        this._prev = curr;
        return () =>
            pyTryFinally(
                () => chainOrSuspend(prev?.suspension, runFn),
                () => curr.done()
            );
    }
    runWithLock<T>(runFn: () => T | Suspension) {
        return this.withLock(runFn)();
    }
}

export function funcFastCall<T extends pyObject | Suspension, A extends Args>(f: (args: A, kws?: Kws) => T) {
    // @ts-ignore
    f.co_fastcall = 1;
    return new pyFunc(f);
}

/** Because buildNativeClass doesn't call __init_subclass__ */
export function initNativeSubclass(cls: pyType) {
    const superInit = new pySuper(cls, cls).tp$getattr<pyCallable>(s_init_subclass);
    return pyCall(superInit);
}
