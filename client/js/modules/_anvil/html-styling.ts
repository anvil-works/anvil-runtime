import {
    buildNativeClass,
    checkNumber,
    copyKeywordsToNamedArgs,
    isTrue,
    pyCall,
    pyAsNum,
    pyDict,
    pyNone,
    pyObject,
    pyStr,
    pyTrue,
    pyFalse,
    pyTuple,
    pyNewableType,
    pyTypeError,
    toJs,
} from "@Sk";
import type { Args, Kws } from "@Sk";
import { ACTIVE_CARRIER_ATTRS } from "@runtime/runner/designer-dom-attributes";
import { pyIteratorFromIterable } from "@runtime/runner/py-util/iter-utils";

export interface ClassesConstructor extends pyNewableType<Classes> {
    new (value?: pyObject | HTMLElement | null, onChange?: () => void): Classes;
}

export interface Classes extends pyObject {
    _classNames: string[];
    _element: HTMLElement | null;
    _onChange?: () => void;
    $getCurrentClasses(this: Classes): string[];
    $setCurrentClasses(this: Classes, tokens: string[]): void;
    $clear(this: Classes): void;
    $replace(this: Classes, value?: pyObject): void;
    $update(this: Classes, updates: pyDict<pyObject, pyObject>): void;
    $tokens(this: Classes): string[];
    $setTokens(this: Classes, tokens: string[]): void;
    $setElement(this: Classes, element: HTMLElement | null, hydrate?: boolean): void;
    $add(this: Classes, value: pyObject): void;
    $remove(this: Classes, value: pyObject): void;
    $has(this: Classes, value: pyObject): boolean;
}

export interface StyleConstructor extends pyNewableType<Style> {
    new (value?: pyObject | HTMLElement | null, onChange?: () => void): Style;
}

export interface Style extends pyObject {
    _element: HTMLElement | null;
    _onChange?: () => void;
    $getCurrentStyles(this: Style): Map<string, string>;
    $setCurrentStyles(this: Style, entries: Map<string, string>): void;
    $clear(this: Style): void;
    $replace(this: Style, value?: pyObject): void;
    $update(this: Style, updates: pyDict<pyObject, pyObject>): void;
    $entries(this: Style): Map<string, string>;
    $setEntries(this: Style, entries: Map<string, string>): void;
    $setElement(this: Style, element: HTMLElement | null, hydrate?: boolean): void;
    $set(this: Style, property: pyObject, value: pyObject): void;
    $delete(this: Style, property: pyObject): void;
    $get(this: Style, property: pyObject): string;
}

export interface AttrsConstructor extends pyNewableType<Attrs> {
    new (value?: pyObject | HTMLElement | null): Attrs;
}

export interface Attrs extends pyObject {
    _element: HTMLElement | null;
    $getCurrentAttrs(this: Attrs): Map<string, string>;
    $setCurrentAttrs(this: Attrs, entries: Map<string, string>): void;
    $clear(this: Attrs): void;
    $replace(this: Attrs, value?: pyObject): void;
    $update(this: Attrs, updates: pyDict<pyObject, pyObject>): void;
    $entries(this: Attrs): Map<string, string>;
    $setEntries(this: Attrs, entries: Map<string, string>): void;
    $setElement(this: Attrs, element: HTMLElement | null, hydrate?: boolean): void;
    $set(this: Attrs, name: pyObject, value: pyObject): void;
    $delete(this: Attrs, name: pyObject): void;
    $get(this: Attrs, name: pyObject): pyObject;
    $has(this: Attrs, name: pyObject): boolean;
}

const ACTIVE_CARRIER_ATTR_VALUES = new Set<string>(Object.values(ACTIVE_CARRIER_ATTRS));

const isHTMLElement = (value: unknown): value is HTMLElement =>
    typeof HTMLElement !== "undefined" && value instanceof HTMLElement;

const normalizeClassTokensFromString = (value: string): string[] =>
    value
        .trim()
        .split(/\s+/)
        .filter((className) => className.length > 0);

const dedupeClassTokens = (tokens: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const token of tokens) {
        if (seen.has(token)) {
            continue;
        }
        seen.add(token);
        result.push(token);
    }
    return result;
};

const classTokensFromPyObject = (value: pyObject | undefined): string[] => {
    if (!value || value === pyNone) {
        return [];
    }
    if (value instanceof Classes) {
        return value.$tokens();
    }
    const jsValue = toJs(value);
    if (jsValue === null || jsValue === undefined) {
        return [];
    }
    if (typeof jsValue === "string") {
        return normalizeClassTokensFromString(jsValue);
    }
    if (Array.isArray(jsValue)) {
        return jsValue.flatMap((item) => normalizeClassTokensFromString(String(item)));
    }
    if (typeof jsValue === "object") {
        const result: string[] = [];
        for (const [className, enabled] of Object.entries(jsValue)) {
            const tokens = normalizeClassTokensFromString(className);
            if (enabled) {
                result.push(...tokens);
            } else {
                for (const token of tokens) {
                    const index = result.indexOf(token);
                    if (index !== -1) {
                        result.splice(index, 1);
                    }
                }
            }
        }
        return result;
    }
    return normalizeClassTokensFromString(String(jsValue));
};

export const cssPropertyName = (key: string): string => {
    if (key.startsWith("--")) {
        return key;
    }
    return key.replace(/_/g, "-").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
};

const getStylePropertyName = (key: pyObject): string => cssPropertyName(key.toString().trim());
const getAttrName = (key: pyObject): string => key.toString().trim();

const isExcludedManagedAttr = (name: string): boolean => {
    // HTML attribute names are case-insensitive, including the reserved names.
    name = name.toLowerCase();
    if (name === "class" || name === "style") {
        return true;
    }
    if (name.startsWith("anvil:")) {
        return true;
    }
    if (name.startsWith("data-anvil-")) {
        return true;
    }
    if (ACTIVE_CARRIER_ATTR_VALUES.has(name)) {
        return true;
    }
    return false;
};

const assertManagedAttr = (name: string): void => {
    if (isExcludedManagedAttr(name)) {
        throw new pyTypeError(`Attribute '${name}' is managed elsewhere`);
    }
};

const BASE_UNITLESS_CSS_PROPERTIES = [
    "animation-iteration-count",
    "aspect-ratio",
    "border-image-outset",
    "border-image-slice",
    "border-image-width",
    "box-flex",
    "box-flex-group",
    "box-ordinal-group",
    "column-count",
    "columns",
    "flex",
    "flex-grow",
    "flex-positive",
    "flex-shrink",
    "flex-negative",
    "flex-order",
    "grid-area",
    "grid-row",
    "grid-row-end",
    "grid-row-span",
    "grid-row-start",
    "grid-column",
    "grid-column-end",
    "grid-column-span",
    "grid-column-start",
    "font-weight",
    "line-clamp",
    "line-height",
    "opacity",
    "order",
    "orphans",
    "scale",
    "tab-size",
    "widows",
    "z-index",
    "zoom",
    "fill-opacity",
    "flood-opacity",
    "stop-opacity",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-width",
];

const UNITLESS_CSS_PROPERTIES = new Set<string>([
    ...BASE_UNITLESS_CSS_PROPERTIES,
    ...BASE_UNITLESS_CSS_PROPERTIES.flatMap((property) =>
        ["-webkit-", "-moz-", "-ms-", "-o-"].map((prefix) => `${prefix}${property}`)
    ),
]);

export const isUnitlessCssProperty = (property: string): boolean => {
    const normalized = cssPropertyName(property);
    return normalized.startsWith("--") || UNITLESS_CSS_PROPERTIES.has(normalized);
};

export const parseStyleString = (style: string): Map<string, string> => {
    const result = new Map<string, string>();
    for (const declaration of style.split(";")) {
        const trimmed = declaration.trim();
        if (!trimmed) {
            continue;
        }
        const colonIndex = trimmed.indexOf(":");
        if (colonIndex < 0) {
            continue;
        }
        const property = trimmed.slice(0, colonIndex).trim();
        const cssValue = trimmed.slice(colonIndex + 1).trim();
        if (property && cssValue) {
            result.set(cssPropertyName(property), cssValue);
        }
    }
    return result;
};

const styleValueToString = (value: unknown, property: string): string => {
    if (Array.isArray(value)) {
        return value.map((item) => styleValueToString(item, property)).join(" ");
    }
    if (typeof value === "number" || typeof value === "bigint") {
        return isUnitlessCssProperty(property) ? String(value) : `${value}px`;
    }
    return String(value);
};

const pyStyleValueToString = (value: pyObject, property: string): string => {
    if (checkNumber(value)) {
        const numberValue = pyAsNum(value);
        return isUnitlessCssProperty(property) ? String(numberValue) : `${numberValue}px`;
    }
    return styleValueToString(toJs(value), property);
};

const styleEntriesFromPyObject = (value: pyObject | undefined): Map<string, string> => {
    if (!value || value === pyNone) {
        return new Map();
    }
    if (value instanceof Style) {
        return new Map(value.$entries());
    }
    const jsValue = toJs(value);
    if (jsValue === null || jsValue === undefined) {
        return new Map();
    }
    if (typeof jsValue === "string") {
        return parseStyleString(jsValue);
    }
    if (typeof jsValue === "object" && !Array.isArray(jsValue)) {
        const result = new Map<string, string>();
        for (const [property, cssValue] of Object.entries(jsValue)) {
            if (cssValue === null || cssValue === undefined) {
                continue;
            }
            const propertyName = cssPropertyName(property);
            const valueString = styleValueToString(cssValue, propertyName);
            if (valueString.length === 0) {
                continue;
            }
            result.set(propertyName, valueString);
        }
        return result;
    }
    return parseStyleString(String(jsValue));
};

const styleStringFromPyObject = (value: pyObject | undefined): string | null => {
    if (!value || value === pyNone || value instanceof Style) {
        return null;
    }
    const jsValue = toJs(value);
    return typeof jsValue === "string" ? jsValue : null;
};

const updateDictFromArgs = (args: Args, kws?: Kws): pyDict<pyObject, pyObject> => pyCall(pyDict, args, kws);

const attrDictFromValue = (value: pyObject): pyDict<pyObject, pyObject> => {
    try {
        return pyCall(pyDict, [value]);
    } catch {
        throw new pyTypeError("Attrs value must be a dictionary of attribute names to values");
    }
};

const attrUpdateDictFromArgs = (args: Args, kws?: Kws): pyDict<pyObject, pyObject> => {
    try {
        return updateDictFromArgs(args, kws);
    } catch {
        throw new pyTypeError("Attrs.update() expects a dictionary and/or keyword arguments");
    }
};

const attrsElement = (self: Attrs): HTMLElement => self._element ?? (self._element = createStyleElement());

const attrsFromElement = (element: HTMLElement): Map<string, string> => {
    const result = new Map<string, string>();
    for (const attr of element.attributes) {
        if (isExcludedManagedAttr(attr.name)) {
            continue;
        }
        result.set(attr.name, attr.value);
    }
    return result;
};

function* managedDomAttrEntries(element: HTMLElement): Generator<[string, string]> {
    for (const attr of element.attributes) {
        if (isExcludedManagedAttr(attr.name)) {
            continue;
        }
        yield [attr.name, attr.value];
    }
}

const managedAttrEntriesIterable = (self: Attrs): Iterable<[string, string]> => ({
    [Symbol.iterator]() {
        return managedDomAttrEntries(attrsElement(self));
    },
});

const managedAttrKeysIterable = (self: Attrs): Iterable<string> => ({
    [Symbol.iterator]() {
        return (function* () {
            for (const [name] of managedDomAttrEntries(attrsElement(self))) {
                yield name;
            }
        })();
    },
});

const managedAttrValuesIterable = (self: Attrs): Iterable<string> => ({
    [Symbol.iterator]() {
        return (function* () {
            for (const [, value] of managedDomAttrEntries(attrsElement(self))) {
                yield value;
            }
        })();
    },
});

const pyStrIteratorFromIterable = <T extends string>(iterable: Iterable<T>) =>
    pyIteratorFromIterable(iterable, (value) => new pyStr(value));

const pyStringPairIteratorFromIterable = (iterable: Iterable<[string, string]>) =>
    pyIteratorFromIterable(iterable, ([name, attrValue]) => new pyTuple([new pyStr(name), new pyStr(attrValue)]));

const attrValueToString = (value: unknown): string | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return String(value);
};

const pyAttrValueToString = (value: pyObject): string | null => {
    if (value === pyNone) {
        return null;
    }
    if (value === pyTrue || value === pyFalse) {
        return value === pyTrue ? "true" : "false";
    }
    if (checkNumber(value)) {
        return String(pyAsNum(value));
    }
    return attrValueToString(toJs(value));
};

const attrsEntriesFromPyDict = (updates: pyDict<pyObject, pyObject>): Map<string, string> => {
    const result = new Map<string, string>();
    for (const [name, attrValue] of updates.$items()) {
        const attrName = getAttrName(name);
        if (!attrName) {
            throw new pyTypeError("Attribute name must not be empty");
        }
        assertManagedAttr(attrName);
        const valueString = pyAttrValueToString(attrValue);
        if (valueString === null) {
            continue;
        }
        result.set(attrName, valueString);
    }
    return result;
};

const attrsEntriesFromPyObject = (value: pyObject | undefined): Map<string, string> => {
    if (!value || value === pyNone) {
        return new Map();
    }
    if (value instanceof Attrs) {
        return new Map(value.$entries());
    }
    return attrsEntriesFromPyDict(attrDictFromValue(value));
};

const notifyObserver = (self: Classes | Style) => {
    self._onChange?.();
};

const renderStyleEntries = (entries: Map<string, string>): string =>
    [...entries.entries()].map(([property, cssValue]) => `${property}: ${cssValue}`).join("; ");

const escapeHtmlAttrValue = (value: string): string =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const renderAttrEntries = (entries: Map<string, string>): string =>
    [...entries.entries()]
        .map(([name, attrValue]) => (attrValue.length === 0 ? name : `${name}="${escapeHtmlAttrValue(attrValue)}"`))
        .join(" ");

const renderAttrRepr = (entries: Map<string, string>): string =>
    [...entries.entries()]
        .map(([name, attrValue]) => (attrValue.length === 0 ? name : `${name}=${attrValue}`))
        .join(" ");

const createStyleElement = (): HTMLElement => document.createElement("div");

export const Classes: ClassesConstructor = buildNativeClass("anvil.Classes", {
    constructor: function Classes(value?: pyObject | HTMLElement | null, onChange?: () => void) {
        this._classNames = [];
        this._element = null;
        this._onChange = onChange;
        if (isHTMLElement(value)) {
            this.$setElement(value, true);
        } else {
            this.$replace(value ?? pyNone);
        }
    },
    slots: {
        tp$new(args, kws) {
            const [value] = copyKeywordsToNamedArgs("Classes", ["value"], args, kws, [pyNone]);
            return new Classes(value);
        },
        tp$str() {
            return new pyStr(this.$getCurrentClasses().join(" "));
        },
        $r() {
            return new pyStr(`Classes(${this.$getCurrentClasses().join(" ")})`);
        },
        tp$iter() {
            return pyStrIteratorFromIterable(this._element?.classList ?? this._classNames);
        },
        tp$as_sequence_or_mapping: true,
        sq$length() {
            return this.$getCurrentClasses().length;
        },
        sq$contains(value) {
            return this.$has(value);
        },
        mp$subscript(key) {
            return this.$has(key) ? pyTrue : pyFalse;
        },
        mp$ass_subscript(key, value) {
            if (value === undefined || !isTrue(value)) {
                this.$remove(key);
            } else {
                this.$add(key);
            }
        },
    },
    proto: {
        $getCurrentClasses() {
            return this._element ? Array.from(this._element.classList) : this._classNames.slice();
        },
        $setCurrentClasses(tokens) {
            const deduped = dedupeClassTokens(tokens);
            if (this._element) {
                // SVG elements have no className setter.
                this._element.setAttribute("class", deduped.join(" "));
            } else {
                this._classNames = deduped;
            }
        },
        $clear() {
            this.$setCurrentClasses([]);
            notifyObserver(this);
        },
        $replace(value) {
            this.$setTokens(classTokensFromPyObject(value));
            notifyObserver(this);
        },
        $update(updates) {
            for (const [className, enabled] of updates.$items()) {
                this.mp$ass_subscript(className, enabled);
            }
        },
        $tokens() {
            return this.$getCurrentClasses();
        },
        $setTokens(tokens) {
            this.$setCurrentClasses(tokens);
        },
        $setElement(element, hydrate = false) {
            const tokens = hydrate || this._element ? null : this.$getCurrentClasses();
            this._element = element;
            if (!hydrate && element && tokens) {
                this.$setTokens(tokens);
            }
        },
        $add(value) {
            const next = this.$getCurrentClasses();
            for (const token of classTokensFromPyObject(value)) {
                if (!next.includes(token)) {
                    next.push(token);
                }
            }
            this.$setCurrentClasses(next);
            notifyObserver(this);
        },
        $remove(value) {
            const remove = new Set(classTokensFromPyObject(value));
            this.$setCurrentClasses(this.$getCurrentClasses().filter((className) => !remove.has(className)));
            notifyObserver(this);
        },
        $has(value) {
            const tokens = classTokensFromPyObject(value);
            const current = this.$getCurrentClasses();
            return tokens.length > 0 && tokens.every((className) => current.includes(className));
        },
    },
    methods: {
        add: {
            $meth(args) {
                for (const arg of args) {
                    this.$add(arg);
                }
                return pyNone;
            },
            $flags: { FastCall: true },
        },
        remove: {
            $meth(args) {
                for (const arg of args) {
                    this.$remove(arg);
                }
                return pyNone;
            },
            $flags: { FastCall: true },
        },
        update: {
            $meth(args, kws) {
                this.$update(updateDictFromArgs(args, kws));
                return pyNone;
            },
            $flags: { FastCall: true },
        },
        clear: {
            $meth() {
                this.$clear();
                return pyNone;
            },
            $flags: { NoArgs: true },
        },
        __del__: {
            $meth(args) {
                for (const arg of args) {
                    this.$remove(arg);
                }
                return pyNone;
            },
            $flags: { FastCall: true },
        },
    },
});

export const Style: StyleConstructor = buildNativeClass("anvil.Style", {
    constructor: function Style(value?: pyObject | HTMLElement | null, onChange?: () => void) {
        this._element = createStyleElement();
        this._onChange = onChange;
        if (isHTMLElement(value)) {
            this.$setElement(value, true);
        } else {
            this.$replace(value ?? pyNone);
        }
    },
    slots: {
        tp$new(args, kws) {
            const [value] = copyKeywordsToNamedArgs("Style", ["value"], args, kws, [pyNone]);
            return new Style(value);
        },
        tp$str() {
            return new pyStr(renderStyleEntries(this.$getCurrentStyles()));
        },
        $r() {
            return new pyStr(`Style(${this.toString()})`);
        },
        tp$iter() {
            return pyStrIteratorFromIterable(this.$getCurrentStyles().keys());
        },
        tp$as_sequence_or_mapping: true,
        sq$length() {
            return this.$getCurrentStyles().size;
        },
        sq$contains(property) {
            const propertyName = getStylePropertyName(property);
            if (this._element) {
                return this._element.style.getPropertyValue(propertyName).length > 0;
            }
            return this.$getCurrentStyles().has(propertyName);
        },
        mp$subscript(property) {
            return new pyStr(this.$get(property));
        },
        mp$ass_subscript(property, value) {
            if (value === undefined) {
                this.$delete(property);
            } else {
                this.$set(property, value);
            }
        },
    },
    proto: {
        $getCurrentStyles() {
            return parseStyleString(this._element?.style.cssText ?? "");
        },
        $setCurrentStyles(entries) {
            const next = new Map(entries);
            const element = this._element ?? (this._element = createStyleElement());
            element.style.cssText = "";
            for (const [property, cssValue] of next) {
                element.style.setProperty(property, cssValue);
            }
        },
        $clear() {
            this.$setCurrentStyles(new Map());
            notifyObserver(this);
        },
        $replace(value) {
            const cssText = styleStringFromPyObject(value);
            if (cssText !== null) {
                (this._element ?? (this._element = createStyleElement())).style.cssText = cssText;
                notifyObserver(this);
                return;
            }
            this.$setEntries(styleEntriesFromPyObject(value));
            notifyObserver(this);
        },
        $update(updates) {
            for (const [property, cssValue] of updates.$items()) {
                if (cssValue === pyNone) {
                    this.$delete(property);
                } else {
                    this.mp$ass_subscript(property, cssValue);
                }
            }
        },
        $entries() {
            return this.$getCurrentStyles();
        },
        $setEntries(entries) {
            this.$setCurrentStyles(entries);
        },
        $setElement(element, hydrate = false) {
            const entries = hydrate ? null : this.$getCurrentStyles();
            this._element = element ?? createStyleElement();
            if (!hydrate && entries) {
                this.$setEntries(entries);
            }
        },
        $set(property, value) {
            const propertyName = getStylePropertyName(property);
            if (!propertyName) {
                throw new pyTypeError("Style property name must not be empty");
            }
            const valueString = pyStyleValueToString(value, propertyName);
            const element = this._element ?? (this._element = createStyleElement());
            if (valueString.length === 0) {
                element.style.removeProperty(propertyName);
            } else {
                element.style.setProperty(propertyName, valueString);
            }
            notifyObserver(this);
        },
        $delete(property) {
            const propertyName = getStylePropertyName(property);
            this._element?.style.removeProperty(propertyName);
            notifyObserver(this);
        },
        $get(property) {
            const propertyName = getStylePropertyName(property);
            return this._element?.style.getPropertyValue(propertyName) ?? "";
        },
    },
    methods: {
        keys: {
            $meth() {
                return pyStrIteratorFromIterable(this.$getCurrentStyles().keys());
            },
            $flags: { NoArgs: true },
        },
        values: {
            $meth() {
                return pyStrIteratorFromIterable(this.$getCurrentStyles().values());
            },
            $flags: { NoArgs: true },
        },
        items: {
            $meth() {
                return pyStringPairIteratorFromIterable(this.$getCurrentStyles().entries());
            },
            $flags: { NoArgs: true },
        },
        get: {
            $meth(property, defaultValue) {
                const value = this.$get(property);
                return value.length > 0 ? new pyStr(value) : defaultValue;
            },
            $flags: { NamedArgs: ["property", "default"], Defaults: [new pyStr("")] },
        },
        update: {
            $meth(args, kws) {
                this.$update(updateDictFromArgs(args, kws));
                return pyNone;
            },
            $flags: { FastCall: true },
        },
        clear: {
            $meth() {
                this.$clear();
                return pyNone;
            },
            $flags: { NoArgs: true },
        },
    },
});

export const Attrs: AttrsConstructor = buildNativeClass("anvil.Attrs", {
    constructor: function Attrs(value?: pyObject | HTMLElement | null) {
        this._element = createStyleElement();
        if (isHTMLElement(value)) {
            this.$setElement(value, true);
        } else {
            this.$replace(value ?? pyNone);
        }
    },
    slots: {
        tp$new(args, kws) {
            const [value] = copyKeywordsToNamedArgs("Attrs", ["value"], args, kws, [pyNone]);
            return new Attrs(value);
        },
        tp$str() {
            return new pyStr(renderAttrEntries(this.$getCurrentAttrs()));
        },
        $r() {
            return new pyStr(`Attrs(${renderAttrRepr(this.$getCurrentAttrs())})`);
        },
        tp$iter() {
            return pyStrIteratorFromIterable(managedAttrKeysIterable(this));
        },
        tp$as_sequence_or_mapping: true,
        sq$length() {
            return this.$getCurrentAttrs().size;
        },
        sq$contains(name) {
            return this.$has(name);
        },
        mp$subscript(name) {
            return this.$get(name);
        },
        mp$ass_subscript(name, value) {
            if (value === undefined) {
                this.$delete(name);
            } else {
                this.$set(name, value);
            }
        },
    },
    proto: {
        $getCurrentAttrs(this: Attrs) {
            return attrsFromElement(attrsElement(this));
        },
        $setCurrentAttrs(this: Attrs, entries: Map<string, string>) {
            const next = new Map(entries);
            const element = attrsElement(this);
            const toRemove: string[] = [];
            for (const attr of element.attributes) {
                if (!isExcludedManagedAttr(attr.name)) {
                    toRemove.push(attr.name);
                }
            }
            for (const name of toRemove) {
                element.removeAttribute(name);
            }
            for (const [name, attrValue] of next) {
                element.setAttribute(name, attrValue);
            }
        },
        $clear(this: Attrs) {
            this.$setCurrentAttrs(new Map());
        },
        $replace(this: Attrs, value?: pyObject) {
            this.$setEntries(attrsEntriesFromPyObject(value));
        },
        $update(this: Attrs, updates: pyDict<pyObject, pyObject>) {
            for (const [name, attrValue] of updates.$items()) {
                this.mp$ass_subscript(name, attrValue);
            }
        },
        $entries(this: Attrs) {
            return this.$getCurrentAttrs();
        },
        $setEntries(this: Attrs, entries: Map<string, string>) {
            this.$setCurrentAttrs(entries);
        },
        $setElement(this: Attrs, element: HTMLElement | null, hydrate = false) {
            const entries = hydrate ? null : this.$getCurrentAttrs();
            this._element = element ?? createStyleElement();
            if (!hydrate && entries) {
                this.$setEntries(entries);
            }
        },
        $set(this: Attrs, name: pyObject, value: pyObject) {
            const attrName = getAttrName(name);
            if (!attrName) {
                throw new pyTypeError("Attribute name must not be empty");
            }
            assertManagedAttr(attrName);
            const valueString = pyAttrValueToString(value);
            const element = attrsElement(this);
            if (valueString === null) {
                element.removeAttribute(attrName);
            } else {
                element.setAttribute(attrName, valueString);
            }
        },
        $delete(this: Attrs, name: pyObject) {
            const attrName = getAttrName(name);
            if (!attrName) {
                throw new pyTypeError("Attribute name must not be empty");
            }
            assertManagedAttr(attrName);
            attrsElement(this).removeAttribute(attrName);
        },
        $get(this: Attrs, name: pyObject) {
            const attrName = getAttrName(name);
            if (!attrName) {
                throw new pyTypeError("Attribute name must not be empty");
            }
            assertManagedAttr(attrName);
            const element = attrsElement(this);
            if (!element.hasAttribute(attrName)) {
                return pyNone;
            }
            return new pyStr(element.getAttribute(attrName) ?? "");
        },
        $has(this: Attrs, name: pyObject) {
            const attrName = getAttrName(name);
            if (!attrName) {
                throw new pyTypeError("Attribute name must not be empty");
            }
            assertManagedAttr(attrName);
            return attrsElement(this).hasAttribute(attrName);
        },
    },
    methods: {
        keys: {
            $meth() {
                return pyStrIteratorFromIterable(managedAttrKeysIterable(this));
            },
            $flags: { NoArgs: true },
        },
        values: {
            $meth() {
                return pyStrIteratorFromIterable(managedAttrValuesIterable(this));
            },
            $flags: { NoArgs: true },
        },
        items: {
            $meth() {
                return pyStringPairIteratorFromIterable(managedAttrEntriesIterable(this));
            },
            $flags: { NoArgs: true },
        },
        update: {
            $meth(args, kws) {
                this.$update(attrUpdateDictFromArgs(args, kws));
                return pyNone;
            },
            $flags: { FastCall: true },
        },
        clear: {
            $meth() {
                this.$clear();
                return pyNone;
            },
            $flags: { NoArgs: true },
        },
    },
});

/*!defMethod(,[value=None])!2*/ ("Create a live class-list helper. `value` may be `None`, a string, a list of strings, a dictionary of class names to booleans, or another `Classes` object."); ["__init__"];
/*!defMethod(_,value)!2*/ ("Add one or more class names. Strings are split on whitespace; duplicate classes are ignored."); ["add"];
/*!defMethod(_,value)!2*/ ("Remove one or more class names. Missing classes are ignored."); ["remove"];
/*!defMethod(_,updates=None,**kwargs)!2*/ ("Merge class names into this class-list helper. Truthy values add classes; falsey values remove them."); ["update"];
/*!defMethod(None,)!2*/ ("Remove all class names."); ["clear"];
/*!defClass(anvil,Classes)!*/

/*!defMethod(,[value=None])!2*/ ("Create a live style helper. `value` may be `None`, a CSS string, a dictionary of CSS property names to values, or another `Style` object."); ["__init__"];
/*!defMethod(iterator[string],)!2*/ ("Return an iterator over the CSS property names in this style object."); ["keys"];
/*!defMethod(iterator[string],)!2*/ ("Return an iterator over the CSS property values in this style object."); ["values"];
/*!defMethod(iterator,)!2*/ ("Return an iterator over `(property, value)` pairs for this style object."); ["items"];
/*!defMethod(_,property,[default=""])!2*/ ("Return a CSS property value, or `default` when it is not set."); ["get"];
/*!defMethod(_,updates=None,**kwargs)!2*/ ("Merge CSS properties into this style object. `None` or empty values remove properties."); ["update"];
/*!defMethod(None,)!2*/ ("Remove all CSS properties."); ["clear"];
/*!defClass(anvil,Style)!*/

/*!defMethod(,[value=None])!2*/ ("Create a live HTML attribute helper. `value` may be `None`, a dictionary of attribute names to values, or another `Attrs` object."); ["__init__"];
/*!defMethod(iterator[string],)!2*/ ("Return an iterator over the attribute names in this attrs object."); ["keys"];
/*!defMethod(iterator[string],)!2*/ ("Return an iterator over the attribute values in this attrs object."); ["values"];
/*!defMethod(iterator,)!2*/ ("Return an iterator over `(name, value)` pairs for this attrs object."); ["items"];
/*!defMethod(_,updates=None,**kwargs)!2*/ ("Merge attribute names and values into this attrs object. `None` values remove attributes."); ["update"];
/*!defMethod(None,)!2*/ ("Remove all managed HTML attributes."); ["clear"];
/*!defClass(anvil,Attrs)!*/
