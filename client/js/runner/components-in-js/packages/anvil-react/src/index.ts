import { hooks } from "./core";

export { registerReactComponent, openForm, propertyUtils, includeContext, useClientConfig } from "./core";
export const { useActions, useComponentState, useVisibility, useMethodHandler } = hooks;

export type {
    ReactComponentDefinition,
    ComponentProps,
    SectionSpec,
    AnvilReactActions,
    ChildWithLayoutProperties,
    SectionRefs,
} from "./core";

export type {
    EventDescription,
    Interaction,
    LayoutProperties,
    PropertyDescription,
    RegionInteraction,
    ToolboxSection,
} from "@runtime/components/Component";
