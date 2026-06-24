// An add-in to the `anvil` module that allows us to hook and control component construction
import {
    Args,
    Kws,
    Suspension,
    arrayFromIterable,
    chainOrSuspend,
    checkString,
    copyKeywordsToNamedArgs,
    isTrue,
    keywordArrayFromPyDict,
    objectRepr,
    pyCall,
    pyCallOrSuspend,
    pyDict,
    pyFalse,
    pyImportError,
    pyIterable,
    pyNone,
    pyNoneType,
    pyObject,
    pyRuntimeError,
    pyStr,
    pyTuple,
    pyValueError,
    toJs,
} from "../@Sk";
import { Component, ComponentConstructor, getDefaultDepAppIdForComponent } from "../components/Component";
import { PyInstantiatorFunction, isPyInstantiatorFunction } from "./component-property-utils-api";
import { ParsedFormSpec, parseCustomComponentSpec, parseFormPropertySpec } from "./component-specs";
import { PyModMap, anvilMod, funcFastCall } from "./py-util";

export type { ParsedFormSpec } from "./component-specs";

// There are two times when we turn a spec into a form constructor and need an app context for appLocalFormName values.
//
// If a FormTemplate is instantiating a customComponentSpec from YAML, the app context is the app that defines that YAML.
//
// If a RepeatingPanel instantiates the formPropertySpec in its item_template property, and that property belongs to
// a component created from YAML, the app context is the app whose YAML created that component. For example, if a
// dependency defines its own CustomRepeatingPanel, and we use that CustomRepeatingPanel from another app, item_template
// should be looked up in the app that used CustomRepeatingPanel, not the dependency that defined the class.
//
// To do this we have a magic reach-around-the-back mechanism in Component.ts which uses global state to set the
// default dependency app ID on the next Component to be instantiated. When we instantiate from YAML, we use this
// mechanism to set the YAML's dependency app ID as the default dependency app ID, in case that component wants to
// instantiate any form properties.
export interface YamlInstantiationContext {
    requestingComponent: Component;
    fromYaml: true;
    defaultDepAppId: string | null;
}

interface PropertyInstantiationContext {
    requestingComponent?: Component;
    fromYaml?: false;
}
export type InstantiationContext = YamlInstantiationContext | PropertyInstantiationContext;

export const getDefaultDepAppIdForInstantiation = (context: InstantiationContext) =>
    context.fromYaml ? context.defaultDepAppId : getDefaultDepAppIdForComponent(context.requestingComponent);

const throwIfUnresolvedDependencyInParsedFormSpec = (name: string, parsedFormSpec: ParsedFormSpec) => {
    if (parsedFormSpec.logicalDepId && !parsedFormSpec.depAppId) {
        throw new pyValueError(`Dependency not found for ${name}`);
    }
    if (!parsedFormSpec.packageName) {
        throw new pyValueError("Dependency not found for: " + name);
    }
};

export const maybeParseCustomComponentSpecForInstantiation = (
    customComponentSpec: string,
    defaultDepAppId: string | null
): ParsedFormSpec | null => {
    const parsedFormSpec = parseCustomComponentSpec(customComponentSpec, defaultDepAppId, {
        allowUnknownPackage: true,
    });
    if (parsedFormSpec) {
        throwIfUnresolvedDependencyInParsedFormSpec(customComponentSpec, parsedFormSpec);
    }
    return parsedFormSpec;
};

export const parseRequiredFormPropertySpec = (
    formPropertySpec: string,
    defaultDepAppId: string | null
): ParsedFormSpec => {
    const parsedFormSpec = parseFormPropertySpec(formPropertySpec, defaultDepAppId);
    if (!parsedFormSpec) {
        throw new Error(`Invalid YAML spec for form: ${formPropertySpec}`);
    }
    throwIfUnresolvedDependencyInParsedFormSpec(formPropertySpec, parsedFormSpec);
    return parsedFormSpec;
};

export const getFormClassObject = ({ packageQualifiedFormName, leafName }: ParsedFormSpec) => {
    return chainOrSuspend(Sk.importModule(packageQualifiedFormName, false, true), () => {
        const pyFormMod = Sk.sysmodules.quick$lookup(new pyStr(packageQualifiedFormName));
        if (pyFormMod) {
            return Sk.abstr.gattr(pyFormMod, new pyStr(leafName)) as ComponentConstructor;
        }
    });
};

export const WELL_KNOWN_PATHS = {
    LAYOUT: "__anvil layout *HV57",
};

interface InstantiationHooks {
    getAnvilComponentClass: (anvilModule: PyModMap, componentType: string) => ComponentConstructor | undefined;
    getAnvilComponentInstantiator: typeof getDefaultAnvilComponentInstantiator;
    getNamedFormInstantiator: typeof getDefaultNamedFormInstantiator;
}

export const setInstantiationHooks = (hooks: InstantiationHooks) => {
    ({ getAnvilComponentInstantiator, getAnvilComponentClass, getNamedFormInstantiator } = hooks);
};

export const getDefaultAnvilComponentInstantiator = (
    context: InstantiationContext,
    componentType: string
): ((kws?: Kws, pathStep?: string | number) => Suspension | Component) => {
    const pyComponentConstructor = anvilMod[componentType] as ComponentConstructor;
    return (kws, pathStep) => pyCallOrSuspend(pyComponentConstructor, [], kws);
};

export interface FormInstantiationFlags {
    asLayout?: true;
    preferLiveDesign?: boolean;
}

// Form instantiators carry the identity of the underlying form

export interface InstantiatorFunction {
    (kws?: Kws, pathStep?: number | string): Suspension | Component;
    anvil$parsedFormSpec: ParsedFormSpec | null;
}

export const getDefaultNamedFormInstantiator = (
    parsedFormSpec: ParsedFormSpec,
    requestingComponent?: Component,
    flags?: FormInstantiationFlags
): Suspension | InstantiatorFunction => {
    return chainOrSuspend(getFormClassObject(parsedFormSpec), (constructor) => {
        if (constructor === undefined) {
            throw new pyImportError("Failed to import form " + parsedFormSpec.appLocalFormName);
        }
        const ifn = (kwargs?: Kws, pathStep?: string | number) => pyCallOrSuspend(constructor, [], kwargs);
        ifn.anvil$parsedFormSpec = parsedFormSpec;
        return ifn;
    });
};

export let getAnvilComponentClass = (anvilModule: PyModMap, componentType: string) =>
    anvilModule[componentType] as ComponentConstructor | undefined;

export let getAnvilComponentInstantiator = getDefaultAnvilComponentInstantiator;

export let getNamedFormInstantiator = getDefaultNamedFormInstantiator;

export const getFormInstantiator = (
    context: InstantiationContext,
    formPropertyValue: pyStr | ComponentConstructor | PyInstantiatorFunction,
    flags?: FormInstantiationFlags
): Suspension | InstantiatorFunction => {
    if (checkString(formPropertyValue)) {
        const parsedFormSpec = parseRequiredFormPropertySpec(
            formPropertyValue.toString(),
            getDefaultDepAppIdForInstantiation(context)
        );
        return getNamedFormInstantiator(parsedFormSpec, context.requestingComponent, flags);
    } else if (isPyInstantiatorFunction(formPropertyValue)) {
        return formPropertyValue.anvil$underlyingInstantiator;
    } else {
        // formPropertyValue is a Python callable; wrap it
        const ifn = (kws?: Kws) => pyCallOrSuspend<Component>(formPropertyValue, [], kws);
        ifn.anvil$parsedFormSpec = null as any;
        return ifn;
    }
};

// Used from Python code
export const pyInstantiateComponent = funcFastCall((args_: Args, kws_?: Kws) => {
    let requestingComponent: Component,
        component: pyStr | ComponentConstructor,
        pyArgs: pyIterable<pyObject>,
        pyKws: pyDict,
        pyEditPath: pyNoneType | pyStr,
        isEditable: boolean;

    // eslint-disable-next-line prefer-const
    [requestingComponent, component, pyArgs, pyKws, pyEditPath, isEditable] = copyKeywordsToNamedArgs(
        "instantiate_component",
        ["requesting_component", "component_to_instantiate", "args", "kwargs", "edit_path", "is_editable"],
        args_,
        kws_,
        [new pyTuple(), new pyDict(), pyNone, pyFalse]
    );

    // This validates the types for pyArgs and pyKws
    // i.e. args should be a tuple/iterable, kws should be a mapping
    const args = arrayFromIterable(pyArgs);
    const kws = keywordArrayFromPyDict(pyCall(pyDict, [pyKws]));

    // TODO when do these get used?
    isEditable = isTrue(isEditable);
    const editPath = toJs(pyEditPath);

    // TODO should we type check requestingComponent?

    return chainOrSuspend(
        checkString(component)
            ? getFormClassObject(
                  parseRequiredFormPropertySpec(component.toString(), getDefaultDepAppIdForComponent(requestingComponent))
              )
            : component,
        (constructor) => {
            if (constructor === undefined) {
                // TODO improve this error or return MkInvalidComponent
                throw new pyRuntimeError("Unable to resolve " + objectRepr(component));
            }
            return pyCallOrSuspend(constructor, args, kws);
        }
    );
});
