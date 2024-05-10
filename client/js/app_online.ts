import { defer, Deferred } from "./utils";

declare global {
    interface Window {
        anvilAppOnline: AnvilAppOnline;
    }
}

const OFFLINE_TIMEOUT = 7500;

async function fetchWithTimeout(request: string) {
    const abortController = new AbortController();
    const { signal } = abortController;
    let fetchCompleted = false;
    const fetchPromise = fetch(request, { signal });
    setTimeout(() => {
        if (!fetchCompleted) abortController.abort();
    }, OFFLINE_TIMEOUT);
    const resp = await fetchPromise;
    fetchCompleted = true;
    return resp;
}

class AnvilAppOnline {
    onLine = navigator.onLine;
    offlineTimeout = 5000;
    lastCheck = 0;
    deferredStatus: null | Deferred<boolean> = null;
    updateStatus(onLine: boolean) {
        this.onLine = onLine;
        this.lastCheck = Date.now();
        this.deferredStatus = null;
    }
    async fetchStatus(expectedToBe?: boolean) {
        // if we think we think we might be offline and we are offline - don't check
        // otherwise every print statement will fire this when offline
        if (expectedToBe === this.onLine) return this.onLine;
        // avoid multiple in flight calls
        if (this.deferredStatus) return this.deferredStatus.promise;
        let rv: boolean;
        const deferred = (this.deferredStatus = defer());
        try {
            await fetchWithTimeout("_/check-app-online?t=" + Date.now());
            rv = true;
        } catch (e) {
            rv = false;
        }
        deferred.resolve(rv);
        this.updateStatus(rv);
        return rv;
    }
    async checkStatus(): Promise<boolean> {
        // this function is only called inside anvil.server.is_app_online()
        if (this.lastCheck > Date.now() - this.offlineTimeout) {
            // use the cached value we have
            return this.onLine;
        }
        return this.fetchStatus();
    }
}

export const anvilAppOnline = new AnvilAppOnline();
// mostly for debugging
window.anvilAppOnline = anvilAppOnline;

/// these events are fired on change of online/offline status
/// whenever one fires we update our status
function navigatorChange() {
    anvilAppOnline.updateStatus(navigator.onLine);
}
window.addEventListener("online", navigatorChange);
window.addEventListener("offline", navigatorChange);
