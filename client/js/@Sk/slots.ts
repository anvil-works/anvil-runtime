import type { pyBool, pyFloat, pyInt, pyNoneType, pyNotImplementedType, pyObject, pyStr, pyType, Suspension } from "./index";
import type { Args, CompareOp, Kws } from "./index";

export interface tpSlots<T> {
    tp$name: string;
    $r(this: T): pyStr;
    tp$hash: pyNoneType | ((this: T) => number);
    tp$call(this: T, args: Args, kws?: Kws): pyObject | pyType | Suspension;
    tp$str(this: T): pyStr;
    tp$getattr(this: T, attr: pyStr, canSuspend?: boolean): pyObject | undefined;
    /** a value of undefined signals deleting an attribute */
    tp$setattr(this: T, attr: pyStr, value: pyObject | undefined, canSuspend?: boolean): void;
    // tp$flags;
    readonly tp$doc: string | null;
    tp$richcompare(this: T, other: pyObject, op: CompareOp): pyNotImplementedType | pyBool | pyObject | boolean;
    tp$iter(this: T): pyObject; // we make this a symbol iterators
    tp$iternext(this: T): { value: pyObject | undefined; done: boolean }; // we make this a next

    readonly tp$base: pyType;
    // readonly tp$dict: { [keys: string]: pyObject };

    tp$descr_get(this: T, obj: pyObject | null, type: pyType | null, canSuspend?: boolean): pyObject | void | Suspension;
    /** a value of undefined signals deleting */
    tp$descr_set(this: T, obj: pyObject, value: pyObject | undefined, canSuspend?: boolean): void;

    tp$init(this: T, args: Args, kws?: Kws): void | Suspension;
    tp$new(this: T, args: Args, kws?: Kws): pyObject | Suspension;

    readonly tp$mro: pyType[];
    readonly tp$bases: pyType[];

    tp$as_number: boolean;
    tp$as_sequence_or_mapping: boolean;

    tp$finalize(this: T): void;
}

export interface numberSlots<T> {
    nb$add(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$radd(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_add(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$sub(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_sub(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_sub(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$mul(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_mul(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_mul(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$mod(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_mod(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_mod(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$divmod(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_divmod(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$pow(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_pow(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_pow(this: T, other: pyObject): pyObject | pyNotImplementedType;

    nb$neg(this: T): pyObject;
    nb$pos(this: T): pyObject;
    nb$abs(this: T): pyObject;
    nb$bool(this: T): boolean;
    nb$invert(this: T): pyObject;

    nb$lshift(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_lshift(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_lshift(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$rshift(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_rshift(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_rshift(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$and(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_and(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_and(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$xor(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_xor(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_xor(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$or(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_or(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_or(this: T, other: pyObject): pyObject | pyNotImplementedType;

    nb$int(this: T): pyInt;
    nb$float(this: T): pyFloat;

    nb$floordiv(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_floordiv(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_floordiv(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$div(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_div(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$inplace_div(this: T, other: pyObject): pyObject | pyNotImplementedType;

    nb$index(this: T): number | bigint;

    nb$matmul(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$reflected_matmul(this: T, other: pyObject): pyObject | pyNotImplementedType;
    nb$imatmul(this: T, other: pyObject): pyObject | pyNotImplementedType;
}

export interface seqMapSlots {
    mp$subscript(item: pyObject): pyObject;
    /** a value of undefined signals deleting an item */
    mp$ass_subscript(item: pyObject, val?: pyObject): pyObject;
    sq$length(): number;
    sq$concat(other: pyObject): pyObject;
    sq$inplace_concat(other: pyObject): pyObject;
    sq$repeat(other: pyObject): pyObject;
    sq$inplace_repeat(other: pyObject): pyObject;
    sq$contains(other: pyObject): boolean;
}
