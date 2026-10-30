import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/", "build/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
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
    files: ["packages/evals/workflow/**"],
    languageOptions: {
      globals: {
        args: "readonly",
        agent: "readonly",
        parallel: "readonly",
        pipeline: "readonly",
        log: "readonly",
        phase: "readonly",
        budget: "readonly",
      },
    },
  },
  {
    files: ["packages/cascade-runtime/test/**"],
    rules: {
      "no-restricted-imports": "off",
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
