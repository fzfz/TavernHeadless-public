import assert from "node:assert/strict";
import test from "node:test";
import { help, parseCommand } from "./cli.mjs";

test("release command help selects a supported target and parsing rejects unsupported environments", async () => {
  assert.match(help("deploy"), /deploy --env staging/);
  assert.match(help("rollback"), /rollback --env staging/);
  await assert.rejects(
    parseCommand(["deploy", "--env", "dev", "--release", "release-1"]),
    /staging.*prod/,
  );
  await assert.rejects(
    parseCommand([
      "build",
      "--env",
      "prod",
      "--ref",
      "v1",
      "--release",
      "release-1",
      "--installation-approval",
      "/tmp/approval.json",
    ]),
    /dev/,
  );
  assert.equal(
    (
      await parseCommand([
        "deploy",
        "--env",
        "staging",
        "--release",
        "release-1",
      ])
    ).options.env,
    "staging",
  );
});
