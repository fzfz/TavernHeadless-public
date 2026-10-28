import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { tmpdir } from "node:os";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(packageRoot, "../..");

test("shared build runs through package exports in an independent Node ESM consumer", () => {
  execFileSync(
    process.execPath,
    [
      join(repositoryRoot, "node_modules/typescript/bin/tsc"),
      "-p",
      join(packageRoot, "tsconfig.json"),
    ],
    { cwd: repositoryRoot, stdio: "pipe" },
  );
  const directory = mkdtempSync(join(tmpdir(), "tavern-shared-consumer-"));
  try {
    const target = join(directory, "node_modules/@tavern/shared");
    mkdirSync(target, { recursive: true });
    cpSync(join(packageRoot, "package.json"), join(target, "package.json"));
    cpSync(join(packageRoot, "dist"), join(target, "dist"), {
      recursive: true,
    });
    const require = createRequire(join(packageRoot, "package.json"));
    cpSync(
      dirname(require.resolve("zod/package.json")),
      join(directory, "node_modules/zod"),
      { recursive: true },
    );
    writeFileSync(
      join(directory, "consumer.mjs"),
      'import { roleUserWebConfigSchema } from "@tavern/shared";\nimport "@tavern/shared/types/backup-file";\nconsole.log(roleUserWebConfigSchema.parse({ apiBaseUrl: "/api", adminBaseUrl: "https://admin.example" }).apiBaseUrl);\n',
    );
    const output = execFileSync(process.execPath, ["consumer.mjs"], {
      cwd: directory,
      encoding: "utf8",
    });
    assert.equal(output.trim(), "/api");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
