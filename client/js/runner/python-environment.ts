//import * as $ from "jquery";
import { chainOrSuspend, pyObject, Suspension, suspensionToPromise } from "@Sk";
import { Container } from "@runtime/components/Container";
import { hooks } from "@runtime/runner/data";
import { HtmlComponent } from "@runtime/components/HtmlComponent";
import PyDefUtils from "PyDefUtils";
import { Component } from "../components/Component";
import { registerJsPythonModules } from "./components-in-js/common";
import { TreeMapContent, data } from "./data";
import { createFormTemplateClass } from "./forms";
import { setupLegacyV1AnvilModule } from "./legacy-python-environment";
import loadOrdinaryModulesReturningAnvilModule, { registerServerCallSuspension } from "./load-modules";
import { stdout } from "./logging";
import { PyModMap } from "./py-util";
import { readBuiltinFiles } from "./read-builtin-files";
import { warn } from "./warnings";

export const skulptFiles: { [filename: string]: string } = {};

function builtinRead(path: string) {
    if (path in skulptFiles) {
        return skulptFiles[path];
    }
    return readBuiltinFiles(path);
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

    const fillOutModules = (app: TreeMapContent, topLevelPackage: string) => {
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

const TEMPLATE_MODULE_BODY = `function $builtinmodule(mod) {
    mod.__getattr__ = new Sk.builtin.func(function (pyName) {
        // runtime error because attribute error loses the argument as it propagates in skulpt
        throw new Sk.builtin.RuntimeError("_anvil_designer module missing attribute '" + pyName + "', did you manually change the import statement?");
    });

    return Sk.misceval.chain(null,
        /*INSERT*/
        () => mod
    );
};`;

function setupAppTemplates(
    yaml: TreeMapContent,
    depAppId: string | null,
    appPackage: string,
    anvilModule: PyModMap
) {
    const templateMakers = {} as Record<string, () => Suspension | pyObject>;

    for (const form of yaml.forms ?? []) {
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
        const templateModule = skulptFiles[templateModulePath] ?? TEMPLATE_MODULE_BODY;
        //@ts-ignore nasty way to communicate with generated JS
        const aft = window.anvilFormTemplates;
        skulptFiles[templateModulePath] = templateModule.replace(
            /\/\*INSERT\*\//,
            `/*INSERT*/ window.anvilFormTemplates[${aft.length}], (template) => { mod['${className}Template'] = template; },`
        );

        const pyTemplateClassMaker = () =>
            createFormTemplateClass(
                form,
                depAppId,
                className,
                anvilModule,
                `${appPackage}.${packageName}._anvil_designer`
            );
        aft[aft.length] = pyTemplateClassMaker;
        templateMakers[`${className}Template`] = pyTemplateClassMaker;
    }
    //console.log("Done creating template classes")
    if ((yaml.runtime_options?.version || 0) < 2) {
        setupLegacyV1AnvilModule(anvilModule, appPackage, templateMakers);
    }
}

const isServerRequestSuspension = (s: Suspension): s is Suspension<{ serverRequestId: string }> =>
    s.data !== null && typeof s.data === "object" && "serverRequestId" in s.data;

(PyDefUtils.suspensionHandlers as Record<string, ((s: Suspension) => unknown) | undefined>)["Sk.promise"] = (s: Suspension) => {
    if (isServerRequestSuspension(s)) {
        registerServerCallSuspension?.(s);
    }
    // Now fall through to the default Sk.promise suspension handler
};

export async function setupPythonEnvironment() {
    const extraOptions = hooks.getSkulptOptions?.() || {};
    let pyVer;
    if (data.app.runtime_options?.client_version == "3") {
        pyVer = Sk.python3;
    } else {
        pyVer = Sk.python2;
    }
    pyVer.super_args = true;

    Sk.configure({
        output: stdout,
        read: builtinRead,
        syspath: ["app", "anvil-services"],
        __future__: pyVer,
        suspensionHandlers: PyDefUtils.suspensionHandlers,
        ...extraOptions,
    });
    Sk.importSetUpPath(); // This is hack - normally happens automatically on first import

    const anvilModule = loadOrdinaryModulesReturningAnvilModule();

    // This runner *does* expose the root "Component" class
    anvilModule["Component"] = Component;
    anvilModule["Container"] = Container;
    anvilModule["HtmlComponent"] = HtmlComponent;

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
