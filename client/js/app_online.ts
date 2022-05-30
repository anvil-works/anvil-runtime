declare global {
    interface Window {
        isIE: boolean;
        anvilAppOnline: AnvilAppOnline;
    }
}

// initial value just use what the navigator says
// until the service worker tells us otherwise
class AnvilAppOnline {
    onLine = navigator.onLine;
    navigatorTrusted = true;
    offlineTimeout = 5000;
    lastCheck = 0;
    updateStatus(onLine: boolean) {
        this.onLine = onLine;
        this.lastCheck = Date.now();
        this.navigatorTrusted = onLine === navigator.onLine;
    }
    async fetchStatus() {
        if (window.isIE) return this.onLine;
        let rv: boolean;
        try {
            await fetch("_/check-app-online?buildTime=0");
            rv = true;
        } catch (e) {
            rv = false;
        }
        this.updateStatus(rv);
        return rv;
    }
    checkStatus(awaitable: boolean) {
        // IE has no support for fetch and it's not polyfilled
        if ((this.navigatorTrusted && this.onLine) || window.isIE) return this.onLine;
        if (this.lastCheck > Date.now() - this.offlineTimeout) {
            // use the value we have
            return this.onLine;
        }
        this.lastCheck = Date.now(); // So we don't have multiple calls to fetchStatus in flight
        if (awaitable) {
            return this.fetchStatus();
        }
        // in the rpc call we can't await
        // so do the asyncronous fetch, which will update our stale online value
        // return the stale value
        this.fetchStatus();
        return this.onLine;
    }
}

export const anvilAppOnline = new AnvilAppOnline();
// mostly for debugging
window.anvilAppOnline = anvilAppOnline;

/// these events are fired on change of online/offline status
/// whenever one fires we update our status
/// if the navigator was previously untrusted we check in with the service worker
function navigatorChange() {
    if (anvilAppOnline.navigatorTrusted) {
        anvilAppOnline.updateStatus(navigator.onLine);
    } else {
        anvilAppOnline.fetchStatus(); // check with the service worker
    }
}
window.addEventListener("online", navigatorChange);
window.addEventListener("offline", navigatorChange);

interface OfflineStatusEvent {
    type: "OFFLINE_STATUS";
    onLine: boolean;
    navigatorTrusted: boolean;
}

export function offlineStatusMessageHandler(event: MessageEvent<OfflineStatusEvent>) {
    if (event.data && event.data.type === "OFFLINE_STATUS") {
        const { onLine } = event.data;
        anvilAppOnline.updateStatus(onLine);
    }
}
