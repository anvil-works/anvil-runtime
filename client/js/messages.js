"use strict";

window.messages = window.messages || {};

$(function() {
    window.addEventListener("message", async function(e) {

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

        var fn = window.messages[e.data.fn];
        var rv;
        try {
            if (fn) {
                rv = {result: await fn.call(window.messages, e.data.args)};
            } else {
                console.debug("Message not recognised:", e.data);
                //rv = {error: "Message '"+e.data.fn+"' not recognised"};
            }
        } catch (err) {
            console.error(err, err.stack || "(no stack trace)");
            if (err instanceof Sk.builtin.BaseException) {
                rv = {fn: "pythonError", filename: err.filename, line: err.lineno,
                      col: err.colno, type: err.tp$name, msg: Sk.ffi.remapToJs(err.args).join("; ")};
            } else {
                rv = {error: ""+err};
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
    })
    window.parent.postMessage({fn: "ready"},"*");
    window.opener?.postMessage({fn: "ready"},"*");
});

