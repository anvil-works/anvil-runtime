import {
    chainOrSuspend,
    checkString,
    isTrue,
    pyBool,
    pyCallable,
    pyNone,
    pyNotImplemented,
    pyNotImplementedType,
    pyObject,
    pyStr,
    pyTrue,
    pyType,
    pyValueError,
    setUpModuleMethods,
    toJs,
    toPy,
} from "@Sk";
import {
    Component,
    ComponentConstructor,
    MarginPropertyValue,
    PaddingPropertyValue,
    SpacingLength,
    SpacingPropertyValue,
} from "@runtime/components/Component";
import { InstantiatorFunction, getFormInstantiator } from "@runtime/runner/instantiation";
import { anvil_property } from "./anvil-property";
import { setElementVisibility } from "./components-in-js/public-api/property-utils";

export const pyPropertyUtilsApi = {
    __name__: new pyStr("property_utils"),
    anvil_property,
};

export interface PyInstantiatorFunction extends pyCallable {
    anvil$underlyingInstantiator: InstantiatorFunction;
}

interface PyInstantiatorFunctionConstructor extends pyType<PyInstantiatorFunction> {
    new (ifn: InstantiatorFunction): PyInstantiatorFunction;
}
const PyInstantiatorFunction: PyInstantiatorFunctionConstructor = Sk.abstr.buildNativeClass(
    "anvil.InstantiatorFunction",
    {
        constructor: function PyInstantiatorFunction(ifn) {
            this.anvil$underlyingInstantiator = ifn;
        },
        slots: {
            tp$call(args, kwargs) {
                if (args.length > 1 || (args[0] && !checkString(args[0]) && !Sk.builtin.checkNumber(args[0]))) {
                    throw new pyValueError(
                        "Instantiator functions take one positional argument, which must be a string or number"
                    );
                }
                return this.anvil$underlyingInstantiator(
                    kwargs,
                    args[0] ? (toJs(args[0]) as string | number) : undefined
                );
            },
            tp$richcompare(
                other: pyObject,
                op: "Gt" | "GtE" | "Lt" | "LtE" | "Eq" | "NotEq"
            ): pyNotImplementedType | pyBool | pyObject | boolean {
                if (op === "Eq") {
                    const mySpec = this.anvil$underlyingInstantiator.anvil$instantiatorForForm;
                    const otherSpec =
                        other instanceof PyInstantiatorFunction &&
                        other.anvil$underlyingInstantiator.anvil$instantiatorForForm;
                    return (
                        mySpec &&
                        otherSpec &&
                        mySpec.depId === otherSpec.depId &&
                        mySpec.formName === otherSpec.formName
                    );
                } else {
                    return pyNotImplemented;
                }
            },
        },
    }
);

const getSpacingValueStyleString = (value: SpacingLength) =>
    typeof value === "number" || (typeof value === "string" && `${parseFloat(value)}` === value)
        ? `${value}px`
        : typeof value === "string"
        ? value
        : ""; // set to empty string - i.e. don't set this value

export const getSpacingObject = (value: MarginPropertyValue, keyPrefix: string) => {
    const [top, right, bottom, left] =
        typeof value === "number" || typeof value === "string"
            ? [value, value, value, value]
            : !value
            ? [null, null, null, null]
            : value.length === 2
            ? [value[0], value[1], value[0], value[1]]
            : value.length === 3
            ? [value[0], value[1], value[2], value[1]]
            : [value[0], value[1], value[2], value[3]]; // Guarantee that its length is 4.

    return {
        [`${keyPrefix}Top`]: getSpacingValueStyleString(top),
        [`${keyPrefix}Right`]: getSpacingValueStyleString(right),
        [`${keyPrefix}Bottom`]: getSpacingValueStyleString(bottom),
        [`${keyPrefix}Left`]: getSpacingValueStyleString(left),
    };
};

setUpModuleMethods("property_utils", pyPropertyUtilsApi, {
    get_form_constructor: {
        $meth: (
            parentForm: Component,
            formProperty: pyStr | ComponentConstructor | PyInstantiatorFunction,
            preferLiveDesign: pyBool
        ) =>
            formProperty?.anvil$underlyingInstantiator // It's already an instantiator? Passthrough!
                ? formProperty
                : chainOrSuspend(
                      getFormInstantiator(
                          { requestingComponent: parentForm },
                          formProperty as pyStr | ComponentConstructor,
                          { preferLiveDesign: isTrue(preferLiveDesign) }
                      ),
                      (instantiate) => new PyInstantiatorFunction(instantiate)
                  ),
        $flags: { NamedArgs: ["parent_form", "property_value", "prefer_live_design"], Defaults: [pyTrue] },
    },
    get_margin_styles: {
        $meth(v: pyObject) {
            return toPy(getSpacingObject(toJs(v) as MarginPropertyValue, "margin"));
        },
        $flags: { NamedArgs: ["margin"] },
    },
    get_padding_styles: {
        $meth(v: pyObject) {
            return toPy(getSpacingObject(toJs(v) as MarginPropertyValue, "padding"));
        },
        $flags: { NamedArgs: ["padding"] },
    },
    get_spacing_styles: {
        $meth(v: pyObject) {
            const jsVal = toJs(v) as SpacingPropertyValue;
            return toPy({
                ...getSpacingObject(jsVal.margin as MarginPropertyValue, "margin"),
                ...getSpacingObject(jsVal.padding as PaddingPropertyValue, "padding"),
            });
        },
        $flags: { NamedArgs: ["spacing"] },
    },
    set_element_margin: {
        $meth(e: pyObject, v: pyObject) {
            const element = toJs(e) as HTMLElement;
            Object.assign(element.style, getSpacingObject(toJs(v) as MarginPropertyValue, "margin"));
            return pyNone;
        },
        $flags: { NamedArgs: ["element", "margin"] },
    },
    set_element_padding: {
        $meth(e: pyObject, v: pyObject) {
            const element = toJs(e) as HTMLElement;
            Object.assign(element.style, getSpacingObject(toJs(v) as PaddingPropertyValue, "padding"));
            return pyNone;
        },
        $flags: { NamedArgs: ["element", "padding"] },
    },
    set_element_spacing: {
        $meth(e: pyObject, v: pyObject) {
            const element = toJs(e) as HTMLElement;
            const jsVal = toJs(v) as SpacingPropertyValue;
            Object.assign(
                element.style,
                getSpacingObject(jsVal?.margin as MarginPropertyValue, "margin"),
                getSpacingObject(jsVal?.padding as MarginPropertyValue, "padding")
            );
            return pyNone;
        },
        $flags: { NamedArgs: ["element", "spacing"] },
    },
    set_element_visibility: {
        $meth(e: pyObject, v: pyObject) {
            const element = toJs(e) as HTMLElement;
            setElementVisibility(element, isTrue(v));
            return pyNone;
        },
        $flags: { NamedArgs: ["element", "visible"] },
    },
});
