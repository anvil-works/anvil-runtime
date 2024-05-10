import { AppYaml, data, DependencyYaml, setData, SetDataParams } from "./data";

console.log("Loading runner v2");

import "../extra-python-modules";
import "../messages";
import "./error-handling";
import { logEvent } from "./logging";

if (navigator.userAgent.indexOf("Trident/") > -1) {
    //@ts-ignore
    window.isIE = true;
}

// memoiser for module loaders
const memos = {};
//@ts-ignore
window.memoise = (key, fn) => () => memos[key] || (memos[key] = fn());
//@ts-ignore
window.PyDefUtils = PyDefUtils;

window.anvilCurrentlyConstructingForms = [];

import { reconstructObjects } from "@runtime/modules/_server";
import { OutstandingMedia } from "@runtime/modules/_server/rpc";
import { Args, Kws, pyCallable, pyCallOrSuspend, pyDict, pyRuntimeError, pyStr, pyTuple, toJs, toPy } from "../@Sk";
import * as PyDefUtils from "../PyDefUtils";
import { registerSolidComponent, solidComponents } from "./components-in-js/component-from-solid";
import * as _jsComponentApi from "./components-in-js/public-api";
import { isCustomAnvilError } from "./error-handling";
import { setLegacyOptions } from "./legacy-features";
import { setLoading } from "./loading-spinner";
import { anvilMod, anvilServerMod } from "./py-util";
import { setupPythonEnvironment } from "./python-environment";
import { warn } from "./warnings";

let hooks: { onLoadedApp?: () => void } = {};

export function setHooks(h: typeof hooks) {
    hooks = h;
}

//@ts-ignore - backwards compatibility
window.setLoading = setLoading;

let lastAppHeight = -1;
function onResize() {
    const newHeight = PyDefUtils.calculateHeight();

    if (newHeight != lastAppHeight) {
        // We really are happy for this to go to any origin. I don't mind people knowing how tall I am.
        window.parent.postMessage(
            {
                fn: "newAppHeight",
                newHeight: newHeight + 50,
            },
            "*"
        );

        lastAppHeight = newHeight;
    }
}

export function hardResize() {
    lastAppHeight = -1;
    onResize();
}

// Load an app, but don't open the main form or module
function loadApp(preloadModules: string[]) {
    setLoading(true, { animate: false });

    // Start watching the DOM for changes, so we can report app height.

    const observer = new MutationObserver(onResize);

    observer.observe($("#appGoesHere")[0], {
        childList: true,
        subtree: true,
    });

    $(window).on("resize", onResize);

    const modalObserver = new MutationObserver(onResize);

    $(document)
        .on("shown.bs.modal", ".modal", function () {
            modalObserver.observe(this, { childList: true, subtree: true });
            onResize();
        })
        .on("hidden.bs.modal", ".modal", () => {
            if (!$(".modal:visible").length) {
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
            return (
                "app/" +
                topLevelPackage +
                "/" +
                dots
                    .slice(0, -1)
                    .map((s) => s + "/")
                    .join("") +
                dots[dots.length - 1] +
                ".py"
            );
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
                dependencyErrors.push(
                    `Cannot have two dependencies with the same package name: ${depApp.package_name}`
                );
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
            if (jQueryDeprecationWarned[msg]) return;

            //@ts-ignore
            $.migrateMute = false;
            if (msg && msg.indexOf("jQuery.isFunction()") > -1) {
                // Ignore this warning. Used by bootstrap-notify.
                //@ts-ignore
                $.migrateMute = true;
                return;
            }

            jQueryDeprecationWarned[msg] = true;
            warn(
                "WARNING: This application uses deprecated jQuery 2.2 features. Please see the Javascript console for more details. Error: " +
                    msg
            );
            logEvent({
                warning: {
                    type: "jquery2-deprecation",
                    msg: msg,
                },
            });
        },
    };

    setupPythonEnvironment(preloadModules);

    setLoading(false);
}

async function openForm(formName: string | null, serialisedArgs?: any) {
    if (!formName) {
        throw new pyRuntimeError("This app has no startup form or module. To run this app you need to set one.");
    }

    let formArgs: Args = [],
        formKwargs: Kws = [];

    if (serialisedArgs) {
        const { media, ...restArgs } = serialisedArgs ?? {};
        // Massage this into the slightly wonky form our deserialiser expects
        const om: OutstandingMedia = {};
        for (const m of restArgs.objects ?? []) {
            if (m.type?.[0] === "DataMedia") {
                const { id, ["mime-type"]: mime_type, path, name } = m;

                const fr = await fetch(`data:${mime_type};base64,` + media[id]);
                om[id] = { mime_type, path, content: [await fr.blob()], name };
            }
        }
        const { args, kwargs } = (await reconstructObjects(restArgs, om)) as any;
        formArgs = args.map(toPy);
        for (const [k, v] of Object.entries(kwargs)) {
            formKwargs.push(k, toPy(v));
        }
    }

    return await PyDefUtils.callAsync(
        anvilMod.open_form,
        undefined,
        undefined,
        formKwargs,
        new Sk.builtin.str(formName),
        ...formArgs
    );
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
    const outstandingPrintDelayPromises: { [key: string]: { promise } } = (window.outstandingPrintDelayPromises = {});

    return PyDefUtils.asyncToPromise(() => {
        const openForm = anvilMod.open_form as pyCallable;
        const callFn = anvilServerMod.call as pyCallable;
        return Sk.misceval.chain(
            pyCallOrSuspend<pyTuple<[pyTuple, pyDict]>>(callFn, [
                new pyStr("anvil.private.pdf.get_component"),
                new pyStr(printId),
                new pyStr(printKey),
            ]),
            (pyOpenFormTuple) =>
                Sk.misceval.applyOrSuspend(openForm, pyOpenFormTuple.v[1], undefined, [], pyOpenFormTuple.v[0].v),
            () => {
                $("#loadingSpinner").hide();
                console.log(`Print delay promises: ${JSON.stringify(Object.keys(outstandingPrintDelayPromises))}`);
                return Object.values(outstandingPrintDelayPromises).map((d) => d.promise);
            }
        );
    })
        .then((promises) => Promise.all(promises))
        .then(() => {
            // @ts-ignore
            delete window.outstandingPrintDelayPromises;
            console.log("READY_TO_PRINT"); // pdf_renderer.py is waiting for this exact output.
        })
        .catch((e) => {
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
                data = { message: e.toString(), trace: [] };
            }
            console.log("PRINT_ERROR", JSON.stringify(data));
        })
        .catch((e) => {
            console.log("PRINT_ERROR", JSON.stringify({ type: "UnexpectedError", message: e.toString() }));
        });
}

let appLoaded = false;

// @ts-ignore
window.loadApp = function (params: SetDataParams, preloadModules: string[]) {
    setData(params);
    setLegacyOptions(params.app.runtime_options);

    if (appLoaded) {
        console.log("Rejected duplicate app load");
        return {};
    }

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker
            .register(`${data.appOrigin}/_/service-worker${params.inIDE ? "?inIDE=1" : ""}`, {
                scope: `${data.appOrigin}`,
            })
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
    call: function (
        jsThis: HTMLElement | JQuery,
        ...args: [fnName: string, ...args: any[]] /*functionName, arg1, arg2, ... */
    ) {
        const e = $(jsThis);
        if (e.length == 0) {
            console.error(
                "Cannot call anvil function on HTML Panel:",
                jsThis,
                "Did you forget to supply 'this' as the first argument to anvil.call?"
            );
        } else {
            return new Promise(function (resolve, reject) {
                $(jsThis).trigger("_anvil-call", [resolve, reject].concat(args));
            });
        }
    },
    registerSolidComponent,
    solidComponents,
    _jsComponentApi,
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
