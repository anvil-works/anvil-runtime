let log = true;

let ACTIVE_CACHE = 'v0';
let OFFLINE_TIMEOUT = 5000;

let lastOffline = 0;

let cleanupOldCaches = async () => {
    for (let key of await caches.keys()) {
        if (key !== ACTIVE_CACHE) {
            console.log("Removing old service worker cache:", key);
            await caches.delete(key);
        }
    }
}


let _fetch = async e => {

    let cache = await caches.open(ACTIVE_CACHE);
    let match = await cache.match(e.request);

    if (!navigator.onLine || lastOffline > Date.now() - OFFLINE_TIMEOUT) {
        // Shortcut: Use cache if a request recently failed for something in the cache.
        if (match) {
            log && console.log("Fast offline cache hit:", e.request.url);
            return match;
        } else {
            log && console.log("Fast offline cache miss:", e.request.url);
        }
    }

    try {
        let resp = await fetch(e.request.clone());
        lastOffline = 0;

        // Allow caching anything that comes back with the X-Anvil-Cacheable header
        if (e.request.method === "GET" && resp.status === 200 && resp.headers.has("X-Anvil-Cacheable")) {
            log && console.log("Caching:", e.request.url);
            cache.put(e.request, resp.clone());
        } else {
            log && console.log("Not caching:", e.request.url);
            cache.delete(e.request);
        }
        return resp;
    } catch (err) {
        if (match) {
            lastOffline = Date.now();
            console.log("Serving Anvil resources from Service Worker cache");
            log && console.log("Offline cache hit:", e.request.url);
            return match;
        } else {
            log && console.log("Offline cache miss:", e.request.url);
            throw err;
        }
    }
};

addEventListener('install', e => {
    console.log("Service Worker installed with scope:", registration.scope);
});

addEventListener('activate', e => {
    e.waitUntil(cleanupOldCaches());
});

addEventListener('fetch', e => {
    e.respondWith(_fetch(e))
});
