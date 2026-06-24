import { defineConfig } from "@rstest/core";

export default defineConfig({
    include: ["tests/**/*.test.ts"],
    testEnvironment: "node",
    output: {
        externals: ["@anvil-works/form-template-parser"],
    },
});
