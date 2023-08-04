import type { pyCallable, pyException, pyNewableType } from "@Sk";

export const pyNamedExceptions: { [name: string]: pyNewableType<pyException> } = {};
export const pyServerEventHandlers: { [event: string]: pyCallable[] } = {};
export const pyValueTypes: { [key: string]: any } = {};
export const CHUNK_SIZE = 65536;
export const VT_GLOBAL = "vt_global";
