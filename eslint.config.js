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
        AbortController: "readonly",
        document: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        history: "readonly",
        indexedDB: "readonly",
        location: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
      },
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
                "@the-cascade-protocol/sandbox",
                "@the-cascade-protocol/sandbox/*",
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
      "packages/cascade-runtime/check/**",
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
            "ImportDeclaration[source.value!=/^(preact|preact\\/hooks|htm|preact-render-to-string)$/], ImportExpression",
          message:
            "The view runs in a browser too: it imports only preact, preact/hooks, htm and preact-render-to-string.",
        },
      ],
    },
  },
  {
    files: ["packages/cascade-runtime/starter/pod-api.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value!=/^(cascade-runtime|\\.\\/summary\\.mjs)$/], ImportExpression",
          message:
            "PodApi runs in a browser too: it imports only cascade-runtime and ./summary.mjs.",
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
