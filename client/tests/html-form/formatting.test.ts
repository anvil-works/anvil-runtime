import { describe, expect, it } from "@rstest/core";
import { parseContainerForm, parseSerializedHtml, serializeFormContainer } from "@runtime/html-form/parser";

describe("html-form formatting fidelity", () => {
    it("round-trips card layout markup without altering formatting", () => {
        const html = `<anvil-component type="form:_Components.Card" name="card_1">
    <anvil-component type="form:_Components.Card.CardContentContainer" name="card_content_container_1" container:slot="card-content-slot"></anvil-component>
    <anvil-component type="form:_Components.Button" name="button_1" prop:text="button 24" container:slot="card-content-slot"></anvil-component>
</anvil-component>`;

        const parsed = parseContainerForm(html);
        const serialized = serializeFormContainer(parsed);

        expect(serialized).toBe(html);
    });

    it("round-trips a large DOM tree without altering formatting", () => {
        const sections = Array.from({ length: 60 }, (_, index) => {
            return `    <section class="card card-${index}">
        <header>Card ${index}</header>
        <article>
            <p data-index="${index}">Body ${index}</p>
            <ul>
                <li>Row ${index}-0</li>
                <li>Row ${index}-1</li>
                <li>Row ${index}-2</li>
            </ul>
        </article>
        <footer>
            <button data-action="save-${index}">Save</button>
            <button data-action="cancel-${index}">Cancel</button>
        </footer>
    </section>`;
        }).join("\n");

        const html = `<div class="grid">
${sections}
</div>`;

        const parsed = parseContainerForm(html);
        const serialized = serializeFormContainer(parsed);

        expect(serialized).toBe(html);
    });

    it("round-trips button with text node preserving indentation", () => {
        const html = `<div>
    <button anvil:name="btn">
        Click Me
    </button>
</div>`;

        const parsed = parseContainerForm(html);
        const serialized = serializeFormContainer(parsed);

        expect(serialized).toBe(html);
    });
});
