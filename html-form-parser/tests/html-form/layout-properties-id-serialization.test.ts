import { describe, it, expect } from "@rstest/core";
import { parseContainerForm, serializeFormContainer } from "@anvil-works/form-template-parser";
import { normalizeMultiline } from "./test-utils";

describe("layout_properties id serialization", () => {
    it("skips id in layout_properties for component inside HtmlComponent", () => {
        // Component inside a fragment should not serialize the "id" layout property
        const html = `<div>
    <div anvil:name="fragment_1">
        <anvil-component type="Button" name="button_1" prop:text="Click"></anvil-component>
    </div>
</div>`;

        const parsed = parseContainerForm(html);
        const serialized = serializeFormContainer(parsed);

        // The dropzone should NOT appear in the serialized HTML for components inside fragments
        // The button should be serialized into the fragment without container:dropzone
        expect(serialized).not.toContain('container:dropzone="');
        // Extract the fragment HTML from the serialized output to check
        const fragment = parsed.components.find((c) => c.name === "fragment_1");
        expect(fragment).toBeDefined();
        expect(fragment?.components).toHaveLength(1);
        expect(fragment?.components?.[0]?.layout_properties?.dropzone).toBeDefined();
        expect(fragment?.components?.[0]?.layout_properties?.dropzone).toBe("$dz_0");
        expect(serialized).toContain(
            '<anvil-component type="Button" name="button_1" prop:text="Click"></anvil-component>'
        );
    });

    it("serializes dropzone in layout_properties for component inside anvil-component", () => {
        // Component inside an anvil-component (not a fragment) should serialize the "dropzone" layout property
        const html = `<anvil-component type="ColumnPanel" name="panel_1">
    <anvil-component type="Button" name="button_1" prop:text="Click" container:dropzone="dz-content-area"></anvil-component>
</anvil-component>`;

        const parsed = parseContainerForm(html);
        // The component inside the panel should have a dropzone in layout_properties
        expect(parsed.components[0]?.components?.[0]?.layout_properties?.dropzone).toBe("dz-content-area");

        const serialized = serializeFormContainer(parsed);
        // The dropzone SHOULD appear in the serialized HTML for components inside anvil-components
        expect(serialized).toContain('container:dropzone="dz-content-area"');
    });

    it("skips dropzone in layout_properties for slot inside HtmlComponent", () => {
        // Slot inside a fragment should not serialize the "dropzone" layout property
        const html = `<div>
    <div anvil:name="fragment_1">
        <anvil-slot name="slot_1"></anvil-slot>
    </div>
</div>`;

        const parsed = parseContainerForm(html);
        // The slot should exist
        expect(parsed.slots?.slot_1).toBeDefined();
        // The slot should have a dropzone in layout_properties
        expect(parsed.slots?.slot_1?.set_layout_properties?.dropzone).toBeDefined();

        const serialized = serializeFormContainer(parsed);
        // Extract the fragment HTML from the serialized output to check
        const fragmentMatch = serialized.match(/<div[^>]*anvil:name="fragment_1"[^>]*>([\s\S]*?)<\/div>/);
        if (fragmentMatch) {
            const fragmentContent = fragmentMatch[1];
            expect(fragmentContent).toContain('<anvil-slot name="slot_1"></anvil-slot>');
            expect(fragmentContent).not.toContain('container:dropzone="');
        }
    });

    it("serializes dropzone in layout_properties for slot inside anvil-component", () => {
        // Slot inside an anvil-component (not a fragment) should serialize the "dropzone" layout property
        const html = `<anvil-component type="ColumnPanel" name="panel_1">
    <anvil-slot name="slot_1"></anvil-slot>
</anvil-component>`;

        const parsed = parseContainerForm(html);
        // The slot should have a dropzone in layout_properties (generated)
        expect(parsed.slots?.slot_1?.set_layout_properties?.dropzone).toBeUndefined();

        const serialized = serializeFormContainer(parsed);
        expect(serialized).not.toContain(`container:dropzone="`);
    });

    it("serializes dropzone in layout_properties for slot inside anvil-component with dropzone set", () => {
        // Slot inside an anvil-component (not a fragment) should serialize the "dropzone" layout property
        const html = `<anvil-component type="ColumnPanel" name="panel_1">
    <anvil-slot name="slot_1" container:dropzone="dz-content-area"></anvil-slot>
</anvil-component>`;

        const parsed = parseContainerForm(html);
        const slotDropzone = parsed.slots?.slot_1?.set_layout_properties?.dropzone;
        // The slot should have a dropzone in layout_properties
        expect(slotDropzone).toBe("dz-content-area");

        const serialized = serializeFormContainer(parsed);
        expect(serialized).toContain(`container:dropzone="${slotDropzone}"`);
    });

    it("handles nested fragments correctly", () => {
        // Component inside fragment inside fragment should skip id
        const html = `<div>
    <anvil-component type="HtmlComponent" name="outer_fragment">
        <anvil-component type="HtmlComponent" name="inner_fragment">
            <anvil-component type="Button" name="button_1" prop:text="Click"></anvil-component>
        </anvil-component>
    </anvil-component>
</div>`;

        const parsed = parseContainerForm(html);
        const serialized = serializeFormContainer(parsed);

        // Extract the inner fragment HTML from the serialized output to check
        const innerFragmentMatch = serialized.match(
            /<anvil-component[^>]*type="HtmlComponent"[^>]*name="inner_fragment"[^>]*>([\s\S]*?)<\/anvil-component>/
        );
        if (innerFragmentMatch) {
            const innerFragmentContent = innerFragmentMatch[1];
            expect(innerFragmentContent).not.toContain('container:dropzone="');
            expect(innerFragmentContent).toContain(
                '<anvil-component type="Button" name="button_1" prop:text="Click"></anvil-component>'
            );
        }
    });

    it("round-trips component with dropzone inside anvil-component", () => {
        // Ensure round-trip works correctly for components with dropzone inside anvil-components
        const html = normalizeMultiline(`<anvil-component type="ColumnPanel" name="panel_1">
    <anvil-component type="Button" name="button_1" prop:text="Click" container:dropzone="dz-foo-bar"></anvil-component>
</anvil-component>`);

        const parsed = parseContainerForm(html);
        // Get the generated dropzone from the parsed component
        const buttonDropzone = parsed.components[0]?.components?.[0]?.layout_properties?.dropzone;
        expect(buttonDropzone).toBeDefined();

        const serialized = serializeFormContainer(parsed);
        // The dropzone SHOULD appear in the serialized HTML since it's inside an anvil-component
        expect(serialized).toContain(`container:dropzone="${buttonDropzone}"`);

        // Round-trip should work
        const reparsed = parseContainerForm(serialized);
        expect(reparsed.components[0]?.components?.[0]?.layout_properties?.dropzone).toBe(buttonDropzone);
    });

    it("round-trips slot with dropzone inside anvil-component", () => {
        // Ensure round-trip works correctly for slots with dropzone inside anvil-components
        const html = normalizeMultiline(`<anvil-component type="ColumnPanel" name="panel_1">
    <anvil-slot name="slot_1"></anvil-slot>
</anvil-component>`);

        const parsed = parseContainerForm(html);
        // Get the generated dropzone from the parsed slot
        const slotDropzone = parsed.slots?.slot_1?.set_layout_properties?.dropzone;
        expect(slotDropzone).toBeUndefined();

        const serialized = serializeFormContainer(parsed);
        // The dropzone SHOULD appear in the serialized HTML since it's inside an anvil-component
        expect(serialized).not.toContain(`container:dropzone="${slotDropzone}"`);

        // Round-trip should work
        const reparsed = parseContainerForm(serialized);
        expect(reparsed.slots?.slot_1?.set_layout_properties?.dropzone).toBeUndefined();
    });

    it("round-trips slot with dropzone inside anvil-component with dropzone set", () => {
        // Ensure round-trip works correctly for slots with dropzone inside anvil-components
        const html = normalizeMultiline(`<anvil-component type="ColumnPanel" name="panel_1">
    <anvil-slot name="slot_1" container:dropzone="dz-foo-bar"></anvil-slot>
</anvil-component>`);

        const parsed = parseContainerForm(html);
        // Get the generated dropzone from the parsed slot
        const slotDropzone = parsed.slots?.slot_1?.set_layout_properties?.dropzone;
        expect(slotDropzone).toBe("dz-foo-bar");

        const serialized = serializeFormContainer(parsed);
        // The dropzone SHOULD appear in the serialized HTML since it's inside an anvil-component
        expect(serialized).toContain(`container:dropzone="${slotDropzone}"`);

        // Round-trip should work
        const reparsed = parseContainerForm(serialized);
        expect(reparsed.slots?.slot_1?.set_layout_properties?.dropzone).toBe("dz-foo-bar");
    });

    it("round-trips promoted fragment with container:dropzone", () => {
        // Ensure promoted fragment with container:dropzone preserves the dropzone through round-trip
        const html = normalizeMultiline(`<anvil-component type="form:components.card" name="card_simple">
    <div anvil:container:dropzone="dz-content-area">
        <p class="text-base text-primary">This card has no header - just content.</p>
    </div>
</anvil-component>`);

        const parsed = parseContainerForm(html);
        // The first component of form:components.card should have layout_properties.dropzone === "dz-content-area"
        const card = parsed.components.find((c) => c.name === "card_simple");
        expect(card).toBeDefined();
        expect(card?.components).toBeDefined();
        expect(card?.components?.length).toBeGreaterThan(0);
        const firstComponent = card?.components?.[0];
        expect(firstComponent?.layout_properties?.dropzone).toBe("dz-content-area");

        const serialized = serializeFormContainer(parsed);
        // The dropzone should appear in the serialized HTML (since fragment is inside anvil-component, not a fragment context)
        expect(serialized).toContain('container:dropzone="dz-content-area"');

        // Round-trip should work
        const reparsed = parseContainerForm(serialized);
        const reparsedCard = reparsed.components.find((c) => c.name === "card_simple");
        expect(reparsedCard?.components?.[0]?.layout_properties?.dropzone).toBe("dz-content-area");
    });
});
