import {
    buildNativeClass,
    checkString,
    keywordArrayToPyDict,
    pyCall,
    pyCallable,
    pyDict,
    pyList,
    pyNone,
    pyObject,
    pyProperty,
    pyStr,
    pyType,
    pyTypeError,
    pyValueError,
    toJs,
    typeName,
} from "@Sk";
import { PropertyType } from "@runtime/components/Component";
import { s_anvil_properties } from "./py-util";

interface AnvilProperty extends pyObject {
    descriptors: PropertyDescriptionDict;
    property: pyProperty;
    prop$get: pyObject;
    constructor: AnvilPropertyConstructor;
}

export interface AnvilPropertyConstructor extends pyType<AnvilProperty> {
    new (description?: PropertyDescriptionDict, property?: pyProperty): AnvilProperty;
}

const s_name = new pyStr("name");
const s_fset = new pyStr("fset");
const s_setter = new pyStr("setter");
const s_fget = new pyStr("fget");
const s_update = new pyStr("update");
const hasOwnProperty = Object.prototype.hasOwnProperty;

const validTypes: PropertyType[] = [
    "string",
    "number",
    "boolean",
    "text[]",
    "enum",
    "form",
    "object",
    "dict",
    "color",
    "icon",
    "themeRole",
    "uri",
    "html",
    "recordType",
    "margin",
    "padding",
    "spacing",
];

const isValidType = (v: any): v is PropertyType => validTypes.includes(v);

type PropertyDescriptionDict = pyDict<pyStr, pyObject>;

const update = pyDict.tp$getattr<pyCallable>(s_update);
const merge = (...dicts: PropertyDescriptionDict[]) => {
    const d = new pyDict() as PropertyDescriptionDict;
    for (const dict of dicts) {
        pyCall(update, [d, dict]);
    }
    return d;
};

/** merges properties with the same name */
const mergeNewProperty = (pyProperties: pyList<PropertyDescriptionDict>, pyProp: PropertyDescriptionDict) => {
    const newName = toJs(pyProp.quick$lookup(s_name));
    const pyPropArray = pyProperties.valueOf();
    for (let i = 0; i < pyPropArray.length; i++) {
        const prop = pyPropArray[i];
        const name = toJs(prop.quick$lookup(s_name));
        if (name !== newName) continue;
        pyPropArray.splice(i, 1, merge(prop, pyProp));
        return;
    }
    pyPropArray.push(pyProp);
};

export const anvil_property: AnvilPropertyConstructor = buildNativeClass("anvil.designer.anvil_property", {
    constructor: function (description?: PropertyDescriptionDict, property?: pyProperty) {
        this.descriptors = description ?? (new pyDict() as PropertyDescriptionDict);
        this.property = property ?? new pyProperty();
    },
    slots: {
        tp$new: Sk.generic.new,
        tp$init(args, kws = []) {
            const kwsHasType = kws?.includes("type");
            if (!args.length) {
                if (!kwsHasType) {
                    throw new pyTypeError("anvil_property() missing 1 required positional argument: 'type'");
                }
            } else if (args.length > 1) {
                throw new pyTypeError(`anvil_property takes at most 1 position arg, but ${args.length} were given`);
            } else {
                if (kwsHasType) {
                    throw new pyTypeError("got multiple arguments for type");
                }
                kws.push("type", args[0]);
            }
            const type = kws[kws.indexOf("type") + 1] as pyObject;
            if (!checkString(type)) {
                throw new pyTypeError(`Invalid property type, expected a string, got '${typeName(type)}'`);
            }
            if (!isValidType(type.toString())) {
                throw new pyValueError(`Invalid property type, got '${type}'`);
            }
            this.descriptors = keywordArrayToPyDict(kws);
        },
        tp$call(args, kws) {
            this.property = pyCall(pyProperty, args, kws);
            return this;
        },
        tp$descr_get(obj, type, canSuspend) {
            return this.property.tp$descr_get!(obj, type, !!canSuspend);
        },
        tp$descr_set(obj, value, canSuspend) {
            return this.property.tp$descr_set!(obj, value, !!canSuspend);
        },
    },
    methods: {
        setter: {
            $meth(fsetCallback) {
                const setter = this.property.tp$getattr<pyCallable>(s_setter);
                const property = pyCall(setter, [fsetCallback]) as pyProperty;
                this.property = property;
                return this;
            },
            $flags: { OneArg: true },
        },
        __set_name__: {
            $meth(owner, name) {
                this.descriptors.mp$ass_subscript(s_name, name);
                let anvil_properties;
                // equivalent to checking if _anvil_properties_ is in the cls.__dict__
                if (hasOwnProperty.call(owner.prototype, s_anvil_properties.toString())) {
                    anvil_properties = owner.tp$getattr(s_anvil_properties);
                } else {
                    // inherit a shallow copy of cls._anvil_properties_ since we haven't defined one ourselves
                    anvil_properties = pyCall(pyList, [owner.tp$getattr(s_anvil_properties) ?? new pyList()]);
                    owner.tp$setattr(s_anvil_properties, anvil_properties);
                }
                try {
                    mergeNewProperty(anvil_properties, this.descriptors);
                } catch {
                    // pass
                }
                return pyNone;
            },
            $flags: { MinArgs: 2, MaxArgs: 2 },
        },
    },
    getsets: {
        fget: {
            $get() {
                return this.property.tp$getattr(s_fget);
            },
        },
        fset: {
            $get() {
                return this.property.tp$getattr(s_fset);
            },
        },
    },
    flags: {
        sk$unacceptableBase: true,
    },
});
