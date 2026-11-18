import { expect, it } from "@rstest/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

it("keeps the container's default layout properties when dropping onto an empty placeholder", async () => {
    // Exercise drop-mode setup without starting the designer's UI and Python environment.
    const filename = resolve("../../platform/runtime-client/js/designer/edit-state.ts");
    const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
    const setup = source.statements.find(
        (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "updateDropMode"
    );
    expect(setup).toBeDefined();
    const { outputText } = ts.transpileModule(setup!.getText(source).replace(/^export /, ""), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    });

    const element = () => ({
        setAttribute() {},
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 40 }),
    });
    const placeholderElement = element();
    const panel = {
        anvil$hooks: {
            domElement: element(),
            enableDropMode: () => [
                { element: element(), dropInfo: { layout_properties: { grid_position: "BEFORE,COL" } } },
                {
                    element: element(),
                    defaultDropZone: true,
                    dropInfo: { layout_properties: { grid_position: "DEFAULT,COL" }, minChildIdx: 1, maxChildIdx: 1 },
                },
            ],
        },
    };
    const editState = {
        editingForm: { pyComponent: { anvil$hooks: {}, anvil$yamlCarrier: {} } },
        componentsByName: new Map([["column_panel_1", panel]]),
        emptyPlaceholdersByComponent: new WeakMap([[panel, { anvil$hooks: { domElement: placeholderElement } }]]),
        dropZones: new Map(),
        dropZonesByComponent: new Map(),
        dropZonesBySlot: new Map(),
    };
    const context = createContext({
        editState,
        persistentEditState: { creating: { type: "component" } },
        nextDropZoneId: 1,
        walkFloatingPanels: () => [],
        windowRpc: { raiseEvent() {} },
    });
    await runInContext(`${outputText}\nupdateDropMode();`, context);

    expect(editState.dropZones.size).toBe(1);
    const [dropZone] = editState.dropZones.values();
    expect(dropZone.element).toBe(placeholderElement);
    expect(dropZone.dropInfo).toEqual({
        layout_properties: { grid_position: "DEFAULT,COL" },
        minChildIdx: 0,
        maxChildIdx: 0,
    });
});
