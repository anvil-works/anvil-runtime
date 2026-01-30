import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

export default [
    js.configs.recommended,
    {
        files: ["**/*.{js,jsx,ts,tsx}"],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
                ecmaVersion: "latest",
                sourceType: "module",
            },
            globals: {
                $: "readonly",
                moment: "readonly",
                b64: "readonly",
                Sk: "readonly",
                ANVIL_IN_DESIGNER: "readonly",
                BUILD_TIME: "readonly",
            },
        },
        env: {
            browser: true,
            es2020: true,
        },
        plugins: {
            "@typescript-eslint": typescript,
        },
        rules: {
            // Basic rules
            semi: ["warn", "always"],
            "prefer-const": "warn",
            "no-unused-vars": "off",
            "no-case-declarations": "off",
            "no-empty-function": "off",

            // TypeScript rules
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-var-requires": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-empty-interface": "warn",
            "@typescript-eslint/no-this-alias": "off",
        },
    },
    {
        ignores: ["lib/*.js"],
    },
];
