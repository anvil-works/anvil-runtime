import { pyBaseException } from "@Sk";

export interface AnvilErrorInfo {
    type: string;
    docUrl?: string;
    docLinkTitle?: string;
}

type AnvilBaseException = pyBaseException & {
    _anvil?: { errorObj?: AnvilErrorInfo };
};

export function getAnvilErrorInfo(error: unknown): AnvilErrorInfo | undefined {
    return error instanceof pyBaseException ? (error as AnvilBaseException)._anvil?.errorObj : undefined;
}

export function withAnvilErrorInfo<T extends pyBaseException>(error: T, errorInfo: Omit<AnvilErrorInfo, "type">): T {
    (error as AnvilBaseException)._anvil = {
        errorObj: { type: error.tp$name, ...errorInfo },
    };
    return error;
}

export const strError = (err: any) =>
    typeof err === "string" ? err : err instanceof Sk.builtin.BaseException ? err.toString() : "<Internal error>";

export function reportError(err: pyBaseException | any) {
    // @ts-ignore
    window.onerror(null, null, null, null, err);
}
