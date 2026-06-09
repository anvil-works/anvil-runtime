import { pyBaseException } from "@Sk";

export const strError = (err: any) =>
    typeof err === "string" ? err : err instanceof Sk.builtin.BaseException ? err.toString() : "<Internal error>";

// Some iOS browser wrappers can emit an opaque "Script error." event with no
// error object or source location, including after benign calls like alert().
// Suppress only that unactionable shape so genuine script errors with context
// still reach the default error handler.
// https://anvil.works/forum/t/alert-gives-script-error-on-ios-firefox/25926
export function isOpaqueScriptError(
    errormsg?: string | null | Event,
    jsUrl?: string | null,
    jsLine?: number | null,
    jsCol?: number | null,
    errorObj?: Error | any
) {
    return (
        errormsg === "Script error." &&
        errorObj == null &&
        (jsUrl == null || jsUrl === "") &&
        (jsLine == null || jsLine === 0) &&
        (jsCol == null || jsCol === 0)
    );
}

export function reportError(err: pyBaseException | any) {
    // @ts-ignore
    window.onerror(null, null, null, null, err);
}
