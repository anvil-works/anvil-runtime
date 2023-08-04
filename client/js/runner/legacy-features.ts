const legacyOptions = {
    classNames: false,
    bootstrap3: false,
};

type LegacyOptions = typeof legacyOptions;
type LegacyOption = keyof LegacyOptions;

const isValidOption = (option: any): option is LegacyOption => option in legacyOptions;

let initLegacyOptions = false;

export function setLegacyOptions(options: Partial<LegacyOptions>) {
    if (initLegacyOptions) return;
    initLegacyOptions = true;
    options ??= {};
    for (const legacyOption of Object.keys(options)) {
        if (isValidOption(legacyOption)) {
            legacyOptions[legacyOption] = !!options[legacyOption];
        }
    }
    setLegacyClassNames();
    setLegacyBootstrap3();
}

let _prefix: string;

export function getCssPrefix() {
    if (_prefix != null) return _prefix;
    if (window.anvilParams.runtimeVersion < 3) return (_prefix = "");
    if (legacyOptions.classNames) return (_prefix = "");
    return (_prefix = "anvil-");
}

const getFirstLink = () => document.head.querySelector("link")!;

function mkLink(href: string) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = window.anvilCDNOrigin + "/runtime" + href + "?buildTime=" + BUILD_TIME;
    return link;
}

function mkScript(src: string) {
    const script = document.createElement("script");
    script.src = window.anvilCDNOrigin + "/runtime" + src + "?buildTime=" + BUILD_TIME;
    script.type = "text/javascript";
    return script;
}

function setLegacyClassNames() {
    if (!legacyOptions.classNames) return;
    const firstLink = getFirstLink();
    document.head.insertBefore(mkLink("/dist/runner.min.css"), firstLink);
}

function setLegacyBootstrap3() {
    if (!legacyOptions.bootstrap3) return;
    const firstLink = getFirstLink();
    document.head.insertBefore(mkLink("/css/bootstrap.css"), firstLink);
    document.head.insertBefore(mkLink("/css/bootstrap-theme.min.css"), firstLink);
    document.head.insertBefore(mkLink("/node_modules/animate.css/animate.min.css"), firstLink);
    document.head.appendChild(mkScript("/node_modules/bootstrap/dist/js/bootstrap.min.js"));
}

const INLINE_STYLES = {
    checkbox: "padding: 7px 7px 7px 20px;",
    radio: "padding: 7px 7px 7px 20px;",
} as const;

export function getInlineStyles(key: keyof typeof INLINE_STYLES) {
    if (window.anvilParams.runtimeVersion >= 3) return "";
    return INLINE_STYLES[key];
}