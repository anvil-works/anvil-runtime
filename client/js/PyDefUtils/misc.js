import { remapToJsOrWrap, toPy, pyTypeError } from "@Sk";
import { defer } from "@runtime/utils";
import { suspensionFromPromise } from "./suspension";

// Problem: We can only pop up windows (eg Google auth) in response to synchronous events.
// Track whether we are currently executing a synchronous click event.
let popupOK = false;
document.addEventListener(
    "click",
    () => {
        popupOK = true;
        setTimeout(() => {
            popupOK = false; // fail safe incase the bubble phase stopped propagation
        });
    },
    true
);
document.addEventListener("click", () => {
    popupOK = false;
});

export const isPopupOK = () => popupOK;

export const callJs = (pyComponent, pyFnName, ...pyArgs) => {
    const fnName = Sk.ffi.toJs(pyFnName);

    let fn;
    try {
        fn = Function(`return (${fnName})`)();
    } catch (e) {
        if (!(e instanceof ReferenceError && e.message.includes(fnName))) {
            throw e;
        }
        let msg = `Could not find global JS function '${fnName}'.`;
        // This hint is only available in ClassicComponents - but that's probably OK because this mechanism
        // is deprecated anyway.
        if (pyComponent?._anvil && !pyComponent._anvil.onPage) {
            msg +=
                " This form is not currently visible - " +
                "to call functions defined in its HTML on load, " +
                "use call_js in the form 'show' event handler.";
        }
        throw new Sk.builtin.NameError(msg);
    }
    if (typeof fn !== "function") {
        throw new pyTypeError(`${fnName} is not callable, got ${typeof fn}`);
    }

    const domElement = pyComponent?.anvil$hooks?.domElement;
    const jqueryWrapped = domElement && $(domElement);

    let rv = fn.apply(jqueryWrapped, pyArgs.map(remapToJsOrWrap));
    if (rv instanceof Promise) {
        rv = suspensionFromPromise(rv.then(toPy));
    } else {
        rv = toPy(rv);
    }
    return rv;
};

/**
 * @param {Promise} p
 * @returns {Promise}
 */
export const withDelayPrint = (p) => {
    if (!window.outstandingPrintDelayPromises) return p;
    const key = Math.random().toString(36).substring(6);
    const d = defer();
    window.outstandingPrintDelayPromises[key] = d;
    return p.then(d.resolve);
};

export const delayPrint = (key) => {
    if (window.outstandingPrintDelayPromises) {
        window.outstandingPrintDelayPromises[key] = defer();
    }
};

export const resumePrint = (key) => {
    if (window.outstandingPrintDelayPromises && window.outstandingPrintDelayPromises[key]) {
        window.outstandingPrintDelayPromises[key].resolve();
    }
};
