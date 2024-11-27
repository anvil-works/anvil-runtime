import { GetSetDef } from "./abstr/build_native_class";
import type { Args, Flags, Kws } from "./namespace";

export const {
    builtin: {
        bool: { true$: pyTrue, false$: pyFalse },
        none: { none$: pyNone },
        NotImplemented: { NotImplemented$: pyNotImplemented },

        bool: pyBool,
        bytes: pyBytes,
        dict: pyDict,
        float_: pyFloat,
        frozenset: pyFrozenSet,
        func: pyFunc,
        int_: pyInt,
        lng: pyLong,
        list: pyList,
        none: pyNoneType,
        mappingproxy: pyMappingProxy,
        module: pyModule,
        object: pyObject,
        set: pySet,
        slice: pySlice,
        sk_method: pyBuiltinFunctionOrMethod,
        str: pyStr,
        tuple: pyTuple,
        type: pyType,
        super_: pySuper,

        getset_descriptor: pyGetSetDescriptor,
        wrapper_descriptor: pyWrapperDescriptor,

        classmethod: pyClassMethod,
        staticmethod: pyStaticMethod,
        property: pyProperty,

        BaseException: pyBaseException,
        SystemExit: pySystemExit,
        KeyboardInterrupt: pyKeyboardInterrupt,
        GeneratorExit: pyGeneratorExit,
        Exception: pyException,
        StopIteration: pyStopIteration,
        StopAsyncIteration: pyStopAsyncIteration,
        ArithmeticError: pyArithmeticError,
        FloatingPointError: pyFloatingPointError,
        OverflowError: pyOverflowError,
        ZeroDivisionError: pyZeroDivisionError,
        AssertionError: pyAssertionError,
        AttributeError: pyAttributeError,
        BufferError: pyBufferError,
        EOFError: pyEOFError,
        ImportError: pyImportError,
        ModuleNotFoundError: pyModuleNotFoundError,
        LookupError: pyLookupError,
        IndexError: pyIndexError,
        KeyError: pyKeyError,
        MemoryError: pyMemoryError,
        NameError: pyNameError,
        UnboundLocalError: pyUnboundLocalError,
        OSError: pyOSError,
        FileNotFoundError: pyFileNotFoundError,
        TimeoutError: pyTimeoutError,
        ReferenceError: pyReferenceError,
        RuntimeError: pyRuntimeError,
        NotImplementedError: pyNotImplementedError,
        RecursionError: pyRecursionError,
        SyntaxError: pySyntaxError,
        IndentationError: pyIndentationError,
        TabError: pyTabError,
        SystemError: pySystemError,
        TypeError: pyTypeError,
        ValueError: pyValueError,
        UnicodeError: pyUnicodeError,
        UnicodeDecodeError: pyUnicodeDecodeError,
        UnicodeEncodeError: pyUnicodeEncodeError,
        ExternalError: pyExternalError,

        checkString,
        checkBool,
        checkInt,
        checkAnySet,
        checkBytes,
        checkCallable,
        checkIterable,
        checkNone,
        pyCheckType,

        issubclass: pyIsSubclass,
        isinstance: pyIsInstance,
        hasattr: pyHasAttr,
    },
    misceval: {
        isTrue,
        Suspension,
        Break,
        chain: chainOrSuspend,
        tryCatch: tryCatchOrSuspend,
        retryOptionalSuspensionOrThrow,
        objectRepr,
        buildClass: buildPyClass,
        iterFor: iterForOrSuspend,
        iterArray,
        richCompareBool,
        callsimArray: pyCall,
        callsimOrSuspendArray: pyCallOrSuspend,
        arrayFromIterable,
        asyncToPromise: suspensionToPromise,
        promiseToSuspension,
        iterFor: pyIterFor,
    },
    abstr: {
        buildNativeClass,
        copyKeywordsToNamedArgs,
        checkArgsLen,
        checkNoArgs,
        checkNoKwargs,
        checkOneArg,
        keywordArrayFromPyDict,
        keywordArrayToPyDict,
        iter: pyIter,
        lookupSpecial,
        typeLookup,
        typeName,
        setUpModuleMethods,
        objectHash: pyObjectHash,
    },
    ffi: { toPy, toJs, proxy, remapToJsOrWrap },
    importModule,
} = Sk;

export type { Args, Kws, CompareOp, BinOp, UnaryOp } from "./namespace";

export interface pyObjectConstructor extends pyType<pyObject> {
    new (): pyObject;
}

export interface pyObject {
    readonly ob$type: pyType;
    readonly tp$name: string;
    readonly tp$doc: string | null;

    readonly tp$mro: pyType[];
    readonly tp$bases: pyType[];
    readonly tp$base: pyType | null;

    tp$init<T extends pyObject>(this: T, args: Args, kws?: Kws): void;
    tp$new<T extends pyObject>(this: T, args: Args, kws?: Kws): T;
    $r(): pyStr;
    tp$str(): pyStr;
    tp$hash: (() => number) | pyNoneType;
    tp$getattr<R = pyObject | undefined>(attr: pyStr): R;
    tp$getattr<R = pyObject | undefined, S extends boolean = false>(
        attr: pyStr,
        canSuspend?: S
    ): S extends true ? R | Suspension : R;
    tp$setattr(attr: pyStr, value: pyObject | undefined): void;
    tp$setattr<S extends boolean>(
        attr: pyStr,
        value: pyObject | undefined,
        canSuspend: S
    ): S extends true ? void | Suspension : void;
    tp$descr_get?<R = pyObject>(obj: pyObject | null, type: pyType | null): R;
    tp$descr_get?<R = pyObject, S extends boolean = false>(
        obj: pyObject | null,
        type: pyType | null,
        canSuspend: S
    ): S extends true ? R | Suspension : R;

    // Only available on descriptors
    tp$descr_set?(obj: pyObject, value: pyObject | undefined): void;
    tp$descr_set?<S extends boolean>(
        obj: pyObject,
        value: pyObject | undefined,
        canSuspend?: S
    ): S extends true ? void | Suspension : void;

    // [slots.tpRichcompare](other: pyObject, op: CompareOp): pyNotImplementedType | pyBool | pyObject;

    ob$eq(other: pyObject): pyNotImplementedType | pyBool | pyObject;
    ob$ne(other: pyObject): pyNotImplementedType | pyBool | pyObject;
    ob$ge(other: pyObject): pyNotImplementedType | pyBool | pyObject;
    ob$le(other: pyObject): pyNotImplementedType | pyBool | pyObject;
    ob$gt(other: pyObject): pyNotImplementedType | pyBool | pyObject;
    ob$lt(other: pyObject): pyNotImplementedType | pyBool | pyObject;

    toString(): string;
    hasOwnProperty(v: string | number | symbol): boolean;
    valueOf(): pyObject | pyObject[] | string | number | bigint | null | boolean | any;

    // temporary
    [attr: string]: any;
}

export interface pyTypeConstructor extends pyType<pyType> {
    new <T extends pyObject>(obj: T): never;
    <T extends pyObject>(obj: T): pyType<T>;
}

export interface pyType<T extends pyObject = pyObject> extends pyObject {
    readonly prototype: T;
    tp$call<S extends T>(args: Args, kws?: Kws): S;
}

export interface pyNewableType<T extends pyObject = pyObject> extends pyType<T> {
    new (...args: any[]): T;
}

export interface pyType extends Function {
    $typeLookup<R = pyObject | undefined>(attr: pyStr): R;
}

export interface pyCallable<R = pyObject> extends pyObject {
    tp$call(args: Args, kws?: Kws): R;
}

export interface pyIterable<T = pyObject> extends pyObject {
    tp$iter(): pyIterator<T>;
}

export interface pyIterator<T = pyObject> extends pyIterable<T> {
    tp$iternext(): T | undefined;
}

export interface pySuperConstructor extends pyType<pySuper> {
    new <I extends pyObject>(a: pyType<I>, b: I): pySuper;
    new (a: pyType, b: pyType): pySuper;
}

export interface pySuper extends pyObject {
    constructor: pySuperConstructor;
    readonly ob$type: pySuperConstructor;
}

export interface pyGetSetDescriptorConstructor<I extends pyObject = pyObject> extends pyType<pyGetSetDescriptor> {
    new (t: pyType<I>, def: GetSetDef<I>): pyGetSetDescriptor;
}

export interface pyGetSetDescriptor extends pyObject {}

export interface WrapperDescriptorDef<I> {
    $wrapper: (this: (...args: any[]) => any, self: I, args: Args, kws: Kws) => pyObject | Suspension;
    $flags: Flags;
    $name?: string;
    $textsig?: string;
    $doc?: string;
}
export interface pyWrapperDescriptorConstructor<I extends pyObject = pyObject> extends pyType<pyWrapperDescriptor> {
    new (t: pyType<I>, def: WrapperDescriptorDef<I>, wrapper: (...args: Args) => any): pyGetSetDescriptor;
}

export interface pyWrapperDescriptor extends pyObject {}

export interface pyStrConstructor extends pyType<pyStr> {
    new (s?: string | pyObject): pyStr;
    $empty: pyStr;

    $utf8: pyStr;
    $ascii: pyStr;

    $default_factory: pyStr;
    $imag: pyStr;
    $real: pyStr;

    $abs: pyStr;
    $bytes: pyStr;
    $call: pyStr;
    $class: pyStr;
    $class_getitem: pyStr;
    $cmp: pyStr;
    $complex: pyStr;
    $contains: pyStr;
    $copy: pyStr;
    $dict: pyStr;
    $dir: pyStr;
    $doc: pyStr;
    $enter: pyStr;
    $eq: pyStr;
    $exit: pyStr;
    $index: pyStr;
    $init: pyStr;
    $int_: pyStr;
    $iter: pyStr;
    $file: pyStr;
    $float_: pyStr;
    $format: pyStr;
    $ge: pyStr;
    $getattr: pyStr;
    $getattribute: pyStr;
    $getitem: pyStr;
    $gt: pyStr;
    $keys: pyStr;
    $le: pyStr;
    $len: pyStr;
    $length_hint: pyStr;
    $loader: pyStr;
    $lt: pyStr;
    $module: pyStr;
    $missing: pyStr;
    $name: pyStr;
    $ne: pyStr;
    $new: pyStr;
    $next: pyStr;
    $path: pyStr;
    $qualname: pyStr;
    $repr: pyStr;
    $reversed: pyStr;
    $round: pyStr;
    $setattr: pyStr;
    $setitem: pyStr;
    $str: pyStr;
    $trunc: pyStr;
    $write: pyStr;
}

export interface pyStr extends pyObject {
    constructor: pyStrConstructor;
    readonly ob$type: pyStrConstructor;
    valueOf(): string;
    /** @private use with caution */
    v: string;
    /** @deprecated use toString() */
    $jsstr(): string;
}

export interface pyBytesConstructor extends pyType<pyBytes> {
    new (b?: Uint8Array | number[] | string | number): pyBytes;
}

export interface pyBytes extends pyObject {
    constructor: pyBytesConstructor;
    readonly ob$type: pyBytesConstructor;
    valueOf(): Uint8Array;
    /** @private use with caution */
    v: Uint8Array;
    $jsstr(): string;
}

export interface pyNoneTypeConstructor extends pyType<pyNoneType> {
    new (): pyNoneType;
    none$: pyNoneType;
}

export interface pyNoneType extends pyObject {
    constructor: pyNoneTypeConstructor;
    readonly ob$type: pyNoneTypeConstructor;
    valueOf(): null;
}

export interface pyNotImplementedTypeConstructor extends pyType<pyNotImplementedType> {
    new (): pyNotImplementedType;
    NotImplemented$: pyNotImplementedType;
}

export interface pyNotImplementedType extends pyObject {
    constructor: pyNotImplementedTypeConstructor;
    readonly ob$type: pyNotImplementedTypeConstructor;
}

export interface pyIntConstructor extends pyType<pyInt> {
    new (x?: number | bigint | string | pyObject): pyInt;
}

export interface pyInt extends pyObject {
    constructor: pyIntConstructor;
    readonly ob$type: pyIntConstructor;
    valueOf(): number | bigint | boolean;
}

export interface pyBoolConstructor extends pyType<pyBool> {
    new (obj?: any): pyBool;
    (obj?: any): pyBool;
    false$: pyBool;
    true$: pyBool;
}

export interface pyBool extends pyInt {
    constructor: pyBoolConstructor;
    readonly ob$type: pyBoolConstructor;
    valueOf(): boolean;
    /** @private use with caution */
    v: 1 | 0;
}

export interface pyFloatConstructor extends pyType<pyFloat> {
    new (x?: number | pyObject): pyFloat;
}

export interface pyFloat extends pyObject {
    constructor: pyFloatConstructor;
    readonly ob$type: pyFloatConstructor;
    valueOf(): number;
}

export interface pyDictConstructor extends pyType<pyDict> {
    new <K = pyObject, V = pyObject>(entries?: pyObject[]): pyDict<K, V>;
}

export interface pyDict<K = pyObject, V = pyObject> extends pyObject, pyIterable<K> {
    constructor: pyDictConstructor;
    readonly ob$type: pyDictConstructor;
    tp$hash: pyNoneType;
    quick$lookup(key: pyStr): V | undefined;
    mp$ass_subscript(key: K, val: V | undefined): void;
    mp$subscript(key: K): V;
    $items(): [K, V][];
}

export interface pyMappingProxyConstructor extends pyType<pyMappingProxy> {
    new (d?: object | pyDict): pyMappingProxy;
}

export interface pyMappingProxy<K = pyObject, V = pyObject> extends pyObject {
    constructor: pyMappingProxyConstructor;
    readonly ob$type: pyMappingProxyConstructor;
    tp$hash: pyNoneType;
    mp$subscript(key: K): V;
}

type ElementType<T extends Array<unknown>> = T extends Array<infer ElementType> ? ElementType : never;

export interface pyListConstructor extends pyType<pyList> {
    new <T extends pyObject>(L?: T[]): pyList<T>;
}

export interface pyList<T extends pyObject | pyObject[] = pyObject>
    extends pyObject,
        pyIterable<T extends pyObject[] ? ElementType<T> : T> {
    constructor: pyListConstructor;
    readonly ob$type: pyListConstructor;
    tp$hash: pyNoneType;
    valueOf(): T extends pyObject ? T[] : T;
    /** @private use with caution */
    v: T extends pyObject ? T[] : T;
}

export interface pyTupleConstructor extends pyType<pyTuple> {
    new <T extends pyObject>(L?: T[]): pyTuple<T>;
}

export interface pyTuple<T extends pyObject | pyObject[] = pyObject>
    extends pyObject,
        pyIterable<T extends pyObject[] ? ElementType<T> : T> {
    constructor: pyTupleConstructor;
    readonly ob$type: pyTupleConstructor;
    valueOf(): T extends pyObject ? T[] : T;
    /** @private use with caution */
    v: T extends pyObject ? T[] : T;
}

export interface pySetConstructor extends pyType<pySet> {
    new (S?: pyObject | pyObject[]): pySet;
}

export interface pySet extends pyObject {
    constructor: pySetConstructor;
    readonly ob$type: pySetConstructor;
    tp$hash: pyNoneType;
}

export interface pyFrozenSetConstructor extends pyType<pyFrozenSet> {
    new (S?: pyObject | pyObject[]): pyFrozenSet;
}

export interface pyFrozenSet extends pyObject {
    constructor: pyFrozenSetConstructor;
    readonly ob$type: pyFrozenSetConstructor;
}

export interface pySliceConstructor extends pyType<pySlice> {
    new (start?: any, stop?: any, step?: any): pySlice;
}

export interface pySlice extends pyObject {
    constructor: pySliceConstructor;
    readonly ob$type: pySliceConstructor;
    start: pyObject;
    stop: pyObject;
    step: pyObject;
}

export interface pyBuiltinFunctionOrMethodConstructor extends pyType<pyFunc> {
    new (
        methodDef: {
            $meth(...args: any[]): pyObject | Suspension;
            $flags: Flags;
            $doc?: string | null;
            $textsig?: string | null;
            $name?: string;
        },
        self?: pyObject,
        module?: pyModule | string
    ): pyBuiltinFunctionOrMethod;
}

export interface pyBuiltinFunctionOrMethod extends pyCallable {
    constructor: pyBuiltinFunctionOrMethodConstructor;
    readonly ob$type: pyBuiltinFunctionOrMethodConstructor;
}

export interface pyFuncConstructor extends pyType<pyFunc> {
    new (callable: (...args: any) => pyObject | Suspension): pyFunc;
}

export interface pyFunc extends pyCallable {
    constructor: pyFuncConstructor;
    readonly ob$type: pyFuncConstructor;
}

export interface pyModuleConstructor extends pyType<pyModule> {
    new (): pyModule;
}

export interface pyModule extends pyObject {
    constructor: pyModuleConstructor;
    readonly ob$type: pyModuleConstructor;
    $d: { [attr: string]: pyObject };
    $js: string;
    init$dict(name: pyStr, doc: pyStr | pyNoneType): void;
}

export interface pyClassMethodConstructor extends pyType<pyClassMethod> {
    new (callable: pyCallable): pyClassMethod;
}

export interface pyClassMethod extends pyObject {
    constructor: pyClassMethodConstructor;
    readonly ob$type: pyClassMethodConstructor;
}

export interface pyStaticMethodConstructor extends pyType<pyStaticMethod> {
    new (callable: pyCallable): pyStaticMethod;
}

export interface pyStaticMethod extends pyObject {
    constructor: pyStaticMethodConstructor;
    readonly ob$type: pyStaticMethodConstructor;
}

export interface pyPropertyConstructor extends pyType<pyProperty> {
    new (fget?: pyCallable, fset?: pyCallable, fdel?: pyCallable, doc?: pyStr): pyProperty;
}

export interface pyProperty extends pyObject {
    constructor: pyPropertyConstructor;
    readonly ob$type: pyPropertyConstructor;
}

export interface pyBaseExceptionConstructor extends pyType<pyBaseException> {
    new (msg?: string): pyBaseException;
}

export interface pyBaseException extends pyObject {
    constructor: pyBaseExceptionConstructor;
    readonly ob$type: pyBaseExceptionConstructor;
    args: pyTuple;
    traceback: { filename: string; lineno: string }[];
}

export interface pySystemExitConstructor extends pyType<pySystemExit> {
    new (msg?: string): pySystemExit;
}

export interface pySystemExit extends pyBaseException {
    constructor: pySystemExitConstructor;
    readonly ob$type: pySystemExitConstructor;
}
export interface pyKeyboardInterruptConstructor extends pyType<pyKeyboardInterrupt> {
    new (msg?: string): pyKeyboardInterrupt;
}

export interface pyKeyboardInterrupt extends pyBaseException {
    constructor: pyKeyboardInterruptConstructor;
    readonly ob$type: pyKeyboardInterruptConstructor;
}
export interface pyGeneratorExitConstructor extends pyType<pyGeneratorExit> {
    new (msg?: string): pyGeneratorExit;
}

export interface pyGeneratorExit extends pyBaseException {
    constructor: pyGeneratorExitConstructor;
    readonly ob$type: pyGeneratorExitConstructor;
}
export interface pyExceptionConstructor extends pyType<pyException> {
    new (msg?: string): pyException;
}

export interface pyException extends pyBaseException {
    constructor: pyExceptionConstructor;
    readonly ob$type: pyExceptionConstructor;
}
export interface pyStopIterationConstructor extends pyType<pyStopIteration> {
    new (msg?: string): pyStopIteration;
}

export interface pyStopIteration extends pyException {
    constructor: pyStopIterationConstructor;
    readonly ob$type: pyStopIterationConstructor;
}
export interface pyStopAsyncIterationConstructor extends pyType<pyStopAsyncIteration> {
    new (msg?: string): pyStopAsyncIteration;
}

export interface pyStopAsyncIteration extends pyException {
    constructor: pyStopAsyncIterationConstructor;
    readonly ob$type: pyStopAsyncIterationConstructor;
}
export interface pyArithmeticErrorConstructor extends pyType<pyArithmeticError> {
    new (msg?: string): pyArithmeticError;
}

export interface pyArithmeticError extends pyException {
    constructor: pyArithmeticErrorConstructor;
    readonly ob$type: pyArithmeticErrorConstructor;
}
export interface pyFloatingPointErrorConstructor extends pyType<pyFloatingPointError> {
    new (msg?: string): pyFloatingPointError;
}

export interface pyFloatingPointError extends pyArithmeticError {
    constructor: pyFloatingPointErrorConstructor;
    readonly ob$type: pyFloatingPointErrorConstructor;
}
export interface pyOverflowErrorConstructor extends pyType<pyOverflowError> {
    new (msg?: string): pyOverflowError;
}

export interface pyOverflowError extends pyArithmeticError {
    constructor: pyOverflowErrorConstructor;
    readonly ob$type: pyOverflowErrorConstructor;
}
export interface pyZeroDivisionErrorConstructor extends pyType<pyZeroDivisionError> {
    new (msg?: string): pyZeroDivisionError;
}

export interface pyZeroDivisionError extends pyArithmeticError {
    constructor: pyZeroDivisionErrorConstructor;
    readonly ob$type: pyZeroDivisionErrorConstructor;
}
export interface pyAssertionErrorConstructor extends pyType<pyAssertionError> {
    new (msg?: string): pyAssertionError;
}

export interface pyAssertionError extends pyException {
    constructor: pyAssertionErrorConstructor;
    readonly ob$type: pyAssertionErrorConstructor;
}
export interface pyAttributeErrorConstructor extends pyType<pyAttributeError> {
    new (msg?: string): pyAttributeError;
}

export interface pyAttributeError extends pyException {
    constructor: pyAttributeErrorConstructor;
    readonly ob$type: pyAttributeErrorConstructor;
}
export interface pyBufferErrorConstructor extends pyType<pyBufferError> {
    new (msg?: string): pyBufferError;
}

export interface pyBufferError extends pyException {
    constructor: pyBufferErrorConstructor;
    readonly ob$type: pyBufferErrorConstructor;
}
export interface pyEOFErrorConstructor extends pyType<pyEOFError> {
    new (msg?: string): pyEOFError;
}

export interface pyEOFError extends pyException {
    constructor: pyEOFErrorConstructor;
    readonly ob$type: pyEOFErrorConstructor;
}
export interface pyImportErrorConstructor extends pyType<pyImportError> {
    new (msg?: string): pyImportError;
}

export interface pyImportError extends pyException {
    constructor: pyImportErrorConstructor;
    readonly ob$type: pyImportErrorConstructor;
}
export interface pyModuleNotFoundErrorConstructor extends pyType<pyModuleNotFoundError> {
    new (msg?: string): pyModuleNotFoundError;
}

export interface pyModuleNotFoundError extends pyImportError {
    constructor: pyModuleNotFoundErrorConstructor;
    readonly ob$type: pyModuleNotFoundErrorConstructor;
}
export interface pyLookupErrorConstructor extends pyType<pyLookupError> {
    new (msg?: string): pyLookupError;
}

export interface pyLookupError extends pyException {
    constructor: pyLookupErrorConstructor;
    readonly ob$type: pyLookupErrorConstructor;
}
export interface pyIndexErrorConstructor extends pyType<pyIndexError> {
    new (msg?: string): pyIndexError;
}

export interface pyIndexError extends pyLookupError {
    constructor: pyIndexErrorConstructor;
    readonly ob$type: pyIndexErrorConstructor;
}
export interface pyKeyErrorConstructor extends pyType<pyKeyError> {
    new (msg?: string): pyKeyError;
}

export interface pyKeyError extends pyLookupError {
    constructor: pyKeyErrorConstructor;
    readonly ob$type: pyKeyErrorConstructor;
}
export interface pyMemoryErrorConstructor extends pyType<pyMemoryError> {
    new (msg?: string): pyMemoryError;
}

export interface pyMemoryError extends pyException {
    constructor: pyMemoryErrorConstructor;
    readonly ob$type: pyMemoryErrorConstructor;
}
export interface pyNameErrorConstructor extends pyType<pyNameError> {
    new (msg?: string): pyNameError;
}

export interface pyNameError extends pyException {
    constructor: pyNameErrorConstructor;
    readonly ob$type: pyNameErrorConstructor;
}
export interface pyUnboundLocalErrorConstructor extends pyType<pyUnboundLocalError> {
    new (msg?: string): pyUnboundLocalError;
}

export interface pyUnboundLocalError extends pyNameError {
    constructor: pyUnboundLocalErrorConstructor;
    readonly ob$type: pyUnboundLocalErrorConstructor;
}
export interface pyOSErrorConstructor extends pyType<pyOSError> {
    new (msg?: string): pyOSError;
}

export interface pyOSError extends pyException {
    constructor: pyOSErrorConstructor;
    readonly ob$type: pyOSErrorConstructor;
}
export interface pyFileNotFoundErrorConstructor extends pyType<pyFileNotFoundError> {
    new (msg?: string): pyFileNotFoundError;
}

export interface pyFileNotFoundError extends pyOSError {
    constructor: pyFileNotFoundErrorConstructor;
    readonly ob$type: pyFileNotFoundErrorConstructor;
}
export interface pyTimeoutErrorConstructor extends pyType<pyTimeoutError> {
    new (msg?: string): pyTimeoutError;
}

export interface pyTimeoutError extends pyOSError {
    constructor: pyTimeoutErrorConstructor;
    readonly ob$type: pyTimeoutErrorConstructor;
}
export interface pyReferenceErrorConstructor extends pyType<pyReferenceError> {
    new (msg?: string): pyReferenceError;
}

export interface pyReferenceError extends pyException {
    constructor: pyReferenceErrorConstructor;
    readonly ob$type: pyReferenceErrorConstructor;
}
export interface pyRuntimeErrorConstructor extends pyType<pyRuntimeError> {
    new (msg?: string): pyRuntimeError;
}

export interface pyRuntimeError extends pyException {
    constructor: pyRuntimeErrorConstructor;
    readonly ob$type: pyRuntimeErrorConstructor;
}
export interface pyNotImplementedErrorConstructor extends pyType<pyNotImplementedError> {
    new (msg?: string): pyNotImplementedError;
}

export interface pyNotImplementedError extends pyRuntimeError {
    constructor: pyNotImplementedErrorConstructor;
    readonly ob$type: pyNotImplementedErrorConstructor;
}
export interface pyRecursionErrorConstructor extends pyType<pyRecursionError> {
    new (msg?: string): pyRecursionError;
}

export interface pyRecursionError extends pyRuntimeError {
    constructor: pyRecursionErrorConstructor;
    readonly ob$type: pyRecursionErrorConstructor;
}
export interface pySyntaxErrorConstructor extends pyType<pySyntaxError> {
    new (msg?: string): pySyntaxError;
}

export interface pySyntaxError extends pyException {
    constructor: pySyntaxErrorConstructor;
    readonly ob$type: pySyntaxErrorConstructor;
}
export interface pyIndentationErrorConstructor extends pyType<pyIndentationError> {
    new (msg?: string): pyIndentationError;
}

export interface pyIndentationError extends pySyntaxError {
    constructor: pyIndentationErrorConstructor;
    readonly ob$type: pyIndentationErrorConstructor;
}
export interface pyTabErrorConstructor extends pyType<pyTabError> {
    new (msg?: string): pyTabError;
}

export interface pyTabError extends pyIndentationError {
    constructor: pyTabErrorConstructor;
    readonly ob$type: pyTabErrorConstructor;
}
export interface pySystemErrorConstructor extends pyType<pySystemError> {
    new (msg?: string): pySystemError;
}

export interface pySystemError extends pyException {
    constructor: pySystemErrorConstructor;
    readonly ob$type: pySystemErrorConstructor;
}
export interface pyTypeErrorConstructor extends pyType<pyTypeError> {
    new (msg?: string): pyTypeError;
}

export interface pyTypeError extends pyException {
    constructor: pyTypeErrorConstructor;
    readonly ob$type: pyTypeErrorConstructor;
}
export interface pyValueErrorConstructor extends pyType<pyValueError> {
    new (msg?: string): pyValueError;
}

export interface pyValueError extends pyException {
    constructor: pyValueErrorConstructor;
    readonly ob$type: pyValueErrorConstructor;
}
export interface pyUnicodeErrorConstructor extends pyType<pyUnicodeError> {
    new (msg?: string): pyUnicodeError;
}

export interface pyUnicodeError extends pyValueError {
    constructor: pyUnicodeErrorConstructor;
    readonly ob$type: pyUnicodeErrorConstructor;
}
export interface pyUnicodeDecodeErrorConstructor extends pyType<pyUnicodeDecodeError> {
    new (msg?: string): pyUnicodeDecodeError;
}

export interface pyUnicodeDecodeError extends pyValueError {
    constructor: pyUnicodeDecodeErrorConstructor;
    readonly ob$type: pyUnicodeDecodeErrorConstructor;
}
export interface pyUnicodeEncodeErrorConstructor extends pyType<pyUnicodeEncodeError> {
    new (msg?: string): pyUnicodeEncodeError;
}

export interface pyUnicodeEncodeError extends pyValueError {
    constructor: pyUnicodeEncodeErrorConstructor;
    readonly ob$type: pyUnicodeEncodeErrorConstructor;
}

export interface pyExternalErrorConstructor extends pyType<pyExternalError> {
    new (nativeError: any): pyExternalError;
}

export interface pyExternalError extends pyValueError {
    constructor: pyExternalErrorConstructor;
    readonly ob$type: pyExternalErrorConstructor;
    nativeError: any;
}

export interface Suspension<T=unknown> {
    $isSuspension: true;
    data: T;
    child?: Suspension<T>;
    resume(): any;
    $loc?: any;
    $gbl?: any;
    $filename?: string;
    $lineno?: number;
    $colno?: number;
}
export interface SuspensionConstructor {
    new <T>(): Suspension<T>;
}

export interface BreakConstructor {
    new (brValue?: any): Break;
}

export interface Break {
    readonly brValue: any;
}

export interface pyProxy<T = any> extends pyObject {
    js$wrapped: T;
}
