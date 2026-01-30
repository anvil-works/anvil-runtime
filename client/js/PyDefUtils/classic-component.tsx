import {
    buildPyClass,
    chainOrSuspend,
    Kws,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyList,
    pyNewableType,
    pyObject,
    pyStr,
    Suspension
} from "@Sk";
import {
    ClassicComponent,
    ClassicComponentConstructor,
    ClassicPropertyDescription,
    ClassicPropertyDescriptionMinaml,
} from "@runtime/components/ClassicComponent";
import { ComponentConstructor, EventDescription } from "@runtime/components/Component";
import { hasLegacyDict } from "@runtime/runner/legacy-features";
import { funcFastCall, PyModMap } from "@runtime/runner/py-util";
// Import createElement directly instead of using JSX to avoid dependency on window.PyDefUtils
import { createElement } from "./dom-helpers";

const getInheritedEventsTypes = (events?: EventDescription[], baseEvents?: { [event: string]: EventDescription }) => {
    if (!events) return;
    baseEvents ??= {};
    const eventTypes = { ...baseEvents };
    events.forEach((event) => {
        eventTypes[event.name] = event;
    });
    return eventTypes;
};

interface ClassicComponentParams<T extends ClassicComponent = ClassicComponent> {
    base?: ComponentConstructor | ComponentConstructor[];
    properties?: ClassicPropertyDescription<T>[];
    events?: EventDescription[];
    layouts?: ClassicPropertyDescription<T>[];
    element?: (props: Record<string, any>) => JSX.Element;
    locals?: (locals: Locals) => void;
    kwargs?: Kws;
    slots?: boolean;
}

export interface ClassicInitOptions {
    properties?: ClassicPropertyDescriptionMinaml[];
    events?: EventDescription[];
    layouts?: ClassicPropertyDescriptionMinaml[];
    element?: (props: Record<string, any>) => JSX.Element;
}

interface Locals {
    [key: string]: pyObject;
}

const PROPERTY_DESCRIPTOR_KEYS = [
    "options",
    "multiline",
    "important",
    "priority",
    "hidden",
    "deprecated",
    "deprecateFromRuntimeVersion",
    "pyVal",
    "allowBindingWriteback",
    "supportsWriteback",
    "showInDesignerWhen",
    "inlineEditElement",
    "designerHint",
    "iconsets",
    "allowCustomValue",
    "accept",
    "deprecateFromRuntimeV3",
] as const;

/** Should only be used for classic components */
export function mkComponentCls<T extends ClassicComponent>(
    anvilModule: PyModMap,
    name: string,
    params: ClassicComponentParams<T>
): pyNewableType<T> {
    let { base, properties, events, layouts, element, locals, kwargs, slots = true } = params;

    // used by ClassicComponent __init_subclass__
    kwargs ??= [];
    // @ts-expect-error - pyObject is not a valid type for this property
    kwargs.push("_anvil_classic", { properties, events, element, layouts });

    let bases: ComponentConstructor[];
    base ??= anvilModule["ClassicComponent"] as ClassicComponentConstructor;
    if (Array.isArray(base)) {
        bases = base;
    } else {
        bases = [base];
    }

    events ??= [];
    properties ??= [];
    locals ??= () => {};

    const ComponentCls = buildPyClass<T>(
        anvilModule,
        ($gbl, $loc) => {
            // prevents __dict__ on ClassicComponent subclasses like Button
            // since these are not native classes but equivalent to user created classes
            if (slots && !hasLegacyDict()) {
                $loc.__slots__ = new pyList();
            }
            locals($loc);
            mkGettersSetters($loc, properties, anvilModule);
        },
        name,
        bases,
        undefined,
        kwargs
    );

    return ComponentCls;
}

export function mkNew<T extends pyObject>(
    superClass: ClassicComponentConstructor,
    callback: (self: T) => pyObject | Suspension | void
) {
    const superNew = Sk.abstr.typeLookup(superClass, pyStr.$new) as pyCallable<T | Suspension>;

    return funcFastCall(function __new__(args, kwargs) {
        let self = pyCallOrSuspend(superNew, args, kwargs);
        return chainOrSuspend(
            self,
            (s) => {
                self = s;
                return callback ? callback(self) : null;
            },
            () => self
        );
    });
}

export function mkGettersSetters<T extends ClassicComponent>(
    $loc: { [key: string]: pyObject },
    properties: ClassicPropertyDescription<T>[],
    anvilModule: PyModMap
) {
    (properties || []).forEach((prop) => {
        $loc[prop.name] = pyCall(anvilModule["ComponentProperty"], [new pyStr(prop.name)]);
    });
}

/** Called by ClassicComponent.__init_subclass__ */
export function initClassicComponentClassPrototype(cls: ClassicComponentConstructor, options: ClassicInitOptions = {}) {
    const { properties = [], events, element: Element, layouts: layoutProperties } = options;

    const clsProto = cls.prototype;

    const inheritedDefaults = clsProto._anvilClassic$propDefaults || {};
    const inheritedPropMap = clsProto._anvilClassic$propMap || {};
    const inheritedPropTypes = clsProto._anvilClassic$propTypes || [];
    const inheritedEvents = clsProto._anvilClassic$eventTypes || {};
    const inheritedLayouts = clsProto._anvilClassic$layoutProps || [];
    let propToBind = clsProto._anvilClassic$dataBindingProps;

    const propMap: { [key: string]: ClassicPropertyDescription } = {};
    // create a copy
    // some design elements directly manipulate the prototype propMap
    // and we use the properties to override the prop map.
    Object.entries(inheritedPropMap).forEach(([name, entry]) => {
        propMap[name] = { ...entry };
    });
    const propTypes = [...inheritedPropTypes];

    properties.forEach((entry) => {
        const { name, type, description, group, dataBindingProp } = entry;
        propMap[name] = { ...entry };
        const propType = { name, type, description, group } as ClassicPropertyDescriptionMinaml;
        for (const prop of PROPERTY_DESCRIPTOR_KEYS) {
            const propKey = prop as keyof ClassicPropertyDescriptionMinaml;
            if (entry[propKey]) {
                propType[propKey] = entry[propKey];
            }
        }
        const i = propTypes.findIndex((item) => item.name === name);
        if (i === -1) {
            propTypes.push(propType);
        } else {
            propTypes[i] = propType;
        }
        if (dataBindingProp) {
            propToBind = name;
        }
    });

    const propsToInit = Object.keys(propMap).filter((key) => propMap[key].initialize);

    const eventTypes = getInheritedEventsTypes(events, inheritedEvents);
    let layoutPropTypes;
    if (layoutProperties) {
        layoutPropTypes = [...inheritedLayouts];
        layoutPropTypes.push(...layoutProperties);
    }

    const propDefaults = Object.assign(
        {},
        inheritedDefaults,
        Object.fromEntries(properties.filter((prop) => !prop.readOnly).map((prop) => [prop.name, prop.defaultValue]))
    );

    Object.defineProperties(clsProto, {
        _anvilClassic$propDefaults: {
            value: propDefaults,
            writable: true,
        },
        _anvilClassic$propMap: {
            value: propMap,
            writable: true,
        },
        _anvilClassic$propTypes: {
            value: propTypes,
            writable: true,
        },
        _anvilClassic$propsToInitialize: {
            value: propsToInit,
            writable: true,
        },
    });
    if (eventTypes) {
        Object.defineProperty(clsProto, "_anvilClassic$eventTypes", {
            value: eventTypes,
            writable: true,
        });
    }
    if (Element) {
        Object.defineProperty(clsProto, "_anvilClassic$createElement", {
            // Use createElement directly instead of JSX to avoid dependency on window.PyDefUtils
            value: (props: Record<string, any>) => createElement(Element, props),
            writable: true,
        });
    }
    if (layoutProperties) {
        Object.defineProperty(clsProto, "_anvilClassic$layoutProps", {
            value: layoutPropTypes,
            writable: true,
        });
    }
    if (propToBind) {
        Object.defineProperty(clsProto, "_anvilClassic$dataBindingProps", {
            value: propToBind,
            writable: true,
        });
    }
}
