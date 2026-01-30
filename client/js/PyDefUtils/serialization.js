import { pyList, pyDict, pyStr, pyInt, pyRuntimeError } from "@Sk";
import { getPortableClassTypeName } from "@runtime/modules/_server/serialization-info";

export function setAttrsFromDict(obj, dict) {
    let items = dict.tp$getattr(new Sk.builtin.str("items"));
    return Sk.misceval.iterFor(Sk.abstr.iter(Sk.misceval.call(items)), (pyItem) =>
        obj.tp$setattr(pyItem.v[0], pyItem.v[1], true)
    );
}

// Temporary, to get form init half-working enough to test layouts: Separate this out so it will work with
// buildNativeClass
export const mkNewDeserializedPreservingIdentityInner = (deserialize, newFn) => (cls, pyData, pyGlobals) => {
    const pyClsName = getPortableClassTypeName(cls);
    if (!pyClsName) {
        throw new Sk.builtin.RuntimeError("Object is not serializable");
    }

    let jsCache;
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
        obj = jsCache[myId] = newFn ? newFn(cls) : Sk.misceval.callsim(cls);
    }

    if (pyData.v.length <= 1) {
        //console.log("Returning from cache:", cls.tp$name);
        return obj;
    } else if (deserialize) {
        //console.log("Custom deserializing", cls.tp$name);
        return Sk.misceval.chain(deserialize(obj, pyData.v[1], pyGlobals), () => obj);
    } else {
        //console.log("Default deserializing", cls.tp$name);
        return Sk.misceval.chain(setAttrsFromDict(obj, pyData.v[1]), () => obj);
    }
};

export function mkNewDeserializedPreservingIdentity(deserialize, newFn) {
    return new Sk.builtin.classmethod(
        new Sk.builtin.func(mkNewDeserializedPreservingIdentityInner(deserialize, newFn))
    );
}

// ClassicComponent ONLY
export const mkSerializePreservingIdentityInner = (serialize) => (self, pyGlobals) => {
    const lsk = self._anvil.$lastSerialKey;
    if (lsk && lsk.pyGlobals === pyGlobals) {
        return new pyList([lsk.pyId]);
    }

    const pyClsName = getPortableClassTypeName(self);
    if (!pyClsName) {
        throw new pyRuntimeError("Object is not serializable");
    }
    const pyMaxKey = new pyStr(pyClsName + "_max");
    let pyMyId;
    try {
        pyMyId = pyGlobals.mp$subscript(pyMaxKey);
    } catch (e) {
        pyMyId = new pyInt(0);
    }
    pyGlobals.mp$ass_subscript(pyMaxKey, new pyInt(pyMyId.v + 1));

    self._anvil.$lastSerialKey = { pyId: pyMyId, pyGlobals: pyGlobals };

    const val = serialize ? serialize(self) : Sk.abstr.lookupSpecial(self, Sk.builtin.str.$dict) ?? new pyDict();
    return Sk.misceval.chain(val, (val) => new Sk.builtin.list([pyMyId, val]));
};

// ClassicComponent ONLY
export function mkSerializePreservingIdentity(serialize) {
    return new Sk.builtin.func(mkSerializePreservingIdentityInner(serialize));
}
