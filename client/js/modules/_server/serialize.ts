import {
    pyBytes,
    pyCall,
    pyDict,
    pyFloat,
    pyLong,
    pyNone,
    pyNoneType,
    pyStr,
    pyType,
    pyTypeError,
    toJs,
    toPy,
} from "@Sk";
import { anvilMod, anvilServerMod, datetimeMod } from "@runtime/runner/py-util";
import PyDefUtils from "PyDefUtils";
import { CHUNK_SIZE, VT_GLOBAL, pyValueTypes } from "./constants";
import {
    DT,
    INTERNED,
    TZ,
    assertIsPy,
    isInstance,
    pyBytesOrStr2ab,
    throwNonStrKey,
    throwSerializationError,
} from "./helpers";
import { SerializationInfo } from "./serialization-info";
import type {
    BlobContent,
    Capability,
    KnownLiveObjectInstances,
    KnownLiveObjectMethods,
    KnownType,
    LiveObjectSpec,
    NonJson,
    Path,
    SerializedJson,
    SerializedObject,
} from "./types";

declare let JSBI: any;

function pathPushPop(key: string | number, val: any, path: Path, nonJson: NonJson[], SI: SerializationInfo) {
    path.push(key);
    const rv = remapToJsAndPushNonJson(val, path, nonJson, SI);
    path.pop();
    return rv;
}

function serializePortableClass(obj: any, path: Path, nonJson: NonJson[], serializationInfo: SerializationInfo) {
    const cls = obj.ob$type;
    const typeName = cls.anvil$serializableName;

    if (!typeName || !(typeName in pyValueTypes)) {
        const name = obj.tp$name ?? "[unknown]";
        const msg = `Type ${name} is not registered with @anvil.server.portable_class.`;
        throw pyCall(anvilServerMod["SerializationError"], [new pyStr(msg)]);
    }

    let pyRet;
    const pySerialize = obj.tp$getattr(INTERNED.__serialize__);
    serializationInfo.$setDefaultKey(typeName);
    if (pySerialize) {
        pyRet = pyCall(pySerialize, [serializationInfo]);
    } else {
        pyRet = obj.tp$getattr(pyStr.$dict);
    }
    const rv = remapToJsAndPushNonJson(pyRet, path, nonJson, serializationInfo);
    nonJson.push({ path: path.slice(0), value: obj });
    return rv;
}

function remapToJsAndPushNonJson(obj: any, path: Path, nonJson: NonJson[], serializationInfo: SerializationInfo): any {
    if (obj?.ob$type?.anvil$serializableName) {
        return serializePortableClass(obj, path, nonJson, serializationInfo);
    }
    const maybeJs = obj.valueOf();
    const jsType = typeof maybeJs;

    if (maybeJs === null) {
        return null;
    } else if (jsType === "number" && Number.isFinite(maybeJs)) {
        return maybeJs;
    } else if (jsType === "string" || jsType === "boolean") {
        return maybeJs;
    } else if (JSBI.__isBigInt(maybeJs)) {
        nonJson.push({ path: path.slice(0), value: new pyLong(maybeJs) });
        return null;
    } else if (Array.isArray(maybeJs)) {
        const rv = [];
        for (let i = 0; i < maybeJs.length; i++) {
            rv.push(pathPushPop(i, maybeJs[i], path, nonJson, serializationInfo));
        }
        return rv;
    } else if (obj instanceof pyDict) {
        const rv: { [key: string]: any } = {};
        for (const [k, v] of obj.$items()) {
            if (!(k instanceof pyStr)) {
                throwNonStrKey(k, path);
            }
            const jsk: string = k.toString();
            rv[jsk] = pathPushPop(jsk, v, path, nonJson, serializationInfo);
        }
        return rv;
    } else if (jsType === "object" && Object.getPrototypeOf(obj) === Object.prototype) {
        const rv: { [key: string]: any } = {};
        for (const key in obj) {
            rv[key] = pathPushPop(key, obj[key], path, nonJson, serializationInfo);
        }
        return rv;
    }
    // Not JSONable
    nonJson.push({ path: path.slice(0), value: obj });
    return null;
}

async function remapMedia(mapping: NonJson, i: number, uid: string, blobContent: BlobContent[]) {
    const mediaParts = await Promise.all([
        PyDefUtils.callAsync<pyStr>(mapping.value.tp$getattr(INTERNED.get_content_type)),
        PyDefUtils.callAsync<pyBytes>(mapping.value.tp$getattr(INTERNED.get_bytes)),
        PyDefUtils.callAsync<pyStr | pyNoneType>(mapping.value.tp$getattr(INTERNED.get_name)),
    ] as const);

    const [mimeType, bytesVal, name] = mediaParts.map(toJs) as [string, Uint8Array, string | null];
    const path = mapping.path;
    const buffer = pyBytesOrStr2ab(bytesVal); // we want a binary string here
    const contentChunks: BlobContent = [];

    let nextOffset = 0;
    let nextChunkIndex = 0;

    const mediaId = uid + "_" + i;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const byteLength = Math.min(CHUNK_SIZE, buffer.byteLength - nextOffset);
        const chunkView = new DataView(buffer, nextOffset, byteLength);
        nextOffset += CHUNK_SIZE;

        const thisChunk = {
            type: "CHUNK_HEADER",
            requestId: uid,
            mediaId: mediaId,
            chunkIndex: nextChunkIndex++,
            lastChunk: nextOffset >= buffer.byteLength,
        } as const;

        contentChunks.push({ json: thisChunk, data: chunkView });
        if (thisChunk.lastChunk) {
            break;
        }
    }

    blobContent.push(contentChunks);

    return {
        path,
        type: ["DataMedia"],
        id: mediaId,
        name,
        "mime-type": mimeType,
    } as SerializedObject;
}

function remapNonJsonTypes(
    call: SerializedJson,
    mappings: NonJson[],
    uid: string,
    { knownCapabilities, knownLiveObjectMethods, knownLiveObjectInstances, blobContent }: SerializableMutableReferences
) {
    for (let i = 0; i < mappings.length; i++) {
        const mapping = mappings[i];
        assertIsPy(mapping);

        if (mapping.value.$anvil_isLazyMedia) {
            call.objects.push({
                ...mapping.value._spec,
                path: mapping.path,
            });
        } else if (isInstance(mapping.value, anvilMod["Media"])) {
            // It's media
            call.objects.push(remapMedia(mapping, i, uid, blobContent));
        } else if (isInstance(mapping.value, anvilMod["LiveObjectProxy"])) {
            const _spec = mapping.value._spec;
            const { backend, id, permissions, mac, methods } = _spec;
            const o: SerializedObject = { path: mapping.path, type: ["LiveObject"], backend, id, permissions, mac };

            // Slightly sneaky - we'll have object identity from the same optimisation on the server
            if (methods !== knownLiveObjectMethods[o.backend]) {
                o.methods = methods;
                knownLiveObjectMethods[o.backend] = methods;
            }

            // Record this instance so we can blat its cache if we need to
            const kli = (knownLiveObjectInstances[o.backend] ??= {});
            const klis = (kli[id] ??= []);
            klis.push(_spec);

            call.objects.push(o);
        } else if (isInstance(mapping.value, anvilServerMod["Capability"])) {
            knownCapabilities.push(mapping.value);
            call.objects.push({
                path: mapping.path,
                type: ["Capability"],
                scope: mapping.value._scope,
                narrow: mapping.value._narrow,
                mac: mapping.value._mac,
            });
        } else if (isInstance(mapping.value, datetimeMod["datetime"])) {
            const tzinfo = mapping.value.tp$getattr(INTERNED.tzinfo);
            const naive =
                tzinfo === pyNone || pyCall(tzinfo.tp$getattr(INTERNED.utcoffset), [mapping.value]) === pyNone;

            let awareDT: any;
            if (naive) {
                // Stamp with the local timezone offset of the browser.
                const tzinfo = pyCall(TZ.tzoffset, [], ["minutes", toPy(-new Date().getTimezoneOffset())]);
                awareDT = pyCall(DT.replace, [mapping.value], ["tzinfo", tzinfo]);
            } else {
                awareDT = mapping.value;
            }
            const pyStr = pyCall(DT.strftime, [awareDT, DT.datetimeFmtTz]);
            call.objects.push({
                path: mapping.path,
                type: ["DateTime"],
                value: pyStr.toString(),
            });
        } else if (isInstance(mapping.value, datetimeMod["date"])) {
            const pyStr = pyCall(DT.strftime, [mapping.value, DT.dateFmt]);
            call.objects.push({
                path: mapping.path,
                type: ["Date"],
                value: pyStr.toString(),
            });
        } else if (mapping.value instanceof pyLong) {
            call.objects.push({
                path: mapping.path,
                type: ["Long"],
                value: String(mapping.value.valueOf()),
            });
        } else if (mapping.value instanceof pyFloat) {
            call.objects.push({
                path: mapping.path,
                type: ["Float"],
                value: "" + mapping.value.valueOf(),
            });
        } else {
            let cls = mapping.value.ob$type;
            let type: KnownType = "ValueType";
            if (cls === pyType) {
                cls = mapping.value;
                type = "ClassType";
            }
            const typeName = cls.anvil$serializableName;
            if (typeName) {
                call.objects.push({
                    path: mapping.path,
                    type: [type],
                    typeName: typeName,
                });
            } else {
                throwSerializationError(mapping);
            }
        }
    }
}

type SerializableMutableReferences = {
    knownCapabilities: Capability[];
    knownLiveObjectMethods: KnownLiveObjectMethods;
    knownLiveObjectInstances: KnownLiveObjectInstances;
    blobContent: BlobContent[];
};

type SerializeOptions = {
    commandOrMethod: string;
    liveObjectSpec?: LiveObjectSpec;
};

export function serialize(
    obj: any,
    uid: string,
    {
        knownCapabilities,
        knownLiveObjectMethods,
        knownLiveObjectInstances,
        blobContent,
        commandOrMethod,
        liveObjectSpec,
    }: SerializeOptions & SerializableMutableReferences
) {
    const nonJson: NonJson[] = [];
    const path: Path = [];
    const serializationInfo = new SerializationInfo();
    const rv = remapToJsAndPushNonJson(obj, path, nonJson, serializationInfo);
    const globalNonJson: NonJson[] = [];
    const vtGlobal = serializationInfo.$toJson();
    serializationInfo.$setTxDataAvailable(false);
    rv[VT_GLOBAL] = remapToJsAndPushNonJson(vtGlobal, [VT_GLOBAL], globalNonJson, serializationInfo);
    rv.objects ??= [];

    if (liveObjectSpec) {
        rv.liveObjectCall = {
            method: commandOrMethod,
            id: liveObjectSpec.id,
            backend: liveObjectSpec.backend,
            permissions: liveObjectSpec.permissions,
            mac: liveObjectSpec.mac,
        };
        knownLiveObjectInstances[liveObjectSpec.backend] = { [liveObjectSpec.id]: [liveObjectSpec] };
    } else if (commandOrMethod) {
        rv.command = commandOrMethod;
    } else {
        throw new pyTypeError("anvil.server.call() requires at least one parameter");
    }

    const finalNonJson = [...globalNonJson, ...nonJson];
    remapNonJsonTypes(rv, finalNonJson, uid, {
        knownCapabilities,
        knownLiveObjectMethods,
        knownLiveObjectInstances,
        blobContent,
    });
    return rv;
}
