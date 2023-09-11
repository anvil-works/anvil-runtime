import { pyGetSetDescriptor, pyStr } from "@Sk";
import type { ComponentConstructor } from "@runtime/components/Component";

const legacyOptions = {
    classNames: false,
    bootstrap3: false,
    __dict__: false,
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
    setLegacyDict();
}

let _prefix: string;

export function getCssPrefix() {
    if (_prefix != null) return _prefix;
    if (window.anvilParams.runtimeVersion < 3) return (_prefix = "");
    if (legacyOptions.classNames) return (_prefix = "");
    return (_prefix = "anvil-");
}

const getFirstLink = () => document.head.querySelector("link")!;

const getQueryParam = () => process.env.NODE_ENV === "production" ? "?buildTime=" + BUILD_TIME : "?buildTime=0";

function mkLink(href: string) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = window.anvilCDNOrigin + "/runtime" + href + getQueryParam();
    return link;
}

function mkScript(src: string) {
    const script = document.createElement("script");
    script.src = window.anvilCDNOrigin + "/runtime" + src + getQueryParam();
    script.type = "text/javascript";
    return script;
}

function setLegacyClassNames() {
    if (!legacyOptions.classNames) return;
    if (ANVIL_IN_DESIGNER) {
        document.documentElement.classList.add("designer");
    } else {
        document.documentElement.classList.add("runner");
    }
    const firstLink = getFirstLink();
    document.head.insertBefore(mkLink("/dist/runner.min.css"), firstLink);
    if (ANVIL_IN_DESIGNER) {
        document.head.insertBefore(mkLink("/css/designer.css"), firstLink);
    }
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

function setLegacyDict() {
    if (!legacyOptions.__dict__) return;
    const anvilModule = Sk.sysmodules.quick$lookup(new pyStr("anvil"));
    if (!anvilModule) return;
    const ClassicComponent = anvilModule.$d.ClassicComponent as ComponentConstructor;
    ClassicComponent.tp$setattr(pyStr.$dict, new pyGetSetDescriptor(ClassicComponent, Sk.generic.getSetDict));
}

export function hasLegacyDict() {
    return window.anvilParams.runtimeVersion < 3 || legacyOptions.__dict__;
}
