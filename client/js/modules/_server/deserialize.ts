import {
    chainOrSuspend,
    importModule,
    lookupSpecial,
    pyCall,
    pyCallOrSuspend,
    pyFloat,
    pyInt,
    pyNewableType,
    pyObject,
    pyStr,
    pyTypeError,
    suspensionToPromise,
    toPy,
    typeLookup,
} from "@Sk";
import { anvilMod, anvilServerMod } from "@runtime/runner/py-util";
import PyDefUtils from "PyDefUtils";
import { VT_GLOBAL, pyValueTypes } from "./constants";
import { DT, INTERNED, TZ } from "./helpers";
import { OutstandingMedia } from "./rpc";
import { SerializationInfo } from "./serialization-info";
import type { Capability, DeserializedJson, KnownLiveObjectMethods, KnownType, SerializedObject } from "./types";

const TYPE_NAME_IS_MOD = /^(.+)\.[^.]+$/;

type Handlers = {
    [key in KnownType]: (
        obj: any,
        mediaBlobs: OutstandingMedia,
        knownLiveObjectMethods: KnownLiveObjectMethods
    ) => pyObject | string;
};

const handlers: Handlers = {
    Primitive(obj) {
        return toPy(obj.value);
    },
    DataMedia(obj, mediaBlobs) {
        const { content, mime_type: type, name } = mediaBlobs[obj.id!];
        const args = [new Blob(content, { type }), name];
        // @ts-ignore - we use the javascript version of calling Media i.e. we send raw javascript objects
        return pyCall(anvilMod["DataMedia"], args);
    },
    LazyMedia(obj) {
        return pyCall(anvilMod["LazyMedia"], [obj]);
    },
    LiveObject(obj, mediaBlobs, knownLiveObjectMethods) {
        for (const item in obj.itemCache ?? {}) {
            obj.itemCache[item] = deserialiseObject(obj.itemCache[item], mediaBlobs, knownLiveObjectMethods);
        }
        if (obj.iterItems && obj.iterItems.items) {
            const deserialisedItems = [];
            for (const item of obj.iterItems.items ?? []) {
                deserialisedItems.push(deserialiseObject(item, mediaBlobs, knownLiveObjectMethods));
            }
            obj.iterItems.items = deserialisedItems;
        }
        if (obj.methods) {
            knownLiveObjectMethods[obj.backend] = obj.methods;
        } else {
            obj.methods = knownLiveObjectMethods[obj.backend];
        }
        return pyCall(anvilMod["LiveObjectProxy"], [obj as unknown as pyObject]);
    },
    Capability(obj) {
        const CapabilityCls = anvilServerMod["Capability"] as pyNewableType<Capability>;
        return new CapabilityCls(obj.scope, obj.mac, null);
    },
    ValueType(obj) {
        return obj.typeName as string;
    },
    ClassType(obj) {
        return obj.typeName as string;
    },
    Date(obj) {
        return pyCall(DT.dateFromIso, [new pyStr(obj.value)]);
    },
    DateTime(obj) {
        // dateteime objects should always stamped on the server with a timezone
        // if not - then stamp them as utc 0
        let fmtStr = obj.value;
        const maybeSign = fmtStr[fmtStr.length - 5];
        const hasOffset = maybeSign === "-" || maybeSign === "+";
        let totalMins = 0;
        if (hasOffset) {
            const hours = Number(fmtStr.slice(-5, -2));
            const mins = Number(maybeSign + fmtStr.slice(-2));
            totalMins = hours * 60 + mins;
            fmtStr = fmtStr.slice(0, -5);
        }
        if (fmtStr.length > 26) {
            // maybe ends in a Z (or some thing else?)
            // %Y-%m-%d %H:%M:%S.%f
            fmtStr = fmtStr.slice(0, 26);
        }
        const tzinfo = pyCall(TZ.tzoffset, [], ["minutes", new pyInt(totalMins)]);
        const dt = pyCall(DT.datetimeFromIso, [new pyStr(fmtStr)]);
        return pyCall(DT.replace, [dt], ["tzinfo", tzinfo]);
    },
    Long(obj) {
        return new pyInt(obj.value);
    },
    Float(obj) {
        return new pyFloat(obj.value);
    },
} as const;

export function getOutstandingMedia(objects: any) {
    const media: OutstandingMedia = {};
    // TODO I think object is an array, isn't it?
    for (const m of Object.values<any>(objects)) {
        if (m.type?.[0] !== "DataMedia") continue;
        const { id, ["mime-type"]: mime_type, path, name } = m;
        media[id] = { mime_type, path, content: [], name };
    }
    return media;
}

function deserialiseObject(
    obj: SerializedObject,
    mediaBlobs: OutstandingMedia,
    knownLiveObjectMethods: KnownLiveObjectMethods
) {
    let reconstructed;
    for (const type of obj.type) {
        const h = handlers[type];
        if (h) {
            reconstructed = h(obj, mediaBlobs, knownLiveObjectMethods);
            break;
        }
    }

    if (reconstructed === undefined) {
        throw new pyTypeError("Cannot return object of type '" + obj.type?.[0] + "' from server call");
    }

    return reconstructed;
}

function retrievePortableClass(typeName: string) {
    const pyValueType = pyValueTypes[typeName];
    if (pyValueType) {
        return pyValueType;
    }

    const modName = typeName.match(TYPE_NAME_IS_MOD)?.[1];
    if (!modName) return;
    const mod = importModule(modName, false, true);
    return suspensionToPromise(() => chainOrSuspend(mod, () => pyValueTypes[typeName]));
}

async function reconstructSerializableType(typeName: string, data: any[], serializationInfo: SerializationInfo) {
    let pyObj: pyObject;
    const pyValueType = await retrievePortableClass(typeName);
    if (!pyValueType) {
        throw PyDefUtils.pyCall(anvilServerMod["SerializationError"], [
            new Sk.builtin.str("No such serializable type: " + typeName),
        ]);
    }

    const pyNewDeserialised = pyValueType.tp$getattr(INTERNED.__new_deserialized__);
    const pyData = toPy(data);

    if (pyNewDeserialised) {
        pyObj = await suspensionToPromise(() => pyCallOrSuspend(pyNewDeserialised, [pyData, serializationInfo]));
    } else {
        const newMethod = typeLookup(pyValueType, pyStr.$new)!;
        pyObj = pyCall(newMethod, [pyValueType]);
        const pyDeserialize = pyObj.tp$getattr(INTERNED.__deserialize__);
        if (pyDeserialize) {
            await suspensionToPromise(() => pyCallOrSuspend(pyDeserialize, [pyData, serializationInfo]));
        } else {
            const d = lookupSpecial(pyObj, pyStr.$dict)!;
            pyCall(d.tp$getattr(INTERNED.update)!, [pyData]);
        }
    }
    return pyObj;
}

export async function reconstructObjects(json: DeserializedJson, mediaBlobs: OutstandingMedia) {
    const objects = json.objects;
    const knownLiveObjectMethods: KnownLiveObjectMethods = {};
    let serializationInfo: SerializationInfo | undefined;

    for (const obj of objects) {
        const reconstructed = deserialiseObject(obj, mediaBlobs, knownLiveObjectMethods);
        const path = obj.path;

        if (path.length < 1) {
            console.error("Cannot reconstruct zero-length path; ignoring");
            continue;
        }

        let objectToReplace: any = json;
        let positionToReplace: any;
        let key: string | number;
        for (key of path) {
            // walk to the position we're going to be replacing
            // and get the object that is currently at that position
            positionToReplace = objectToReplace;
            objectToReplace = objectToReplace[key];
        }

        let replaceWith = reconstructed;

        if (obj.type.includes("ValueType")) {
            const typeName = reconstructed as string;
            // we only create a serializationInfo object the first time we actually need it.
            // Since we need to pass the python vt_global object to each deserialize method
            // and since we don't want to convert vt_globl to a python object on each round
            // the serializationInfo maintains a parallel python representation of the vt_global object
            // this parallel version gets updated below as we reconstruct types
            serializationInfo ??= new SerializationInfo(json.vt_global);
            serializationInfo.$setTxDataAvailable(path[0] !== VT_GLOBAL);
            serializationInfo.$setDefaultKey(typeName);
            replaceWith = await reconstructSerializableType(typeName, objectToReplace, serializationInfo);
        } else if (obj.type.includes("ClassType")) {
            replaceWith = await retrievePortableClass(reconstructed as string);
        } else if (objectToReplace != null) {
            console.error("Object reconstruction replacing something that's not a null leaf!", objectToReplace);
            console.log(path, objectToReplace);
        }

        // we are either replacing a path into json.response or json.vt_global
        // we don't actually need to update json.vt_global since the serializationInfo maintains the python version
        // but it seems silly to make this update conditional
        positionToReplace[key!] = replaceWith as pyObject;

        if (serializationInfo !== undefined && path[0] === VT_GLOBAL) {
            try {
                // we update the parallel python representation of the vt_global object
                // we must do this because
                // once the vt_global object has been converted to python
                // it no longer points to the same objects as json.vt_global
                serializationInfo.$updatePath(path.slice(1), replaceWith);
            } catch (e) {
                console.error("Failed to update shared data", e);
            }
        }
    }
    return json;
}

export async function reconstructSerializedMapWithMedia(serialisedArgs: any) {
    const { media, ...restArgs } = serialisedArgs ?? {};
    // Massage this into the slightly wonky form our deserialiser expects
    const om: OutstandingMedia = {};
    for (const m of restArgs.objects ?? []) {
        if (m.type?.[0] === "DataMedia") {
            const { id, ["mime-type"]: mime_type, path, name } = m;

            const fr = await fetch(`data:${mime_type};base64,` + media[id]);
            om[id] = { mime_type, path, content: [await fr.blob()], name };
        }
    }
    return (await reconstructObjects(restArgs, om)) as any;
}
