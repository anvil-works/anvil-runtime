import type { Args, Kws, Suspension, pyObject } from "@Sk";
import { pyFunc } from "@Sk";

export function funcFastCall<T extends pyObject | Suspension, A extends Args>(f: (args: A, kws?: Kws) => T) {
    // @ts-ignore
    f.co_fastcall = 1;
    return new pyFunc(f);
}
