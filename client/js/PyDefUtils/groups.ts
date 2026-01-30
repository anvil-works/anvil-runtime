import { propertyGroups, PropertyGroup } from "./property-groups";
import { eventGroups, EventGroup } from "./event-groups";
import {
    ClassicComponent,
    ClassicEventDescription,
    ClassicPropertyDescription,
} from "@runtime/components/ClassicComponent";

const component_regex = /\{\{component\}\}/g;

type PropertyOverrides<T extends ClassicComponent> = Record<
    string,
    Partial<ClassicPropertyDescription<T> & { omit: boolean }>
>;
type EventOverrides = Record<string, Partial<ClassicEventDescription & { omit: boolean }>>;

// Shared helper: replace component placeholder in description
function replaceComponentPlaceholder(description: string | undefined, componentName: string): string | undefined {
    return description ? description.replace(component_regex, componentName) : description;
}

// Shared helper: process overrides that weren't seen in groups
function addUnseenOverrides<T extends { name: string }>(
    props: T[],
    seenProps: Record<string, boolean>,
    overrides: Record<string, Partial<T & { omit: boolean }>>
) {
    Object.keys(overrides).forEach((propName) => {
        if (!seenProps[propName]) {
            const override = overrides[propName];
            override.name = propName;
            props.push(override as unknown as T);
        }
    });
}

// Internal function for assembling property groups (nested object structure)
function assembleGroupPropertiesInternal<T extends ClassicComponent>(
    groups: PropertyGroup,
    componentName: string,
    groupList: string[],
    overrides?: PropertyOverrides<T>
): ClassicPropertyDescription<T>[] {
    overrides ??= {};
    const props: ClassicPropertyDescription<T>[] = [];
    const seenProps: Record<string, boolean> = {};

    groupList.forEach((groupName) => {
        const groupProps = groups[groupName];
        if (!groupProps) return;

        for (let propName in groupProps) {
            const baseProp = groupProps[propName];
            baseProp.group ??= groupName; // Allow properties defined in one group (above) to actually appear in another group
            const override = overrides[baseProp.name] || {};
            // Property groups work with any ClassicComponent, so we can safely cast to T
            const prop: ClassicPropertyDescription<T> = {
                ...baseProp,
                ...override,
            } as unknown as ClassicPropertyDescription<T>;
            prop.description = replaceComponentPlaceholder(prop.description, componentName);
            if (!override.omit) {
                props.push(prop);
            }
            seenProps[prop.name] = true;
        }
    });

    addUnseenOverrides(props, seenProps, overrides);
    return props;
}

// Internal function for assembling event groups (array structure)
function assembleGroupEventsInternal(
    groups: EventGroup,
    componentName: string,
    groupList: string[],
    overrides?: EventOverrides
): ClassicEventDescription[] {
    overrides ??= {};
    const props: ClassicEventDescription[] = [];
    const seenProps: Record<string, boolean> = {};

    groupList.forEach((groupName) => {
        const groupProps = groups[groupName];
        if (!groupProps) return;

        groupProps.forEach((prop) => {
            const override = overrides[prop.name] || {};

            prop = { ...prop, ...override } as ClassicEventDescription;
            prop.description = replaceComponentPlaceholder(prop.description, componentName);
            if (!override.omit) {
                props.push(prop);
            }
            seenProps[prop.name] = true;
        });
    });

    addUnseenOverrides(props, seenProps, overrides);
    return props;
}

// Public exported functions
export function assembleGroupEvents(componentName: string, groupList: string[], overrides?: EventOverrides) {
    return assembleGroupEventsInternal(eventGroups, componentName, groupList, overrides);
}

export function assembleGroupProperties<T extends ClassicComponent>(
    groupList: string[],
    overrides?: PropertyOverrides<T>
) {
    return assembleGroupPropertiesInternal<T>(propertyGroups, "component", groupList, overrides);
}
