import type * as ABSTR from "./abstr";

import {
    pyArithmeticErrorConstructor,
    pyAssertionErrorConstructor,
    pyAttributeErrorConstructor,
    pyBaseExceptionConstructor,
    pyBufferErrorConstructor,
    pyBuiltinFunctionOrMethodConstructor,
    pyEOFErrorConstructor,
    pyExceptionConstructor,
    pyExternalErrorConstructor,
    pyFileNotFoundErrorConstructor,
    pyFloatingPointErrorConstructor,
    pyGeneratorExitConstructor,
    pyGetSetDescriptorConstructor,
    pyImportErrorConstructor,
    pyIndentationErrorConstructor,
    pyIndexErrorConstructor,
    pyKeyboardInterruptConstructor,
    pyKeyErrorConstructor,
    pyLookupErrorConstructor,
    pyMemoryErrorConstructor,
    pyModuleNotFoundErrorConstructor,
    pyNameErrorConstructor,
    pyNewableType,
    pyNotImplementedErrorConstructor,
    pyNotImplementedTypeConstructor,
    pyOSErrorConstructor,
    pyOverflowErrorConstructor,
    pyProxy,
    pyRecursionErrorConstructor,
    pyReferenceErrorConstructor,
    pyRuntimeErrorConstructor,
    pyStopAsyncIterationConstructor,
    pyStopIterationConstructor,
    pySuperConstructor,
    pySyntaxErrorConstructor,
    pySystemErrorConstructor,
    pySystemExitConstructor,
    pyTabErrorConstructor,
    pyTimeoutErrorConstructor,
    pyTypeErrorConstructor,
    pyUnboundLocalErrorConstructor,
    pyUnicodeDecodeErrorConstructor,
    pyUnicodeEncodeErrorConstructor,
    pyUnicodeErrorConstructor,
    pyValueErrorConstructor,
    pyZeroDivisionErrorConstructor,
} from "./";
import {
    pyBool,
    pyBoolConstructor,
    pyBytes,
    pyBytesConstructor,
    pyCallable,
    pyClassMethodConstructor,
    pyDict,
    pyDictConstructor,
    pyFloat,
    pyFloatConstructor,
    pyFrozenSet,
    pyFrozenSetConstructor,
    pyFuncConstructor,
    pyInt,
    pyIntConstructor,
    pyIterable,
    pyIterator,
    pyList,
    pyListConstructor,
    pyMappingProxyConstructor,
    pyModule,
    pyModuleConstructor,
    pyNoneType,
    pyNoneTypeConstructor,
    pyObject,
    pyObjectConstructor,
    pyPropertyConstructor,
    pySet,
    pySetConstructor,
    pySliceConstructor,
    pyStaticMethodConstructor,
    pyStr,
    pyStrConstructor,
    pyTuple,
    pyTupleConstructor,
    pyType,
    pyTypeConstructor,
} from "./index";
import { BreakConstructor, SuspensionConstructor, Suspension, Break } from "./index";

export namespace Sk {
    export namespace builtin {
        const bool: pyBoolConstructor;
        const bytes: pyBytesConstructor;
        const dict: pyDictConstructor;
        const float_: pyFloatConstructor;
        const frozenset: pyFrozenSetConstructor;
        const func: pyFuncConstructor;
        const int_: pyIntConstructor;
        const list: pyListConstructor;
        const none: pyNoneTypeConstructor;
        const mappingproxy: pyMappingProxyConstructor;
        const module: pyModuleConstructor;
        const object: pyObjectConstructor;
        const set: pySetConstructor;
        const slice: pySliceConstructor;
        const sk_method: pyBuiltinFunctionOrMethodConstructor;
        const str: pyStrConstructor;
        const tuple: pyTupleConstructor;
        const type: pyTypeConstructor;
        const super_: pySuperConstructor;
        const NotImplemented: pyNotImplementedTypeConstructor;

        const getset_descriptor: pyGetSetDescriptorConstructor;

        const classmethod: pyClassMethodConstructor;
        const staticmethod: pyStaticMethodConstructor;
        const property: pyPropertyConstructor;

        const BaseException: pyBaseExceptionConstructor;
        const SystemExit: pySystemExitConstructor;
        const KeyboardInterrupt: pyKeyboardInterruptConstructor;
        const GeneratorExit: pyGeneratorExitConstructor;
        const Exception: pyExceptionConstructor;
        const StopIteration: pyStopIterationConstructor;
        const StopAsyncIteration: pyStopAsyncIterationConstructor;
        const ArithmeticError: pyArithmeticErrorConstructor;
        const FloatingPointError: pyFloatingPointErrorConstructor;
        const OverflowError: pyOverflowErrorConstructor;
        const ZeroDivisionError: pyZeroDivisionErrorConstructor;
        const AssertionError: pyAssertionErrorConstructor;
        const AttributeError: pyAttributeErrorConstructor;
        const BufferError: pyBufferErrorConstructor;
        const EOFError: pyEOFErrorConstructor;
        const ImportError: pyImportErrorConstructor;
        const ModuleNotFoundError: pyModuleNotFoundErrorConstructor;
        const LookupError: pyLookupErrorConstructor;
        const IndexError: pyIndexErrorConstructor;
        const KeyError: pyKeyErrorConstructor;
        const MemoryError: pyMemoryErrorConstructor;
        const NameError: pyNameErrorConstructor;
        const UnboundLocalError: pyUnboundLocalErrorConstructor;
        const OSError: pyOSErrorConstructor;
        const FileNotFoundError: pyFileNotFoundErrorConstructor;
        const TimeoutError: pyTimeoutErrorConstructor;
        const ReferenceError: pyReferenceErrorConstructor;
        const RuntimeError: pyRuntimeErrorConstructor;
        const NotImplementedError: pyNotImplementedErrorConstructor;
        const RecursionError: pyRecursionErrorConstructor;
        const SyntaxError: pySyntaxErrorConstructor;
        const IndentationError: pyIndentationErrorConstructor;
        const TabError: pyTabErrorConstructor;
        const SystemError: pySystemErrorConstructor;
        const TypeError: pyTypeErrorConstructor;
        const ValueError: pyValueErrorConstructor;
        const UnicodeError: pyUnicodeErrorConstructor;
        const UnicodeDecodeError: pyUnicodeDecodeErrorConstructor;
        const UnicodeEncodeError: pyUnicodeEncodeErrorConstructor;

        const ExternalError: pyExternalErrorConstructor;

        function checkCallable(obj: any): obj is pyCallable;
        function checkNone(obj: any): obj is pyNoneType;
        function checkString(obj: any): obj is pyStr;
        function checkIterable(obj: any): obj is pyIterable;
        function checkNumber(obj: any): obj is pyFloat | pyInt;
        function checkInt(obj: any): obj is pyInt;
        function checkFloat(obj: any): obj is pyFloat;
        function checkBytes(obj: any): obj is pyBytes;
        function checkClass(obj: any): obj is pyType;
        function checkBool(obj: any): obj is pyBool;
        function checkAnySet(obj: any): obj is pySet | pyFrozenSet;
        function checkMapping(obj: any): obj is pyDict;
        function pyCheckArgs(
            fnName: string,
            args: Args,
            minargs: number,
            maxargs?: number,
            kwargs?: number,
            free?: number
        ): void;
        function pyCheckArgsLen(fnName: string, args: Args, minargs: number, maxargs?: number): void;
        function pyCheckType(fnName: string, excTypeName: string, check: boolean): void;

        function round(num: pyObject, ndigits?: pyObject): pyObject;
        function len(o: pyObject): pyInt | Suspension;
        function min(args: Args, kws: Kws): pyObject | Suspension;
        function max(args: Args, kws: Kws): pyObject | Suspension;

        function any(iter: pyIterable): pyBool;
        function all(iter: pyIterable): pyBool;
        function sum(iter: pyIterable, start?: pyObject): pyObject;
        function abs<T extends pyFloat | pyInt>(obj: T): T;
        function ord(x: pyBytes | pyStr): pyInt;
        function chr(x: pyInt): pyStr;
        function dir(obj: pyObject): pyList;
        function repr(obj: pyObject): pyStr;
        function ascii(obj: pyObject): pyStr;

        function isinstance(obj: pyObject, type: pyType | pyTuple<pyType>): pyBool;
        function issubclass(obj: pyType, type: pyType | pyTuple<pyType>): pyBool;

        function compile(source: pyStr, filename: pyStr, mode: pyStr): pyObject;
        function exec(
            code: string | pyStr,
            gbl?: { [k: string]: pyObject },
            loc?: { [k: string]: pyObject }
        ): { [k: string]: pyObject };

        // @ts-ignore
        function eval(code: string | pyStr, gbl?: { [k: string]: pyObject }, loc?: { [k: string]: pyObject }): pyObject;

        function hasattr(obj: pyObject, attr: pyStr): pyBool | Suspension;
        function getattr(obj: pyObject, attr: pyStr, default_?: pyObject): pyObject | Suspension;
        function hash(obj: pyObject): pyInt;
        function print(args: Args | string[] | (string | pyObject)[]): void;
        function __import__(
            name: string,
            globals?: object,
            locals?: object,
            fromlist?: string[],
            level?: number
        ): pyModule | Suspension;
    }

    export namespace misceval {
        /** @todo possibly just pyCallable<T> but not while we develop */
        function callsimArray<T = pyObject>(callable: pyCallable<T> | pyObject, args?: Args, kws?: Kws): T;
        function callsimOrSuspendArray<T = pyObject>(
            callable: pyCallable<T> | pyObject,
            args?: Args,
            kws?: Kws
        ): T | Suspension;

        /** @deprecated use callsimArray */
        function call(
            func: pyObject,
            kwdict?: pyDict | undefined | null,
            varargseq?: pyTuple | undefined | null,
            kws?: Kws,
            ...args: Args
        ): pyObject;

        /** @deprecated use callsimArray */
        function callsim(callable: pyObject, ...args: Args): pyObject;
        /** @deprecated use callsimOrSuspendArray */
        function callsimOrSuspend(callable: pyObject, ...args: Args): pyObject | Suspension;

        /** @deprecated use callsimOrSuspendArray */
        function applyOrSuspend(
            func: pyObject,
            kwdict: pyDict | undefined | null,
            varargseq: pyTuple | undefined | null,
            kws: Kws,
            args: Args
        ): pyObject | Suspension;

        /** @deprecated use callsimArray */
        function apply(
            func: pyObject,
            kwdict: pyDict | undefined | null,
            varargseq: pyTuple | undefined | null,
            kws: Kws,
            args: Args
        ): pyObject;

        function callAsync<T = pyObject>(
            suspensionHandlers: any,
            func: pyObject | pyCallable<T | Suspension>,
            kwdict?: pyDict,
            varargseq?: pyTuple,
            kws?: Kws,
            ...args: Args
        ): Promise<T>;

        function applyAsync<T = pyObject>(
            suspensionHandlers: any,
            func: pyObject | pyCallable<T | Suspension>,
            kwdict?: pyDict,
            varargseq?: pyTuple,
            kws?: Kws,
            args?: Args
        ): Promise<T>;

        function chain<T, A, B, C, D, E>(
            initArg: T | Suspension,
            f1: (prevRet: T) => A | Suspension,
            f2: (prevRet: A) => B | Suspension,
            f3: (prevRet: B) => C | Suspension,
            f4: (prevRet: C) => D | Suspension,
            f5: (prevRet: D) => E | Suspension
        ): E | Suspension;
        function chain<T, A, B, C, D>(
            initArg: T | Suspension,
            f1: (prevRet: T) => A | Suspension,
            f2: (prevRet: A) => B | Suspension,
            f3: (prevRet: B) => C | Suspension,
            f4: (prevRet: C) => D | Suspension
        ): D | Suspension;
        function chain<T, A, B, C>(
            initArg: T | Suspension,
            f1: (prevRet: T) => A | Suspension,
            f2: (prevRet: A) => B | Suspension,
            f3: (prevRet: B) => C | Suspension
        ): C | Suspension;
        function chain<T, A, B>(
            initArg: T | Suspension,
            f1: (prevRet: T) => A | Suspension,
            f2: (prevRet: A) => B | Suspension
        ): B | Suspension;
        function chain<T, A>(initArg: T | Suspension, f1: (prevRet: T) => A | Suspension): A | Suspension;
        function chain<T = any, R = any>(initArg: T | Suspension, ...chainedFns: ChainedFns<T, R>): R | Suspension;
        function chain<R = any>(initArg: any, ...chainedFns: ChainedFns<any, R>): R | Suspension;

        function tryCatch<R = any, E = any>(fn: () => Suspension | R, catchFn: (e: any) => R | E): R | E | Suspension;

        function retryOptionalSuspensionOrThrow<T = any>(obj: T | Suspension): T extends Suspension ? never : T;

        function promiseToSuspension<T>(p: Promise<T>): Suspension;

        function asyncToPromise<R>(suspFn: () => Suspension | R, suspHandlers?: any): Promise<R>;

        function iterFor<T = pyObject, R = undefined>(
            iterator: pyIterator<T | Suspension>,
            forFn: (currentValue: T, prevRet: R) => R | Suspension,
            initial?: R
        ): R;

        function iterArray<T extends any[], R = undefined>(
            args: T,
            forFnforFn: (currentValue: T, prevRet: R) => R | Suspension,
            initial?: R
        ): R;

        function getAttr(this: pyObject, attr: pyStr): pyObject;
        function getAttr<S extends boolean>(
            this: pyObject,
            attr: pyStr,
            canSuspend?: S
        ): S extends true ? pyObject | Suspension : pyObject;

        function arrayFromIterable<T>(iterable: pyIterable<T>): T[];
        function arrayFromIterable<T, S extends boolean>(
            iterable: pyIterable<T>,
            canSuspend?: S
        ): S extends true ? T[] | Suspension : T[];

        function isTrue(obj: any): boolean;

        function objectRepr(obj: pyObject): string;

        function richCompareBool(a: pyObject, b: pyObject, cmpOp: CompareOp): boolean;

        const Suspension: SuspensionConstructor;
        const Break: BreakConstructor;

        function buildClass<T extends pyObject = pyObject>(
            globals: { [gbl: string]: pyObject },
            body: (gbl: { [gbl: string]: pyObject }, loc: { [gbl: string]: pyObject }) => void,
            name: string,
            bases?: [pyNewableType<T>] | pyType[],
            cell?: any,
            kws?: Kws
        ): pyNewableType<T>;
    }

    export namespace ffi {
        function toPy<T = any>(
            obj: T,
            hooks?: any
        ): T extends string
            ? pyStr
            : T extends null | undefined
            ? pyNoneType
            : T extends boolean
            ? pyBool
            : T extends number
            ? pyInt | pyFloat
            : T extends Array<any>
            ? pyList
            : T extends Record<string, unknown>
            ? pyDict<pyStr, pyObject>
            : pyObject;

        function toJs<T = any>(
            obj: T,
            hooks?: any
        ): T extends pyStr
            ? string
            : T extends pyNoneType
            ? null
            : T extends pyBool
            ? boolean
            : T extends pyInt
            ? number | bigint
            : T extends pyFloat
            ? number
            : T extends pyTuple | pyList
            ? any[]
            : T extends pyFloat
            ? number
            : T extends pyBytes
            ? Uint8Array
            : T extends pyObject
            ? unknown
            : T;
        function proxy<T = any>(obj: T): pyProxy<T>;

        /** @deprecated use Sk.ffi.toPy */
        const remapToPy: typeof toPy;
        /** @deprecated use Sk.ffi.toJs */
        const remapToJs: typeof toJs;

        const remapToJsOrWrap: <T = any>(obj: T) => ReturnType<typeof toJs<T>>;
    }

    export namespace generic {
        function getAttr(this: pyObject, attr: pyStr): pyObject;
        function getAttr<S extends boolean>(
            this: pyObject,
            attr: pyStr,
            canSuspend?: S
        ): S extends true ? pyObject | Suspension : pyObject;

        function setAttr(this: pyObject, attr: pyStr, val: pyObject): void;
        export function setAttr<S extends boolean>(
            this: pyObject,
            attr: pyStr,
            val: pyObject,
            canSuspend?: S
        ): S extends true ? void | Suspension : void;

        const getSetDict: {
            $get(): pyDict;
            $set(): void;
        };
    }

    export namespace abstr {
        const buildNativeClass: typeof ABSTR.buildNativeClass;
        const buildIteratorClass: typeof ABSTR.buildIteratorClass;

        const setUpModuleMethods: typeof ABSTR.setUpModuleMethods;

        function gattr<R extends pyObject = pyObject>(obj: pyObject, attr: pyStr, canSuspend?: false): R;
        function gattr<R extends pyObject = pyObject>(obj: pyObject, attr: pyStr, canSuspend: true): R | Suspension;

        function sattr(obj: pyObject, attr: pyStr, val: pyObject, canSuspend: true): void | Suspension;
        function sattr(obj: pyObject, attr: pyStr, val: pyObject, canSuspend?: false): void;

        function iter<T>(obj: pyIterable<T> | pyObject): pyIterator<T>;

        function lookupSpecial<R = pyObject | undefined>(obj: pyObject, attr: pyStr): R;
        function typeLookup<R = pyObject | undefined>(obj: pyType, attr: pyStr): R;

        function objectGetItem<R = pyObject>(obj: pyObject, item: pyObject, canSuspend?: false): R;
        function objectGetItem<R = pyObject>(obj: pyObject, item: pyObject, canSuspend: true): R | Suspension;
        function objectSetItem(obj: pyObject, item: pyObject, val: pyObject, canSuspend?: false): void;
        function objectSetItem(obj: pyObject, item: pyObject, val: pyObject, canSuspend: true): void | Suspension;
        function objectDelItem(obj: pyObject, item: pyObject, canSuspend?: false): void;
        function objectDelItem(obj: pyObject, item: pyObject, canSuspend: true): void | Suspension;

        function typeName(obj: pyObject): string;

        function copyKeywordsToNamedArgs(
            funcName: string,
            varnames: string[],
            args: Args,
            kws?: Kws,
            defaults?: any[]
        ): any[];
        function checkArgsLen(funcName: string, args: Args, minargs: number, maxargs?: number): void;
        function checkOneArg(funcName: string, args: Args, kws?: Kws): void;
        function checkNoArgs(funcName: string, args: Args, kws?: Kws): void;
        function checkNoKwargs(funcName: string, kws?: Kws): void;

        function numberBinOp(a: pyObject, b: pyObject, op: BinOp): pyObject;
        function numberInplaceBinOp(a: pyObject, b: pyObject, op: BinOp): pyObject;
        function numberUnaryOp(a: pyObject, op: BinOp): pyObject;

        function sequenceContains<S extends boolean>(
            seq: pyObject,
            v: pyObject,
            canSuspend?: S
        ): S extends true ? boolean | Suspension : boolean;

        function keywordArrayFromPyDict(d: pyDict): Kws;
        function keywordArrayToPyDict(kws: Kws): pyDict<pyStr, pyObject>;

        function objectHash(obj: pyObject): number;
    }

    const sysmodules: pyDict<pyStr, pyModule>;

    function configure(options: any): void;
    function importSetUpPath(): void;

    /** imports a module by name - use standard dot notation for a nested module, returns the top level module */
    function importModule(name: string, dumpJs: boolean, canSuspend: boolean): pyModule | Suspension;

    /** @private use at your own risk */
    function importModuleInternal_(
        fullName: string,
        dumpJs: boolean,
        name: string,
        suppliedPyBody?: string,
        relativeToPackage?: string,
        returnUndefinedOnTopLevelNotFound?: boolean,
        canSuspend?: boolean
    ): Suspension | pyModule;

    function compile(
        source: string,
        filename: string,
        mode: "exec",
        canSuspend?: boolean
    ): {
        funcname: "$compiledmod";
        code: string;
        filename: string;
    };

    const python3: any;
    const python2: any;

    const __future__: {
        python3: boolean;
        [key: string]: any;
    };

    let yieldLimit: number;
    let lastYield: number;
    let execStart: number;

    function setTimeout(fn: () => void, timeout: number): void;
    function output(...args: any): void;
    function parse(filename: string, input: string): { cst: any; flags: number };
    function astFromParse(cst: any, filename: string, flags: number): any;

    namespace astnodes {
        const Expr: any;
        const Module: any;
    }

    let builtins: Record<string, pyObject>;

    const builtinFiles: { files: { [filename: string]: string } };
}

type ChainedFns<T, R> =
| [...((prevRet: T) => T | Suspension)[], (prevRet: T) => R]
| ((prevRet: T) => T | Suspension)[]
| [(prevRet: T) => R]
| [];

export type Args<T extends pyObject[] = pyObject[]> = T;
export type Kws = (string | pyObject)[]; // Can't declare alternating array in TS

export type CompareOp = "Gt" | "GtE" | "Lt" | "LtE" | "Eq" | "NotEq";
export type BinOp =
    | "Add"
    | "Sub"
    | "Mult"
    | "MatMult"
    | "Div"
    | "FloorDiv"
    | "Mod"
    | "Pow"
    | "LShift"
    | "RShift"
    | "BitAnd"
    | "BitOr"
    | "BitXor";

export type UnaryOp = "Not" | "USub" | "UAdd" | "Invert";

export type Flags = | { OneArg: true }
| { NoArgs: true }
| { FastCall: true }
| { FastCall: true; NoKwargs: true }
| { MinArgs: number; MaxArgs?: number }
| { NamedArgs: (null | string)[]; Defaults?: any[] };


type Skulpt = typeof Sk;

type UnTyped = { [attr: string]: any };

export interface SkulptUnTyped {
    [attr: string]: any;
    abstr: UnTyped;
    builtin: UnTyped;
    generic: UnTyped;
    misceval: UnTyped;
}

declare global {
    const Sk: SkulptUnTyped & Skulpt;
    // const Sk: Skulpt;
}
