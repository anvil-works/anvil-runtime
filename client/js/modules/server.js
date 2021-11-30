"use strict";

module.exports = function(appId, appOrigin) {

    var pyMod = {"__name__": new Sk.builtin.str("anvil.server")};

    var PyDefUtils = require("PyDefUtils");
    var anvil = PyDefUtils.getModule("anvil");
    var tz = PyDefUtils.getModule("anvil.tz");
    var datetime = Sk.importModule("datetime");

    pyMod["app_origin"] = Sk.ffi.remapToPy(appOrigin);

    var globalSuppressLoading = 0;

    let pyValueTypes = {};
    var pyNamedExceptions = {};

    const pyServerEventHandlers = {}; // {[event_name: string]: pyHandler[]}

    var websocket = null; // Promise of a WebSocket
    // requestId->{promise: promise, response: resp, media: {id -> {path: path, mime_type: mime_type, content: [Blob, Blob, Blob], complete: true/false}, ...}}
    var outstandingRequests = {};
    var chunkSize = 65536;
    var heartbeatTimeout = null;
    var heartbeatCount = 0;

    // Carry diagnostic information for the "server disconnected" issue
    let diagnosticData = {loadTime: +new Date(), userAgent: navigator.userAgent, events: [], requests: [], nSent: 0, nReceived: 0};
    let diagnosticRequest = (req) => {
        if (diagnosticData.requests.length > 100) {
            diagnosticData.requests = diagnosticData.requests.slice(diagnosticData.requests.length - 50);
        }
        diagnosticData.requests.push({time: +new Date(), ...req}); 
    };
    let diagnosticEvent = (type) => { 
        let evt = {type: type, time: +new Date(), nSent: diagnosticData.nSent, nReceived: diagnosticData.nReceived};
        diagnosticData.events.push(evt); 
        diagnosticRequest(evt);
    }

    function deleteOutstandingRequest(requestId) {
        delete outstandingRequests[requestId];
        if (Object.keys(outstandingRequests).length == 0) {
            clearTimeout(heartbeatTimeout);
            heartbeatTimeout = null;
        }
    }

    function pyBytesOrStr2ab(py_bytes) {
        if (Sk.__future__.python3) {
            return py_bytes.v.buffer;
        }
        const str = Sk.ffi.remapToJs(py_bytes);
        var buf = new ArrayBuffer(str.length); // 1 byte for each char
        var bufView = new Uint8Array(buf);
        for (var i=0; i < str.length; i++) {
            let c = str.charCodeAt(i)
            if (c > 255) {
                throw new Sk.builtin.ValueError("Cannot encode unicode character for transfer to server")
            }
            bufView[i] = c;
        }
        return buf;
    }

    function generateUUID(){
        var d = Date.now();
        var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = (d + Math.random()*16)%16 | 0;
            d = Math.floor(d/16);
            return (c=='x' ? r : (r&0x3|0x8)).toString(16);
        });
        return uuid;
    };

    var maybeRemapToPy = Sk.ffi.remapToPy;

    var deserialiseObject = function(obj, mediaBlobs, knownLiveObjectMethods) {
        var handlers = {
            "Primitive": function() {
                return maybeRemapToPy(obj.value);
            },
            "DataMedia": function() {
                var blob = mediaBlobs[obj.id];
                return Sk.misceval.callsim(anvil.tp$getattr(new Sk.builtin.str("DataMedia")), new Blob(blob.content, {type: blob.mime_type}), obj.name);
            },
            "LazyMedia": function() {
                return Sk.misceval.callsim(anvil.tp$getattr(new Sk.builtin.str("LazyMedia")), obj);
            },
            "LiveObject": function() {
                for (var item in obj.itemCache || {}) {
                    obj.itemCache[item] = deserialiseObject(obj.itemCache[item], mediaBlobs, knownLiveObjectMethods);
                }
                if (obj.iterItems && obj.iterItems.items) {
                    var deserialisedItems = [];
                    for (var i in obj.iterItems.items || []) {
                        var item = obj.iterItems.items[i];
                        deserialisedItems.push(deserialiseObject(item, mediaBlobs, knownLiveObjectMethods));
                    }
                    obj.iterItems.items = deserialisedItems;
                }
                if (obj.methods) {
                    knownLiveObjectMethods[obj.backend] = obj.methods;
                } else {
                    obj.methods = knownLiveObjectMethods[obj.backend];
                }
                return Sk.misceval.callsim(anvil.tp$getattr(new Sk.builtin.str("LiveObjectProxy")), obj);
            },
            "Capability": () => {
                return new pyMod["Capability"](obj.scope, obj.mac, null);
            },
            "ValueType": () => {
                return obj.typeName;
            },
            "Date": function() {

                var m = moment(obj.value);
                var dateArray = m.toArray();
                
                // Moments have 1-indexed months
                dateArray[1] += 1;


                return Sk.misceval.apply(datetime.tp$getattr(new Sk.builtin.str("date")),undefined, undefined, undefined, Sk.ffi.remapToPy(dateArray.slice(0,3)).v);
            },
            "DateTime": function() {

                // Chop off the timezone and parse it as though it were UTC, then add back the timezone later (ew)
                var withoutTimezone = (""+obj.value).replace(/(\+|-)\d\d:?\d\d$/, "");
                var m = moment.utc(withoutTimezone);
                var dateArray = m.toArray();

                let frac = /\.(\d*)$/.exec(withoutTimezone);
                if (frac && frac.length > 1) {
                    while (frac[1].length < 6)
                        frac[1] += "0";
                    dateArray[6] = parseInt(frac[1]);
                } else {
                    // Moments only store milliseconds, python works in microseconds. If we couldn't parse out the microseconds, take whatever Moment.js can give us.
                    dateArray[6] *= 1000;
                }

                // Moments have 0-indexed months, python is 1-indexed
                dateArray[1] += 1;

                // Is there a timezone in this stamp?
                // We *always* add a tzoffset. If the incoming datetime is naive, it will get stamped UTC.
                var offset = obj.value.match(/(\+|-)\d\d:?\d\d$/);
                var utcOffsetMinutes = offset ? moment().utcOffset(offset[0]).utcOffset() : 0;

                var tzoffset = Sk.misceval.call(tz.tp$getattr(new Sk.builtin.str("tzoffset")),undefined, undefined, [Sk.ffi.remapToPy("minutes"), Sk.ffi.remapToPy(utcOffsetMinutes)]);

                var dt = Sk.misceval.apply(datetime.tp$getattr(new Sk.builtin.str("datetime")), undefined, undefined, undefined, Sk.ffi.remapToPy(dateArray).v.concat([tzoffset]));
                return dt;
            },
            "Long": function() {
                return new Sk.builtin.int_(obj.value);
            },
            "Float": function() {
                return new Sk.builtin.float_(parseFloat(obj.value));
            },
        };

        var reconstructed;
        for (var j in obj.type) {
            var h = handlers[obj.type[j]];
            if (h) { reconstructed = h(); break; }
        }

        if (!reconstructed) {
            throw new Sk.builtin.TypeError("Cannot return object of type '" + (obj.type && obj.type[0]) + "' from server call");
        }
        
        return reconstructed;        
    }

    var reconstructObjects = async function(json, mediaBlobs) {

        var objs = json.objects;
        var knownLiveObjectMethods = {};

        let pyVtGlobals = Sk.builtin.none.none$;

        for (var i in objs) {
            var obj = objs[i];

            var reconstructed = deserialiseObject(obj, mediaBlobs, knownLiveObjectMethods);

            if (obj.path.length < 1) {
                console.error("Cannot reconstruct zero-length path; ignoring");
                continue;
            }

            var o = json;
            var lastO = undefined;
            var key = null;

            for (var j in obj.path) {
                key = obj.path[j];
                lastO = o;
                o = o[key];
            }

            if (obj.type.indexOf("ValueType") > -1) {

                let pyObj;

                let pyValueType = pyValueTypes[reconstructed];

                if (!pyValueType) {
                    let mod = reconstructed.match(/^(.+)\.[^\.]+$/);
                    if (mod) {
                        Sk.misceval.retryOptionalSuspensionOrThrow(Sk.importModule(mod[1], false, true));
                        pyValueType = pyValueTypes[reconstructed];
                    }
                    if (!pyValueType) {
                        throw Sk.misceval.callsim(pyMod['SerializationError'], new Sk.builtin.str("No such serializable type: "+reconstructed));
                    }
                }

                if (obj.path[0] !== "vt_global" && pyVtGlobals === Sk.builtin.none.none$) {
                    pyVtGlobals = maybeRemapToPy(json['vt_global'] || {});
                }

                let pyNewDeserialised = pyValueType.tp$getattr(new Sk.builtin.str("__new_deserialized__"));

                if (pyNewDeserialised) {
                    pyObj = Sk.misceval.callsimOrSuspend(pyNewDeserialised, maybeRemapToPy(lastO[key]), pyVtGlobals);
                    if (pyObj.$isSuspension) {
                        pyObj = await Sk.misceval.asyncToPromise(() => pyObj);
                    }
                } else {
                    const newMethod = Sk.abstr.typeLookup(pyValueType, Sk.builtin.str.$new);
                    pyObj = Sk.misceval.callsim(newMethod, pyValueType);
                    let pyDeserialize = pyObj.tp$getattr(new Sk.builtin.str("__deserialize__"));
                    if (pyDeserialize) {
                        let r = Sk.misceval.callsimOrSuspend(pyDeserialize, maybeRemapToPy(lastO[key]), pyVtGlobals);
                        if (r.$isSuspension) { await Sk.misceval.asyncToPromise(() => r); }
                    } else {
                        Sk.misceval.callsim(pyObj.$d.tp$getattr(new Sk.builtin.str("update")), maybeRemapToPy(lastO[key]));
                    }
                }

                lastO[key] = pyObj;

            } else {
                if (lastO[key] !== null && lastO[key] !== undefined) {
                    console.error("Object reconstruction replacing something that's not a null leaf!", lastO[key]);
                }
                lastO[key] = reconstructed;
            }
        }
        return json;
    };

    // Rules for talking to the server:
    // Blobs go *after* a CALL.
    // Blobs MAY (but are not by this implementation) be omitted from retries
    // if they are known to have been transmitted successfully.
    // All blobs and calls are transmitted in order (so the server doesn't have to
    // do any wackadoodle reassembly)

    var connect = function(profile) { // return promise of a WebSocket

        if (websocket == null) {
            if (profile) var connectProfile = profile.append("Connect websocket");
            var deferred = RSVP.defer();

            websocket = deferred.promise;

            var ws = new WebSocket(appOrigin.replace(/^http/, "ws") + "/_/ws/" + (window.anvilParams.accessKey || '') + "?s=" + window.anvilSessionToken);
            window.anvilWebsocket = ws;
            var heartbeatInterval = null;

            ws.onopen = function() {
                diagnosticEvent("connected");
                if (profile) connectProfile.end();

                // Start keepalive heartbeat
                clearInterval(heartbeatInterval);
                heartbeatInterval = setInterval(() => {
                    try {
                        ws.send(JSON.stringify({
                            type: "CALL",
                            id: "client-keepalive-" + (heartbeatCount++),
                            command: "anvil.private.echo",
                            args: ["keep-alive"],
                            kwargs: {},                            
                        }));
                    } catch (e) { console.error("Failed to send client keepalive.", e); }
                }, 5000);

                deferred.resolve(ws); 
            };

            let onclose = function(evt) {
                // Stop keepalive heartbeat
                clearInterval(heartbeatInterval);
                if (websocket == deferred.promise) { websocket = null; }
                deferred.reject.apply(deferred, arguments);

                // Let all outstanding requests (on the closed websocket) know that they should either retry or fail
                for (var i in outstandingRequests) {
                    if (outstandingRequests[i].ws == evt.target || outstandingRequests[i].ws == null) {
                        outstandingRequests[i].onerror(evt);
                    }
                }
            };
            ws.onclose = function(evt) { diagnosticEvent("closed"); console.log("WebSocket closed", arguments); onclose.apply(null, arguments); }
            ws.onerror = function(evt) { diagnosticEvent("error"); console.log("WebSocket error", arguments); onclose.apply(null, arguments); }

            var nextBlobLocation = null, nextBlobRequestId = null;

            var assembleException = function(d) {
                var exceptionType = pyNamedExceptions[d.error.type] || pyMod["AnvilWrappedError"];
                var exception = Sk.misceval.callsim(exceptionType, new Sk.builtin.str(d.error.message || "[unexpected error]"));

                if (d.error.trace && exception.traceback) {
                    for (var i = 0; i < d.error.trace.length; i++) {
                        exception.traceback.push({filename: d.error.trace[i][0], lineno: d.error.trace[i][1], fromServer: true});
                    }
                }
                exception._anvil = { errorObj: d.error };
                return exception;
            };

            var maybeHandleResponse = async function(id) {
                var req = outstandingRequests[id];
                diagnosticRequest({id: id, response: !!req.response});
                if (!req) {
                    console.error("maybeHandleResponse() called for unknown request ID " + d.id);
                    return;
                }

                for (var i in req.media) {
                    if (!req.media[i].complete) {
                        return;
                    }
                }
                if (req.receiveBlobsProfile) {
                    req.receiveBlobsProfile.end();
                }
                delete req.receiveBlobsProfile;

                if (!req.suppressLoading)
                    window.setLoading(false);
                deleteOutstandingRequest(id);

                var reconstructProfile = req.profile.append("Reconstruct objects");

                if ("response" in req.response) {
                    try {
                        await reconstructObjects(req.response, req.media);
                        
                        // Legacy LiveObject updates
                        if ("cacheUpdates" in req.response) {
                            for (let backend in req.response.cacheUpdates) {
                                let updates = req.response.cacheUpdates[backend];
                                let kli = req.knownLiveObjectInstances[backend];
                                if (kli) {
                                    for (let id in updates) {
                                        let klis = kli[id];
                                        if (klis) {
                                            for(let spec of klis) {
                                                spec.itemCache = {};
                                                for (var item in updates[id]) {
                                                    spec.itemCache[item] = maybeRemapToPy(updates[id][item]);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Collect these in JS where it's easier
                        let capUpdateChain = [undefined];

                        if ("capUpdates" in req.response) {
                            // Normalise the keys to how *this* browser does JSON (ew)
                            let updates = {};
                            for (let i in req.response.capUpdates) {
                                updates[JSON.stringify(JSON.parse(i))] = req.response.capUpdates[i];
                            }

                            console.log("Capability updates:", updates)
                            for (let pyCap of req.knownCapabilities) {
                                const scopeJson = pyCap._JSONScope;
                                if (scopeJson in updates) {
                                    console.log("Update for", scopeJson)
                                    capUpdateChain.push(
                                        () => pyCap._applyUpdate(maybeRemapToPy(updates[scopeJson]))
                                    );
                                } else {
                                    console.log("No update for", scopeJson)
                                }
                            }
                            await Sk.misceval.asyncToPromise(() => Sk.misceval.chain.apply(null, capUpdateChain));
                        }

                        //console.log("Response came back for RPC request " + id + ": ", req.response);
                        let pyResponse = maybeRemapToPy(req.response.response);

                        req.profile.response = req.response;
                        req.profile.print();
                        req.promise.resolve(pyResponse);
                    } catch(e) {
                        req.promise.reject(e);
                    }
                } else if ('error' in req.response) {
                    req.profile.print();
                    req.promise.reject(assembleException(req.response));
                } else {
                    req.promise.reject(new Sk.builtin.RuntimeError("Invalid RPC response"));
                    console.error("Response came back without 'response' or 'error' keys: ", d);
                }
            }

            ws.onmessage = function(e) {

                diagnosticData.nReceived++;

                if (e.data instanceof Blob || e.data instanceof ArrayBuffer) {
                    if (nextBlobLocation) {
                        nextBlobLocation.content.push(e.data);
                        maybeHandleResponse(nextBlobRequestId);
                    }
                    nextBlobLocation = nextBlobRequestId = null;
                    return;
                }

                var d = JSON.parse(e.data);

                if (d.type == "CHUNK_HEADER") {
                    var req = outstandingRequests[d.requestId];
                    var media = req && req.media[d.mediaId];
                    if (!media) {
                        console.error("Got binary chunk for unknown request ID " + d.requestId + " / media ID " + d.mediaId);
                        return;
                    }

                    if (!req.receiveBlobsProfile) {
                        req.receiveBlobsProfile = req.profile.append("Receive blobs");
                    }

                    nextBlobLocation = media;
                    nextBlobRequestId = d.requestId;
                    media.complete = d.lastChunk;

                } else if (d.id && ("response" in d || "error" in d)) { // response

                    if (d.id.startsWith("client-keepalive")) {
                        return;
                    }

                    var req = outstandingRequests[d.id];
                    if (!req) {
                        console.error("Got response for unknown request ID "+d.id);
                        return;
                    }
                    req.response = d;
                    req.media = {};
                    for (var i in d.objects) {
                        var m = d.objects[i];
                        if (!m.type || m.type[0] != "DataMedia") { continue; }
                        req.media[m.id] = {mime_type: m["mime-type"], path: m["path"], content: []};
                    }

                    if (d.profile) {
                        var f = function f(p,d) {
                            var q = p.append(d["description"], d["start-time"], d["end-time"]);
                            q.origin = d["origin"];
                            for (var i in d["children"]) {
                                f(q,d["children"][i]);
                            }
                        }
                        f(req.profile, d.profile);
                    }

                    maybeHandleResponse(d.id);

                } else if (d.event) {
                    // TODO: Deserialise response.
                    console.log("Server event: ", d);
                    let handlers = pyServerEventHandlers[d.event.name];
                    if (handlers) {
                        let chainFns = handlers.map((pyHandler) => () => PyDefUtils.pyCallOrSuspend(pyHandler, [Sk.ffi.remapToPy(d.event.payload)], []));
                        PyDefUtils.asyncToPromise(() => Sk.misceval.chain(Sk.builtin.none.none$, ...chainFns));
                    }
                } else if (d.output) {
                    Sk.output(d.output, true); // The "true" is a Anvil-proprietary thing to mark this as from the server
                } else if (d['set-cookie']) { 
                    $.post(appOrigin + "/_/request_cookies?s=" + window.anvilSessionToken);
                } else if (d.error) {
                    window.onerror(undefined, undefined, undefined, undefined, assembleException(d));
                } else {
                    console.log("Unknown message from server: ", d);
                }
            };
        }

        return websocket;
    };

    var trySend = function(jsonData, blobData, profile, outstandingRequest) {
        return new Promise(function(resolve, reject) {
            connect(profile).then(function(ws) {
                if (outstandingRequest) {
                    outstandingRequest.ws = ws;
                }
                if (profile) var w = profile.append("Send to websocket");

                if (profile) var p = w.append("Send JSON Data");
                ws.send(JSON.stringify(jsonData));
                diagnosticData.nSent++;
                if (profile) p.end();

                if (blobData) {
                    if (profile) var q = w.append("Send blob data");
                    ws.send(blobData);
                    if (profile) q.end;
                }

                setTimeout(function r() {
                    if (ws.bufferedAmount == 0) {
                        if (profile) w.end();
                        resolve();
                    } else {
                        //console.log("WebSocket still buffering.")
                        setTimeout(r, 1);
                    }
                }, 1);
            });

            // No catch. WebSocket onclose or onerror handles that for us.
        });
    }

    var sendLog = function(logData) {
        logData.type = "LOG";
        if (logData.error) { logData.error.wsdata = diagnosticData; }
        connect().then(function(ws) {
            ws.send(JSON.stringify(logData));
        }).catch(function() {
            console.log("SendLog failed; Should resend via HTTP", logData)
        });
    }


    var pythonifyPath = function(path) {
        var s = "";
        for (var i in path) {
            s += "[" + JSON.stringify(path[i]) + "]";
        }
        return s;
    };

    // Remap from python to js, extracting all non-JSON-able bits
    var remapToJSPlusMappings = function(obj, keySeq, mappingsToPush, pyGlobalData) {
        if (obj.constructor && obj.constructor.anvil$serializableName) {
            let cls = Sk.builtin.type(obj);
            let typeName = cls.anvil$serializableName;

            if (!typeName || !(typeName in pyValueTypes)) {
                let name = obj.tp$name || "[unknown]";
                throw Sk.misceval.callsim(pyMod['SerializationError'],
                    new Sk.builtin.str(`Type ${name} is not registered with @anvil.server.portable_class.`));
            }

            let ms = [];
            let pyRet;
            let pySerialize = obj.tp$getattr(new Sk.builtin.str("__serialize__"));
            if (pySerialize) {
                pyRet = Sk.misceval.callsim(pySerialize, pyGlobalData);
            } else {
                pyRet = obj.tp$getattr(new Sk.builtin.str("__dict__"));
            }
            let ret = remapToJSPlusMappings(pyRet, keySeq, ms, pyGlobalData);
            mappingsToPush.push(...ms);
            mappingsToPush.push({path: keySeq.slice(), value: obj});
            return ret;
        } else if (obj instanceof Sk.builtin.dict) {
            let ret = {};
            for (var iter = obj.tp$iter(), k = iter.tp$iternext(); k !== undefined; k = iter.tp$iternext()) {

                if (!(k instanceof Sk.builtin.str)) {
                    throw new Sk.builtin.TypeError("Cannot use '" + k.tp$name + "' objects as the key in a dict when sending to a server-side module; only string keys are allowed (arguments"+pythonifyPath(keySeq)+")");
                }
                var jsk = Sk.ffi.remapToJs(k);
                keySeq.push(jsk);
                ret[jsk] = remapToJSPlusMappings(obj.mp$subscript(k), keySeq, mappingsToPush, pyGlobalData);
                keySeq.pop();
            }
            return ret;
        } else if (obj instanceof Sk.builtin.list || obj instanceof Sk.builtin.tuple) {
            let ret = [];
            for (var i=0; i < obj.v.length; i++) {
                keySeq.push(i);
                ret.push(remapToJSPlusMappings(obj.v[i], keySeq, mappingsToPush, pyGlobalData));
                keySeq.pop();
            }
            return ret;
        } else if (obj instanceof Sk.builtin.bool) {
            return obj.v ? true : false;
        } else if (obj instanceof Sk.builtin.str) {
            return obj.v;
        } else if (obj instanceof Sk.builtin.int_) {
            const val = obj.v;
            if (typeof val === "number") {
                return val;
            }
            mappingsToPush.push({path: keySeq.slice(), value: new Sk.builtin.lng(val)});
            return null;
        } else if (obj instanceof Sk.builtin.float_ && obj != Infinity && obj != -Infinity && !isNaN(obj)) {
            return Sk.builtin.asnum$(obj);
        } else if (obj instanceof Sk.builtin.none) {
            return null;
        } else if (typeof obj === "string") {
            return obj;
        } else if (typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype) {
            let ret = {};
            for (var i in obj) {
                keySeq.push(i);
                ret[i] = remapToJSPlusMappings(obj[i], keySeq, mappingsToPush, pyGlobalData);
                keySeq.pop();
            }
            return ret;
        } else if(obj instanceof Array) {
            let ret = []
            for (var i=0; i < obj.length; i++) {
                keySeq.push(i);
                ret.push(remapToJSPlusMappings(obj[i], keySeq, mappingsToPush, pyGlobalData));
                keySeq.pop();
            }
            return ret;
        } else {
            // Not JSONable
            mappingsToPush.push({path: keySeq.slice(), value: obj});
            return null;
        }
    };

    var profilePrintColor = "transparent";
    function profileStart(desc, startTime) {
        var p = {
            description: desc,
            startTime: startTime || Date.now(),
            children: [],
        };

        p.append = function(desc, startTime, endTime) {
            var q = profileStart(desc, Math.round(startTime));

            if (endTime) {
                q.endTime = Math.round(endTime);
                q.duration = q.endTime - q.startTime;
            }

            p.children.push(q);
            return q;
        }

        p.end = function() {
            if (!p.endTime) {
                for (var i in p.children) {
                    p.children[i].end();
                }
                p.endTime = Date.now();
                p.duration = p.endTime - p.startTime;
            }
        }

        p.print = function() {
            p.end();
            var oldPrintColor = profilePrintColor;

            if (p.origin == "Server (Native)") {
                profilePrintColor = "#cfc";
            } else if (p.origin == "Server (Python)") {
                profilePrintColor = "#ffb";
            }

            if (console.groupCollapsed) {
                var childDuration = 0;
                for (var i in p.children) {
                    childDuration += p.children[i].duration;
                }
                var msg = p.description + " (" + p.duration + " ms";
                if (p.children.length > 0) {
                    msg += ", " + (p.duration - childDuration) + " ms lost)";

                    console.groupCollapsed("%c" + msg, "background:" + profilePrintColor);
                    for (var i in p.children) {
                        p.children[i].print();
                    }
                    if (p.response) {
                        console.log("%cResponse:", "background:#ddd;",p.response);
                    }
                    console.groupEnd();
                } else {
                    msg += ")";
                    console.log("%c" + msg, "background:" + profilePrintColor);
                }
            } else {
                console.log(p);
            }
            profilePrintColor = oldPrintColor;
        }
        return p;
    }

    function doRpcCall(pyKwargs, args, commandOrMethod, liveObjectSpec, suppressLoading) {

        if (!navigator.onLine) {
            // if we're offline we can't make this call
            // throw an error that can be caught by the custom error handler
            throw PyDefUtils.pyCall(pyMod["AppOfflineError"], [new Sk.builtin.str("App is offline")]);
        }

        suppressLoading = suppressLoading || (globalSuppressLoading > 0);

        // Get a JS map of non-transformed python kwargs. Ugh.
        // This will be remapped to JS manually below.
        var kwargs = {}
        for(var i = 0; i < pyKwargs.length - 1; i+=2)
            kwargs[pyKwargs[i].v] = pyKwargs[i+1];


        var requestId = generateUUID();
        var profile = profileStart("RPC Request");

        var mappingProfile = profile.append("Call mapping");

        // Extract what needs to be blobbed;
        var mappings = [];
        var knownLiveObjectInstances = {};
        let knownCapabilities = [];
        let pyValueTypeGlobalData = new Sk.builtin.dict();
        var call = remapToJSPlusMappings({
            type: "CALL",
            id: requestId,
            args: args,
            kwargs: kwargs,
            objects: [],
        }, [], mappings, pyValueTypeGlobalData);

        let gdMappings = [];
        call['vt_global'] = remapToJSPlusMappings(pyValueTypeGlobalData, ["vt_global"], gdMappings, Sk.builtin.none.none$);
        mappings.unshift(...gdMappings);

        if (liveObjectSpec) {
            call.liveObjectCall = {method: commandOrMethod, id: liveObjectSpec.id, backend: liveObjectSpec.backend, permissions: liveObjectSpec.permissions, mac: liveObjectSpec.mac};
            knownLiveObjectInstances[liveObjectSpec.backend] = {[liveObjectSpec.id]: [liveObjectSpec]};
        } else if(commandOrMethod) {
            call.command = commandOrMethod;
        } else {
            throw new Sk.builtin.TypeError("anvil.server.call() requires at least one parameter");
        }

        diagnosticRequest({id: requestId, call: (call.command || (call.liveObjectCall.backend + ":" + call.liveObjectCall.method))});

        var blobContent = []; // array of arrays: [[{json: chunk header, data: DataView}...]]
        var knownLiveObjectMethods = {};

        // Check that everything that wasn't JSONable was suitable for RPC transfer
        for (var i=0; i < mappings.length; i++) {
            var mapping = mappings[i];

            var is = function(pyV, pyType) {
                return pyV && pyV.sk$object && Sk.builtin.isinstance(pyV, pyType).v;
            }

            if (mapping.value.$anvil_isLazyMedia) {
                var spec = mapping.value._spec;
                var o = $.extend({}, spec);
                o['path'] = mapping.path;
                call.objects.push(o);

            } else if (is(mapping.value, anvil.tp$getattr(new Sk.builtin.str("Media")))) {
                // It's media
                call.objects.push(
                    RSVP.all([Sk.misceval.callAsync({}, mapping.value.tp$getattr(new Sk.builtin.str("get_content_type"))),
                              Sk.misceval.callAsync({}, mapping.value.tp$getattr(new Sk.builtin.str("get_bytes"))),
                              Sk.misceval.callAsync({}, mapping.value.tp$getattr(new Sk.builtin.str("get_name"))),
                              Promise.resolve(mapping.path)]
                            ).then(function(i, r) {

                        var mimeType = Sk.ffi.remapToJs(r[0]);
                        var buffer = pyBytesOrStr2ab(r[1]); // we want a binary string here
                        var name = Sk.ffi.remapToJs(r[2]);
                        var path = r[3];

                        var contentChunks = [];

                        var nextOffset = 0;
                        var nextChunkIndex = 0;

                        var mediaId = requestId + "_" + i;

                        while (true) {

                            var thisChunk = {
                                type: "CHUNK_HEADER",
                                requestId: requestId,
                                mediaId: mediaId,
                                chunkIndex: nextChunkIndex++
                            }

                            if (!window.isIE) {
                                var chunkView = new DataView(buffer, nextOffset, Math.min(chunkSize, buffer.byteLength - nextOffset));
                            } else {
                                console.log("ON IE - Using inefficient buffer copying");
                                var chunkView = buffer.slice(nextOffset, nextOffset + Math.min(chunkSize, buffer.byteLength - nextOffset));
                            }

                            nextOffset+= chunkSize

                            if (nextOffset >= buffer.byteLength) {
                                thisChunk.lastChunk = true;
                            }

                            contentChunks.push({json: thisChunk, data: chunkView});

                            if (nextOffset >= buffer.byteLength)
                                break;
                        }

                        blobContent.push(contentChunks);
                        return {
                            path: path,
                            id: mediaId,
                            name: name,
                            "mime-type": mimeType,
                            "type": ["DataMedia"],
                        };

                    }.bind(this, i))
                );
            } else if (is(mapping.value, anvil.tp$getattr(new Sk.builtin.str("LiveObjectProxy")))) {
                var _spec = mapping.value._spec;
                var o = {
                    backend: _spec.backend,
                    id: _spec.id,
                    permissions: _spec.permissions,
                    mac: _spec.mac,
                    path: mapping.path,
                    type: ["LiveObject"],
                };

                // Slightly sneaky - we'll have object identity from the same optimisation on the server
                if (_spec.methods!==knownLiveObjectMethods[o.backend]) {
                    o.methods = _spec.methods;
                    knownLiveObjectMethods[o.backend] = _spec.methods;
                }

                // Record this instance so we can blat its cache if we need to
                let kli = knownLiveObjectInstances[o.backend];
                if (kli === undefined) { kli = knownLiveObjectInstances[o.backend] = {}; }
                let klis = kli[o.id];
                if (klis === undefined) { klis = kli[o.id] = []; }
                klis.push(_spec);

                call.objects.push(o);
            } else if (is(mapping.value, pyMod['Capability'])) {
                let o = {
                    scope: mapping.value._scope,
                    narrow: mapping.value._narrow,
                    mac: mapping.value._mac,
                    path: mapping.path,
                    type: ["Capability"],
                };

                knownCapabilities.push(mapping.value);

                call.objects.push(o);
            } else if (is(mapping.value, datetime.tp$getattr(new Sk.builtin.str("datetime")))) {

                var tzinfo = mapping.value.tp$getattr(new Sk.builtin.str("tzinfo"));
                var naive = tzinfo == Sk.builtin.none.none$ || 
                            Sk.misceval.callsim(tzinfo.tp$getattr(new Sk.builtin.str("utcoffset")), mapping.value) == Sk.builtin.none.none$;

                if (naive) {
                    // Stamp with the local timezone offset of the browser.
                    var tzinfo = Sk.misceval.call(tz.tp$getattr(new Sk.builtin.str("tzoffset")), undefined, undefined, ["minutes", Sk.ffi.remapToPy(-(new Date().getTimezoneOffset()))]);
                    var awareDT = Sk.misceval.call(mapping.value.tp$getattr(new Sk.builtin.str("replace")), undefined, undefined, ["tzinfo", tzinfo]);
                } else {
                    var awareDT = mapping.value;
                }

                var strftime = awareDT.tp$getattr(new Sk.builtin.str("strftime"));
                var pyStr = Sk.misceval.callsim(strftime, Sk.ffi.remapToPy("%Y-%m-%d %H:%M:%S.%f%z"));
                call.objects.push({
                    path: mapping.path,
                    type: ["DateTime"],
                    value: Sk.ffi.remapToJs(pyStr),
                });
            } else if (is(mapping.value, datetime.tp$getattr(new Sk.builtin.str("date")))) {

                var strftime = mapping.value.tp$getattr(new Sk.builtin.str("strftime"));
                var pyStr = Sk.misceval.callsim(strftime, Sk.ffi.remapToPy("%Y-%m-%d"));
                call.objects.push({
                    path: mapping.path,
                    type: ["Date"],
                    value: Sk.ffi.remapToJs(pyStr),
                });
            } else if (mapping.value instanceof Sk.builtin.lng) { 
                var s = Sk.misceval.callsim(mapping.value.tp$getattr(new Sk.builtin.str("__repr__"))).v;
                s = s.substring(0, s.length-1);
                call.objects.push({
                    path: mapping.path,
                    type: ["Long"],
                    value: s,
                });
            } else if (mapping.value instanceof Sk.builtin.float_) { 
                call.objects.push({
                    path: mapping.path,
                    type: ["Float"],
                    value: ""+mapping.value.v,
                });
            } else {

                let cls = Sk.builtin.type(mapping.value);
                let typeName = cls.anvil$serializableName;

                if (typeName) {
                    call.objects.push({
                        path: mapping.path,
                        type: ["ValueType"],
                        typeName: typeName,
                    });
                } else {
                    // We can even tell the user where the bad object was!
                    var e = new Sk.builtin.TypeError("Cannot pass " + (mapping.value ? mapping.value.tp$name : "unexpected") + " object to a server function: arguments" + pythonifyPath(mapping.path.slice(1)));
                    e._anvil = {
                        errorObj: {
                            type: "AnvilSerializationError",
                        }
                    }
                    throw e;
                }
            }

        }

        mappingProfile.end();

        return PyDefUtils.suspensionPromise(function(resolve, reject) {

            if (!suppressLoading)
                window.setLoading(true);

            if (blobContent.length > 0) {
                var realiseBlobsProfile = profile.append("Realise blobs");
            }

            RSVP.all(call.objects).then(function makeRequest(realisedObjects) {
                if (realiseBlobsProfile) {
                    realiseBlobsProfile.end();
                }

                call.objects = realisedObjects;

                var preventRetry = false;

                console.debug("RPC request: " + (call.command || (call.liveObjectCall.backend + ":" + call.liveObjectCall.method)), call);
                //console.debug("BLOBS:", blobs);


                var sendPromise = Promise.resolve();
                let nWaiting = 0;

                for (var id in outstandingRequests) {
                    nWaiting++;
                    sendPromise = sendPromise.then(function() {
                        return new Promise(function(resolve, reject) {
                            if (id in outstandingRequests) {
                                var oldResolve = outstandingRequests[id].promise.resolve;
                                var oldReject = outstandingRequests[id].promise.reject;
                                outstandingRequests[id].promise.resolve = function() {
                                    resolve();
                                    oldResolve.apply(this, arguments)
                                }
                                outstandingRequests[id].promise.reject = function() {
                                    resolve();
                                    oldReject.apply(this, arguments)
                                }
                            } else {
                                resolve();
                            }
                        }).catch(function(ee) {
                            console.error(ee);
                        });
                    });
                }

                outstandingRequests[requestId] = {media: {}, promise: {resolve: resolve, reject: reject},
                                                    suppressLoading: suppressLoading,
                                                    knownLiveObjectInstances: knownLiveObjectInstances,
                                                    knownCapabilities: knownCapabilities,
                                                    onerror: function(evt) {
                    // TODO be a bit more clever about retries here when preventRetry is true

                    if (!suppressLoading)
                        window.setLoading(false);
                    deleteOutstandingRequest(requestId)
                    console.error("Websocket connection failed", evt);
                    if (window.navigator.onLine) {
                        // we have a problem - the navigator says we're online
                        window.anvilOnline.onLine = false;
                        window.anvilOnline.serviceWorkerAgrees = false;
                        window.anvilOnline.lastCheck = Date.now();
                    }
                    const msg = `Connection to server failed (${
                        (evt && (evt.code || evt.message || evt.type)) || "FAIL"
                    })`;
                    reject(PyDefUtils.pyCall(pyMod["AppOfflineError"], [new Sk.builtin.str(msg)]));
                }, profile: profile};

                var sendProfile = profile.append("Send call");
                if (nWaiting !== 0) {
                    let waitingProfile = sendProfile.append("Waiting for " + nWaiting + " previous call(s) to complete");
                    sendPromise = sendPromise.then(() => waitingProfile.end());
                }

                sendPromise = sendPromise.then(trySend.bind(null, call, null, sendProfile, outstandingRequests[requestId])).then(function() {

                    sendProfile.end();
                    if (blobContent.length > 0) {
                        sendProfile = profile.append("Send blobs");
                    }
                    // If we don't already have a heartbeat scheduled
                    if (!heartbeatTimeout) {
                        heartbeatTimeout = setTimeout(function heartbeat() {

                            trySend({
                                type: "CALL",
                                id: "client-keepalive-" + (heartbeatCount++),
                                command: "anvil.private.echo",
                                args: ["keep-alive"],
                                kwargs: {},                            
                            })

                            heartbeatTimeout = false;
                            // If we still have outstanding requests, schedule the next heartbeat.
                            if (Object.keys(outstandingRequests).length > 0) {
                                heartbeatTimeout = setTimeout(heartbeat, 30000);
                            }
                        }, 30000);
                    }

                });

                for (let contentChunks of blobContent) {
                    for (let chunk of contentChunks) {
                        sendPromise = sendPromise.then(trySend.bind(null, chunk.json, chunk.data, sendProfile, outstandingRequests[requestId]));
                    }
                }

                sendPromise = sendPromise.then(function(r) {
                    sendProfile.end();
                    return r;
                })

                return sendPromise;
            }, function(e) {
                if (!suppressLoading)
                    window.setLoading(false);
                deleteOutstandingRequest(requestId)
                reject(e);
            });


        });
    };

    pyMod["call_$rw$"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs, pyCmd) {

        // First, let's get the JSON we want to send, plus blobs

        var args = Array.prototype.slice.call(arguments, 2);

        return doRpcCall(pyKwargs, args, Sk.ffi.remapToJs(pyCmd));
    }));

    pyMod["call_s"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs, pyCmd) {

        // First, let's get the JSON we want to send, plus blobs

        var args = Array.prototype.slice.call(arguments, 2);

        return doRpcCall(pyKwargs, args, Sk.ffi.remapToJs(pyCmd), undefined, true);
    }));

    pyMod["launch_background_task"] = new Sk.builtin.func(PyDefUtils.withRawKwargs((pyKwargs, pyCmd, ...args) => {
        throw new Sk.builtin.RuntimeError("Cannot launch Background Tasks from client code.");
    }));

    pyMod["__anvil$doRpcCall"] = doRpcCall; // Ew.

    pyMod["LazyMedia"] = anvil.tp$getattr(new Sk.builtin.str("LazyMedia")); // Also Ew.

    // This class is deprecated - no need to subclass it any more.
    pyMod["Serializable"] = Sk.misceval.buildClass(pyMod, ($gbl, $loc) => {
    }, "Serializable", [Sk.builtin.object]);

    pyMod["portable_class"] = pyMod["serializable_type"] = new Sk.builtin.func((pyClass, pyName) => {
        let doRegister = (pyClass, pyName) => {
            let typeName = pyName ? pyName.v : null;
            if (!typeName) {
                const module_ = Sk.abstr.lookupSpecial(pyClass, Sk.builtin.str.$module);
                const name_ = Sk.abstr.lookupSpecial(pyClass, Sk.builtin.str.$name);
                typeName = `${module_}.${name_}`;
            }
            pyClass.anvil$serializableName = typeName;
            pyValueTypes[typeName] = pyClass;
            return pyClass;
        };

        if (pyName === undefined && pyClass instanceof Sk.builtin.str) {
            pyName = pyClass
            return new Sk.builtin.func((pyClass) => doRegister(pyClass, pyName));
        } else {
            return doRegister(pyClass, pyName);
        }
    });

    const _CapAny = Sk.abstr.buildNativeClass("_CapAny", {
        constructor: function () {},
        slots: {
            $r() {
                return new Sk.builtin.str("ANY");
            },
        },
    });
    const _ANY = Object.create(_CapAny.prototype);


    pyMod["Capability"] = Sk.abstr.buildNativeClass("anvil.server.Capability", {
        constructor: function Capability(scope, mac, narrow) {
            this._scope = scope;
            this._mac = mac;
            this._narrow = narrow || (narrow = []);
            this._localTag = null;
            const fullScope = scope.concat(narrow);
            this._fullScope = fullScope;
            this._JSONScope = JSON.stringify(fullScope);
            this._doApplyUpdate = null;
            this._applyUpdate = (pyUpdate) => {
                if (!this._doApplyUpdate) {
                    return Sk.builtin.none.none$;
                }
                return PyDefUtils.pyCallOrSuspend(this._doApplyUpdate, [pyUpdate]);
            };
            let pyFullScope;
            Object.defineProperties(this, {
                _pyFullScope: {
                    get() {
                        // always return a different object so that it can be changed in python.
                        pyFullScope || (pyFullScope = Sk.ffi.toPy(fullScope).valueOf());
                        return new Sk.builtin.list([...pyFullScope]);
                    },
                },
            });
        },
        slots: {
            tp$new(_args, _kws) {
                throw new Sk.builtin.RuntimeError("Cannot create new Capability objects in Form code.");
            },
            $r() {
                const scopeRepr = Sk.misceval.objectRepr(this._pyFullScope);
                return new Sk.builtin.str(`<anvil.server.Capability:${scopeRepr}>`);
            },
            tp$richcompare(other, op) {
                if ((op !== "Eq" && op !== "NotEq") || other.constructor !== pyMod["Capability"]) {
                    return Sk.builtin.NotImplemented.NotImplemented$;
                }
                const ret = Sk.misceval.richCompareBool(this._pyFullScope, other._pyFullScope, "Eq");
                return op === "Eq" ? ret : !ret;
            },
        },
        methods: {
            /*!defBuiltinMethod(anvil.server.Capability instance,additional_scope)!2*/
            "narrow": {
                $meth(pyNarrowSuffix) {
                    if (!(pyNarrowSuffix instanceof Sk.builtin.list)) {
                        throw new Sk.builtin.TypeError("The narrow argument of a Capability should be a list");
                    }
                    let jsNarrow;
                    try {
                        const failHook = () => {
                            throw Error("bad pyobject");
                        };
                        jsNarrow = Sk.ffi.toJs(pyNarrowSuffix, { setHook: failHook, unhandledHook: failHook });
                    } catch {
                        throw new Sk.builtin.TypeError("The narrow argument provided is not valid JSON data.");
                    }
                    const narrow = this._narrow.concat(jsNarrow);
                    return new pyMod["Capability"](this._scope, this._mac, narrow);
                },
                $flags: { OneArg: true },
                $doc: "Return a new capability that is narrower than this one, by appending additional scope element(s) to it.",
            },
            /*!defBuiltinMethod(_,apply_update:callable,[get_update:callable])!2*/
            "set_update_handler": {
                $meth(pyApplyUpdate, _ignored) {
                    this._doApplyUpdate = pyApplyUpdate;
                    return Sk.builtin.none.none$;
                },
                $flags: { MinArgs: 1, MaxArgs: 2 },
                $doc: "Set a handler for what happens when an update is sent to this capability.\n\nOptionally provide a function for aggregating updates (default behaviour is to merge them, if they are all dictionaries, or to return only the most recent update otherwise.)",
            },
            /*!defBuiltinMethod(_,update)!2*/
            "send_update": {
                $meth(pyUpdate) {
                    return this._applyUpdate(pyUpdate);
                },
                $flags: { OneArg: true },
                $doc: "Send an update to the update handler for this capability, in this interpreter and also in any calling environment (eg browser code) that passed this capability into the current server function.",
            },
        },
        getsets: {
            scope: {
                $get() {
                    return this._pyFullScope;
                },
            },
        },
        proto: {
            ANY: _ANY,
        },
        flags: {
            sk$unacceptableBase: true,
        },
    });
    [/*!defAttr()!1*/ {
        name: "scope",
        type: "list",
        description: "A list representing what this capability represents. It can be extended by calling narrow(), but not shortened.\n\nEg: ['my_resource', 42, 'foo']",
    }];
    [/*!defClassAttr()!1*/ {
        name: "ANY",
        type: "object",
        description: "Sentinel value for unwrap_capability",
    }];
    /*!defClass(anvil.server, Capability)!*/



    pyMod["unwrap_capability"] = new Sk.builtin.func((cap, scopePattern) => {
        if (Sk.builtin.type(cap) !== pyMod["Capability"]) {
            throw new Sk.builtin.TypeError("The first argument must be a Capability");
        }
        if (!(scopePattern instanceof Sk.builtin.list)) {
            throw new Sk.builtin.TypeError(`scope_pattern should be a list, not ${Sk.abstr.typeName(scopePattern)}`);
        }
        const patArr = scopePattern.valueOf();
        const scope = cap._pyFullScope;
        const scopeArr = scope.valueOf();
        if (scopeArr.length > patArr.length) {
            throw new Sk.builtin.ValueError(
                `Capability is too narrow: required ${Sk.misceval.objectRepr(
                    scopePattern
                )}; got ${Sk.misceval.objectRepr(scope)}`
            );
        }
        const ret = new Array(patArr.length).fill(Sk.builtin.none.none$);
        for (let i = 0; i < scopeArr.length; i++) {
            const patVal = patArr[i];
            const scopeVal = scopeArr[i];
            if (patVal === _ANY || scopeVal === patVal || Sk.misceval.richCompareBool(scopeVal, patVal, "Eq")) {
                ret[i] = scopeVal;
            } else {
                throw new Sk.builtin.ValueError(
                    `Incorrect Capability: required ${Sk.misceval.objectRepr(
                        scopePattern
                    )}; got ${Sk.misceval.objectRepr(scope)}`
                );
            }
        }
        return new Sk.builtin.list(ret);
    });


    pyMod["_register_exception_type"] = new Sk.builtin.func(function(pyName, pyClass) {
        if (!pyName || !(pyName instanceof Sk.builtin.str) || !pyClass) {
            throw new Sk.builtin.TypeError("Invalid call to _register_exception_type");
        }
        pyNamedExceptions[pyName.v] = pyClass;
        return Sk.builtin.none.none$;
    });

    pyMod["AnvilWrappedError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
        $loc['__init__'] = new Sk.builtin.func(function init(self, message) {
            message = message || Sk.builtin.str.$empty;
            self.tp$setattr(new Sk.builtin.str('message'),  message);
        });
    }, "AnvilWrappedError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%SessionExpiredError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.SessionExpiredError"] = 
    pyMod["SessionExpiredError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
        $loc["__init__"] = new Sk.builtin.func(function init(self) {
            self.traceback = []
            self.args = new Sk.builtin.list([Sk.ffi.toPy("Session expired")]);
            return Sk.builtin.none.none$;
        });
    }, "SessionExpiredError", [Sk.builtin.Exception]);

    pyMod["AnvilSessionExpiredException"] = pyMod["SessionExpiredError"];

    /*!defClass(anvil.server,!AppOfflineError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.AppOfflineError"] = 
    pyMod["AppOfflineError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "AppOfflineError", [Sk.builtin.Exception]);    

    /*!defClass(anvil.server,%UplinkDisconnectedError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.UplinkDisconnectedError"] = 
    pyMod["UplinkDisconnectedError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "UplinkDisconnectedError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%ExecutionTerminatedError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.ExecutionTerminatedError"] = 
    pyMod["ExecutionTerminatedError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "ExecutionTerminatedError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%TimeoutError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.TimeoutError"] = 
    pyMod["TimeoutError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "TimeoutError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%SerializationError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.SerializationError"] = 
    pyMod["SerializationError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "SerializationError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%InternalError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.InternalError"] = 
    pyMod["InternalError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "InternalError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%RuntimeUnavailableError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.RuntimeUnavailableError"] = 
    pyMod["RuntimeUnavailableError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "RuntimeUnavailableError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%QuotaExceededError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.QuotaExceededError"] = 
    pyMod["QuotaExceededError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "QuotaExceededError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%NoServerFunctionError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.NoServerFunctionError"] = 
    pyMod["NoServerFunctionError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "NoServerFunctionError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%InvalidResponseError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.InvalidResponseError"] = 
    pyMod["InvalidResponseError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "InvalidResponseError", [Sk.builtin.Exception]);

    // This one is for testing! It's raised by anvil.private.fail
    pyNamedExceptions["anvil.server._FailError"] = 
    pyMod["_FailError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "_FailError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%BackgroundTaskError, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.BackgroundTaskError"] = 
    pyMod["BackgroundTaskError"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "BackgroundTaskError", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%BackgroundTaskNotFound, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.BackgroundTaskNotFound"] = 
    pyMod["BackgroundTaskNotFound"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "BackgroundTaskNotFound", [Sk.builtin.Exception]);

    /*!defClass(anvil.server,%BackgroundTaskKilled, __builtins__..Exception)!*/ 
    pyNamedExceptions["anvil.server.BackgroundTaskKilled"] = 
    pyMod["BackgroundTaskKilled"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
    }, "BackgroundTaskKilled", [Sk.builtin.Exception]);

    var cls = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
        $loc['__enter__'] = new Sk.builtin.func(function(self) {
            globalSuppressLoading++;
            return self;
        });
        $loc['__exit__'] = new Sk.builtin.func(function(self) {
            globalSuppressLoading--;
            return Sk.builtin.none.none$;
        });
    }, "no_loading_indicator", []);

    /*!defModuleAttr(anvil.server)!1*/
    ({
        name: "!no_loading_indicator",
        description: "Use `with anvil.server.no_loading_indicator:` to suppress the loading indicator when making server calls",
    });
    pyMod["no_loading_indicator"] = Sk.misceval.callsim(cls);


    /*!defFunction(anvil.server,!_)!2*/ "Reset the current session to prevent further SessionExpiredErrors."
    pyMod["reset_session"] = new Sk.builtin.func(function() {
        // Prevent the session from complaining about expiry. 
        return PyDefUtils.suspensionFromPromise(PyDefUtils.callAsync(pyMod["call_s"], undefined, undefined, undefined, Sk.ffi.toPy("anvil.private.reset_session")).then(r => {
            window.anvilSessionToken = Sk.ffi.remapToJs(r);
        }));
    });

    function add_event_handler(pyEventName, pyHandler) {
        Sk.builtin.pyCheckType("event_name", "str", Sk.builtin.checkString(pyEventName));
        Sk.builtin.pyCheckType("event_handler", "callable function", Sk.builtin.checkCallable(pyHandler));
        const eventName = pyEventName.toString();
        const handlers = pyServerEventHandlers[eventName] || (pyServerEventHandlers[eventName] = []);
        handlers.push(pyHandler);
        if (!websocket) {
            connect(); // Make sure we're connected, so the server knows to send events here. Don't wait for the connection to complete.
        }
        return Sk.builtin.none.none$;
    }

    function remove_event_handler(pyEventName, pyHandler) {
        Sk.builtin.pyCheckType("event_name", "str", Sk.builtin.checkString(pyEventName));
        Sk.builtin.pyCheckType("event_handler", "callable function", Sk.builtin.checkCallable(pyHandler));
        const eventName = pyEventName.toString();
        const prevHandlers = pyServerEventHandlers[eventName];
        if (prevHandlers === undefined) {
            throw new Sk.builtin.LookupError(`'${pyHandler}' was not found in '${eventName}' event handlers for server events`);
        }
        const newHandlers = prevHandlers.filter(
            (handler) => handler !== pyHandler && Sk.misceval.richCompareBool(handler, pyHandler, "NotEq")
        );
        if (prevHandlers.length === newHandlers.length) {
            throw new Sk.builtin.LookupError(`'${pyHandler}' was not found in '${eventName}' event handlers for server events`);
        } else {
            pyServerEventHandlers[eventName] = newHandlers;
        }
        return Sk.builtin.none.none$;
    }

    function event_handler(pyEventName) {
        if (!Sk.builtin.checkString(pyEventName)) {
            throw new Sk.builtin.TypeError("event_handler decorator requires an event_name as the first argument");
        }
        return new Sk.builtin.func(function (pyHandler) {
            add_event_handler(pyEventName, pyHandler)
            return pyHandler;
        });
    }

    Sk.abstr.setUpModuleMethods("anvil.server", pyMod, {
        /* ! defBuiltinFunction(anvil.server,!_,event_name, event_handler)!1*/
        add_event_handler: {
            $name: "add_event_handler",
            $meth: add_event_handler,
            $doc: "add an event handler for a server event",
            $flags: { MinArgs: 2, MaxArgs: 2 },
        },
        /* ! defBuiltinFunction(anvil.server,!_,event_name, event_handler)!1*/
        remove_event_handler: {
            $name: "remove_event_handler",
            $meth: remove_event_handler,
            $doc: "remove an event handler for a server event",
            $flags: { MinArgs: 2, MaxArgs: 2 },
        },
        /* ! defBuiltinFunction(anvil.server,!_,event_name)!1*/
        event_handler: {
            $name: "event_handler",
            $meth: event_handler,
            $doc: "decorator for marking a function as an event handler.",
            $flags: { OneArg: true },
        },
    });

    pyMod["get_app_origin"] = new Sk.builtin.func(function(pyBranch) {
        return PyDefUtils.suspensionFromPromise(PyDefUtils.callAsync(pyMod["call_s"], undefined, undefined, undefined, Sk.ffi.remapToPy("anvil.private.get_app_origin"), pyBranch || Sk.builtin.none.none$));
    });
    pyMod["get_app_origin"].func_code.co_varnames = ["branch"];
    pyMod["get_app_origin"].func_code.$defaults = [Sk.builtin.none.none$];


    pyMod["get_api_origin"] = new Sk.builtin.func(function(pyBranch) {
        return PyDefUtils.suspensionFromPromise(PyDefUtils.callAsync(pyMod["call_s"], undefined, undefined, undefined, Sk.ffi.remapToPy("anvil.private.get_api_origin"), pyBranch || Sk.builtin.none.none$));
    });

    /*!defFunction(anvil.server,!_)!2*/ "Returns `True` if this app is online and `False` otherwise.\nIf `anvil.server.is_app_online()` returns `False` we expect `anvil.server.call()` to throw an `anvil.server.AppOfflineError`"
    pyMod["is_app_online"] = new Sk.builtin.func(function () {
        if (!navigator.onLine) {
            // trust the navigator
            return Sk.builtin.bool.false$;
        } else if (window.anvilOnline.serviceWorkerAgrees || !("serviceWorker" in navigator)) {
            // no reason to doubt the navigator
            return Sk.ffi.toPy(navigator.onLine);
        }
        // ok so the navigator says we're online and the service worker or an RpcCall has (at some point) said we're offline.
        // when was the last time we checked this. If it's less than the timeout use the value we previously had.
        // Otherwise, check with the service worker
        const { onLine, lastCheck, OFFLINE_TIMEOUT } = window.anvilOnline;
        if (lastCheck > Date.now() - OFFLINE_TIMEOUT) {
            // use the value we have
            return Sk.ffi.toPy(onLine);
        }
        // check with the service worker somehow...
        const checkWithFetch = async () => {
            let res;
            try {
                // no need to worry about a polyfill here
                // IE doesn't have a service worker so this code is unreachable
                // use the manifest which is not cached so we will do a call to the server
                await fetch("_/manifest.json?buildTime=0");
                res = true;
            } catch (e) {
                res = false;
            }
            window.anvilOnline.onLine = res;
            window.anvilOnline.lastCheck = Date.now();
            return Sk.ffi.toPy(res);
        };
        return PyDefUtils.suspensionFromPromise(checkWithFetch());
    });

    let setupObjectWithClass = (className, vals) => {
        let cls = Sk.misceval.buildClass(pyMod, ($gbl, $loc) => {
            $loc['__repr__'] = new Sk.builtin.func(function (self) {
                return new Sk.builtin.str(self.$d);
            });
        }, name, []);
        let obj = Sk.misceval.callsim(cls);
        for (let attr in vals) {
            obj.tp$setattr(new Sk.builtin.str(attr), Sk.ffi.remapToPy(vals[attr]));
        }
        return obj;
    };

    pyMod["context"] = setupObjectWithClass("CallContext", {
        "remote_caller": null,
        "type": "browser",
        "client": setupObjectWithClass("Client", {
            "type": "browser",
            "location": null,
            "ip": null
        })
    });

    // Register the component types (and ComponentTag) as serializable
    for (let componentName of ['Button','Canvas','CheckBox','ColumnPanel','Component','DataGrid','DataRowPanel','DatePicker','DropDown','FileLoader','FlowPanel','GridPanel','HtmlPanel','Image','Label','LinearPanel','Link','Plot','RadioButton','RepeatingPanel','RichText','SimpleCanvas','Spacer','TextArea','TextBox','Timer','XYPanel','YouTubeVideo','ComponentTag']) {
        let pyClass = anvil.$d[componentName];
        pyClass.anvil$serializableName = "anvil."+componentName;
        pyValueTypes["anvil."+componentName] = pyClass;
    }

    return {pyMod: pyMod, log: sendLog};
}

/**
id: http_apis
docs_url: /docs/http-apis/creating-http-endpoints
title: HTTP APIs
description: |
  ```python
  import anvil.server

  @anvil.server.http_endpoint("/users/:id")
  def get_user(id, **params):
    return "You requested user %s with params %s" % id, params
  ```

  You can build a programmatic HTTP API for your app by decorating server functions with the `@anvil.server.http_endpoint` 
  decorator. All registered endpoints for your app are accessible at `https://<your-app-id>.anvil.app/_/api...`, 
  or at `https://your-custom-domain.com/_/api...` if you have a custom domain. If your app is private, the endpoints will
  be at `https://<your-app-id>.anvil.app/_/private_api/<your private access key>/...`.

  You can think of URLs as having two parts:
  _origin_ and _path_. The _origin_ looks like `https://<your-app-id>.anvil.app/_/api` and tells Anvil how to route
  requests to your app. The _path_ looks like `/foo/:bar` and is registered in your calls to the `@anvil.server.http_endpoint`
  decorator.

  In the example on the right, if we navigate to `https://<my-app-id>.anvil.app/_/api/users/42?x=foo`, we will receive 
  a response of `You requested user 42 with params {'x': 'foo'}`.

  You can make a single endpoint respond to multiple request paths by using __path parameters__. In this example (`"/users/:id"`, we 
  match anything (except `/`) after the `/users/` prefix, and assign the match to the `id` keyword argument of the function. You
  can also use path parameters in the middle of a path (`/users/:id/history`) or use multiple path parameters in the same path (`/users/:user_id/history/:item_id`).

  Query-string parameters will be passed to your function as keyword arguments. In the example above, the `params` variable was used for that purpose.

  #### The `http_endpoint` decorator

  The `@anvil.server.http_endpoint` decorator makes your function callable over HTTP. It has one required argument - the path, e.g. `/users/list`. 
  As described in the example above, the path may contain one or more __path parameters__, denoted by the __`:`__ character, e.g. `/users/:id`.

  There are also some optional keyword arguments:

  \* `methods` specifies which HTTP methods this endpoint supports (the default is `['GET','POST']`)
  \* `enable_cors` adds CORS HTTP headers (`Access-Control-Allow-Origin: *`) to your response when set to `True`. By default, we set CORS headers to permit requests from any web address where your app can be reached (eg `xyz.anvil.app`, `my-custom-domain.com`, etc).
  \* `cross_site_session` is described in the "Security and cross-site sessions" section below
  \* `require_credentials` and `authenticate_users` are described in the "Authentication" section below.

  #### The request object

  HTTP requests have far more information associated with them than just path and query-string parameters. This information can be accessed through 
  the `anvil.server.request` object, which is a thread-local variable containing information about the request currently being processed. The request
  object has the following attributes:

  \* __`path`__ - The path of this HTTP request.
  \* __`method`__ - The method of this HTTP request, e.g. `GET`, `POST`, etc.
  \* __`query_params`__ - The query-string parameters passed with this request, as a dictionary.
  \* __`form_params`__ - The form parameters passed with this request, as a dictionary.
  \* __`origin`__ - The URL origin of this HTTP request.
  \* __`headers`__ - Headers passed with this request, as a dictionary.
  \* __`remote_address`__ - The IP address of the source of this request.
  \* __`body`__ - The body of this HTTP request, as an `anvil.Media` object.
  \* __`body_json`__ - For requests with `Content-Type: application/json`, this is the decoded body as a dictionary. Otherwise `None`.
  \* __`username`__ - For authenticated requests (see below), returns the provided username. Otherwise `None`.
  \* __`password`__ - For authenticated requests (see below), returns the provided password. Otherwise `None`.
  \* __`user`__ - For authenticated requests, returns the row from the `Users` table representing the authenticated user.


  #### Authentication

  ```python
  from anvil.server import http_endpoint, request

  @http_endpoint("/protected", require_credentials=True)
  def serve_protected_content():
    print("User %s connected with password %s" % (request.username, 
                                                  request.password))

    # Check username and password before continuing...
  ```

  The `@anvil.server.http_endpoint` decorator accepts the optional keyword argument `require_credentials` (default `False`). If this is set to `True`,
  remote users must provide a username and password through HTTP Basic Authentication. If credentials are not provided, a `401 Unauthorized` response
  will be sent back automatically. __It is your responsibility to check the provided username and password__ and return an appropriate response if
  the validation fails.

  ```python
  import anvil.server
  from anvil.server import request

  @anvil.server.http_endpoint("/protected", authenticate_users=True)
  def serve_protected_content():
    print("Authenticated %s, who signed up on %s." % (request.user["email"], 
                                                      request.user["signed_up"]))

    # User is now authenticated.
  ```

  Instead of setting `require_credentials`, you can set the `authenticate_users` keyword argument to `True`. This will automatically authenticate users
  against the Users Service in your app, where the provided username should be their email address. In this case, `anvil.server.request.user` will be set
  to the row from the `Users` table representing the authenticated user. Of course, you can also retrieve the logged-in user with the 
  usual `anvil.users.get_user()` mechanism. If authentication fails, a `401 Unauthorized` response will be sent back automatically.

  #### Responding to HTTP requests

  ```python
  import anvil.server

  @anvil.server.http_endpoint("/foo")
  def serve_content():
    
    # This response will have Content-Type application/json
    return {"key": "value"}
  ```

  Functions decorated with `@anvil.server.http_endpoint` can return strings (which will be returned with a Content-Type of `text/plain`), `anvil.Media` objects
  (which will be returned with their attached Content-Type), or any JSON-able object like a plain list or dict (which will be returned with Content-Type `application/json`).

  ```python
  import anvil.server

  @anvil.server.http_endpoint("/foo")
  def serve_content():
    
    response = anvil.server.HttpResponse(200, "Body goes here")
    response.headers["X-Custom-Header"] = "Custom value"

    return response
  ```

  If you need more control over the response, you can return an `anvil.server.HttpResponse` object, providing a custom status code, body and header dictionary.
  Construct an `HttpResponse` object by optionally passing status code and body arguments, then set any required headers as in the example on the right.

  #### Generating links

  Sometimes you will want to generate URLs that point to your HTTP endpoints without having to hard-code the origin of your app. For example, instead of writing:
  
  `endpoint_url = "https://my-app.anvil.app.net/_/api/users"`

  You can write:

  `endpoint_url = anvil.server.get_api_origin() + "/users"`

  This has the advantage of returning whichever origin the user is currently connected on, i.e. it will return your custom domain correctly.

  You can also get the origin of the whole app to generate links for a browser:

  `app_url = anvil.server.get_app_origin()`

  ### Security and cross-site sessions

  You should take care when writing HTTP endpoints. They are accessible to anyone on the internet, so you must be robust against malcious requests.

  What's more, it is often possible for an attacker to cause _legitimate, logged-in users of your app_ to access HTTP endpoints in a way under an attacker's control! If you're not careful, this can cause your application to perform operations on the user's behalf, but without their consent. This is called XSRF (Cross-Site Request Forgery).

  Anvil protects your apps against XSRF by serving HTTP endpoints in a separate session from the rest of your app if they were triggered by a different website. Even if the browser that requests that endpoint has [cookies](#cookies) or is logged in with the [Users service](#users), they will not be available to the endpoint function if the request was triggered by a different site (ie if the `Origin` or `Referer` headers do not match your app).

  If you want to accept requests from other websites, you can turn off this protection, by passing `cross_site_session=True` to `@anvil.server.http_endpoint()`. This will cause all requests to execute in the session of the browser they come from, whatever site initiated them. If you do this, you need to write your endpoint to be safe **even if it is called with a URL and parameters chosen by a malicious adversary**. Best practices for writing safe endpoints under these circumstances are more complex than we can go into here -- search online for "XSRF" to learn more.
*/


/*
 * TO TEST:
 *
 *  - Methods: call
 *
 */
