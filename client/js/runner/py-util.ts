import { pyStr, pyModuleNotFoundError, pyList, pyBaseException } from "../@Sk";
import type { pyObject, Kws } from "../@Sk";
import { ComponentConstructor } from "../components/Component";

export const s_add_event_handler = new pyStr("add_event_handler"),
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
    s_anvil_hooks = new pyStr("_anvil_hooks_"),
    s_dom_element = new pyStr("dom_element"),
    s_setup_dom = new pyStr("setup_dom"),
    s_set_parent = new pyStr("set_parent"),
    s_page_added = new pyStr("page_added"),
    s_page_removed = new pyStr("page_removed"),
    s_page_shown = new pyStr("page_shown"),
    s_set_data_binding_listener = new pyStr("set_data_binding_listener"),
    s_update_design_name = new pyStr("update_design_name"),
    s_get_design_info = new pyStr("get_design_info"),
    s_get_components = new pyStr("get_components"),
    s_anvil_events = new pyStr("_anvil_events_"),
    s_name = new pyStr("name"),
    s_form  = new pyStr("form"),
    s_builtin  = new pyStr("builtin"),
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

export const kwToObj = (kws?: Kws) => {
    const rv: { [argName: string]: pyObject } = {};
    if (!kws) return rv;
    for (let i = 0; i < kws.length; i += 2) {
        rv[kws[i] as string] = kws[i + 1] as pyObject;
    }
    return rv;
};

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