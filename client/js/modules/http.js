"use strict";

import { globalSuppressLoading } from "../utils";
import { anvilMod, anvilServerMod } from "@runtime/runner/py-util";

/*#
id: http_module
docs_url: /docs/http-apis/making-http-requests
title: HTTP Module
description: |
  ```python
  import anvil.http
  ```

  The HTTP module allows you to make standard HTTP requests from your Anvil app. It is available for both client code and server code, for both free and paid users.

  Begin by importing the `anvil.http` module.

  ```python
  ## A minimal request includes only the 'url' parameter

  resp = anvil.http.request("https://api.mysite.com/foo")

  ## We may also specify method, data and headers

  resp = anvil.http.request(url="https://api.mysite.com/foo",
                      method="POST",
                      data="Data to post",
                      headers= {
                        "Authentication": "my-access-key",
                      })
  print "Response MIME type: " + resp.content_type
  ```
  
  Once you have imported the `anvil.http` module, you make web requests using the `anvil.http.request` function. This function can take several named arguments:

  \* `url` (_required_) - The URL to request. This should include the protocol (e.g. `http://`).
  \* `method` - The HTTP method to use, as a string. Defaults to `GET`, but other valid methods include `POST`, `PUT`, `DELETE`, etc.
  \* `json` - Is this a JSON request? If `True`, JSON-encode the `data` parameter (if present), set the `Content-Type` header to `application/json` (unless it is already set), and return a JSON-decoded object rather than `Media`.
  \* `data` - What to place in the body of the HTTP request. This would normally only be used in `PUT` and `POST` requests.
    \* If `json` is set to `True`, it will be JSON-encoded before sending. Otherwise:
    \* If `data` is string, it will be used as-is.
    \* If `data` is a `dict`, it is transformed into a URL-encoded form submission (`application/x-www-form-urlencoded`).
  \* `headers` - A dict of headers to include in the request. This is commonly used to pass authentication details to remote APIs.
  \* `username` - A username to use with basic HTTP authentication
  \* `password` - A password to use with basic HTTP authentication

  ```python
  resp = anvil.http.request("http://ip.jsontest.com", json=True)
  print "My IP address is %s" % resp["ip"]
  ```

  If the HTTP status code is successful (200-299), the `anvil.http.request` function returns the response body of the request.
  This will be a `Media` object, unless the `json` parameter is set to `True`, in which case a JSON-decoded object will be returned.

  ```python
  # This code will print "Error 404":
  try:
    anvil.http.request("https://anvil.works/404")
  except anvil.http.HttpError as e:
    print "Error %d" % e.status
  ```

  If the HTTP status code is an error code, an `anvil.http.HttpError` will be raised. `HttpError` has two attributes:
  \* `status` - The HTTP status code (a number)
  \* `content` - The response body (JSON-decoded as above if possible, or a `Media` object if JSON decoding has failed)


  ```python
  # Prints "Hello%20there"
  print anvil.http.url_encode("Hello there")

  # Prints "Hello there"
  print anvil.http.url_decode("Hello%20there")
  ```
  The HTTP module also contains functions for URL-encoding and URL-decoding strings. This is useful when constructing
  links to other sites, or URL-encoding [URL hash parameters](#anvil_module) in an Anvil app.
includes: [http_module_browser_restrictions]
*/
/*#
id: http_module_browser_restrictions
docs_url: /docs/http-apis/making-http-requests#browser-restrictions
title: Browser HTTP restrictions
description: |
  Web browsers restrict the HTTP requests you can make from form code. When the web browser disallows a request, an `HttpError` is raised with a `status` of `0`. The easiest solution is to make your request from a [server module](#server_modules) instead.

  A client-side `HttpError` with status `0` is usually for one of three reasons:

  1. The URL is inaccessible (cannot connect to host).

  2. You're requesting an unencrypted (`http://`) URL. All Anvil apps are served over encrypted links (HTTPS), so the browser does not allow unencrypted requests from client-side code.

  3. The URL doesn't obey the cross-origin rules. (It needs to respond to an OPTIONS request, have the right CORS headers, etc.)

  There are two possible ways to remedy this error:

  1. Make the URL behave correctly. (Make sure it's accessible, serve it over HTTPS, give it the right CORS headers, and so on. This will require some expertise with web serving, and requires you to control the URL you are requesting. You may need to open up your browser's developer tools to work out precisely what the problem is.)

  2. Make the request from a server module instead. Server modules don't run in the web browser, so they don't have any of the browser's limitations.
*/
module.exports = function () {
    const {
        builtin: {
            str: pyStr,
            Exception: pyException,
            ValueError: pyValueError,
            TypeError: pyTypeError,
            func: pyFunc,
            checkString,
            pyCheckArgs,
            pyCheckType,
            bytes: pyBytes,
            none: { none$: pyNone },
        },
        abstr: { sattr: pySetAttr },
        ffi: { toPy, toJs },
        misceval: { buildClass, promiseToSuspension, callsimArray: pyCall },
    } = Sk;

    const pyMod = { __name__: new pyStr("http") };
    const PyDefUtils = require("PyDefUtils");

    pyMod["url_encode"] = pyMod["encode_uri_component"] = new pyFunc(function(c) {
        pyCheckArgs("url_encode", arguments, 1, 1);
        pyCheckType("url_encode", "string_to_encode", checkString(c));
        return toPy(encodeURIComponent(toJs(c)));
    });

    pyMod["UrlEncodingError"] = buildClass(pyMod, ($gbl, $loc) => {}, "UrlEncodingError", [pyException]);
    pyCall(anvilServerMod["_register_exception_type"], [
        new pyStr("anvil.http.UrlEncodingError"),
        pyMod["UrlEncodingError"],
    ]);

    pyMod["url_decode"] = new pyFunc(function(s) {
        pyCheckArgs("url_decode", arguments, 1, 1);
        pyCheckType("url_decode", "string_to_decode", checkString(s));
        try {
            return toPy(decodeURIComponent(toJs(s)));
        } catch (_e) {
            throw pyCall(pyMod["UrlEncodingError"]);
        }
    });

    pyMod["json_stringify"] = new pyFunc((obj) => toPy(JSON.stringify(toJs(obj))));

    pyMod["b64_encode"] = new pyFunc((s) => toPy(btoa(toJs(s))));

    pyMod["b64_decode"] = new pyFunc((s) => toPy(atob(toJs(s))));

    const ExceptionInit = pyException.tp$getattr(pyStr.$init);

    pyMod["HttpError"] = buildClass(pyMod, ($gbl, $loc) => {
        $loc["__init__"] = new pyFunc(function init(self, pyStatus, pyContent, pyMessage) {
            pyStatus ??= pyNone;
            pyContent ??= pyNone;
            pyMessage ??= pyNone;
            pySetAttr(self, new pyStr("status"), pyStatus);
            pySetAttr(self, new pyStr("content"), pyContent);
            if ((pyMessage === pyNone || pyMessage === pyStr.$empty) && pyStatus !== pyNone) {
                pyMessage = toPy("HTTP error " + pyStatus.toString());
            }
            return pyCall(ExceptionInit, [self, pyMessage]);
        });
        }, "HttpError", [pyException]);

    function pyGetResponse(xhr, json, fail=true) {
        const r = xhr.response;
        if (!(r instanceof ArrayBuffer)) {
            return pyNone;
        }
        let bytes = new pyBytes(new Uint8Array(r));
        if (json) {
            const decode = bytes.tp$getattr(new pyStr("decode"));
            const jsstr = pyCall(decode).toString();
            let json = jsstr;
            try {
                json = JSON.parse(jsstr);
            } catch (e) {
                if (fail) {
                    throw new pyValueError("Returned data is not valid JSON");
                }
            }
            return toPy(json);
        } else {
            const contentType = xhr.getResponseHeader("content-type") || "";
            if (!Sk.__future__.python3) {
                bytes = new pyStr(bytes.$jsstr());
            }
            return pyCall(anvilMod["BlobMedia"], [new pyStr(contentType), bytes]);
        }
    }

    function getContentType(headers) {
        for (let k in headers) {
            if (k.toLowerCase() === "content-type") {
                return headers[k];
            }
        }
    }

    function request(kws, pyUrl) {
        if (pyUrl) {
            kws.url = toJs(new pyStr(pyUrl));
        }
        let { url, method="GET", username, password, headers = {}, json, data: body, timeout } = kws;
        method = String(method).toUpperCase();

        const xhr = new XMLHttpRequest();
        // set in server.js - allows a user to use with anvil.server.no_loading_indicator
        const suppressLoading = globalSuppressLoading.value > 0;

        if (username && password) {
            headers["Authorization"] = "Basic " + btoa(username + ":" + password);
        }

        const contentType = getContentType(headers);
        const hasContent = method !== "GET" && method !== "HEAD";

        if (hasContent && body) {
            let defaultContentType = "application/x-www-form-urlencoded; charset=UTF-8";
            if (json) {
                body = JSON.stringify(body);
                defaultContentType = "application/json";
            }
            if (!contentType) {
                headers["Content-Type"] = defaultContentType;
            }
        }

        if (body && typeof body !== "string" && !(body instanceof Uint8Array)) {
            body = new URLSearchParams(body).toString();
        }

        if (!hasContent) {
            try {
                const _URL = new URL(url);
                _URL.search = _URL.search || body;
                url = _URL.toString();
            } catch (e) {
                console.error(e);
            }
            // can't send data as part of a get request
            body = undefined;
        }

        xhr.open(method, url, true);

        for (const header in headers) {
            xhr.setRequestHeader(header, headers[header]);
        }

        if (timeout) {
            if (typeof timeout !== "number") {
                throw new pyTypeError("timeout must be set to a number");
            }
            xhr.timeout = timeout * 1000;
        }

        xhr.responseType = "arraybuffer";
        xhr.overrideMimeType("application/x-octet-stream");

        const { promise, resolve, reject } = PyDefUtils.defer();

        const onSuccess = () => {
            if (!suppressLoading) window.setLoading(false);
            resolve(pyGetResponse(xhr, json));
        };

        const onError = (statusText) => {
            if (!suppressLoading) window.setLoading(false);
            const status = xhr.status;
            const content = pyGetResponse(xhr, json, false);
            let message = statusText || xhr.statusText;
            if (!message || message === "error") {
                message = null; // instead use a HttpError's nicer message.
            }
            reject(pyCall(pyMod["HttpError"], [toPy(status), content, toPy(message)]));
        };

        xhr.onload = () => {
            const status = xhr.status;
            if ((status >= 200 && status < 300) || status === 304) {
                onSuccess();
            } else {
                onError();
            }
        };
        xhr.onerror = () => onError();
        xhr.ontimeout = () => onError("timeout");

        if (!suppressLoading) window.setLoading(true);
        xhr.send(body);

        return promiseToSuspension(promise);
    }

    pyMod["request"] = PyDefUtils.funcWithKwargs(request);

    return pyMod;
};

/*
 * TO TEST:
 * 
 *  - Methods: encode_uri_component, json_stringify, b64_encode, b64_decode, request
 *
 */