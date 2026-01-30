export function getUrlForMedia(pyMedia, kws = []) {
    const wrapBlob = (blob) => {
        let url = null;
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

    if (!pyMedia || pyMedia === Sk.builtin.none.none$) {
        return { getUrl: () => "", release: () => {} };
    }

    if (pyMedia._data instanceof Blob) {
        // It's already a BlobMedia; we can do this directly.
        return wrapBlob(pyMedia._data);
    }

    // Does it already have a permanent URL?
    const getMediaUrl = Sk.abstr.gattr(pyMedia, new Sk.builtin.str("get_url"));

    return Sk.misceval.chain(Sk.misceval.callsimOrSuspendArray(getMediaUrl, [], kws), (pyUrl) => {
        if (pyUrl instanceof Sk.builtin.str) {
            return { getUrl: () => pyUrl.toString(), release() {} };
        } else {
            let contentType;

            // No. Ick. We pull the content out as a binary JS string, then turn it
            // into a Blob.

            return Sk.misceval.chain(
                Sk.abstr.gattr(pyMedia, new Sk.builtin.str("content_type"), true),
                (ct) => {
                    contentType = ct;
                    return Sk.misceval.callsimOrSuspend(Sk.abstr.gattr(pyMedia, new Sk.builtin.str("get_bytes")));
                },
                (c) => {
                    const bytes = getUint8ArrayFromPyBytes(c);
                    const blob = new Blob([bytes], { type: contentType.toString() });
                    return wrapBlob(blob);
                }
            );
        }
    });
}

export function getUint8ArrayFromPyBytes(bytesOrStr) {
    if (Sk.__future__.python3) {
        return new Uint8Array(bytesOrStr.v);
    } else {
        const bytes = new Uint8Array(bytesOrStr.v.length);
        for (var i = 0; i < bytesOrStr.v.length; i++) {
            bytes[i] = bytesOrStr.v.charCodeAt(i);
        }
        return bytes;
    }
}
