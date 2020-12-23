"use strict";

/**
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
/**
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
module.exports = function() {

    var pyMod = {"__name__": new Sk.builtin.str("http")};
    var PyDefUtils = require("PyDefUtils");

    var xmlmod = PyDefUtils.getModule("anvil.xml");
    var anvilmod = PyDefUtils.getModule("anvil");
    var servermod = PyDefUtils.getModule("anvil.server");

    pyMod["url_encode"] = pyMod["encode_uri_component"] = new Sk.builtin.func(function(c) {
        Sk.builtin.pyCheckArgs("url_encode", arguments, 1, 1);
        Sk.builtin.pyCheckType("url_encode", "string_to_encode", Sk.builtin.checkString(c));
        return Sk.ffi.remapToPy(encodeURIComponent(Sk.ffi.remapToJs(c)));
    });

    pyMod["UrlEncodingError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "UrlEncodingError", [Sk.builtin.Exception]);
    Sk.misceval.callsim(servermod.tp$getattr(new Sk.builtin.str("_register_exception_type")), new Sk.builtin.str("anvil.http.UrlEncodingError"), pyMod["UrlEncodingError"]);

    pyMod["url_decode"] = new Sk.builtin.func(function(s) {
        Sk.builtin.pyCheckArgs("url_decode", arguments, 1, 1);
        Sk.builtin.pyCheckType("url_decode", "string_to_decode", Sk.builtin.checkString(s));
        try {
            return Sk.ffi.remapToPy(decodeURIComponent(Sk.ffi.remapToJs(s)));
        } catch(_e) {
            throw Sk.misceval.callsim(pyMod["UrlEncodingError"]);
        }
    });

    pyMod["json_stringify"] = new Sk.builtin.func(function(obj) {
        return Sk.ffi.remapToPy(JSON.stringify(Sk.ffi.remapToJs(obj)));
    });

    pyMod["b64_encode"] = new Sk.builtin.func(function(s) {
        return Sk.ffi.remapToPy(btoa(Sk.ffi.remapToJs(s)));
    });

    pyMod["b64_decode"] = new Sk.builtin.func(function(s) {
        return Sk.ffi.remapToPy(atob(Sk.ffi.remapToJs(s)));
    }); 

    pyMod["HttpError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
        $loc["__init__"] = new Sk.builtin.func(function init(self, pyStatus, pyContent, pyMessage) {
            var args = []
            self.traceback = []
            if (pyMessage) {
                args.push(pyMessage);
            }
            if (pyStatus) {
                args.push(pyStatus);
                Sk.abstr.sattr(self, new Sk.builtin.str("status"), pyStatus);
            }
            if (pyContent) {
                args.push(pyContent)
                Sk.abstr.sattr(self, new Sk.builtin.str("content"), pyContent);
            }
            self.args = new Sk.builtin.list(args);
            return Sk.builtin.none.none$;
        });
    }, "HttpError", [Sk.builtin.Exception]);

    var pyGetResponse = function(r, xhr, json) {
        if (!(r instanceof ArrayBuffer)) {
            return Sk.builtin.none.none$;
        }
        let bytes = new Sk.builtin.bytes(new Uint8Array(r));
        if (json) {
            const jsstr = bytes.$jsstr();
            let json;
            try {
                json = JSON.parse(jsstr);
            } catch(e) {
                throw new Sk.builtin.ValueError("Returned data is not valid JSON");
            }
            return Sk.ffi.remapToPy(json);
        } else {
            const contentType = xhr.getResponseHeader("content-type") || "";
            if (!Sk.__future__.python3) {
                bytes = new Sk.builtin.str(bytes.$jsstr());
            }
            return Sk.misceval.callsim(anvilmod.$d["BlobMedia"], new Sk.builtin.str(contentType), bytes);
        }
    };

    // NOTE: `http.request` should be updated to be binary-safe and handle Media objects, like proxy_request used to (check the git history)
    var request = function(kwargs, pyUrl) {

        if (pyUrl) { kwargs["url"] = Sk.ffi.remapToJs(new Sk.builtin.str(pyUrl)); }

        if (kwargs["username"] && kwargs["password"]) {
            kwargs["headers"] = kwargs["headers"] || {}
            kwargs["headers"]["Authorization"] = "Basic " + btoa(kwargs["username"]+":"+kwargs["password"]);
        }

        var getContentType = function() {
            for (var k in kwargs["headers"]) {
                if (k.toLowerCase() == "content-type") {
                    return kwargs["headers"][k];
                }
            }
            return undefined;
        }
        if (kwargs["json"] && kwargs["data"]) {
            kwargs["data"] = JSON.stringify(kwargs["data"]);
            if (!getContentType()) {
                kwargs["headers"] = kwargs["headers"] || {};
                kwargs["headers"]["Content-Type"] = "application/json";
            }
        }

        var params = {url: kwargs["url"], method: kwargs["method"], headers: kwargs["headers"], data: kwargs["data"], xhrFields: {responseType: "arraybuffer"}, beforeSend: (xhr)=>xhr.overrideMimeType("application/x-octet-stream")};
        window.setLoading(true);
        return PyDefUtils.suspensionPromise(function(resolve, reject) {
            $.ajax(params).done(function(r, ts, xhr) {
                window.setLoading(false);
                resolve(pyGetResponse(r, xhr, kwargs["json"]))
            }).fail(function(xhr, textStatus, errorThrown) {
                window.setLoading(false);
                reject(Sk.misceval.callsim(pyMod["HttpError"], Sk.ffi.remapToPy(xhr.status), pyGetResponse(xhr, kwargs["json"])));
            });
        })
    };

    pyMod["request"] = PyDefUtils.funcWithKwargs(request);

    //pyMod["request_full"] = PyDefUtils.funcWithKwargs(request_full);

    var encodeFormData = function(data) {
        var s = [];
        for (var k in data) {
            if (data[k] !== undefined) {
                if (typeof(data[k]) == "object") {
                    for (var kk in data[k]) {
                        s.push(encodeURIComponent(k+"["+kk+"]")+"="+encodeURIComponent(data[k][kk]));
                    }
                } else {
                    s.push(encodeURIComponent(k)+"="+encodeURIComponent(data[k]));
                }
            }
        }
        return s.join("&");
    };

    return pyMod;
}

/*
 * TO TEST:
 * 
 *  - Methods: encode_uri_component, json_stringify, b64_encode, b64_decode, request
 *
 */