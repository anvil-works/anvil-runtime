import {
    chainOrSuspend,
    pyCall,
    pyCallOrSuspend, pyIterFor,
    pyNone,
    pyNoneType,
    pyRuntimeError,
    pyStr,
    suspensionToPromise,
    toPy,
} from "@Sk";
import { anvilServerMod } from "@runtime/runner/py-util";
import PyDefUtils from "PyDefUtils";
import { pyNamedExceptions, pyServerEventHandlers } from "./constants";
import {getOutstandingMedia, reconstructObjects} from "./deserialize";
import { diagnosticRequest } from "./diagnostics";
import { ServerProfile } from "./profile";
import {
    OutstandingRequest,
    deleteOutstandingRequest,
    outstandingRequests,
    requestSuspensions,
    onServerCallResponse
} from "./rpc";
import { VtGlobals } from "./types";
import { updateReplState } from "../../runner/logging";


interface ChunkData {
    type: "CHUNK_HEADER";
    requestId: string;
    mediaId: string;
    lastChunk?: boolean;
}

interface EventData {
    event: { name: string; payload: any };
}

export interface ResponseData {
    id: string;
    objects: any;
    vt_global: VtGlobals;
    profile?: ServerProfile;
    response: any;
    cacheUpdates?: any;
    importDuration?: number;    
    capUpdates?: any;
    stepOut?: boolean;
}

export interface ErrorData {
    error: {
        type: string;
        message: string;
        trace: [string, string][];
    };
}

export function handleOutput(d: any) {
    // The "true" is an Anvil-proprietary thing to mark this as from the server
    Sk.output(d.output, true);
}

export function handleCookie() {
    $.post(window.anvilAppOrigin + "/_/request_cookies?_anvil_session=" + window.anvilSessionToken);
}

export function handleInvalidateMacs() {
    const handleInvalidate = PyDefUtils.getModule("anvil.server")?.tp$getattr(new pyStr("__anvil$doInvalidatedMacs")) as any as function | undefined;
    if (handleInvalidate) {
        PyDefUtils.asyncToPromise(handleInvalidate);
    }
}

let nextBlobLocation: null | { content: Blob[] } = null;
let nextBlobRequestId: null | string = null;

export function handleBytes(data: Blob) {
    if (nextBlobLocation && nextBlobRequestId) {
        nextBlobLocation.content.push(data);
        maybeHandleResponse(nextBlobRequestId);
    }
    nextBlobLocation = nextBlobRequestId = null;
}

export function handleChunkHeader(d: ChunkData) {
    const req = outstandingRequests[d.requestId];
    const media = req && req.media[d.mediaId];
    if (!media) {
        console.error("Got binary chunk for unknown request ID " + d.requestId + " / media ID " + d.mediaId);
        return;
    }

    req.receiveBlobsProfile ??= req.profile.append("Receive blobs");

    nextBlobLocation = media;
    nextBlobRequestId = d.requestId;
    media.complete = d.lastChunk;
}

export function handleEvent(d: EventData) {
    // TODO: Deserialise response.
    console.log("Server event: ", d);
    const { name, payload } = d.event;
    const handlers = pyServerEventHandlers[name];
    if (handlers) {
        const chainFns = handlers.map((pyHandler) => () => pyCallOrSuspend(pyHandler, [toPy(payload)]));
        PyDefUtils.asyncToPromise(() => chainOrSuspend(pyNone, ...chainFns));
    }
}

/** Legacy LiveObject updates */
export function applyCacheUpdates(req: OutstandingRequest) {
    const { cacheUpdates } = (req.response as ResponseData) ?? {};
    if (!cacheUpdates) return;

    for (const backend in cacheUpdates) {
        const updates = cacheUpdates[backend];
        const kli = req.knownLiveObjectInstances[backend];
        if (!kli) continue;
        for (const id in updates) {
            for (const spec of kli[id] ?? []) {
                spec.itemCache = {};
                for (const item in updates[id]) {
                    spec.itemCache[item] = toPy(updates[id][item]);
                }
            }
        }
    }
}

export async function applyCapUpdates(req: OutstandingRequest) {
    const { capUpdates } = (req.response as ResponseData) ?? {};
    if (!capUpdates) return;

    // Collect these in JS where it's easier
    const chainedUpdates: (() => pyNoneType)[] = [];

    // Normalise the keys to how *this* browser does JSON (ew)
    const updates: any = {};
    for (const i in capUpdates) {
        updates[JSON.stringify(JSON.parse(i))] = capUpdates[i];
    }

    console.log("Capability updates:", updates);
    for (const pyCap of req.knownCapabilities) {
        const scopeJson = pyCap._JSONScope;
        if (scopeJson in updates) {
            console.log("Update for", scopeJson);
            chainedUpdates.push(() => pyCap._applyUpdate(toPy(updates[scopeJson])));
        } else {
            console.log("No update for", scopeJson);
        }
    }
    await suspensionToPromise(() => chainOrSuspend(null, ...chainedUpdates));
}

export async function maybeHandleResponse(id: string) {
    const req = outstandingRequests[id];
    diagnosticRequest({ id, response: !!req?.response });
    if (!req) {
        console.error("maybeHandleResponse() called for unknown request ID " + id);
        return;
    }

    for (const { complete } of Object.values(req.media)) {
        if (!complete) return;
    }

    req.receiveBlobsProfile?.end();
    delete req.receiveBlobsProfile;

    if (!req.suppressLoading) window.setLoading?.(false);
    deleteOutstandingRequest(id);


    if ("response" in req.response!) {
        if (req.response?.importDuration) {
            updateReplState({"importTime": req.response?.importDuration})
        }

        try {
            const reconstructProfile = req.profile.append("Reconstruct objects");
            await reconstructObjects(req.response, req.media);
            reconstructProfile?.end();
            applyCacheUpdates(req);
            await applyCapUpdates(req);

            onServerCallResponse?.(req.response);

            //console.log("Response came back for RPC request " + id + ": ", req.response);
            const pyResponse = toPy(req.response.response);

            req.profile.response = req.response;
            req.profile.print();
            req.deferred.resolve(pyResponse);
        } catch (e) {
            req.deferred.reject(e);
        }
    } else if ("error" in req.response!) {
        req.profile.print();
        req.deferred.reject(assembleException(req.response));
    } else {
        req.deferred.reject(new pyRuntimeError("Invalid RPC response"));
        console.error("Response came back without 'response' or 'error' keys: ", req);
    }
}

export function handleResponse(d: ResponseData) {
    // response
    
    const { id, objects = {}, profile } = d;

    if (id.startsWith("client-keepalive")) return;

    const req = outstandingRequests[id];
    if (!req) {
        console.error("Got response for unknown request ID " + id);
        return;
    }
    req.response = d;
    req.media = getOutstandingMedia(objects);

    if (profile) {
        req.profile.mergeServerProfile(profile);
    }

    
    maybeHandleResponse(id);
}

let onDebuggerMessage = null;

export const setOnDebuggerMessage = (handler) => {
    onDebuggerMessage = handler;
}


function handleDebuggerMessage(d: any) {
    const req = outstandingRequests[d.id];
    const susp = requestSuspensions[d.id];
    onDebuggerMessage?.(req, d.debuggers, susp);
}


export function handleMessage(data: any) {
    if (data instanceof Blob || data instanceof ArrayBuffer) {
        return handleBytes(data as Blob);
    }
    const d = JSON.parse(data);
    switch (true) {
        case d.type === "CHUNK_HEADER":
            return handleChunkHeader(d);
        case d.id && ("response" in d || "error" in d):
            return handleResponse(d);
        case !!d.event:
            return handleEvent(d);
        case !!d.debuggers:
            return handleDebuggerMessage(d);
        case !!d.output:
            return handleOutput(d);
        case !!d["invalidate-macs"]:
            return handleInvalidateMacs(d);
        case !!d["set-cookie"]:
            return handleCookie();
        case !!d.error:
            return window.onerror(null, null, null, null, assembleException(d));
        default:
            console.log("Unknown message from server: ", d);
    }
}


export const assembleException = function ({ error }: any) {
    const { type, message, trace } = error;
    const exceptionType = pyNamedExceptions[type] || anvilServerMod.AnvilWrappedError;
    const exception = pyCall(exceptionType, [new pyStr(message || "[unexpected error]")]);

    if (trace && exception.traceback) {
        for (const [filename, lineno] of trace) {
            // @ts-ignore
            exception.traceback.push({ filename, lineno, fromServer: true });
        }
    }
    exception._anvil = { errorObj: error };
    return exception;
};

