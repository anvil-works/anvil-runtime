import type { pyObject, pyTuple, pyType } from "@Sk";
import {
    chainOrSuspend,
    iterForOrSuspend,
    lookupSpecial,
    pyCall,
    pyClassMethod,
    pyDict,
    pyFunc,
    pyInt,
    pyIter,
    pyList,
    pyRuntimeError,
    pyStr,
} from "@Sk";
import { getPortableClassTypeName } from "@runtime/modules/_server/serialization-info";

type DeserializeFn = Function;
type NewFn = Function;
type SerializeFn = Function;

export interface SerializedObject extends pyObject {
    _anvil: {
        $lastSerialKey?: {
            pyGlobals: pyDict;
            pyId: pyInt;
        };
    };
}

export function setAttrsFromDict(obj: pyObject, dict: pyObject) {
    let items = dict.tp$getattr(new pyStr("items"))!;
    return iterForOrSuspend(pyIter<pyTuple<[pyStr, pyObject]>>(pyCall(items)), (pyItem) =>
        obj.tp$setattr(pyItem.v[0], pyItem.v[1], true)
    );
}

// Temporary, to get form init half-working enough to test layouts: Separate this out so it will work with
// buildNativeClass
export const mkNewDeserializedPreservingIdentityInner =
    (deserialize?: DeserializeFn, newFn?: NewFn) => (cls: pyType, pyData: pyTuple, pyGlobals: any) => {
        const pyClsName = getPortableClassTypeName(cls);
        if (!pyClsName) {
            throw new pyRuntimeError("Object is not serializable");
        }

        let jsCache: Record<string | number, pyObject>;
        try {
            jsCache = pyGlobals.mp$subscript(pyClsName);
            //console.log("Cache hit for", pyClsname.v, "in", Sk.builtin.repr(pyGlobals));
        } catch (e) {
            //console.log("Cache miss for", pyClsName.v, "in", Sk.builtin.repr(pyGlobals));
            jsCache = {};
            pyGlobals.mp$ass_subscript(pyClsName, jsCache);
            //console.log("New cache:", Sk.builtin.repr(pyGlobals));
        }
        const myId = pyData.v[0].v;
        let obj = jsCache[myId];
        if (!obj) {
            //console.log("Constructing a fresh", cls.tp$name);
            obj = jsCache[myId] = newFn ? newFn(cls) : pyCall(cls);
        }

        if (pyData.v.length <= 1) {
            //console.log("Returning from cache:", cls.tp$name);
            return obj;
        } else if (deserialize) {
            //console.log("Custom deserializing", cls.tp$name);
            return chainOrSuspend(deserialize(obj, pyData.v[1], pyGlobals), () => obj);
        } else {
            //console.log("Default deserializing", cls.tp$name);
            return chainOrSuspend(setAttrsFromDict(obj, pyData.v[1]), () => obj);
        }
    };

export function mkNewDeserializedPreservingIdentity(deserialize?: DeserializeFn, newFn?: NewFn) {
    return new pyClassMethod(new pyFunc(mkNewDeserializedPreservingIdentityInner(deserialize, newFn)) as any);
}

// ClassicComponent ONLY
export const mkSerializePreservingIdentityInner =
    (serialize?: SerializeFn) => (self: SerializedObject, pyGlobals: any) => {
        const lsk = self._anvil.$lastSerialKey;
        if (lsk && lsk.pyGlobals === pyGlobals) {
            return new pyList([lsk.pyId]);
        }

        const pyClsName = getPortableClassTypeName(self);
        if (!pyClsName) {
            throw new pyRuntimeError("Object is not serializable");
        }
        const pyMaxKey = new pyStr(pyClsName + "_max");
        let pyMyId: pyInt;
        try {
            pyMyId = pyGlobals.mp$subscript(pyMaxKey);
        } catch (e) {
            pyMyId = new pyInt(0);
        }
        pyGlobals.mp$ass_subscript(pyMaxKey, new pyInt(pyMyId.v + 1));

        self._anvil.$lastSerialKey = { pyId: pyMyId, pyGlobals: pyGlobals };

        const val: pyObject = serialize
            ? (serialize(self) as pyObject)
            : (lookupSpecial(self, pyStr.$dict) ?? new pyDict());
        return chainOrSuspend(val, (val: pyObject) => new pyList([pyMyId, val]));
    };

// ClassicComponent ONLY
export function mkSerializePreservingIdentity(serialize?: SerializeFn) {
    return new pyFunc(mkSerializePreservingIdentityInner(serialize));
}
