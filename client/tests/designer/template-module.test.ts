import { expect, it } from "@rstest/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

it("imports generated designer templates in Skulpt's global scope, including suspended class creation", async () => {
    const skulptContext = createContext({ console, setTimeout, clearTimeout });
    runInContext(readFileSync(resolve("js/lib/skulpt.min.js"), "utf8"), skulptContext);
    const { Sk } = skulptContext;
    skulptContext.anvilFormTemplates = [];

    // Load the private generator without booting the designer's UI and standard modules.
    const filename = resolve("../../platform/runtime-client/js/designer/python-environment.ts");
    const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
    const generator = source.statements.find(
        (statement) =>
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(
                (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "buildTemplateModule"
            )
    );
    expect(generator).toBeDefined();
    const { outputText } = ts.transpileModule(generator!.getText(source), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    });
    const templates = { "Forms.First": Sk.builtin.object, "Forms.Second": Sk.builtin.str };
    const generatorContext = createContext({
        window: skulptContext,
        getMultiFormYaml: async () => Object.keys(templates).map((class_name) => ({ class_name })),
        createFormTemplateClass: (yaml: { class_name: keyof typeof templates }) =>
            Sk.misceval.promiseToSuspension(Promise.resolve(templates[yaml.class_name])),
        BASE_MODULES: { anvil: {} },
        // An ESM import is available to the generator, but not to its generated module.
        chainOrSuspend: Sk.misceval.chain,
    });
    const buildTemplateModule = runInContext(`${outputText}\nbuildTemplateModule;`, generatorContext);
    const moduleSource = await buildTemplateModule({
        depId: null,
        relevantForms: Object.keys(templates),
        appPackage: "test_app",
        packageName: "Forms",
    });

    Sk.configure({
        __future__: Sk.python3,
        read: (path: string) => (path.endsWith("/_anvil_designer.js") ? moduleSource : undefined),
    });
    const module = await Sk.misceval.asyncToPromise(() => Sk.importModule("_anvil_designer", false, true));

    expect(module.$d.FirstTemplate).toBe(templates["Forms.First"]);
    expect(module.$d.SecondTemplate).toBe(templates["Forms.Second"]);
});
