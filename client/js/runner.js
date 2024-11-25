"use strict";
import {Component} from "@runtime/components/Component";

let v = null;
let o = v?.u?.k?.l;
let x = new Promise((y) => y());
let f = async () => { await x; let {xyz1, ...rtd} = {xyz1: 42, f:7}; };
v ??= 1;

require("./messages");
require("./extra-python-modules.js");

import {
    chainOrSuspend,
    checkArgsLen,
    promiseToSuspension,
    pyCall,
    pyCallOrSuspend,
    pyFunc,
    pyNone,
    pyStr,
    pySuper,
    pyDict,
} from "./@Sk";
import Modal from "./modules/modal";
import { anvilMod, anvilServerMod, s_add_event_handler, s_raise_event} from "@runtime/runner/py-util";

if (navigator.userAgent.indexOf("Trident/") > -1) {
    window.isIE = true;
}

// memoiser for module loaders
let memos = {};
window.memoise = (key, fn) => () => (memos[key] || (memos[key] = fn()));

var componentModule = require("./components");
var PyDefUtils = require("PyDefUtils");
window.PyDefUtils = PyDefUtils;
window.anvilRuntimeVersion = 2;

const eventWarnings = new Set();

function initComponentsOnForm(components, pyForm, eventBindingsByName) {
    var componentsByName = {
        "": pyForm,
    };
    var childrenByName = {};
    eventBindingsByName = eventBindingsByName || {};

    const _ADD_EVENT_HANDLER_STR = new Sk.builtin.str("add_event_handler");
    function addHandler(pyComponent, pyHandler, eventName) {
        const addEventHandler = Sk.abstr.gattr(pyComponent, _ADD_EVENT_HANDLER_STR);
        try {
            PyDefUtils.pyCall(addEventHandler, [new Sk.builtin.str(eventName), pyHandler]);
        } catch (e) {
            // bad yaml event name - ignore ValueError
            if (!(e instanceof Sk.builtin.ValueError)) {
                throw e;
            }
        }
    }

    var fns = [Sk.builtin.none.none$];
    for (var j in components) {
        fns.push(function(j) {
            return componentModule.newPythonComponent(components[j], componentsByName, childrenByName, eventBindingsByName, {}, pyForm, null, window.anvilAppDependencies, {}, pyForm._anvil.dataBindings);
        }.bind(null, j));
    }

    fns.push(function() {
        // Register any event handlers for the new component

        pyForm._anvil.componentNames = new Set();
        for(var name in componentsByName) {
            var pyComponent = componentsByName[name];
            pyForm._anvil.componentNames.add(name);

            const pyFormDict = Sk.abstr.lookupSpecial(pyForm, Sk.builtin.str.$dict);

            if (name) {
                if (Sk.misceval.isTrue(Sk.builtin.hasattr(pyForm, new Sk.builtin.str(name)))) {
                    Sk.misceval.call(Sk.builtins.print, undefined, undefined, undefined, new Sk.builtin.str("Warning: " + pyForm.tp$name + " has a method or attribute '" + name + "' and a component called '" + name + "'. The method or attribute will be inaccessible. This is probably not what you want."));
                }
                // add it to the dunder dict
                Sk.abstr.objectSetItem(pyFormDict, new Sk.builtin.str(name), pyComponent);
            }

            // Add event handlers.

            const bindings = eventBindingsByName[name];

            for (const evt in bindings) {
                const pyHandler = Sk.generic.getAttr.call(pyForm, new Sk.builtin.str(bindings[evt])); // use generic getattr for performance
                if (Sk.builtin.checkCallable(pyHandler)) {
                    addHandler(pyComponent, pyHandler, evt);
                    continue;
                }
                if (!window.anvilParams?.inIDE) {
                    // only do warnings in the IDE
                    continue;
                }
                if (!(evt in pyComponent._anvil.eventTypes)) {
                    // ignore this event - bad yaml definition
                    continue;
                }
                const warningPath = `${pyForm.tp$name}.${bindings[evt]}`;
                if (eventWarnings.has(warningPath)) {
                    // we've already warned about this componenent don't do it again
                    // (could be a component in a repeating panel)
                    continue;
                }
                eventWarnings.add(warningPath);
                let warningMsg;
                if (pyHandler === undefined) {
                    warningMsg = `Warning: ${warningPath} does not exist. Trying to set the '${evt}' event handler of self${
                        name ? "." + name : ""
                    } from ${pyForm.tp$name}.`;
                } else {
                    // Trying to set the event handler to an attribute - ignore but give a warning - e.g. Form1.tooltip
                    warningMsg = `Warning: ${warningPath} is not a valid handler for the '${evt}' event of self${
                        name ? "." + name : ""
                    } from ${pyForm.tp$name}. It should be a callable function (found type '${Sk.abstr.typeName(
                        pyHandler
                    )}')`;
                }
                Sk.builtin.print([warningMsg]);
            }
        }
        return Sk.builtin.none.none$;
    });

    return Sk.misceval.chain(...fns);
}

var lastAppHeight = -1;
function onResize(e) {
    var newHeight = PyDefUtils.calculateHeight();

    if (newHeight != lastAppHeight) {

        // We really are happy for this to go to any origin. I don't mind people knowing how tall I am.
        window.parent.postMessage({
            fn: "newAppHeight",
            newHeight: newHeight + 50,
        }, "*");

        lastAppHeight = newHeight;
    }
}

// Load an app, but don't open the main form or module
function loadApp(app, appId, appOrigin) {

    window.setLoading(true);

    // Start watching the DOM for changes, so we can report app height.

    var observer = new MutationObserver(onResize);

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


    window.anvilAppDependencies = app.dependency_code;
    window.anvilAppDependencyIds = app.dependency_ids;

    // Load all the available app modules

    let appPackage = app.package_name || "main_app_package";

    window.anvilAppMainPackage = appPackage;

    var appModules = {};

    let getFilePath = (name, isPackage, topLevelPackage) => {
        if (isPackage) {
            return "app/" + topLevelPackage + "/" + name.replace(/\./g, "/") + "/__init__.py";
        } else {
            let dots = name.split(".");
            return "app/" + topLevelPackage + "/" + dots.slice(0,-1).map(s => s + "/").join("") + dots[dots.length-1] + ".py";
        }
    };

    let fillOutModules = (app, topLevelPackage) => {
        for (let i in app.forms) {
            var f = app.forms[i];
            appModules[getFilePath(f.class_name, f.is_package, topLevelPackage)] = f.code;
        }

        for (let i in app.modules) {
            var m = app.modules[i];
            appModules[getFilePath(m.name, m.is_package, topLevelPackage)] = m.code;
        }
    };

    let dependencyErrors = [];
    let dependencyPackageNames = [];
    let dataBindingCompilations = {};

    for (let app_id in app.dependency_code) {
        let depApp = app.dependency_code[app_id];
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
        fillOutModules(app, appPackage);
    } else {
        dependencyErrors.push(`App cannot have the same package name as one of its dependencies: ${appPackage}`);
    }

    var builtinRead = function(app, x) {
        var depMatch;
        if (x.startsWith("app/")) {
            // Get available app modules

            if (x in appModules)
                return appModules[x];
        }
        //console.log(x);
        /* else if (x.indexOf("anvil-services") == 0) {
            // Look through all our external modules to see if any match what we're looking for


            for(var moduleName in externalModules) {
                var module = externalModules[moduleName];
                if (x.indexOf("anvil-services/" + moduleName.replace(/\./g, "/")) == 0) {
                    // This external module is a match. Try to load the required submodule
                    return PyDefUtils.suspensionPromise(function(resolve, reject) {
                        var xUrl = x.replace("anvil-services/" + moduleName.replace(/\./g, "/"), module.url);
                        if (module.def.path_whitelist && module.def.path_whitelist.indexOf(xUrl.replace(module.origin, "")) == -1) {
                            // Whitelist did not contain this file. Shortcut 404.
                            reject("Error loading module " + x + ": " + errorThrown);
                        } else {
                            $.get(xUrl).done(function(r) {
                                //console.debug("Loaded file from service whitelist:", x);
                                resolve(r);
                            }).fail(function(xhr, textStatus, errorThrown) {
                                if (!module.def.path_whitelist) {
                                    console.warn("Failed to load service file:", xUrl, "Avoid this error by adding service path whitelist.");
                                }
                                reject("Error loading module " + x + ": " + errorThrown);
                            });
                        }
                    });
                }
            }

            // OK, we're about to 404 this. Be more sensible if it's a known service
            var knownServiceNames = ["google", "facebook", "stripe", "raven", "kerberos"];
            for (var i in knownServiceNames) {
                if (x == "anvil-services/" + knownServiceNames[i] + ".py") {
                    return "class AnvilServiceNotAdded(Exception):\n  pass\n\nraise AnvilServiceNotAdded('" + knownServiceNames[i] + "')\n";
                }
            }
        }*/
        const file = Sk.builtinFiles?.files[x];
        if (file === undefined) {
            throw "File not found: '" + x + "'";
        } else if (typeof file === "number") {
            // slow path we need to do a fetch
            return Sk.misceval.promiseToSuspension(
                new Promise((resolve, reject) => {
                    // while we support IE don't use fetch since fetch is not polyfilled by core-js
                    const xhr = new XMLHttpRequest();
                    // this variable is created in runner.html - we create it there so that a sha can be added
                    // when this file includes a sha value it can be aggressively cached by the browser
                    const fetchUrl = window.anvilSkulptLib[file];
                    xhr.open("GET", fetchUrl, true);
                    xhr.onload = function () {
                        const newFiles = JSON.parse(this.responseText);
                        Object.assign(Sk.builtinFiles.files, newFiles);
                        resolve(newFiles[x]);
                    };
                    xhr.onerror = reject;
                    xhr.send();
                })
            );
        } else {
            return file;
        }

    };

    var firstMsg = undefined;

    var accumulatingPrints = null;

    var sendLog = function(details) { console.log(details); };

    var flushLog = function() {
        if (accumulatingPrints !== null) {
            sendLog({print: accumulatingPrints});
            accumulatingPrints = null;
        }
    };

    var stdout = function(text, fromServer) {
        if (text != "\n") {
            if (!firstMsg) { firstMsg = +new Date(); }
            console.log((fromServer?"SERVER: ":"CLIENT: ") + text);
        }

        if (window.anvilOnStdOut) {
            window.anvilOnStdOut(text, fromServer);
        }

        if (!fromServer) {
            if (accumulatingPrints === null) {
                accumulatingPrints = "";
                setTimeout(flushLog);
            }
            accumulatingPrints += text;
        }
    };

    // jQuery 3 migration

    let jQueryDeprecationWarned = {};
    $.migrateWarnings = {
        push: (msg) => {
            if (jQueryDeprecationWarned[msg])
                return;

            $.migrateMute = false;
            if (msg && msg.indexOf("jQuery.isFunction()") > -1) {
                // Ignore this warning. Used by bootstrap-notify.
                $.migrateMute = true; 
                return; 
            }

            jQueryDeprecationWarned[msg] = true;
            stdout("WARNING: This application uses deprecated jQuery 2.2 features. Please see the Javascript console for more details. Error: " + msg);
            sendLog({
                warning: {
                    type: "jquery2-deprecation",
                    msg: msg
                }
            });
        }
    }


    var uncaughtExceptions = {pyHandler: Sk.builtin.none.none$};

    window.onunhandledrejection = (event) => {
        window.onerror(null, null, null, null, event.reason);
    };


    window.onerror = function (errormsg, url, line, col, errorObj) {
        if (typeof errormsg === "string" && errormsg.indexOf("__gCrWeb.autofill.extractForms") > -1) {
            // This is a Chrome-on-iOS bug. Only happens when autofill=off in settings. Ignore.
            return;
        }
        try {
            if (serverModuleAndLog && errorObj instanceof serverModuleAndLog.pyMod["SessionExpiredError"]) {
                handleSessionExpired(errorObj);
            } else if (errorObj instanceof Sk.builtin.BaseException) {
                handlePythonError(errorObj);
            } else {
                handleJsError(errormsg, url, line, col, errorObj);
            }
        } catch (e) {
            console.error("Uncaught error in window.onerror! ");
            console.error(e);
        }
    };


    function handleSessionExpired(errorObj) {
        if (hasCustomHandler()) {
            customHandlerHandler(errorObj, showRefreshSessionModal);
        } else {
            showRefreshSessionModal();
        }
    }


    function handlePythonError(pyErrorObj) {
        const args = Sk.ffi.toJs(pyErrorObj.args);
        const msg = args[0];
        const errorObj = pyErrorObj._anvil?.errorObj;
        const traceback = pyErrorObj.traceback;
        let type;
        if (errorObj) {
            type = errorObj.type;
        } else {
            type = pyErrorObj.tp$name;
        }

        if (window.anvilOnPythonException) {
            const errorMsg = { fn: "pythonError", traceback, type, msg, errorObj };
            window.anvilOnPythonException(errorMsg);
        }

        console.log("Python exception: " + type + ": " + msg);
        if (pyErrorObj.nativeError) {
            console.log(pyErrorObj.nativeError);
        } else {
            console.log(pyErrorObj);
        }

        const error = {
            type,
            trace: traceback.map(({ filename, lineno }) => [filename, lineno]),
            message: msg,
            jsTrace: pyErrorObj.nativeError?.stack,
            bindingErrors: errorObj?.bindingErrors,
            anvilVersion: window.anvilVersion,
        };

        flushLog();
        sendLog({ error });

        $("#error-indicator .output").text(type + ": " + msg);
        if (hasCustomHandler()) {
            customHandlerHandler(pyErrorObj);
        } else {
            showErrorPopup();
        }
    }

    function handleJsError(errormsg, jsUrl, jsLine, jsCol, errorObj) {
        console.error("Uncaught runtime error: " + errormsg + " at " + jsUrl + ":" + jsLine + ", column " + jsCol, errorObj);

        if (window.anvilOnRuntimeError) {
            window.anvilOnRuntimeError(errormsg, jsUrl, jsLine, jsCol, errorObj);
        }

        const err = {
            runtimeError: (errorObj && errorObj.constructor && errorObj.constructor.name) || "Unknown error",
            jsUrl,
            jsLine,
            jsCol,
            message: "" + (errorObj || "Unknown error"),
            jsTrace: errorObj && errorObj.stack,
            anvilVersion: window.anvilVersion,
        };

        flushLog();
        sendLog({ error: err });

        $("#error-indicator .output").text(errormsg || "Unhandled runtime error");
        if (hasCustomHandler()) {
            // we shouldn't send null to ExternalError
            customHandlerHandler(new Sk.builtin.ExternalError(errorObj ?? "Unknown error"));
        } else {
            // Log uncaught JS error
            window.anvilOnUncaughtRuntimeError?.(err);
            showErrorPopup();
        }
    }

    const showErrorPopup = () => {
        $("#error-indicator")
            .show()
            .stop(true)
            .css({ "padding-left": 30, "padding-right": 30, right: 10 })
            .animate({ "padding-left": 20, "padding-right": 20, right: 20 }, 1000); //.css("opacity", "1").animate({opacity: 0.7}, 1000);
    };

    const showRefreshSessionModal = async () => {
        if (document.getElementById("session-expired-modal")) {
            // we're already on the screen
            return;
        }
        const modal = await Modal.create({
            id: "session-expired-modal",
            large: false,
            title: "Session Expired",
            body: "Your session has timed out. Please refresh the page to continue.",
            buttons: [
                {
                    text: "Refresh now",
                    style: "danger",
                    onClick: () => {
                        window.location.reload();
                    },
                },
            ],
        });
        modal.show();
    };

    function hasCustomHandler() {
        return uncaughtExceptions.pyHandler !== Sk.builtin.none.none$;
    }

    function customHandlerHandler(errorObj, reRaiseRenderer=showErrorPopup) {
        PyDefUtils.callAsyncWithoutDefaultError(
            uncaughtExceptions.pyHandler,
            undefined,
            undefined,
            undefined,
            errorObj
        ).catch((e) => {
            if (e === errorObj) {
                // It just re-raised, which means it didn't want to interrupt
                // the default error popup.
                reRaiseRenderer();
            } else {
                // Error handler threw an error. Abandon.
                uncaughtExceptions.pyHandler = Sk.builtin.none.none$;
                window.onerror(undefined, undefined, undefined, undefined, e);
            }
        });
    }

    Sk.configure({
        output: stdout,
        read: builtinRead.bind(this, app),
        syspath: ["app", "anvil-services"],
        __future__: (app.runtime_options && app.runtime_options.client_version == "3") ? Sk.python3 : Sk.python2,
    });
    Sk.importSetUpPath(); // This is hack - normally happens automatically on first import

    var anvilModule = require("./modules/anvil")(appOrigin, uncaughtExceptions);

    componentModule.defineSystemComponents(anvilModule);

    // Runner v2: "ClassicComponent" is "Component"; "ClassicContainer" is "Container"
    anvilModule["Component"] = anvilModule["ClassicComponent"];
    anvilModule["Container"] = anvilModule["ClassicContainer"];

    // Inject the theme HTML assets into the HtmlTemplate component
    anvilModule["HtmlTemplate"].$_anvilThemeAssets = (app.theme && app.theme.html) || {};
    // keeping this around as a js object. We convert to a python dict in app.theme_colors
    // parallels designer.html and also anvil-extras uses this in the designer for dynamic colors.
    window.anvilThemeColors = (app.theme && app.theme.color_scheme) || {};
    window.anvilThemeVars = (app.theme && app.theme.vars) || {};

    if (window.isIE) {
        // oh no we can't have theme colors as vars so replace all the vars that were loaded with the colors
        const styleSheet = document.querySelector('style[title="theme.css"');
        let text = styleSheet.textContent;
        for (let [themeName, themeVar] of Object.entries(window.anvilThemeVars)) {
            text = text.replace(new RegExp(`var\\(${themeVar}\\)`, "g"), window.anvilThemeColors[themeName]);
        }
        styleSheet.textContent = text;
    }

    window.anvilCustomComponentProperties = {}; // {'depAppId:class_name' => properties}
    var defineForm = function(f, anvilModule, topLevelPackage, depId=null) {

        const events = [
            {name: "show", description: "When the form is shown on the page",
                parameters: [], important: true},
            {name: "hide", description: "When the form is removed from the page",
                parameters: [], important: true},
            {name: "refreshing_data_bindings", important: true, parameters: [],
                description: "When refresh_data_bindings is called"},
        ];

        if (f.custom_component) {
            events.push(...(f.events ?? []));
            window.anvilCustomComponentProperties[depId + ":" + f.class_name] = f.properties;
        }

        // Where do form templates come from?
        // Well, we're in transition from the old system (an 'anvil' module
        // under the app package, different for each dependency) to the
        // new system (an _anvil_designer module in the same package as
        // each form); for now, we make the template class available in
        // both places.

        // Because Skulpt doesn't know how to load prebuilt module objects
        // as children of parsed-and-compiled packages, we create the
        // _anvil_designer module in the grossest way you can think of:
        // by building the JS source with regexes. To minimise grossness,
        // the generated source pulls prebuilt class objects from the
        // global scope.

        // (Given that we're generating source code, there is a case here
        // for generating the template as Python source, and then making
        // that available to the user to show there's nothing magical
        // about it.)
        // ...at that point, one could conceivably make Python source
        // the canonical representation of form layout, thereby making
        // Git merges feasible. Ooh.

        if (!window.anvilFormTemplates) {
            window.anvilFormTemplates = [];
        }

        let dots = f.class_name.split(".");
        let className = dots[dots.length-1];
        if (!f.is_package) { dots.pop(); }
        let packageName = dots.join(".");

        let templateModulePath = "app/" + topLevelPackage + "/" + packageName.replace(/\./g, "/") + (packageName ? "/" : "") + "_anvil_designer.js";

        let templateModule = appModules[templateModulePath] || "function $builtinmodule(mod) { /*INSERT*/ return mod; };";
        let aft = window.anvilFormTemplates;

        appModules[templateModulePath] = templateModule.replace(/..INSERT../, "/*INSERT*/ mod['"+className+"Template'] = window.anvilFormTemplates["+aft.length+"];");

        const FormTemplate = aft[aft.length] = anvilModule[className + "Template"] = PyDefUtils.mkComponentCls(anvilModule, className + "Template", {

            base: anvilModule[f.container.type],

            /*!componentEvents(form)!1*/
            events,

            // we don't want __slots__ here
            slots: false,

            /*!componentProp(form)!1*/
            properties: [{
                name: "item",
                type: "dict",
                description: "A dictionary-like object connected to this form",
                pyVal: true,
                set(s,e,v) {
                    return s._anvil.refreshOnItemSet && Sk.misceval.callsimOrSuspend(s.tp$getattr(new Sk.builtin.str("refresh_data_bindings")));
                }
            }],
            
            locals($loc) {

                // The setup code is *mostly* in common between __new__ and __new_deserialized__, except for
                // components (__new_deserialized__ already has the objects, whereas __new__ needs to
                // instantiate them), so we keep it mostly in common


                // Here we need to generate kwargs to give to the container constructor and initialiser, (which should be taken directly from the yaml, and cannot be interfered-with by our kwargs)
                const containerKwargs = ["__ignore_property_exceptions", true];
                for (let [k,v] of Object.entries(f.container.properties || {})) {
                    if (v === undefined) continue;
                    containerKwargs.push(k, Sk.ffi.toPy(v));
                }

                const containerNew = Sk.abstr.typeLookup(anvilModule[f.container.type], new Sk.builtin.str("__new__"));

                const skeletonNew = (cls) => PyDefUtils.pyCallOrSuspend(containerNew, [cls], containerKwargs);

                // Back half of __new__ for conventionally constructed objects;
                // __deserialize__ for deserialized ones
                let commonSetup = (c, setupComponents) => {

                    c._anvil.refreshOnItemSet = true;

                    // Keep this around in runtimeV2 - touched by anvil extras (remove in runtimeV3)
                    if (f.custom_component) {
                        c._anvil.customComponentProperties = f.properties;
                    }

                    var writeBackChildBoundData = function(binding) {
                        return PyDefUtils.callAsyncWithoutDefaultError(binding.pySave, undefined, undefined, undefined, c, binding.pyComponent).catch(function (e) {
                            if (e instanceof Sk.builtin.KeyError) {
                                return; // Unremarkable
                            }
                            console.error(e);
                            if (e instanceof Sk.builtin.BaseException && e.args.v[0] instanceof Sk.builtin.str) {
                                e.args.v[0] = new Sk.builtin.str(e.args.v[0].v + "\n while setting " + binding.code + " = self." + binding.component_name + "." + binding.property + "\n in a data binding for self." + binding.component_name);
                            }
                            window.onerror(null, null, null, null, e);
                        });
                    };

                    c._anvil.props["item"] = new Sk.builtin.dict([]);

                    return Sk.misceval.chain(null,
                        () => {
                            c._anvil.dataBindings = [];
                            
                            for (var i in f.container.data_bindings || []) {
                                var binding = Object.create(f.container.data_bindings[i]);
                                binding.pyComponent = c;
                                binding.component_name = "";
                                c._anvil.dataBindings.push(binding);
                            }

                            return setupComponents(c);
                        }, 
                        () => {
                            c._anvil.dataBindings.forEach((binding) => {
                                if (binding.code) {

                                    const readCode = "def update_val(self, _anvil_component):\n" +
                                                "  _anvil_component." + binding.property + " = " + binding.code + "\n" + 
                                                "def clear_val(self, _anvil_component):\n" +
                                                "  _anvil_component." + binding.property + " = None\n";
                                    // TODO: Check whether we actually allowBindingWriteback on this binding property. This is not as simple as 
                                    // looking at the propMap of binding.pyComponent, because they could be custom component properties, which 
                                    // aren't registered anywhere on the instance.
                                    const writeCode = (binding.writeback ?
                                                        "def save_val(self, _anvil_component):\n" +
                                                        "  " + binding.code + " = _anvil_component." + binding.property + "\n"
                                                        : "");

                                    let modlocs;
                                    const cachedCompile = dataBindingCompilations[readCode + writeCode];
                                    if (cachedCompile) {
                                        modlocs = cachedCompile;
                                    } else {
                                        let bmod;
                                        try {
                                            bmod = Sk.compile(readCode + writeCode, "update_binding.py", "exec", true);
                                        } catch(e) {
                                            // Usability: detect the "chose writeback but didn't give an lvalue" situation
                                            if (binding.writeback) {
                                                let readCompiledOk = false;
                                                try {
                                                    Sk.compile(readCode, "update_binding.py", "exec", true);
                                                    readCompiledOk = true;
                                                } catch(e) {
                                                    // throw below
                                                }
                                                if (readCompiledOk) {
                                                    throw new Sk.builtin.SyntaxError("Can't assign to data binding expression for " + binding.component_name + "." + binding.property + ", but writeback is enabled for this data binding.");
                                                }
                                            }
                                            throw new Sk.builtin.SyntaxError("Syntax error in data binding for " + binding.component_name + "." + binding.property);
                                        }
                                        modlocs = eval(bmod.code + "\n" + bmod.funcname + "({__name__: new Sk.builtin.str('update_binding')});\n");
                                        modlocs = Sk.misceval.retryOptionalSuspensionOrThrow(modlocs);
                                        dataBindingCompilations[readCode + writeCode] = modlocs;
                                    }
                                    binding.pyUpdate = modlocs["update_val"];
                                    binding.pyClear = modlocs["clear_val"];
                                    binding.pySave = modlocs["save_val"];

                                    if (binding.pySave) {
                                        pyCall(binding.pyComponent.tp$getattr(s_add_event_handler), [
                                            new pyStr("x-anvil-write-back-" + binding.property),
                                            new pyFunc(PyDefUtils.withRawKwargs(() => promiseToSuspension(writeBackChildBoundData(binding))))
                                        ]);
                                    }
                                }
                            })
                        },
                        () => c
                    );
                };


                $loc["__new__"] = new Sk.builtin.func(PyDefUtils.withRawKwargs((pyKwargs, cls) => {
                    function setupComponents(c) {
                        let eventBindingsByName = {"": f.container.event_bindings};

                        return componentModule.withDependencyTrace(depId, () =>
                            componentModule.withFormTrace(appPackage + "." + f.class_name, function() {
                                return initComponentsOnForm(f.components, c, eventBindingsByName);
                            })
                        );
                    }
                    return Sk.misceval.chain(skeletonNew(cls), (c) => commonSetup(c, setupComponents));
                }));


                $loc["__new_deserialized__"] = PyDefUtils.mkNewDeserializedPreservingIdentity((self, pyData, _pyGlobalData) => {
                    let pyComponents = pyData.mp$subscript(new Sk.builtin.str("c"));
                    let pyDict = pyData.mp$subscript(new Sk.builtin.str("d"));
                    let pyAttrs = pyData.mp$subscript(new Sk.builtin.str("a"));

                    function setupComponents(c) {
                        let addComponent = c.tp$getattr(new Sk.builtin.str("add_component"))
                        return Sk.misceval.chain(
                            // First, add_component() all our contents
                            Sk.misceval.iterFor(Sk.abstr.iter(pyComponents), (pyC) => {
                                let [pyComponent, pyLayoutProps] = pyC.v;
                                return Sk.misceval.apply(addComponent, pyLayoutProps, undefined, [], [pyComponent]);
                            }),
                            // Set up our __dict__, then
                            // crawl all over our component tree, wiring up
                            // events and data bindings
                            () => {
                                let update = c.$d.tp$getattr(new Sk.builtin.str("update"));
                                Sk.misceval.callsim(update, pyDict);

                                function wireUpEvents(pyComponent, yaml) {
                                    let addEventHandler = pyComponent.tp$getattr(new Sk.builtin.str("add_event_handler"));
                                    for (let eventName in yaml.event_bindings) {
                                        let pyHandler = c.tp$getattr(new Sk.builtin.str(yaml.event_bindings[eventName]));
                                        if (pyHandler) {
                                            Sk.misceval.callsimArray(addEventHandler, [new Sk.builtin.str(eventName), pyHandler]);
                                        }
                                    }

                                    for (let i in yaml.data_bindings) {
                                        let binding = Object.create(yaml.data_bindings[i]);
                                        binding.pyComponent = pyComponent;
                                        binding.component_name = yaml.name;
                                        c._anvil.dataBindings.push(binding);
                                    }
                                }

                                wireUpEvents(c, f.container);

                                function walkComponents(components) {
                                    for (let yaml of components || []) {
                                        let pyComponent = c.tp$getattr(new Sk.builtin.str(yaml.name));
                                        wireUpEvents(pyComponent, yaml);
                                        if (yaml.components) {
                                            walkComponents(yaml.components);
                                        }
                                    }
                                }

                                walkComponents(f.components);
                            },
                            // We set our component attrs last (this could trigger user code that expects
                            // everything to be in its place)
                            () => {
                                let items = pyAttrs.tp$getattr(new Sk.builtin.str("items"));
                                return Sk.misceval.iterFor(Sk.abstr.iter(Sk.misceval.call(items)), (pyItem) => {
                                    let pyName = pyItem.v[0];
                                    let pyValue = pyItem.v[1];
                                    return c.tp$setattr(pyName, pyValue, true);
                                })
                            },
                        );
                    }

                    return commonSetup(self, setupComponents);
                }, skeletonNew);


                $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity(function (self) {
                    // We serialise our components, our object dict, and the properties of our container
                    // type separately

                    // Our subclass should have a __dict__ i.e. class Form1(Form1Template): ...
                    const d = Sk.abstr.lookupSpecial(self, Sk.builtin.str.$dict) ?? new pyDict();
                    try {
                        Sk.abstr.objectDelItem(d, new Sk.builtin.str("_serialization_key"));
                    } catch(e) {
                        // ignore
                    }

                    let a = new Sk.builtin.dict();
                    for (let n in self._anvil.props) {
                        a.mp$ass_subscript(new Sk.builtin.str(n), self._anvil.props[n]);
                    }

                    let components = self._anvil.components.map(
                        (c) => new Sk.builtin.tuple([c.component, Sk.ffi.remapToPy(c.layoutProperties)])
                    );

                    // Custom component properties need no special handling - they are reflected in
                    // __dict__ or elsewhere

                    return new Sk.builtin.dict([
                        new Sk.builtin.str("d"), d,
                        new Sk.builtin.str("a"), a,
                        new Sk.builtin.str("c"), new Sk.builtin.list(components),
                    ]);

                });


                // Kept for backwards compatibility.
                $loc["init_components"] = $loc["__init__"] = PyDefUtils.funcFastCall(function __init__(args, pyKwargs) {
                    Sk.abstr.checkArgsLen("init_components", args, 1, 1);
                    const self = args[0];
                    // Sort out property attrs.
                    const validKwargs = new Set(["item"]);

                    if (f.custom_component) {
                        for(let pt of f.properties || []) {
                            validKwargs.add(pt.name);
                        }
                    }

                    const propAttrs = [];
                    // Overwrite any valid props we were given as kwargs.
                    pyKwargs = pyKwargs || [];
                    for (let i = 0; i < pyKwargs.length; i += 2) {
                        const propName = pyKwargs[i].toString();
                        const pyPropVal = pyKwargs[i + 1];
                        if (validKwargs.has(propName)) {
                            propAttrs.push([propName, pyPropVal]);
                        } else {
                            console.log("Ignoring form constructor kwarg: ", propName);
                        }
                    }

                    return Sk.misceval.chain(
                        undefined,
                        () => {
                            self._anvil.refreshOnItemSet = false;
                        },
                        ...propAttrs.map(([propName, pyPropVal]) => () => self.tp$setattr(new Sk.builtin.str(propName), pyPropVal, true)),
                        () => {
                            self._anvil.refreshOnItemSet = true;
                        },
                        () =>
                            Sk.misceval.tryCatch(
                                () => PyDefUtils.pyCallOrSuspend(self.tp$getattr(new Sk.builtin.str("refresh_data_bindings"))),
                                (e) => {
                                    if (e instanceof Sk.builtin.BaseException && e.args.v[0] instanceof Sk.builtin.str) {
                                        e.args.v[0] = new Sk.builtin.str(
                                            e.args.v[0].v + ". Did you initialise all data binding sources before initialising this component?"
                                        );
                                    }
                                    throw e;
                                }
                            )
                    );
                });

                if (f.custom_component) {
                    // Create property descriptors for custom properties.
                    (f.properties || []).forEach((pt) => {
                        $loc[pt.name] = PyDefUtils.pyCall(anvilModule["CustomComponentProperty"], [pt.name, Sk.ffi.remapToPy(pt.default_value || null)]);
                    });
                }

                $loc["raise_event"] = PyDefUtils.funcFastCall((args, kws) => {
                    const [self, pyEventName] = args;
                    checkArgsLen("raise_event", args, 2, 2);
                    const eventName = String(pyEventName);
                    const superRaise = new pySuper(FormTemplate, self).tp$getattr(s_raise_event);
                    if (!f.custom_component) {
                        return pyCallOrSuspend(superRaise, [pyEventName], kws);
                    }
                    const chainedFns = (f.properties ?? [])
                        .filter((p) => (p.binding_writeback_events ?? []).includes(eventName))
                        .map((p) => () => PyDefUtils.suspensionFromPromise(self._anvil.dataBindingWriteback(self, p.name)));
                    
                    return chainOrSuspend(pyNone, ...chainedFns, () => pyCallOrSuspend(superRaise, [pyEventName], kws));
                });

                
                $loc["refresh_data_bindings"] = new Sk.builtin.func(function(self) {
                    const chainArgs = [];

                    // TODO: Confirm that we want to refresh even if 'item' is None - we don't necessarily just bind to item.
                    //var item = self.tp$getattr(new Sk.builtin.str("item"));
                    //if (!item || item === Sk.builtin.none.none$) { return Sk.builtin.none.none$; }

                    chainArgs.push(() => PyDefUtils.raiseEventOrSuspend({}, self, "refreshing_data_bindings"));
                    if (self._anvil.onRefreshDataBindings) {
                        chainArgs.push(self._anvil.onRefreshDataBindings);
                    }
                    const bindingErrors = [];
                    self._anvil.dataBindings.forEach((binding) => {
                        chainArgs.push(
                            function (binding) {
                                return Sk.misceval.tryCatch(
                                    () => {
                                        if (binding.pyUpdate) {
                                            return Sk.misceval.callsimOrSuspend(binding.pyUpdate, self, binding.pyComponent);
                                        }
                                    },
                                    (e) => {
                                        if (e instanceof Sk.builtin.KeyError) {
                                            if (binding.pyClear) {
                                                return Sk.misceval.callsimOrSuspend(binding.pyClear, self, binding.pyComponent);
                                            } else {
                                                return; // And we can't clear the property, so leave it with whatever value it had. Ew.
                                            }
                                        }
                                        //console.error(e);
                                        if (e instanceof Sk.builtin.BaseException && e.args.v[0] instanceof Sk.builtin.str) {
                                            //e.args.v[0] = new Sk.builtin.str(e.args.v[0].v + "\n while data binding self." + binding.component_name + "." + binding.property + " = " + binding.code + ".");
                                            // We don't want the last line of the traceback - it's inside our dummy update_binding.py
                                            e.traceback.pop();

                                            // Collect up all the binding errors so we can present them all, rather than one at a time.
                                            if (e._anvil && e._anvil.errorObj && e._anvil.errorObj.bindingErrors) {
                                                bindingErrors.push(...e._anvil.errorObj.bindingErrors);
                                                // Special case: Preserve the exception object itself in case it's the only one
                                                // and we need to re-throw it
                                                if (bindingErrors.length === 1) {
                                                    bindingErrors[0].exception = e;
                                                }
                                            } else {
                                                bindingErrors.push({
                                                    exception: e,
                                                    traceback: e.traceback,
                                                    message: e.args.v[0].v,
                                                    formName: f.class_name,
                                                    binding: {
                                                        component_name: binding.component_name,
                                                        property: binding.property,
                                                        code: binding.code,
                                                    },
                                                });
                                            }
                                        } else {
                                            throw e; // Not sure what sort of error this was. Throw it to be safe.
                                        }
                                    }
                                );
                            }.bind(null, binding)
                        );
                    });

                    chainArgs.push(() => {
                        // If there's only one error, we throw the original exception object (so it has the right type etc).
                        // If there were multiple errors, we throw a generic Exception saying "5 errors in this data binding".
                        if (bindingErrors.length === 1) {
                            let err = bindingErrors[0].exception;
                            if (!err._anvil) {
                                err._anvil = {};
                            }
                            if (!err._anvil.errorObj) {
                                err._anvil.errorObj = {type: err.tp$name};
                            }
                            err._anvil.errorObj.bindingErrors = bindingErrors;
                            delete bindingErrors[0].exception;

                            throw err;
                        } else if (bindingErrors.length > 0) {
                            let err = new Sk.builtin.RuntimeError(`Data Binding update failed with ${bindingErrors.length} error${bindingErrors.length > 1 ? 's' : ''}`);
                            err._anvil = {
                                errorObj: {
                                    type: "Exception",
                                    bindingErrors: bindingErrors,
                                }
                            };
                            for (let e of bindingErrors) {
                                delete e.exception;
                            }
                            throw err;
                        }
                    });

                    return Sk.misceval.chain(null, ...chainArgs, () => pyNone);
                });


                $loc["__setattr__"] = new Sk.builtin.func(function(self, pyName, pyValue) {
                    const name = Sk.ffi.toJs(pyName);
                    if (self._anvil.componentNames && self._anvil.componentNames.has(name)) {
                        throw new Sk.builtin.AttributeError("Cannot set attribute '" + name + "' on '" + self.tp$name + "' form. There is already a component with this name.");
                    }
                    return Sk.generic.setAttr.call(self, pyName, pyValue, true);
                });


                const object_getattribute = Sk.abstr.typeLookup(Sk.builtin.object, Sk.builtin.str.$getattribute);

                $loc["__getattribute__"] = new Sk.builtin.func(function(self, pyName) {
                    const name = Sk.ffi.toJs(pyName);
                    // we prioritise the component over descriptors 
                    // i.e. we guarantee that if you name a component parent you will get the component and not the parent
                    if (self._anvil.componentNames && self._anvil.componentNames.has(name)) {
                        const dict = Sk.abstr.lookupSpecial(self, Sk.builtin.str.$dict);
                        const component = dict && dict.quick$lookup(pyName);
                        if (component !== undefined) {
                            return component;
                        }
                    }
                    // use object.__getattribute__ because it will throw an attribute error 
                    // unlike Sk.generic.getAttr which returns undefined
                    return PyDefUtils.pyCallOrSuspend(object_getattribute, [self, pyName]);
                });

            }

        });

    };

    let makeTemplatesImport = (anvilModule) => {
        // Utility function: set __all__ to import everything in the module (even things with _ prefixes) 
        let v = [];
        for (let i in anvilModule) {
            if (i.charAt(0) != "_" || /.*Template$/.test(i)) {
                v.push(new Sk.builtin.str(i));
            }
        }
        anvilModule['__all__'] = new Sk.builtin.list(v);
    };

    // Preload modules (eg anvil.users) to prevent creating multiple instances

    window.anvilServiceClientConfig = {}; // {path => config}
    for (let appService of app.services) {
        var serviceSource = appService.source.replace(/^\/runtime/, window.anvilAppOrigin + "/_/static/runtime");
        var m = /((.*\/)([^/]*))\.yml/g.exec(serviceSource);
        var serviceName = m[3];
        var serviceUrl = m[1];
        var serviceOrigin = m[2];

        // Cache the client config globally so we can request it if necessary.
        if (appService.client_config)
            window.anvilServiceClientConfig[appService.source] = appService.client_config;
    }

    PyDefUtils.loadModule("anvil", anvilModule);

    var base64Module = require("./modules/base64")();
    PyDefUtils.loadModule("base64", base64Module);

    var xmlModule = require("./modules/xml")();
    PyDefUtils.loadModule("anvil.xml", xmlModule);

    var reModule = require("./modules/regex")();
    PyDefUtils.loadModule("anvil.regex", reModule);

    var tzModule = require("./modules/tz")();
    PyDefUtils.loadModule("anvil.tz", tzModule);

    var shapesModule = require("./modules/shapes")();
    PyDefUtils.loadModule("anvil.shapes", shapesModule);

    var serverModuleAndLog = require("./modules/server")(appId, appOrigin);
    sendLog = serverModuleAndLog.log;
    PyDefUtils.loadModule("anvil.server", serverModuleAndLog.pyMod);

    var httpModule = require("./modules/http")();
    PyDefUtils.loadModule("anvil.http", httpModule);

    var jsModule = require("./modules/js")();
    PyDefUtils.loadModule("anvil.js", jsModule);

    var imageModule = require("./modules/image")();
    PyDefUtils.loadModule("anvil.image", imageModule);

    var mediaModule = require("./modules/media")();
    PyDefUtils.loadModule("anvil.media", mediaModule);

    PyDefUtils.loadModule("anvil.code_completion_hints", require("./modules/code-completion-hints")());

    // Runtime v1 and below uses a really grotty mechanism for getting templates.
    // We use prototypical inheritance to give each app a slightly different
    // view of the 'anvil' module, with its own form templates in.
    let definePerAppAnvilModule = (perAppAnvilModule, packageName) => {
        makeTemplatesImport(perAppAnvilModule);
        PyDefUtils.loadModule(packageName + ".anvil", perAppAnvilModule);
        const sysModulesCopy = Sk.misceval.callsimArray(Sk.sysmodules.tp$getattr(new Sk.builtin.str("copy")))
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
            }
        }
    };

    PyDefUtils.loadModule(appPackage, {
        "__name__": new Sk.builtin.str(appPackage),
        "__path__": new Sk.builtin.tuple([new Sk.builtin.str("app/"+appPackage)]),
        "__package__": new Sk.builtin.str(appPackage)
    });

    // The "anvilModuleForThisApp" stuff is only relevant for v2 apps.
    let anvilModuleForThisApp = $.extend({}, anvilModule);
    for (let form of app.forms) {
        defineForm(form, anvilModuleForThisApp, appPackage);
    }
    if (app.runtime_options.version < 2) {
        definePerAppAnvilModule(anvilModuleForThisApp, appPackage)
    }
    //console.log(appModules);

    var depPackagePrefixes = [""];
    for (let depId in app.dependency_code) {
        let depApp = app.dependency_code[depId];

        if (!depApp.package_name)
            continue;

        depPackagePrefixes.push(depApp.package_name + ".");

        PyDefUtils.loadModule(depApp.package_name, {
            "__name__": new Sk.builtin.str(depApp.package_name),
            "__path__": new Sk.builtin.tuple([new Sk.builtin.str("app/"+depApp.package_name)]),
            "__package__": new Sk.builtin.str(depApp.package_name)
        });

        let anvilModuleForThisDep = $.extend({}, anvilModule);
        for (let form of depApp.forms) {
            defineForm(form, anvilModuleForThisDep, depApp.package_name, depId);
        }
        if (depApp.runtime_options.version < 2) {
            definePerAppAnvilModule(anvilModuleForThisDep, depApp.package_name);
        }
    }

    window.setLoading(false);
}

function openForm(formName) {
    const openForm = anvilMod.open_form;
    return PyDefUtils.callAsync(openForm, undefined, undefined, undefined, new Sk.builtin.str(formName));
}

function openMainModule(moduleName) {
    let fullName = window.anvilAppMainPackage + "." + moduleName;
    window.anvilAppMainModule = moduleName;
    // since we import as __main__ portable classes won't work
    return Sk.misceval
        .asyncToPromise(() => Sk.importModuleInternal_(fullName, false, "__main__", undefined, undefined, false, true))
        .catch((e) => window.onerror(undefined, undefined, undefined, undefined, e));
}

function printComponents(printId, printKey) {
    window.outstandingPrintDelayPromises = {};

    return PyDefUtils.asyncToPromise(() => {
        const openForm = anvilMod.open_form;
        const callFn = anvilServerMod.call;
        return Sk.misceval.chain(
            Sk.misceval.callsimOrSuspend(callFn, new Sk.builtin.str("anvil.private.pdf.get_component"), new Sk.builtin.str(printId), new Sk.builtin.str(printKey)),
            pyOpenFormTuple => Sk.misceval.applyOrSuspend(openForm, pyOpenFormTuple.v[1], undefined, [], pyOpenFormTuple.v[0].v),
            () => {
                $("#loadingSpinner").hide(); 
                console.log(`Print delay promises: ${JSON.stringify(Object.keys(window.outstandingPrintDelayPromises))}`);
                return Object.values(window.outstandingPrintDelayPromises).map(d => d.promise);
            }
        );
    })
    .then((promises) => Promise.all(promises))
    .then(() => {
        delete window.outstandingPrintDelayPromises;
        console.log("READY_TO_PRINT"); // pdf_renderer.py is waiting for this exact output.        
    })
    .catch(e => {
        let data;
        if (e instanceof Sk.builtin.BaseException) {
            data = {
                type: (e._anvil && e._anvil.errorObj && e._anvil.errorObj.type) || e.tp$name,
                message: Sk.ffi.remapToJs(e.args.v[0] || ""),
                trace: []
            };
            if (e.traceback) {
                for (let t of e.traceback) {
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

var loadingRefCount = 0;
window.setLoading = function(loading) {
    var oldRefCount = loadingRefCount;
    if (loading) {
        loadingRefCount++;
    } else {
        loadingRefCount--;
    }

    var spinner = $("#loadingSpinner");

    if (oldRefCount == 0 && loadingRefCount > 0) {
        spinner.stop(true);
        spinner.fadeIn(400);
    } else if (oldRefCount > 0 && loadingRefCount == 0) {
        spinner.stop(true);
        spinner.fadeOut(200);
    }
}


var appLoaded = false;

window.loadApp = function(params) {
    window.anvilParams = params;

    var appOrigin = params["appOrigin"];
    if (appLoaded) { console.log("Rejected duplicate app load"); return {}; }

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register(`${appOrigin}/_/service-worker`, { scope: `${appOrigin}` }).catch((error) => {
            console.error("Service worker registration failed:", error);
        });
    }



    var appLoadPromise = loadApp(params["app"], params["appId"], appOrigin);
    appLoaded = true;

    if (window.anvilOnLoadApp) {
        window.anvilOnLoadApp(params);
    }

    if (params.consoleMessage) {
        console.log(params.consoleMessage);
    }

    return {};
};

window.openForm = openForm;
window.openMainModule = openMainModule;
window.printComponents = printComponents;

$("#error-indicator").on("click", function () {
    $("#error-indicator .output").show();
    $("#error-indicator .message").hide();
});


$(window).on("_anvil-call", function (e, resolve, reject) {
    const gotElement = " Got " + (this[Symbol.toStringTag] ?? this) + " element.";
    reject(
        new Sk.builtin.RuntimeError(
            "anvil.call() first argument should be a child DOM element of the Form instance you wish to call the function on. " +
                "The DOM element provided has no parent Form instance." +
                gotElement
        )
    );
});


window.anvil = {
    call: function(jsThis, functionName/*, arg1, arg2, ... */) {
        var args = [].slice.call(arguments,1)
        var e = $(jsThis);
        if (e.length == 0) {
            console.error("Cannot call anvil function on HTML Panel:", jsThis, "Did you forget to supply 'this' as the first argument to anvil.call?");
        } else {
            return new Promise(function(resolve, reject) {
                $(jsThis).trigger("_anvil-call", [resolve, reject].concat(args));
            });
        }
    },
};

module.exports = {
    PyDefUtils: PyDefUtils,
};

/*
 * TO TEST:
 *
 *  - Methods: get_url_hash, set_url_hash
 *  - Form Template generated class: init_components, add_component, clear, __getattr__
 *
 */
