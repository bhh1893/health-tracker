import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", "src/api/schema.d.ts"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The app is served over plain HTTP in v1, where this API does not exist.
      // Without this rule the mistake passes every local check on localhost,
      // which is a secure context, and only fails on the phone (ADR 0010).
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='randomUUID']",
          message:
            "crypto.randomUUID is unavailable over plain HTTP (ADR 0010). Use uuidv7() from src/lib/uuidv7.ts.",
        },
      ],
    },
  },
  // This file is plain JavaScript outside tsconfig, so it has no type information.
  {
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
