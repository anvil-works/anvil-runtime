import type {
    ComponentYaml as RuntimeComponentYaml,
    DataBindingYaml as RuntimeDataBindingYaml,
    EventBindingYaml as RuntimeEventBindingYaml,
    FormContainerYaml as RuntimeFormContainerYaml,
    SlotDefYaml as RuntimeSlotDefYaml,
    SlotDefsYaml as RuntimeSlotDefsYaml,
    SlotTarget as RuntimeSlotTarget,
} from "../runner/data";

export type ComponentYaml = RuntimeComponentYaml;
export type EventBindingYaml = RuntimeEventBindingYaml;
export type DataBindingYaml = RuntimeDataBindingYaml;
export type FormContainerYaml = RuntimeFormContainerYaml;
export type SlotTarget = RuntimeSlotTarget;
export type SlotDefYaml = RuntimeSlotDefYaml;
export type SlotDefsYaml = RuntimeSlotDefsYaml;

export interface ParsedFormYaml {
    container: FormContainerYaml;
    components: ComponentYaml[];
    slots?: SlotDefsYaml;
    serialized_html?: string;
}

import { DefaultTreeAdapterMap } from "parse5";
export { serializeFormContainer, serializeFormLayout } from "./serializer";

export type Node = DefaultTreeAdapterMap["node"];
export type Element = DefaultTreeAdapterMap["element"];
export type TextNode = DefaultTreeAdapterMap["textNode"];
export type CommentNode = DefaultTreeAdapterMap["commentNode"];
