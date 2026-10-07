import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/", "build/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    files: ["packages/site/try/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        FormData: "readonly",
        indexedDB: "readonly",
      },
    },
  },
  {
    files: ["packages/demo-hospital/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@cascade-runtime/*",
                "cascade-runtime",
                "cascade-runtime/*",
                "**/runtime/**",
                "**/cascade-runtime/**",
              ],
              message: "The demo hospital is reached only through a fetch.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/runtime/**", "packages/cascade-runtime/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@cascade-runtime/demo-hospital",
                "@cascade-runtime/demo-hospital/*",
                "**/demo-hospital/**",
              ],
              message: "The runtime reaches a hospital only through a fetch.",
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
