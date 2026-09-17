import { pyFunc, pyNone, pyObject, toJs, toPy } from "@Sk";
import { closestComponentFromElement } from "@runtime/components/component-dom";

export function createServiceHelperFunctions() {
    const getServiceClientConfig = new pyFunc(function (pyYmlPath: pyObject) {
        const path = toJs(pyYmlPath) as string;
        return toPy(window.anvilServiceClientConfig[path] || null);
    });

    const getAnvilCdnOrigin = new pyFunc(() => {
        return toPy(window.anvilCDNOrigin);
    });

    const getFocusedComponent = new pyFunc(function () {
        const el = document.activeElement ?? document.body;
        const component = closestComponentFromElement(el);
        return component || pyNone;
    });

    return { getServiceClientConfig, getAnvilCdnOrigin, getFocusedComponent };
}
