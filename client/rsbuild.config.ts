import { mergeRsbuildConfig } from "@rsbuild/core";
import { baseConfigObject } from "./rsbuild.base.config";

export default mergeRsbuildConfig(baseConfigObject, {
    source: {
        entry: {
            runner2: "./js/runner/index.ts",
            sw: {
                import: "./js/sw.ts",
                html: false,
            },
            "runner.min": {
                import: "./css/runner.scss",
                html: false,
            },
            "runner-v3.min": {
                import: "./css/runner-v3.scss",
                html: false,
            },
        },
        define: {
            ANVIL_IN_DESIGNER: JSON.stringify(false),
            BUILD_TIME: JSON.stringify(Date.now()),
        },
    },
    output: {
        distPath: {
            root: "./dist",
        },
    },
    html: {
        template: "./runner2.html",
        inject: false,
    },
});
