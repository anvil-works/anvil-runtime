import type { Kws, pyBytes, pyNoneType, pyObject, pyStr } from "@Sk";
import { pyStr as PyStr, chainOrSuspend, pyCallOrSuspend, pyGetAttr, pyNone } from "@Sk";

interface PyMedia extends pyObject {
    _data?: Blob;
}

interface MediaUrl {
    blob?: Blob;
    getUrl(): string;
    release(): void;
}

export function getUrlForMedia(pyMedia: PyMedia | pyNoneType | undefined | null, kws: Kws = []) {
    const wrapBlob = (blob: Blob): MediaUrl => {
        let url: string | null = null;
        return {
            getUrl() {
                if (url === null) {
                    url = window.URL.createObjectURL(blob);
                }
                return url;
            },
            release() {
                if (url !== null) {
                    window.URL.revokeObjectURL(url);
                    url = null;
                }
            },
            blob,
        };
    };

    if (!pyMedia || pyMedia === pyNone) {
        return { getUrl: () => "", release: () => {} };
    }

    if (pyMedia._data instanceof Blob) {
        // It's already a BlobMedia; we can do this directly.
        return wrapBlob(pyMedia._data);
    }

    // Does it already have a permanent URL?
    const getMediaUrl = pyGetAttr(pyMedia, new PyStr("get_url"));

    return chainOrSuspend(pyCallOrSuspend(getMediaUrl, [], kws), (pyUrl) => {
        if (pyUrl instanceof PyStr) {
            return { getUrl: () => pyUrl.toString(), release() {} };
        } else {
            let contentType: pyStr;

            // No. Ick. We pull the content out as a binary JS string, then turn it
            // into a Blob.

            return chainOrSuspend(
                pyGetAttr(pyMedia, new PyStr("content_type"), true),
                (ct: pyStr) => {
                    contentType = ct;
                    return pyCallOrSuspend(pyGetAttr(pyMedia, new PyStr("get_bytes")));
                },
                (c: pyBytes | pyStr) => {
                    const bytes = getUint8ArrayFromPyBytes(c);
                    const blob = new Blob([bytes], { type: contentType.toString() });
                    return wrapBlob(blob);
                }
            );
        }
    });
}

export function getUint8ArrayFromPyBytes(bytesOrStr: pyBytes | pyStr) {
    if (Sk.__future__.python3) {
        return new Uint8Array(bytesOrStr.v as Uint8Array);
    } else {
        const value = bytesOrStr.v as string;
        const bytes = new Uint8Array(value.length);
        for (var i = 0; i < value.length; i++) {
            bytes[i] = value.charCodeAt(i);
        }
        return bytes;
    }
}
