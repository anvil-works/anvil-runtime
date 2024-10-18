import {
    buildNativeClass,
    checkArgsLen,
    checkNoArgs,
    copyKeywordsToNamedArgs,
    isTrue,
    objectRepr,
    pyCall,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyFalse,
    pyFunc,
    pyNone,
    pyObject,
    pyStr,
    pyType,
    pyTypeError,
    pyValueError,
    suspensionToPromise,
    toJs,
    toPy,
} from "@Sk";
import { jsObjToKws } from "@runtime/runner/py-util";

function createKey() {
    return (Math.random() + 1).toString(36).substring(7);
}

interface JsLocation {
    path: string;
    search: string;
    hash: string;
    state: any;
    key: any;
}

export interface Update {
    action: Action;
    location: Location;
    delta: number | null;
}

interface Listener {
    (update: Update): void;
}

type HistoryState = {
    usr: any;
    key?: string;
    idx: number | null;
};

const POP_STATE_EVENT = "popstate";

// because anvil the origin is not always the base path e.g. in debug mode
const baseHref = document.querySelector("base")?.getAttribute("href") ?? "";
let basePath: string | undefined;
if (baseHref) {
    basePath = new URL(baseHref).pathname;
    if (basePath !== "/" && basePath.endsWith("/")) {
        basePath = basePath.slice(0, -1);
    }
}

enum Action {
    Pop = "POP",
    Push = "PUSH",
    Replace = "REPLACE",
}

/**
 * For browser-based histories, we combine the state and key into an object
 */
function createHistoryState(location: Location, index: number | null): HistoryState {
    const jsLocation = toJs(location) as JsLocation;
    return {
        usr: jsLocation.state,
        key: jsLocation.key,
        idx: index,
    };
}

function pathStartIsValid(path: string) {
    return path.startsWith("/") || path.startsWith(".");
}

function cleanLocationParts(parts: LocationParts) {
    let { path, search, hash } = parts;
    if (!pathStartIsValid(path)) {
        path = "/" + path;
    }
    if (search == null) {
        search = "";
    }else if (search && !search.startsWith("?")) {
        search = "?" + search;
    }
    if (hash == null) {
        hash = "";
    } else if (hash && !hash.startsWith("#")) {
        hash = "#" + hash;
    }
    return { path, search, hash };
}

interface LocationConstructor extends pyType<Location> {
    new (path: string, search: string, hash: string, state: any, key: any): Location;
}

export interface Location extends pyObject {
    $get(this: Location, key: string): string;
    $getUrl(this: Location, full: boolean): string;
}

const s_search = new pyStr("search");

export const Location: LocationConstructor = buildNativeClass("anvil.history.Location", {
    base: pyDict,
    constructor: function Location(path, search, hash, state, key) {
        key ??= createKey();
        ({ path, search, hash } = cleanLocationParts({ path, search, hash }) as LocationParts);
        pyDict.call(this, ["path", path, "search", search, "hash", hash, "state", state, "key", key].map(toPy));
        this.$d = this;
    },
    slots: {
        $r() {
            return new pyStr(`<Location:${pyDict.prototype.$r.call(this)}>`);
        },
        tp$str() {
            const path = this.$get("path") ?? "";
            const search = this.$get("search") ?? "";
            const hash = this.$get("hash") ?? "";
            return new pyStr(`${path}${search}${hash}`);
        },
        tp$new(args, kws) {
            checkNoArgs("Location", args);
            const pyArgs = copyKeywordsToNamedArgs("Location", ["path", "search", "hash", "state", "key"], args, kws, [
                pyStr.$empty,
                pyStr.$empty,
                pyStr.$empty,
                pyNone,
                pyNone,
            ]) as [string, string, string, any, any];
            const jsArgs = pyArgs.map(toJs);
            return new Location(jsArgs[0], jsArgs[1], jsArgs[2], jsArgs[3], jsArgs[4]);
        },
        tp$init() {
            // pass
        }
    },
    methods: {
        get_url: {
            $meth(full) {
                return new pyStr(this.$getUrl(isTrue(full)));
            },
            $flags: { NamedArgs: ["full"], Defaults: [pyFalse] },
        },
        __serialize__: {
            $meth() {
                return pyCall(pyDict, [this]);
            },
            $flags: { FastCall: true },
        },
    },
    proto: {
        $get(key: keyof JsLocation) {
            return toJs(this.tp$getattr(new pyStr(key))) as string;
        },
        $getUrl(full) {
            let url = this.toString();
            if (!isTrue(full)) {
                return url;
            }
            // if the url has . then it's relative to the current page
            const base = url.startsWith(".") ? window.location.href : baseHref;
            if (!url.startsWith(".")) {
                url = "." + url;
            }
            url = new URL(url, base).href;
            return url;
        },
    },
    getsets: {
        search_params: {
            $get() {
                const searchString = toJs(this.tp$getattr<pyStr>(s_search)) ?? "";
                const paramsAsObject = Object.fromEntries(new URLSearchParams(searchString).entries());
                return toPy(paramsAsObject);
            },
        },
        __dict__: Sk.generic.getSetDict,
    },
    classmethods: {
        from_url: {
            $meth(args, kws) {
                checkArgsLen("Location.from_url", args, 0, 1);
                const [url, state, key] = copyKeywordsToNamedArgs(
                    "Location.from_url",
                    ["url", "state", "key"],
                    args,
                    kws,
                    [pyNone, pyNone]
                );
                const jsUrl = toJs(url);
                if (typeof jsUrl !== "string") {
                    throw new pyTypeError("Location.from_url() expects a string URL");
                }
                let pathname, search, hash;
                try {
                    ({ pathname, search, hash } = new URL(jsUrl, baseHref));
                } catch (e: any) {
                    throw new pyValueError(`Invalid URL: ${jsUrl} ${e?.message ?? ""}`);
                }
                if (basePath && pathname.startsWith(basePath)) {
                    pathname = pathname.slice(basePath.length);
                    if (!pathname) {
                        pathname = "/";
                    }
                }
                return new Location(pathname, search, hash, state, key);
            },
            $flags: { FastCall: true },
        },
    },
    flags: {
        sk$unacceptableBase: true,
    },
});

export interface LocationParts {
    path: string;
    search: string;
    hash: string;
}

function warning(cond: any, message: string) {
    if (!cond) {
        // probably throw
        // eslint-disable-next-line no-console
        Sk.builtin.print([message]);

        try {
            // Welcome to debugging history!
            //
            // This error is thrown as a convenience, so you can more easily
            // find the source for a warning that appears in the console by
            // enabling "pause on exceptions" in your JavaScript debugger.
            throw new Error(message);
            // eslint-disable-next-line no-empty
        } catch (e) {}
    }
}

/**
 * Parses a relative URL string into its separate path, search, and hash components.
 */
export function parseRelativeURL(relURL: string): LocationParts {
    const parsedPath: LocationParts = { path: "/", search: "", hash: "" };
    if (!relURL) {
        return parsedPath;
    }

    const hashIndex = relURL.indexOf("#");
    if (hashIndex >= 0) {
        parsedPath.hash = relURL.substring(hashIndex);
        relURL = relURL.substring(0, hashIndex);
    }

    const searchIndex = relURL.indexOf("?");
    if (searchIndex >= 0) {
        parsedPath.search = relURL.substring(searchIndex);
        relURL = relURL.substring(0, searchIndex);
    }

    if (!pathStartIsValid(relURL)) {
        relURL = "/" + relURL;
    }

    if (relURL) {
        parsedPath.path = relURL;
    }

    return parsedPath;
}

interface HistoryConstructor extends pyType<History> {
    new (
        name: string,
        getLocation: (globalHistory: Window["history"]) => Location,
        createHref: (location: Location) => string,
        validateLocation?: ((location: Location) => void) | null
    ): History;
}

export interface History extends pyObject {
    $name: string;
    $globalHistory: Window["history"];
    $getLocation: (globalHistory: Window["history"]) => Location;
    $createHref: (location: Location) => string;
    $validateLocation?: ((location: Location) => void) | null;
    $action: Action;
    $listeners: Set<Listener>;
    $index: number | null;
    $handlePop: (this: History) => void;
    $handler: () => void;
    $push: (this: History, to: Location) => void;
    $replace: (this: History, to: Location) => void;
    $getIndex: (this: History) => number | null;
}

export const History: HistoryConstructor = buildNativeClass("anvil.history.History", {
    constructor: function History(name, getLocation, createHref, validateLocation) {
        this.$globalHistory = window.history;
        this.$name = name;
        this.$getLocation = getLocation;
        this.$createHref = createHref;
        this.$validateLocation = validateLocation;
        this.$action = Action.Pop;
        this.$listeners = new Set();
        this.$handler = () => this.$handlePop();

        this.$index = this.$getIndex();
        if (this.$index == null) {
            this.$index = 0;
            this.$globalHistory.replaceState({ ...this.$globalHistory.state, idx: this.$index }, "");
        }
    },
    slots: {
        $r() {
            return new pyStr(`<${this.$name}History>`);
        },
        tp$new(args, kws) {
            throw new pyTypeError("Cannot create anvil.history.History instances directly");
        },
    },
    methods: {
        listen: {
            $meth(fn: pyCallable) {
                // change to $listeners
                if (this.$listeners.size === 0) {
                    window.addEventListener(POP_STATE_EVENT, this.$handler);
                }
                const listener: Listener = (update) =>
                    suspensionToPromise(() => pyCallOrSuspend(fn, [], jsObjToKws(update)));

                this.$listeners.add(listener);

                return new pyFunc(() => {
                    this.$listeners.delete(listener);
                    if (this.$listeners.size === 0) {
                        window.removeEventListener(POP_STATE_EVENT, this.$handler);
                    }
                    return pyNone;
                });
            },
            $flags: { OneArg: true },
        },
        create_href: {
            $meth(location: Location) {
                return new pyStr(this.$createHref(location));
            },
            $flags: { OneArg: true },
        },
        push: {
            $meth(to: Location) {
                this.$push(to);
                return pyNone;
            },
            $flags: { OneArg: true },
        },
        replace: {
            $meth(to: Location) {
                this.$replace(to);
                return pyNone;
            },
            $flags: { OneArg: true },
        },
        reload: {
            $meth() {
                window.location.reload();
                return pyNone;
            },
            $flags: { NoArgs: true },
        },
        go: {
            $meth(delta) {
                const n = toJs(delta) ?? 0;
                this.$globalHistory.go(n);
                return pyNone;
            },
            $flags: { MinArgs: 0, MaxArgs: 1 },
        },
    },
    getsets: {
        location: {
            $get() {
                return this.$getLocation(this.$globalHistory);
            },
        },
        action: {
            $get() {
                return toPy(this.$action);
            },
        },
    },
    proto: {
        $getIndex() {
            const state: any = this.$globalHistory.state || { idx: null };
            return state.idx;
        },
        $handlePop() {
            const action = this.$action;
            const nextIndex = this.$getIndex();
            const currentIndex = this.$index;
            const delta = nextIndex == null || currentIndex == null ? null : nextIndex - currentIndex;
            this.$index = nextIndex;
            this.$listeners.forEach((listener) => listener({ action, location: this.$location, delta }));
        },
        $push(location: Location) {
            const action = this.$action;
            this.$validateLocation?.(location);
            const currentIndex = this.$index;
            this.$index = currentIndex == null ? null : currentIndex + 1;
            const historyState = createHistoryState(location, this.$index);
            const url = this.$createHref(location);

            // try...catch because iOS limits us to 100 pushState calls :/
            try {
                this.$globalHistory.pushState(historyState, "", url);
            } catch (error) {
                // If the exception is because `state` can't be serialized, let that throw
                // outwards just like a replace call would so the dev knows the cause
                // https://html.spec.whatwg.org/multipage/nav-history-apis.html#shared-history-push/replace-state-steps
                // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
                if (error instanceof DOMException && error.name === "DataCloneError") {
                    throw error;
                }
                // They are going to lose state here, but there is no real
                // way to warn them about it since the page will refresh...
                window.location.assign(url);
            }
            this.$listeners.forEach((listener) => listener({ action, location: this.$location, delta: 1 }));
        },
        $replace(location: Location) {
            const action = this.$action;
            this.$validateLocation?.(location);

            this.$index = this.$getIndex();
            const historyState = createHistoryState(location, this.$index);
            const url = this.$createHref(location);
            this.$globalHistory.replaceState(historyState, "", url);
            const curLocation = this.$getLocation(this.$globalHistory);
            this.$listeners.forEach((listener) => listener({ action, location: curLocation, delta: 0 }));
        },
    },
});

function createBrowserLocation(globalHistory: Window["history"]) {
    let { pathname, search, hash } = window.location;
    if (basePath && pathname.startsWith(basePath)) {
        pathname = pathname.slice(basePath.length);
        if (!pathname) {
            pathname = "/";
        }
    }
    return new Location(
        pathname,
        search,
        hash,
        globalHistory.state?.usr ?? null,
        globalHistory.state?.key ?? "default"
    );
}

function createBrowserHref(to: Location) {
    return to.$getUrl(true);
}

function createHashLocation(globalHistory: Window["history"]) {
    const { path, search, hash } = parseRelativeURL(window.location.hash.substring(1));
    return new Location(path, search, hash, globalHistory.state?.usr ?? null, globalHistory.state?.key ?? "default");
}

function createHashHref(to: Location) {
    let href = "";
    if (baseHref) {
        const url = window.location.href;
        const hashIndex = url.indexOf("#");
        href = hashIndex === -1 ? url : url.slice(0, hashIndex);
    }
    const hash = to.toString();
    return href + "#" + hash;
}

function validateHashLocation(location: Location) {
    warning(
        location.toString().charAt(0) === "/",
        `relative pathnames are not supported in hash history.push(${objectRepr(location)})`
    );
}

export const makeHistory = () => new History("", createBrowserLocation, createBrowserHref, null);
export const makeHashHistory = () => new History("Hash", createHashLocation, createHashHref, validateHashLocation);
