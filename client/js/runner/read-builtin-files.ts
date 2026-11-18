import { promiseToSuspension } from "@Sk";
import { data } from "./data";
import { wait } from "@runtime/utils";

interface RetryOptions {
    retries: number;
    delay: number;
    onRetry: (e: any, attempt: number) => void;
}

async function retryAsync<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
    const attempt = async (retriesLeft: number): Promise<T> => {
        try {
            return await fn();
        } catch (e) {
            const attemptNumber = options.retries - retriesLeft;
            options.onRetry(e, attemptNumber);

            if (retriesLeft > 0) {
                await wait(options.delay * attemptNumber);
                return attempt(retriesLeft - 1);
            }
            throw e;
        }
    };

    return attempt(options.retries - 1);
}

function importSkulptStdLibFn(file: number) {
    switch (file) {
        case 1:
            return import("@runtime/lib/skulpt-stdlib-1.json");
        case 2:
            return import("@runtime/lib/skulpt-stdlib-2.json");
        case 3:
            return import("@runtime/lib/skulpt-stdlib-3.json");
        case 4:
            return import("@runtime/lib/skulpt-stdlib-4.json");
        default:
            return Promise.resolve({ default: {} as any });
    }
}

async function getBuiltinFiles(file: number) {
    return retryAsync(() => importSkulptStdLibFn(file), {
        retries: 3,
        delay: 300,
        onRetry: (e, attempt) => {
            const sessionToken = window.anvilSessionToken;
            $.post(data.appOrigin + "/_/log?_anvil_session=" + sessionToken, {
                eventType: "skulptLazyImportError",
                event: {
                    path: `@runtime/lib/skulpt-stdlib-${file}.json`,
                    retries: attempt,
                    error: e?.toString() ?? "",
                },
            });
        },
    });
}

export function readBuiltinFiles(path: string) {
    const file = Sk.builtinFiles?.files[path];
    if (file === undefined) {
        throw "File not found: '" + path + "'";
    } else if (typeof file === "number") {
        return promiseToSuspension(
            getBuiltinFiles(file).then((newFiles) => {
                Object.assign(Sk.builtinFiles.files, newFiles.default);
                return newFiles.default[path];
            })
        );
    } else {
        return file;
    }
}
