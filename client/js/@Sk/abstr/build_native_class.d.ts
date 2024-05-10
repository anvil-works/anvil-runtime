import type { pyObject, pyType, Suspension } from "../index";
import type { Flags } from "../namespace";
import type { numberSlots, seqMapSlots, tpSlots } from "../slots";
import { ConstructorOverloadParameters, InstanceOverloadType } from "./overload_types";

interface ConstructableType<I> {
    new (...args: any[]): I;
}
interface Callable<I> {
    (...args: any[]): I;
}


interface AbstractMethodDef {
    $flags: Flags;
    $doc?: string | null;
    $textsig?: string | null;
    $name?: string;
}

interface MethDef<I extends pyObject> extends AbstractMethodDef {
    $meth(this: I, ...args: any): pyObject | Suspension;
}

interface ClassMethDef<T extends pyType> extends AbstractMethodDef {
    $meth(this: T, ...args: any): pyObject | Suspension;
}

export type GetSetDef<I> = {
    $get(this: I): pyObject | Suspension;
    $set?: (this: I, val: pyObject) => void;
    $doc?: string | null;
    $name?: string;
};

type SlotDefs<I> = numberSlots<I> & seqMapSlots & tpSlots<I>;

type ConstructorFn<I extends pyObject, T extends pyNewableType> = (
    this: I,
    ...args: T extends ConstructableType<I> ? ConstructorOverloadParameters<T> : []
) => I | void;

interface NativeClassDefn<I extends pyObject, T extends pyNewableType> {
    // constructor: (this: I, ...args: ConstructorParameters<T>) => I | void;
    constructor: ConstructorFn<I, T>;
    slots?: Partial<SlotDefs<I>>;
    // tpSlots?: Partial<tpSlots<I>>;
    // numberSlots?: Partial<numberSlots<I>>;
    // seqMapSlots?: Partial<seqMapSlots>;
    flags?: any;
    methods?: { [key: string]: MethDef<I> };
    classmethods?: { [key: string]: ClassMethDef<T> };
    getsets?: { [key: string]: GetSetDef<I> };
    base?: pyType;
    meta?: pyType;
    proto?: Partial<I>;
}

interface pyNewableType<I extends pyObject = pyObject> extends pyType<I> {
    new (...args: any): I;
}

/** function for building native classes */
export function buildNativeClass<T extends pyNewableType>(
    name: string,
    options: NativeClassDefn<InstanceOverloadType<T>, T>
): T;

export function buildIteratorClass<T extends pyNewableType>(
    name: string,
    options: NativeClassDefn<InstanceOverloadType<T>, T> & { iternext(canSuspend?: boolean): pyObject | undefined }
): T;

export function setUpModuleMethods(
    modName: string,
    modDict: { [attr: string]: pyObject },
    methDefs: { [methName: string]: MethDef<any> }
): void;
