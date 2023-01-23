// An add-in to the `anvil` module that allows us to hook and control component construction

import * as PyDefUtils from "../PyDefUtils";
import {
    pyValueError,
    Kws,
    pyObject,
    chainOrSuspend,
    checkString,
    pyStr,
    pyCallOrSuspend,
    Args,
    copyKeywordsToNamedArgs,
    pyTuple,
    pyDict,
    pyNone,
    pyFalse,
    pyCall,
    keywordArrayFromPyDict,
    pyIterable,
    pyNoneType,
    isTrue,
    toJs,
    pyRuntimeError,
    objectRepr,
    arrayFromIterable,
    toPy,
} from "../@Sk";
import { data } from "./data";
import { getDefaultDepId } from "../components/Component";
import type { Component, ComponentConstructor } from "../components/Component";
import * as py from "./py-util";
import { PyModMap } from "./py-util";

export const objectToKwargs = (obj?: object) => {
    const kwargs: Kws = [];
    for (const [k, v] of Object.entries(obj || {})) {
        kwargs.push(k, toPy(v));
    }
    return kwargs;
};

export const objectToPyMap = (obj?: object) =>
    Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, toPy(v)]));

export const kwargsToPyMap = (kws?: Kws) => {
    const obj: { [key: string]: pyObject } = {};
    if (kws === undefined) return obj;
    for (let i = 0; i < kws.length; i += 2) {
        obj[kws[i] as string] = kws[i + 1] as pyObject;
    }
    return obj;
};

export const kwargsToJsObject = (kws?: Kws) => {
    const obj: any = {};
    if (kws === undefined) { return obj; }
    for (let i = 0; i < kws.length; i += 2) {
        obj[kws[i] as string] = toJs(kws[i + 1] as pyObject);
    }
    return obj;
};

export const pyMapToKwargs = (obj: { [name: string]: pyObject }) => {
    const kwargs: Kws = [];
    for (const [k, v] of Object.entries(obj)) {
        kwargs.push(k, v);
    }
    return kwargs;
};

const COMPONENT_MATHER = /^(?:([^:]+):)?([^:]*)$/;
const ComponentMatcher = (nameSpec: string) => nameSpec.match(COMPONENT_MATHER);

export const yamlSpecToQualifiedFormName = (yamlSpec: string, defaultDepId?: string | null) => {
    const [, depId, className] = ComponentMatcher(yamlSpec) || [];
    const appPackage = depId
        ? data.dependencyPackages[depId]
        : defaultDepId
            ? data.dependencyPackages[defaultDepId]
            : data.appPackage;
    // console.log("Resolving", appPackage, "for dep", depId, "/", defaultDepId, "from", data.dependencyPackages, "with", data.appPackage);
    if (!appPackage) {
        throw new pyValueError("Dependency not found for: " + yamlSpec);
    }
    return `${appPackage}.${className}`;
}

export const resolveStringComponent = (name: string, defaultDepId?: string | null) => {
    const qualifiedFormName = yamlSpecToQualifiedFormName(name, defaultDepId);
    return chainOrSuspend(Sk.importModule(qualifiedFormName, false, true), () => {
        const dots = qualifiedFormName.split(".").slice(1);
        const className = dots[dots.length - 1];

        const pyFormMod = Sk.sysmodules.quick$lookup(new pyStr(qualifiedFormName));
        if (pyFormMod) {
            return pyFormMod.tp$getattr(new pyStr(className)) as ComponentConstructor;
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

export const getDefaultAnvilComponentInstantiator = (requestingComponent: Component | null, componentType: string) => {
    const pyComponent = py.getValue("anvil", componentType);
    return (kwargs?: Kws, pathStep?: string | number) => pyCallOrSuspend(pyComponent, [], kwargs);
};

export interface FormInstantiationFlags {
    asLayout?: true;
}

export const getDefaultNamedFormInstantiator = (requestingComponent: Component | null, formName: string, flags?: FormInstantiationFlags) => {
    return chainOrSuspend(resolveStringComponent(formName, getDefaultDepId(requestingComponent)), (constructor) => {
        if (constructor === undefined) {
            // TODO - throw a proper Error here or return mkInvalidComponent
            throw new Error("Unable to Instantiate form " + formName);
        }
        return (kwargs?: Kws, pathStep?: string | number) => pyCallOrSuspend(constructor, [], kwargs);
    });
};

export let getAnvilComponentClass = (anvilModule: PyModMap, componentType: string) => anvilModule[componentType] as ComponentConstructor | undefined;

export let getAnvilComponentInstantiator = getDefaultAnvilComponentInstantiator;

export let getNamedFormInstantiator = getDefaultNamedFormInstantiator;

export const getFormInstantiator = (requestingComponent: Component, formSpec: pyStr | ComponentConstructor) =>
    checkString(formSpec)
        ? getNamedFormInstantiator(requestingComponent, formSpec.toString())
        : (kws?: Kws, pathStep?: number | string) => pyCallOrSuspend(formSpec, [], kws);

// Used in YAML instantiation: Decode YAML spec and shortcut anvil.* components
// TODO - Yaml properties may be empty - inject default properties when instantiating from Yaml
export const instantiateComponentFromYamlSpec = (
    requestingComponent: Component | null,
    yamlSpec: string,
    properties: { [prop: string]: any },
    name?: string
) =>
    yamlSpec.startsWith("form:")
        ? chainOrSuspend(getNamedFormInstantiator(requestingComponent, yamlSpec.substring(5)), (instantiate) =>
              instantiate(objectToKwargs(properties), name)
          )
        : getAnvilComponentInstantiator(requestingComponent, yamlSpec)(objectToKwargs(properties), name);

// Used from Python code
export const pyInstantiateComponent = PyDefUtils.funcFastCall((args_: Args, kws_?: Kws) => {
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
            ? resolveStringComponent(component.toString(), getDefaultDepId(requestingComponent))
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
