import { buildNativeClass, checkArgsLen, pyCall, pyCallOrSuspend, pyNewableType, pyNone, pyObject, toJs } from "@Sk";
import { SpinnerLoader, appendSvgSpinner, getBodySpinner } from "@runtime/runner/loading-spinner";
import { anvilJsMod, kwsToJsObj } from "@runtime/runner/py-util";
import { globalSuppressLoading } from "@runtime/utils";
import { cssLength } from "PyDefUtils";

// Transparent overlay prevents clicking
const OVERLAY = document.createElement("div");
OVERLAY.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;";

const OVERLAY_CACHE = new WeakMap<HTMLElement, HTMLElement>();

function getOrCreateOverlay(target: HTMLElement, opts: Record<string, any>) {
    const cached = OVERLAY_CACHE.get(target);
    if (cached) {
        return cached;
    }
    // overlay creates a non-clickable area, we could tweak this behaviour if want to in the opts
    const overlay = OVERLAY.cloneNode() as HTMLDivElement;
    OVERLAY_CACHE.set(target, overlay);

    const spinner = document.createElement("div");
    overlay.appendChild(spinner);
    spinner.className = "anvil-loading-spinner anvil-spinner";
    spinner.style.opacity = "0";

    const styleMinHeight = target.style.minHeight;
    if (opts.min_height) {
        target.style.minHeight = cssLength(opts.min_height);
    }
    const height = target.clientHeight;
    const minSize = Math.max(50, Math.min(height, target.clientWidth));
    target.style.minHeight = styleMinHeight;
    let size = 70;
    let shadow = 100;
    if (minSize < 400) {
        shadow = (minSize - 10) / 4;
        size = Math.min(Math.max(24, shadow), 70);
    }

    spinner.style.setProperty("--anvil-spinner-size", size + "px");
    spinner.style.setProperty("--anvil-spinner-shadow", shadow + "px");
    if (height < 500) {
        // default is 33% rather than 50%;
        spinner.style.setProperty("top", "calc(50% - calc(var(--anvil-spinner-size) / 2))");
    }
    // this could be an options
    appendSvgSpinner(spinner);

    return overlay;
}

const $flags = { FastCall: true } as const;

interface LoadingIndicator extends pyObject {
    _dom: HTMLElement;
    _opt: Record<string, any>;
    _loader: SpinnerLoader;
}

export const LoadingIndicator: pyNewableType<LoadingIndicator> = buildNativeClass("anvil.loading_indicator", {
    constructor: function () {
        this.$running = false;
    },
    slots: {
        tp$init(args, kws) {
            checkArgsLen("loading_indicator", args, 0, 1);
            // In the future we can support kws
            // checkNoKwargs("loading_indicator", kws);
            this._opts = kwsToJsObj(kws);
            // if (this._opts.min_height === undefined) {
            //     this._opts.min_height = 220;
            // }
            const [el] = args;
            this._dom = el ? toJs(pyCall(anvilJsMod.get_dom_node, [el])) : document.body;
        },
        tp$call(args, kws) {
            return pyCallOrSuspend(this.ob$type, args, kws);
        },
    },
    methods: {
        __enter__: {
            $meth() {
                this.$start();
                return this;
            },
            $flags,
        },
        __exit__: {
            $meth() {
                this.$stop();
                return pyNone;
            },
            $flags,
        },
        start: {
            $meth() {
                this.$start();
                return pyNone;
            },
            $flags,
        },
        stop: {
            $meth() {
                this.$stop();
                return pyNone;
            },
            $flags,
        },
    },
    proto: {
        $start(this: LoadingIndicator) {
            if (this._dom === document.body) {
                this._loader ??= getBodySpinner() ?? this.$getLoadingSpinner();
            } else {
                this._loader ??= this.$getLoadingSpinner();
            }
            if (!this.$running) {
                this.$running = true;
                this._loader.setLoading(true);
                globalSuppressLoading.inc();
            }
        },
        $stop(this: LoadingIndicator) {
            if (this.$running) {
                this.$running = false;
                this._loader.setLoading(false);
                globalSuppressLoading.dec();
            }
        },
        $getLoadingSpinner(this: LoadingIndicator) {
            // At the moment this returns the cached overlay if it's active
            // If we support options, we could potentially manipulate the overlay if the options change
            const overlay = getOrCreateOverlay(this._dom, this._opts);
            const computedStyles = getComputedStyle(this._dom);
            const position = computedStyles.position;
            const styleMinHeight = this._dom.style.minHeight;
            const stylePosition = this._dom.style.position;
            return SpinnerLoader.getOrCreate(overlay.firstElementChild as HTMLElement, {
                onStart: () => {
                    if (["static", "relative"].includes(position)) {
                        // Making it relative is almost always probably fine
                        this._dom.style.position = "relative";
                    }
                    if (this._opts.min_height) {
                        this._dom.style.minHeight = cssLength(this._opts.min_height);
                    }
                    this._dom.appendChild(overlay);
                },
                onFinish: () => {
                    overlay.remove();
                    this._dom.style.position = stylePosition;
                    this._dom.style.minHeight = styleMinHeight;
                    OVERLAY_CACHE.delete(this._dom);
                },
            });
        },
    },
});

export const loading_indicator = pyCall(LoadingIndicator);
