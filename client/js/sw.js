/// <reference lib="WebWorker" />

// NB: the service worker may become passive in long running apps
// when the service worker 'wakes up' this script will re-run
// i.e. we can't trust local variables to persist
const log = false;

const ACTIVE_CACHE = "v0";
const OFFLINE_TIMEOUT_CHECK = 5000;
const STALE_TIMEOUT = 7500;

let lastOffline = 0;
let lastSlowFetch = 0;

const NETWORK_FIRST = 0;
const STALE_WITH_REVALIDATE = 1;
const CACHE_ONLY = 2;

const inIDE = !!new URL(self.location).searchParams.get("inIDE");

// useful for debugging
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const getMode = () => {
    if (!navigator.onLine || lastOffline > Date.now() - OFFLINE_TIMEOUT_CHECK) {
        return CACHE_ONLY;
    } else if (lastSlowFetch > Date.now() - OFFLINE_TIMEOUT_CHECK) {
        return STALE_WITH_REVALIDATE;
    } else {
        return NETWORK_FIRST;
    }
};

const cleanupOldCaches = async () => {
    for (const key of await caches.keys()) {
        if (key !== ACTIVE_CACHE) {
            console.log("Removing old service worker cache:", key);
            await caches.delete(key);
        }
    }
};

const cacheRequest = async (request, resp, cache) => {
    let clone;
    if (request.method === "GET" && resp.status === 200 && resp.headers.has("X-Anvil-Cacheable")) {
        clone = resp.clone();
    }
    // clean up old cache which might have different searchParams
    await cache.delete(request, { ignoreSearch: true });

    if (clone) {
        log && console.debug("Caching:", request.url);
        cache.put(request, clone);
    } else {
        log && console.debug("Not caching:", request.url);
    }
};

function getSha(requestLike) {
    const params = new URL(requestLike.url).searchParams;
    return params.get("sha") || params.get("buildTime");
}

function shouldRevalidate(request, match) {
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
    const sha = getSha(match);
    if (sha && sha !== "0") {
        return sha !== getSha(request);
    }
    return true;
}

function isNotModified(resp) {
    return resp.status === 304;
}

async function fetchMaybeNetwork(request, cache, match) {
    if (match && !shouldRevalidate(request, match)) {
        log && console.debug(`Not Revalidating: ${request.url}`);
        return match;
    }
    const resp = await fetch(request.clone());
    lastOffline = 0;
    if (match && isNotModified(resp)) {
        log && console.debug(`Not Modified: ${request.url}`);
        return match;
    }
    cacheRequest(request, resp, cache);
    return resp;
}

class TimeoutError extends Error {
    name = "TimeoutError";
}

const timeout = (ms) => new Promise((res, rej) => setTimeout(() => rej(new TimeoutError()), ms));

// fetching seems slow, so we'll use the cache but update it in the background
function staleWithRevalidate(request, cache, match) {
    log && console.debug(`Refetching: ${request.url} in the background`);
    fetchMaybeNetwork(request, cache, match);
    return match;
}

async function networkFirstFallingBackToCache(request, cache, match) {
    try {
        if (inIDE) {
            // always fetch from the network if we're in the IDE
            return fetchMaybeNetwork(request, cache, match);
        } else {
            return await Promise.race([timeout(STALE_TIMEOUT), fetchMaybeNetwork(request, cache, match)]);
        }
    } catch (err) {
        if (err.name === "TimeoutError") {
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

const onFetch = async (e) => {
    const cache = await caches.open(ACTIVE_CACHE);
    const match = await cache.match(e.request);
    const mode = getMode();
    let request = e.request;

    if (!match) {
        if (log && (mode === CACHE_ONLY || mode === STALE_WITH_REVALIDATE)) {
            console.debug("Fast offline cache miss:", request.url);
        }
        return fetchMaybeNetwork(request, cache);
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
            return staleWithRevalidate(request, cache, match);
        default:
            return networkFirstFallingBackToCache(request, cache, match);
    }
};

self.addEventListener("install", (e) => {
    console.log("Service Worker installed with scope:", self.registration.scope);
});

self.addEventListener("activate", (e) => {
    e.waitUntil(cleanupOldCaches());
});

self.addEventListener("fetch", (e) => {
    e.respondWith(onFetch(e));
});

log && console.log("%cService Worker Script Loaded", "color: green;");
