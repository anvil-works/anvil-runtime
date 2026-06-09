import type { Args, Kws } from "@Sk";
import { pyModule as PyModule, pyFunc, pyStr } from "@Sk";
import { PyModMap, getImportedModule, kwsToJsObj, kwsToObj } from "@runtime/runner/py-util";

/**
 * A little hack to make a Javascript-implemented Python module
 * This meddles with Skulpt internals and is liable to break.
 * Dotted names are handled by attaching submodules to their parent module.
 */
export function loadModule(name: string, modvars: PyModMap) {
    const pyModule = new PyModule();
    Sk.sysmodules.mp$ass_subscript(new pyStr(name), pyModule);
    pyModule.$js = "/* source code not available */";
    pyModule.$d = modvars;

    // If it's a submodule, we assume the parent has already
    // been loaded, and add it as an attribute to the parent
    const dottedSplit = /^(.*)\.([^.]+)$/.exec(name);
    if (dottedSplit) {
        const parent = getImportedModule(dottedSplit[1]);
        parent.$d[dottedSplit[2]] = pyModule;
    }
}

type CoKwargsFunction<T extends Function> = T & { co_kwargs: true };

/**
 * Skulpt functions that take keyword arguments must be marked with the
 * `co_kwargs` property, and will receive an array of alternating keys and values
 * as their first argument.
 *
 * `withKwargs()` takes a JavaScript function that expects a JavaScript object
 * of keyword keys/values as its first argument, and turns it into the sort of
 * function Skulpt will accept.
 */
export function withKwargs<T extends Function>(f: T) {
    const rf = function (this: unknown, pyKwarray: Kws, ...moreFunctionArgs: Args) {
        const jsObj = kwsToJsObj(pyKwarray);
        return f.apply(this, [jsObj].concat(moreFunctionArgs));
    };
    (rf as CoKwargsFunction<typeof rf>).co_kwargs = true;
    return rf as CoKwargsFunction<typeof rf>;
}

/**
 * Helper for exposing a `withKwargs()`-adapted function as a Skulpt `pyFunc`.
 *
 * takes a JavaScript function that expects a JavaScript object
 * of keyword keys/values as its first argument, and turns it into the sort of
 * function Skulpt will accept.
 *
 */
export function funcWithKwargs<T extends Function>(f: T) {
    return new pyFunc(withKwargs(f));
}

/**
 * Sometimes, you don't want the kwargs transformed into JavaScript.
 * Just mark the function as taking kwargs.
 */
export function withRawKwargs<T extends Function>(f: T) {
    (f as CoKwargsFunction<T>).co_kwargs = true;
    return f as CoKwargsFunction<T>;
}

/**
 * Like `withKwargs()`, but uses `kwsToObj()` to build kwargs from the raw array,
 * then exposes the result as a Skulpt `pyFunc`.
 */
export function funcWithRawKwargsDict<T extends Function>(f: T) {
    const rf = function (this: unknown, pyKwarray: Kws, ...moreFunctionArgs: Args) {
        const kwargs = kwsToObj(pyKwarray);
        return f.apply(this, [kwargs].concat(moreFunctionArgs));
    };
    (rf as CoKwargsFunction<typeof rf>).co_kwargs = true;
    return new pyFunc(rf);
}
