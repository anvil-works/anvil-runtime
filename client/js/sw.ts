/// <reference lib="WebWorker" />

// NB: the service worker may become passive in long running apps
// when the service worker 'wakes up' this script will re-run
// i.e. we can't trust local variables to persist
const log = false;

const ACTIVE_CACHE = "v0";
const OFFLINE_TIMEOUT_CHECK = 5000;
const STALE_TIMEOUT = 7500;
const SW_PERF_PHASE_THRESHOLD = 100;
const SW_PERF_TOTAL_THRESHOLD = 500;
const SW_PERF_PREFIX = "[Anvil-SW-perf]";
const SW_PERF_PREFIX_STYLE = "color: #9b5de5; font-weight: 700";

let lastOffline = 0;
let lastSlowFetch = 0;

const NETWORK_FIRST = 0;
const STALE_WITH_REVALIDATE = 1;
const CACHE_ONLY = 2;

const sw = globalThis as unknown as ServiceWorkerGlobalScope;
const swUrl = new URL(sw.location.href);
const inIDE = !!swUrl.searchParams.get("inIDE");
const swDebug = swUrl.searchParams.get("swDebug") === "1";

const createDeferred = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

// useful for debugging
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getMode = (): number => {
    if (!navigator.onLine || lastOffline > Date.now() - OFFLINE_TIMEOUT_CHECK) {
        return CACHE_ONLY;
    } else if (lastSlowFetch > Date.now() - OFFLINE_TIMEOUT_CHECK) {
        return STALE_WITH_REVALIDATE;
    } else {
        return NETWORK_FIRST;
    }
};

interface SwPerfContext {
    request: Request;
    timings: Record<string, number>;
}

const roundMs = (ms: number): number => Math.round(ms * 10) / 10;

const setTiming = (timings: Record<string, number>, name: string, start: number): void => {
    timings[name] = roundMs(performance.now() - start);
};

const withPerfDebug =
    <Args extends unknown[], T>(name: string, fn: (...args: Args) => Promise<T>, reportEvent?: string) =>
    async (context: SwPerfContext | undefined, ...args: Args): Promise<T> => {
        const start = performance.now();
        try {
            return await fn(...args);
        } finally {
            if (context) {
                setTiming(context.timings, name, start);
                if (reportEvent) {
                    reportSwPerf(reportEvent, context);
                }
            }
        }
    };

const cacheDeleteIgnoreSearch = withPerfDebug("cacheDeleteIgnoreSearch", (cache: Cache, request: Request) =>
    cache.delete(request, { ignoreSearch: true })
);

const cachePut = withPerfDebug("cachePut", (cache: Cache, request: Request, response: Response) =>
    cache.put(request, response)
);

const fetchRequest = withPerfDebug("fetch", (request: Request) => fetch(request.clone()));

const openCache = withPerfDebug("cacheOpen", () => caches.open(ACTIVE_CACHE));

const cacheMatch = withPerfDebug("cacheMatch", (cache: Cache, request: Request) => cache.match(request));

const getPerfPath = (url: string): string => {
    const parsed = new URL(url);
    const params = new URLSearchParams();
    for (const key of ["sha", "buildTime"]) {
        const value = parsed.searchParams.get(key);
        if (value !== null) {
            params.set(key, value);
        }
    }
    const query = params.toString();
    return `${parsed.pathname}${query ? `?${query}` : ""}`;
};

const getPerfOrigin = (url: string): string => new URL(url).origin;

const shouldReportSwPerf = (timings: Record<string, number>): boolean => {
    return Object.entries(timings).some(([name, value]) =>
        name === "total" ? value > SW_PERF_TOTAL_THRESHOLD : value > SW_PERF_PHASE_THRESHOLD
    );
};

const reportSwPerf = (event: string, context: SwPerfContext): void => {
    if (!swDebug) {
        return;
    }
    // cacheUpdate also wraps non-cacheable responses; only report it when actual cache work ran.
    if (event === "cache-update" && !("cacheDeleteIgnoreSearch" in context.timings || "cachePut" in context.timings)) {
        return;
    }
    if (getPerfOrigin(context.request.url) !== sw.location.origin && !shouldReportSwPerf(context.timings)) {
        return;
    }

    const record = {
        event,
        origin: getPerfOrigin(context.request.url),
        path: getPerfPath(context.request.url),
        timings: context.timings,
    };

    console.warn(`%c${SW_PERF_PREFIX}%c ${JSON.stringify(record)}`, SW_PERF_PREFIX_STYLE, "");
};

const cleanupOldCaches = async (): Promise<void> => {
    for (const key of await caches.keys()) {
        if (key !== ACTIVE_CACHE) {
            console.log("Removing old service worker cache:", key);
            await caches.delete(key);
        }
    }
};

function getSha(requestLike: Request | Response): string | null {
    const params = new URL(requestLike.url).searchParams;
    // `buildTime=0` is the unversioned placeholder used in source templates.
    // Real immutable asset URLs carry either a nonzero buildTime or a sha.
    return params.get("sha") || params.get("buildTime");
}

const hasStableVersion = (requestLike: Request | Response): boolean => {
    const sha = getSha(requestLike);
    return !!sha && sha !== "0";
};

const cacheRequest = async (
    request: Request,
    resp: Response,
    cache: Cache,
    perfContext?: SwPerfContext
): Promise<void> => {
    if (!(request.method === "GET" && resp.status === 200 && resp.headers.has("X-Anvil-Cacheable"))) {
        log && console.debug("Not caching:", request.url);
        return;
    }

    const clone = resp.clone();

    if (hasStableVersion(request)) {
        // Versioned URLs are exact-match safe, but remove stale query variants to keep the cache bounded.
        await cacheDeleteIgnoreSearch(perfContext, cache, request);
    }
    log && console.debug("Caching:", request.url);
    await cachePut(perfContext, cache, request, clone);
};

interface BackgroundTasks {
    promise: Promise<void>;
    add: (task: Promise<unknown>) => void;
    finish: () => void;
}

const createBackgroundTasks = (): BackgroundTasks => {
    const done = createDeferred<void>();
    const pending = new Set<Promise<unknown>>();
    let draining = true;

    const drainTasks = async (): Promise<void> => {
        draining = false;

        // Tasks may add follow-up work while they run; for example, a
        // background network fetch can enqueue a cache write after it resolves.
        // Drain in batches until no newly-added work remains.
        while (pending.size > 0) {
            const batch = Array.from(pending);
            pending.clear();
            await Promise.all(batch);
        }

        done.resolve();
    };

    return {
        promise: done.promise,
        add(task) {
            if (!draining && pending.size === 0) {
                log && console.warn("Service Worker background task added after drain completed");
            }
            pending.add(task.catch(() => undefined));
        },
        finish() {
            if (!draining) {
                return;
            }
            void drainTasks().catch(done.reject);
        },
    };
};

const updateCache = withPerfDebug("cacheUpdate", (fn: () => Promise<void>) => fn(), "cache-update");

const updateCacheInBackground = (
    backgroundTasks: BackgroundTasks,
    request: Request,
    resp: Response,
    cache: Cache,
    perfContext?: SwPerfContext
): void => {
    backgroundTasks.add(
        updateCache(perfContext, async () => {
            try {
                await cacheRequest(request, resp, cache, perfContext);
            } catch (err) {
                console.log("Unable to update Service Worker cache");
                log && console.error(request.url, err);
            }
        })
    );
};

function shouldRevalidate(request: Request, match?: Response): boolean {
    if (!match) {
        return true;
    }
    if (match.url !== request.url) {
        return true;
    }

    const cacheControl = match.headers.get("cache-control");
    if (cacheControl?.includes("no-cache")) {
        return true;
    }
    // Only skip revalidation for URLs that carry a real version marker.
    if (hasStableVersion(match)) {
        return getSha(match) !== getSha(request);
    }
    return true;
}

function isNotModified(resp: Response): boolean {
    return resp.status === 304;
}

async function fetchMaybeNetwork(
    backgroundTasks: BackgroundTasks,
    request: Request,
    cache: Cache,
    match?: Response,
    perfContext?: SwPerfContext
): Promise<Response> {
    if (match && !shouldRevalidate(request, match)) {
        log && console.debug(`Not Revalidating: ${request.url}`);
        return match;
    }
    const resp = await fetchRequest(perfContext, request);
    lastOffline = 0;
    if (match && isNotModified(resp)) {
        log && console.debug(`Not Modified: ${request.url}`);
        return match;
    }
    updateCacheInBackground(backgroundTasks, request, resp, cache, perfContext);
    return resp;
}

class TimeoutError extends Error {
    override name = "TimeoutError";
}

const timeout = (ms: number): Promise<never> =>
    new Promise((_res, rej) => setTimeout(() => rej(new TimeoutError()), ms));

// fetching seems slow, so we'll use the cache but update it in the background
function staleWithRevalidate(
    backgroundTasks: BackgroundTasks,
    request: Request,
    cache: Cache,
    match: Response
): Response {
    log && console.debug(`Refetching: ${request.url} in the background`);
    backgroundTasks.add(
        fetchMaybeNetwork(backgroundTasks, request, cache, match)
            .then(() => undefined)
            .catch((err) => {
                console.log("Unable to refresh Service Worker cache");
                log && console.error(request.url, err);
            })
    );
    return match;
}

async function networkFirstFallingBackToCache(
    backgroundTasks: BackgroundTasks,
    request: Request,
    cache: Cache,
    match: Response,
    perfContext: SwPerfContext
): Promise<Response> {
    const networkFetch = fetchMaybeNetwork(backgroundTasks, request, cache, match, perfContext);
    try {
        if (inIDE) {
            // always fetch from the network if we're in the IDE
            return networkFetch;
        } else {
            backgroundTasks.add(networkFetch);
            return await Promise.race([timeout(STALE_TIMEOUT), networkFetch]);
        }
    } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
            // fetch network will continue in the background
            console.log(
                "Resource slow to load, serving Anvil resources from Service Worker cache, and re-fetching in the background"
            );
            lastSlowFetch = Date.now();
        } else {
            console.log("Serving Anvil resources from Service Worker cache");
            lastOffline = Date.now();
        }
        log && console.error(request.url, err);
        return match;
    }
}

const onFetch = withPerfDebug(
    "total",
    async (e: FetchEvent, backgroundTasks: BackgroundTasks, perfContext: SwPerfContext): Promise<Response> => {
        if (new URL(e.request.url).origin !== sw.location.origin) {
            return fetchRequest(perfContext, e.request);
        }

        const cache = await openCache(perfContext);

        const match = await cacheMatch(perfContext, cache, e.request);

        const mode = getMode();
        let request = e.request;

        if (!match) {
            if (log && (mode === CACHE_ONLY || mode === STALE_WITH_REVALIDATE)) {
                console.debug("Fast offline cache miss:", request.url);
            }
            return fetchMaybeNetwork(backgroundTasks, request, cache, undefined, perfContext);
        }

        const eTag = match.headers.get("ETag");
        if (eTag) {
            log && console.debug("got etag", eTag, request.url);
            const headers = new Headers(request.headers);
            headers.set("If-None-Match", eTag);
            request = new Request(request, { headers, mode: "cors", credentials: "same-origin" });
        }

        switch (mode) {
            case CACHE_ONLY:
                log && console.debug("Fast offline cache hit:", request.url);
                return match;
            case STALE_WITH_REVALIDATE:
                log && console.debug("Fast cache hit:", request.url);
                return staleWithRevalidate(backgroundTasks, request, cache, match);
            default:
                return networkFirstFallingBackToCache(backgroundTasks, request, cache, match, perfContext);
        }
    },
    "response"
);

sw.addEventListener("install", (e: ExtendableEvent) => {
    console.log("Service Worker installed with scope:", sw.registration.scope);
});

sw.addEventListener("activate", (e: ExtendableEvent) => {
    e.waitUntil(cleanupOldCaches());
});

sw.addEventListener("fetch", (e: FetchEvent) => {
    const perfContext: SwPerfContext = {
        request: e.request,
        timings: {},
    };
    const backgroundTasks = createBackgroundTasks();
    // waitUntil() must be called synchronously while the fetch event is active.
    // Async branches add work to this queue later; finish() drains all tasks
    // added before or during the drain without blocking the response itself.
    e.waitUntil(backgroundTasks.promise);
    e.respondWith(onFetch(perfContext, e, backgroundTasks, perfContext).finally(backgroundTasks.finish));
});

log && console.log("%cService Worker Script Loaded", "color: green;");
