/// <reference path="../node_modules/moment/ts3.1-typings/moment.d.ts" />

declare global {
    let ANVIL_IN_DESIGNER: boolean;
    let BUILD_TIME: number;
    let __webpack_public_path__: string;

    interface JQueryStatic {
        (element: Element | Document | JQuery | JQuery.PlainObject | string): JQuery;
    }

    interface PrintDelayDeferred {
        promise: Promise<unknown>;
        resolve(value?: unknown): void;
        reject(reason?: unknown): void;
    }

    interface Window {
        anvilCallIdeFn(fn: string, args: unknown, timeout?: number | null): Promise<unknown>;
        anvilAppDependencyIds: Record<string, string>;
        anvilAppMainPackage: string;
        anvilCustomComponentProperties: Record<string, { name: string; type: string; default_value: unknown }[]>;
        anvilForceRpcHttp?: boolean;
        isIE?: boolean;
        messages: Record<string, (this: Record<string, unknown>, args: unknown) => unknown>;
        outstandingPrintDelayPromises?: Record<string, PrintDelayDeferred>;
        PyDefUtils?: {
            updateHeight?: () => void;
        };
    }
}

export {};
