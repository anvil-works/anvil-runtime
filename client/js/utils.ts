import { pyModule, pyObject, pyStr, retryOptionalSuspensionOrThrow } from "./@Sk";

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
};

// taken from rsvp.defer https://github.com/tildeio/rsvp.js/blob/master/lib/rsvp/defer.js
export function defer<T = any>() {
    const deferred = { resolve: () => {}, reject: () => {} } as Partial<Deferred<T>>;

    deferred.promise = new Promise<T>((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });

    return deferred as Deferred<T>;
}

export function getRandomStr(len: number) {
    let rv = "";
    for (let i = 0; i < len; i++) {
        rv += String.fromCharCode(65 + Math.floor(26 * Math.random()));
    }
    return rv;
}

export const globalSuppressLoading = {
    value: 0,
    inc() {
        this.value++;
    },
    dec() {
        this.value--;
    },
};

/** gets the module from sys modules - imports the module if it's not there */
export function getModule(name: string) {
    const pyName = new pyStr(name);
    const rv = Sk.sysmodules.quick$lookup(pyName);
    if (rv !== undefined) return rv;
    retryOptionalSuspensionOrThrow(Sk.importModule(name, false, true));
    // retrieve the module sys.modules to account for a nested module e.g. anvil.util
    return Sk.sysmodules.quick$lookup(pyName) as pyModule;
}

/** On first attribute access, gets the module from sys module, or imports it. Treats a python module as a simple javascript object */
export function pyLazyMod(modName: string) {
    let mod: pyModule;
    return new Proxy({} as { [attr: string]: pyObject }, {
        get(target, attr: string): any {
            mod ??= getModule(modName);
            return (target[attr] ??= mod.tp$getattr(new pyStr(attr)));
        },
        set(target, attr: string, v: pyObject) {
            mod ??= getModule(modName);
            target[attr] = v;
            mod.tp$setattr(new pyStr(attr), v);
            return true;
        },
    });
}

// some common lazy modules
export const anvilMod = pyLazyMod("anvil");
export const anvilServerMod = pyLazyMod("anvil.server");
export const datetimeMod = pyLazyMod("datetime");
export const tzMod = pyLazyMod("anvil.tz");

/** Polyfill for IOS < 13 (13.1 released March 2020) */
class _ResizeObserverPolyfill {
    target: null | HTMLElement = null;
    prev: null | string = null;
    cb: () => void;
    mo: MutationObserver;
    constructor(cb: () => void) {
        this.cb = () => {
            if (this._is_resized()) {
                cb();
            }
        };

        this.mo = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName !== "style") continue;
                if (this._is_resized()) {
                    return cb();
                }
            }
        });
    }

    _is_resized() {
        const target = this.target;
        if (target === null) {
            this.prev = null;
            return false;
        }
        const current = `${target.style.width}:${target.style.height}:${target.clientWidth}:${target.clientHeight}`;
        if (current === this.prev) return false;
        this.prev = current;
        return true;
    }

    observe(target: HTMLElement) {
        this.target = target;
        this.mo.observe(target, { attributes: true });
        // use jquery here because Material Design templates trigger a resize using jQuery
        // and the window.addEventListener("resize") doesn't catch $(window).trigger("resize");
        $(window).on("resize", this.cb);
    }

    unobserver() {
        this.disconnect();
    }

    disconnect() {
        this.target = null;
        this.mo.disconnect();
        $(window).off("resize", this.cb);
    }
}

export const ResizeObserverPolyfill = window.ResizeObserver ?? _ResizeObserverPolyfill;
