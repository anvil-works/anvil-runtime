import type { Args, Kws, Suspension, pyObject } from "@Sk";
import { pyFunc } from "@Sk";

export function funcFastCall<R extends pyObject | Suspension, A extends Args>(f: (args: A, kws?: Kws) => R) {
    // @ts-ignore
    f.co_fastcall = 1;
    return new pyFunc(f as (args: A, kws?: Kws) => pyObject | Suspension);
}
