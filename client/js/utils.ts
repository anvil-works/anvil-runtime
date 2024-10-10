export type Deferred<T> = {
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

export function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRandomStr(len: number) {
    let rv = "";
    for (let i = 0; i < len; i++) {
        rv += String.fromCharCode(65 + Math.floor(26 * Math.random()));
    }
    return rv;
}

// polyfill for when window.crypto.randomUUID is not supported
function _generateUUID() {
    let d = Date.now();
    const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c == "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
    return uuid;
}

export const generateUUID = window.crypto.randomUUID ? () => window.crypto.randomUUID() : _generateUUID;

export const globalSuppressLoading = {
    value: 0,
    inc() {
        this.value++;
    },
    dec() {
        this.value--;
    },
};


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
                if (this._is_resized()) return cb();
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
        this.mo.observe(target, { attributes: true, attributeFilter: ["style"] });
        // use jquery here because Material Design templates trigger a resize using jQuery
        // and the window.addEventListener("resize") doesn't catch $(window).trigger("resize");
        $(window).on("resize", this.cb);
    }

    unobserve() {
        this.disconnect();
    }

    disconnect() {
        this.target = null;
        this.mo.disconnect();
        $(window).off("resize", this.cb);
    }
}

export const ResizeObserverPolyfill = window.ResizeObserver ?? _ResizeObserverPolyfill;

/** avoids the first call to the resize observer callback */
export class PostponedResizeObserver extends ResizeObserverPolyfill {
    _init = true;
    _t: undefined | number = undefined;
    constructor(cb: () => void) {
        super(() => {
            // we don't want to fire this when we are first observed
            // this breaks canvas event firing order
            if (this._init) {
                this._init = false;
                return;
            }
            clearTimeout(this._t);
            this._t = setTimeout(cb, 50);
        });
    }
    observe(target: HTMLElement) {
        super.observe(target);
        setTimeout(() => {
            // if we're using a MutationObserver we don't fire on initial observation
            this._init = false;
        });
    }
    disconnect() {
        super.disconnect();
        this._init = true;
    }
}
