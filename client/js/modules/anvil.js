"use strict";

import { validateChild } from "@runtime/components/Container";
import { pluggableUI } from "@runtime/modules/_anvil/pluggable-ui";
import { getClientConfig, topLevelForms } from "@runtime/runner/data";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { warn } from "@runtime/runner/warnings";
import {
    chainOrSuspend,
    promiseToSuspension,
    pyCall,
    pyCallOrSuspend,
    pyFunc,
    pyInt,
    pyNone,
    pyStr,
    pyValueError,
    toJs,
    toPy,
} from "@Sk";
import { asyncToPromise } from "PyDefUtils";
import { notifyComponentMounted, notifyComponentUnmounted } from "../components/Component";
import { anvilServerMod, kwsToObj, pyPropertyFromGetSet, s_clear, s_slots } from "../runner/py-util";
import { defer, getRandomStr } from "../utils";
import Modal, { BOOTSTRAP_MODAL_BG } from "./modal";

module.exports = function(appOrigin, uncaughtExceptions) {

	var PyDefUtils = require("PyDefUtils");

    var pyModule = {
        "__name__": new Sk.builtin.str("anvil"),
        "__path__": new Sk.builtin.tuple([new Sk.builtin.str("anvil-services/anvil"),new Sk.builtin.str("src/lib/anvil")]),
        app_path: Sk.ffi.remapToPy(appOrigin),
        _now: new Sk.builtin.func(function() { return Sk.ffi.remapToPy(Date.now()); }),
    };

    let ByteString, arrayBufferToBytesInternal;
    if (Sk.__future__.python3) {
        ByteString = Sk.builtin.bytes;
        arrayBufferToBytesInternal = (arrayBuffer) => {
            return new Uint8Array(arrayBuffer);
        };
    } else {
        ByteString = Sk.builtin.str;
        // since we're in python2 bytes are represented as binary strings
        arrayBufferToBytesInternal = (arrayBuffer) => {
            let binary = "";
            var bytes = new Uint8Array(arrayBuffer);
            var length = bytes.byteLength;
            for (var i = 0; i < length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return binary;
        };
    }

    const _warnings = {};


    /*#
    id: anvil_module
    docs_url: /docs/client/python#the-anvil-module
    title: Anvil Module
    description: |
      The `anvil` module is imported by default in Forms, and must be referred to explicitly in server modules.

      All the components described in these documents are classes in the `anvil` module. In addition, this module contains some utility functions:

      ```python
      from anvil import *

      print("Our URL hash is: " + repr(get_url_hash()))
      ```

      `get_url_hash()` gets the decoded hash (the part after the '#' character) of the URL used to open this app.

      If the first character of the hash is a question mark (eg `https://myapp.anvil.app/#?a=foo&b=bar`), it will be interpreted as query-string-type parameters and returned as a dictionary (eg `{'a': 'foo', 'b': 'bar'}`).

      `get_url_hash()` is available in Form code only.


      ```python
      from anvil import *

      if app.branch == 'published':
        print("We are on the published branch")

      print("This app's ID is " + app.id)
      ```

      `anvil.app` (or `app` if you've imported `*` from the `anvil` module) is an object containing information about your app:

      \* `anvil.app.branch` is a string that tells you which version of your app is running. If you run the app in the Anvil editor, `anvil.app.branch` will be `"master"`; if you have [published a version of your app](#publishing_an_app) and you're running that, it will be `"published"`.

      \* `anvil.app.id` is a string that contains the unique ID of this app.

    */

    /*!defFunction(anvil,!)!2*/ "Get the decoded hash (the part after the '#' character) of the URL used to open this app. If the first character of the hash is a question mark (eg '#?a=foo&b=bar'), it will be interpreted as query-string-type parameters and returned as a dictionary (eg {'a': 'foo', 'b': 'bar'})."
    pyModule["get_url_hash"] = new Sk.builtin.func(function() {
        var h = document.location.hash;

        if (h[1] == "?" || h[1] == '!' && h[2] == '?') {

            var params = {};
            $.each(h.substring((h[1] == '?') ? 2 : 3).split("&"), function(i,p) {
                var kv = p.split("=");
                params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
            });

            return Sk.ffi.remapToPy(params);
        } else {
            return Sk.ffi.remapToPy(decodeURIComponent(h.substring(1)));
        }

    });

    /*!defFunction(anvil,!,val)!2*/ "Sets the hash of the currently open URL. If val is a string, it is added to the URL after a #. If val is a dictionary, it will be interpreted as query-string-type parameters and added to the URL after a hash and question mark (eg '#?a=foo&b=bar')."
    pyModule["set_url_hash"] = new Sk.builtin.func(function(pyVal) {

        var val = Sk.ffi.remapToJs(pyVal);

        if (typeof(val) == "object") {
            document.location.hash = "?" + $.param(val);
        } else {
            document.location.hash = val;
        }
    })

    /*!defFunction(anvil,!,handler_fn)!2*/ "Set a function to be called when an uncaught exception occurs. If set to None, a pop-up will appear letting the user know that an error has occurred."
    pyModule["set_default_error_handling"] = new Sk.builtin.func(function(f) {
        uncaughtExceptions.pyHandler = f || Sk.builtin.none.none$;
        return Sk.builtin.none.none$;
    });

    pyModule["_generate_internal_error"] = new Sk.builtin.func(function(f) {
        throw {internal: "error"};
    });

    const _environmentClass = Sk.abstr.buildNativeClass("anvil.AppInfo.Environment", {
        constructor: function Environment(data) {
            this.data = window.anvilAppInfo.environment;
        },
        slots: {
            $r() {
                let {description: name, tags} = this.data;
                name = Sk.ffi.toPy(name);
                tags = Sk.ffi.toPy(tags || []);
                return new Sk.builtin.str(`Environment(name=${Sk.misceval.objectRepr(name)}, tags=${Sk.misceval.objectRepr(tags)})`);
            }
        },
        getsets: {
            // todo can remove _$rw$ after PR - https://github.com/skulpt/skulpt/pull/1306 is merged
            name_$rw$: {
                $get() { return Sk.ffi.toPy(this.data.description); }
            },
            tags: {
                $get() { return Sk.ffi.toPy(this.data.tags || []); }
            },
        }
    });
    [/*!defAttr()!1*/ {
        name: "name",
        type: "string",
        description: "The name of the current environment"
    },/*!defAttr()!1*/ {
        name: "tags",
        type: "list",
        description: "tags associated with the current environment"
    }];
    /*!defClass(anvil,#AppEnvironment)!*/

    const rootElement = document.documentElement;

    const _ThemeColors = Sk.abstr.buildNativeClass("anvil.ThemeColors", {
        // for convenience we subclass from mappingproxy
        // not really allowed in python but fine in js
        // saves us implementing all the dict methods
        base: Sk.builtin.mappingproxy,
        constructor: function ThemeColors() {
            // mapping is the internal name used in mapping proxy
            this.mapping = Sk.ffi.toPy(window.anvilThemeColors);
        },
        slots: {
            $r() {
                return new Sk.builtin.str(`ThemeColors(${Sk.misceval.objectRepr(this.mapping)})`);
            },
            tp$as_sequence_or_mapping: true,
            mp$ass_subscript(key, val) {
                if (val === undefined) {
                    throw new Sk.builtin.TypeError("cannot delete a theme color");
                } else if (!Sk.builtin.checkString(key)) {
                    throw new Sk.builtin.TypeError("theme color names must be strings");
                } else if (!Sk.builtin.checkString(val)) {
                    throw new Sk.builtin.TypeError("a theme color must be set to a string");
                }
                const themeColor = key.toString();
                if (!(themeColor in window.anvilThemeColors)) {
                    throw new Sk.builtin.KeyError(key);
                }
                this.mapping.mp$ass_subscript(key, val);
                val = val.toString();
                const varname = this.$getVar(themeColor);
                rootElement.style.setProperty(varname, val);
                window.anvilThemeColors[key] = val;
            },
        },
        methods: {
            update: {
                $meth(args, kws) {
                    const updateDict = PyDefUtils.pyCall(Sk.builtin.dict, args, kws);
                    for (const [key, val] of updateDict.$items()) {
                        this.mp$ass_subscript(key, val);
                    }
                    return Sk.builtin.none.none$;
                },
                $flags: { FastCall: true },
            },
        },
        proto: {
            $getVar(themeName) {
                return (
                    window.anvilThemeVars[themeName] ??
                    (window.anvilThemeVars[themeName] = `--anvil-color-${themeName.replace(
                        (/[^A-z0-9]/g, "-")
                    )}-${getRandomStr(4)}`)
                );
            },
        },
    });

    // can only create this instance after the app has loaded
    let _themeColorsInstance;


    var appInfoClass = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        $loc["__getattr__"] = new Sk.builtin.func(function(self, pyAttrName) {
            var attrName = Sk.ffi.remapToJs(pyAttrName);
            if (Object.prototype.hasOwnProperty.call(window.anvilAppInfo, attrName)) {
                return new Sk.ffi.remapToPy(window.anvilAppInfo[attrName]);
            }
            throw new Sk.builtin.AttributeError(pyAttrName);
        });
        $loc["__setattr__"] = new Sk.builtin.func(function() {
            throw new Sk.builtin.AttributeError("This object is read-only");
        });
        /*!defAttr()!1*/ ({name: "theme_colors", type: "mapping", description: "Theme colors for this app as a readonly dict."});
        $loc["theme_colors"] = pyPropertyFromGetSet((self) => {
            return _themeColorsInstance ?? (_themeColorsInstance = new _ThemeColors());
        });
        /*!defAttr()!1*/ ({
            name: "environment",
            type: "anvil.AppEnvironment instance",
            description: "The environment in which the current app is being run.",
        });
        $loc["environment"] = new pyPropertyFromGetSet((self) => {
            return self._environment || (self._environment = new _environmentClass());
        });
        $loc["get_client_config"] = new Sk.builtin.func(function(self, pyPackageName) {
            const packageName = toJs(pyPackageName);
            try {
                return toPy(getClientConfig(packageName));
            } catch (e) {
                throw new pyValueError(e.message);
            }
        });

        [/*!defAttr()!1*/ {
            name: "id",
            type: "string",
            description: "A unique identifier for the current app",
        },/*!defAttr()!1*/ {
            name: "branch",
            type: "string",
            description: "The Git branch from which the current app is being run. This is 'master' for development apps or apps without a published version, and 'published' if this app is being run from its published version.",
        },];
        /*!defClass(anvil,#AppInfo)!*/

    }, "AnvilAppInfo", []);
    [/*!defModuleAttr(anvil)!1*/{
        name: "app",
        pyType: "anvil.AppInfo instance",
        description: "Information about the current app, as an instance of [anvil.AppInfo](#AppInfo)",
    }];
    pyModule["app"] = PyDefUtils.pyCall(appInfoClass);

    pyModule["pluggable_ui"] = pluggableUI;

    const appPlaceHolder = document.getElementById("appGoesHere");

    function clearPlaceHolder() {
        while (appPlaceHolder.firstChild) {
            appPlaceHolder.removeChild(appPlaceHolder.lastChild);
        }
    }

    const layoutsAreCompatible = (a /*: WithLayout*/, b/*: WithLayout*/) => {
        const aLayout = a._withLayout._withLayoutSubclass.layout, bLayout = b._withLayout._withLayoutSubclass.layout;
        console.log("Checking layout compatibility between", aLayout, "and", bLayout);
        return aLayout.type === bLayout.type &&
            (aLayout.type === "form"
                ? bLayout.formSpec.qualifiedClassName === aLayout.formSpec.qualifiedClassName
                : aLayout.type === "builtin"
                    ? bLayout.name === aLayout.name
                    : bLayout.constructor === aLayout.constructor);
    };

    function assertOpenFormIsComponent(pyForm) {
        if (!pyForm.anvil$hooks) {
            throw new Sk.builtin.TypeError(
                `Attempting to open a form which is not an anvil component, (got type ${pyForm?.tp$name})`
            );
        }
    }

    function openFormInstance(pyForm) {
        assertOpenFormIsComponent(pyForm);

        if (pyForm !== topLevelForms.openForm) {
            // it's ok to call open_form on the same form
            validateChild(pyForm, "open_form");
        }

        clearPlaceHolder();

        const fns = [];
        const oldForm = topLevelForms.openForm;
        if (oldForm) {
            fns.push(() => notifyComponentUnmounted(oldForm, true));
            topLevelForms.openForm = null;
            fns.push(() => {
                if (topLevelForms.openForm !== null) {
                    warn("Warning: You are likely calling 'open_form()' from inside the hide event of the outgoing form (or from one of its components). This may not be what you want.");
                }
                // Re-use layout instances
                if (pyForm._withLayout && !pyForm._withLayout.pyLayout && oldForm?._withLayout && layoutsAreCompatible(pyForm, oldForm)) {
                    // We can re-use this instance! Remove from the old form, clear its slots, reset its properties, clear its event bindings, and give it to the new form
                    const pyLayout = oldForm._withLayout.pyLayout;
                    oldForm._withLayout.pyLayout = undefined;

                    return chainOrSuspend(null,
                        // Clear the layout's slots
                        ...pyLayout.tp$getattr(s_slots).$items().map(([k, v]) => () => pyCallOrSuspend(v.tp$getattr(s_clear), [])),

                        // Set properties of the layout from the new form's kwargs, clearing any that were set by the old form.
                        ...(function* () {
                            const {kwargs} = pyForm._withLayout;
                            const oldFormKwargs = kwsToObj(oldForm._withLayout.kwargs);
                            for (let i=0; i < kwargs.length; i += 2) {
                                const k = kwargs[i], v = kwargs[i+1];
                                yield () => Sk.abstr.sattr(pyLayout, new pyStr(k), v, true);
                                delete oldFormKwargs[k];
                            }
                            // Any remaining oldFormKwargs indicate properties that should be reset to their default value
                            for (const k of Object.keys(oldFormKwargs)) {
                                yield () => Sk.abstr.sattr(pyLayout, new pyStr(k), pyLayout.anvil$customPropsDefaults[k], true);
                            }
                        })(),

                        // Dissociate from the old form
                        () => oldForm._withLayout.onDissociate?.(pyLayout, oldForm),

                        // Associate with the new form
                        () => {
                            pyForm._withLayout.pyLayout = pyLayout;
                            return pyForm._withLayout.onAssociate?.(pyLayout, pyForm);
                        });
                }
            });
        }

        fns.push(() => pyForm.anvil$hooks.setupDom());

        fns.push(() => {
            appPlaceHolder.appendChild(pyForm.anvil$hooks.domElement);
            topLevelForms.openForm = pyForm;
            return notifyComponentMounted(pyForm, true);
        });

        fns.push(() => pyForm);

        return Sk.misceval.chain(null, ...fns);
    }

    let openFormCall = 0;

    /*!defFunction(anvil,!,form,*args,**kwargs)!2*/ "Open the specified form as a new page.\n\nIf 'form' is a string, a new form will be created (extra arguments will be passed to its constructor).\nIf 'form' is a Form object, it will be opened directly."
    pyModule["open_form"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(rawKwargs, pyForm, ...args) {
        const thisFormCall = ++openFormCall;

        if (pyForm === undefined) {
            throw new Sk.builtin.TypeError("anvil.open_form() requires an argument");
        }

        if (!(pyForm instanceof Sk.builtin.str)) {
            return openFormInstance(pyForm);
        }

        const formName = pyForm.toString();

        return Sk.misceval.chain(
            null,
            () => {
                const moduleDict = { __package__: new Sk.builtin.str(window.anvilAppMainPackage) };
                return Sk.builtin.__import__(formName, moduleDict, {}, [], -1);
            },
            () => {
                const leafName = formName.split(".").pop();
                const modName = new Sk.builtin.str(window.anvilAppMainPackage + "." + formName);
                let pyFormMod;
                try {
                    pyFormMod = Sk.sysmodules.mp$subscript(modName);
                } catch {
                    pyFormMod = Sk.sysmodules.mp$subscript(pyForm);
                }

                const formConstructor = pyFormMod.$d[leafName];

                if (!formConstructor) {
                    throw new Sk.builtin.AttributeError(
                        '"' + formName + '" module does not contain a class called "' + leafName + '"'
                    );
                }

                if (rawKwargs) {
                    // Seriously? Skulpt expects raw JS strings in applyOrSuspend(), but Sk.builtin.func()
                    // translates them all into Skulpt strings for us. What a world...
                    for (let i = 0; i < rawKwargs.length; i += 2) {
                        rawKwargs[i] = rawKwargs[i].toString();
                    }
                }

                return PyDefUtils.pyCallOrSuspend(formConstructor, args, rawKwargs);
            },
            (pyForm) => {
                if (thisFormCall !== openFormCall) {
                    // during instantiation of a form, another call to open_form() is made
                    // this either happened during the __init__ method of constructing the form
                    // or some external event like browser back/forward, or clicking a button
                    assertOpenFormIsComponent(pyForm);
                    return pyForm;
                } else {
                    return openFormInstance(pyForm);
                }
            }
        );

    }));

    /*!defFunction(anvil,!)!2*/ "Returns the form most recently opened with open_form()."
    pyModule["get_open_form"] = new Sk.builtin.func(function() {
        return topLevelForms.openForm || Sk.builtin.none.none$;
    });


    /*!defFunction(anvil,boolean)!2*/ "Check whether Anvil is running server side or not."
    pyModule["is_server_side"] = new Sk.builtin.func(function() {
        return Sk.builtin.bool.false$;
    });

    pyModule["Media"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        for (const prop of ["url", "content_type", "length", "name"]) {
            const str_get_prop = new Sk.builtin.str("get_"+prop);
            $loc[prop] = pyPropertyFromGetSet(
                (self) => pyCallOrSuspend(self.tp$getattr(str_get_prop)),
                () => {
                    throw new Sk.builtin.AttributeError(
                        `Cannot change the ${prop} of a Media object; create a new Media object instead`
                    );
                }
            );
        }

        // The following should be implemented by the child class
        $loc["get_content_type"] = new Sk.builtin.func((self) => Sk.builtin.none.none$);
        $loc["get_name"] = new Sk.builtin.func((self) => Sk.builtin.none.none$);
        $loc["get_bytes"] = new Sk.builtin.func((self) => Sk.builtin.none.none$);
        $loc["get_url"] = new Sk.builtin.func((self) => Sk.builtin.none.none$);

        const str_get_bytes = new Sk.builtin.str("get_bytes");
        // By default, it's a hack!
        $loc["get_length"] = new Sk.builtin.func((self) =>
            Sk.misceval.chain(PyDefUtils.pyCallOrSuspend(self.tp$getattr(str_get_bytes)), Sk.builtin.len)
        );

        [/*!defAttr()!1*/ {
            name: "content_type",
            type: "string",
            description: "The MIME type of this Media",
        },
        /*!defAttr()!1*/ {
            name: "url",
            type: "string",
            description: "The URL where you can download this Media, or None if it is not downloadable",
        },
        /*!defAttr()!1*/ {
            name: "length",
            type: "number",
            description: "The length of this Media, in bytes",
        },
        /*!defAttr()!1*/ {
            name: "name",
            type: "string",
            description: "The file name associated with this Media, or None if it has no name",
        }];

        /*!defMethod(_)!2*/ "Get a binary string of the data represented by this Media object";
        ["get_bytes"];

        /*!defMethod(_)!2*/ "Get a Media object's URL, or None if there isn't one associated with it.";
        ["get_url"];

        /*!defClass(anvil,Media)!*/
    }, "Media", []);

    pyModule["URLMedia"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        /*!defMethod(_,url)!2*/ "Create a Media object representing the data at a specific URL. Caution: Getting data from URLs directly in your code will often fail for security reasons, or fail to handle binary data."
        $loc["__init__"] = new Sk.builtin.func(function(self, pyURL) {
            self._url = Sk.ffi.remapToJs(pyURL);
        });

        $loc["get_url"] = new Sk.builtin.func(function(self) { return new Sk.builtin.str(self._url); });

        // Returns a promise
        var doFetch = function(self) {
            if (self._fetch) { return self._fetch; }
            self._fetch = new Promise(function (resolve, reject) {

                if (self._url.substring(0,5) == "data:") {
                    // This is a dataURL. Decode it manually, because we won't be allowed to GET it.
                    var parts = self._url.split(";base64,")
                    var b64Str = parts[1];
                    var val = atob(b64Str);

                    resolve({data: val, contentType: parts[0].substring(5)});
                } else {
                    // TODO: Test this. If it works, #258 can be closed.
                    window.setLoading(true);
                    // NB JQuery "promises" are broken and not chainable; adapt directly
                    $.ajax({
                      url: self._url,
                      type: "GET",
                      dataType: "binary",
                      processData: false,
                    }).then(function(r,ts,xhr) {
                        window.setLoading(false);
                        resolve({data: r.arrayBuffer(), contentType: xhr.getResponseHeader("content-type")});
                    }, function(xhr, textStatus, errorThrown) {
                        window.setLoading(false);
                        let help = "(HTTP "+xhr.status+")";
                        if (xhr.status === 0) {
                            help = "(probably due to a cross-origin URL)";
                        }
                        reject(new Sk.builtin.RuntimeError("Failed to load media "+help+": "+self._url));
                    });

                }
            });
            return self._fetch;
        };

        $loc["get_content_type"] = new Sk.builtin.func(function(self) {
            return new PyDefUtils.suspensionPromise(function(resolve, reject) {
                doFetch(self).then(function(r) { resolve(new Sk.builtin.str(r.contentType)); }, reject);
            });
        });

        $loc["get_bytes"] = new Sk.builtin.func(function(self) {
            return new PyDefUtils.suspensionPromise(function(resolve, reject) {
                doFetch(self).then(function(r) {
                    return r.data;
                }, reject).then(function(arrayBufferOrStr) {
                    if (typeof(arrayBufferOrStr) === "string") {
                        resolve(new ByteString(arrayBufferOrStr));
                    } else {
                        resolve(new ByteString(arrayBufferToBytesInternal(arrayBufferOrStr)))
                    }
                }).catch(e => {
                    console.error(e);
                    reject(e);
                });
            });
        });

        $loc["get_name"] = new Sk.builtin.func(function(self) {
            var names = (""+self._url).replace(/\/+$/, "").split("/");
            if (names && names.length > 0) {
                return new Sk.builtin.str(names[names.length-1])
            } else {
                return Sk.builtin.none.none$;
            }
        })

        /*!defClass(anvil,URLMedia,Media)!*/
	}, 'URLMedia', [pyModule['Media']]);


    pyModule["DataMedia"] = pyModule["BlobMedia"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        /*!defMethod(_,content_type,content,[name=None])!2*/ "Create a Media object with the specified content_type (a string such as 'text/plain') and content (a binary string). Optionally specify a filename as well."
        $loc["__init__"] = PyDefUtils.funcWithRawKwargsDict(function(kwargs, self, contentType, content, name) {
            contentType = contentType || kwargs['content_type'] || kwargs['contentType'];
            content = content || kwargs['content'];

            // Secret Javascript-only calling interface, takes a single Blob param
            // this is used by anvil.js.to_media
            if (contentType instanceof Blob) {
                self._data = contentType;
                self._contentType = self._data.type;
                self._name = content;
            } else if (content === undefined) {
                throw new Sk.builtin.TypeError("BlobMedia() takes two arguments (content_type and content)");
            } else {
                if (!Sk.builtin.checkString(contentType)) {
                    throw new Sk.builtin.TypeError("content_type must be a string, not " + Sk.abstr.typeName(contentType));
                }
                if (Sk.__future__.python3 && !Sk.builtin.checkBytes(content)) {
                    throw new Sk.builtin.TypeError("content must be a byte-string, not " + Sk.abstr.typeName(content));
                } else if (!Sk.__future__.python3 && !Sk.builtin.checkString(content)) {
                    throw new Sk.builtin.TypeError("content must be a string or byte-string, not " + Sk.abstr.typeName(content));
                }
                self._contentType = Sk.ffi.remapToJs(contentType);
                self._data = Sk.ffi.remapToJs(content);
            }
            if ("name" in kwargs) {
                self._name = kwargs["name"];
            } else if (name != undefined) {
                self._name = name;
            }
        });

        $loc["get_url"] = new Sk.builtin.func(function(self, forceDataUrl) {

            if (!Sk.misceval.isTrue(forceDataUrl || false)) {
                return Sk.builtin.none.none$;
            }

            let jsstr;
            if (self._data instanceof Blob) {
                return new PyDefUtils.suspensionPromise(function(resolve, reject) {
                    var fr = new FileReader();
                    fr.onloadend = function() { resolve(new Sk.builtin.str(fr.result)); };
                    fr.readAsDataURL(self._data);
                });
            } else if (self._data instanceof Uint8Array) {
                jsstr = ""
                const uint8 = self._data;
                for (let i = 0; i < uint8.length; i++) {
                    jsstr += String.fromCharCode(uint8[i]);
                } 
            } else {
                jsstr = self._data;
            }
            var b64 = require("../lib/b64");
            return new Sk.builtin.str("data:" + self._contentType.replace(/;/g, "") + ";base64," + b64.base64EncStr(jsstr));
        });

        $loc["get_content_type"] = new Sk.builtin.func(function(self) {
            return new Sk.builtin.str(self._contentType);
        });

        $loc["get_bytes"] = PyDefUtils.funcWithKwargs(function(kwargs, self) {
            if (self._data instanceof Blob) {
                return new PyDefUtils.suspensionPromise(function(resolve, reject) {
                    const fr = new FileReader();
                    fr.onerror = () => reject(fr.error);
                    if (fr.readAsArrayBuffer) {
                        fr.onload = () => resolve(new ByteString(arrayBufferToBytesInternal(fr.result)));
                        fr.readAsArrayBuffer(self._data);
                    } else {
                        fr.onload = () => resolve(new ByteString(fr.result));
                        fr.readAsBinaryString(self._data);
                    }
                });
            } else {
                return new ByteString(self._data);
            }
        });

        $loc["get_name"] = new Sk.builtin.func(function(self) {
            if (self._name !== undefined) {
                return new Sk.builtin.str(self._name);
            } else {
                return Sk.builtin.none.none$;
            }
        });
        /*!defClass(anvil,BlobMedia,Media)!*/
	}, 'BlobMedia', [pyModule['Media']]);


    pyModule["FileMedia"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        $loc["__init__"] = new Sk.builtin.func(function(self, fileObj) {
            if (!(fileObj instanceof File)) {
                throw new Sk.builtin.TypeError("You cannot construct a anvil.FileMedia yourself; it can only come from a File component");
            }

            self._data = fileObj;
            self._contentType = fileObj.type;

            self._name = fileObj.name;
        });
    }, 'FileMedia', [pyModule['BlobMedia']]);

    pyModule["LazyMedia"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        $loc["__init__"] = new Sk.builtin.func(function(self, lmSpec) {
            self.$anvil_isLazyMedia = true
            if (lmSpec && lmSpec.$anvil_isLazyMedia) {
                self._spec = lmSpec._spec;
            } else if (lmSpec && lmSpec.id && lmSpec.key && lmSpec.manager) {
                self._spec = lmSpec;
            } else {
                throw new Sk.builtin.TypeError("You cannot construct a anvil.LazyMedia from Python. Use anvil.BlobMedia instead.")
            }
        });

        var doFetch = function(self) {
            if (self._fetched) {
                return self._fetched;
            }

            var pyKwargs = [];
            var args = new Sk.builtin.list([Sk.ffi.remapToPy(self._spec)]);

            return Sk.misceval.chain(
                anvilServerMod["__anvil$doRpcCall"](pyKwargs, args, "anvil.private.fetch_lazy_media"),
                function (bm) {
                    // bm will be a BlobMedia
                    self._fetched = bm;
                    return bm;
                });
        };

        $loc["get_bytes"] = new Sk.builtin.func(function(self) {
            return Sk.misceval.chain(doFetch(self), function(bm) {
                return Sk.misceval.callsimOrSuspend(Sk.abstr.gattr(bm, new Sk.builtin.str("get_bytes")));
            });
        });

        $loc["get_content_type"] = new Sk.builtin.func(function(self) {
            if (self._spec["mime-type"]) {
                return Sk.ffi.remapToPy(self._spec["mime-type"]);
            } else {
                return Sk.misceval.chain(doFetch(self), function(bm) {
                    return Sk.misceval.callsimOrSuspend(Sk.abstr.gattr(bm, new Sk.builtin.str("get_content_type")));
                });
            }
        });

        $loc["get_url"] = PyDefUtils.funcFastCall(function(args, kws) {
            const [self, pyDownload] = Sk.abstr.copyKeywordsToNamedArgs("get_url", ["self", "download"], args, kws, [Sk.builtin.bool.true$]);
            var appOrigin = Sk.ffi.toJs(anvilServerMod["app_origin"]);//.replace(/[^\/]+\/?$/, "");
            var isDownload = Sk.misceval.isTrue(pyDownload);
            return new Sk.builtin.str(appOrigin + "/_/lm/" + encodeURIComponent(self._spec.manager) + "/" + encodeURIComponent(self._spec.key) + "/" + encodeURIComponent(self._spec.id) + "/" + encodeURIComponent(self._spec.name || "") + "?_anvil_session=" + window.anvilSessionToken + (isDownload ? "" : "&nodl=1"));
        });

        $loc["get_name"] = new Sk.builtin.func(function(self) {
            return self._spec.name !== undefined ? new Sk.builtin.str(self._spec.name) : Sk.builtin.none.none$;
        });
    }, 'LazyMedia', [pyModule['Media']]);

    pyModule["create_lazy_media"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(kwargs) {
        return Sk.misceval.applyOrSuspend(anvilServerMod.call, undefined, undefined, kwargs, [new Sk.builtin.str("anvil.private.mk_LazyMedia")].concat(Array.prototype.slice.call(arguments, 1)));
    }));

    pyModule["LiveObjectProxy"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        var doRpcMethodCall = function(self, methodName, pyKwargs, args) {
            return anvilServerMod["__anvil$doRpcCall"](pyKwargs, args, methodName, self._spec);
        };

        $loc["__init__"] = new Sk.builtin.func(function(self, spec) {
            self._spec = spec;
            self._anvil = {};
            self._anvil_is_LiveObjectProxy = true;
        });

        $loc["__getattr__"] = new Sk.builtin.func(function(self, pyName) {

            var name = pyName.toString();

            if (self._spec.methods.indexOf(name) > -1) {
                return new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs) {

                    var args = Array.prototype.slice.call(arguments, 1);

                    return doRpcMethodCall(self, name, pyKwargs, args);
                }));
            }

            throw new Sk.builtin.AttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
        });

        $loc["__getitem__"] = new Sk.builtin.func(function(self, pyName) {
            
            // Are we iterable?
            if (self._spec.methods.indexOf("__anvil_iter_page__") > -1)
            {
                if (pyName instanceof Sk.builtin.int_) {
                    var idx = Sk.ffi.remapToJs(pyName);

                    if (idx < 0) {
                        throw new Sk.builtin.IndexError("list index cannot be negative");
                    }

                    var pyIter = Sk.misceval.callsim(LiveObjectIterator, self, idx);

                    return PyDefUtils.suspensionFromPromise(
                        PyDefUtils.callAsyncWithoutDefaultError(pyIter.tp$getattr(new Sk.builtin.str("next"))).catch(function(e) {
                            if (e instanceof Sk.builtin.StopIteration) {
                                throw new Sk.builtin.IndexError("list index out of range");
                            }
                            throw e;
                        }));

                } else if (pyName instanceof Sk.builtin.slice) {
                    var start = Sk.ffi.remapToJs(pyName.start);
                    var stop = Sk.ffi.remapToJs(pyName.stop);
                    var step = Sk.ffi.remapToJs(pyName.step);

                    if (start < 0 || stop < 0 || step < 0) {
                        throw new Sk.builtin.ValueError("list slice indices and step cannot be negative");
                    }

                    return Sk.misceval.callsim(LiveObjectIterator, self, start, stop, step);
                }
            }
            // We are not iterable, or pyName wasn't a suitable type.

            // Is it cached?
            if (self._spec.itemCache) {
                var name = Sk.ffi.remapToJs(pyName);
                if (name in self._spec.itemCache) {
                    return self._spec.itemCache[name];
                }
            }

            // Is this implemented on the server?
            if (self._spec.methods.indexOf("__getitem__") != -1) {
                return doRpcMethodCall(self, "__getitem__", [], [pyName]);
            } else {
                throw new Sk.builtin.TypeError("Indexing with [] is not supported on this "+self._spec.backend);
            }
        });

        $loc["__setitem__"] = new Sk.builtin.func(function(self, pyName, pyVal) {
            // Is this implemented on the server?
            if (self._spec.methods.indexOf("__setitem__") != -1) {
                var name = Sk.ffi.remapToJs(pyName);
                if (self._spec.itemCache) {
                    delete self._spec.itemCache[name];
                }
                return Sk.misceval.chain(
                    doRpcMethodCall(self, "__setitem__", [], [pyName, pyVal]),
                    function(r) {
                        var v = undefined;
                        if (self._spec.itemCache) {
                            self._spec.itemCache[name] = pyVal;
                        }
                        return r;
                    });
            } else {
                throw new Sk.builtin.TypeError("Indexing with [] is not supported on this "+self._spec.backend);
            }
        });

        function defOverride(fnName, fnIfNotPresent) {
            $loc[fnName] = new Sk.builtin.func(function(self) {
                if (self._spec.methods.indexOf(fnName) != -1) {
                    return doRpcMethodCall(self, fnName, [], []);
                } else {
                    return fnIfNotPresent(self);
                }
            });
        }
        defOverride("__len__", (self) => { throw new Sk.builtin.TypeError("Cannot call len() on this " + self._spec.backend) });
        defOverride("__nonzero__", () => Sk.builtin.bool.true$);
        defOverride("__bool__", () => Sk.builtin.bool.true$);

        function isEq(self, pyOther) {
            return pyOther && pyOther._anvil_is_LiveObjectProxy && pyOther._spec.id == self._spec.id && pyOther._spec.backend == self._spec.backend;
        }

        $loc["__eq__"] = new Sk.builtin.func(function(self, pyOther) {
            return isEq(self, pyOther) ? Sk.builtin.bool.true$ : Sk.builtin.bool.false$;
        });

        $loc["__ne__"] = new Sk.builtin.func(function(self, pyOther) {
            return isEq(self, pyOther) ? Sk.builtin.bool.false$ : Sk.builtin.bool.true$;
        });

        $loc["__hash__"] = new Sk.builtin.func(function(self) {
            return Sk.builtin.hash(new Sk.builtin.tuple([self._spec.id, self._spec.backend].map((x) => Sk.ffi.remapToPy(x))));
        });

        var LiveObjectIterator = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
            $loc["__init__"] = new Sk.builtin.func(function(self, pyLiveObject, start, limit, step) {
                self._spec = pyLiveObject._spec;
                var i = self._spec.iterItems || {};
                self._items = i.items;
                self._pyNextPage = i.nextPage && Sk.ffi.remapToPy(i.nextPage);
                self._idx = start || 0;
                self._limit = limit;
                self._step = step;
                //console.log("Initial iterator state: ", self._items, self._pyNextPage, self._limit);
            });

            $loc["__iter__"] = new Sk.builtin.func(function(self) {
                return self;
            })

            $loc["next"] = $loc["__next__"] = new Sk.builtin.func(function next(self) {
                if (self._items && self._idx < self._items.length && (self._limit == null || self._idx < self._limit)) {
                    var r = self._items[self._idx];
                    self._idx += self._step != null ? self._step : 1;
                    return r;
                } else if (self._items && (!self._pyNextPage || !Sk.misceval.isTrue(self._pyNextPage))) {
                    throw new Sk.builtin.StopIteration();
                } else if (self._limit != null && self._idx >= self._limit) {
                    throw new Sk.builtin.StopIteration();
                } else {
                    return Sk.misceval.chain(
                        doRpcMethodCall(self, "__anvil_iter_page__", [], [self._pyNextPage || Sk.builtin.none.none$]),
                        function (newState) {
                            // A little jiggery-pokery - newState comes back from doRpcMethodCall() as a Python object...

                            if (self._limit != null)
                                self._limit -= self._items ? self._items.length : 0;
                            self._idx -= self._items ? self._items.length : self._idx;
                            self._pyNextPage = Sk.misceval.isTrue(newState.sq$contains(new Sk.builtin.str("nextPage"))) && newState.mp$subscript(new Sk.builtin.str("nextPage"));
                            self._items = newState.mp$subscript(new Sk.builtin.str("items")).v;

                            //console.log("New iterator state: ", self._items, self._pyNextPage);
                            return next(self);
                        }
                    );
                }
            });
        }, 'LiveObjectIterator', []);


        $loc["__iter__"] = new Sk.builtin.func(function(self) {
            // Is this actually iterable?
            if (self._spec.methods.indexOf("__anvil_iter_page__") < 0) {
                throw new Sk.builtin.TypeError("This " + self._spec.backend + " object is not iterable");
            }

            return Sk.misceval.callsim(LiveObjectIterator, self);
        });

        $loc["__repr__"] = new Sk.builtin.func(function(self) {
            return Sk.ffi.remapToPy("<LiveObject: " + self._spec.backend + ">");
        });

    }, 'LiveObjectProxy', []);

    pyModule["_get_live_object_id"] = new Sk.builtin.func(function(lo) {
        if (lo && lo._anvil_is_LiveObjectProxy) {
            return new Sk.builtin.str(lo._spec.id);
        }
        const getId = lo.tp$getattr(new Sk.builtin.str("get_id"));
        if (getId === undefined) {
            throw new Sk.builtin.TypeError("Argument is not a LiveObject");
        }
        if (_warnings._get_live_object_id === undefined) {
            _warnings._get_live_object_id = true;
            Sk.builtin.print(["Deprecated: _get_live_object_id is no longer required - call row.get_id() instead."]);
        }
        return PyDefUtils.pyCallOrSuspend(getId);
    });

    pyModule["_clear_live_object_caches"] = new Sk.builtin.func(function (lo) {
        if (lo && lo._anvil_is_LiveObjectProxy) {
            lo._spec.itemCache = {};
            lo._spec.iterItems = {};
            return;
        }
        const clearCache = lo.tp$getattr(new Sk.builtin.str("_clear_cache"));
        if (clearCache === undefined) {
            throw new Sk.builtin.TypeError("Argument is not a LiveObject");
        }
        return PyDefUtils.pyCallOrSuspend(clearCache);
    });

    pyModule["_get_service_client_config"] = new Sk.builtin.func(function(pyYmlPath) {
        let path = Sk.ffi.remapToJs(pyYmlPath);
        return Sk.ffi.remapToPy(window.anvilServiceClientConfig[path] || null);
    });

    pyModule["_get_anvil_cdn_origin"] = new Sk.builtin.func(() => {
        return Sk.ffi.remapToPy(window.anvilCDNOrigin);
    });

    /*!defFunction(anvil,!anvil.Component instance)!2*/ "Get the currently focused Anvil component, or None if focus is not in a component."
    pyModule["get_focused_component"] = new Sk.builtin.func(function() {
        let el = document.activeElement;
        let nearestCpt = $(el).closest(".anvil-component");
        if (nearestCpt.length > 0) {
            return nearestCpt.data("anvil-py-component");
        } else {
            return Sk.builtin.none.none$;
        }
    });

    let activeModalLength = 0;

    async function modal(kwargs) {
        let pyForm,
            returnValue = Sk.builtin.none.none$;
        let { large, title, content, buttons, dismissible, role } = kwargs;
        let body = null;
        large = Sk.misceval.isTrue(large);
        dismissible = Sk.misceval.isTrue(dismissible);
        title = Sk.ffi.toJs(kwargs.title) == null ? null : String(title);
        buttons = buttons?.valueOf(); // expects an array
        if (!Array.isArray(buttons)) {
            buttons = [];
        }

        if (content instanceof pyModule["Component"]) {
            pyForm = content;
            body = true;
            validateChild(content, "alert");
        } else if (content) {
            body = content.toString();
        }

        buttons = buttons.map((pyBtnArg) => {
            const jsBtnArg = pyBtnArg?.valueOf();
            let text = "";
            let val = Sk.builtin.none.none$;
            let style = "";

            if (typeof jsBtnArg === "string") {
                text = jsBtnArg;
                val = pyBtnArg;
            } else if (Array.isArray(jsBtnArg)) {
                // Expect b to be a tuple (txt, val, style)
                [text = "", val = Sk.builtin.none.none$, style = ""] = jsBtnArg;
                text = String(text);
                style = String(style);
            } else {
                // just ignore and use the default values for text and val;
            }

            const onClick = () => {
                returnValue = val;
            };

            return { text, style, onClick };
        });


        const a = await Modal.create({
            id: activeModalLength++,
            large,
            title,
            dismissible,
            body,
            buttons,
            backdrop: dismissible || "static",
            keyboard: dismissible,
        });

        if (role) {
            PyDefUtils.applyRole(role, a.elements.modalDialog);
        }

        const { promise: promiseReturnValue, resolve: resolveReturnValue } = defer();


        const hideFns = [];
        const showFns = [];

        if (pyForm) {
            const formElement = await asyncToPromise(() => pyForm.anvil$hooks.setupDom());
            a.elements.modalBody.append(formElement);
            // use set_event_handler - we want to reset this event if the same form
            // is added to a modal multiple times
            pyCall(pyForm.tp$getattr(new Sk.builtin.str("set_event_handler")), [
                new Sk.builtin.str("x-close-alert"),
                PyDefUtils.funcWithRawKwargsDict((kws) => {
                    returnValue = kws.value ?? pyNone;
                    a.hide();
                }),
            ]);

            hideFns.push(() => notifyComponentUnmounted(pyForm, true));
            showFns.push(() => notifyComponentMounted(pyForm, true));
        }

        let hideFired = false;
        a.once("hide", () => {
            hideFired = true;
        });

        a.once("hidden", () => {
            activeModalLength--;
            if (pyForm) {
                $(pyForm.anvil$hooks.domElement).detach();
                topLevelForms.alertForms.delete(pyForm);
            }
            asyncToPromise(() => chainOrSuspend(null, ...hideFns)).then(() => resolveReturnValue(returnValue));
        });

        a.once("show", async () => {
            if (hideFired) {
                return;
            }
            if (pyForm) {
                // do this synchronously
                // it's possible for hide to be called before shown
                topLevelForms.alertForms.add(pyForm);
            }
            await asyncToPromise(() => chainOrSuspend(null, ...showFns));
        });

        await a.show();
        return promiseReturnValue;

    }

    /*#
    id: alerts
    docs_url: /docs/client/python/alerts-and-notifications
    title: Alerts
    description: |
      You can display popup messages using the `alert` and `confirm` 
      functions. They are in the `anvil` module, so will be imported by default.

      #### Messages

      ```
      alert("Welcome to Anvil")
      ```

      The simplest way to display a popup message is to call the `alert` function. 
      You must supply at least one argument: The message to be displayed. The `alert` 
      function will return `True` if the user clicks OK, or `None` if they dismiss
      the popup by clicking elsewhere. The example on the right produces the following popup:

      ![Alert popup](img/alert.png)

      #### Confirmations

      ```
      c = confirm("Do you wish to continue?")
      # c will be True if the user clicked 'Yes'
      ```

      If you want to ask your user a yes/no question, just call the `confirm` function
      in the same way. The `confirm` function returns `True` if the user clicks Yes, 
      `False` if the user clicks No, and `None` if they dismiss the popup by clicking elsewhere (See `dismissible` keyword argument, below).

      ![Alert popup](img/confirm.png)

      #### Custom popup styles

      ```
      # Display a large popup with a title and three buttons.
      result = alert(content="Choose Yes or No",
                     title="An important choice",
                     large=True,
                     buttons=[
                       ("Yes", "YES"),
                       ("No", "NO"),
                       ("Neither", None)
                     ])

      print "The user chose %s" % result
      ```

      You can customise alerts by passing extra named arguments to the `alert` (or `confirm`) function:

      \* `content` - The message to display. This can be a string or a component (see below)
      \* `title` - The title of the popup box
      \* `large` - Whether to display a wide popup (default: `False`)
      \* `buttons` - A list of buttons to display. Each item in the list
        should be a tuple <code>(<i>text</i>,<i>value</i>)</code>,
        where <code><i>text</i></code> is the text to display on the button,
        <code><i>value</i></code> is the value to return if the user clicks the button,
      \* `dismissible` - Whether this modal can be dismissed by clicking on the backdrop of the page. An alert dismissed in this way will return `None`. If there is a title, the title bar will contain an 'X' that dismisses the modal. (default: `True`)

      ![Alert popup](img/modal.png)

      #### Custom popup content

      ```python
      t = TextBox(placeholder="Email address")
      alert(content=t,
            title="Enter an email address")
      print "You entered: %s" % t.text
      ```

      You can display custom components in alerts by setting the content argument to an instance of a component instead of a string.

      For complex layouts or interaction, you can set the content to an instance of one of your own forms. To close
      the alert from code inside your form, raise the `x-close-alert` event with a `value` argument:

      `self.raise_event("x-close-alert", value=42)`

      The alert will close and return the value `42`.
    */

    /*!defFunction(anvil,_,content,[title=""],[buttons=],[large=False],[dismissible=True],[role=])!2*/ "Pop up an alert box. By default, it will have a single \"OK\" button which will return True when clicked."
    pyModule["alert"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwarray, pyContent) {
        const kwargs = PyDefUtils.keywordArrayToHashMap(pyKwarray);
        kwargs.content ??= pyContent;
        kwargs.dismissible ??= true;
        kwargs.buttons = kwargs.buttons || Sk.ffi.toPy([
            ["OK", true, "success"],
        ]);

        return PyDefUtils.suspensionFromPromise(modal(kwargs));
    }));

    /*!defFunction(anvil,_,content,[title=""],[buttons=],[large=False],[dismissible=False], [role=])!2*/ "Pop up a confirmation box. By default, it will have \"Yes\" and \"No\" buttons which will return True and False respectively when clicked."
    pyModule["confirm"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwarray, pyContent) {
        const kwargs = PyDefUtils.keywordArrayToHashMap(pyKwarray);
        kwargs.content ??= pyContent;
        kwargs.buttons ??= Sk.ffi.toPy([
            ["No", false, "danger"],
            ["Yes", true, "success"],
        ]);
        kwargs.dismissible ??= false;

        return PyDefUtils.suspensionFromPromise(modal(kwargs));
    }));


    /*#
    id: notifications
    docs_url: /docs/client/python/alerts-and-notifications#notifications
    title: Notifications
    description: |
      You can display temporary notifications by creating `Notification` objects.

      ![Notification screenshot](img/notification.png)

      ```python
      n = Notification("This is an important message!")
      n.show()
      ```
      
      To show a simple notification with some content, call the `show()` method.
      By default, it will disappear after 2 seconds.


      ```python
      with Notification("Please wait..."):
        # ... do something slow ...
      ```

      If you use a notification in a `with` block, it will be displayed as long as
      the body of the block is still running. It will then disappear.


      ```python
      n = Notification("This is an important message!",
                       timeout=None)
      n.show()

      # Later...
      n.hide()
      ```

      You can specify the timeout manually (in seconds), or set it to `None` or `0` to have the notification stay
      visible until you explicitly call its `hide()` method.

      ```
      Notification("A message",
                   title="A message title",
                   style="success").show()
      ```

      As well as a message, notifications can also have a title. Use the `style` 
      keyword argument to set the colour of the notification. Use `"success"` for green,
      `"danger"` for red, `"warning"` for yellow, or `"info"` for blue (default).


    */
    pyModule["Notification"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        // adjusted in runtimeVersion >= 3 to prefix bootstrap classes e.g. .col-sm-4 and .close
        // still relies on animate.css
        let templateArgs;
        const getTemplateArgs = () => {
            if (!templateArgs || window.anvilParams.runtimeVersion >= 3) {
                const prefix = getCssPrefix();
                const template = `<div data-notify="container" class="${prefix}col-xs-11 ${prefix}col-sm-4 ${prefix}alert ${prefix}alert-{0}" role="alert">
                <button type="button" aria-hidden="true" class="${prefix}close" data-notify="dismiss">&times;</button>
                <span data-notify="icon"></span> <span data-notify="title">{1}</span> <span data-notify="message">{2}</span>
                `;
                const animate = {
                    enter: `${prefix}animated ${prefix}fadeInDown`,
                    exit: `${prefix}animated ${prefix}fadeOutUp`,
                };
                templateArgs = { template, animate };
            }

            return (templateArgs ??= {});
        };


        function _show(self) {
            if (self._anvil.notification) {
                throw new Sk.builtin.RuntimeError("Notification already visible");
            }

            const {message, title, style: type, timeout} = self._anvil;
            const { template, animate } = getTemplateArgs();

            self._anvil.notification = $.notify(
                { message, title },
                {
                    type,
                    delay: timeout || 2000,
                    timer: timeout === 0 ? 0 : 10,
                    placement: { from: "top", align: "center" },
                    mouse_over: "pause",
                    template,
                    z_index: BOOTSTRAP_MODAL_BG, // same as alerts
                    animate,
                    onClosed() {
                        self._anvil.notification = null;
                    },
                }
            );

            // ensure we give the javascript event loop an opportunity to render the notification.
            return chainOrSuspend(promiseToSuspension(new Promise((resolve) => setTimeout(resolve))), () => self);
        }

        /*!defMethod(,message,[title=""],[style="info"], [timeout=2])!2*/ "Create a popup notification. Call the show() method to display it.";
        $loc["__init__"] = PyDefUtils.funcFastCall(function (args, kws) {
            const [self, message, title, style, timeout] = Sk.abstr.copyKeywordsToNamedArgs(
                "Notification",
                ["self", "message", "title", "style", "timeout"],
                args,
                kws,
                [pyStr.$empty, new pyStr("info"), new pyInt(2)]
            );

            self._anvil = {
                message: toJs(message),
                title: toJs(title),
                style: toJs(style),
                timeout: toJs(timeout) * 1000,
            };

            return pyNone;
        });

        // TODO: Decide whether we want to suspend until the notification has finished opening/closing.

        /*!defMethod(anvil.Notification instance)!2*/ "Shows the notification";
        $loc["show"] = new pyFunc((self) => _show(self));

        /*!defMethod(anvil.Notification instance)!2*/ "Show the notification when entering a 'with' block";
        $loc["__enter__"] = new pyFunc(function (self) {
            self._anvil.timeout = 0;
            return _show(self);
        });

        /*!defMethod(_)!2*/ "Hides the notification immediately";
        $loc["hide"] = new pyFunc(function (self) {
            self._anvil.notification?.close?.();
            return pyNone;
        });

        /*!defMethod(anvil.Notification instance)!2*/ "Hide the notification when exiting a 'with' block";
        $loc["__exit__"] = $loc["hide"];

        // TODO: Support progress bars, for which we'll need the "update" method.

        /*!defClass(anvil,Notification)!*/
    }, "Notification", []);

    // The anvil.download() function used to be here, but has moved to anvil.media.download(). The anvil.media module aliases the function back to here for backwards compatibility.

    return pyModule;
};
