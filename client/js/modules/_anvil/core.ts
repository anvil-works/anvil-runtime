import { pyFunc, pyNone, pyObject, toJs, toPy } from "@Sk";

export interface UncaughtExceptions {
    pyHandler: pyObject;
}

export function createCoreFunctions(uncaughtExceptions: UncaughtExceptions) {
    const getUrlHash = new pyFunc(function () {
        const h = document.location.hash;

        if (h[1] == "?" || (h[1] == "!" && h[2] == "?")) {
            const params: Record<string, string> = {};
            $.each(h.substring(h[1] == "?" ? 2 : 3).split("&"), function (i, p) {
                const kv = p.split("=");
                params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
            });

            return toPy(params);
        } else {
            return toPy(decodeURIComponent(h.substring(1)));
        }
    });

    const setUrlHash = new pyFunc(function (pyVal: pyObject) {
        const val = toJs(pyVal);

        if (typeof val == "object") {
            document.location.hash = "?" + $.param(val as JQuery.PlainObject<unknown>);
        } else {
            document.location.hash = val as string;
        }
        return pyNone;
    });

    const setDefaultErrorHandling = new pyFunc(function (f: pyObject | undefined) {
        uncaughtExceptions.pyHandler = f || pyNone;
        return pyNone;
    });

    const generateInternalError = new pyFunc(function () {
        throw { internal: "error" };
    });

    return {
        getUrlHash,
        setUrlHash,
        setDefaultErrorHandling,
        generateInternalError,
    };
}
