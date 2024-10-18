import { pyBaseException } from "@Sk";

export const strError = (err: any) =>
    typeof err === "string" ? err : err instanceof Sk.builtin.BaseException ? err.toString() : "<Internal error>";

export function reportError(err: pyBaseException) {
    // @ts-ignore
    window.onerror(null, null, null, null, err);
}
