module.exports = function () {
    const PyDefUtils = require("PyDefUtils");

    const mediaMod = {
        __name__: new Sk.builtin.str("media"),
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
                Sk.misceval.chain(PyDefUtils.getUrlForMedia(media), (urlHandle) => {
                    let pyFilename = media.tp$getattr(new Sk.builtin.str("name"));
                    if (!pyFilename || !urlHandle.getUrl()) {
                        throw new Sk.builtin.TypeError("Argument to anvil.media.print() must be a Media object");
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

                    return Sk.builtin.none.none$;
                }),
            $flags: { OneArg: true },
            $doc: "Print the given Media Object immediately in the user's browser.",
            $textsig: "($module, /, media_object)",
        },
        /*!defBuiltinFunction(anvil.media,!,media)!1*/
        download: {
            $name: "download",
            $meth: (media) =>
                Sk.misceval.chain(PyDefUtils.getUrlForMedia(media), (urlHandle) => {
                    let pyFilename = media.tp$getattr(new Sk.builtin.str("name"));
                    if (!pyFilename || !urlHandle.getUrl()) {
                        throw new Sk.builtin.TypeError(
                            "Argument to anvil.download() must be a Media object, not " + Sk.abstr.typeName(media)
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


    // Alias the download() function into the root `anvil` module for backwards compatibility.
    /*!defFunction(anvil,!,media)!2*/ "Download the given Media Object immediately in the user's browser."["download"];
    const anvilModule = PyDefUtils.getModule("anvil");
    anvilModule.tp$setattr(new Sk.builtin.str("download"), mediaMod["download"]);

    return mediaMod;
};
