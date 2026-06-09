import {
    Args,
    Break,
    BreakConstructor,
    Kws,
    Suspension,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyObject,
    pyStr,
    pyTuple,
} from "@Sk";
import { Component } from "@runtime/components/Component";
import { jsObjToKws, s_raise_event } from "@runtime/runner/py-util";

export function suspensionFromPromise<T>(p: Promise<T>) {
    const newSuspension = new Suspension<{ type: "Sk.promise"; promise: Promise<T>; error?: any; result?: T }>();
    newSuspension.resume = function () {
        // Need to allow resolving to undefined or null here, so anything that isn't an error is a result:
        if (newSuspension.data.error) {
            throw newSuspension.data.error;
        } else {
            return newSuspension.data.result;
        }
    };
    newSuspension.data = { type: "Sk.promise", promise: p };

    return newSuspension;
}

export function suspensionPromise<T>(
    fn: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void
) {
    return suspensionFromPromise(new Promise(fn));
}

export const suspensionHandlers: Record<string, ((r: Suspension<any>) => Promise<unknown> | unknown) | undefined> = {
    timer: (r: Suspension<{ delay: number }>) => {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve(r.resume());
            }, r.data["delay"] * 1000);
        });
    },
};

export function callAsyncWithoutDefaultError(
    func: pyObject | pyCallable<pyObject | Suspension>,
    kwDict?: pyDict,
    varargseq?: pyTuple,
    kws?: Kws,
    ...args: Args
) {
    return Sk.misceval.callAsync(suspensionHandlers, func, kwDict, varargseq, kws, ...args);
}

export const callAsync = (
    func: pyObject | pyCallable<pyObject | Suspension>,
    kwDict?: pyDict,
    varargseq?: pyTuple,
    kws?: Kws,
    ...args: Args
) =>
    Sk.misceval.callAsync(suspensionHandlers, func, kwDict, varargseq, kws, ...args).catch((e) => {
        // unhandled errors are caught by window.onunhandledrejection
        throw e;
    });

/**
 * When we internally call asyncToPromise,
 * we ignore the first optional suspension
 * this is perfect for event handlers that may have not fired since the previous Sk.lastYield
 * otherwise handlers may immediately throw an optional Sk.yield suspension (if Sk.yieldLimit is configured)
 * Note we only use Sk.yieldLimit when running in the IDE
 * This causes unusual effects - e.g. in a button that triggers a google sign in
 * Will then maybe suspend, causing an extra dialogue to appear - which wouldn't happen in production
 *
 * Note we could continue to resume optional suspensions in a while loop
 * (see WrappedPyCallable)
 * but since the next optional suspension we hit
 * will be the result of long running code we only ignore the first one.
 */
function ignoreFirstOptionalSuspension(susp: any | Suspension<any>) {
    // TODO: Work out whether this will affect optional debug suspensions
    if (susp instanceof Suspension && susp.optional && susp.data.type !== "Sk.debug") {
        susp = susp.resume();
    }
    return susp;
}

// This is really "suspensionToPromise."
export const asyncToPromise = <T>(fn: () => T | Suspension<T>) => {
    const suspendablefn = () => ignoreFirstOptionalSuspension(fn());
    return Sk.misceval.asyncToPromise(suspendablefn, suspensionHandlers).catch((e) => {
        // unhandled errors are caught by window.onunhandledrejection
        throw e;
    });
};

// CLASSIC COMPONENTS ONLY:
// Raise the named event with the specified arguments
// (expects a Javascript object as first parameter, keys are JS, vals are Python if pyVal is true, otherwise JS.
/** @deprecated */
export function raiseEventOrSuspend(eventArgs: any, self: Component, eventName: string) {
    return pyCallOrSuspend(self.tp$getattr<pyCallable>(s_raise_event), [new pyStr(eventName)], jsObjToKws(eventArgs));
}

export function raiseEventAsync(eventArgs: any, self: Component, eventName: string) {
    return asyncToPromise(() => raiseEventOrSuspend(eventArgs, self, eventName));
}

type BreakOrSuspend = Suspension | BreakConstructor | Break;

export function whileOrSuspend<T = any>(
    testFn: () => boolean | BreakOrSuspend,
    bodyFn: () => T | BreakOrSuspend,
    elseFn?: () => T | Suspension
) {
    function gotBodyReturn(bodyRet?: Suspension<any> | BreakConstructor | Break) {
        if (bodyRet instanceof Suspension) {
            return new Suspension(gotBodyReturn, bodyRet);
        }
        if (bodyRet === Break) {
            return;
        }

        if (bodyRet instanceof Break) {
            return bodyRet.brValue; // We're done!
        }

        // We're done with this iteration
        return gotTestResult(testFn());
    }

    function gotTestResult(testResult?: any | Suspension<any>) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (testResult instanceof Suspension) {
                return new Suspension(gotTestResult, testResult);
            }

            if (!testResult) {
                return elseFn?.();
            } // We're done!

            const bodyRet = bodyFn();

            if (bodyRet instanceof Suspension) {
                return new Suspension(gotBodyReturn, bodyRet);
            }
            if (bodyRet === Break) {
                return;
            }
            if (bodyRet instanceof Break) {
                return bodyRet.brValue; // We're done!
            }

            testResult = testFn();
        }
    }

    return gotTestResult(testFn());
}
