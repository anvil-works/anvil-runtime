const { anvilMod } = require("@runtime/runner/py-util");

module.exports = function () {
    const PyDefUtils = require("PyDefUtils");

    const {
        builtin: {
            bool: pyBool,
            none: { none$: pyNone },
            str: pyStr,
            TypeError: pyTypeError,
            checkNone,
            isinstance: isPyInstance,
        },
        abstr: { typeName },
        ffi: { toPy },
        misceval: { isTrue, chain: chainOrSuspend },
    } = Sk;

    const mediaMod = {
        __name__: new pyStr("media"),
        TempFile: new Sk.builtin.func(() => {
            throw new Sk.builtin.RuntimeError("Cannot create files from Media objects on the client.");
        }),
        from_file: new Sk.builtin.func(() => {
            throw new Sk.builtin.RuntimeError("Cannot create Media objects from files on the client.");
        }),
    };

    Sk.abstr.setUpModuleMethods("media", mediaMod, {
        /*!defBuiltinFunction(anvil.media,!,media)!1*/
        print_media: {
            $name: "print_media",
            $meth: (media) =>
                chainOrSuspend(PyDefUtils.getUrlForMedia(media), (urlHandle) => {
                    let pyFilename = media.tp$getattr(new pyStr("name"));
                    if (!pyFilename || !urlHandle.getUrl()) {
                        throw new pyTypeError("Argument to anvil.media.print() must be a Media object");
                    }
                    const a = document.createElement("a");
                    document.body.appendChild(a);
                    a.href = "javascript:void(0)";
                    a.onclick = () => {
                        let w = window.open(urlHandle.getUrl());
                        w.onload = () => {
                            w.print();
                            setTimeout(() => {
                                urlHandle.release();
                                document.body.removeChild(a);
                            }, 0);
                        };
                    };

                    a.click();

                    return pyNone;
                }),
            $flags: { OneArg: true },
            $doc: "Print the given Media Object immediately in the user's browser.",
            $textsig: "($module, /, media_object)",
        },
        /*!defBuiltinFunction(anvil.media,!,media)!1*/
        download: {
            $name: "download",
            $meth: (media) =>
                chainOrSuspend(PyDefUtils.getUrlForMedia(media), (urlHandle) => {
                    let pyFilename = media.tp$getattr(new pyStr("name"));
                    if (!pyFilename || !urlHandle.getUrl()) {
                        throw new pyTypeError(
                            "Argument to anvil.download() must be a Media object, not " + typeName(media)
                        );
                    }
                    let filename = pyFilename?.toString() || "untitled";
                    if (window.navigator.msSaveOrOpenBlob && urlHandle.blob) {
                        window.navigator.msSaveOrOpenBlob(urlHandle.blob, filename);
                        urlHandle.release();
                    } else {
                        const a = document.createElement("a");
                        document.body.appendChild(a);
                        a.href = urlHandle.getUrl();
                        a.download = filename;
                        a.click();
                        setTimeout(() => {
                            urlHandle.release();
                            document.body.removeChild(a);
                        }, 0);
                    }

                    return Sk.builtin.none.none$;
                }),
            $flags: { OneArg: true },
            $doc: "Download the given Media Object immediately in the user's browser.",
            $textsig: "($module, /, media_object)",
        },
    });

    /*!defMethod(,media,download=True)!2*/ ("Creates a temporary client-side URL for a Media object, even if the media has no permanent URL. This URL should be revoked when you are finished with it. If you use TempUrl as a context manager ('with TempUrl(media) as url:'), this happens automatically; if you instantiate it manually you must call 'revoke()' on the instance.\n\nThe download argument only affects LazyMedia objects");
    ["__init__"];
    mediaMod["TempUrl"] = Sk.abstr.buildNativeClass("anvil.media.TempUrl", {
        constructor: function TempUrl() {},
        slots: {
            tp$init(args, kws) {
                Sk.abstr.checkOneArg("TempUrl", args);
                const [media] = args;
                if (!isTrue(isPyInstance(media, AnvilMedia))) {
                    throw new pyTypeError(`expected a Media object, got ${typeName(media)}`);
                }
                this.handle = PyDefUtils.getUrlForMedia(media, kws);
            },
        },
        methods: {
            /*!defBuiltinMethod(url)!1*/
            __enter__: {
                $name: "__enter__",
                $meth() {
                    return toPy(this.handle.getUrl());
                },
                $flags: { NoArgs: true },
                $doc: "get the url using a 'with' block.",
            },
            /*!defBuiltinMethod(_)!1*/
            __exit__: {
                $name: "__exit__",
                $meth(excType, excValue, excTraceBack) {
                    this.handle.release();
                    return new pyBool(checkNone(excType));
                },
                $flags: { MinArgs: 3, MaxArgs: 3 },
                $doc: "Revoke a url when exiting a 'with' block",
            },
            /*!defBuiltinMethod(_)!1*/
            revoke: {
                $name: "revoke",
                $meth() {
                    return toPy(this.handle.release());
                },
                $flags: { NoArgs: true },
                $doc: "revoke a url from a media object",
            },
        },
        getsets: {
            url: {
                $get() {
                    return toPy(this.handle.getUrl());
                },
            },
        },
    });
    /*!defAttr()!1*/ ({
        name: "url",
        type: "string",
        description: "the temporary url",
    });
    /*!defClass(anvil.media,!TempUrl)!*/

    // Alias the download() function into the root `anvil` module for backwards compatibility.
    /*!defFunction(anvil,!,media)!2*/ "Download the given Media Object immediately in the user's browser."["download"];
    anvilMod["download"] = mediaMod["download"];

    const AnvilMedia = anvilMod["Media"];

    return mediaMod;
};
