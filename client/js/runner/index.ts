import {AppYaml, data, DependencyYaml, setData, SetDataParams} from "./data";

console.log("Loading runner v2");

import "../messages";
import "../extra-python-modules";
import "./error-handling";
import {stdout, logEvent} from "./logging";

if (navigator.userAgent.indexOf("Trident/") > -1) {
    window.isIE = true;
}

// memoiser for module loaders
const memos = {};
//@ts-ignore
window.memoise = (key, fn) => () => (memos[key] || (memos[key] = fn()));
//@ts-ignore
window.PyDefUtils = PyDefUtils;

window.anvilCurrentlyConstructingForms = [];

import * as componentModule from "../components";
import * as PyDefUtils from "../PyDefUtils";
import {setupPythonEnvironment} from "./python-environment";
import {getReactComponents, registerReactComponent} from "./components-in-js/component-from-react";
import { registerSolidComponent, solidComponents } from "./components-in-js/component-from-solid";
import { pyCallable, pyCallOrSuspend, pyDict, pyStr, pyTuple, toJs } from "../@Sk";
import { isCustomAnvilError } from "./error-handling";
import { Component } from "../components/Component";
import { anvilMod, anvilServerMod } from "../utils";


let hooks: {onLoadedApp?: () => void} = {};

export function setHooks(h: typeof hooks) { hooks = h; }


let loadingRefCount = 0;
function setLoading(loading?: boolean) {
    const oldRefCount = loadingRefCount;
    if (loading) {
        loadingRefCount++;
    } else {
        loadingRefCount--;
    }

    const spinner = $("#loadingSpinner");

    if (oldRefCount == 0 && loadingRefCount > 0) {
        spinner.stop(true);
        spinner.fadeIn(400);
    } else if (oldRefCount > 0 && loadingRefCount == 0) {
        spinner.stop(true);
        spinner.fadeOut(200);
    }
}
//@ts-ignore
window.setLoading = setLoading;


let lastAppHeight = -1;
function onResize() {
    const newHeight = PyDefUtils.calculateHeight();

    if (newHeight != lastAppHeight) {

        // We really are happy for this to go to any origin. I don't mind people knowing how tall I am.
        window.parent.postMessage({
            fn: "newAppHeight",
            newHeight: newHeight + 50,
        }, "*");

        lastAppHeight = newHeight;
    }
}

export function hardResize() {
    lastAppHeight = -1;
    onResize();
}

// Load an app, but don't open the main form or module
function loadApp(preloadModules: string[]) {
    setLoading(true);

    // Start watching the DOM for changes, so we can report app height.

    const observer = new MutationObserver(onResize);

    observer.observe($("#appGoesHere")[0], {
        childList: true,
        subtree: true,
    });

    $(window).on("resize", onResize);

    const modalObserver = new MutationObserver(onResize);

    $(document).on('shown.bs.modal', ".modal", function () {
        modalObserver.observe(this, { childList: true, subtree: true });
        onResize();
    }).on('hidden.bs.modal', ".modal", () => {
        if (!$('.modal:visible').length) {
            modalObserver.disconnect();
        }
        onResize();
    });


    // Load all the available app modules

    const appPackage = data.appPackage;

    const appModules: { [path: string]: string } = {};

    const getFilePath = (name: string, isPackage: boolean | undefined, topLevelPackage: string) => {
        if (isPackage) {
            return "app/" + topLevelPackage + "/" + name.replace(/\./g, "/") + "/__init__.py";
        } else {
            const dots = name.split(".");
            return "app/" + topLevelPackage + "/" + dots.slice(0,-1).map(s => s + "/").join("") + dots[dots.length-1] + ".py";
        }
    };

    const fillOutModules = (app: AppYaml | DependencyYaml, topLevelPackage: string) => {
        for (const f of app.forms) {
            appModules[getFilePath(f.class_name, f.is_package, topLevelPackage)] = f.code;
        }

        for (const m of app.modules) {
            appModules[getFilePath(m.name, m.is_package, topLevelPackage)] = m.code;
        }
    };

    const dependencyErrors = [];
    const dependencyPackageNames = [];
    const dataBindingCompilations = {};

    for (const [app_id, depApp] of Object.entries(data.app.dependency_code)) {
        if (depApp.package_name) {
            if (dependencyPackageNames.indexOf(depApp.package_name) == -1) {
                fillOutModules(depApp, depApp.package_name);
                dependencyPackageNames.push(depApp.package_name);
            } else {
                dependencyErrors.push(`Cannot have two dependencies with the same package name: ${depApp.package_name}`);
            }
        }
    }

    if (dependencyPackageNames.indexOf(appPackage) == -1) {
        fillOutModules(data.app, appPackage);
    } else {
        dependencyErrors.push(`App cannot have the same package name as one of its dependencies: ${appPackage}`);
    }


    // jQuery 3 migration

    const jQueryDeprecationWarned: { [msg: string]: true } = {};
    //@ts-ignore
    $.migrateWarnings = {
        push: (msg: string) => {
            if (jQueryDeprecationWarned[msg])
                return;

            //@ts-ignore
            $.migrateMute = false;
            if (msg && msg.indexOf("jQuery.isFunction()") > -1) {
                // Ignore this warning. Used by bootstrap-notify.
                //@ts-ignore
                $.migrateMute = true;
                return;
            }

            jQueryDeprecationWarned[msg] = true;
            stdout("WARNING: This application uses deprecated jQuery 2.2 features. Please see the Javascript console for more details. Error: " + msg);
            logEvent({
                warning: {
                    type: "jquery2-deprecation",
                    msg: msg
                }
            });
        }
    };


    if (window.isIE) {
        // @ts-ignore
        const themeVars = window.anvilThemeVars;
        // @ts-ignore
        const themeColors = window.anvilThemeColors;
        // oh no we can't have theme colors as vars so replace all the vars that were loaded with the colors
        const styleSheet = document.querySelector('style[title="theme.css"]') as Element;
        let text = styleSheet.textContent ?? "";
        for (const [themeName, themeVar] of Object.entries(themeVars)) {
            text = text.replace(new RegExp(`var\\(${themeVar}\\)`, "g"), themeColors[themeName]);
        }
        styleSheet.textContent = text;
    }

    setupPythonEnvironment(preloadModules);

    setLoading(false);
}

function openForm(formName: string) {
    return PyDefUtils.callAsync(anvilMod.open_form, undefined, undefined, undefined, new Sk.builtin.str(formName));
}

function openMainModule(moduleName: string) {
    const fullName = data.appPackage + "." + moduleName;
    //@ts-ignore
    window.anvilAppMainModule = moduleName;
    // since we import as __main__ portable classes won't work
    return Sk.misceval
        .asyncToPromise(() => Sk.importModuleInternal_(fullName, false, "__main__", undefined, undefined, false, true))
        .catch((e) => window.onerror(undefined, undefined, undefined, undefined, e));
}

function printComponents(printId: string, printKey: string) {
    // @ts-ignore
    const outstandingPrintDelayPromises: {[key:string]: {promise}} = window.outstandingPrintDelayPromises = {};

    return PyDefUtils.asyncToPromise(() => {
        const openForm = anvilMod.open_form as pyCallable;
        const callFn = anvilServerMod.call as pyCallable;
        return Sk.misceval.chain(
            pyCallOrSuspend<pyTuple<[pyTuple, pyDict]>>(callFn, [new pyStr("anvil.private.pdf.get_component"), new pyStr(printId), new pyStr(printKey)]),
            pyOpenFormTuple => Sk.misceval.applyOrSuspend(openForm, pyOpenFormTuple.v[1], undefined, [], pyOpenFormTuple.v[0].v),
            () => {
                $("#loadingSpinner").hide();
                console.log(`Print delay promises: ${JSON.stringify(Object.keys(outstandingPrintDelayPromises))}`);
                return Object.values(outstandingPrintDelayPromises).map(d => d.promise);
            }
        );
    })
        .then((promises) => Promise.all(promises))
        .then(() => {
            // @ts-ignore
            delete window.outstandingPrintDelayPromises;
            console.log("READY_TO_PRINT"); // pdf_renderer.py is waiting for this exact output.
        })
        .catch(e => {
            let data;
            if (e instanceof Sk.builtin.BaseException) {
                data = {
                    type: isCustomAnvilError(e) ? e._anvil.errorObj.type || e.tp$name : e.tp$name,
                    message: toJs(e.args.v[0] || ""),
                    trace: [] as [string, string][],
                };
                if (e.traceback) {
                    for (const t of e.traceback) {
                        data.trace.push([t.filename, t.lineno]);
                    }
                }
            } else {
                data = {message: e.toString(), trace: []};
            }
            console.log("PRINT_ERROR", JSON.stringify(data));
        }).catch(e => {
            console.log("PRINT_ERROR", JSON.stringify({type: "UnexpectedError", message: e.toString()}));
        });
}



let appLoaded = false;

// @ts-ignore
window.loadApp = function(params: SetDataParams, preloadModules: string[]) {
    setData(params);

    if (appLoaded) { console.log("Rejected duplicate app load"); return {}; }

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker
            .register(`${data.appOrigin}/_/service-worker`, { scope: `${data.appOrigin}` })
            .catch((error) => {
                console.error("Service worker registration failed:", error);
            });
    }



    const appLoadPromise = loadApp(preloadModules);
    appLoaded = true;

    if (data.serverParams.consoleMessage) {
        console.log(data.serverParams.consoleMessage);
    }

    hooks.onLoadedApp?.();

    return {};
};

// Entry points will be called by server-generated JS
// @ts-ignore
window.openForm = openForm;
// @ts-ignore
window.openMainModule = openMainModule;
// @ts-ignore
window.printComponents = printComponents;

// Entry points for old (legacy) JS interop API
$(window).on("_anvil-call", function (e, resolve, reject) {
    // @ts-ignore
    const gotElement = " Got " + (this[Symbol.toStringTag] ?? this) + " element.";
    reject(
        new Sk.builtin.RuntimeError(
            "anvil.call() first argument should be a child DOM element of the Form instance you wish to call the function on. " +
            "The DOM element provided has no parent Form instance." +
            gotElement
        )
    );
});

//@ts-ignore
window.anvil = {
    call: function(jsThis: HTMLElement | JQuery, ...args: [fnName: string, ...args: any[]] /*functionName, arg1, arg2, ... */) {
        const e = $(jsThis);
        if (e.length == 0) {
            console.error("Cannot call anvil function on HTML Panel:", jsThis, "Did you forget to supply 'this' as the first argument to anvil.call?");
        } else {
            return new Promise(function(resolve, reject) {
                $(jsThis).trigger("_anvil-call", [resolve, reject].concat(args));
            });
        }
    },
    registerReactComponent,
    getReactComponents,
    registerSolidComponent,
    solidComponents,
    _loadAppAfter: [] as Promise<any>[],
    deferLoad() {
        let r;
        // @ts-ignore
        window.anvil._loadAppAfter.push(
            new Promise((resolve, reject) => {
                r = resolve;
            })
        );
        return r;
    },
};


/*
 * TO TEST:
 *
 *  - Methods: get_url_hash, set_url_hash
 *  - Form Template generated class: init_components, add_component, clear, __getattr__
 *
 */
