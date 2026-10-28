import nativeCardConversionRuntime from "./.agents/skills/native-card-conversion/scripts/runtime.json" with { type: "json" };
import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";
import globals from "globals";

const sharedGlobals = { ...globals.node, ...globals.browser };

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.tmp/**",
      ".tmp/**",
      "**/dist/**",
      "build/**",
      "releases/**",
      "current/**",
      "data/**",
      "backups/**",
      "logs/**",
      "run/**",
      "apps/web/prototypes/**",
      "docs/ixd/**/prototype/**",
      "packages/shared/src/generated/role-runtime-validators.ts",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.vitepress/cache/**",
      "**/.vitepress/dist/**",
      "**/*.d.ts",
      "apps/api/data/**",
      ".planning/native-card-production/evidence/instance-*/**",
      ".planning/**",
      `${nativeCardConversionRuntime.outputDirectory}/**`,
      "packages/shared/src/generated/openapi-types.ts",
      "packages/shared/src/generated/.openapi-types.check.ts",
    ],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      globals: sharedGlobals,
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx,cts,mts,vue}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-control-regex": "off",
      "no-undef": "off",
      "prefer-const": "off",
      "vue/no-mutating-props": "off",
    },
  },
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  prettierConfig,
);
