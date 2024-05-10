import { pyGetSetDescriptor, pyStr } from "@Sk";
import type { ComponentConstructor } from "@runtime/components/Component";
import { RuntimeOptions, type LegacyFeatures } from "./data";

const legacyOptions: LegacyFeatures = {
    class_names: false,
    bootstrap3: false,
    __dict__: false,
    root_container: false,
};

type LegacyOptions = typeof legacyOptions;
type LegacyOption = keyof LegacyOptions;

const isValidOption = (option: any): option is LegacyOption => option in legacyOptions;

let initLegacyOptions = false;

export function setLegacyOptions(runtimeOptions: RuntimeOptions) {
    if (initLegacyOptions) return;
    initLegacyOptions = true;
    const version = Number(runtimeOptions.version ?? 2);
    if (version < 3) {
        for (const option in legacyOptions) {
            legacyOptions[option as LegacyOption] = true;
        }
    } else {
        const options = runtimeOptions.legacy_features ?? {};
        for (const legacyOption of Object.keys(options)) {
            if (isValidOption(legacyOption)) {
                legacyOptions[legacyOption] = !!options[legacyOption];
            }
        }
    }
    setLegacyDict();
    setRootContainer();
}

let _prefix: string;

export function getCssPrefix() {
    if (_prefix != null) return _prefix;
    if (window.anvilParams.runtimeVersion < 3) return (_prefix = "");
    if (legacyOptions.class_names) return (_prefix = "");
    return (_prefix = "anvil-");
}

const INLINE_STYLES = {
    checkbox: "padding: 7px 7px 7px 20px;",
    radio: "padding: 7px 7px 7px 20px;",
} as const;

export function getInlineStyles(key: keyof typeof INLINE_STYLES) {
    if (window.anvilParams.runtimeVersion >= 3) return "";
    return INLINE_STYLES[key];
}

function setRootContainer() {
    if (!legacyOptions.root_container) return;
    const root = document.getElementById("appGoesHere");
    if (!root) return;
    if (root.parentElement !== document.body) return;
    const newRoot = document.createElement("div");
    newRoot.className = "anvil-root-container";
    root.replaceWith(newRoot);
    newRoot.append(root);
}

function setLegacyDict() {
    if (!legacyOptions.__dict__) return;
    const anvilModule = Sk.sysmodules.quick$lookup(new pyStr("anvil"));
    if (!anvilModule) return;
    const ClassicComponent = anvilModule.$d.ClassicComponent as ComponentConstructor;
    ClassicComponent.prototype.__dict__ = new pyGetSetDescriptor(ClassicComponent, Sk.generic.getSetDict);
}

export function hasLegacyDict() {
    return window.anvilParams.runtimeVersion < 3 || legacyOptions.__dict__;
}
