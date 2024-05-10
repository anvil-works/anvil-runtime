import { pyModule, pyNone, pyObject, pyStr, retryOptionalSuspensionOrThrow, Suspension } from "../../@Sk";
import { CustomComponentSpec, ToolboxItem, ToolboxSection } from "@runtime/components/Component";

let environmentSetupHooks: (() => void)[] | null = [];
export const registerJsPythonModules = () => {
    environmentSetupHooks?.forEach((f) => f());
};
export const addJsModuleHook = (f: () => void) => (environmentSetupHooks ? environmentSetupHooks.push(f) : f());

export const jsCustomComponents: { [name: string]: { pyMod: pyModule; spec: CustomComponentSpec } } = {};

export const customToolboxSections: ToolboxSection[] = [];

function getOrCreateModule(modName: string) {
    const pyName = new pyStr(modName);
    const maybeModule = Sk.sysmodules.quick$lookup(pyName);
    if (maybeModule) return maybeModule;
    let mod;
    try {
        mod = Sk.importModule(modName, false, true);
    } catch (e) {
        mod = new pyModule();
        mod.init$dict(pyName, pyNone);
    }
    if (mod instanceof Suspension) {
        mod = retryOptionalSuspensionOrThrow(mod);
    }
    Sk.sysmodules.mp$ass_subscript(pyName, mod);
    return mod;
}

export function registerModule(modName: string, attributes: { [attr: string]: pyObject }, spec: CustomComponentSpec) {
    addJsModuleHook(() => {
        const pyMod = getOrCreateModule(modName);
        Object.assign(pyMod.$d, attributes);
        jsCustomComponents[modName] = { pyMod, spec };
    });
}
