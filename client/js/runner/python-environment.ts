//import * as $ from "jquery";
import {provideLoggingImpl, stdout} from "./logging";
import {AppYaml, data, DependencyYaml} from "./data";
import {uncaughtExceptions} from "./error-handling";
import * as componentModule from "../components";
import * as PyDefUtils from "../PyDefUtils";
import {createFormTemplateClass} from "./forms";
import {PyModMap} from "./py-util";
import {pyCall, pyList, pyObject, pyStr} from "../@Sk";
import {Component} from "../components/Component";
import {runPostSetupHooks} from "./components-in-js/common";
import {pyDesignerApi} from "./component-designer-api";
import { Container } from "@runtime/components/Container";
import {pyPropertyUtilsApi} from "@runtime/runner/component-property-utils-api";

export const skulptFiles: {[filename:string]: string} = {};


function builtinRead(path: string) {
    if (path in skulptFiles) {
        return skulptFiles[path];
    }

    const file = Sk.builtinFiles?.files[path];
    if (file === undefined) {
        throw "File not found: '" + path + "'";
    } else if (typeof file === "number") {
        // slow path we need to do a fetch
        return Sk.misceval.promiseToSuspension(
            new Promise((resolve, reject) => {
                // while we support IE don't use fetch since fetch is not polyfilled by core-js
                const xhr = new XMLHttpRequest();
                // this variable is created in runner.html - we create it there so that a sha can be added
                // when this file includes a sha value it can be aggressively cached by the browser
                
                // this is undefined when this module first loads since the runner is loaded before we set window.anvilSkulptLib
                
                const fetchUrl = window.anvilSkulptLib[file];
                xhr.open("GET", fetchUrl, true);
                xhr.onload = function () {
                    const newFiles = JSON.parse(this.responseText);
                    Object.assign(Sk.builtinFiles.files, newFiles);
                    resolve(newFiles[path]);
                };
                xhr.onerror = reject;
                xhr.send();
            })
        );
    } else {
        return file;
    }
}


function loadOrdinaryModulesReturningAnvilModule() {
    const anvilModule = require("../modules/anvil")(data.appOrigin, uncaughtExceptions);

    componentModule.defineSystemComponents(anvilModule);

    PyDefUtils.loadModule("anvil", anvilModule);

    // Preload all modules we will ever load under the "anvil" package now, because we might need to duplicate
    // them later for v1 runtime apps

    const base64Module = require("../modules/base64")();
    PyDefUtils.loadModule("base64", base64Module);

    const xmlModule = require("../modules/xml")();
    PyDefUtils.loadModule("anvil.xml", xmlModule);

    const reModule = require("../modules/regex")();
    PyDefUtils.loadModule("anvil.regex", reModule);

    const tzModule = require("../modules/tz")();
    PyDefUtils.loadModule("anvil.tz", tzModule);

    const shapesModule = require("../modules/shapes")();
    PyDefUtils.loadModule("anvil.shapes", shapesModule);

    const serverModuleAndLog = require("../modules/server")(data.appId, data.appOrigin);
    provideLoggingImpl(serverModuleAndLog.log);
    PyDefUtils.loadModule("anvil.server", serverModuleAndLog.pyMod);

    const httpModule = require("../modules/http")();
    PyDefUtils.loadModule("anvil.http", httpModule);

    const jsModule = require("../modules/js")();
    PyDefUtils.loadModule("anvil.js", jsModule);

    const imageModule = require("../modules/image")();
    PyDefUtils.loadModule("anvil.image", imageModule);

    const mediaModule = require("../modules/media")();
    PyDefUtils.loadModule("anvil.media", mediaModule);

    PyDefUtils.loadModule("anvil.code_completion_hints", require("../modules/code-completion-hints")());

    PyDefUtils.loadModule("anvil.designer", pyDesignerApi);

    PyDefUtils.loadModule("anvil.property_utils", pyPropertyUtilsApi);

    // TODO there are more elegant ways to do this! (I think we just need to include "anvil.tables" in the preloadModules)
    try {
        Sk.misceval.retryOptionalSuspensionOrThrow(Sk.importModule("anvil.tables", false, true));
    } catch (e) {
        console.log("Failed to preload anvil.tables", e);
    }

    return anvilModule;
}

function setupAppSourceCode() {
    const getFilePath = (name: string, isPackage: boolean | undefined, topLevelPackage: string) =>
        "app/" + topLevelPackage + "/" + name.replace(/\./g, "/") + (isPackage ? "/__init__.py" : ".py");

    const fillOutModules = (app: AppYaml | DependencyYaml, topLevelPackage: string) => {
        for (const f of app.forms || []) {
            skulptFiles[getFilePath(f.class_name, f.is_package, topLevelPackage)] = f.code;
        }

        for (const m of app.modules || []) {
            skulptFiles[getFilePath(m.name, m.is_package, topLevelPackage)] = m.code;
        }
    };

    const dependencyErrors = [];
    const dependencyPackageNames = [];
    const dataBindingCompilations = {};

    for (const [depAppId, depApp] of Object.entries(data.app.dependency_code)) {
        if (!depApp.package_name) { continue; }

        if (dependencyPackageNames.indexOf(depApp.package_name) == -1) {
            fillOutModules(depApp, depApp.package_name);
            dependencyPackageNames.push(depApp.package_name);
        } else {
            dependencyErrors.push(`Cannot have two dependencies with the same package name: ${depApp.package_name}`);
        }
    }

    if (dependencyPackageNames.indexOf(data.appPackage) == -1) {
        fillOutModules(data.app, data.appPackage);
    } else {
        dependencyErrors.push(`App cannot have the same package name as one of its dependencies: ${data.appPackage}`);
    }
    if (dependencyErrors.length !== 0) {
        throw new Sk.builtin.Exception(dependencyErrors.join("\n"));
    }
}

function makePerAppAnvilModule(globalAnvilModule: PyModMap, packageName: string) {

    const anvilModule = $.extend({}, globalAnvilModule);

    // By default templates with _ prefixes won't get imported by "from anvil import *", so we set __all__
    anvilModule["__all__"] = new pyList(Object.keys(anvilModule).map((s) => new pyStr(s)));

    PyDefUtils.loadModule(packageName + ".anvil", anvilModule);
    const sysModulesCopy = pyCall(Sk.sysmodules.tp$getattr(new pyStr("copy"))) as typeof Sk.sysmodules;
    const jsModNames = Sk.abstr.iter(sysModulesCopy);
    for (let modName = jsModNames.tp$iternext(); modName !== undefined; modName = jsModNames.tp$iternext()) {
        if (modName.toString().startsWith("anvil.")) {
            const pyMod = Sk.sysmodules.mp$subscript(modName);
            if (pyMod.$d) {
                PyDefUtils.loadModule(packageName + "." + modName, pyMod.$d);
            } else {
                // anvil.js.window is in sysmodules but is not a module object
                // so just set it in sysmodules with adjusted path
                Sk.abstr.objectSetItem(Sk.sysmodules, new Sk.builtin.str(packageName + "." + modName), pyMod);
            }
            //console.log("Copying", modName.$jsstr(), "for", packageName);
        }
    }

    return anvilModule;
}

window.anvilFormTemplates = [];

function setupAppTemplates(
    yaml: AppYaml | DependencyYaml,
    depAppId: string | null,
    appPackage: string,
    anvilModule: PyModMap
) {
    PyDefUtils.loadModule(appPackage, {
        __name__: new Sk.builtin.str(appPackage),
        __path__: new Sk.builtin.tuple([new Sk.builtin.str("app/" + appPackage)]),
        __package__: new Sk.builtin.str(appPackage),
    });

    // Runtime v1 and below uses a really grotty mechanism for getting form templates.
    // We use prototypical inheritance to give each app a slightly different
    // view of the 'anvil' module, with its own form templates in.

    const perAppAnvilModule =
        (yaml.runtime_options?.version || 0) < 2 && makePerAppAnvilModule(anvilModule, appPackage);

    for (const form of yaml.forms || []) {
        // In newer (v2+) apps, we build an "_anvil_designer" module in each package with the form
        // templates in. Because Skulpt doesn't know how to load prebuilt module objects as children of
        // parsed-and-compiled packages, we create it in the grossest way you can think of:
        // by building the JS source with regexes. To minimise grossness, the generated source pulls prebuilt
        // class objects from the global scope.

        const dots = form.class_name.split(".");
        const className = dots[dots.length - 1];
        if (!form.is_package) {
            dots.pop();
        }
        const packageName = dots.join(".");
        const packagePath = dots.join("/") + (dots.length ? "/" : "");

        const templateModulePath = `app/${appPackage}/${packagePath}_anvil_designer.js`;
        const templateModule =
            skulptFiles[templateModulePath] || "function $builtinmodule(mod) { /*INSERT*/ return mod; };";
        //@ts-ignore nasty way to communicate with generated JS
        const aft = window.anvilFormTemplates;
        skulptFiles[templateModulePath] = templateModule.replace(
            /\/\*INSERT\*\//,
            `/*INSERT*/ mod['${className}Template'] = window.anvilFormTemplates[${aft.length}];`
        );

        const pyTemplateClass = createFormTemplateClass(form, depAppId, className, anvilModule);
        aft[aft.length] = pyTemplateClass;
        if (perAppAnvilModule) {
            perAppAnvilModule[`${className}Template`] = pyTemplateClass;
            perAppAnvilModule["__all__"].v.push(new pyStr(`${className}Template`));
        }
    }
}


export function setupPythonEnvironment(preloadModules: string[]) {

    Sk.configure({
        output: stdout,
        read: builtinRead,
        syspath: ["app", "anvil-services"],
        __future__: (data.app.runtime_options?.client_version == "3") ? Sk.python3 : Sk.python2,
    });
    Sk.importSetUpPath(); // This is hack - normally happens automatically on first import

    const anvilModule = loadOrdinaryModulesReturningAnvilModule();

    // This runner *does* expose the root "Component" class
    anvilModule["Component"] = Component;
    anvilModule["Container"] = Container;

    // Inject the theme HTML assets into the HtmlTemplate component
    anvilModule["HtmlTemplate"].$_anvilThemeAssets = data.app.theme?.html || {};

    for (const pm of (preloadModules || [])) {
        Sk.misceval.retryOptionalSuspensionOrThrow(Sk.importModule(pm, false, true));
    }


    setupAppSourceCode();

    runPostSetupHooks();

    for (const [depAppId, depApp] of Object.entries(data.app.dependency_code)) {

        if (!depApp.package_name)
            continue;

        setupAppTemplates(depApp, depAppId, depApp.package_name, anvilModule);
    }

    setupAppTemplates(data.app, null, data.appPackage, anvilModule);

}