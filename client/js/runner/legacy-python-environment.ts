import { chainOrSuspend, pyAttributeError, pyCall, pyFunc, pyList, pyModule, pyNone, pyStr } from "@Sk";
import * as PyDefUtils from "PyDefUtils";
import { data } from "./data";
import { PyModMap } from "./py-util";

const LazyServiceModule = Sk.misceval.buildClass(
    {},
    ($gbl, $loc) => {
        $loc.__getattr__ = new pyFunc((self, pyName) => {
            // on first touch actually import the real module
            // then forward attr requests to the real module
            let lazyImport;
            const pyModName = self.$d.__name__;
            const modName = pyModName.toString();
            if (Sk.sysmodules.quick$lookup(pyModName) === self) {
                Sk.abstr.objectDelItem(Sk.sysmodules, pyModName);
                lazyImport = Sk.importModule(modName, false, true);
            }
            return chainOrSuspend(
                lazyImport,
                () => {
                    const gblMod = Sk.sysmodules.quick$lookup(pyModName);
                    return gblMod?.tp$getattr(pyName, true);
                },
                (rv) => {
                    if (rv === undefined) {
                        throw new pyAttributeError(pyName.toString());
                    }
                    return rv;
                }
            );
        });
    },
    "lazyServiceModule",
    [pyModule]
);

function createLazyServiceModule(name: string, source: string) {
    // Because the anvil module is per App
    // if we import an anvil service after setting up AppPackage.anvil
    // then things like __package__ will be wrong and can mess up imports in dependencies
    // we would also re-compile the module for dependencies
    const pyModName = new pyStr("anvil." + name);
    const mod = new LazyServiceModule();
    mod.init$dict(pyModName, pyNone);
    mod.$d.__package__ = pyModName;
    mod.$d.__file__ = new pyStr(source);
    Sk.abstr.objectSetItem(Sk.sysmodules, pyModName, mod);
    return mod;
}

const serviceMap = new Map([
    ["tables", ""],
    ["users", "anvil/"],
    ["email", "anvil/"],
    ["google", ""],
    ["microsoft", "anvil/"],
    ["facebook", ""],
    ["saml", "anvil/"],
]);

let lazyServicesLoaded = false;
function createLazyServices(globalAnvilModule: PyModMap) {
    if (lazyServicesLoaded) return;
    lazyServicesLoaded = true;

    const services = data.app.services;

    for (const [modName, prefix] of serviceMap.entries()) {
        if (modName in globalAnvilModule) continue;
        const modSource = `/runtime/services/${prefix}${modName}.yml`;
        if (!services?.some(({ source }) => source === modSource)) continue;
        globalAnvilModule[modName] = createLazyServiceModule(modName, modSource);
    }
}

function makePerAppAnvilModule(globalAnvilModule: PyModMap, packageName: string, templateMap: PyModMap) {
    templateMap.__all__ = new pyList(
        [...Object.keys(globalAnvilModule).filter((s) => !s.startsWith("_")), ...Object.keys(templateMap)].map(
            (s) => new pyStr(s)
        )
    );

    const anvilModule = new Proxy(templateMap, {
        get(t, p: string) {
            return t[p] ?? globalAnvilModule[p];
        },
        set(t, p, v) {
            if (typeof p === "string") {
                if (p in t) {
                    t[p] = v;
                } else {
                    globalAnvilModule[p] = v;
                }
            }
            return true;
        },
    });

    PyDefUtils.loadModule(packageName + ".anvil", anvilModule);
}

function copyAnvilModulesToSysModules(packageName: string) {
    const sysModulesCopy = pyCall(Sk.sysmodules.tp$getattr(new pyStr("copy"))) as typeof Sk.sysmodules;
    const jsModNames = Sk.abstr.iter(sysModulesCopy);
    for (let modName = jsModNames.tp$iternext(); modName !== undefined; modName = jsModNames.tp$iternext()) {
        if (modName.toString().startsWith("anvil.")) {
            const pyMod = Sk.sysmodules.mp$subscript(modName);
            Sk.abstr.objectSetItem(Sk.sysmodules, new pyStr(packageName + "." + modName), pyMod);
        }
    }
}

export function setupLegacyV1AnvilModule(globalAnvilModule: PyModMap, packageName: string, templateMap: PyModMap) {
    // Runtime v1 and below uses a really grotty mechanism for getting form templates.
    // We use prototypical inheritance to give each app a slightly different
    // view of the 'anvil' module, with its own form templates in.
    makePerAppAnvilModule(globalAnvilModule, packageName, templateMap);
    createLazyServices(globalAnvilModule);
    copyAnvilModulesToSysModules(packageName);
}
