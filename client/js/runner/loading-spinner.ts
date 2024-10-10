let spinnerSvg;
let loadingSpinnerEl: HTMLElement | null = null;
let loadingSpinner: SpinnerLoader;

export function appendSvgSpinner(el: HTMLElement) {
    loadingSpinnerEl ??= document.getElementById("loadingSpinner");
    spinnerSvg ??= loadingSpinnerEl?.querySelector("svg");
    if (!spinnerSvg) return;
    el.appendChild(spinnerSvg.cloneNode(true));
}

/** backwards compatibility - we've always supported/recommended background-image as the way to do change the loading-spinner */
export function checkForBackgroundImage(spinner: HTMLElement) {
    const getBgImage = (pseudo: undefined | string) => getComputedStyle(spinner, pseudo).backgroundImage;
    const svg = spinner.querySelector("svg");
    if (!svg) return;
    for (const pseudo of [undefined, "::after", "::before"]) {
        if (getBgImage(pseudo) !== "none") {
            svg.style.setProperty("display", "none");
            return;
        }
    }
    svg.style.removeProperty("display");
}

interface SpinnerOptions {
    onStart?: () => void;
    onFinish?: () => void;
}

const SpinnerLoaderCache = new WeakMap<HTMLElement, SpinnerLoader>();

export class SpinnerLoader {
    timeout: undefined | number;
    animation: Animation | null = null;
    refCount = 0;
    static getOrCreate(el: HTMLElement, options: SpinnerOptions = {}) {
        const cached = SpinnerLoaderCache.get(el);
        if (cached) return cached; // there is an active spinner ignore the options;
        const spinnerLoader = new SpinnerLoader(el, options);
        SpinnerLoaderCache.set(el, spinnerLoader);
        return spinnerLoader;
    }
    private constructor(readonly el: HTMLElement, readonly options: SpinnerOptions = {}) {}
    private get opacity() {
        return +(getComputedStyle(this.el).opacity || "1");
    }
    private commitStyles() {
        if (!this.animation) return;
        try {
            this.animation.commitStyles();
        } catch (e) {
            console.warn(e);
            // might throw if we can't commit styles (e.g. the element isn't rendered)
        }
        this.animation.cancel();
    }
    private animate(endOpacity: number, duration: number) {
        this.el.style.display = "block";
        this.commitStyles();
        const opacity = this.opacity;
        this.animation = this.el.animate?.([{ opacity }, { opacity: endOpacity }], {
            duration,
            fill: "forwards",
        });
        const onfinish = () => {
            this.commitStyles();
            if (endOpacity === 0) {
                this.el.style.display = "none";
            }
            if (this.refCount === 0) {
                this.options.onFinish?.();
            }
            this.animation = null;
        };
        if (this.animation) {
            this.animation.onfinish = onfinish;
        } else {
            // older browsers - https://caniuse.com/mdn-api_element_animate safari < 13.1 (2020-03-24)
            clearTimeout(this.timeout);
            this.timeout = setTimeout(onfinish, duration);
        }
    }
    private fadeIn(duration = 400) {
        this.animate(1, duration);
    }
    private fadeOut(duration = 200) {
        this.animate(0, duration);
    }
    setLoading(loading: boolean, { animate = true } = {}) {
        const prevRefCount = this.refCount;
        if (loading) {
            this.refCount++;
        } else {
            this.refCount--;
        }
        if (!animate) return;
        if (prevRefCount === 0 && this.refCount > 0) {
            this.options.onStart?.();
            checkForBackgroundImage(this.el);
            this.fadeIn();
        } else if (prevRefCount > 0 && this.refCount === 0) {
            this.fadeOut();
        }
    }
    async withIndicator(p: Promise<any>) {
        this.setLoading(true);
        await p;
        this.setLoading(false);
    }
}

export function getBodySpinner() {
    loadingSpinnerEl ??= document.getElementById("loadingSpinner");
    if (!loadingSpinnerEl) return;
    loadingSpinner ??= SpinnerLoader.getOrCreate(loadingSpinnerEl);
    return loadingSpinner;
}

export function setLoading(loading?: boolean, opts?: { animate: boolean }) {
    getBodySpinner()?.setLoading(!!loading, opts);
}
