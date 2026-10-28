import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { executeCommand } from "./operations.mjs";

test("status before initialization preserves the empty worktree destination and returns a temporary record", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "tavern-uninitialized-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const result = await executeCommand("status", {
    env: "dev",
    sandbox,
    probe: false,
  });
  t.after(() =>
    rm(dirname(result.resultPath), { recursive: true, force: true }),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(
    JSON.parse(await readFile(result.resultPath, "utf8")).result.state,
    "stopped",
  );
  await assert.rejects(access(join(sandbox, "dev")), { code: "ENOENT" });
});

test("operation records redact secrets before JSON escaping", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "tavern-escaped-secret-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const configuration = join(sandbox, "dev/config");
  await mkdir(configuration, { recursive: true });
  const secret = 'fixture"quoted-secret';
  await writeFile(
    join(configuration, "secrets.env"),
    "AUTH_API_KEYS='" + secret + "'\n",
    { mode: 0o600 },
  );
  const result = await executeCommand("logs", {
    env: "dev",
    sandbox,
    component: "operations",
    operation: secret,
  });
  t.after(() =>
    rm(dirname(result.resultPath), { recursive: true, force: true }),
  );
  const record = JSON.parse(await readFile(result.resultPath, "utf8"));
  assert.equal(result.exitCode, 3);
  assert.ok(!record.result.error.includes(secret));
  assert.match(record.result.error, /REDACTED/);
});
