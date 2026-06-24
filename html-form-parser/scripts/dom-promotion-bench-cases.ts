export type PromotionMode = "none" | "annotated" | "all";

export type BenchCase = {
    name: string;
    html: string;
    kind: "container" | "layout";
};

export const PROMOTION_OPTIONS = {
    none: {},
    annotated: { domNodePromotion: "annotated" as const },
    all: { domNodePromotion: "all" as const },
};

export const PROMOTION_MODES = ["none", "annotated", "all"] as const;

function makeRows(count: number, options: { domNodeEvery?: number } = {}): string {
    return Array.from({ length: count }, (_, index) => {
        const slot = index % 20 === 0 ? `<anvil-slot name="slot_${index}"></anvil-slot>` : "";
        const component =
            index % 10 === 0
                ? `<anvil-component type="Button" name="button_${index}" prop:text="Action ${index}"></anvil-component>`
                : "";
        const hasDomNode = options.domNodeEvery !== undefined && index % options.domNodeEvery === 0;
        const sectionAttrs = hasDomNode
            ? ` class="bench-row row-${index}" anvil:dom-node="row_${index}"`
            : ` class="bench-row row-${index}"`;
        const buttonAttrs = hasDomNode ? ` type="button" anvil:dom-node="local_button_${index}"` : ` type="button"`;

        return `
            <section${sectionAttrs}>
                <header>
                    <h2>Item ${index}</h2>
                    <p>Status <strong>${index % 3 === 0 ? "active" : "idle"}</strong></p>
                </header>
                <div class="content">
                    <article>
                        <span class="label">Name</span>
                        <span class="value">Bench item ${index}</span>
                    </article>
                    <nav>
                        <a href="#${index}">Inspect</a>
                        <button${buttonAttrs}>Local button ${index}</button>
                    </nav>
                    ${component}
                    ${slot}
                </div>
            </section>`;
    }).join("");
}

function makeAnvilComponents(count: number): string {
    return Array.from({ length: count }, (_, index) => {
        const type = index % 3 === 0 ? "Button" : index % 3 === 1 ? "Label" : "TextBox";
        return `<anvil-component type="${type}" name="component_${index}" prop:text="Component ${index}"></anvil-component>`;
    }).join("");
}

export const RAW_CASES: BenchCase[] = [
    {
        name: "small form",
        html: `<main class="bench small">${makeRows(4)}</main>`,
        kind: "container",
    },
    {
        name: "small dom-node form",
        html: `<main class="bench small annotated">${makeRows(4, { domNodeEvery: 1 })}</main>`,
        kind: "container",
    },
    {
        name: "small component-only form",
        html: makeAnvilComponents(8),
        kind: "container",
    },
    {
        name: "medium form",
        html: `<main class="bench medium">${makeRows(40)}</main>`,
        kind: "container",
    },
    {
        name: "medium dom-node form",
        html: `<main class="bench medium annotated">${makeRows(40, { domNodeEvery: 4 })}</main>`,
        kind: "container",
    },
    {
        name: "medium component-only form",
        html: makeAnvilComponents(80),
        kind: "container",
    },
    {
        name: "large mixed form",
        html: `<main class="bench large annotated">${makeRows(80, { domNodeEvery: 10 })}</main>`,
        kind: "container",
    },
];
