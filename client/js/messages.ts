import { pyBaseException, pyStr, pyTuple, toJs } from "@Sk";

window.messages = window.messages || {};

interface OutstandingRequest {
    reject(reason?: unknown): void;
    resolve(value: unknown): void;
}

let nextRequestId = 0;
const outstandingRequests: Record<number, OutstandingRequest> = {};
const UNKNOWN_MESSAGE_LOG_WINDOW_MS = 10_000;
const UNKNOWN_MESSAGE_LOG_RETENTION_MS = 60_000;
const unknownMessageLastLoggedAt = new Map<string, number>();
let unknownMessageLastCleanupAt = 0;

interface RuntimeMessage {
    args?: unknown;
    error?: unknown;
    fn?: string;
    id?: number;
    requestId?: unknown;
    response?: unknown;
    [key: string]: unknown;
}

type RuntimeMessageEvent = MessageEvent<RuntimeMessage>;

type MessageResponse = {
    error?: string;
    fn?: string;
    msg?: unknown;
    requestId?: unknown;
    result?: unknown;
    traceback?: pyBaseException["traceback"];
    type?: string;
};

function getMessageSourceClass(source: MessageEventSource | null) {
    if (window.parent !== window && source === window.parent) {
        return "parent";
    }
    if (window.opener && source === window.opener) {
        return "opener";
    }
    return "other";
}

function logUnknownMessageRateLimited(e: RuntimeMessageEvent) {
    const fn = typeof e.data?.fn === "string" ? e.data.fn : "<no-fn>";
    const sourceClass = getMessageSourceClass(e.source);
    const origin = e.origin || "<no-origin>";
    const key = `${fn}|${origin}|${sourceClass}`;
    const now = Date.now();
    const lastLoggedAt = unknownMessageLastLoggedAt.get(key);

    if (lastLoggedAt !== undefined && now - lastLoggedAt < UNKNOWN_MESSAGE_LOG_WINDOW_MS) {
        return;
    }

    unknownMessageLastLoggedAt.set(key, now);

    if (now - unknownMessageLastCleanupAt > UNKNOWN_MESSAGE_LOG_RETENTION_MS) {
        for (const [entryKey, entryTimestamp] of unknownMessageLastLoggedAt.entries()) {
            if (now - entryTimestamp > UNKNOWN_MESSAGE_LOG_RETENTION_MS) {
                unknownMessageLastLoggedAt.delete(entryKey);
            }
        }
        unknownMessageLastCleanupAt = now;
    }

    console.debug("Message not recognised:", e.data);
}

window.anvilCallIdeFn = (fn: string, args: unknown, timeout: number | null = 500) => {
    const msg = {
        type: "CALL",
        id: nextRequestId++,
        fn,
        args,
    };
    const p = new Promise((resolve, reject) => {
        outstandingRequests[msg.id] = { resolve, reject };
    });

    if (window.parent !== window) {
        window.parent.postMessage(msg, "*");
    } else if (window.opener) {
        window.opener.postMessage(msg, "*");
    } else {
        throw new Error("No IDE to talk to.");
    }
    if (timeout) {
        // null or 0 means no timeout
        setTimeout(() => {
            outstandingRequests[msg.id]?.reject(new Error("Timeout"));
        }, timeout);
    }
    return p;
};

$(function () {
    window.addEventListener("message", async function (e: RuntimeMessageEvent) {
        // Filter out messages without data.
        if (!e.data) {
            return;
        }
        //console.log("Runtime client got message: ", e);

        // Check source origin of incoming message. Make sure it's the Anvil IDE.
        if (e.origin != window.anvilParams.ideOrigin && !window.anvilAppOrigin.startsWith(e.origin)) {
            //console.warn("Ignoring message from invalid origin:", e.origin);
            return;
        }

        if (e.data.response || e.data.error) {
            const { id, response, error } = e.data as { id: number; response: unknown; error: unknown };
            const request = outstandingRequests[id];
            if (request) {
                delete outstandingRequests[id];
                if (response) {
                    request.resolve(response);
                } else {
                    request.reject(error);
                }
            }
        } else {
            const fn = window.messages[e.data.fn as string];
            let rv: MessageResponse | undefined;
            try {
                if (fn) {
                    rv = { result: await fn.call(window.messages, e.data.args) };
                } else {
                    logUnknownMessageRateLimited(e);
                    //rv = {error: "Message '"+e.data.fn+"' not recognised"};
                }
            } catch (err) {
                console.error(err, err instanceof Error ? err.stack : "(no stack trace)");
                if (err instanceof pyBaseException) {
                    rv = {
                        fn: "pythonError",
                        traceback: err.traceback,
                        type: err.tp$name,
                        msg: toJs(err.args)[0],
                    };
                } else {
                    rv = { error: "" + err };
                }
            }

            if (rv) {
                rv.requestId = e.data.requestId;

                if (window.parent !== window) {
                    window.parent.postMessage(rv, e.origin);
                } else if (window.opener) {
                    window.opener.postMessage(rv, e.origin);
                }
            }
        }
    });
    window.parent.postMessage({ fn: "ready" }, "*");
    window.opener?.postMessage({ fn: "ready" }, "*");
});
