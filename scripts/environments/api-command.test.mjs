import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDatabaseCommand } from "./api-command.mjs";

test("aborted database commands stop their child and save an interrupted result", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tavern-db-interrupt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const api = join(root, "current/api");
  await mkdir(join(api, "dist/db"), { recursive: true });
  await writeFile(join(api, "package.json"), '{"type":"module"}');
  await copyFile(
    new URL("./test-fixtures/process-api.mjs", import.meta.url),
    join(api, "dist/db/environment-command.js"),
  );
  const env = {
    mode: "release",
    tools: { node: { path: process.execPath } },
    paths: {
      current: join(root, "current"),
      database: join(root, "database.db"),
    },
    runtimeEnv: { FIXTURE_WAIT_MS: "500" },
    secretValues: [],
  };
  const controller = new AbortController();
  const outputPath = join(root, "interrupted.json");
  const pending = runDatabaseCommand(env, "status", {
    outputPath,
    signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(pending, (error) => error.exitCode === 130);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(
    JSON.parse(await readFile(outputPath, "utf8")).status,
    "interrupted",
  );
});

test("database status returns the CLI result for a pending database and redacts its diagnostics", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tavern-db-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const apiDirectory = join(root, "current/api");
  await mkdir(join(apiDirectory, "dist/db"), { recursive: true });
  await writeFile(join(apiDirectory, "package.json"), '{"type":"module"}');
  await copyFile(
    new URL("./test-fixtures/process-api.mjs", import.meta.url),
    join(apiDirectory, "dist/db/environment-command.js"),
  );
  const env = {
    mode: "release",
    tools: { node: { path: process.execPath } },
    paths: {
      current: join(root, "current"),
      database: join(root, "database.db"),
    },
    runtimeEnv: { FIXTURE_READY: "false", API_KEY: "private-fixture-key" },
    secretValues: ["private-fixture-key"],
  };
  const outputPath = join(root, "results/status.json");
  const result = await runDatabaseCommand(env, "status", {
    outputPath,
    dataDirectory: join(root, "restored-data"),
  });
  assert.equal(result.ready, false);
  assert.equal(result.dataDirectory, join(root, "restored-data"));
  assert.match(await readFile(`${outputPath}.log`, "utf8"), /\[REDACTED\]/);
  assert.doesNotMatch(
    await readFile(`${outputPath}.log`, "utf8"),
    /private-fixture-key/,
  );
  env.runtimeEnv.FIXTURE_SKIP_OUTPUT = "true";
  await assert.rejects(
    runDatabaseCommand(env, "status", { outputPath }),
    (error) => error.exitCode === 6,
  );
});
