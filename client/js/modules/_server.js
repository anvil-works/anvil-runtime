const {
    builtin: {
        bool: pyBool,
        bool: { false$: pyFalse, true$: pyTrue },
        dict: pyDict,
        list: pyList,
        str: pyStr,
        tuple: pyTuple,
        type: pyType,
        none: { none$: pyNone },
        getattr: pyGetAttr,
        RuntimeError,
    },
    abstr: { buildNativeClass, lookupSpecial },
    ffi: { toPy },
    misceval: { callsimOrSuspendArray: pyCallOrSuspend, callsimArray: pyCall, isTrue, objectRepr },
} = Sk;

const _GLOBAL = new pyStr(":GLOBAL");

const wrappedSlots = ["mp$subscript", "mp$ass_subscript", "tp$iter", "sq$length", "sq$contains"];

const wrappedMethods = ["keys", "items", "values", "get", "pop", "popitem", "clear", "update", "setdefault"].map(
    (name) => new pyStr(name)
);

export const SerializationInfo = buildNativeClass("anvil.server.SerializeInfo", {
    constructor: function SerializationInfo(fromData) {
        this.$txData = new pyDict();
        this.$localData = new pyDict();
        this.$defaultKey = null;
        this.$enableTxData = true;
        this.$originalData = null;
        if (!fromData) {
            // pass
        } else if (Array.isArray(fromData)) {
            fromData = fromData.map(toPy);
            // We need to keep a reference to the data as a python list
            // so that the update path from reconstructed objects makes sense
            // see server.js reconstructObjects
            this.$originalData = new pyList(fromData);
            this.$txData = new pyDict(fromData);
        } else {
            this.$originalData = toPy(fromData);
            this.$txData.mp$ass_subscript(_GLOBAL, this.$originalData);
        }
    },
    slots: {
        $r() {
            /** @todo adjust for public API along with _server.py */
            return new pyStr(`SerializationInfo<${objectRepr(this.$txData)}, ${objectRepr(this.$localData)}>`);
        },
        tp$as_sequence_or_mapping: true,
        tp$as_number: true,
        nb$bool() {
            return isTrue(this.$enableTxData);
        },
        ...Object.fromEntries(
            wrappedSlots.map((slotName) => [
                slotName,
                function (...args) {
                    const transmittedData = this.$sharedData("GLOBAL").valueOf()[0];
                    if (transmittedData === pyNone) {
                        // using the old API so better to throw here
                        throw new RuntimeError(
                            "This object is part of shared_data; you cannot access shared_data from its __serialize__ method."
                        );
                    }
                    return transmittedData[slotName](...args);
                },
            ])
        ),
    },
    methods: {
        shared_data: {
            $meth(key, transmittedDataFactory, localDataFactory) {
                return new pyTuple(this.$sharedData(key, transmittedDataFactory, localDataFactory));
            },
            $flags: {
                NamedArgs: ["key", "transmitted_data_factory", "local_data_factory"],
                Defaults: [pyNone, pyDict, pyDict],
            },
        },
        ...Object.fromEntries(
            wrappedMethods.map((attr) => [
                attr,
                {
                    $meth(args, kws) {
                        const transmittedData = this.$sharedData("GLOBAL")[0];
                        if (transmittedData === pyNone) {
                            // using the old API so better to throw here
                            throw new RuntimeError(
                                "This object is part of shared_data; you cannot access shared_data from its __serialize__ method."
                            );
                        }
                        const wrappedMethod = pyGetAttr(transmittedData, attr);
                        return pyCallOrSuspend(wrappedMethod, args, kws);
                    },
                    $flags: { FastCall: true },
                },
            ])
        ),
    },
    getsets: {
        remote_is_trusted: {
            $get() {
                return pyTrue;
            },
        },
        local_is_trusted: {
            $get() {
                return pyFalse;
            },
        },
    },
    proto: {
        $toJson() {
            if (this.$txData.sq$length() === 1 && this.$txData.sq$contains(_GLOBAL)) {
                return this.$txData.mp$subscript(_GLOBAL);
            }
            const ret = [];
            for (let [k, v] of this.$txData.$items()) {
                ret.push(k, v);
            }
            return new pyList(ret);
        },
        $resolveKey(key) {
            if (key == null || key === pyNone) {
                return this.$defaultKey;
            } else if (typeof key === "string") {
                key = new pyStr(":" + key);
            } else if (key instanceof pyType) {
                const serializableName = key.anvil$serializableName;
                key = serializableName ?? `${lookupSpecial(key, pyStr.$module)}.${lookupSpecial(key, pyStr.$name)}`;
            } else {
                key = ":" + key.toString();
            }
            return new pyStr(key);
        },
        $updatePath(path, val) {
            // here's where we update the python vt_global object
            // it's basically the same code as reconstructObjects
            // this.$originalData will either be list shaped or dictionary shaped
            // we expect the path to be of type (string | number)[]
            // string: entering a dict object, number: entering a list object
            let objectToReplace = this.$originalData;
            let positionToReplace;
            let key;
            for (key of path) {
                key = toPy(key);
                positionToReplace = objectToReplace;
                objectToReplace = objectToReplace.mp$subscript(key);
            }
            positionToReplace.mp$ass_subscript(key, val);
        },
        $setDefaultKey(key) {
            // expects a string
            this.$defaultKey = new pyStr(key);
        },
        $setTxDataAvailable(enable) {
            this.$enableTxData = enable;
        },
        $setDataFactory(_data, resolvedKey, factory) {
            let data = _data.quick$lookup(resolvedKey);
            if (data === undefined) {
                data = pyCall(factory ?? pyDict);
                _data.mp$ass_subscript(resolvedKey, data);
            }
            return data;
        },
        $sharedData(key, transmittedDataFactory, localDataFactory) {
            key = this.$resolveKey(key);
            const localData = this.$setDataFactory(this.$localData, key, localDataFactory);
            if (!isTrue(this.$enableTxData)) {
                return [pyNone, localData];
            }
            const txData = this.$setDataFactory(this.$txData, key, transmittedDataFactory);
            return [txData, localData];
        },
    },
});
