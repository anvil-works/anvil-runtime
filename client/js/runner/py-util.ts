import {
    pyStr,
    pyModuleNotFoundError,
    pyList,
    pyBaseException,
    toPy,
    toJs,
    tryCatchOrSuspend,
    chainOrSuspend,
} from "../@Sk";
import type { pyObject, Kws, Suspension } from "../@Sk";
import type { ComponentConstructor } from "../components/Component";

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
    s_anvil_dom_element = new pyStr("_anvil_dom_element_"),
    s_anvil_setup_dom = new pyStr("_anvil_setup_dom_"),
    s_anvil_set_property_values = new pyStr("_anvil_set_property_values_"),
    s_anvil_update_design_name = new pyStr("_anvil_update_design_name_"),
    s_anvil_get_design_info = new pyStr("_anvil_get_design_info_"),
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
    s_name = new pyStr("name"),
    s_form = new pyStr("form"),
    s_builtin = new pyStr("builtin"),
    s_properties = new pyStr("properties"),
    s_clear = new pyStr("clear"),
    s_x_anvil_propagate_page_added = new pyStr("x-anvil-propagate-page-added"),
    s_x_anvil_propagate_page_removed = new pyStr("x-anvil-propagate-page-removed"),
    s_x_anvil_propagate_page_shown = new pyStr("x-anvil-propagate-page-shown");

export const getValue = (modName: string, className: string) => {
    const pyModule = Sk.sysmodules.quick$lookup(new pyStr(modName));
    if (!pyModule) {
        throw new pyModuleNotFoundError(`Could not load module ${modName}`);
    }
    return Sk.abstr.gattr<ComponentConstructor>(pyModule, new pyStr(className));
};

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
