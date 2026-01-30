// jQuery 3 migration.

// CLICK needed by old Dashboard template
let oldJQueryFns = ["click"];

for (let f of oldJQueryFns) {
    $.fn[f] = function (...args) {
        return this.on(f, ...args);
    };
}

// End of migration stuff

// Shamelessly copied from http://www.henryalgus.com/reading-binary-files-using-jquery-ajax/

// use this transport for "binary" data type
$.ajaxTransport("+binary", function (options, originalOptions, jqXHR) {
    // check for conditions and support for blob / arraybuffer response type
    if (
        window.FormData &&
        ((options.dataType && options.dataType == "binary") ||
            (options.data &&
                ((window.ArrayBuffer && options.data instanceof ArrayBuffer) ||
                    (window.Blob && options.data instanceof Blob))))
    ) {
        return {
            // create new XMLHttpRequest
            send: function (headers, callback) {
                // setup all variables
                var xhr = new XMLHttpRequest(),
                    url = options.url,
                    type = options.type,
                    async = options.async || true,
                    // blob or arraybuffer. Default is blob
                    dataType = options.responseType || "blob",
                    data = options.data || null,
                    username = options.username || null,
                    password = options.password || null;

                xhr.addEventListener("load", function () {
                    var data = {};
                    data[options.dataType] = xhr.response;
                    // make callback and send data
                    callback(xhr.status, xhr.statusText, data, xhr.getAllResponseHeaders());
                });

                xhr.open(type, url, async, username, password);

                // setup custom headers
                for (var i in headers) {
                    xhr.setRequestHeader(i, headers[i]);
                }

                xhr.responseType = dataType;
                xhr.send(data);
            },
            abort: function () {
                jqXHR.abort();
            },
        };
    }
});
