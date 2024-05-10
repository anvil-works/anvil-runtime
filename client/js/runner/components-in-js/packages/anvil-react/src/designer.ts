import { hooks } from "./core";

export { inDesigner, registerToolboxSection, DropZone } from "./core";

export const {
    useDesignerApi,
    useInlineEditRef,
    useInteraction,
    useSectionRef,
    useSectionRefs,
    useInlineEditSectionRef,
    useInlineEditRegionRef,
    useDesignerInteractionRef,
    useDropping,
    useRegionInteractionRef,
} = hooks;

export type { DropZoneSpec, AnvilReactDesignerApi, DropZoneProps } from "./core";
