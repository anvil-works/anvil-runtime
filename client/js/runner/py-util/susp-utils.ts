import type { Suspension } from "@Sk";
import { chainOrSuspend, promiseToSuspension, tryCatchOrSuspend } from "@Sk";
import { Deferred, defer } from "@runtime/utils";

export function pyTryFinally<T>(f: () => T | Suspension, doFinally: () => void) {
    let completed = false,
        result: T;
    return tryCatchOrSuspend(
        () =>
            chainOrSuspend(
                f(),
                (rv) => {
                    completed = true;
                    result = rv;
                    return doFinally();
                },
                () => result
            ),
        (e) =>
            chainOrSuspend(!completed && doFinally(), () => {
                throw e;
            })
    );
}

class LazySuspension {
    _complete = false;
    _deferred: null | Deferred<null> = null;
    _suspension: null | Suspension = null;
    get suspension() {
        if (this._complete) return null;
        this._deferred ??= defer();
        this._suspension ??= promiseToSuspension(this._deferred.promise);
        return this._suspension;
    }
    done() {
        this._complete = true;
        this._deferred?.resolve(null);
    }
}

export class Mutex {
    _prev: LazySuspension | null = null;
    withLock<T>(runFn: () => T | Suspension) {
        const prev = this._prev;
        const curr = new LazySuspension();
        this._prev = curr;
        return () =>
            pyTryFinally(
                () => chainOrSuspend(prev?.suspension, runFn),
                () => curr.done()
            );
    }
    runWithLock<T>(runFn: () => T | Suspension) {
        return this.withLock(runFn)();
    }
}
