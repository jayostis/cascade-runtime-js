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
        DOMParser: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        history: "readonly",
        indexedDB: "readonly",
        location: "readonly",
        requestAnimationFrame: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
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
    files: [
      "packages/cascade-runtime/test/**",
      "packages/cascade-runtime/starter/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["packages/cascade-runtime/starter/summary.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value!=/^(preact|htm|preact-render-to-string)$/], ImportExpression",
          message:
            "The view runs in a browser too: it imports only preact, htm and preact-render-to-string.",
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
