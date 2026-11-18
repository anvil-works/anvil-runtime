import { logEvent } from "./logging";

export interface RuntimeWarning {
    message: string;
    docUrl?: string;
    docLinkTitle?: string;
}

const warnedKeys = new Set<string>();
let warningHandler: ((warning: RuntimeWarning) => void) | undefined;

/** The IDE supplies a handler to display warnings with documentation links. */
export function setWarningHandler(handler: typeof warningHandler) {
    warningHandler = handler;
}

/** Suppress repeated warnings with the same key. Unkeyed warnings always print. */
export function warn(
    msg: string,
    { key, docUrl, docLinkTitle }: { key?: string; docUrl?: string; docLinkTitle?: string } = {}
) {
    if (key !== undefined) {
        if (warnedKeys.has(key)) {
            return;
        }
        warnedKeys.add(key);
    }
    if (!msg.toLowerCase().startsWith("warning:")) {
        msg = "Warning: " + msg;
    }
    const text = docUrl ? `${msg} See https://anvil.works/docs${docUrl}` : msg;
    if (warningHandler) {
        // The IDE handler flushes earlier stdout before this warning is logged.
        warningHandler({ message: msg, docUrl, docLinkTitle });
        logEvent({ print: text + "\n" });
    } else {
        Sk.builtin.print([text]);
    }
}
