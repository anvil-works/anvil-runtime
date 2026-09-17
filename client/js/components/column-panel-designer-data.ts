import type { Component } from "./Component";

export interface ColumnPanelDesignerData {
    childIdx: number;
    gridPos: string;
}

export const applyColumnPanelDesignerData = (element: HTMLElement, data: ColumnPanelDesignerData) => {
    element.dataset.anvilDesignerPanelChildIdx = String(data.childIdx);
    element.dataset.anvilDesignerPanelGridPos = data.gridPos;
    element.dataset.anvilDesignerColumnpanelComponent = "";
};

export const decrementDesignerChildIndicesAfterRemoval = (
    {
        components,
        designerDataByComponent,
        removedChildIdx,
        panelId,
    }: {
        components: { component: Component }[];
        designerDataByComponent: WeakMap<Component, ColumnPanelDesignerData>;
        removedChildIdx: number;
        panelId: string;
    }
) => {
    for (const { component } of components) {
        const designerData = designerDataByComponent.get(component);
        if (!designerData || designerData.childIdx <= removedChildIdx) {
            continue;
        }

        designerData.childIdx--;
        const element = component.anvil$hooks.domElement;
        if (element?.classList.contains(`belongs-to-${panelId}`)) {
            applyColumnPanelDesignerData(element, designerData);
        }
    }
};
