import {
    Kws,
    Suspension,
    buildPyClass,
    chainOrSuspend,
    isTrue,
    pyAttributeError,
    pyCall,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyFalse,
    pyFunc,
    pyIndexError,
    pyInt,
    pyList,
    pyNone,
    pyObject,
    pyObjectHash,
    pyPrint,
    pySlice,
    pyStopIteration,
    pyStr,
    pyTrue,
    pyTuple,
    pyTypeError,
    pyValueError,
    toJs,
    toPy,
} from "@Sk";
import { callAsyncWithoutDefaultError, suspensionFromPromise } from "@runtime/PyDefUtils/suspension";
import { PyModMap, anvilServerMod, funcFastCall } from "@runtime/runner/py-util";

type WarningFlags = Record<string, boolean | undefined>;

interface LiveObjectSpec {
    id: string;
    backend: string;
    methods: string[];
    itemCache?: Record<string, pyObject>;
    iterItems?: {
        items?: pyObject[];
        nextPage?: unknown;
    };
}

interface LiveObjectProxyInstance extends pyObject {
    _spec: LiveObjectSpec;
    _anvil: Record<string, unknown>;
    _anvil_is_LiveObjectProxy: boolean;
}

interface LiveObjectIteratorInstance extends pyObject {
    _spec: LiveObjectSpec;
    _items?: pyObject[];
    _pyNextPage?: pyObject;
    _idx: number;
    _limit?: number | null;
    _step?: number | null;
}

type RpcMethod = (
    pyKwargs: Kws,
    args: pyObject[] | pyObject,
    methodName: string,
    spec?: LiveObjectSpec
) => pyObject | Suspension;

function isLiveObjectProxy(value: pyObject | null | undefined): value is LiveObjectProxyInstance {
    return (
        value != null &&
        "_anvil_is_LiveObjectProxy" in value &&
        (value as LiveObjectProxyInstance)._anvil_is_LiveObjectProxy === true &&
        "_spec" in value
    );
}

export function createLiveObjectTools(pyModule: PyModMap, warnings: WarningFlags) {
    const LiveObjectProxy = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            const doRpcMethodCall = function (
                self: LiveObjectProxyInstance | LiveObjectIteratorInstance,
                methodName: string,
                pyKwargs: Kws,
                args: pyObject[]
            ) {
                const doRpc = anvilServerMod["__anvil$doRpcCall"] as unknown as RpcMethod;
                return doRpc(pyKwargs, args, methodName, self._spec);
            };

            $loc["__init__"] = new pyFunc(function (self: LiveObjectProxyInstance, spec: LiveObjectSpec) {
                self._spec = spec;
                self._anvil = {};
                self._anvil_is_LiveObjectProxy = true;
                return pyNone;
            });

            $loc["__getattr__"] = new pyFunc(function (self: LiveObjectProxyInstance, pyName: pyObject) {
                const name = pyName.toString();

                if (self._spec.methods.indexOf(name) > -1) {
                    return funcFastCall((args, pyKwargs = []) => doRpcMethodCall(self, name, pyKwargs, args));
                }

                throw new pyAttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
            });

            $loc["__getitem__"] = new pyFunc(function (self: LiveObjectProxyInstance, pyName: pyObject) {
                // Are we iterable?
                if (self._spec.methods.indexOf("__anvil_iter_page__") > -1) {
                    if (pyName instanceof pyInt) {
                        const idx = toJs(pyName);

                        if (idx < 0) {
                            throw new pyIndexError("list index cannot be negative");
                        }

                        const pyIter = pyCall(LiveObjectIterator, [self, pyName]);

                        return suspensionFromPromise(
                            callAsyncWithoutDefaultError(pyIter.tp$getattr<pyCallable>(new pyStr("next"))).catch(
                                function (e) {
                                    if (e instanceof pyStopIteration) {
                                        throw new pyIndexError("list index out of range");
                                    }
                                    throw e;
                                }
                            )
                        );
                    } else if (pyName instanceof pySlice) {
                        const start = toJs(pyName.start);
                        const stop = toJs(pyName.stop);
                        const step = toJs(pyName.step);

                        if ((start as number) < 0 || (stop as number) < 0 || (step as number) < 0) {
                            throw new pyValueError("list slice indices and step cannot be negative");
                        }

                        return pyCall(LiveObjectIterator, [self, pyName.start, pyName.stop, pyName.step]);
                    }
                }
                // We are not iterable, or pyName wasn't a suitable type.

                // Is it cached?
                if (self._spec.itemCache) {
                    const name = toJs(pyName) as string;
                    if (name in self._spec.itemCache) {
                        return self._spec.itemCache[name];
                    }
                }

                // Is this implemented on the server?
                if (self._spec.methods.indexOf("__getitem__") != -1) {
                    return doRpcMethodCall(self, "__getitem__", [], [pyName]);
                } else {
                    throw new pyTypeError("Indexing with [] is not supported on this " + self._spec.backend);
                }
            });

            $loc["__setitem__"] = new pyFunc(function (
                self: LiveObjectProxyInstance,
                pyName: pyObject,
                pyVal: pyObject
            ) {
                // Is this implemented on the server?
                if (self._spec.methods.indexOf("__setitem__") != -1) {
                    const name = toJs(pyName) as string;
                    if (self._spec.itemCache) {
                        delete self._spec.itemCache[name];
                    }
                    return chainOrSuspend(doRpcMethodCall(self, "__setitem__", [], [pyName, pyVal]), function (r) {
                        if (self._spec.itemCache) {
                            self._spec.itemCache[name] = pyVal;
                        }
                        return r;
                    });
                } else {
                    throw new pyTypeError("Indexing with [] is not supported on this " + self._spec.backend);
                }
            });

            function defOverride(fnName: string, fnIfNotPresent: (self: LiveObjectProxyInstance) => pyObject) {
                $loc[fnName] = new pyFunc(function (self: LiveObjectProxyInstance) {
                    if (self._spec.methods.indexOf(fnName) != -1) {
                        return doRpcMethodCall(self, fnName, [], []);
                    } else {
                        return fnIfNotPresent(self);
                    }
                });
            }
            defOverride("__len__", (self) => {
                throw new pyTypeError("Cannot call len() on this " + self._spec.backend);
            });
            defOverride("__nonzero__", () => pyTrue);
            defOverride("__bool__", () => pyTrue);

            function isEq(self: LiveObjectProxyInstance, pyOther: pyObject) {
                return (
                    isLiveObjectProxy(pyOther) &&
                    pyOther._spec.id == self._spec.id &&
                    pyOther._spec.backend == self._spec.backend
                );
            }

            $loc["__eq__"] = new pyFunc(function (self: LiveObjectProxyInstance, pyOther: pyObject) {
                return isEq(self, pyOther) ? pyTrue : pyFalse;
            });

            $loc["__ne__"] = new pyFunc(function (self: LiveObjectProxyInstance, pyOther: pyObject) {
                return isEq(self, pyOther) ? pyFalse : pyTrue;
            });

            $loc["__hash__"] = new pyFunc(function (self: LiveObjectProxyInstance) {
                return new pyInt(pyObjectHash(new pyTuple([self._spec.id, self._spec.backend].map(toPy))));
            });

            const LiveObjectIterator = buildPyClass(
                pyModule,
                function ($gbl, $loc) {
                    $loc["__init__"] = new pyFunc(function (
                        self: LiveObjectIteratorInstance,
                        pyLiveObject: LiveObjectProxyInstance,
                        start?: pyObject,
                        limit?: pyObject,
                        step?: pyObject
                    ) {
                        self._spec = pyLiveObject._spec;
                        const i = self._spec.iterItems || {};
                        self._items = i.items;
                        self._pyNextPage = i.nextPage ? toPy(i.nextPage) : undefined;
                        const startValue = start === undefined ? undefined : toJs(start);
                        const limitValue = limit === undefined ? undefined : toJs(limit);
                        const stepValue = step === undefined ? undefined : toJs(step);
                        self._idx = startValue == null ? 0 : (startValue as number);
                        self._limit = limitValue as number | undefined;
                        self._step = stepValue as number | undefined;
                        //console.log("Initial iterator state: ", self._items, self._pyNextPage, self._limit);
                        return pyNone;
                    });

                    $loc["__iter__"] = new pyFunc(function (self: LiveObjectIteratorInstance) {
                        return self;
                    });

                    $loc["next"] = $loc["__next__"] = new pyFunc(function next(
                        self: LiveObjectIteratorInstance
                    ): pyObject | Suspension {
                        if (
                            self._items &&
                            self._idx < self._items.length &&
                            (self._limit == null || self._idx < self._limit)
                        ) {
                            const r = self._items[self._idx];
                            self._idx += self._step != null ? self._step : 1;
                            return r;
                        } else if (self._items && (!self._pyNextPage || !isTrue(self._pyNextPage))) {
                            throw new pyStopIteration();
                        } else if (self._limit != null && self._idx >= self._limit) {
                            throw new pyStopIteration();
                        } else {
                            return chainOrSuspend(
                                doRpcMethodCall(self, "__anvil_iter_page__", [], [self._pyNextPage || pyNone]),
                                function (newState: pyDict<pyStr, pyObject>) {
                                    // A little jiggery-pokery - newState comes back from doRpcMethodCall() as a Python object...

                                    if (self._limit != null) self._limit -= self._items ? self._items.length : 0;
                                    self._idx -= self._items ? self._items.length : self._idx;
                                    self._pyNextPage = isTrue(newState.sq$contains(new pyStr("nextPage")))
                                        ? newState.mp$subscript(new pyStr("nextPage"))
                                        : undefined;
                                    self._items = (newState.mp$subscript(new pyStr("items")) as pyList<pyObject>).v;

                                    //console.log("New iterator state: ", self._items, self._pyNextPage);
                                    return next(self);
                                }
                            );
                        }
                    });
                },
                "LiveObjectIterator",
                []
            );

            $loc["__iter__"] = new pyFunc(function (self: LiveObjectProxyInstance) {
                // Is this actually iterable?
                if (self._spec.methods.indexOf("__anvil_iter_page__") < 0) {
                    throw new pyTypeError("This " + self._spec.backend + " object is not iterable");
                }

                return pyCall(LiveObjectIterator, [self]);
            });

            $loc["__repr__"] = new pyFunc(function (self: LiveObjectProxyInstance) {
                return toPy("<LiveObject: " + self._spec.backend + ">");
            });
        },
        "LiveObjectProxy",
        []
    );

    const getLiveObjectId = new pyFunc(function (lo: pyObject) {
        if (isLiveObjectProxy(lo)) {
            return new pyStr(lo._spec.id);
        }
        const getId = lo.tp$getattr<pyCallable | undefined>(new pyStr("get_id"));
        if (getId === undefined) {
            throw new pyTypeError("Argument is not a LiveObject");
        }
        if (warnings._get_live_object_id === undefined) {
            warnings._get_live_object_id = true;
            pyPrint(["Deprecated: _get_live_object_id is no longer required - call row.get_id() instead."]);
        }
        return pyCallOrSuspend(getId);
    });

    const clearLiveObjectCaches = new pyFunc(function (lo: pyObject) {
        if (isLiveObjectProxy(lo)) {
            lo._spec.itemCache = {};
            lo._spec.iterItems = {};
            return pyNone;
        }
        const clearCache = lo.tp$getattr<pyCallable | undefined>(new pyStr("_clear_cache"));
        if (clearCache === undefined) {
            throw new pyTypeError("Argument is not a LiveObject");
        }
        return pyCallOrSuspend(clearCache);
    });

    return { LiveObjectProxy, getLiveObjectId, clearLiveObjectCaches };
}
