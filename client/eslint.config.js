import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
    {
        ignores: ["dist/**", "lib/*.js", "**/*.d.ts"],
    },
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
                ...globals.browser,
                $: "readonly",
                JQuery: "readonly",
                JSX: "readonly",
                moment: "readonly",
                b64: "readonly",
                Sk: "readonly",
                ANVIL_IN_DESIGNER: "readonly",
                BUILD_TIME: "readonly",
            },
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
            "@typescript-eslint/no-empty-object-type": "warn",
            "@typescript-eslint/no-this-alias": "off",
        },
    },
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.serviceworker,
            },
        },
        rules: {
            "no-undef": "off",
            "no-redeclare": "off",
        },
    },
    {
        files: ["**/*.{config.js,config.ts}", "scripts/**/*.{js,ts}"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
];
