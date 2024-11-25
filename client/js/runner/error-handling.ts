import {
    pyBaseException,
    pyCallable,
    pyException,
    pyExceptionConstructor,
    pyExternalError,
    pyNone,
    pyNoneType,
    pyStr,
    toJs,
} from "../@Sk";
import Modal from "../modules/modal";
import * as PyDefUtils from "../PyDefUtils";
import { logEvent } from "./logging";

// overrides the dom-lib OnErrorEventHandlerNonNull
interface OnErrorEventHandlerNonNull {
    (
        event?: Event | string | null,
        source?: string | null,
        lineno?: number | null,
        colno?: number | null,
        error?: Error | any
    ): any;
}

declare global {
    interface Window {
        onerror: OnErrorEventHandlerNonNull;
    }
}

// We add some information to python exceptions
export interface CustomAnvilError extends pyBaseException {
    _anvil: { errorObj: { type: string; bindingErrors?: BindingError[] } };
}

export interface BindingError {
    // We can't send a python object in a message so we delete the exception
    exception?: pyBaseException & Partial<CustomAnvilError>;
    traceback: {
        filename: string;
        lineno: string;
    }[];
    message: string;
    formName: string;
    binding: {
        component_name: string;
        property: string;
        code: string;
    };
}

export const isCustomAnvilError = (e: any): e is CustomAnvilError => {
    return e._anvil && e._anvil.errorObj;
};

window.onunhandledrejection = (event) => {
    window.onerror(null, null, null, null, event.reason);
};

export const uncaughtExceptions: { pyHandler: pyNoneType | pyCallable } = { pyHandler: pyNone };

interface ErrorHooks {
    onPythonException?(err: {
        fn: string;
        traceback: { filename: string; lineno: string }[];
        type: string;
        msg: string;
        errorObj?: pyBaseException;
    }): void;
    onRuntimeError?: OnErrorEventHandlerNonNull;
    onUncaughtRuntimeError?(err: {
        runtimeError: string;
        jsUrl?: string | null;
        jsLine?: number | null;
        jsCol?: number | null;
        message: string;
        jsTrace: string | undefined;
        anvilVersion: number;
    }): void;
    onStdout?(s: string): void;
}

let hooks: ErrorHooks = {};

export function setHooks(h: ErrorHooks) {
    hooks = h;
}

$("#error-indicator").on("click", function () {
    $("#error-indicator .output").show();
    $("#error-indicator .message").hide();
});

window.onerror = function (errormsg, url, line, col, errorObj) {
    if (typeof errormsg === "string" && errormsg.indexOf("__gCrWeb.autofill.extractForms") > -1) {
        // This is a Chrome-on-iOS bug. Only happens when autofill=off in settings. Ignore.
        return true;
    }
    if (
        typeof errormsg === "string" &&
        errormsg.includes("ResizeObserver loop completed with undelivered notifications")
    ) {
        console.warn(errormsg);
        return true;
    }
    try {
        const anvilServerMod = Sk.sysmodules.quick$lookup(new Sk.builtin.str("anvil.server"));
        if (!anvilServerMod) {
            console.error("Error before anvil.server module loaded");
        }
        const pySessionExpiredError = anvilServerMod?.tp$getattr<pyExceptionConstructor>(
            new pyStr("SessionExpiredError")
        );

        if (pySessionExpiredError && errorObj instanceof pySessionExpiredError) {
            console.log("Well that worked? Did it?");

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

function handleSessionExpired(errorObj: pyException) {
    if (hasCustomHandler()) {
        customHandlerHandler(errorObj, showRefreshSessionModal);
    } else {
        showRefreshSessionModal();
    }
}

function _isExternalError(err: any): err is pyExternalError {
    return err.nativeError != null;
}

function handlePythonError(pyErrorObj: pyBaseException & { _anvil?: any }) {
    const args = toJs(pyErrorObj.args);
    const msg = args[0];
    const errorObj = pyErrorObj._anvil?.errorObj;
    const traceback = pyErrorObj.traceback;
    let type;
    if (errorObj) {
        type = errorObj.type;
    } else {
        type = pyErrorObj.tp$name;
    }

    if (hooks.onPythonException) {
        const errorMsg = { fn: "pythonError", traceback, type, msg, errorObj };
        hooks.onPythonException(errorMsg);
    }

    console.log("Python exception: " + type + ": " + msg);
    if (_isExternalError(pyErrorObj)) {
        console.log(pyErrorObj.nativeError);
    } else {
        console.log(pyErrorObj);
    }

    const error = {
        type,
        trace: traceback.map(({ filename, lineno }) => [filename, lineno]),
        message: msg,
        jsTrace: _isExternalError(pyErrorObj) ? pyErrorObj.nativeError.stack : undefined,
        bindingErrors: errorObj?.bindingErrors,
        anvilVersion: window.anvilVersion,
    };

    logEvent({ error });

    $("#error-indicator .output").text(type + ": " + msg);
    if (hasCustomHandler()) {
        customHandlerHandler(pyErrorObj);
    } else {
        showErrorPopup();
    }
}

function handleJsError(
    errormsg?: string | null | Event,
    jsUrl?: string | null,
    jsLine?: number | null,
    jsCol?: number | null,
    errorObj?: Error
) {
    console.error(
        "Uncaught runtime error: " + errormsg + " at " + jsUrl + ":" + jsLine + ", column " + jsCol,
        errorObj
    );

    hooks.onRuntimeError?.(errormsg, jsUrl, jsLine, jsCol, errorObj);

    const err = {
        runtimeError: (errorObj && errorObj.constructor && errorObj.constructor.name) || "Unknown error",
        jsUrl,
        jsLine,
        jsCol,
        message: "" + (errorObj || "Unknown error"),
        jsTrace: errorObj && errorObj.stack,
        anvilVersion: window.anvilVersion,
    };

    logEvent({ error: err });

    $("#error-indicator .output").text("" + (errormsg || "Unhandled runtime error"));
    if (hasCustomHandler()) {
        // we shouldn't send null to ExternalError
        customHandlerHandler(new Sk.builtin.ExternalError(errorObj ?? "Unknown error"));
    } else {
        // Log uncaught JS error
        hooks.onUncaughtRuntimeError?.(err);
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

let showingRefreshModal = false;
const showRefreshSessionModal = async () => {
    if (showingRefreshModal || document.getElementById("session-expired-modal")) {
        // we're already on the screen
        return;
    }
    try {
        showingRefreshModal = true;
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
        await modal.show();
    } finally {
        showingRefreshModal = false;
    }
};

function hasCustomHandler() {
    return uncaughtExceptions.pyHandler !== Sk.builtin.none.none$;
}

function customHandlerHandler(errorObj: pyBaseException, reRaiseRenderer = showErrorPopup) {
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
            window.onerror(null, null, null, null, e);
        }
    });
}
