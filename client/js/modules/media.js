module.exports = function() {

    var pyMod = {"__name__": new Sk.builtin.str("http")};
    var PyDefUtils = require("PyDefUtils");

    pyMod["TempFile"] = new Sk.builtin.func(() => {
        throw new Sk.builtin.Exception("Cannot create files from Media objects on the client.");
    });

    pyMod["from_file"] = new Sk.builtin.func(f => {
        throw new Sk.builtin.Exception("Cannot create Media objects from files on the client.");
    });

    /*!defFunction(anvil.media,!,media)!2*/ "Print the given Media Object immediately in the user's browser."
    pyMod["print_media"] = new Sk.builtin.func(media => {

        return Sk.misceval.chain(Sk.misceval.callsimOrSuspend(PyDefUtils.getUrlForMedia, media),
            urlHandle => {
                let pyFilename = media.tp$getattr(new Sk.builtin.str("name"));
                if (!pyFilename || !urlHandle.getUrl()) {
                    throw new Sk.builtin.Exception("Argument to anvil.media.print() must be a Media object");
                }
                let filename = pyFilename.v || "untitled";

                const a = document.createElement('a');
                document.body.appendChild(a);
                a.href = "javascript:void(0)";
                a.onclick = () => {
                    let w = window.open(urlHandle.getUrl());
                    w.onload = () => {
                        w.print();
                        setTimeout(() => {
                            urlHandle.release();
                            document.body.removeChild(a);
                        }, 0)
                    };
                }

                a.click();

                return Sk.builtin.none.none$;
            });
    })

    /*!defFunction(anvil.media,!,media)!2*/ "Download the given Media Object immediately in the user's browser."
    pyMod["download"] = new Sk.builtin.func(media => {

        return Sk.misceval.chain(Sk.misceval.callsimOrSuspend(PyDefUtils.getUrlForMedia, media),
            urlHandle => {
                let pyFilename = media.tp$getattr(new Sk.builtin.str("name"));
                if (!pyFilename || !urlHandle.getUrl()) {
                    throw new Sk.builtin.Exception("Argument to anvil.download() must be a Media object");
                }
                let filename = pyFilename.v || "untitled";
                if (window.navigator.msSaveOrOpenBlob && urlHandle.blob) {
                    window.navigator.msSaveOrOpenBlob(urlHandle.blob, filename);
                    urlHandle.release();
                } else {
                    const a = document.createElement('a');
                    document.body.appendChild(a);
                    a.href = urlHandle.getUrl();
                    a.download = filename;
                    a.click();
                    setTimeout(() => {
                        urlHandle.release();
                        document.body.removeChild(a);
                    }, 0)
                }

                return Sk.builtin.none.none$;
            });
    })

    // Alias the download() function into the root `anvil` module for backwards compatibility.
    /*!defFunction(anvil,!,media)!2*/ "Download the given Media Object immediately in the user's browser." ["download"]
    let anvilModule = PyDefUtils.getModule("anvil");
    anvilModule.tp$setattr(new Sk.builtin.str("download"), pyMod["download"]);

    return pyMod;
}
