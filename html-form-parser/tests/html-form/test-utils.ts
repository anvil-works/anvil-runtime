import { expect } from "@rstest/core";
import { setDefaultDropzoneNameGenerator, createDeterministicDropzoneNameGenerator } from "@anvil-works/form-template-parser";
import type { ComponentYaml, ParsedFormYaml } from "@anvil-works/form-template-parser";

// Set sequential dropzone name generator factory for deterministic test output
// Each context will get a fresh generator starting at 0
setDefaultDropzoneNameGenerator(() => createDeterministicDropzoneNameGenerator());

export function normalizeMultiline(value: string): string {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .join("\n")
        .trim();
}

export function normalizeDropzoneNames(value: string): string {
    return value.replace(/anvil-dropzone name="[^"]*"/g, 'anvil-dropzone name="<dropzone>"');
}

export function normalizedHtml(value: string): string {
    return normalizeDropzoneNames(normalizeMultiline(value));
}

export function normalizeComponent(component: ComponentYaml): ComponentYaml {
    const normalized: ComponentYaml = {
        ...component,
        properties: { ...(component.properties || {}) },
    };

    const html = normalized.properties?.html;
    if (typeof html === "string") {
        normalized.properties = {
            ...normalized.properties,
            html: normalizedHtml(html),
        };
    }

    if (normalized.layout_properties?.dropzone) {
        normalized.layout_properties = {
            ...normalized.layout_properties,
            dropzone: "<dropzone>",
        };
    }

    if (component.components) {
        normalized.components = component.components.map(normalizeComponent);
    }

    return normalized;
}

export function normalizeComponentTree(components: ComponentYaml[] | undefined): ComponentYaml[] {
    if (!components) return [];
    return components.map(normalizeComponent);
}

export function expectNormalizedComponents(actual: ComponentYaml[] | undefined, expected: ComponentYaml[]): void {
    expect(normalizeComponentTree(actual)).toEqual(normalizeComponentTree(expected));
}

export function expectSlot(parsed: ParsedFormYaml, slotName: string) {
    const slots = parsed.slots ?? {};
    const slot = slots[slotName];
    expect(slot).toBeDefined();
    const result = { ...slot! };
    if (slot?.set_layout_properties?.dropzone) {
        result.set_layout_properties = {
            ...slot.set_layout_properties,
            dropzone: "<dropzone>",
        };
    }
    return result;
}

export function normalizeComponentsBySlot(
    componentsBySlot: Record<string, ComponentYaml[]> | undefined
): Record<string, ComponentYaml[]> {
    const result: Record<string, ComponentYaml[]> = {};
    if (!componentsBySlot) {
        return result;
    }
    for (const [slot, components] of Object.entries(componentsBySlot)) {
        result[slot] = normalizeComponentTree(components);
    }
    return result;
}

export function stripDropzoneIdsFromComponents(
    componentsBySlot: Record<string, ComponentYaml[]> | undefined
): Record<string, ComponentYaml[]> {
    const result: Record<string, ComponentYaml[]> = {};
    if (!componentsBySlot) {
        return result;
    }

    const stripComponent = (component: ComponentYaml): ComponentYaml => {
        const copy: ComponentYaml = {
            ...component,
        };
        if (copy.layout_properties?.dropzone) {
            copy.layout_properties = {
                ...copy.layout_properties,
                dropzone: "<dropzone>",
            };
        }
        if (copy.components) {
            copy.components = copy.components.map(stripComponent);
        }
        return copy;
    };

    for (const [slot, components] of Object.entries(componentsBySlot)) {
        result[slot] = components.map(stripComponent);
    }
    return result;
}

export function normalizeSlots(slots: Record<string, any> | undefined) {
    if (!slots) return {};
    const normalized: Record<string, any> = {};
    for (const [name, slot] of Object.entries(slots)) {
        const copy = { ...slot };
        if (copy.set_layout_properties?.dropzone) {
            copy.set_layout_properties = {
                ...copy.set_layout_properties,
                dropzone: "<dropzone>",
            };
        }
        normalized[name] = copy;
    }
    return normalized;
}
