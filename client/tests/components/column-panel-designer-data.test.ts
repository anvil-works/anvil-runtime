import { describe, expect, it } from "@rstest/core";
import type { Component } from "@runtime/components/Component";
import {
    applyColumnPanelDesignerData,
    decrementDesignerChildIndicesAfterRemoval,
} from "@runtime/components/column-panel-designer-data";

const element = (panelId: string) =>
    ({
        classList: {
            contains: (className: string) => className === `belongs-to-${panelId}`,
        },
        dataset: {},
    }) as unknown as HTMLElement;

const componentWithElement = (domElement: HTMLElement) => ({ anvil$hooks: { domElement } }) as unknown as Component;

describe("ColumnPanel designer child indices", () => {
    it("keeps the cached index current when a later child replaces its DOM node after removal", () => {
        const panelId = "panel";
        const removed = componentWithElement(element(panelId));
        const laterElement = element(panelId);
        const later = componentWithElement(laterElement);
        const designerDataByComponent = new WeakMap([
            [removed, { childIdx: 0, gridPos: "row_a,col_a" }],
            [later, { childIdx: 1, gridPos: "row_b,col_b" }],
        ]);

        decrementDesignerChildIndicesAfterRemoval({
            components: [{ component: removed }, { component: later }],
            designerDataByComponent,
            removedChildIdx: 0,
            panelId,
        });

        expect(designerDataByComponent.get(later)?.childIdx).toBe(0);
        expect(laterElement.dataset.anvilDesignerPanelChildIdx).toBe("0");

        const replacement = element(panelId);
        later.anvil$hooks.domElement = replacement;
        applyColumnPanelDesignerData(replacement, designerDataByComponent.get(later)!);

        expect(replacement.dataset.anvilDesignerPanelChildIdx).toBe("0");
        expect(replacement.dataset.anvilDesignerPanelGridPos).toBe("row_b,col_b");
    });
});
