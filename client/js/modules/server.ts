"use strict";

import { setOnDebuggerMessage } from "@runtime/modules/_server/handlers";
import { registerServerCallSuspension } from "@runtime/modules/_server/rpc";
import { data } from "@runtime/runner/data";
import { anvilMod, s__get__, s__module__, s__name__ } from "@runtime/runner/py-util";
import {
    Args,
    buildNativeClass,
    buildPyClass,
    chainOrSuspend,
    checkCallable,
    checkString,
    isTrue,
    Kws,
    objectRepr,
    promiseToSuspension,
    pyAttributeError,
    pyBool,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyCheckType,
    pyException,
    pyFunc,
    pyIterFor,
    pyList,
    pyLookupError,
    pyNewableType,
    pyNone,
    pyNoneType,
    pyNotImplemented,
    pyObject,
    pyObjectHash,
    pyRuntimeError,
    pyStr,
    pyType,
    pyTypeError,
    pyValueError,
    richCompareBool,
    setUpModuleMethods,
    toJs,
    toPy,
    typeName,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { anvilAppOnline } from "../app_online";
import { globalSuppressLoading } from "../utils";
import { loading_indicator } from "./_anvil/loading-indicator";
import {
    connect,
    doHttpCall,
    doRpcCall,
    pyNamedExceptions,
    pyServerEventHandlers,
    pyValueTypes,
    sendLog,
    SerializationInfo,
    websocket,
} from "./_server";
import type { Capability } from "./_server/types";

//@ts-ignore
module.exports = function (appId: string, appOrigin: string) {
    const pyMod: { [attr: string]: pyObject } = {
        __name__: new pyStr("anvil.server"),
        app_origin: toPy(appOrigin),
        loading_indicator,
    };

    const checkCommand = (cmd: any): cmd is pyStr => {
        if (!(cmd instanceof pyStr)) {
            const msg = `first argument to anvil.server.call() must be as str, got '${typeName(cmd)}'`;
            throw new pyTypeError(msg);
        }
        return true;
    };

    pyMod["_call_http"] = new pyFunc(
        PyDefUtils.withRawKwargs(function (pyKwargs: Kws, pyCmd: pyStr, ...args: Args) {
            checkCommand(pyCmd);
            return doHttpCall(pyKwargs, args, pyCmd.toString());
        })
    );

    const doServerCall = window.anvilParams.isCrawler ? doHttpCall : doRpcCall;

    pyMod["call_$rw$"] = new pyFunc(
        PyDefUtils.withRawKwargs(function (pyKwargs: Kws, pyCmd: pyStr, ...args: Args) {
            checkCommand(pyCmd);
            return doServerCall(pyKwargs, args, pyCmd.toString());
        })
    );

    pyMod["call_s"] = new pyFunc(
        PyDefUtils.withRawKwargs(function (pyKwargs: Kws, pyCmd: pyStr, ...args: Args) {
            checkCommand(pyCmd);
            return doServerCall(pyKwargs, args, pyCmd.toString(), undefined, true);
        })
    );

    pyMod["launch_background_task"] = new pyFunc(
        PyDefUtils.withRawKwargs((pyKwargs: Kws, pyCmd: pyStr, ...args: Args) => {
            throw new pyRuntimeError("Cannot launch Background Tasks from client code.");
        })
    );

    pyMod["__anvil$doRpcCall"] = doServerCall as unknown as pyObject; // Ew.

    pyMod["LazyMedia"] = anvilMod["LazyMedia"]; // Also Ew.

    // This class is deprecated - no need to subclass it any more.
    pyMod["Serializable"] = buildPyClass(pyMod, () => {}, "Serializable", [pyObject]);

    pyMod["_n_invalidations"] = toPy(0);

    const _CapAny = buildNativeClass("_CapAny", {
        constructor: function () {},
        slots: {
            $r() {
                return new pyStr("ANY");
            },
        },
    });
    const _ANY = Object.create(_CapAny.prototype);

    const pyCapability: pyNewableType<Capability> = (pyMod["Capability"] = buildNativeClass("anvil.server.Capability", {
        constructor: function Capability(scope, mac, narrow) {
            this._nInvalidations = pyMod["_n_invalidations"].valueOf();
            this._scope = scope;
            this._mac = mac;
            this._narrow = narrow || (narrow = []);
            this._localTag = null;
            this._hash = null;
            const fullScope = scope.concat(narrow);
            this._fullScope = fullScope;
            this._JSONScope = JSON.stringify(fullScope);
            this._doApplyUpdate = null;
            this._applyUpdate = (pyUpdate: any) => {
                if (!this._doApplyUpdate) {
                    return pyNone;
                }
                return PyDefUtils.pyCallOrSuspend(this._doApplyUpdate, [pyUpdate]);
            };
            let pyFullScope;
            Object.defineProperties(this, {
                _pyFullScope: {
                    get() {
                        // always return a different object so that it can be changed in python.
                        pyFullScope ??= toPy(fullScope).valueOf();
                        return new pyList([...pyFullScope]);
                    },
                },
            });
        },
        slots: {
            tp$new(_args, _kws) {
                throw new pyRuntimeError("Cannot create new Capability objects in Form code.");
            },
            $r() {
                const scopeRepr = objectRepr(this._pyFullScope);
                return new pyStr(`<anvil.server.Capability:${scopeRepr}>`);
            },
            tp$hash() {
                return (this._hash ??= pyObjectHash(new pyStr(this._JSONScope)));
            },
            tp$richcompare(other, op) {
                if ((op !== "Eq" && op !== "NotEq") || other.ob$type !== pyCapability) {
                    return pyNotImplemented;
                }
                const ret = richCompareBool(this._pyFullScope, other._pyFullScope, "Eq");
                return op === "Eq" ? ret : !ret;
            },
        },
        methods: {
            /*!defBuiltinMethod(anvil.server.Capability instance,additional_scope)!1*/
            narrow: {
                $name: "narrow",
                $meth(pyNarrowSuffix) {
                    if (!(pyNarrowSuffix instanceof pyList)) {
                        throw new pyTypeError("The narrow argument of a Capability should be a list");
                    }
                    let jsNarrow;
                    try {
                        const failHook = () => {
                            throw Error("bad pyobject");
                        };
                        jsNarrow = toJs(pyNarrowSuffix, { setHook: failHook, unhandledHook: failHook });
                    } catch {
                        throw new pyTypeError("The narrow argument provided is not valid JSON data.");
                    }
                    const narrow = this._narrow.concat(jsNarrow);
                    return new pyCapability(this._scope, this._mac, narrow);
                },
                $flags: { OneArg: true },
                $doc: "Return a new capability that is narrower than this one, by appending additional scope element(s) to it.",
            },
            /*!defBuiltinMethod(_,apply_update:callable,[get_update:callable])!1*/
            set_update_handler: {
                $name: "set_update_handler",
                $meth(pyApplyUpdate, _ignored) {
                    this._doApplyUpdate = pyApplyUpdate;
                    return pyNone;
                },
                $flags: { MinArgs: 1, MaxArgs: 2 },
                $doc: "Set a handler for what happens when an update is sent to this capability.\n\nOptionally provide a function for aggregating updates (default behaviour is to merge them, if they are all dictionaries, or to return only the most recent update otherwise.)",
            },
            /*!defBuiltinMethod(_,update)!1*/
            send_update: {
                $name: "send_update",
                $meth(pyUpdate) {
                    return this._applyUpdate(pyUpdate);
                },
                $flags: { OneArg: true },
                $doc: "Send an update to the update handler for this capability, in this interpreter and also in any calling environment (eg browser code) that passed this capability into the current server function.",
            },
        },
        getsets: {
            scope: {
                $get() {
                    return this._pyFullScope;
                },
            },
            is_valid: {
                $get() {
                    return new pyBool(this._nInvalidations === pyMod["_n_invalidations"].valueOf());
                },
            },
        },
        proto: {
            ANY: _ANY,
        },
        flags: {
            sk$unacceptableBase: true,
        },
    }));
    [
        /*!defAttr()!1*/ {
            name: "scope",
            type: "list",
            description:
                "A list representing what this capability represents. It can be extended by calling narrow(), but not shortened.\n\nEg: ['my_resource', 42, 'foo']",
        },
        /*!defAttr()!1*/ {
            name: "is_valid",
            type: "boolean",
            description:
                "True if this Capability is still valid; False if it has been invalidated (for example, by session expiry)",
        },
        /*!defClassAttr()!1*/ {
            name: "ANY",
            type: "object",
            description: "Sentinel value for unwrap_capability",
        },
    ];
    /*!defClass(anvil.server, Capability)!*/

    pyMod["unwrap_capability"] = new pyFunc((cap, scopePattern) => {
        if (pyType(cap) !== pyCapability) {
            throw new pyTypeError("The first argument must be a Capability");
        }
        if (!(scopePattern instanceof pyList)) {
            throw new pyTypeError(`scope_pattern should be a list, not ${typeName(scopePattern)}`);
        }
        const patArr = scopePattern.valueOf();
        const scope = cap._pyFullScope;
        const scopeArr = scope.valueOf();
        if (scopeArr.length > patArr.length) {
            throw new pyValueError(
                `Capability is too narrow: required ${objectRepr(scopePattern)}; got ${objectRepr(scope)}`
            );
        }
        const ret = new Array(patArr.length).fill(pyNone);
        for (let i = 0; i < scopeArr.length; i++) {
            const patVal = patArr[i];
            const scopeVal = scopeArr[i];
            if (patVal === _ANY || scopeVal === patVal || richCompareBool(scopeVal, patVal, "Eq")) {
                ret[i] = scopeVal;
            } else {
                throw new pyValueError(
                    `Incorrect Capability: required ${objectRepr(scopePattern)}; got ${objectRepr(scope)}`
                );
            }
        }
        return new pyList(ret);
    });

    pyMod["SerializationInfo"] = SerializationInfo;

    pyMod["_register_exception_type"] = new pyFunc(function (pyName: pyStr, pyClass: pyNewableType<pyException>) {
        if (!pyName || !(pyName instanceof pyStr) || !pyClass) {
            throw new pyTypeError("Invalid call to _register_exception_type");
        }
        pyNamedExceptions[pyName.v] = pyClass;
        return pyNone;
    });

    const s_message = new pyStr("message");

    pyMod["AnvilWrappedError"] = buildPyClass(
        pyMod,
        function ($gbl, $loc) {
            $loc["__init__"] = new pyFunc((self, message) => {
                message ||= pyStr.$empty;
                self.tp$setattr(s_message, message);
                return pyNone;
            });

            $loc["__repr__"] = new pyFunc((self) => {
                const r = pyException.prototype.$r.call(self);
                if (self.ob$type !== pyMod["AnvilWrappedError"]) {
                    return r;
                }
                const type = self._anvil?.errorObj?.type;
                if (type === undefined) {
                    return r;
                }
                return new pyStr(`AnvilWrappedError(${type + r.toString().slice("AnvilWrappedError".length)})`);
            });
        },
        "AnvilWrappedError",
        [pyException]
    );

    /*!defClass(anvil.server,%SessionExpiredError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.SessionExpiredError"] = pyMod["SessionExpiredError"] = buildPyClass(
        pyMod,
        ($gbl, $loc) => {
            $loc["__init__"] = new pyFunc(function init(self) {
                self.traceback = [];
                self.args = new pyList([toPy("Session expired")]);
                return pyNone;
            });
        },
        "SessionExpiredError",
        [pyException]
    );

    pyMod["AnvilSessionExpiredException"] = pyMod["SessionExpiredError"];

    /*!defClass(anvil.server,!AppOfflineError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.AppOfflineError"] = pyMod["AppOfflineError"] = buildPyClass(
        pyMod,
        () => {},
        "AppOfflineError",
        [pyException]
    );

    /*!defClass(anvil.server,%UplinkDisconnectedError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.UplinkDisconnectedError"] = pyMod["UplinkDisconnectedError"] = buildPyClass(
        pyMod,
        () => {},
        "UplinkDisconnectedError",
        [pyException]
    );

    /*!defClass(anvil.server,%ExecutionTerminatedError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.ExecutionTerminatedError"] = pyMod["ExecutionTerminatedError"] = buildPyClass(
        pyMod,
        () => {},
        "ExecutionTerminatedError",
        [pyException]
    );

    /*!defClass(anvil.server,%TimeoutError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.TimeoutError"] = pyMod["TimeoutError"] = buildPyClass(
        pyMod,
        () => {},
        "TimeoutError",
        [pyException]
    );

    /*!defClass(anvil.server,SerializationError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.SerializationError"] = pyMod["SerializationError"] = buildPyClass(
        pyMod,
        () => {},
        "SerializationError",
        [pyException]
    );

    /*!defClass(anvil.server,%InternalError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.InternalError"] = pyMod["InternalError"] = buildPyClass(
        pyMod,
        () => {},
        "InternalError",
        [pyException]
    );

    /*!defClass(anvil.server,%RuntimeUnavailableError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.RuntimeUnavailableError"] = pyMod["RuntimeUnavailableError"] = buildPyClass(
        pyMod,
        () => {},
        "RuntimeUnavailableError",
        [pyException]
    );

    /*!defClass(anvil.server,%QuotaExceededError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.QuotaExceededError"] = pyMod["QuotaExceededError"] = buildPyClass(
        pyMod,
        () => {},
        "QuotaExceededError",
        [pyException]
    );

    /*!defClass(anvil.server,%NoServerFunctionError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.NoServerFunctionError"] = pyMod["NoServerFunctionError"] = buildPyClass(
        pyMod,
        () => {},
        "NoServerFunctionError",
        [pyException]
    );

    /*!defClass(anvil.server,PermissionDenied, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.PermissionDenied"] = pyMod["PermissionDenied"] = buildPyClass(
        pyMod,
        () => {},
        "PermissionDenied",
        [pyException]
    );

    /*!defClass(anvil.server,%InvalidResponseError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.InvalidResponseError"] = pyMod["InvalidResponseError"] = buildPyClass(
        pyMod,
        () => {},
        "InvalidResponseError",
        [pyException]
    );

    // This one is for testing! It's raised by anvil.private.fail
    pyNamedExceptions["anvil.server._FailError"] = pyMod["_FailError"] = buildPyClass(pyMod, () => {}, "_FailError", [
        pyException,
    ]);

    /*!defClass(anvil.server,%BackgroundTaskError, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.BackgroundTaskError"] = pyMod["BackgroundTaskError"] = buildPyClass(
        pyMod,
        () => {},
        "BackgroundTaskError",
        [pyException]
    );

    /*!defClass(anvil.server,%BackgroundTaskNotFound, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.BackgroundTaskNotFound"] = pyMod["BackgroundTaskNotFound"] = buildPyClass(
        pyMod,
        () => {},
        "BackgroundTaskNotFound",
        [pyException]
    );

    /*!defClass(anvil.server,%BackgroundTaskKilled, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.BackgroundTaskKilled"] = pyMod["BackgroundTaskKilled"] = buildPyClass(
        pyMod,
        () => {},
        "BackgroundTaskKilled",
        [pyException]
    );

    /*!defClass(anvil.server,ServiceNotAdded, __builtins__..Exception)!*/
    pyNamedExceptions["anvil.server.ServiceNotAdded"] = pyMod["ServiceNotAdded"] = buildPyClass(
        pyMod,
        () => {},
        "ServiceNotAdded",
        [pyException]
    );

    /*!defFunction(anvil.server, context, component_name=None, min_height=None)!2*/
    ({
        anvil$helplink: "/docs/client",
        $doc: "By default, a loading indicator is displayed when your app is retrieving data. This stops users from being able to interact with your app while the server returns data. `loading_indicator` is a context manager which allows you to create loading indicators manually.",
        anvil$args: {
            component_name:
                "Optionally give the component or container that the loading indicator should overlay. This will block any user interaction with the given component, and any child components they have.",
            min_height:
                "Optionally set the minimum height of the loading indicator. If no minimum height is given and no `component_name` is given, it defaults to the size of the image or SVG being used. If no minimum height is given but a `component_name` _is_ given, then the indicator scales to fit the component or container.",
        },
    });
    ["loading_indicator"];

    const _NoLoadingIndicator = buildPyClass(
        pyMod,
        function ($gbl, $loc) {
            $loc["__enter__"] = new pyFunc(function (self) {
                globalSuppressLoading.inc();
                return self;
            });
            $loc["__exit__"] = new pyFunc(function (self) {
                globalSuppressLoading.dec();
                return pyNone;
            });
        },
        "no_loading_indicator",
        []
    );

    /*!defModuleAttr(anvil.server)!1*/
    ({
        name: "!no_loading_indicator",
        description:
            "Use `with anvil.server.no_loading_indicator:` to suppress the loading indicator when making server calls",
    });
    pyMod["no_loading_indicator"] = pyCall(_NoLoadingIndicator);

    // @ts-expect-error
    const invalidatedMacs = (pyMod["__anvil$doInvalidatedMacs"] = () => {
        console.log("Invalidated MACs!");
        pyMod["_n_invalidations"] = toPy(pyMod["_n_invalidations"].valueOf() + 1);

        return pyIterFor(pyMod["_invalidation_callbacks"].tp$iter(), (f) => pyCallOrSuspend(f, []));
    });

    /*!defFunction(anvil.server,!_)!2*/ ("Reset the current session to prevent further SessionExpiredErrors.");
    pyMod["reset_session"] = new pyFunc(function () {
        // Prevent the session from complaining about expiry.
        return chainOrSuspend(
            pyCallOrSuspend(pyMod["call_s"], [new pyStr("anvil.private.reset_session")]),
            (token: pyStr) => {
                window.anvilSessionToken = toJs(token);
                return invalidatedMacs();
            },
            () => pyNone
        );
    });

    pyMod["_invalidation_callbacks"] = new pyList();
    pyMod["_on_invalidate_client_objects"] = new pyFunc(function (f) {
        pyCall(pyMod["_invalidation_callbacks"].tp$getattr<pyList>(new pyStr("append")), [f]);
        return pyNone;
    });

    pyMod["invalidate_client_objects"] = new pyFunc(function () {
        return chainOrSuspend(
            doServerCall([], [], "anvil.private.invalidate_client_objects"),
            invalidatedMacs,
            () => pyNone
        );
    });

    function add_event_handler(pyEventName: pyStr, pyHandler: pyCallable) {
        pyCheckType("event_name", "str", checkString(pyEventName));
        pyCheckType("event_handler", "callable function", checkCallable(pyHandler));
        const eventName = pyEventName.toString();
        const handlers = pyServerEventHandlers[eventName] || (pyServerEventHandlers[eventName] = []);
        handlers.push(pyHandler);
        if (!websocket) {
            connect(); // Make sure we're connected, so the server knows to send events here. Don't wait for the connection to complete.
        }
        return pyNone;
    }

    function remove_event_handler(pyEventName: pyStr, pyHandler: pyCallable) {
        pyCheckType("event_name", "str", checkString(pyEventName));
        pyCheckType("event_handler", "callable function", checkCallable(pyHandler));
        const eventName = pyEventName.toString();
        const prevHandlers = pyServerEventHandlers[eventName];
        if (prevHandlers === undefined) {
            throw new pyLookupError(`'${pyHandler}' was not found in '${eventName}' event handlers for server events`);
        }
        const newHandlers = prevHandlers.filter(
            (handler) => handler !== pyHandler && richCompareBool(handler, pyHandler, "NotEq")
        );
        if (prevHandlers.length === newHandlers.length) {
            throw new pyLookupError(`'${pyHandler}' was not found in '${eventName}' event handlers for server events`);
        } else {
            pyServerEventHandlers[eventName] = newHandlers;
        }
        return pyNone;
    }

    function event_handler(pyEventName: pyStr) {
        if (!checkString(pyEventName)) {
            throw new pyTypeError("event_handler decorator requires an event_name as the first argument");
        }
        return new pyFunc(function (pyHandler: pyCallable) {
            add_event_handler(pyEventName, pyHandler);
            return pyHandler;
        });
    }

    setUpModuleMethods("anvil.server", pyMod, {
        portable_class: {
            $meth(pyClass: pyType | pyStr, pyName: pyStr | pyNoneType) {
                const doRegister = (pyClass: pyType, pyName: pyStr) => {
                    let tpName = pyName ? pyName.valueOf() : null;
                    if (tpName == null) {
                        // use gattr so that the appropriate error is thrown
                        let mod = Sk.abstr.gattr(pyClass, pyStr.$module).toString();
                        const name = Sk.abstr.gattr(pyClass, pyStr.$name).toString();
                        if (mod === "__main__" && window.anvilAppMainModule) {
                            mod = window.anvilAppMainPackage + "." + window.anvilAppMainModule;
                        }
                        tpName = `${mod}.${name}`;
                    } else if (!(typeof tpName === "string")) {
                        throw new pyTypeError(
                            "The second argument to portable_class must be a string, got " + typeName(pyName)
                        );
                    }
                    pyClass.anvil$serializableName = tpName;
                    pyValueTypes[tpName] = pyClass;
                    return pyClass;
                };
                if (pyName === pyNone && pyClass instanceof pyStr) {
                    const pyName = pyClass;
                    return new pyFunc((pyClass: pyType) => doRegister(pyClass, pyName));
                } else {
                    return doRegister(pyClass as pyType, pyName as pyStr);
                }
            },
            $flags: { NamedArgs: ["cls", "name"], Defaults: [pyNone] },
        },
        /* ! defBuiltinFunction(anvil.server,!_,event_name, event_handler)!1*/
        add_event_handler: {
            $name: "add_event_handler",
            $meth: add_event_handler,
            $doc: "add an event handler for a server event",
            $flags: { MinArgs: 2, MaxArgs: 2 },
        },
        /* ! defBuiltinFunction(anvil.server,!_,event_name, event_handler)!1*/
        remove_event_handler: {
            $name: "remove_event_handler",
            $meth: remove_event_handler,
            $doc: "remove an event handler for a server event",
            $flags: { MinArgs: 2, MaxArgs: 2 },
        },
        /* ! defBuiltinFunction(anvil.server,!_,event_name)!1*/
        event_handler: {
            $name: "event_handler",
            $meth: event_handler,
            $doc: "decorator for marking a function as an event handler.",
            $flags: { OneArg: true },
        },
        __getattr__: {
            $meth(pyName) {
                const name = pyName.toString();
                if (name === "startup_data") {
                    // this needs to be lazy - because appStartupData doesn't exist until after the app has started
                    return data.appStartupData ?? pyNone;
                }
                throw new pyAttributeError(name);
            },
            $flags: { OneArg: true },
        },
    });

    // Old name, for apps written before portable classes were released
    pyMod["serializable_type"] = pyMod["portable_class"];

    const getAppOrigin = (pyEnvironmentType: pyStr | pyNoneType, pyPreferEmphemeralDebug: pyBool) => {
        if (pyEnvironmentType === pyNone) {
            return toPy(
                isTrue(pyPreferEmphemeralDebug)
                    ? window.anvilAppOrigin
                    : window.anvilEnvironmentOrigin || window.anvilAppOrigin
            );
        }
        return pyCallOrSuspend(
            pyMod["call_s"],
            [toPy("anvil.private.get_app_origin"), pyEnvironmentType],
            ["prefer_ephemeral_debug", pyPreferEmphemeralDebug]
        );
    };

    pyMod["get_app_origin"] = new pyFunc(function (pyEnvironmentType, pyPreferEmphemeralDebug) {
        return getAppOrigin(pyEnvironmentType, pyPreferEmphemeralDebug);
    });
    pyMod["get_app_origin"].func_code.co_varnames = ["branch", "prefer_ephemeral_debug"]; // "branch" is the legacy name for the first arg. Leave this as-is, in case anyone has previously passed branch=...
    pyMod["get_app_origin"].func_code.$defaults = [pyNone, pyNone];

    pyMod["get_api_origin"] = new pyFunc(function (pyEnvironmentType, pyPreferEmphemeralDebug) {
        return chainOrSuspend(
            getAppOrigin(pyEnvironmentType, pyPreferEmphemeralDebug),
            (pyOrigin) => new pyStr(pyOrigin.toString() + "/_/api")
        );
    });
    pyMod["get_api_origin"].func_code.co_varnames = ["branch", "prefer_ephemeral_debug"]; // As above
    pyMod["get_api_origin"].func_code.$defaults = [pyNone, pyNone];

    /*!defFunction(anvil.server,!_)!2*/ ("Returns `True` if this app is online and `False` otherwise.\nIf `anvil.server.is_app_online()` returns `False` we expect `anvil.server.call()` to throw an `anvil.server.AppOfflineError`");
    pyMod["is_app_online"] = new pyFunc(function () {
        const p = anvilAppOnline.checkStatus();
        return chainOrSuspend(promiseToSuspension(p), toPy);
    });

    const setupObjectWithClass = (className: string, vals: { [attr: string]: any }) => {
        const cls = buildPyClass(
            pyMod,
            ($gbl, $loc) => {
                $loc["__repr__"] = new pyFunc(function (self) {
                    return new pyStr(self.$d);
                });
            },
            className,
            []
        );
        const obj = pyCall(cls);
        for (const attr in vals) {
            obj.tp$setattr(new pyStr(attr), toPy(vals[attr]));
        }
        return obj;
    };

    pyMod["context"] = setupObjectWithClass("CallContext", {
        remote_caller: null,
        type: "browser",
        client: setupObjectWithClass("Client", {
            type: "browser",
            location: null,
            ip: null,
        }),
    });

    pyMod["server_side_method"] = buildNativeClass("server_side_method", {
        constructor: function server_side_method() {},
        slots: {
            tp$init(args, kws) {
                if (args.length != 1 || kws?.length) {
                    throw new TypeError("@server_side_method takes no arguments, just a function");
                }
            },
            tp$descr_get(obj, type) {
                return pyCallOrSuspend(this._get_fn, [obj, type]);
            },
        },
        methods: {
            __set_name__: {
                $meth(owner, name) {
                    const cname = `anvil.server_side/${Sk.abstr.gattr(owner, s__module__)}.${Sk.abstr.gattr(
                        owner,
                        s__name__
                    )}.${name}`;
                    this._get_fn = new pyFunc(
                        PyDefUtils.withRawKwargs(function (pyKwargs: Kws, ...args: Args) {
                            return doServerCall(pyKwargs, args, cname);
                        })
                    ).tp$getattr(s__get__);
                    return pyNone;
                },
                $flags: { MaxArgs: 2, MinArgs: 2 },
            },
        },
    });

    // Register the component types (and ComponentTag) as serializable
    const components = [
        "Button",
        "Canvas",
        "CheckBox",
        "ColumnPanel",
        "DataGrid",
        "DataRowPanel",
        "DatePicker",
        "DropDown",
        "FileLoader",
        "FlowPanel",
        "GridPanel",
        "HtmlPanel",
        "Image",
        "Label",
        "LinearPanel",
        "Link",
        "Plot",
        "RadioButton",
        "RepeatingPanel",
        "RichText",
        "SimpleCanvas",
        "Spacer",
        "TextArea",
        "TextBox",
        "Timer",
        "XYPanel",
        "YouTubeVideo",
        "ComponentTag",
    ];
    // TODO could use data.serverParams but data not available in runtimeVersion < 3
    if (window.anvilParams.runtimeVersion <= 2) {
        components.push("Component");
    }

    for (const componentName of components) {
        const pyClass = anvilMod[componentName];
        pyClass.anvil$serializableName = "anvil." + componentName;
        pyValueTypes["anvil." + componentName] = pyClass;
    }

    return { pyMod, log: sendLog, registerServerCallSuspension, setOnDebuggerMessage };
};

/*#
id: http_apis
docs_url: /docs/http-apis/creating-http-endpoints
title: HTTP APIs
description: |
  ```python
  import anvil.server

  @anvil.server.http_endpoint("/users/:id")
  def get_user(id, **params):
    return "You requested user %s with params %s" % id, params
  ```

  You can build a programmatic HTTP API for your app by decorating server functions with the `@anvil.server.http_endpoint` 
  decorator. All registered endpoints for your app are accessible at `https://<your-app-id>.anvil.app/_/api...`, 
  or at `https://your-custom-domain.com/_/api...` if you have a custom domain. If your app is private, the endpoints will
  be at `https://<your-app-id>.anvil.app/_/private_api/<your private access key>/...`.

  You can think of URLs as having two parts:
  _origin_ and _path_. The _origin_ looks like `https://<your-app-id>.anvil.app/_/api` and tells Anvil how to route
  requests to your app. The _path_ looks like `/foo/:bar` and is registered in your calls to the `@anvil.server.http_endpoint`
  decorator.

  In the example on the right, if we navigate to `https://<my-app-id>.anvil.app/_/api/users/42?x=foo`, we will receive 
  a response of `You requested user 42 with params {'x': 'foo'}`.

  You can make a single endpoint respond to multiple request paths by using __path parameters__. In this example (`"/users/:id"`, we 
  match anything (except `/`) after the `/users/` prefix, and assign the match to the `id` keyword argument of the function. You
  can also use path parameters in the middle of a path (`/users/:id/history`) or use multiple path parameters in the same path (`/users/:user_id/history/:item_id`).

  Query-string parameters will be passed to your function as keyword arguments. In the example above, the `params` variable was used for that purpose.

  #### The `http_endpoint` decorator

  The `@anvil.server.http_endpoint` decorator makes your function callable over HTTP. It has one required argument - the path, e.g. `/users/list`. 
  As described in the example above, the path may contain one or more __path parameters__, denoted by the __`:`__ character, e.g. `/users/:id`.

  There are also some optional keyword arguments:

  \* `methods` specifies which HTTP methods this endpoint supports (the default is `['GET','POST']`)
  \* `enable_cors` adds CORS HTTP headers (`Access-Control-Allow-Origin: *`) to your response when set to `True`. By default, we set CORS headers to permit requests from any web address where your app can be reached (eg `xyz.anvil.app`, `my-custom-domain.com`, etc).
  \* `cross_site_session` is described in the "Security and cross-site sessions" section below
  \* `require_credentials` and `authenticate_users` are described in the "Authentication" section below.

  #### The request object

  HTTP requests have far more information associated with them than just path and query-string parameters. This information can be accessed through 
  the `anvil.server.request` object, which is a thread-local variable containing information about the request currently being processed. The request
  object has the following attributes:

  \* __`path`__ - The path of this HTTP request.
  \* __`method`__ - The method of this HTTP request, e.g. `GET`, `POST`, etc.
  \* __`query_params`__ - The query-string parameters passed with this request, as a dictionary.
  \* __`form_params`__ - The form parameters passed with this request, as a dictionary.
  \* __`origin`__ - The URL origin of this HTTP request.
  \* __`headers`__ - Headers passed with this request, as a dictionary.
  \* __`remote_address`__ - The IP address of the source of this request.
  \* __`body`__ - The body of this HTTP request, as an `anvil.Media` object.
  \* __`body_json`__ - For requests with `Content-Type: application/json`, this is the decoded body as a dictionary. Otherwise `None`.
  \* __`username`__ - For authenticated requests (see below), returns the provided username. Otherwise `None`.
  \* __`password`__ - For authenticated requests (see below), returns the provided password. Otherwise `None`.
  \* __`user`__ - For authenticated requests, returns the row from the `Users` table representing the authenticated user.


  #### Authentication

  ```python
  from anvil.server import http_endpoint, request

  @http_endpoint("/protected", require_credentials=True)
  def serve_protected_content():
    print("User %s connected with password %s" % (request.username, 
                                                  request.password))

    # Check username and password before continuing...
  ```

  The `@anvil.server.http_endpoint` decorator accepts the optional keyword argument `require_credentials` (default `False`). If this is set to `True`,
  remote users must provide a username and password through HTTP Basic Authentication. If credentials are not provided, a `401 Unauthorized` response
  will be sent back automatically. __It is your responsibility to check the provided username and password__ and return an appropriate response if
  the validation fails.

  ```python
  import anvil.server
  from anvil.server import request

  @anvil.server.http_endpoint("/protected", authenticate_users=True)
  def serve_protected_content():
    print("Authenticated %s, who signed up on %s." % (request.user["email"], 
                                                      request.user["signed_up"]))

    # User is now authenticated.
  ```

  Instead of setting `require_credentials`, you can set the `authenticate_users` keyword argument to `True`. This will automatically authenticate users
  against the Users Service in your app, where the provided username should be their email address. In this case, `anvil.server.request.user` will be set
  to the row from the `Users` table representing the authenticated user. Of course, you can also retrieve the logged-in user with the 
  usual `anvil.users.get_user()` mechanism. If authentication fails, a `401 Unauthorized` response will be sent back automatically.

  #### Responding to HTTP requests

  ```python
  import anvil.server

  @anvil.server.http_endpoint("/foo")
  def serve_content():
    
    # This response will have Content-Type application/json
    return {"key": "value"}
  ```

  Functions decorated with `@anvil.server.http_endpoint` can return strings (which will be returned with a Content-Type of `text/plain`), `anvil.Media` objects
  (which will be returned with their attached Content-Type), or any JSON-able object like a plain list or dict (which will be returned with Content-Type `application/json`).

  ```python
  import anvil.server

  @anvil.server.http_endpoint("/foo")
  def serve_content():
    
    response = anvil.server.HttpResponse(200, "Body goes here")
    response.headers["X-Custom-Header"] = "Custom value"

    return response
  ```

  If you need more control over the response, you can return an `anvil.server.HttpResponse` object, providing a custom status code, body and header dictionary.
  Construct an `HttpResponse` object by optionally passing status code and body arguments, then set any required headers as in the example on the right.

  #### Generating links

  Sometimes you will want to generate URLs that point to your HTTP endpoints without having to hard-code the origin of your app. For example, instead of writing:
  
  `endpoint_url = "https://my-app.anvil.app.net/_/api/users"`

  You can write:

  `endpoint_url = anvil.server.get_api_origin() + "/users"`

  This has the advantage of returning whichever origin the user is currently connected on, i.e. it will return your custom domain correctly.

  You can also get the origin of the whole app to generate links for a browser:

  `app_url = anvil.server.get_app_origin()`

  ### Security and cross-site sessions

  You should take care when writing HTTP endpoints. They are accessible to anyone on the internet, so you must be robust against malcious requests.

  What's more, it is often possible for an attacker to cause _legitimate, logged-in users of your app_ to access HTTP endpoints in a way under an attacker's control! If you're not careful, this can cause your application to perform operations on the user's behalf, but without their consent. This is called XSRF (Cross-Site Request Forgery).

  Anvil protects your apps against XSRF by serving HTTP endpoints in a separate session from the rest of your app if they were triggered by a different website. Even if the browser that requests that endpoint has [cookies](#cookies) or is logged in with the [Users service](#users), they will not be available to the endpoint function if the request was triggered by a different site (ie if the `Origin` or `Referer` headers do not match your app).

  If you want to accept requests from other websites, you can turn off this protection, by passing `cross_site_session=True` to `@anvil.server.http_endpoint()`. This will cause all requests to execute in the session of the browser they come from, whatever site initiated them. If you do this, you need to write your endpoint to be safe **even if it is called with a URL and parameters chosen by a malicious adversary**. Best practices for writing safe endpoints under these circumstances are more complex than we can go into here -- search online for "XSRF" to learn more.
*/

/*
 * TO TEST:
 *
 *  - Methods: call
 *
 */
