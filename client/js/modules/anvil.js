"use strict";

module.exports = function(appOrigin, uncaughtExceptions) {

	var PyDefUtils = require("PyDefUtils");

    var pyModule = {
        "__name__": new Sk.builtin.str("anvil"),
        "__path__": new Sk.builtin.tuple([new Sk.builtin.str("anvil-services/anvil"),new Sk.builtin.str("src/lib/anvil")]),
        app_path: Sk.ffi.remapToPy(appOrigin),
        _now: new Sk.builtin.func(function() { return Sk.ffi.remapToPy(Date.now()); }),
    };

    let ByteString, arrayBufferToBytesInternal;
    if (Sk.__future__.python3) {
        ByteString = Sk.builtin.bytes;
        arrayBufferToBytesInternal = (arrayBuffer) => {
            return new Uint8Array(arrayBuffer);
        };
    } else {
        ByteString = Sk.builtin.str;
        // since we're in python2 bytes are represented as binary strings
        arrayBufferToBytesInternal = (arrayBuffer) => {
            let binary = "";
            var bytes = new Uint8Array(arrayBuffer);
            var length = bytes.byteLength;
            for (var i = 0; i < length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return binary;
        };
    }



    /**
    id: anvil_module
    docs_url: /docs/client/python#the-anvil-module
    title: Anvil Module
    description: |
      The `anvil` module is imported by default in Forms, and must be referred to explicitly in server modules.

      All the components described in these documents are classes in the `anvil` module. In addition, this module contains some utility functions:

      ```python
      from anvil import *

      print("Our URL hash is: " + repr(get_url_hash()))
      ```

      `get_url_hash()` gets the decoded hash (the part after the '#' character) of the URL used to open this app.

      If the first character of the hash is a question mark (eg `https://myapp.anvil.app/#?a=foo&b=bar`), it will be interpreted as query-string-type parameters and returned as a dictionary (eg `{'a': 'foo', 'b': 'bar'}`).

      `get_url_hash()` is available in Form code only.


      ```python
      from anvil import *

      if app.branch == 'published':
        print("We are on the published branch")

      print("This app's ID is " + app.id)
      ```

      `anvil.app` (or `app` if you've imported `*` from the `anvil` module) is an object containing information about your app:

      \* `anvil.app.branch` is a string that tells you which version of your app is running. If you run the app in the Anvil editor, `anvil.app.branch` will be `"master"`; if you have [published a version of your app](#publishing_an_app) and you're running that, it will be `"published"`.

      \* `anvil.app.id` is a string that contains the unique ID of this app.

    */

    /*!defFunction(anvil,!)!2*/ "Get the decoded hash (the part after the '#' character) of the URL used to open this app. If the first character of the hash is a question mark (eg '#?a=foo&b=bar'), it will be interpreted as query-string-type parameters and returned as a dictionary (eg {'a': 'foo', 'b': 'bar'})."
    pyModule["get_url_hash"] = new Sk.builtin.func(function() {
        var h = document.location.hash;

        if (h[1] == "?" || h[1] == '!' && h[2] == '?') {

            var params = {};
            $.each(h.substring((h[1] == '?') ? 2 : 3).split("&"), function(i,p) {
                var kv = p.split("=");
                params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
            });

            return Sk.ffi.remapToPy(params);
        } else {
            return Sk.ffi.remapToPy(decodeURIComponent(h.substring(1)));
        }

    });

    pyModule["set_url_hash"] = new Sk.builtin.func(function(pyVal) {

        var val = Sk.ffi.remapToJs(pyVal);

        if (typeof(val) == "object") {
            document.location.hash = "?" + $.param(val);
        } else {
            document.location.hash = val;
        }
    })

    /*!defFunction(anvil,!,handler_fn)!2*/ "Set a function to be called when an uncaught exception occurs. If set to None, a pop-up will appear letting the user know that an error has occurred."
    pyModule["set_default_error_handling"] = new Sk.builtin.func(function(f) {
        uncaughtExceptions.pyHandler = f || Sk.builtin.none.none$;
        return Sk.builtin.none.none$;
    });

    pyModule["_generate_internal_error"] = new Sk.builtin.func(function(f) {
        throw {internal: "error"};
    });


    var appInfoClass = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        $loc["__getattr__"] = new Sk.builtin.func(function(self, pyAttrName) {
            var attrName = Sk.ffi.remapToJs(pyAttrName);
            if (window.anvilAppInfo.hasOwnProperty(attrName)) {
                return new Sk.ffi.remapToPy(window.anvilAppInfo[attrName]);
            }
            throw new Sk.builtin.AttributeError(pyAttrName);
        });
        $loc["__setattr__"] = new Sk.builtin.func(function() {
            throw new Sk.builtin.Exception("This object is read-only");
        });
        [/*!defAttr()!1*/ {
            name: "id",
            type: "string",
            description: "A unique identifier for the current app",
        },/*!defAttr()!1*/ {
            name: "branch",
            type: "string",
            description: "The Git branch from which the current app is being run.\n\nThis is 'master' for development apps or apps without a published version, and 'published' if this app is being run from its published version.",
        }];
        /*!defClass(anvil.,AppInfo)!*/

    }, "AnvilAppInfo", []);
    [/*!defModuleAttr(anvil)!1*/{
        name: "app",
        pyType: "anvil..AppInfo instance",
        description: "Information about the current app",
    }];
    pyModule["app"] = Sk.misceval.callsim(appInfoClass);

    var pyCurrentForm = null;

    /*!defFunction(anvil,!,form,*args,**kwargs)!2*/ "Open the specified form as a new page.\n\nIf 'form' is a string, a new form will be created (extra arguments will be passed to its constructor).\nIf 'form' is a Form object, it will be opened directly."
    pyModule["open_form"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(rawKwargs, pyForm) {

        var openFormInstance = function(pyForm) {
            // TODO: Check we actually have a form instance.
            // i.e. is pyForm an instance of pyModule.Form?

            $('#appGoesHere > *').detach();

            var fns = [];
            if (pyCurrentForm) {
                fns.push(pyCurrentForm._anvil.removedFromPage);
                pyCurrentForm = null;
            }

            fns.push(() => {
                $("#appGoesHere").append(pyForm._anvil.element);
                pyCurrentForm = pyForm;
            })
            fns.push(pyForm._anvil.addedToPage);
            return Sk.misceval.chain(undefined, ...fns);
        };

        if (pyForm instanceof Sk.builtin.str) {

            var formName = pyForm.v;
            var args = Array.prototype.slice.call(arguments, 2); // Extra args to pass to __init__ of named form

            return Sk.misceval.chain(undefined, function() {
                return Sk.builtin.__import__(formName,
                    {"__package__": new Sk.builtin.str(window.anvilAppMainPackage)},
                    {}, [], -1);

            }, function() {

                let ps = formName.split(".");
                let leafName = ps[ps.length-1];
                // Yes, sysmodules is indexed with JS strings.
                // No, this makes no sense.
                let pyFormMod;
                try {
                    pyFormMod = Sk.sysmodules.mp$subscript(new Sk.builtin.str(window.anvilAppMainPackage + "." + formName));
                } catch (e) {
                    pyFormMod = Sk.sysmodules.mp$subscript(new Sk.builtin.str(formName));
                }


                var formConstructor = pyFormMod.$d[leafName];

                if (!formConstructor) {
                    throw new Sk.builtin.Exception('"' + formName + '" module does not contain a class called "' + leafName + '"');
                }

                if (rawKwargs) {
                    // Seriously? Skulpt expects raw JS strings in applyOrSuspend(), but Sk.builtin.func()
                    // translates them all into Skulpt strings for us. What a world...
                    for (let i = 0; i < rawKwargs.length; i+=2) {
                        rawKwargs[i] = rawKwargs[i].v;
                    }
                }

                return Sk.misceval.applyOrSuspend(formConstructor, undefined, undefined, rawKwargs, args);

            }, openFormInstance);

        } else {
            return openFormInstance(pyForm);
        }

    }));

    /*!defFunction(anvil,!)!2*/ "Returns the form most recently opened with open_form()."
    pyModule["get_open_form"] = new Sk.builtin.func(function() {
        return pyCurrentForm || Sk.builtin.none.none$;
    });


    pyModule["is_server_side"] = new Sk.builtin.func(function() {
        return Sk.builtin.bool.false$;
    });

    pyModule["Media"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        // This is a hack, because of the horrible way that Skulpt handles
        // class attribute lookup, which causes names like "name" to instead pull out
        // bits of Javascript internals. Eww.
        $loc["__getattribute__"] = new Sk.builtin.func(function(self, pyName) {

            var name = Sk.ffi.remapToJs(pyName).replace("_$rn$", "");

            if (name == "url" || name == "content_type" || name == "length" || name == "name") {

                var pyGetter = Sk.abstr.gattr(self, new Sk.builtin.str("get_"+name));

                return Sk.misceval.callsimOrSuspend(pyGetter);
            } else {
                return Sk.builtin.object.prototype.tp$getattr.call(self, pyName, true);
            }
        });

        $loc["__setattr__"] = new Sk.builtin.func(function(self, pyName, pyVal) {
            var name = Sk.ffi.remapToJs(pyName);
            if (name == "url" || name == "content_type" || name == "length" || name == "name") {
                throw new Sk.builtin.AttributeError("Cannot change the URL, content type, length or name of a Media object; create a new Media object instead");
            } else {
                return Sk.builtin.object.prototype.tp$setattr.call(self, pyName, pyVal);
            }
        });

        $loc["get_url"] = new Sk.builtin.func(function(self) {
            return Sk.builtin.none.none$;
        });

        $loc["get_name"] = new Sk.builtin.func(function(self) {
            return Sk.builtin.none.none$;
        });

        $loc["get_length"] = new Sk.builtin.func(function(self) {
            // By default, it's a hack!
            return Sk.misceval.chain(
                Sk.misceval.callsimOrSuspend(Sk.abstr.gattr(self, new Sk.builtin.str("get_bytes"))), // TODO: This should return the length in bytes instead of characters
                Sk.builtin.len
            );
        });

        [/*!defAttr()!1*/ {
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
        }];

        /*!defMethod(_)!2*/ "Get a binary string of the data represented by this Media object"
        ["get_bytes"];

        /*!defClass(anvil,Media)!*/
    }, "Media", []);

    pyModule["URLMedia"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        /*!defMethod(_,url)!2*/ "Create a Media object representing the data at a specific URL. Caution: Getting data from URLs directly in your code will often fail for security reasons, or fail to handle binary data."
        $loc["__init__"] = new Sk.builtin.func(function(self, pyURL) {
            self._url = Sk.ffi.remapToJs(pyURL);
        });

        $loc["get_url"] = new Sk.builtin.func(function(self) { return new Sk.builtin.str(self._url); });

        // Returns a promise
        var doFetch = function(self) {
            if (self._fetch) { return self._fetch; }
            self._fetch = new Promise(function (resolve, reject) {

                if (self._url.substring(0,5) == "data:") {
                    // This is a dataURL. Decode it manually, because we won't be allowed to GET it.
                    var parts = self._url.split(";base64,")
                    var b64Str = parts[1];
                    var val = atob(b64Str);

                    resolve({data: val, contentType: parts[0].substring(5)});
                } else {
                    // TODO: Test this. If it works, #258 can be closed.
                    window.setLoading(true);
                    // NB JQuery "promises" are broken and not chainable; adapt directly
                    $.ajax({
                      url: self._url,
                      type: "GET",
                      dataType: "binary",
                      processData: false,
                    }).then(function(r,ts,xhr) {
                        window.setLoading(false);
                        resolve({data: r.arrayBuffer(), contentType: xhr.getResponseHeader("content-type")});
                    }, function(xhr, textStatus, errorThrown) {
                        window.setLoading(false);
                        let help = "(HTTP "+xhr.status+")";
                        if (xhr.status === 0) {
                            help = "(probably due to a cross-origin URL)";
                        }
                        reject(new Sk.builtin.Exception("Failed to load media "+help+": "+self._url));
                    });

                }
            });
            return self._fetch;
        };

        $loc["get_content_type"] = new Sk.builtin.func(function(self) {
            return new PyDefUtils.suspensionPromise(function(resolve, reject) {
                doFetch(self).then(function(r) { resolve(new Sk.builtin.str(r.contentType)); }, reject);
            });
        });

        $loc["get_bytes"] = new Sk.builtin.func(function(self) {
            return new PyDefUtils.suspensionPromise(function(resolve, reject) {
                doFetch(self).then(function(r) {
                    return r.data;
                }, reject).then(function(arrayBufferOrStr) {
                    if (typeof(arrayBufferOrStr) === "string") {
                        resolve(new ByteString(arrayBufferOrStr));
                    } else {
                        resolve(new ByteString(arrayBufferToBytesInternal(arrayBufferOrStr)))
                    }
                }).catch(e => {
                    console.error(e);
                    reject(e);
                });
            });
        });

        $loc["get_name"] = new Sk.builtin.func(function(self) {
            var names = (""+self._url).replace(/\/+$/, "").split("/");
            if (names && names.length > 0) {
                return new Sk.builtin.str(names[names.length-1])
            } else {
                return Sk.builtin.none.none$;
            }
        })

        /*!defClass(anvil,URLMedia,Media)!*/
	}, 'URLMedia', [pyModule['Media']]);


    pyModule["DataMedia"] = pyModule["BlobMedia"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        /*!defMethod(_,content_type,content,[name=None])!2*/ "Create a Media object with the specified content_type (a string such as 'text/plain') and content (a binary string). Optionally specify a filename as well."
        $loc["__init__"] = PyDefUtils.funcWithRawKwargsDict(function(kwargs, self, contentType, content, name) {
            contentType = contentType || kwargs['content_type'] || kwargs['contentType'];
            content = content || kwargs['content'];

            // Secret Javascript-only calling interface, takes a single Blob param
            if (contentType instanceof Blob) {
                self._data = contentType;
                self._contentType = self._data.type;
                self._name = content;
            } else if (content === undefined) {
                throw new Sk.builtin.TypeError("BlobMedia() takes two arguments (content_type and content)");
            } else {
                if (!Sk.builtin.checkString(contentType)) {
                    throw new Sk.builtin.TypeError("content_type must be a string, not " + Sk.abstr.typeName(contentType));
                }
                if (Sk.__future__.python3 && !Sk.builtin.checkBytes(content)) {
                    throw new Sk.builtin.TypeError("content must be a byte-string, not " + Sk.abstr.typeName(content));
                } else if (!Sk.__future__.python3 && !Sk.builtin.checkString(content)) {
                    throw new Sk.builtin.TypeError("content must be a string or byte-string, not " + Sk.abstr.typeName(content));
                }
                self._contentType = Sk.ffi.remapToJs(contentType);
                self._data = Sk.ffi.remapToJs(content);
            }
            if ("name" in kwargs) {
                self._name = kwargs["name"];
            } else if (name != undefined) {
                self._name = name;
            }
        });

        $loc["get_url"] = new Sk.builtin.func(function(self, forceDataUrl) {

            if (!Sk.misceval.isTrue(forceDataUrl || false)) {
                return Sk.builtin.none.none$;
            }

            let jsstr;
            if (self._data instanceof Blob) {
                return new PyDefUtils.suspensionPromise(function(resolve, reject) {
                    var fr = new FileReader();
                    fr.onloadend = function() { resolve(new Sk.builtin.str(fr.result)); };
                    fr.readAsDataURL(self._data);
                });
            } else if (self._data instanceof Uint8Array) {
                jsstr = ""
                const uint8 = self._data;
                for (let i = 0; i < uint8.length; i++) {
                    jsstr += String.fromCharCode(uint8[i]);
                } 
            } else {
                jsstr = self._data;
            }
            var b64 = require("../lib/b64");
            return new Sk.builtin.str("data:" + self._contentType.replace(/;/g, "") + ";base64," + b64.base64EncStr(jsstr));
        });

        $loc["get_content_type"] = new Sk.builtin.func(function(self) {
            return new Sk.builtin.str(self._contentType);
        });

        $loc["get_bytes"] = PyDefUtils.funcWithKwargs(function(kwargs, self) {
            if (self._data instanceof Blob) {
                return new PyDefUtils.suspensionPromise(function(resolve, reject) {
                    var fr = new FileReader();
                    if (fr.readAsBinaryString) {
                        fr.onloadend = function() { 
                            resolve(new ByteString(fr.result));
                        };
                        fr.readAsBinaryString(self._data);
                    } else {
                        fr.onloadend = function() { 
                            resolve(new ByteString(arrayBufferToBytesInternal(fr.result)));
                        };
                        fr.readAsArrayBuffer(self._data);
                    }
                });
            } else {
                return new ByteString(self._data);
            }
        });

        $loc["get_name"] = new Sk.builtin.func(function(self) {
            if (self._name !== undefined) {
                return new Sk.builtin.str(self._name);
            } else {
                return Sk.builtin.none.none$;
            }
        });
        /*!defClass(anvil,BlobMedia,Media)!*/
	}, 'BlobMedia', [pyModule['Media']]);


    pyModule["FileMedia"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        $loc["__init__"] = new Sk.builtin.func(function(self, fileObj) {
            if (!fileObj instanceof File) {
                throw new Sk.builtin.Exception("You cannot construct a anvil.FileMedia yourself; it can only come from a File component");
            }

            self._data = fileObj;
            self._contentType = fileObj.type;

            self._name = fileObj.name;
        });
    }, 'FileMedia', [pyModule['BlobMedia']]);

    pyModule["LazyMedia"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        $loc["__init__"] = new Sk.builtin.func(function(self, lmSpec) {
            self.$anvil_isLazyMedia = true
            if (lmSpec && lmSpec.$anvil_isLazyMedia) {
                self._spec = lmSpec._spec;
            } else if (lmSpec && lmSpec.id && lmSpec.key && lmSpec.manager) {
                self._spec = lmSpec;
            } else {
                throw new Sk.builtin.Exception("You cannot construct a anvil.LazyMedia from Python. Use anvil.BlobMedia instead.")
            }
        });

        var doFetch = function(self) {
            if (self._fetched) {
                return self._fetched;
            }

            var serverModule = PyDefUtils.getModule("anvil.server");
            var pyKwargs = [];
            var args = new Sk.builtin.list([Sk.ffi.remapToPy(self._spec)]);

            return Sk.misceval.chain(
                serverModule.$d["__anvil$doRpcCall"](pyKwargs, args, "anvil.private.fetch_lazy_media"),
                function (bm) {
                    // bm will be a BlobMedia
                    self._fetched = bm;
                    return bm;
                });
        };

        $loc["get_bytes"] = new Sk.builtin.func(function(self) {
            return Sk.misceval.chain(doFetch(self), function(bm) {
                return Sk.misceval.callsimOrSuspend(Sk.abstr.gattr(bm, new Sk.builtin.str("get_bytes")));
            });
        });

        $loc["get_content_type"] = new Sk.builtin.func(function(self) {
            if (self._spec["mime-type"]) {
                return Sk.ffi.remapToPy(self._spec["mime-type"]);
            } else {
                return Sk.misceval.chain(doFetch(self), function(bm) {
                    return Sk.misceval.callsimOrSuspend(Sk.abstr.gattr(bm, new Sk.builtin.str("get_content_type")));
                });
            }
        });

        $loc["get_url"] = new Sk.builtin.func(function(self, pyDownload) {
            var serverModule = PyDefUtils.getModule("anvil.server");
            var appOrigin = Sk.ffi.remapToJs(serverModule.$d["app_origin"]);//.replace(/[^\/]+\/?$/, "");
            var isDownload = pyDownload ? Sk.misceval.isTrue(pyDownload) : true;
            return new Sk.builtin.str(appOrigin + "/_/lm/" + encodeURIComponent(self._spec.manager) + "/" + encodeURIComponent(self._spec.key) + "/" + encodeURIComponent(self._spec.id) + "/" + encodeURIComponent(self._spec.name || "") + "?s=" + window.anvilSessionToken + (isDownload ? "" : "&nodl=1"));
        });

        $loc["get_name"] = new Sk.builtin.func(function(self) {
            return self._spec.name !== undefined ? new Sk.builtin.str(self._spec.name) : Sk.builtin.none.none$;
        });
    }, 'LazyMedia', [pyModule['Media']]);

    pyModule["create_lazy_media"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(kwargs) {
        var serverModule = PyDefUtils.getModule("anvil.server");
        return Sk.misceval.applyOrSuspend(serverModule.tp$getattr(new Sk.builtin.str("call")), undefined, undefined, kwargs, [new Sk.builtin.str("anvil.private.mk_LazyMedia")].concat(Array.prototype.slice.call(arguments, 1)));
    }));

    pyModule["LiveObjectProxy"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        var doRpcMethodCall = function(self, methodName, pyKwargs, args) {
            var serverModule = PyDefUtils.getModule("anvil.server");
            return serverModule.$d["__anvil$doRpcCall"](pyKwargs, args, methodName, self._spec);
        };

        $loc["__init__"] = new Sk.builtin.func(function(self, spec) {
            self._spec = spec;
            self._anvil = {};
            self._anvil_is_LiveObjectProxy = true;
        });

        $loc["__getattr__"] = new Sk.builtin.func(function(self, pyName) {

            var name = pyName.toString();

            if (self._spec.methods.indexOf(name) > -1) {
                return new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs) {

                    var args = Array.prototype.slice.call(arguments, 1);

                    return doRpcMethodCall(self, name, pyKwargs, args);
                }));
            }

            throw new Sk.builtin.AttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
        });

        $loc["__getitem__"] = new Sk.builtin.func(function(self, pyName) {
            
            // Are we iterable?
            if (self._spec.methods.indexOf("__anvil_iter_page__") > -1)
            {
                if (pyName instanceof Sk.builtin.int_) {
                    var idx = Sk.ffi.remapToJs(pyName);

                    if (idx < 0) {
                        throw new Sk.builtin.IndexError("list index cannot be negative");
                    }

                    var pyIter = Sk.misceval.callsim(LiveObjectIterator, self, idx);

                    return PyDefUtils.suspensionFromPromise(
                        PyDefUtils.callAsyncWithoutDefaultError(pyIter.tp$getattr(new Sk.builtin.str("next"))).catch(function(e) {
                            if (e instanceof Sk.builtin.StopIteration) {
                                throw new Sk.builtin.IndexError("list index out of range");
                            }
                            throw e;
                        }));

                } else if (pyName instanceof Sk.builtin.slice) {
                    var start = Sk.ffi.remapToJs(pyName.start);
                    var stop = Sk.ffi.remapToJs(pyName.stop);
                    var step = Sk.ffi.remapToJs(pyName.step);

                    if (start < 0 || stop < 0 || step < 0) {
                        throw new Sk.builtin.Exception("list slice indices and step cannot be negative");
                    }

                    return Sk.misceval.callsim(LiveObjectIterator, self, start, stop, step);
                }
            }
            // We are not iterable, or pyName wasn't a suitable type.

            // Is it cached?
            if (self._spec.itemCache) {
                var name = Sk.ffi.remapToJs(pyName);
                if (name in self._spec.itemCache) {
                    return self._spec.itemCache[name];
                }
            }

            // Is this implemented on the server?
            if (self._spec.methods.indexOf("__getitem__") != -1) {
                return doRpcMethodCall(self, "__getitem__", [], [pyName]);
            } else {
                throw new Sk.builtin.Exception("Indexing with [] is not supported on this "+self._spec.backend);
            }
        });

        $loc["__setitem__"] = new Sk.builtin.func(function(self, pyName, pyVal) {
            // Is this implemented on the server?
            if (self._spec.methods.indexOf("__setitem__") != -1) {
                var name = Sk.ffi.remapToJs(pyName);
                if (self._spec.itemCache) {
                    delete self._spec.itemCache[name];
                }
                return Sk.misceval.chain(
                    doRpcMethodCall(self, "__setitem__", [], [pyName, pyVal]),
                    function(r) {
                        var v = undefined;
                        if (self._spec.itemCache) {
                            self._spec.itemCache[name] = pyVal;
                        }
                        return r;
                    });
            } else {
                throw new Sk.builtin.Exception("Indexing with [] is not supported on this "+self._spec.backend);
            }
        });

        function defOverride(fnName, fnIfNotPresent) {
            $loc[fnName] = new Sk.builtin.func(function(self) {
                if (self._spec.methods.indexOf(fnName) != -1) {
                    return doRpcMethodCall(self, fnName, [], []);
                } else {
                    return fnIfNotPresent(self);
                }
            });
        }
        defOverride("__len__", (self) => { throw new Sk.builtin.TypeError("Cannot call len() on this " + self._spec.backend) });
        defOverride("__nonzero__", () => Sk.builtin.bool.true$);
        defOverride("__bool__", () => Sk.builtin.bool.true$);

        function isEq(self, pyOther) {
            return pyOther && pyOther._anvil_is_LiveObjectProxy && pyOther._spec.id == self._spec.id && pyOther._spec.backend == self._spec.backend;
        }

        $loc["__eq__"] = new Sk.builtin.func(function(self, pyOther) {
            return isEq(self, pyOther) ? Sk.builtin.bool.true$ : Sk.builtin.bool.false$;
        });

        $loc["__ne__"] = new Sk.builtin.func(function(self, pyOther) {
            return isEq(self, pyOther) ? Sk.builtin.bool.false$ : Sk.builtin.bool.true$;
        });

        $loc["__hash__"] = new Sk.builtin.func(function(self) {
            return Sk.builtin.hash(new Sk.builtin.tuple([self._spec.id, self._spec.backend].map((x) => Sk.ffi.remapToPy(x))));
        });

        var LiveObjectIterator = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
            $loc["__init__"] = new Sk.builtin.func(function(self, pyLiveObject, start, limit, step) {
                self._spec = pyLiveObject._spec;
                var i = self._spec.iterItems || {};
                self._items = i.items;
                self._pyNextPage = i.nextPage && Sk.ffi.remapToPy(i.nextPage);
                self._idx = start || 0;
                self._limit = limit;
                self._step = step;
                //console.log("Initial iterator state: ", self._items, self._pyNextPage, self._limit);
            });

            $loc["__iter__"] = new Sk.builtin.func(function(self) {
                return self;
            })

            $loc["next"] = $loc["__next__"] = new Sk.builtin.func(function next(self) {
                if (self._items && self._idx < self._items.length && (self._limit == null || self._idx < self._limit)) {
                    var r = self._items[self._idx];
                    self._idx += self._step != null ? self._step : 1;
                    return r;
                } else if (self._items && (!self._pyNextPage || !Sk.misceval.isTrue(self._pyNextPage))) {
                    throw new Sk.builtin.StopIteration();
                } else if (self._limit != null && self._idx >= self._limit) {
                    throw new Sk.builtin.StopIteration();
                } else {
                    return Sk.misceval.chain(
                        doRpcMethodCall(self, "__anvil_iter_page__", [], [self._pyNextPage || Sk.builtin.none.none$]),
                        function (newState) {
                            // A little jiggery-pokery - newState comes back from doRpcMethodCall() as a Python object...

                            if (self._limit != null)
                                self._limit -= self._items ? self._items.length : 0;
                            self._idx -= self._items ? self._items.length : self._idx;
                            self._pyNextPage = Sk.misceval.isTrue(newState.sq$contains(new Sk.builtin.str("nextPage"))) && newState.mp$subscript(new Sk.builtin.str("nextPage"));
                            self._items = newState.mp$subscript(new Sk.builtin.str("items")).v;

                            //console.log("New iterator state: ", self._items, self._pyNextPage);
                            return next(self);
                        }
                    );
                }
            });
        }, 'LiveObjectIterator', []);


        $loc["__iter__"] = new Sk.builtin.func(function(self) {
            // Is this actually iterable?
            if (self._spec.methods.indexOf("__anvil_iter_page__") < 0) {
                throw new Sk.builtin.Exception("This " + self._spec.backend + " object is not iterable");
            }

            return Sk.misceval.callsim(LiveObjectIterator, self);
        });

        $loc["__repr__"] = new Sk.builtin.func(function(self) {
            return Sk.ffi.remapToPy("<LiveObject: " + self._spec.backend + ">");
        });

    }, 'LiveObjectProxy', []);

    pyModule["_get_live_object_id"] = new Sk.builtin.func(function(lo) {
        if (lo && lo._anvil_is_LiveObjectProxy) {
            return new Sk.builtin.str(lo._spec.id);
        } else {
            throw new Sk.builtin.Exception("Argument is not a LiveObject");
        }
    });

    pyModule["_clear_live_object_caches"] = new Sk.builtin.func(function(lo) {
        if (lo && lo._anvil_is_LiveObjectProxy) {
            lo._spec.itemCache = {};
            lo._spec.iterItems = {};
        } else {
            throw new Sk.builtin.Exception("Argument is not a LiveObject");
        }
    });

    pyModule["_get_service_client_config"] = new Sk.builtin.func(function(pyYmlPath) {
        let path = Sk.ffi.remapToJs(pyYmlPath);
        return Sk.ffi.remapToPy(window.anvilServiceClientConfig[path] || null);
    });

    pyModule["_get_anvil_cdn_origin"] = new Sk.builtin.func(() => {
        return Sk.ffi.remapToPy(window.anvilCDNOrigin);
    });

    /*!defFunction(anvil,anvil.Component instance)!2*/ "Get the currently focused Anvil component, or None if focus is not in a component."
    pyModule["get_focused_component"] = new Sk.builtin.func(function() {
        let el = document.activeElement;
        let nearestCpt = $(el).closest(".anvil-component");
        if (nearestCpt.length > 0) {
            return nearestCpt.data("anvil-py-component");
        } else {
            return Sk.builtin.none.none$;
        }
    });

    var resetAlertModal = function() {
            var a = $("#alert-modal")
            a.off("hidden.bs.modal.alertclear");
            a.find(".modal-header").show();
            a.find(".modal-body").show();
            a.find(".modal-footer button").off("click").remove();
            a.find(".modal-footer input").remove();
            a.find(".modal-footer").hide();

            a.find(".modal-dialog").removeClass("modal-lg").removeClass("modal-sm");

            return a;
    }

    var modalReady = Promise.resolve();
    var modalQueueLength = 0;

    var modal = function(kwargs) {
        return PyDefUtils.suspensionPromise(function(resolve, reject) {

            modalQueueLength++;

            if (modalQueueLength > 1) {
                console.debug("Enqueue modal. Queue length now", modalQueueLength);
            }

            modalReady = modalReady.then(function() {
                return new Promise(function(signalModalReady) {

                    var a = resetAlertModal();
                    var returnValue = Sk.builtin.none.none$;
                    var pyForm = null;

                    a.one("hide.bs.modal", function() {
                        setTimeout(function() {
                            if (pyForm) {
                                pyForm._anvil.element.detach();
                                PyDefUtils.asyncToPromise(pyForm._anvil.removedFromPage).then(() => resolve(returnValue));
                            } else {
                                resolve(returnValue);
                            }
                        });
                    });
                    a.one("hidden.bs.modal.alertclear", function() {
                        modalQueueLength--;
                        signalModalReady();
                    });

                    var size = (kwargs.large && Sk.ffi.remapToJs(kwargs.large)) ? "lg" : "sm";

                    a.find(".modal-dialog").addClass("modal-" + size);

                    if ('title' in kwargs && kwargs['title'] && kwargs['title'] != Sk.builtin.none.none$) {
                        a.find(".modal-title").text(new Sk.builtin.str(kwargs.title).$jsstr());
                    } else {
                        a.find(".modal-header").hide();
                    }

                    a.find(".modal-body").removeClass('alert-text').text("");

                    if ('content' in kwargs && kwargs['content'] && kwargs['content'] != Sk.builtin.none.none$) {
                        if (Sk.misceval.isTrue(Sk.builtin.isinstance(kwargs.content, pyModule["Component"]))) {
                            pyForm = kwargs.content;
                            a.find(".modal-body").text("").append(pyForm._anvil.element);
                            Sk.misceval.callsim(pyForm.tp$getattr(new Sk.builtin.str("set_event_handler")),
                                                Sk.ffi.remapToPy("x-close-alert"), 
                                                PyDefUtils.funcWithRawKwargsDict(function(kws) {
                                returnValue = kws.value || Sk.builtin.none.none$;
                                a.modal("hide");
                            }));
                        } else {
                            a.find(".modal-body").addClass('alert-text').text(new Sk.builtin.str(kwargs.content).$jsstr());
                        }
                    } else {
                        a.find(".modal-body").hide();
                    }

                    var footer = a.find(".modal-footer");

                    if ('buttons' in kwargs && kwargs.buttons != Sk.builtin.none.none$ && kwargs.buttons.v.length > 0) {
                        for (var i in kwargs.buttons.v || []) {
                            var b = kwargs.buttons.v[i];
                            if (typeof(b.v) == "string") {
                                var txt = b;
                                var val = b;
                            } else {
                                // Expect b to be a tuple (txt, val, style)
                                var txt = b.v[0] ? b.v[0].v : "";
                                var val = b.v[1];
                                var style = b.v[2] ? b.v[2].v : "";
                            }
                            footer.append($("<button type=button class=btn data-dismiss=modal/>")
                                .addClass("btn-" + (style || "default"))
                                .text(txt)
                                .on("click", function(val) {
                                    returnValue = val;
                                    a.modal("hide");
                                }.bind(null,val)));
                        }
                        footer.show();
                    }

                    var dismissible = kwargs.dismissible ? Sk.ffi.remapToJs(kwargs.dismissible) : true;

                    var d = a.data('bs.modal');
                    if (d) {
                        d.options.backdrop =  (dismissible || "static");
                        d.options.keyboard = dismissible;
                    }

                    a.find(".modal-header button.close").toggle(dismissible);

                    a.modal({ backdrop: (dismissible || "static"), keyboard: dismissible, show: true });
                    if (document.activeElement)
                        document.activeElement.blur();
                    a.trigger("focus");
                    if (pyForm) {
                        return new Promise(function(resolve, reject) {
                            a.one("shown.bs.modal", function() {
                                resolve(PyDefUtils.asyncToPromise(pyForm._anvil.addedToPage));
                            })
                        });
                    } else {
                        return;
                    }
                });
            });

        })
    }

    /**
    id: alerts
    docs_url: /docs/client/python/alerts-and-notifications
    title: Alerts
    description: |
      You can display popup messages using the `alert` and `confirm` 
      functions. They are in the `anvil` module, so will be imported by default.

      #### Messages

      ```
      alert("Welcome to Anvil")
      ```

      The simplest way to display a popup message is to call the `alert` function. 
      You must supply at least one argument: The message to be displayed. The `alert` 
      function will return `True` if the user clicks OK, or `None` if they dismiss
      the popup by clicking elsewhere. The example on the right produces the following popup:

      ![Alert popup](img/alert.png)

      #### Confirmations

      ```
      c = confirm("Do you wish to continue?")
      # c will be True if the user clicked 'Yes'
      ```

      If you want to ask your user a yes/no question, just call the `confirm` function
      in the same way. The `confirm` function returns `True` if the user clicks Yes, 
      `False` if the user clicks No, and `None` if they dismiss the popup by clicking elsewhere (See `dismissible` keyword argument, below).

      ![Alert popup](img/confirm.png)

      #### Custom popup styles

      ```
      # Display a large popup with a title and three buttons.
      result = alert(content="Choose Yes or No",
                     title="An important choice",
                     large=True,
                     buttons=[
                       ("Yes", "YES"),
                       ("No", "NO"),
                       ("Neither", None)
                     ])

      print "The user chose %s" % result
      ```

      You can customise alerts by passing extra named arguments to the `alert` (or `confirm`) function:

      \* `content` - The message to display. This can be a string or a component (see below)
      \* `title` - The title of the popup box
      \* `large` - Whether to display a wide popup (default: `False`)
      \* `buttons` - A list of buttons to display. Each item in the list
        should be a tuple <code>(<i>text</i>,<i>value</i>)</code>,
        where <code><i>text</i></code> is the text to display on the button,
        <code><i>value</i></code> is the value to return if the user clicks the button,
      \* `dismissible` - Whether this modal can be dismissed by clicking on the backdrop of the page. An alert dismissed in this way will return `None`. If there is a title, the title bar will contain an 'X' that dismisses the modal. (default: `True`)

      ![Alert popup](img/modal.png)

      #### Custom popup content

      ```python
      t = TextBox(placeholder="Email address")
      alert(content=t,
            title="Enter an email address")
      print "You entered: %s" % t.text
      ```

      You can display custom components in alerts by setting the content argument to an instance of a component instead of a string.

      For complex layouts or interaction, you can set the content to an instance of one of your own forms. To close
      the alert from code inside your form, raise the `x-close-alert` event with a `value` argument:

      `self.raise_event("x-close-alert", value=42)`

      The alert will close and return the value `42`.
    */

    /*!defFunction(anvil,_,content,[title=""],[buttons=],[large=False],[dismissible=True])!2*/ "Pop up an alert box. By default, it will have a single \"OK\" button which will return True when clicked."
    pyModule["alert"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwarray, pyContent) {
        var kwargs = {}
        for(var i = 0; i < pyKwarray.length - 1; i+=2)
            kwargs[pyKwarray[i].v] = pyKwarray[i+1];

        kwargs.content = kwargs.content || pyContent;
        kwargs.buttons = kwargs.buttons || Sk.ffi.remapToPy([
            ["OK", true, "success"],
        ]);

        return modal(kwargs);
    }));

    /*!defFunction(anvil,_,content,[title=""],[buttons=],[large=False],[dismissible=False])!2*/ "Pop up a confirmation box. By default, it will have \"Yes\" and \"No\" buttons which will return True and False respectively when clicked."
    pyModule["confirm"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwarray, pyContent) {
        var kwargs = {}
        for(var i = 0; i < pyKwarray.length - 1; i+=2)
            kwargs[pyKwarray[i].v] = pyKwarray[i+1];

        kwargs.content = kwargs.content || pyContent;
        kwargs.buttons = kwargs.buttons || Sk.ffi.remapToPy([
            ["No", false, "danger"],
            ["Yes", true, "success"],
        ]);
        kwargs.dismissible = kwargs.dismissible || Sk.ffi.remapToPy(false);

        return modal(kwargs);
    }));


    /**
    id: notifications
    docs_url: /docs/client/python/alerts-and-notifications#notifications
    title: Notifications
    description: |
      You can display temporary notifications by creating `Notification` objects.

      ![Notification screenshot](img/notification.png)

      ```python
      n = Notification("This is an important message!")
      n.show()
      ```
      
      To show a simple notification with some content, call the `show()` method.
      By default, it will disappear after 2 seconds.


      ```python
      with Notification("Please wait..."):
        # ... do something slow ...
      ```

      If you use a notification in a `with` block, it will be displayed as long as
      the body of the block is still running. It will then disappear.


      ```python
      n = Notification("This is an important message!",
                       timeout=None)
      n.show()

      # Later...
      n.hide()
      ```

      You can specify the timeout manually (in seconds), or set it to `None` or `0` to have the notification stay
      visible until you explicitly call its `hide()` method.

      ```
      Notification("A message",
                   title="A message title",
                   style="success").show()
      ```

      As well as a message, notifications can also have a title. Use the `style` 
      keyword argument to set the colour of the notification. Use `"success"` for green,
      `"danger"` for red, `"warning"` for yellow, or `"info"` for blue (default).


    */
    pyModule["Notification"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {
        var _show = function(self) {
            if (self._anvil.notification) {
                throw new Sk.builtin.Exception("Notification already visible")
            }

            self._anvil.notification = $.notify({
                message: self._anvil.message,
                title: self._anvil.title,
            }, {
                type: self._anvil.style,
                delay: self._anvil.timeout || 2000,
                timer: self._anvil.timeout == 0 ? 0 : 10,
                placement: { from: "top", align: "center" },
                mouse_over: "pause",
                onClosed: function() { self._anvil.notification = null; },
            });
        }

        /*!defMethod(,message,[title=""],[style="info"], [timeout=2])!2*/ "Create a popup notification. Call the show() method to display it."
        $loc["__init__"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwarray, self, pyMessage) {
            var kwargs = {};
            for(var i = 0; i < pyKwarray.length - 1; i+=2)
                kwargs[pyKwarray[i].v] = pyKwarray[i+1];

            self._anvil = {
                message: Sk.ffi.remapToJs(kwargs.message || pyMessage),
                title: kwargs.title ? Sk.ffi.remapToJs(kwargs.title) : undefined,
                style: kwargs.style ? Sk.ffi.remapToJs(kwargs.style) : "info",
                timeout: kwargs.timeout ? Sk.ffi.remapToJs(kwargs.timeout)*1000 : undefined,
            };

        }));

        // TODO: Decide whether we want to suspend until the notification has finished opening/closing.

        /*!defMethod(anvil.Notification instance)!2*/ "Shows the notification"
        $loc["show"] = new Sk.builtin.func(function(self) {
            _show(self);
            return self;
        });

        /*!defMethod(anvil.Notification instance)!2*/ "Show the notification when entering a 'with' block"
        $loc["__enter__"] = new Sk.builtin.func(function(self) {
            self._anvil.timeout = 0;
            _show(self);
            return self;
        });

        /*!defMethod(_)!2*/ "Hides the notification immediately"
        $loc["hide"] = new Sk.builtin.func(function(self) {
            if (self._anvil.notification && self._anvil.notification.close)
                self._anvil.notification.close();
            return Sk.builtin.none.none$;
        })

        /*!defMethod(anvil.Notification instance)!2*/ "Hide the notification when exiting a 'with' block"
        $loc["__exit__"] = $loc["hide"];

        // TODO: Support progress bars, for which we'll need the "update" method.

        /*!defClass(anvil,Notification)!*/
    }, 'Notification', []);

    // The anvil.download() function used to be here, but has moved to anvil.media.download(). The anvil.media module aliases the function back to here for backwards compatibility.

    return pyModule;
}
