/// <reference lib="WebWorker" />

// NB: the service worker may become passive in long running apps
// when the service worker 'wakes up' this script will re-run
// i.e. we can't trust local variables to persist
const log = false;

const ACTIVE_CACHE = "v0";
const OFFLINE_TIMEOUT = 5000;

let lastOffline = 0;

const cleanupOldCaches = async () => {
    for (const key of await caches.keys()) {
        if (key !== ACTIVE_CACHE) {
            console.log("Removing old service worker cache:", key);
            await caches.delete(key);
        }
    }
};

let cdnOrign = "https://";
/// Are we able to fetch this URL
const isExpectedToFetch = (e) => {
    return e.request.url.startsWith(cdnOrign);
};

self.onmessage = (e) => {
    const data = e.data;
    if (data?.cdnOrign) {
        cdnOrign = data.cdnOrign;
    }
};

async function requestCdnOrigin() {
    const clients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
    });
    const client = clients?.filter((c) => c.visibilityState === "visible")[0];
    client?.postMessage({ type: "CDN_ORIGIN" });
}

// we may have 'woken up' so ask the client for the CDN Origin
requestCdnOrigin();

const _fetch = async (e) => {
    const cache = await caches.open(ACTIVE_CACHE);
    const match = await cache.match(e.request);

    if (!navigator.onLine || lastOffline > Date.now() - OFFLINE_TIMEOUT) {
        // Shortcut: Use cache if a request recently failed for something in the cache.
        if (match) {
            log && console.debug("Fast offline cache hit:", e.request.url);
            return match;
        } else {
            log && console.debug("Fast offline cache miss:", e.request.url);
        }
    }

    try {
        const resp = await fetch(e.request.clone());
        lastOffline = 0;

        // Allow caching anything that comes back with the X-Anvil-Cacheable header
        if (e.request.method === "GET" && resp.status === 200 && resp.headers.has("X-Anvil-Cacheable")) {
            log && console.debug("Caching:", e.request.url);
            cache.put(e.request, resp.clone());
        } else {
            log && console.debug("Not caching:", e.request.url);
            cache.delete(e.request);
        }
        updateOnlineStatus(e, true);
        return resp;
    } catch (err) {
        if (match || isExpectedToFetch(e)) {
            updateOnlineStatus(e, false);
        }

        if (match) {
            lastOffline = Date.now();
            console.log("Serving Anvil resources from Service Worker cache");
            log && console.debug("Offline cache hit:", e.request.url);
            return match;
        } else {
            log && console.debug("Offline cache miss:", e.request.url);
            throw err;
        }
    }
};

self.addEventListener("install", (e) => {
    console.log("Service Worker installed with scope:", self.registration.scope);
});

self.addEventListener("activate", (e) => {
    e.waitUntil(cleanupOldCaches());
});

self.addEventListener("fetch", (e) => {
    e.respondWith(_fetch(e));
});

let navigatorTrusted = true;

/// We only post a message if either the navigator was previously untrusted
/// or the navigator is now untrusted
async function updateOnlineStatus(e, onLine) {
    if (onLine !== navigator.onLine) {
        navigatorTrusted = false;
        postOfflineStatus(e, onLine);
    } else if (!navigatorTrusted) {
        navigatorTrusted = true;
        postOfflineStatus(e, onLine);
    }
}

async function postOfflineStatus(e, onLine) {
    const client = await self.clients.get(e.clientId);
    if (!client) return;
    client.postMessage({ type: "OFFLINE_STATUS", onLine });
}
