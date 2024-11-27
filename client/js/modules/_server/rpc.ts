import { defer, Deferred, generateUUID, globalSuppressLoading } from "@runtime/utils";
import { anvilServerMod } from "@runtime/runner/py-util";
import { Args, Kws, promiseToSuspension, pyStr, Suspension } from "@Sk";
import PyDefUtils from "PyDefUtils";
import { diagnosticData, diagnosticRequest } from "./diagnostics";
import { ErrorData, ResponseData } from "./handlers";
import { Profile, profileStart } from "./profile";
import { serialize } from "./serialize";
import {
    BlobContent,
    Capability,
    knownCapabilities as KnownCapabilities,
    KnownLiveObjectInstances,
    KnownLiveObjectMethods,
    LiveObjectSpec,
} from "./types";
import { connect, WebsocketFallback } from "./websocket";
import { doHttpCall, executeCallHttp } from "./http";

declare global {
    interface Window {
        setLoading(loading: boolean): void;
    }
}

type Path = (string | number)[];

export interface OutstandingMedia {
    [id: string]: { path: Path; mime_type: string; content: Blob[]; name: string; complete?: boolean };
}

export interface OutstandingRequest {
    id: string;
    deferred: Deferred<any>;
    response?: ResponseData | ErrorData;
    media: OutstandingMedia;
    ws?: WebSocket;
    suppressLoading?: boolean;
    knownLiveObjectInstances: KnownLiveObjectInstances;
    knownCapabilities: KnownCapabilities;
    onerror(evt: any): void;
    profile: Profile;
    receiveBlobsProfile?: Profile;
}

type OutstandingRequests = {
    [id: string]: OutstandingRequest;
};

export const outstandingRequests: OutstandingRequests = {};
export const requestSuspensions: Record<string, Suspension> = {};
export let onServerCallResponse: ((resp: ResponseData) => void) | null = null;
export let modifyOutgoingServerCall: ((call: any) => void) | null = null;
export const getNumOutstandingRequests = () => Object.keys(outstandingRequests).length;

let requestReloadEnvOnNextCall = false;

export const reloadEnvOnNextCall = () => {
    requestReloadEnvOnNextCall = true;
};

let heartbeatTimeout: number | undefined;
let heartbeatCount = 0;

export const registerServerCallSuspension = (s: Suspension<{ serverRequestId: string }>) => {
    requestSuspensions[s.data.serverRequestId] = s;
};

export const setOnServerCallResponse = (handler: (resp: ResponseData) => void) => {
    onServerCallResponse = handler;
};
export const setModifyOutgoingServerCall = (handler: (call: any) => void) => {
    modifyOutgoingServerCall = handler;
};

async function heartbeat() {
    try {
        await trySend({
            type: "CALL",
            id: "client-keepalive-" + heartbeatCount++,
            command: "anvil.private.echo",
            args: ["keep-alive"],
            kwargs: {},
        });
    } catch {
        // pass
    }

    heartbeatTimeout = undefined;
    if (getNumOutstandingRequests() > 0) {
        heartbeatTimeout = setTimeout(heartbeat, 30000);
    }
}

export const incHeartbeatCount = () => heartbeatCount++;

export function deleteOutstandingRequest(requestId: string) {
    delete outstandingRequests[requestId];
    delete requestSuspensions[requestId];
    if (Object.keys(outstandingRequests).length == 0) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = undefined;
    }
}

export function createRequestTemplate(
    kws: Kws,
    args: Args,
    cmd: string,
    liveObjectSpec?: LiveObjectSpec,
    suppressLoading?: boolean
) {
    // Get a JS map of non-transformed python kwargs. Ugh.
    // This will be remapped to JS manually below.
    const kwargs = PyDefUtils.keywordArrayToHashMap(kws);

    const requestId = generateUUID();
    const profile = profileStart("RPC Request");

    const mappingProfile = profile.append("Call mapping");

    // Extract what needs to be blobbed;
    const knownCapabilities: Capability[] = [];
    const knownLiveObjectMethods: KnownLiveObjectMethods = {};
    const knownLiveObjectInstances: KnownLiveObjectInstances = {};
    const blobContent: BlobContent[] = []; // array of arrays: [[{json: chunk header, data: DataView}...]]
    const callObjToSerialize = { type: "CALL", id: requestId, args, kwargs };
    modifyOutgoingServerCall?.(callObjToSerialize);
    if (requestReloadEnvOnNextCall) {
        callObjToSerialize.reload_env = true;
        requestReloadEnvOnNextCall = false;
    }

    const call = serialize(callObjToSerialize, requestId, {
        knownCapabilities,
        knownLiveObjectMethods,
        knownLiveObjectInstances,
        blobContent,
        liveObjectSpec,
        commandOrMethod: cmd,
    });

    diagnosticRequest({
        id: requestId,
        call: call.command || call.liveObjectCall.backend + ":" + call.liveObjectCall.method,
    });

    mappingProfile.end();

    if (!suppressLoading) {
        window.setLoading?.(true);
    }

    const deferred = defer();

    const request: OutstandingRequest = {
        id: requestId,
        media: {},
        deferred,
        suppressLoading,
        knownLiveObjectInstances,
        knownCapabilities,
        onerror(evt: any) {
            if (!suppressLoading) window.setLoading?.(false);
            deleteOutstandingRequest(requestId);
            console.error("Websocket connection failed", evt);
            const msg = `Connection to server failed (${(evt && (evt.code || evt.message || evt.type)) || "FAIL"})`;
            deferred.reject(PyDefUtils.pyCall(anvilServerMod["AppOfflineError"], [new pyStr(msg)]));
        },
        profile,
    };

    let realiseBlobsProfile: Profile | undefined;
    if (blobContent.length > 0) {
        realiseBlobsProfile = profile.append("Realise blobs");
    }

    const deferredCall = defer<ReturnType<typeof serialize>>();

    Promise.all(call.objects)
        .then((realizedObjects) => {
            realiseBlobsProfile?.end();
            call.objects = realizedObjects;
            console.debug(
                `RPC request: ${call.command ?? call.liveObjectCall.backend + ":" + call.liveObjectCall.method}`,
                call
            );
            deferredCall.resolve(call);
        })
        .catch((e) => {
            deferredCall.reject(e);
        });

    return [request, deferredCall.promise, blobContent] as const;
}

export async function waitForOutstandingRequests(sendProfile: Profile) {
    let waitingProfile;

    for (const { deferred } of Object.values(outstandingRequests)) {
        waitingProfile ??= sendProfile.append(
            `Waiting for ${getNumOutstandingRequests()} previous call(s) to complete`
        );
        try {
            await deferred.promise;
        } catch {
            // pass
        }
    }
    waitingProfile?.end();
}

const sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

async function trySend(
    jsonData: any,
    blobData?: DataView | null,
    profile?: Profile,
    outstandingRequest?: OutstandingRequest
) {
    const ws = await connect(profile);

    if (outstandingRequest) {
        outstandingRequest.ws = ws;
    }

    const w = profile?.append("Send to websocket");

    const p = w?.append("Send JSON Data");
    ws.send(JSON.stringify(jsonData));
    diagnosticData.nSent++;
    p?.end();

    if (blobData) {
        const q = w?.append("Send blob data");
        ws.send(blobData);
        q?.end();
    }

    await new Promise((resolve) => {
        const checkBuffer = () => {
            if (ws.bufferedAmount == 0) {
                w?.end();
                resolve(null);
            } else {
                //console.log("WebSocket still buffering.")
                // TODO - this should throw after a timeout of e.g. 60 secs
                setTimeout(checkBuffer, 1);
            }
        };
        setTimeout(checkBuffer, 1);
    });

    // const checkBuffer = async (timeout: number) => {
    //     const startTime = Date.now();

    //     while (ws.bufferedAmount > 0) {
    //         if (Date.now() - startTime >= timeout) {
    //             throw new Error("Timed out");
    //         }
    //         // Wait for 1 ms before checking again
    //         await sleep(1);
    //         //console.log("WebSocket still buffering.")
    //     }

    //     w?.end();
    // };

    // await checkBuffer(60000);
}

async function makeRequest(
    request: OutstandingRequest,
    call: ReturnType<typeof serialize>,
    blobContent: BlobContent[]
) {
    const { profile, id: requestId } = request;

    const sendProfile = profile.append("Send call");
    await waitForOutstandingRequests(sendProfile);
    outstandingRequests[requestId] = request;

    await trySend(call, null, sendProfile, request);

    sendProfile.end();

    if (!heartbeatTimeout) {
        heartbeatTimeout = setTimeout(heartbeat, 30000);
    }

    let blobProfile;

    for (const contentChunks of blobContent) {
        blobProfile ??= profile.append("Send blobs");
        for (const chunk of contentChunks) {
            await trySend(chunk.json, chunk.data, blobProfile, request);
        }
    }

    blobProfile?.end();
}

let executeCall = async (
    request: OutstandingRequest,
    serializedCallPromise: Promise<any>,
    blobContent: BlobContent[],
    suppressLoading: boolean
) => {
    const { id: requestId, deferred } = request;

    let call: Awaited<typeof serializedCallPromise>;
    try {
        call = await serializedCallPromise;
    } catch (e) {
        console.error(e);
        deleteOutstandingRequest(requestId);
        if (!suppressLoading) window.setLoading?.(false);
        deferred.reject(e);
        return;
    }
    try {
        await makeRequest(request, call, blobContent);
    } catch (e) {
        console.error(e);
        if (e instanceof WebsocketFallback) {
            console.log("Falling back to HTTP");
            executeCall = executeCallHttp;
            deleteOutstandingRequest(requestId);
            return executeCallHttp(request, serializedCallPromise, blobContent, suppressLoading);
        }
    }
};

export function doRpcCall(
    kws: Kws,
    args: Args,
    cmd: string,
    liveObjectSpec?: LiveObjectSpec,
    suppressLoading = globalSuppressLoading.value > 0,
    callExecuter?: typeof executeCall
) {
    const [request, serializedCallPromise, blobContent] = createRequestTemplate(
        kws,
        args,
        cmd,
        liveObjectSpec,
        suppressLoading
    );
    const { deferred } = request;
    callExecuter ??= executeCall;
    callExecuter(request, serializedCallPromise, blobContent, suppressLoading);
    const suspension = promiseToSuspension(deferred.promise);
    suspension.data.serverRequestId = request.id;
    return suspension;
}
