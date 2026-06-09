// jQuery 3 migration.

// CLICK needed by old Dashboard template
let oldJQueryFns = ["click"];

for (let f of oldJQueryFns) {
    ($.fn as unknown as Record<string, (...args: unknown[]) => JQuery>)[f] = function (...args: unknown[]) {
        return this.on(f, ...args);
    };
}

// End of migration stuff

// Shamelessly copied from http://www.henryalgus.com/reading-binary-files-using-jquery-ajax/

interface BinaryAjaxOptions extends JQuery.AjaxSettings {
    responseType?: XMLHttpRequestResponseType;
    username?: string;
    password?: string;
}

// use this transport for "binary" data type
$.ajaxTransport("+binary", function (options, originalOptions, jqXHR) {
    const binaryOptions = options as BinaryAjaxOptions;
    // check for conditions and support for blob / arraybuffer response type
    if (
        window.FormData &&
        ((binaryOptions.dataType && binaryOptions.dataType == "binary") ||
            (binaryOptions.data &&
                ((window.ArrayBuffer && binaryOptions.data instanceof ArrayBuffer) ||
                    (window.Blob && binaryOptions.data instanceof Blob))))
    ) {
        return {
            // create new XMLHttpRequest
            send: function (headers: JQuery.PlainObject, callback: JQuery.Transport.SuccessCallback) {
                // setup all variables
                var xhr = new XMLHttpRequest(),
                    url = binaryOptions.url ?? "",
                    type = binaryOptions.type ?? "GET",
                    async = binaryOptions.async || true,
                    // blob or arraybuffer. Default is blob
                    dataType = binaryOptions.responseType || "blob",
                    data = binaryOptions.data || null,
                    username = binaryOptions.username || null,
                    password = binaryOptions.password || null;

                xhr.addEventListener("load", function () {
                    const data: Record<string, unknown> = {};
                    data[binaryOptions.dataType ?? "binary"] = xhr.response;
                    // make callback and send data
                    callback(xhr.status, xhr.statusText as JQuery.Ajax.TextStatus, data, xhr.getAllResponseHeaders());
                });

                xhr.open(type, url, async, username, password);

                // setup custom headers
                for (var i in headers) {
                    xhr.setRequestHeader(i, headers[i]);
                }

                xhr.responseType = dataType;
                xhr.send(data as Document | XMLHttpRequestBodyInit | null);
            },
            abort: function () {
                jqXHR.abort();
            },
        } as JQuery.Transport;
    }
});
