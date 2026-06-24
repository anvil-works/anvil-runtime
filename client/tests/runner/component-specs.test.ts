import { beforeAll, beforeEach, describe, expect, it } from "@rstest/core";
import type {
    parseCustomComponentSpec,
    parseFormPropertySpec,
} from "@runtime/runner/component-specs";
import type { temporaryHackSetupData } from "@runtime/runner/data";

let parseCustomComponent: typeof parseCustomComponentSpec;
let parseFormProperty: typeof parseFormPropertySpec;
let setupData: typeof temporaryHackSetupData;

beforeAll(async () => {
    (globalThis as any).window ??= {};
    ({
        parseCustomComponentSpec: parseCustomComponent,
        parseFormPropertySpec: parseFormProperty,
    } = await import("@runtime/runner/component-specs"));
    ({ temporaryHackSetupData: setupData } = await import("@runtime/runner/data"));
});

const setupComponentSpecData = () => {
    setupData({
        appPackage: "AnvilTestsV3",
        dependencyPackages: {
            depAppId: "AnvilTestsV3Dep",
        },
        logicalDepIds: {
            dep_v3_specs: "depAppId",
        },
        app: {
            forms: [
                {
                    class_name: "LocalForm",
                },
                {
                    // Local app form at client_code/AnvilTestsV3Dep/LocalRow.py.
                    // This deliberately looks like the dependency package name
                    // so formPropertySpec ambiguity prefers exact appLocalFormName.
                    class_name: "AnvilTestsV3Dep.LocalRow",
                },
            ],
            dependency_code: {
                depAppId: {
                    package_name: "AnvilTestsV3Dep",
                    forms: [
                        {
                            // Dependency top-level form at client_code/DepScopedRow.py.
                            // The dependency package name is stored separately above,
                            // so forms[*].class_name is not package-prefixed.
                            class_name: "DepScopedRow",
                        },
                    ],
                },
            },
        },
    } as any);
};

describe("customComponentSpec parsing", () => {
    beforeEach(setupComponentSpecData);

    it("accepts an unknown packageQualifiedFormName only when the caller wants to try a Python import", () => {
        expect(parseCustomComponent("MissingPackage.Nope", null)).toBeNull();
        expect(parseCustomComponent("MissingPackage.Nope", null, { allowUnknownPackage: true })).toMatchObject({
            packageName: "MissingPackage",
            appLocalFormName: "Nope",
            leafName: "Nope",
            packageQualifiedFormName: "MissingPackage.Nope",
            depAppId: null,
            logicalDepId: null,
            legacy: false,
        });
    });

    it("does not parse built-in component types as customComponentSpecs", () => {
        expect(parseCustomComponent("Button", null, { allowUnknownPackage: true })).toBeNull();
        expect(parseCustomComponent("anvil.Button", null, { allowUnknownPackage: true })).toBeNull();
    });

    it("rejects an appLocalFormName without the legacy form: prefix", () => {
        expect(parseCustomComponent("LocalForm", null)).toBeNull();
    });

    it("parses legacy and package-qualified customComponentSpecs", () => {
        expect(parseCustomComponent("form:ComponentSpecTests.LocalRow", null)).toMatchObject({
            packageName: "AnvilTestsV3",
            appLocalFormName: "ComponentSpecTests.LocalRow",
            leafName: "LocalRow",
            packageQualifiedFormName: "AnvilTestsV3.ComponentSpecTests.LocalRow",
            depAppId: null,
            legacy: true,
        });
        expect(parseCustomComponent("AnvilTestsV3.ComponentSpecTests.LocalRow", null)).toMatchObject({
            packageName: "AnvilTestsV3",
            appLocalFormName: "ComponentSpecTests.LocalRow",
            depAppId: null,
            legacy: false,
        });
    });

    it("uses defaultDepAppId as the app context for a legacy customComponentSpec without logicalDepId", () => {
        expect(parseCustomComponent("form:DepChild", "depAppId")).toMatchObject({
            packageName: "AnvilTestsV3Dep",
            appLocalFormName: "DepChild",
            depAppId: "depAppId",
            logicalDepId: "dep_v3_specs",
            legacy: true,
        });
    });
});

describe("formPropertySpec parsing", () => {
    beforeEach(setupComponentSpecData);

    it("treats a dotted formPropertySpec as a packageQualifiedFormName unless it exactly matches an appLocalFormName", () => {
        expect(parseFormProperty("ComponentSpecTests.LocalRow", null)).toMatchObject({
            packageName: "ComponentSpecTests",
            appLocalFormName: "LocalRow",
            depAppId: null,
            logicalDepId: null,
            legacy: false,
        });
        expect(parseFormProperty("AnvilTestsV3.ComponentSpecTests.LocalRow", null)).toMatchObject({
            packageName: "AnvilTestsV3",
            appLocalFormName: "ComponentSpecTests.LocalRow",
            depAppId: null,
            legacy: false,
        });
    });

    it("does not accept legacy customComponentSpec prefixes", () => {
        expect(parseFormProperty("form:ComponentSpecTests.LocalRow", null)).toBeNull();
        expect(parseFormProperty("form:dep_v3_specs:DepRow", null)).toBeNull();
    });

    it("parses legacy dependency formPropertySpecs", () => {
        expect(parseFormProperty("dep_v3_specs:DepRow", null)).toMatchObject({
            packageName: "AnvilTestsV3Dep",
            appLocalFormName: "DepRow",
            depAppId: "depAppId",
            logicalDepId: "dep_v3_specs",
            legacy: true,
        });
    });

    it("uses defaultDepAppId as the app context for an appLocalFormName formPropertySpec", () => {
        expect(parseFormProperty("DepRow", "depAppId")).toMatchObject({
            packageName: "AnvilTestsV3Dep",
            appLocalFormName: "DepRow",
            depAppId: "depAppId",
            logicalDepId: "dep_v3_specs",
            legacy: true,
        });
    });

    it("parses known dependency packageQualifiedFormNames", () => {
        expect(parseFormProperty("AnvilTestsV3Dep.DepScopedRow", null)).toMatchObject({
            packageName: "AnvilTestsV3Dep",
            appLocalFormName: "DepScopedRow",
            leafName: "DepScopedRow",
            packageQualifiedFormName: "AnvilTestsV3Dep.DepScopedRow",
            depAppId: "depAppId",
            logicalDepId: "dep_v3_specs",
            legacy: false,
        });
    });

    it("parses packageQualifiedFormName values used by RepeatingPanel item_template", () => {
        expect(parseFormProperty("AnvilTestsV3.ComponentSpecTests.LocalRow", "depAppId")).toMatchObject({
            packageName: "AnvilTestsV3",
            appLocalFormName: "ComponentSpecTests.LocalRow",
            packageQualifiedFormName: "AnvilTestsV3.ComponentSpecTests.LocalRow",
            depAppId: null,
            legacy: false,
        });
    });

    it("keeps an exact local appLocalFormName when a local package path matches a dependency package name", () => {
        expect(parseFormProperty("AnvilTestsV3Dep.LocalRow", null)).toMatchObject({
            packageName: "AnvilTestsV3",
            appLocalFormName: "AnvilTestsV3Dep.LocalRow",
            depAppId: null,
            legacy: true,
        });
    });

    it("recognizes a newly-added dotted local form after app form-name data refreshes", () => {
        expect(parseFormProperty("Form1.ItemTemplate", null)).toMatchObject({
            packageName: "Form1",
            appLocalFormName: "ItemTemplate",
            packageQualifiedFormName: "Form1.ItemTemplate",
            depAppId: null,
            legacy: false,
        });

        setupData({
            appPackage: "AnvilTestsV3",
            dependencyPackages: {
                depAppId: "AnvilTestsV3Dep",
            },
            logicalDepIds: {
                dep_v3_specs: "depAppId",
            },
            app: {
                forms: [
                    {
                        class_name: "Form1.ItemTemplate",
                    },
                ],
                dependency_code: {
                    depAppId: {
                        package_name: "AnvilTestsV3Dep",
                        forms: [],
                    },
                },
            },
        } as any);

        expect(parseFormProperty("Form1.ItemTemplate", null)).toMatchObject({
            packageName: "AnvilTestsV3",
            appLocalFormName: "Form1.ItemTemplate",
            packageQualifiedFormName: "AnvilTestsV3.Form1.ItemTemplate",
            depAppId: null,
            legacy: true,
        });
    });

    it("keeps an exact dependency appLocalFormName when it matches that dependency app package name", () => {
        setupData({
            appPackage: "AnvilTestsV3",
            dependencyPackages: {
                depAppId: "AnvilTestsV3Dep",
            },
            logicalDepIds: {
                dep_v3_specs: "depAppId",
            },
            app: {
                forms: [],
                dependency_code: {
                    depAppId: {
                        package_name: "AnvilTestsV3Dep",
                        forms: [
                            {
                                // Dependency nested form at
                                // client_code/AnvilTestsV3Dep/DepScopedRow.py.
                                // This tests exact appLocalFormName matching in
                                // the dependency context, despite looking like
                                // a packageQualifiedFormName.
                                class_name: "AnvilTestsV3Dep.DepScopedRow",
                            },
                        ],
                    },
                },
            },
        } as any);

        expect(parseFormProperty("AnvilTestsV3Dep.DepScopedRow", "depAppId")).toMatchObject({
            packageName: "AnvilTestsV3Dep",
            appLocalFormName: "AnvilTestsV3Dep.DepScopedRow",
            depAppId: "depAppId",
            legacy: true,
        });
    });

    it("treats an unknown dotted formPropertySpec as a packageQualifiedFormName", () => {
        expect(parseFormProperty("MissingPackage.Nope", null)).toMatchObject({
            packageName: "MissingPackage",
            appLocalFormName: "Nope",
            leafName: "Nope",
            packageQualifiedFormName: "MissingPackage.Nope",
            depAppId: null,
            logicalDepId: null,
            legacy: false,
        });
    });
});
