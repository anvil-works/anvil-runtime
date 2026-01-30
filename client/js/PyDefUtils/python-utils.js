import { getImportedModule, kwsToObj } from "@runtime/runner/py-util";

/**
 * A little hack to make a Javascript-implemented Python module
 * This meddles with Skulpt internals and is liable to break.
 * It doesn't handle dotted names
 *
 * @param {string} name
 * @param {{[attr: string]: pyObject}} modvars
 */
export function loadModule(name, modvars) {
    const pyModule = new Sk.builtin.module();
    Sk.sysmodules.mp$ass_subscript(new Sk.builtin.str(name), pyModule);
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

// Skulpt functions that take keyword arguments must be marked with the
// co_kwargs property, and will receive an array of alternating keys and values
// as their first argument. withKwargs() takes a Javascript function that
// expects a Javascript object of keyword keys/values as its first argument,
// and turns it into the sort of function Skulpt will accept.
export function withKwargs(f) {
    var rf = function (pyKwarray, more_function_args) {
        var kwargs = {};
        for (var i = 0; i < pyKwarray.length - 1; i += 2) kwargs[pyKwarray[i].v] = Sk.ffi.remapToJs(pyKwarray[i + 1]);

        return f.apply(this, [kwargs].concat(Array.prototype.slice.call(arguments, 1)));
    };
    rf.co_kwargs = true;
    return rf;
}

export function funcWithKwargs(f) {
    return new Sk.builtin.func(withKwargs(f));
}

// Sometimes, you don't want the kwargs transformed into Javascript.
// Just mark the function as taking kwargs.
export function withRawKwargs(f) {
    f.co_kwargs = true;
    return f;
}

export function funcWithRawKwargsDict(f) {
    var rf = function (pyKwarray, more_function_args) {
        const kwargs = kwsToObj(pyKwarray);
        return f.apply(this, [kwargs].concat(Array.prototype.slice.call(arguments, 1)));
    };
    rf.co_kwargs = true;
    return new Sk.builtin.func(rf);
}
