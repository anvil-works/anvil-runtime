import type { pyObject } from "@Sk";

export type Path = (string | number)[];

export type NonJson = {
    path: Path;
    value: any;
};

export type KnownType =
    | "Primitive"
    | "DataMedia"
    | "LazyMedia"
    | "LiveObject"
    | "Capability"
    | "ValueType"
    | "ClassType"
    | "Date"
    | "DateTime"
    | "Long"
    | "Float";
export interface SerializedObject {
    type: KnownType[];
    path: Path;
    value?: any;
    typeName?: string;
    id?: string;
    scope?: string;
    narrow?: string;
    mac?: string;
    backend?: any;
    methods?: any;
    permissions?: any;
    itemCache?: any;
    iterItems?: any;
    name?: string | null;
    "mime-type"?: string;
}

export type VtGlobalArr = (string | any)[];

export type VtGlobalObj = { [key: string]: any };

export type VtGlobals = VtGlobalArr | VtGlobalObj;

export interface SerializedJson {
    objects: (SerializedObject | Promise<SerializedObject>)[];
    vt_global: VtGlobals;
}

export interface DeserializedJson {
    objects: SerializedObject[];
    vt_global: VtGlobals;
}

export interface LiveObjectSpec {
    id: string;
    backend: string;
    mac: string;
    permissions: string[];
    methods: string[];
    itemCache?: { [item: string]: pyObject };
}

export interface Capability extends pyObject {}

export type KnownLiveObjectInstances = { [backend: string]: { [id: string]: LiveObjectSpec[] } };
export type KnownLiveObjectMethods = { [backend: string]: string[] };
export type knownCapabilities = Capability[];
export type BlobContent = {
    json: { type: "CHUNK_HEADER"; requestId: string; mediaId: string; chunkIndex: number; lastChunk: boolean };
    data: DataView;
}[];
