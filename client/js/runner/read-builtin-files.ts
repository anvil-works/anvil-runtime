import { promiseToSuspension } from "@Sk";
import { wait } from "@runtime/utils";
import { data } from "./data";

async function fetchBuiltinFile(path: string, fileNum: number, retries = 0): Promise<any> {
    try {
        const fetchUrl = window.anvilSkulptLib[fileNum];
        const body = await fetch(fetchUrl);
        return body.json();
    } catch (e: any) {
        const sessionToken = window.anvilSessionToken;
        $.post(data.appOrigin + "/_/log?_anvil_session=" + sessionToken, {
            eventType: "skulptLazyImportError",
            event: { path, retries, error: e?.toString() ?? "" },
        });

        // sometimes this fetch seems to fail occasionally, so try again
        if (retries < 3) {
            retries++;
            return wait(300 * retries).then(() => fetchBuiltinFile(path, fileNum, retries));
        } else {
            throw e;
        }
    }
}

export function readBuiltinFiles(path: string) {
    const file = Sk.builtinFiles?.files[path];
    if (file === undefined) {
        throw "File not found: '" + path + "'";
    } else if (typeof file === "number") {
        // slow path we need to do a fetch
        return promiseToSuspension(
            fetchBuiltinFile(path, file).then((newFiles) => {
                Object.assign(Sk.builtinFiles.files, newFiles);
                return newFiles[path];
            })
        );
    } else {
        return file;
    }
}
