import { Args, Kws } from "@Sk";
import { globalSuppressLoading } from "@runtime/utils";
import { handleMessage } from "./handlers";
import {
    OutstandingRequest,
    deleteOutstandingRequest,
    doRpcCall,
    outstandingRequests,
    waitForOutstandingRequests,
} from "./rpc";
import { serialize } from "./serialize";
import { BlobContent, LiveObjectSpec } from "./types";

function getBoundary(response: Response): string | null {
    const contentTypeHeader = response.headers.get("Content-Type");
    if (!contentTypeHeader) {
        return null;
    }

    const contentTypeParts = contentTypeHeader.split(";").map((part) => part.trim());
    if (contentTypeParts.length < 2 || !contentTypeParts[0].startsWith("multipart")) {
        return null;
    }

    const boundaryPart = contentTypeParts.find((part) => part.startsWith("boundary="));
    if (!boundaryPart) {
        return null;
    }

    return boundaryPart.slice("boundary=".length);
}

const encoder = new TextEncoder();

async function processResponse(response: Response, boundary: string) {
    const buffer = await response.text();
    boundary = "--" + boundary;

    const lines = buffer.split("\r\n");

    const data: any[] = [];
    let isHeader = false;
    let isBody = false;
    let contentType: null | string = null;
    for (const line of lines) {
        if (line === boundary) {
            isHeader = true;
            isBody = false;
            contentType = null;
            continue;
        }
        if (!line && isHeader) {
            isHeader = false;
            isBody = true;
            continue;
        }
        if (isBody) {
            if (contentType === "application/json") {
                data.push(line);
            } else if (contentType === "application/octet-stream") {
                data.push(encoder.encode(line).buffer);
            }
            isBody = false;
            isHeader = false;
            continue;
        }
        if (isHeader) {
            if (line.startsWith("Content-Type: ")) {
                contentType = line.slice("Content-Type: ".length);
            }
        }
    }
    return data;
}

async function trySend(jsonData: any, blobData: BlobContent[] = []) {
    const formData = new FormData();
    formData.append("json-data", JSON.stringify(jsonData));

    blobData.forEach((contentChunks: { json: any; data: DataView }[], i) => {
        contentChunks.forEach(({ json, data }, j) => {
            formData.append(`chunk-json-${i}-${j}`, JSON.stringify(json));
            const chunkBlob = new Blob([data], { type: "application/octet-stream" });
            formData.append(`chunk-data-${i}-${j}`, chunkBlob, `chunk-${i}-${j}.bin`);
        });
    });

    const resp = await fetch(`${window.anvilAppOrigin}/_/server-call-http?_anvil_session=${window.anvilSessionToken}`, {
        method: "POST",
        body: formData,
    });

    if (!resp.ok) {
        throw new Error(resp.statusText);
    }
    const boundary = getBoundary(resp);
    if (!boundary) {
        throw new Error("unexpected return from server");
    }
    const rv = await processResponse(resp, boundary);
    return rv;
}

export async function makeRequest(
    request: OutstandingRequest,
    call: ReturnType<typeof serialize>,
    blobContent: BlobContent[]
) {
    const { profile, id: requestId } = request;
    const sendProfile = profile.append("Send call");
    await waitForOutstandingRequests(sendProfile);
    outstandingRequests[requestId] = request;
    const rv = await trySend(call, blobContent);
    sendProfile.end();
    return rv;
}

export async function executeCallHttp(
    request: OutstandingRequest,
    serializedCallPromise: Promise<any>,
    blobContent: BlobContent[],
    suppressLoading: boolean
) {
    const { id: requestId, deferred } = request;
    try {
        const call = await serializedCallPromise;
        const data = await makeRequest(request, call, blobContent);
        for (const d of data) {
            handleMessage(d);
        }
    } catch (e) {
        console.error(e);
        deleteOutstandingRequest(requestId);
        if (!suppressLoading) window.setLoading(false);
        deferred.reject(e);
    }
}

export function doHttpCall(
    kws: Kws,
    args: Args,
    cmd: string,
    liveObjectSpec?: LiveObjectSpec,
    suppressLoading = globalSuppressLoading.value > 0
) {
    return doRpcCall(kws, args, cmd, liveObjectSpec, suppressLoading, executeCallHttp);
}
