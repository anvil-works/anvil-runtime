import {
    chainOrSuspend,
    checkString, pyBool,
    pyCallable,
    pyFalse, pyNotImplemented,
    pyNotImplementedType,
    pyObject,
    pyStr,
    pyType,
    pyValueError,
    setUpModuleMethods,
    toJs,
    toPy
} from "@Sk";
import {
    Component,
    ComponentConstructor,
    MarginPropertyValue,
    SpacingLength,
    SpacingPropertyValue
} from "@runtime/components/Component";
import {getFormInstantiator, InstantiatorFunction} from "@runtime/runner/instantiation";


export const pyPropertyUtilsApi = {
    __name__: new pyStr("property_utils"),
};

export interface PyInstantiatorFunction extends pyCallable {
    anvil$underlyingInstantiator: InstantiatorFunction;
}

interface PyInstantiatorFunctionConstructor extends pyType<PyInstantiatorFunction> {
    new (ifn: InstantiatorFunction): PyInstantiatorFunction;
}
const PyInstantiatorFunction: PyInstantiatorFunctionConstructor = Sk.abstr.buildNativeClass("anvil.InstantiatorFunction", {
    constructor: function PyInstantiatorFunction(ifn) {
        this.anvil$underlyingInstantiator = ifn;
    },
    slots: {
        tp$call(args, kwargs) {
            if (args.length > 1 || args[0] && !checkString(args[0]) && !Sk.builtin.checkNumber(args[0])) {
                throw new pyValueError("Instantiator functions take one positional argument, which must be a string or number");
            }
            return this.anvil$underlyingInstantiator(kwargs, args[0] ? toJs(args[0]) as string|number : undefined);
        },
        tp$richcompare(other: pyObject, op: "Gt" | "GtE" | "Lt" | "LtE" | "Eq" | "NotEq"): pyNotImplementedType | pyBool | pyObject | boolean {
            if (op === "Eq") {
                const mySpec = this.anvil$underlyingInstantiator.anvil$instantiatorForForm;
                const otherSpec = other instanceof PyInstantiatorFunction && other.anvil$underlyingInstantiator.anvil$instantiatorForForm;
                return mySpec && otherSpec && mySpec.depId === otherSpec.depId && mySpec.formName === otherSpec.formName;
            } else {
                return pyNotImplemented;
            }
        }
    }
});

const getSpacingValueStyleString = (value: SpacingLength) =>
    typeof(value) === "string" ? value :
        typeof(value) === "number" ? `${value}px` :
            "inherit";


const getAnySpacingStyleString = (value: MarginPropertyValue | null) =>
    typeof(value) === "number" || typeof(value) === "string" ? getSpacingValueStyleString(value) :
        value?.length ? value.map(getSpacingValueStyleString).join(" ") :
            null;

const getAnySpacingCssString = (name: string, value: MarginPropertyValue | null) => {
    const styleString = getAnySpacingStyleString(value);
    return styleString ? `${name}:${styleString};` : "";
};

setUpModuleMethods("property_utils", pyPropertyUtilsApi, {
    get_form_constructor: {
        $meth: (parentForm: Component, formProperty: pyStr | ComponentConstructor | PyInstantiatorFunction) =>
            formProperty?.anvil$underlyingInstantiator ? // It's already an instantiator? Passthrough!
                formProperty :
                chainOrSuspend(getFormInstantiator({requestingComponent: parentForm}, formProperty as pyStr | ComponentConstructor),
                    instantiate => new PyInstantiatorFunction(instantiate)),
        $flags: { NamedArgs: ["parent_form", "property_value"] }
    },
    get_margin_style_string: {
        $meth(v: pyObject) {
            return toPy(getAnySpacingStyleString(toJs(v) as MarginPropertyValue));
        },
        $flags: { OneArg: true }
    },
    get_margin_css_string: {
        $meth(v: pyObject) {
            return toPy(getAnySpacingCssString("margin", toJs(v) as MarginPropertyValue | null));
        },
        $flags: { OneArg: true }
    },
    get_padding_css_string: {
        $meth(v: pyObject) {
            return toPy(getAnySpacingCssString("padding", toJs(v) as MarginPropertyValue | null));
        },
        $flags: { OneArg: true }
    },
    get_spacing_css_string: {
        $meth(v: pyObject) {
            const {margin=null, padding=null} = toJs(v) as SpacingPropertyValue ?? {};
            return toPy(getAnySpacingCssString("margin", margin) + getAnySpacingCssString("padding", padding));
        },
        $flags: { OneArg: true }
    },
    get_spacing_style_strings: {
        $meth(v: pyObject) {
            const {margin=null, padding=null} = toJs(v) as SpacingPropertyValue ?? {};
            return toPy([getAnySpacingStyleString(margin), getAnySpacingStyleString(padding)]);
        },
        $flags: { OneArg: true }
    },
});

