import { describe, expect, it } from "@rstest/core";
import { copyFormYamlWithRenamedPackageQualifiedFormSpecs } from "@anvil-works/form-template-parser";
import type { FormYaml } from "@anvil-works/form-template-parser";

describe("copyFormYamlWithRenamedPackageQualifiedFormSpecs", () => {
    it("renames package-qualified component and form-property specs", () => {
        const form: FormYaml = {
            layout: { type: "OldPackage.Layouts.BaseLayout" },
            components_by_slot: {
                content: [
                    {
                        type: "RepeatingPanel",
                        name: "repeating_panel_1",
                        properties: { item_template: "OldPackage.RowTemplate" },
                    },
                ],
            },
        };

        const result = copyFormYamlWithRenamedPackageQualifiedFormSpecs(form, [
            { oldPackageName: "OldPackage", newPackageName: "NewPackage" },
        ]);

        expect(result.changed).toBe(true);
        expect(result.form.layout?.type).toBe("NewPackage.Layouts.BaseLayout");
        expect(result.form.components_by_slot?.content?.[0].properties.item_template).toBe("NewPackage.RowTemplate");
        expect(form.layout?.type).toBe("OldPackage.Layouts.BaseLayout");
    });

    it("leaves legacy form specs unchanged", () => {
        const form: FormYaml = {
            layout: { type: "form:Layouts.BaseLayout" },
            components_by_slot: {},
        };

        const result = copyFormYamlWithRenamedPackageQualifiedFormSpecs(form, [
            { oldPackageName: "OldPackage", newPackageName: "NewPackage" },
        ]);

        expect(result.changed).toBe(false);
        expect(result.form).toEqual(form);
    });

    it("leaves built-in component specs unchanged", () => {
        const form: FormYaml = {
            components: [{ type: "anvil.Label" }],
        };

        const result = copyFormYamlWithRenamedPackageQualifiedFormSpecs(form, [
            { oldPackageName: "anvil", newPackageName: "UserPackage" },
        ]);

        expect(result.changed).toBe(false);
        expect(result.form).toEqual(form);
    });

    it("applies multiple package renames as one batch", () => {
        const form: FormYaml = {
            layout: { type: "OldPackage.Layout" },
            components: [{ type: "IntermediatePackage.Form" }],
        };

        const result = copyFormYamlWithRenamedPackageQualifiedFormSpecs(form, [
            { oldPackageName: "OldPackage", newPackageName: "IntermediatePackage" },
            { oldPackageName: "IntermediatePackage", newPackageName: "FinalPackage" },
        ]);

        expect(result.changed).toBe(true);
        expect(result.form.layout?.type).toBe("IntermediatePackage.Layout");
        expect(result.form.components?.[0].type).toBe("FinalPackage.Form");
    });
});
