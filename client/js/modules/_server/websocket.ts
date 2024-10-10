import { anvilAppOnline } from "@runtime/app_online";
import { defer } from "@runtime/utils";
import { diagnosticData, diagnosticEvent } from "./diagnostics";
import { handleMessage } from "./handlers";
import { Profile } from "./profile";
import { incHeartbeatCount, outstandingRequests } from "./rpc";

export let websocket: Promise<WebSocket> | null = null; // Promise of a WebSocket

declare global {
    interface Window {
        anvilWebsocket?: WebSocket;
    }
}

const KEEP_ALIVE_DATA = {
    type: "CALL",
    id: "client-keepalive-",
    command: "anvil.private.echo",
    args: ["keep-alive"],
    kwargs: {},
} as const;

function heartbeatInterval(ws: WebSocket) {
    const heartbeatId = setInterval(() => {
        try {
            ws.send(JSON.stringify({ ...KEEP_ALIVE_DATA, id: "client-keepalive-" + incHeartbeatCount() }));
        } catch (e) {
            console.error("Failed to send client keepalive.", e);
        }
    }, 5000);
    return () => clearInterval(heartbeatId);
}

const getWebSocketEndpoint = () => {
    const base = window.anvilAppOrigin.replace(/^http/, "ws");
    return `${base}/_/ws/${window.anvilParams.accessKey || ""}?_anvil_session=${window.anvilSessionToken}`;
};

let firstSendFail = true;

export class WebsocketFallback extends Error {}

class AnvilWebSocket extends WebSocket {
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        try {
            super.send(data);
        } catch (e) {
            if (firstSendFail) {
                throw new WebsocketFallback("use HTTP");
            }
            throw e;
        }
        firstSendFail = false;
    }
}

export function connect(profile?: Profile) {
    // return promise of a WebSocket
    if (websocket != null) return websocket;

    const connectedProfile = profile?.append("Connect websocket");
    const deferred = defer<WebSocket>();

    websocket = deferred.promise;

    const ws = new AnvilWebSocket(getWebSocketEndpoint());
    window.anvilWebsocket = ws;
    let heartbeatIntervalDispose = () => {};

    ws.onopen = () => {
        diagnosticEvent("connected");
        connectedProfile?.end();
        // Start keepalive heartbeat
        heartbeatIntervalDispose = heartbeatInterval(ws);
        deferred.resolve(ws);
    };

    const onclose = (evt: any) => {
        // Stop keepalive heartbeat
        heartbeatIntervalDispose();
        if (websocket === deferred.promise) {
            websocket = null;
        }
        deferred.reject(evt);
        // we might be offline but we don't know
        anvilAppOnline.fetchStatus(false);
        // Let all outstanding requests (on the closed websocket) know that they should either retry or fail
        for (const i in outstandingRequests) {
            if (outstandingRequests[i].ws == evt.target || outstandingRequests[i].ws == null) {
                outstandingRequests[i].onerror(evt);
            }
        }
    };

    ws.onclose = (evt) => {
        diagnosticEvent("closed");
        console.log("WebSocket closed", evt);
        onclose(evt);
    };

    ws.onerror = (evt) => {
        diagnosticEvent("error");
        console.log("WebSocket error", evt);
        onclose(evt);
    };

    ws.onmessage = (e) => {
        anvilAppOnline.updateStatus(true);
        diagnosticData.nReceived++;
        handleMessage(e.data);
    };

    return deferred.promise;
}
