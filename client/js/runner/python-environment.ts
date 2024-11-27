//import * as $ from "jquery";
import { chainOrSuspend, Suspension, suspensionToPromise } from "@Sk";
import { Container } from "@runtime/components/Container";
import { setupDefaultAnvilPluggableUI } from "@runtime/modules/_anvil/pluggable-ui";
import { pyPropertyUtilsApi } from "@runtime/runner/component-property-utils-api";
import { hooks } from "@runtime/runner/index";
import * as PyDefUtils from "../PyDefUtils";
import * as componentModule from "../components";
import { Component } from "../components/Component";
import { pyDesignerApi } from "./component-designer-api";
import { registerJsPythonModules } from "./components-in-js/common";
import { AppYaml, data, DependencyYaml } from "./data";
import { uncaughtExceptions } from "./error-handling";
import { createFormTemplateClass } from "./forms";
import { setupLegacyV1AnvilModule } from "./legacy-python-environment";
import { provideLoggingImpl, stdout } from "./logging";
import { PyModMap } from "./py-util";
import { Slot, WithLayout } from "./python-objects";
import { readBuiltinFiles } from "./read-builtin-files";
import { warn } from "./warnings";

export const skulptFiles: { [filename: string]: string } = {};

let registerServerCallSuspension: null | ((s: Suspension<{ serverRequestId: string }>) => void) = null;

function builtinRead(path: string) {
    if (path in skulptFiles) {
        return skulptFiles[path];
    }
    return readBuiltinFiles(path);
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
    registerServerCallSuspension = serverModuleAndLog.registerServerCallSuspension;
    PyDefUtils.loadModule("anvil.server", serverModuleAndLog.pyMod);

    const httpModule = require("../modules/http")();
    PyDefUtils.loadModule("anvil.http", httpModule);

    const jsModule = require("../modules/js")();
    PyDefUtils.loadModule("anvil.js", jsModule);

    // server needs to have loaded first
    const historyModule = require("../modules/history").default;
    PyDefUtils.loadModule("anvil.history", historyModule);

    const imageModule = require("../modules/image")();
    PyDefUtils.loadModule("anvil.image", imageModule);

    const mediaModule = require("../modules/media")();
    PyDefUtils.loadModule("anvil.media", mediaModule);

    PyDefUtils.loadModule("anvil.code_completion_hints", require("../modules/code-completion-hints")());

    PyDefUtils.loadModule("anvil.designer", pyDesignerApi);

    PyDefUtils.loadModule("anvil.property_utils", pyPropertyUtilsApi);

    anvilModule["Slot"] = Slot;
    anvilModule["WithLayout"] = WithLayout;

    setupDefaultAnvilPluggableUI(anvilModule);

    return anvilModule;
}

function setupAppSourceCode() {
    const createModule = (pkgName: string) => {
        PyDefUtils.loadModule(pkgName, {
            __name__: new Sk.builtin.str(pkgName),
            __path__: new Sk.builtin.tuple([new Sk.builtin.str("app/" + pkgName)]),
            __package__: new Sk.builtin.str(pkgName),
        });
    };

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

    createModule(data.appPackage);

    for (const [depAppId, depApp] of Object.entries(data.app.dependency_code)) {
        if (!depApp.package_name) {
            continue;
        }

        createModule(depApp.package_name);

        if (dependencyPackageNames.indexOf(depApp.package_name) == -1) {
            fillOutModules(depApp, depApp.package_name);
            dependencyPackageNames.push(depApp.package_name);
        } else {
            const conflictingAppIds = Object.entries(data.app.dependency_code)
                .filter(([id, { package_name }]) => package_name === depApp.package_name)
                .map(([id, app]) => id);
            const errorMsg = `This app has ${
                conflictingAppIds.length
            } conflicting dependencies with the package name "${depApp.package_name}" (${conflictingAppIds.join(
                ", "
            )}).`;
            if ((data.app.runtime_options?.version ?? 0) < 3 && !data.app.runtime_options?.preview_v3) {
                warn("Warning: " + errorMsg + "This may cause errors in your app, and will be an error in future.\n");
            } else {
                dependencyErrors.push(errorMsg);
            }
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

window.anvilFormTemplates = [];

function setupAppTemplates(
    yaml: AppYaml | DependencyYaml,
    depAppId: string | null,
    appPackage: string,
    anvilModule: PyModMap
) {
    const templates = {} as PyModMap;

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
        templates[`${className}Template`] = pyTemplateClass;
    }
    if ((yaml.runtime_options?.version || 0) < 2) {
        setupLegacyV1AnvilModule(anvilModule, appPackage, templates);
    }
}

const isServerRequestSuspension = (s: Suspension): s is Suspension<{ serverRequestId: string }> =>
    s.data !== null && typeof s.data === "object" && "serverRequestId" in s.data;

PyDefUtils.suspensionHandlers["Sk.promise"] = (s: Suspension) => {
    if (isServerRequestSuspension(s)) {
        registerServerCallSuspension?.(s);
    }
    // Now fall through to the default Sk.promise suspension handler
};

export async function setupPythonEnvironment() {
    const extraOptions = hooks.getSkulptOptions?.() || {};
    Sk.configure({
        output: stdout,
        read: builtinRead,
        syspath: ["app", "anvil-services"],
        __future__: data.app.runtime_options?.client_version == "3" ? Sk.python3 : Sk.python2,
        ...extraOptions,
    });
    Sk.importSetUpPath(); // This is hack - normally happens automatically on first import

    const anvilModule = loadOrdinaryModulesReturningAnvilModule();

    // This runner *does* expose the root "Component" class
    anvilModule["Component"] = Component;
    anvilModule["Container"] = Container;

    // Inject the theme HTML assets into the HtmlTemplate component
    anvilModule["HtmlTemplate"].$_anvilThemeAssets = data.app.theme?.html || {};

    setupAppSourceCode();

    registerJsPythonModules();

    const clientInitModules: string[] = [];

    for (const depAppId of data.app.dependency_order) {
        const depApp = data.app.dependency_code[depAppId];
        if (!depApp.package_name) continue;
        setupAppTemplates(depApp, depAppId, depApp.package_name, anvilModule);

        if (depApp.client_init_module) {
            clientInitModules.push(`${depApp.package_name}.${depApp.client_init_module}`);
        }
    }

    setupAppTemplates(data.app, null, data.appPackage, anvilModule);

    if (data.app.client_init_module) {
        clientInitModules.push(`${data.appPackage}.${data.app.client_init_module}`);
    }

    if (clientInitModules.length > 0) {
        // do this after setupAppTemplates so that _anvil_designer modules are available
        await suspensionToPromise(() =>
            chainOrSuspend(null, ...clientInitModules.map((m) => () => Sk.importModule(m, false, true)))
        );
    }
}
