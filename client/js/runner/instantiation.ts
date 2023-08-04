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
    pyCallable,
} from "../@Sk";
import { data } from "./data";
import {
    getDefaultDepIdForComponent,
    setDefaultDepIdForNextComponent,
    setYamlStackForNextComponent
} from "../components/Component";
import type { Component, ComponentConstructor } from "../components/Component";
import * as py from "./py-util";
import { PyModMap, objectToKwargs } from "./py-util";
import {YamlCreationStack} from "@runtime/runner/component-creation";

// There are two times when we might want to turn the name of a form into a constructor, at which point
// we need to disambiguate which app/dependency we should look in when we get a bare string like "Form1".
//
// If a FormTemplate is instantiating a component from a YAML description, it's simple - we should always be relative
// to the app that defines that form.
//
// If we're instantiating a component from a form property (eg a RepeatingPanel instantiating its item_template
// property), and it's a property on a component created from YAML, it should be relative to the YAML that created
// that component. For example, if a dependency defines its own CustomRepeatingPanel, and we use the
// CustomRepeatingPanel from another app, the item_template property should be looked up relative to the app whose
// YAML created the CustomRepeatingPanel, not the dependency that defined the CustomRepeatingPanel class.
//
// To do this we have a magic reach-around-the-back mechanism in Component.ts which uses global state to set the
// default dep ID on the next Component to be instantiated. When we instantiate from YAML, we use this mechanism
// to set the YAML's dep ID as the default dep ID, in case that component wants to instantiate any form properties.
interface YamlInstantiationContext {
    requestingComponent: Component;
    fromYaml: true;
    defaultDepId: string | null;
}

interface PropertyInstantiationContext {
    requestingComponent?: Component;
    fromYaml?: false;
}
export type InstantiationContext = YamlInstantiationContext | PropertyInstantiationContext;

export const getDefaultDepIdForInstantiation = (context: InstantiationContext) =>
    context.fromYaml ? context.defaultDepId : getDefaultDepIdForComponent(context.requestingComponent);

const COMPONENT_MATHER = /^(?:([^:]+):)?([^:]*)$/;
const ComponentMatcher = (nameSpec: string) => nameSpec.match(COMPONENT_MATHER);

export const yamlSpecToQualifiedFormName = (yamlSpec: string, defaultDepId?: string | null) => {
    const [, logicalDepId, className] = ComponentMatcher(yamlSpec) || [];
    const depId = logicalDepId ? data.logicalDepIds[logicalDepId] : null;
    const appPackage = logicalDepId
        ? depId && data.dependencyPackages[depId]
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

export const getDefaultAnvilComponentInstantiator = (context: InstantiationContext, componentType: string) => {
    const pyComponent = py.getValue("anvil", componentType);
    return (kwargs?: Kws, pathStep?: string | number) => pyCallOrSuspend(pyComponent, [], kwargs);
};

export interface FormInstantiationFlags {
    asLayout?: true;
}

export const getDefaultNamedFormInstantiator = (context: InstantiationContext, formName: string, flags?: FormInstantiationFlags) => {
    return chainOrSuspend(resolveStringComponent(formName, getDefaultDepIdForInstantiation(context)), (constructor) => {
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

export const getFormInstantiator = (context: InstantiationContext, formSpec: pyStr | ComponentConstructor | pyCallable & {anvil$isFormInstantiator: true}) =>
    checkString(formSpec)
        ? getNamedFormInstantiator(context, formSpec.toString())
        : (kws?: Kws, pathStep?: number | string) => pyCallOrSuspend(formSpec, formSpec?.anvil$isFormInstantiator && pathStep !== undefined ? [toPy(pathStep)] : [], kws);

// Used in YAML instantiation: Decode YAML spec and shortcut anvil.* components
// TODO - Yaml properties may be empty - inject default properties when instantiating from Yaml
export const instantiateComponentFromYamlSpec = (
    context: YamlInstantiationContext,
    yamlSpec: string,
    properties: { [prop: string]: any },
    yamlStack: YamlCreationStack,
    name?: string
) => {
    if (yamlSpec.startsWith("form:")) {
        return chainOrSuspend(getNamedFormInstantiator(context, yamlSpec.substring(5)), (instantiate) => {
            // Tell this component it was created by YAML from this app, so if it has any form
            // properties it knows how to look them up
            setDefaultDepIdForNextComponent(context.defaultDepId);
            setYamlStackForNextComponent(yamlStack); // todo consider: should the yamlStack become part of the YamlInstantiationContext?
            return instantiate(objectToKwargs(properties), name)
        });
    } else {
        const instantiate = getAnvilComponentInstantiator(context, yamlSpec);
        setDefaultDepIdForNextComponent(context.defaultDepId);
        return instantiate(objectToKwargs(properties), name);
    }
}

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
            ? resolveStringComponent(component.toString(), getDefaultDepIdForComponent(requestingComponent))
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
