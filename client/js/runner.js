"use strict";

window.RSVP = require('rsvp');

require("./messages");
require("./extra-python-modules.js");

if (navigator.userAgent.indexOf("Trident/") > -1) {
    window.isIE = true;
}

// memoiser for module loaders
let memos = {};
window.memoise = (key, fn) => () => (memos[key] || (memos[key] = fn()));

var componentModule = require("./components");
var PyDefUtils = require("PyDefUtils");
window.PyDefUtils = PyDefUtils;

function initComponentsOnForm(components, pyForm, eventBindingsByName) {
    var componentsByName = {
        "": pyForm,
    };
    var childrenByName = {};
    eventBindingsByName = eventBindingsByName || {};

    var addHandler = function(pyComponent, pyHandler, eventName) {
        // pyHandler is a method.

        var seh = Sk.abstr.gattr(pyComponent,new Sk.builtin.str("set_event_handler"));

        Sk.misceval.call(seh, undefined, undefined, undefined, new Sk.builtin.str(eventName), pyHandler)
    }

    var fns = [Sk.builtin.none.none$];
    for (var j in components) {
        fns.push(function(j) {
            return componentModule.newPythonComponent(components[j], componentsByName, childrenByName, eventBindingsByName, {}, pyForm, null, window.anvilAppDependencies, {}, pyForm._anvil.dataBindings);
        }.bind(null, j));
    }

    fns.push(function() {
        // Register any event handlers for the new component

        pyForm._anvil.componentNames = [];
        for(var name in componentsByName) {
            var pyComponent = componentsByName[name];
            pyForm._anvil.componentNames.push(name);

            if (name) {
                if (Sk.misceval.isTrue(Sk.builtin.hasattr(pyForm, new Sk.builtin.str(name)))) {
                    Sk.misceval.call(Sk.builtins.print, undefined, undefined, undefined, new Sk.builtin.str("Warning: " + pyForm.tp$name + " has a method or attribute '" + name + "' and a component called '" + name + "'. The method or attribute will be inaccessible. This is probably not what you want."));
                }
                Sk.generic.setAttr.call(pyForm, new Sk.builtin.str(name), pyComponent);
            }

            // Add event handlers.

            var bindings = eventBindingsByName[name]
            for (var evt in bindings) {
                if (pyForm[bindings[evt]]) {
                    // The handler exists.
                    addHandler(pyComponent, Sk.abstr.gattr(pyForm, new Sk.builtin.str(bindings[evt])), evt);
                } else {
                    // TODO: Should probably at least warn that we tried to attach a non-existent handler.
                }
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
function loadApp(app, appId, appOrigin, preloadModules) {

    window.setLoading(true);

    // Start watching the DOM for changes, so we can report app height.

    var observer = new MutationObserver(onResize);

    observer.observe($("#appGoesHere")[0], {
        childList: true,
        subtree: true,
    });
    observer.observe($('#alert-modal')[0], {
        childList: true,
        subtree: true
    });

    $(window).on("resize", onResize);

    var showingWatcher = undefined;
    $('.modal').on("show.bs.modal", function() {
        if (showingWatcher) { clearInterval(showingWatcher); showingWatcher=undefined; }
        showingWatcher = setInterval(onResize);
    }).on('shown.bs.modal', function() {
        if (showingWatcher) { clearInterval(showingWatcher); showingWatcher=undefined; }
        onResize();
    }).on('hidden.bs.modal', function() {
        onResize();
    });


    window.anvilAppDependencies = app.dependency_code;

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
        for (var i in app.forms) {
            var f = app.forms[i];
            appModules[getFilePath(f.class_name, f.is_package, topLevelPackage)] = f.code;
        }

        for (var i in app.modules) {
            var m = app.modules[i];
            appModules[getFilePath(m.name, m.is_package, topLevelPackage)] = m.code;
        }
    };

    let dependencyErrors = [];
    let dependencyPackageNames = [];

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

        if (Sk.builtinFiles === undefined || Sk.builtinFiles["files"][x] === undefined)
            throw "File not found: '" + x + "'";

        return Sk.builtinFiles["files"][x];
    };

    var firstMsg = undefined;

    var accumulatingPrints = null;

    var sendLog = function(details) { console.log(details); };

    var stdout = function(text, fromServer) {
        if (text != "\n") {
            if (!firstMsg) { firstMsg = +new Date(); }
            console.log((fromServer?"SERVER: ":"CLIENT: ") + text);
        }

        if (window.anvilOnStdOut) {
            window.anvilOnStdOut(text, fromServer);
        }

        if (!fromServer) {
            if (!accumulatingPrints) {
                accumulatingPrints = [];
                setTimeout(function() {
                    sendLog({print: accumulatingPrints});
                    accumulatingPrints = null;
                });
            }
            if (accumulatingPrints.length != 0 && text == "\n") {
                accumulatingPrints[accumulatingPrints.length-1].s += "\n";
            } else {
                accumulatingPrints.push({t:Date.now(), s:text});
            }
        }
    };

    // jQuery 3 migration

    let jQueryDeprecationWarned = false;
    $.migrateWarnings = {
        push: (msg) => {
            if (jQueryDeprecationWarned)
                return;

            jQueryDeprecationWarned = true;
            stdout("WARNING: This application uses deprecated jQuery 2.2 features. Please see the Javascript console for more details. Error: " + msg);
            sendLog({
                warning: {
                    type: "jquery2-deprecation",
                    msg: msg
                }
            });
        }
    }
    $.migrateMute = false;


    var uncaughtExceptions = {pyHandler: Sk.builtin.none.none$};

    window.onerror = function(errormsg, url, line, col, errorObj) {
        if (errormsg && errormsg.indexOf('__gCrWeb.autofill.extractForms') > -1) {
            // This is a Chrome-on-iOS bug. Only happens when autofill=off in settings. Ignore.
            return;
        }
        try {
            let showErrorPopup = function () {
                $('#error-indicator').show().stop(true).css({"padding-left": 30, "padding-right": 30, right: 10}).animate({"padding-left": 20, "padding-right": 20, right: 20}, 1000); //.css("opacity", "1").animate({opacity: 0.7}, 1000);
            };

            let customErrorHandlerThrewError = function(e) {
                if (e === errorObj) {
                    // It just re-raised, which means it didn't want to interrupt
                    // the default error popup.
                    showErrorPopup();
                } else {
                    // Error handler threw an error. Abandon.
                    uncaughtExceptions.pyHandler = Sk.builtin.none.none$;
                    window.onerror(undefined, undefined, undefined, undefined, e);
                }
            };

            if (serverModuleAndLog && errorObj instanceof serverModuleAndLog.pyMod["SessionExpiredError"]) {
                $("#session-expired-modal button.refresh").off("click").on("click", function() {
                    document.location.href = window.anvilAppOrigin + "/" + (window.anvilParams.accessKey || '');
                });

                if ($('.modal:visible').length > 0) {
                    if ($('.modal:visible')[0].id != "session-expired-modal") {
                        $('.modal').one("hidden.bs.modal", function() {
                            $("#session-expired-modal").modal("show");
                        }).modal('hide');
                    }
                } else {
                    $("#session-expired-modal").modal("show");
                }
            } else if (errorObj instanceof Sk.builtin.Exception) {
                var args = Sk.ffi.remapToJs(errorObj.args);

                var errorMsg = {
                    fn: "pythonError",
                    traceback: errorObj.traceback,
                    type: errorObj.tp$name,
                    msg: args[0],
                }

                if (errorObj._anvil && errorObj._anvil.errorObj) {
                    errorMsg.type = errorObj._anvil.errorObj.type;
                    errorMsg.errorObj = errorObj._anvil.errorObj;
                }

                if (window.anvilOnPythonException) {
                    window.anvilOnPythonException(errorMsg);
                }
                console.log("Python exception: " + errorObj.tp$name + ": " + args[0]);
                if (errorObj.nativeError) {
                    console.log(errorObj.nativeError);
                } else {
                    console.log(errorObj);
                }
                $('#error-indicator .output').text(errorObj.tp$name + ": " + args[0]);

                var logTrace = [];
                for (var i in errorObj.traceback) {
                    var tb = errorObj.traceback[i]
                    logTrace.push([tb.filename, tb.lineno]);
                }
                sendLog({error: {type: errorObj.tp$name, trace: logTrace, message: args[0],
                                 jsTrace: errorObj.nativeError && errorObj.nativeError.stack,
                                 bindingErrors: errorObj._anvil && errorObj._anvil.errorObj && errorObj._anvil.errorObj.bindingErrors,
                                 anvilVersion: window.anvilVersion}});

                if (uncaughtExceptions.pyHandler !== Sk.builtin.none.none$) {
                    PyDefUtils.callAsyncWithoutDefaultError(uncaughtExceptions.pyHandler, undefined, undefined, undefined, errorObj).catch(customErrorHandlerThrewError);
                }

            } else {
                console.error("Uncaught runtime error: " + errormsg + " at " + url + ":" + line + ", column " +
                    col, errorObj);

                if (window.anvilOnRuntimeError) {
                    window.anvilOnRuntimeError(errormsg, url, line, col, errorObj);
                }

                $('#error-indicator .output').text(errormsg);

                let err = {runtimeError: errorObj && errorObj.constructor && errorObj.constructor.name,
                           jsUrl: url, jsLine: line, jsCol: col,
                           message: ""+errorObj, jsTrace: errorObj && errorObj.stack,
                           anvilVersion: window.anvilVersion};

                sendLog({ error: err });

                if (uncaughtExceptions.pyHandler !== Sk.builtin.none.none$) {
                    PyDefUtils.callAsyncWithoutDefaultError(uncaughtExceptions.pyHandler, undefined, undefined, undefined, errorObj).catch(customErrorHandlerThrewError);
                } else {
                    // Log uncaught JS error

                    if (window.anvilOnUncaughtRuntimeError) {
                        window.anvilOnUncaughtRuntimeError(err);
                    }
                }
            }

            if (uncaughtExceptions.pyHandler === Sk.builtin.none.none$) {
                showErrorPopup();
            }
        } catch(e) {
            console.error("Uncaught error in window.onerror! ");
            console.error(e);
        }
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

    // Inject the theme HTML assets into the HtmlTemplate component
    anvilModule["HtmlTemplate"].$_anvilThemeAssets = (app.theme && app.theme.html) || {};
    // Inject them theme colour scheme into the Component class
    anvilModule["Component"].$_anvilThemeColors = (app.theme && app.theme.color_scheme) || {};

    window.anvilCustomComponentProperties = {}; // {'depId:class_name' => properties}
    var defineForm = function(f, anvilModule, topLevelPackage, depId=null) {

        if (f.custom_component) {
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

        aft[aft.length] = anvilModule[className + "Template"] = Sk.misceval.buildClass(anvilModule, function($gbl, $loc) {

            // The setup code is *mostly* in common between __new__ and __new_deserialized__, except for
            // components (__new_deserialized__ already has the objects, whereas __new__ needs to
            // instantiate them), so we keep it mostly in common

            let getContainerKwargs = () => {
                // Here we need to generate kwargs to give to the container constructor and initialiser, (which should be taken directly from the yaml, and cannot be interfered-with by our kwargs)
                let containerKwargs = ["__ignore_property_exceptions", true];
                for (let [k,v] of Object.entries(f.container.properties || {})) {
                    if (v === undefined) continue;
                    containerKwargs.push(k);
                    containerKwargs.push(Sk.ffi.remapToPy(v));
                }
                return containerKwargs;
            }

            let skeletonNew = (cls) => {
                let containerNew = Sk.abstr.typeLookup(anvilModule[f.container.type], new Sk.builtin.str("__new__"));

                if (containerNew && containerNew !== Sk.builtin.object.prototype["__new__"]) {
                    return Sk.misceval.callOrSuspend(containerNew, undefined, undefined, getContainerKwargs(), cls);
                } else {
                    return Sk.misceval.callOrSuspend(Sk.builtin.object.prototype["__new__"], undefined, undefined, undefined, cls);
                }
            };

            // Back half of __new__ for conventionally constructed objects;
            // __deserialize__ for deserialized ones
            let commonSetup = (c, setupComponents) => {
                if (!c._anvil) {
                    c._anvil = {};
                }

                c._anvil.refreshOnItemSet = true;

                /*!componentEvents(form)!1*/
                var events = [
                    {name: "show", description: "When the form is shown on the page",
                     parameters: [], important: true},
                    {name: "hide", description: "When the form is removed from the page",
                     parameters: [], important: true},
                    {name: "refreshing_data_bindings", important: true, parameters: [],
                     description: "When refresh_data_bindings is called"},
                ];

                /*!componentProp(form)!1*/
                var properties = [{
                    name: "item",
                    type: "dict",
                    description: "A dictionary-like object connected to this form",
                    pyVal: true,
                    set: function(s,e,v) {
                        return s._anvil.refreshOnItemSet && Sk.misceval.callsimOrSuspend(s.tp$getattr(new Sk.builtin.str("refresh_data_bindings")));
                    }
                }];
                PyDefUtils.addProperties(c, properties, events);

                if (f.custom_component) {
                    c._anvil.customComponentEventTypes = {};
                    for (let e of f.events || []) {
                        c._anvil.customComponentEventTypes[e.name] = e;
                    }
                    c._anvil.customComponentProperties = f.properties;
                }

                var writeBackChildBoundData = function(pyComponent, attrName, pyNewValue) {
                    if (pyNewValue === undefined) {
                        pyNewValue = pyComponent.tp$getattr(new Sk.builtin.str(attrName));
                    }
                    for (var i in c._anvil.dataBindings) {
                        var binding = c._anvil.dataBindings[i];
                        if (binding.pyComponent === pyComponent && binding.property === attrName && binding.pySave) {
                            return PyDefUtils.callAsyncWithoutDefaultError(binding.pySave, undefined, undefined, undefined, c, pyComponent).catch(function (e) {
                                if (e instanceof Sk.builtin.KeyError) {
                                    return; // Unremarkable
                                }
                                console.error(e);
                                if (e instanceof Sk.builtin.Exception && e.args.v[0] instanceof Sk.builtin.str) {
                                    e.args.v[0] = new Sk.builtin.str(e.args.v[0].v + "\n while setting " + binding.code + " = self." + binding.component_name + "." + binding.property + "\n in a data binding for self." + binding.component_name);
                                }
                                window.onerror(null, null, null, null, e);
                            });
                        }
                    }
                    return Promise.resolve();
                };

                return Sk.misceval.chain(
                    Sk.misceval.callOrSuspend(anvilModule[f.container.type].tp$getattr(new Sk.builtin.str("__init__")), undefined, undefined, getContainerKwargs(), c),
                    () => { c._anvil.props["item"] = new Sk.builtin.dict() },
                    function () {
                        c._anvil.dataBindings = [];
                        
                        for (var i in f.container.data_bindings || []) {
                            var binding = Object.create(f.container.data_bindings[i]);
                            binding.pyComponent = c;
                            binding.component_name = "";
                            c._anvil.dataBindings.push(binding);
                        }

                        return setupComponents(c);
                    }, 
                    function() {
                        for (var i in c._anvil.dataBindings) {
                            var binding = c._anvil.dataBindings[i];
                            binding.pyComponent._anvil.dataBindingWriteback = writeBackChildBoundData;

                            if (binding.code) {
                                var readCode = "def update_val(self, _anvil_component):\n" +
                                               "  _anvil_component." + binding.property + " = " + binding.code + "\n" + 
                                               "def clear_val(self, _anvil_component):\n" +
                                               "  _anvil_component." + binding.property + " = None\n";
                                // TODO: Check whether we actually allowBindingWriteback on this binding property. This is not as simple as 
                                // looking at the propMap of binding.pyComponent, because they could be custom component properties, which 
                                // aren't registered anywhere on the instance.
                                var writeCode = (binding.writeback ?
                                                    "def save_val(self, _anvil_component):\n" +
                                                    "  " + binding.code + " = _anvil_component." + binding.property + "\n"
                                                    : "");
                                var bmod;
                                try {
                                    bmod = Sk.compile(readCode + writeCode, "update_binding.py", "exec", true);
                                } catch(e) {
                                    // Usability: detect the "chose writeback but didn't give an lvalue" situation
                                    if (binding.writeback) {
                                        let readCompiledOk = false;
                                        try {
                                            Sk.compile(readCode, "update_binding.py", "exec", true);
                                            readCompiledOk = true;
                                        } catch(e) {}
                                        if (readCompiledOk) {
                                            throw new Sk.builtin.SyntaxError("Can't assign to data binding expression for " + binding.component_name + "." + binding.property + ", but writeback is enabled for this data binding.");
                                        }
                                    }
                                    throw new Sk.builtin.SyntaxError("Syntax error in data binding for " + binding.component_name + "." + binding.property);
                                }
                                var modlocs = eval(bmod.code + "\n" + bmod.funcname + "({__name__: new Sk.builtin.str('update_binding')});\n");
                                modlocs = Sk.misceval.retryOptionalSuspensionOrThrow(modlocs);
                                binding.pyUpdate = modlocs["update_val"];
                                binding.pyClear = modlocs["clear_val"];
                                binding.pySave = modlocs["save_val"];
                            }
                        }
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
                                let setEventHandler = pyComponent.tp$getattr(new Sk.builtin.str("set_event_handler"));
                                for (let eventName in yaml.event_bindings) {
                                    let pyHandler = c.tp$getattr(new Sk.builtin.str(yaml.event_bindings[eventName]));
                                    if (pyHandler) {
                                        Sk.misceval.callsimArray(setEventHandler, [new Sk.builtin.str(eventName), pyHandler]);
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

                const d = Sk.abstr.lookupSpecial(self, Sk.builtin.str.$dict);
                try {
                    Sk.abstr.objectDelItem(d, new Sk.builtin.str("_serialization_key"))
                } catch(e) {}

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

            $loc["__init__"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs, self) {
                // Sort out property attrs.
                let validKwargs = ["item"];

                if (f.custom_component) {
                    for(let pt of f.properties || []) {
                        validKwargs.push(pt.name);
                    }
                }

                let propAttrs = {};
                // Overwrite any valid props we were given as kwargs.
                for (let i = 0; i < pyKwargs.length; i+=2) {
                    let propName = pyKwargs[i].v;
                    let pyPropVal = pyKwargs[i+1];
                    if (validKwargs.indexOf(propName) > -1) {
                        propAttrs[propName] = pyPropVal;
                    } else {
                        console.log("Ignoring form constructor kwarg: ", propName);
                    }
                }
                var setAttrs = () => Sk.misceval.chain(undefined, 
                    ...Object.entries(propAttrs).map(([propName, pyPropVal]) => 
                        (() => self.tp$setattr(new Sk.builtin.str(propName), pyPropVal, true))));

                return Sk.misceval.chain(undefined,
                    () => { self._anvil.refreshOnItemSet = false; },
                    setAttrs,
                    () => { self._anvil.refreshOnItemSet = true; },
                    () => Sk.misceval.tryCatch(
                        () => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("refresh_data_bindings"))),
                        e => {
                            if (e instanceof Sk.builtin.Exception && e.args.v[0] instanceof Sk.builtin.str) {
                                e.args.v[0] = new Sk.builtin.str(e.args.v[0].v + ". Did you initialise all data binding sources before initialising this component?");
                            }
                            throw e; 
                        })
                    );
            }));

            $loc["item"] = Sk.misceval.callsim(anvilModule['ComponentProperty'], "item", new Sk.builtin.dict());

            if (f.custom_component) {
                // Create property descriptors for custom properties.
                for(let pt of f.properties || []) {
                    $loc[pt.name] = Sk.misceval.callsim(anvilModule['CustomComponentProperty'], pt.name, Sk.ffi.remapToPy(pt.default_value || null));
                }
            }

            // Kept for backwards compatibility.
            $loc["init_components"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs, self) {
                return Sk.misceval.callOrSuspend($loc["__init__"], undefined, undefined, pyKwargs, self);
            }));

            $loc["refresh_data_bindings"] = new Sk.builtin.func(function(self) {
                var chainArgs = [Sk.builtin.none.none$];

                // TODO: Confirm that we want to refresh even if 'item' is None - we don't necessarily just bind to item.
                //var item = self.tp$getattr(new Sk.builtin.str("item"));
                //if (!item || item === Sk.builtin.none.none$) { return Sk.builtin.none.none$; }

                chainArgs.push(() => PyDefUtils.raiseEventOrSuspend({}, self, "refreshing_data_bindings"));
                if (self._anvil.onRefreshDataBindings) {
                    chainArgs.push(self._anvil.onRefreshDataBindings);
                }
                let bindingErrors = [];
                for (var i in self._anvil.dataBindings) {
                    var binding = self._anvil.dataBindings[i]
                    chainArgs.push(function(binding) {
                        return Sk.misceval.tryCatch(function() {
                            if (binding.pyUpdate) {
                                return Sk.misceval.callsimOrSuspend(binding.pyUpdate, self, binding.pyComponent);
                            }
                        }, function(e) {
                            if (e instanceof Sk.builtin.KeyError) {
                                if (binding.pyClear) {
                                    return Sk.misceval.callsimOrSuspend(binding.pyClear, self, binding.pyComponent);
                                } else {
                                    return; // And we can't clear the property, so leave it with whatever value it had. Ew.
                                }
                            }
                            //console.error(e);
                            if (e instanceof Sk.builtin.Exception && e.args.v[0] instanceof Sk.builtin.str) {
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

                        });
                    }.bind(null, binding));
                }

                chainArgs.push(() => {
                    // If there's only one error, we throw the original exception object (so it has the right type etc).
                    // If there were multiple errors, we throw a generic Exception saying "5 errors in this data binding".
                    if (bindingErrors.length == 1) {
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
                        let err = new Sk.builtin.Exception(`Data Binding update failed with ${bindingErrors.length} error${bindingErrors.length > 1 ? 's' : ''}`);
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

                return Sk.misceval.chain(...chainArgs);
            });

            $loc["__setattr__"] = new Sk.builtin.func(function(self, pyName, pyValue) {

                var name = Sk.ffi.remapToJs(pyName);

                if (self._anvil && self._anvil.componentNames && self._anvil.componentNames.indexOf(name) > -1) {
                    throw new Sk.builtin.AttributeError("Cannot set attribute '" + name + "' on '" + self.tp$name + "' form. There is already a component with this name.");
                }

                if (name == "parent") {
                    throw new Sk.builtin.AttributeError("Cannot set a '" + self.tp$name + "' component's parent this way - use 'add_component' on the container instead");
                }

                return Sk.generic.setAttr.call(self, pyName, pyValue, true);
            });

            $loc["__getattr__"] = new Sk.builtin.func(function(self, pyName) {
                var name = Sk.ffi.remapToJs(pyName);

                var componentName = false;
                for (var i in f.components) {
                    if (f.components[i].name == name) {
                        componentName = true;
                        break;
                    }
                }

                if (!componentName && name == "parent") {
                    return self._anvil.parent ? self._anvil.parent.pyObj : Sk.builtin.none.none$;
                }

                throw new Sk.builtin.AttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
            });


        }, className + "Template", [anvilModule[f.container.type]])

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
        var serviceSource = appService.source.replace(/^\/runtime/, window.anvilCDNOrigin + "/runtime");
        var m = /((.*\/)([^\/]*))\.yml/g.exec(serviceSource);
        var serviceName = m[3];
        var serviceUrl = m[1];
        var serviceOrigin = m[2];

        // Cache the client config globally so we can request it if necessary.
        if (appService.client_config)
            window.anvilServiceClientConfig[appService.source] = appService.client_config;
    }

    PyDefUtils.loadModule("anvil", anvilModule);

    var jsonModule = require("./modules/json")();
    PyDefUtils.loadModule("json", jsonModule);

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

    for (let pm of (preloadModules || [])) {
        Sk.misceval.retryOptionalSuspensionOrThrow(Sk.importModule(pm, false, true));
    }

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
    let anvilModule = PyDefUtils.getModule("anvil");
    let openForm = anvilModule.tp$getattr(new Sk.builtin.str("open_form"))
    return PyDefUtils.callAsync(openForm, undefined, undefined, undefined, new Sk.builtin.str(formName));
}

function openMainModule(moduleName) {
    let fullName = window.anvilAppMainPackage + "." + moduleName;
    return Sk.misceval.asyncToPromise(() => Sk.importModuleInternal_(fullName, false, "__main__", undefined, undefined, false, true))
            .catch((e) => window.onerror(undefined, undefined, undefined, undefined, e));
}

function printComponents(printId, printKey) {
    window.outstandingPrintDelayPromises = {};

    return PyDefUtils.asyncToPromise(() => {
        let anvilModule = PyDefUtils.getModule("anvil");
        let openForm = anvilModule.tp$getattr(new Sk.builtin.str("open_form"))
        let serverModule = PyDefUtils.getModule("anvil.server");
        let callFn = serverModule.tp$getattr(new Sk.builtin.str("call"));
        return Sk.misceval.chain(
            Sk.misceval.callsimOrSuspend(callFn, new Sk.builtin.str("anvil.private.pdf.get_component"), new Sk.builtin.str(printId), new Sk.builtin.str(printKey)),
            pyOpenFormTuple => Sk.misceval.applyOrSuspend(openForm, pyOpenFormTuple.v[1], undefined, [], pyOpenFormTuple.v[0].v),
            () => {
                $("#loadingSpinner").hide(); 
                console.log(`Print delay promises: ${JSON.stringify(Object.keys(outstandingPrintDelayPromises))}`);
                return Object.values(outstandingPrintDelayPromises).map(d => d.promise);
            }
        );
    })
    .then(RSVP.all)
    .then(() => {
        delete window.outstandingPrintDelayPromises;
        console.log("READY_TO_PRINT"); // pdf_renderer.py is waiting for this exact output.        
    })
    .catch(e => {
        let data;
        if (e instanceof Sk.builtin.Exception) {
            data = {
                type: (e._anvil && e._anvil.errorObj && e._anvil.errorObj.type) || e.tp$name,
                message: Sk.ffi.remapToJs(e.args.v[0]),
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

window.loadApp = function(params, preloadModules) {
    window.anvilParams = params;

    var appOrigin = params["appOrigin"];
    if (appLoaded) { console.log("Rejected duplicate app load"); return {}; }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(`${appOrigin}/_/service-worker`, {scope: `${appOrigin}`})
        .catch((error) => {
            console.error('Service worker registration failed:', error);
        });
    }


    var appLoadPromise = loadApp(params["app"], params["appId"], appOrigin, preloadModules);
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

$("#error-indicator").on("click", function() {
    $("#error-indicator .output").show();
    $("#error-indicator .message").hide();
})

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
}

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
