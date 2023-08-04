import {
    Args,
    buildNativeClass,
    isTrue,
    Kws,
    lookupSpecial,
    objectRepr,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyDict,
    pyFalse,
    pyList,
    pyNone,
    pyObject,
    pyRuntimeError,
    pyStr,
    pyTrue,
    pyTuple,
    pyType,
    toPy,
} from "@Sk";

type Path = (string | number)[];

const _GLOBAL = new pyStr(":GLOBAL");

const wrappedSlots = ["mp$subscript", "mp$ass_subscript", "tp$iter", "sq$length", "sq$contains"];

const wrappedMethods = ["keys", "items", "values", "get", "pop", "popitem", "clear", "update", "setdefault"].map(
    (name) => new pyStr(name)
);

export interface SerializationInfoType extends pyType<SerializationInfo> {
    new (fromData?: any): SerializationInfo;
    readonly prototype: SerializationInfo;
}

export interface SerializationInfo extends pyObject {
    $txData: any;
    $localData: any;
    $defaultKey: any;
    $enableTxData: boolean;
    $originalData: any;
    $toJson(this: SerializationInfo): pyObject;
    $resolveKey(this: SerializationInfo, key: any): void;
    $setDataFactory(this: SerializationInfo, _data: any, resolvedKey: any, factory?: pyCallable): any;
    $updatePath(this: SerializationInfo, path: Path, val: any): void;
    $setTxDataAvailable(this: SerializationInfo, enable: boolean): void;
    $setDefaultKey(this: SerializationInfo, key: string): void;
    $sharedData(
        this: SerializationInfo,
        key: any,
        transmittedDataFactory?: pyCallable,
        localDataFactory?: pyCallable
    ): [pyObject, pyObject];
}

export const SerializationInfo: SerializationInfoType = buildNativeClass("anvil.server.SerializeInfo", {
    constructor: function SerializationInfo(fromData?: any[] | object) {
        this.$txData = new pyDict();
        this.$localData = new pyDict();
        this.$defaultKey = null;
        this.$enableTxData = true;
        this.$originalData = null;
        if (!fromData) {
            // pass
        } else if (Array.isArray(fromData)) {
            const listData = fromData.map(toPy);
            // We need to keep a reference to the data as a python list
            // so that the update path from reconstructed objects makes sense
            // see server.js reconstructObjects
            this.$originalData = new pyList(listData);
            this.$txData = new pyDict(listData);
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
                function (this: SerializationInfo, ...args: any[]) {
                    const transmittedData = this.$sharedData("GLOBAL")[0];
                    if (transmittedData === pyNone) {
                        // using the old API so better to throw here
                        throw new pyRuntimeError(
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
            $meth(key: string, transmittedDataFactory: any, localDataFactory: any) {
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
                    $meth(args: Args, kws: Kws) {
                        const transmittedData = this.$sharedData("GLOBAL")[0];
                        if (transmittedData === pyNone) {
                            // using the old API so better to throw here
                            throw new pyRuntimeError(
                                "This object is part of shared_data; you cannot access shared_data from its __serialize__ method."
                            );
                        }
                        const wrappedMethod = transmittedData.tp$getattr(attr) as pyCallable;
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
            for (const [k, v] of this.$txData.$items()) {
                ret.push(k, v);
            }
            return new pyList(ret);
        },
        $resolveKey(key: any) {
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
        $updatePath(path: Path, val: any) {
            // here's where we update the python vt_global object
            // it's basically the same code as reconstructObjects
            // this.$originalData will either be list shaped or dictionary shaped
            // we expect the path to be of type (string | number)[]
            // string: entering a dict object, number: entering a list object
            let objectToReplace = this.$originalData;
            let positionToReplace: any;
            let key: any;
            for (key of path) {
                key = toPy(key);
                positionToReplace = objectToReplace;
                objectToReplace = objectToReplace.mp$subscript(key);
            }
            positionToReplace.mp$ass_subscript(key, val);
        },
        $setDefaultKey(key: string) {
            // expects a string
            this.$defaultKey = new pyStr(key);
        },
        $setTxDataAvailable(enable: boolean) {
            this.$enableTxData = enable;
        },
        $setDataFactory(_data: any, resolvedKey: any, factory?: pyCallable) {
            let data = _data.quick$lookup(resolvedKey);
            if (data === undefined) {
                data = pyCall(factory ?? pyDict);
                _data.mp$ass_subscript(resolvedKey, data);
            }
            return data;
        },
        $sharedData(key: any, transmittedDataFactory?: pyCallable, localDataFactory?: pyCallable) {
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
