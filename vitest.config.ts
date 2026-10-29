import nativeCardConversionRuntime from "./.agents/skills/native-card-conversion/scripts/runtime.json" with { type: "json" };
import nativeEnvironments from "./config/environments.example.json" with { type: "json" };
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

const vuePlugin = vue();
const vueTransform = vuePlugin.transform;
if (typeof vueTransform === "function") {
  vuePlugin.transform = function (code, id, options) {
    return vueTransform.call(this, code, id, { ...options, ssr: false });
  };
}

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const runtimeDirectoryKeys = [
  "data",
  "releases",
  "current",
  "buildWork",
  "artifacts",
  "run",
  "processLogs",
  "operations",
  "backups",
] as const;
const runtimeExcludes = runtimeDirectoryKeys.map(
  (key) => `${resolve(rootDir, nativeEnvironments.defaults.layout[key])}/**`,
);

export default defineConfig({
  plugins: [vuePlugin],
  resolve: {
    alias: {
      "@tavern/adapters-sillytavern/browser-import": resolve(
        rootDir,
        "packages/adapters-sillytavern/src/browser-import.ts",
      ),
      "@tavern/adapters-sillytavern": resolve(
        rootDir,
        "packages/adapters-sillytavern/src/index.ts",
      ),
      "@tavern/client-helpers": resolve(
        rootDir,
        "packages/official-integration-kit/client-helpers/src/index.ts",
      ),
      "@tavern/core": resolve(rootDir, "packages/core/src/index.ts"),
      "@tavern/sdk": resolve(
        rootDir,
        "packages/official-integration-kit/sdk/src/index.ts",
      ),
      "@tavern/shared": resolve(rootDir, "packages/shared/src/index.ts"),
    },
  },
  test: {
    // Studio 使用自身配置与测试命令。
    exclude: [
      ...configDefaults.exclude,
      ...runtimeExcludes,
      "**/dist/**",
      "apps/studio/**",
      "scripts/environments/**",
      "**/*.node-test.mjs",
      "docs/ixd/**/prototype/**",
      ".planning/**",
      `${nativeCardConversionRuntime.outputDirectory}/**`,
    ],
    coverage: {
      provider: "v8",
      include: ["**/*.{js,cjs,mjs,ts,mts,tsx,jsx,vue,svelte,marko,astro}"],
      exclude: [
        ...runtimeExcludes,
        "**/dist/**",
        "**/generated/**",
        "**/scripts/**",
        "**/drizzle/**",
        "apps/web/**",
        "apps/studio/**",
        "**/*.d.ts",
        "**/node_modules/**",
        "vitepress/**",
        "coverage/**",
        "**/db/migrate.ts",
      ],
    },
  },
});
