import {
    Kws,
    Suspension,
    buildPyClass,
    chainOrSuspend,
    checkBytes,
    checkString,
    copyKeywordsToNamedArgs,
    isTrue,
    pyAttributeError,
    pyBytes,
    pyCallOrSuspend,
    pyFunc,
    pyGetAttr,
    pyLen,
    pyList,
    pyNone,
    pyObject,
    pyRuntimeError,
    pyStr,
    pyTrue,
    pyTypeError,
    toJs,
    toPy,
    typeName,
} from "@Sk";
import { suspensionPromise } from "@runtime/PyDefUtils/suspension";
import * as b64 from "@runtime/lib/b64";
import { PyModMap, anvilServerMod, funcFastCall, kwsToObj, pyPropertyFromGetSet } from "@runtime/runner/py-util";

interface MediaInstance extends pyObject {}

interface URLMediaInstance extends MediaInstance {
    _url: string;
    _fetch?: Promise<{ data: string | ArrayBuffer | PromiseLike<ArrayBuffer>; contentType: string | null }>;
}

interface BlobMediaInstance extends MediaInstance {
    _data: Blob | Uint8Array | string;
    _contentType: string;
    _name?: string | pyObject;
}

interface LazyMediaSpec {
    id: string;
    key: string;
    manager: string;
    name?: string;
    "mime-type"?: string;
}

interface LazyMediaInstance extends MediaInstance {
    $anvil_isLazyMedia: boolean;
    _spec: LazyMediaSpec;
    _fetched?: pyObject | Suspension;
}

interface LazyMediaLike extends pyObject {
    $anvil_isLazyMedia: true;
    _spec: LazyMediaSpec;
}

type ByteStringConstructor = new (value: string | Uint8Array) => pyObject;
type ByteStringValue = string | Uint8Array;

function isLazyMediaLike(value: pyObject | LazyMediaSpec | null | undefined): value is LazyMediaLike {
    return (
        value != null &&
        "$anvil_isLazyMedia" in value &&
        (value as LazyMediaLike).$anvil_isLazyMedia === true &&
        "_spec" in value
    );
}

function isLazyMediaSpec(value: pyObject | LazyMediaSpec | null | undefined): value is LazyMediaSpec {
    if (value == null || typeof value !== "object") {
        return false;
    }
    const spec = value as Partial<LazyMediaSpec>;
    return !!(spec.id && spec.key && spec.manager);
}

export function createMediaClasses(pyModule: PyModMap) {
    const ByteString = (Sk.__future__.python3 ? pyBytes : pyStr) as ByteStringConstructor;
    const checkByteString = Sk.__future__.python3 ? checkBytes : checkString;
    const byteStringTypeError = Sk.__future__.python3
        ? "content must be a byte-string, not "
        : "content must be a string or byte-string, not ";

    function arrayBufferToBytesInternal(arrayBuffer: ArrayBuffer): ByteStringValue {
        if (Sk.__future__.python3) {
            return new Uint8Array(arrayBuffer);
        }

        // Since we're in Python 2, bytes are represented as binary strings.
        let binary = "";
        const bytes = new Uint8Array(arrayBuffer);
        const length = bytes.byteLength;
        for (let i = 0; i < length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return binary;
    }

    const Media = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            for (const prop of ["url", "content_type", "length", "name"]) {
                const str_get_prop = new pyStr("get_" + prop);
                $loc[prop] = pyPropertyFromGetSet<MediaInstance>(
                    (self) => pyCallOrSuspend(self.tp$getattr(str_get_prop)),
                    () => {
                        throw new pyAttributeError(
                            `Cannot change the ${prop} of a Media object; create a new Media object instead`
                        );
                    }
                );
            }

            // The following should be implemented by the child class
            $loc["get_content_type"] = new pyFunc((self: MediaInstance) => pyNone);
            $loc["get_name"] = new pyFunc((self: MediaInstance) => pyNone);
            $loc["get_bytes"] = new pyFunc((self: MediaInstance) => pyNone);
            $loc["get_url"] = new pyFunc((self: MediaInstance) => pyNone);

            const str_get_bytes = new pyStr("get_bytes");
            // By default, it's a hack!
            $loc["get_length"] = new pyFunc((self: MediaInstance) =>
                chainOrSuspend(pyCallOrSuspend(self.tp$getattr(str_get_bytes)), pyLen)
            );

            [
                /*!defAttr()!1*/ {
                    name: "content_type",
                    type: "string",
                    description: "The MIME type of this Media",
                },
                /*!defAttr()!1*/ {
                    name: "url",
                    type: "string",
                    description: "The URL where you can download this Media, or None if it is not downloadable",
                },
                /*!defAttr()!1*/ {
                    name: "length",
                    type: "number",
                    description: "The length of this Media, in bytes",
                },
                /*!defAttr()!1*/ {
                    name: "name",
                    type: "string",
                    description: "The file name associated with this Media, or None if it has no name",
                },
            ];

            /*!defMethod(_)!2*/ ("Get a binary string of the data represented by this Media object");
            ["get_bytes"];

            /*!defMethod(_)!2*/ ("Get a Media object's URL, or None if there isn't one associated with it.");
            ["get_url"];

            /*!defClass(anvil,Media)!*/
        },
        "Media",
        []
    );

    const URLMedia = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            /*!defMethod(_,url)!2*/ "Create a Media object representing the data at a specific URL. Caution: Getting data from URLs directly in your code will often fail for security reasons, or fail to handle binary data.";
            $loc["__init__"] = new pyFunc(function (self: URLMediaInstance, pyURL: pyObject) {
                self._url = toJs(pyURL) as string;
                return pyNone;
            });

            $loc["get_url"] = new pyFunc(function (self: URLMediaInstance) {
                return new pyStr(self._url);
            });

            // Returns a promise
            const doFetch = function (self: URLMediaInstance) {
                if (self._fetch) {
                    return self._fetch;
                }
                self._fetch = new Promise<{
                    data: string | ArrayBuffer | PromiseLike<ArrayBuffer>;
                    contentType: string | null;
                }>(function (resolve, reject) {
                    if (self._url.substring(0, 5) == "data:") {
                        // This is a dataURL. Decode it manually, because we won't be allowed to GET it.
                        const parts = self._url.split(";base64,");
                        const b64Str = parts[1];
                        const val = atob(b64Str);

                        resolve({ data: val, contentType: parts[0].substring(5) });
                    } else {
                        // TODO: Test this. If it works, #258 can be closed.
                        window.setLoading(true);
                        // NB JQuery "promises" are broken and not chainable; adapt directly
                        $.ajax({
                            url: self._url,
                            type: "GET",
                            dataType: "binary",
                            processData: false,
                        }).then(
                            function (r: Blob, ts: string, xhr: JQuery.jqXHR) {
                                window.setLoading(false);
                                resolve({
                                    data: r.arrayBuffer(),
                                    contentType: xhr.getResponseHeader("content-type"),
                                });
                            },
                            function (xhr: JQuery.jqXHR) {
                                window.setLoading(false);
                                let help = "(HTTP " + xhr.status + ")";
                                if (xhr.status === 0) {
                                    help = "(probably due to a cross-origin URL)";
                                }
                                reject(new pyRuntimeError("Failed to load media " + help + ": " + self._url));
                            }
                        );
                    }
                });
                return self._fetch;
            };

            $loc["get_content_type"] = new pyFunc(function (self: URLMediaInstance) {
                return suspensionPromise(function (resolve, reject) {
                    doFetch(self).then(function (r) {
                        resolve(new pyStr(r.contentType ?? ""));
                    }, reject);
                });
            });

            $loc["get_bytes"] = new pyFunc(function (self: URLMediaInstance) {
                return suspensionPromise(function (resolve, reject) {
                    doFetch(self)
                        .then(function (r) {
                            return r.data;
                        })
                        .then(function (arrayBufferOrStr) {
                            if (typeof arrayBufferOrStr === "string") {
                                resolve(new ByteString(arrayBufferOrStr));
                            } else {
                                resolve(new ByteString(arrayBufferToBytesInternal(arrayBufferOrStr)));
                            }
                        })
                        .catch((e) => {
                            console.error(e);
                            reject(e);
                        });
                });
            });

            $loc["get_name"] = new pyFunc(function (self: URLMediaInstance) {
                const names = ("" + self._url).replace(/\/+$/, "").split("/");
                if (names && names.length > 0) {
                    return new pyStr(names[names.length - 1]);
                } else {
                    return pyNone;
                }
            });

            /*!defClass(anvil,URLMedia,Media)!*/
        },
        "URLMedia",
        [Media]
    );

    const BlobMedia = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            /*!defMethod(_,content_type,content,[name=None])!2*/ "Create a Media object with the specified content_type (a string such as 'text/plain') and content (a binary string). Optionally specify a filename as well.";
            $loc["__init__"] = funcFastCall((args, kws) => {
                const [self, rawContentType, rawContent, name] = args as [
                    BlobMediaInstance,
                    pyObject | Blob | undefined,
                    pyObject | undefined,
                    pyObject | undefined,
                ];
                const kwargs = kwsToObj(kws);
                let contentType = rawContentType;
                let content = rawContent;
                contentType = contentType || kwargs["content_type"] || kwargs["contentType"];
                content = content || kwargs["content"];

                // Secret Javascript-only calling interface, takes a single Blob param
                // this is used by anvil.js.to_media
                if (contentType instanceof Blob) {
                    self._data = contentType;
                    self._contentType = self._data.type;
                    self._name = content;
                } else if (content === undefined) {
                    throw new pyTypeError("BlobMedia() takes two arguments (content_type and content)");
                } else {
                    if (!checkString(contentType)) {
                        throw new pyTypeError("content_type must be a string, not " + typeName(contentType));
                    }
                    if (!checkByteString(content)) {
                        throw new pyTypeError(byteStringTypeError + typeName(content));
                    }
                    self._contentType = toJs(contentType) as string;
                    self._data = toJs(content) as string | Uint8Array;
                }
                if ("name" in kwargs) {
                    self._name = kwargs["name"];
                } else if (name != undefined) {
                    self._name = name;
                }
                return pyNone;
            });

            $loc["get_url"] = new pyFunc(function (self: BlobMediaInstance, forceDataUrl?: pyObject) {
                if (!isTrue(forceDataUrl || false)) {
                    return pyNone;
                }

                let jsstr;
                if (self._data instanceof Blob) {
                    const data = self._data;
                    return suspensionPromise(function (resolve, reject) {
                        const fr = new FileReader();
                        fr.onloadend = function () {
                            resolve(new pyStr(String(fr.result)));
                        };
                        fr.readAsDataURL(data);
                    });
                } else if (self._data instanceof Uint8Array) {
                    jsstr = "";
                    const uint8 = self._data;
                    for (let i = 0; i < uint8.length; i++) {
                        jsstr += String.fromCharCode(uint8[i]);
                    }
                } else {
                    jsstr = self._data;
                }
                return new pyStr("data:" + self._contentType.replace(/;/g, "") + ";base64," + b64.base64EncStr(jsstr));
            });

            $loc["get_content_type"] = new pyFunc(function (self: BlobMediaInstance) {
                return new pyStr(self._contentType);
            });

            $loc["get_bytes"] = funcFastCall(([self]: [BlobMediaInstance]) => {
                if (self._data instanceof Blob) {
                    const data = self._data;
                    return suspensionPromise(function (resolve, reject) {
                        const fr = new FileReader();
                        fr.onerror = () => reject(fr.error);
                        if (fr.readAsArrayBuffer) {
                            fr.onload = () =>
                                resolve(new ByteString(arrayBufferToBytesInternal(fr.result as ArrayBuffer)));
                            fr.readAsArrayBuffer(data);
                        } else {
                            fr.onload = () => resolve(new ByteString(String(fr.result)));
                            fr.readAsBinaryString(data);
                        }
                    });
                } else {
                    return new ByteString(self._data as string | Uint8Array);
                }
            });

            $loc["get_name"] = new pyFunc(function (self: BlobMediaInstance) {
                if (self._name !== undefined) {
                    return new pyStr(self._name);
                } else {
                    return pyNone;
                }
            });
            /*!defClass(anvil,BlobMedia,Media)!*/
        },
        "BlobMedia",
        [Media]
    );

    const FileMedia = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            $loc["__init__"] = new pyFunc(function (self: BlobMediaInstance, fileObj: pyObject | File) {
                if (!(fileObj instanceof File)) {
                    throw new pyTypeError(
                        "You cannot construct a anvil.FileMedia yourself; it can only come from a File component"
                    );
                }

                self._data = fileObj;
                self._contentType = fileObj.type;

                self._name = fileObj.name;
                return pyNone;
            });
        },
        "FileMedia",
        [BlobMedia]
    );

    const LazyMedia = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            $loc["__init__"] = new pyFunc(function (self: LazyMediaInstance, lmSpec?: pyObject | LazyMediaSpec) {
                self.$anvil_isLazyMedia = true;
                if (isLazyMediaLike(lmSpec)) {
                    self._spec = lmSpec._spec;
                } else if (isLazyMediaSpec(lmSpec)) {
                    self._spec = lmSpec;
                } else {
                    throw new pyTypeError(
                        "You cannot construct a anvil.LazyMedia from Python. Use anvil.BlobMedia instead."
                    );
                }
                return pyNone;
            });

            const doFetch = function (self: LazyMediaInstance) {
                const doRpc = anvilServerMod["__anvil$doRpcCall"] as unknown as (
                    pyKwargs: Kws,
                    args: pyObject,
                    methodName: string
                ) => pyObject | Suspension;
                if (self._fetched) {
                    return self._fetched;
                }

                const pyKwargs: Kws = [];
                const args = new pyList([toPy(self._spec)]);

                return chainOrSuspend(doRpc(pyKwargs, args, "anvil.private.fetch_lazy_media"), function (bm) {
                    // bm will be a BlobMedia
                    self._fetched = bm;
                    return bm;
                });
            };

            $loc["get_bytes"] = new pyFunc(function (self: LazyMediaInstance) {
                return chainOrSuspend(doFetch(self), function (bm) {
                    return pyCallOrSuspend(pyGetAttr(bm, new pyStr("get_bytes")));
                });
            });

            $loc["get_content_type"] = new pyFunc(function (self: LazyMediaInstance) {
                if (self._spec["mime-type"]) {
                    return toPy(self._spec["mime-type"]);
                } else {
                    return chainOrSuspend(doFetch(self), function (bm) {
                        return pyCallOrSuspend(pyGetAttr(bm, new pyStr("get_content_type")));
                    });
                }
            });

            $loc["get_url"] = funcFastCall(function (args, kws) {
                const [self, pyDownload] = copyKeywordsToNamedArgs("get_url", [null, "download"], args, kws, [
                    pyTrue,
                ]) as [LazyMediaInstance, pyObject];
                const appOrigin = toJs(anvilServerMod["app_origin"]); //.replace(/[^\/]+\/?$/, "");
                const isDownload = isTrue(pyDownload);
                return new pyStr(
                    appOrigin +
                        "/_/lm/" +
                        encodeURIComponent(self._spec.manager) +
                        "/" +
                        encodeURIComponent(self._spec.key) +
                        "/" +
                        encodeURIComponent(self._spec.id) +
                        "/" +
                        encodeURIComponent(self._spec.name || "") +
                        "?_anvil_session=" +
                        window.anvilSessionToken +
                        (isDownload ? "" : "&nodl=1")
                );
            });

            $loc["get_name"] = new pyFunc(function (self: LazyMediaInstance) {
                return self._spec.name !== undefined ? new pyStr(self._spec.name) : pyNone;
            });
        },
        "LazyMedia",
        [Media]
    );

    const createLazyMedia = funcFastCall((args, kwargs) => {
        const callArgs: pyObject[] = [new pyStr("anvil.private.mk_LazyMedia"), ...args];
        return pyCallOrSuspend(anvilServerMod.call, callArgs, kwargs);
    });

    return {
        Media,
        URLMedia,
        DataMedia: BlobMedia,
        BlobMedia,
        FileMedia,
        LazyMedia,
        createLazyMedia,
    };
}
