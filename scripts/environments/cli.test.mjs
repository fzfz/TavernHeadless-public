import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  access,
  realpath,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { test } from "node:test";
import { parseCommand } from "./cli.mjs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));

test("命令帮助可渐进读取，非法参数在操作前返回2", async () => {
  const overview = await execute(process.execPath, [cli, "--help"]);
  assert.match(overview.stdout, /restore/);
  const specific = await execute(process.execPath, [cli, "migrate", "--help"]);
  assert.match(specific.stdout, /--backup/);
  assert.match(specific.stdout, /--env/);
  await assert.rejects(
    execute(process.execPath, [cli, "stop", "--env", "prod", "--forc"]),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /--forc/);
      return true;
    },
  );
});

test("标准输入采用相同参数契约，重复值明确失败", async () => {
  const request = await parseCommand(
    ["status", "--input", "-"],
    Readable.from(['{"env":"staging","probe":false}']),
  );
  assert.equal(request.options.env, "staging");
  assert.equal(request.options.probe, false);
  await assert.rejects(
    parseCommand(
      ["stop", "--env", "dev", "--input", "-"],
      Readable.from(['{"env":"prod"}']),
    ),
    /重复/,
  );
});

async function runCli(args, { cwd, input, entry = cli } = {}) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  child.stdin.end(input || "");
  return completed;
}

async function cliFixture(t) {
  const aliasBase = await mkdtemp(join(tmpdir(), "tavern-cli-"));
  const base = await realpath(aliasBase);
  t.after(() => rm(base, { recursive: true, force: true }));
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const source = join(base, "source");
  const sandbox = join(base, "environments");
  for (const relative of [
    "scripts/environments",
    "config/environments.example.json",
    "config/environments.schema.json",
    "config/environments",
    "apps/api/config/storage.json",
    "apps/api/config/native-card.json",
    "apps/user-web/public/config/runtime-policy.json",
    "packages/shared/src/config/public-configuration-files.json",
    "package.json",
  ]) {
    await mkdir(dirname(join(source, relative)), { recursive: true });
    await cp(join(repository, relative), join(source, relative), {
      recursive: true,
    });
  }
  await symlink(join(repository, "node_modules"), join(source, "node_modules"));
  await mkdir(join(source, "packages/shared"), { recursive: true });
  await symlink(
    join(repository, "packages/shared/dist"),
    join(source, "packages/shared/dist"),
  );
  const packageJson = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );
  packageJson.engines.node = process.versions.node;
  await writeFile(join(source, "package.json"), JSON.stringify(packageJson));
  const configPath = join(source, "config/environments.example.json");
  const configuration = JSON.parse(await readFile(configPath, "utf8"));
  for (const name of ["pnpm", "nginx"]) {
    const version =
      name === "pnpm"
        ? packageJson.packageManager.split("@").at(-1)
        : configuration.tools.nginx.version;
    const path = join(base, name);
    await writeFile(
      path,
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(version + "\n")});\n`,
    );
    await chmod(path, 0o700);
    configuration.tools[name].path = path;
  }
  await writeFile(configPath, JSON.stringify(configuration));
  await execute("git", ["init", "--quiet", source]);
  await execute("git", ["-C", source, "add", "."]);
  await execute("git", [
    "-C",
    source,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return {
    base,
    source,
    sandbox,
    entry: join(source, "scripts/environments/cli.mjs"),
    aliasEntry: join(aliasBase, "source/scripts/environments/cli.mjs"),
  };
}

test("CLI executes its main entry through an operating system path alias", async (t) => {
  const fixture = await cliFixture(t);
  const result = await runCli(
    [
      "status",
      "--env",
      "dev",
      "--probe",
      "false",
      "--sandbox",
      fixture.sandbox,
    ],
    { entry: fixture.aliasEntry },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "passed");
});

test("CLI resolves the same target from different working directories and rejects duplicate stdin parameters", async (t) => {
  const fixture = await cliFixture(t);
  const args = [
    "status",
    "--env",
    "dev",
    "--probe",
    "false",
    "--sandbox",
    fixture.sandbox,
  ];
  const first = await runCli(args, {
    cwd: fixture.source,
    entry: fixture.entry,
  });
  const second = await runCli(args, { cwd: tmpdir(), entry: fixture.entry });
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  const firstRecord = JSON.parse(
    await readFile(JSON.parse(first.stdout).resultPath, "utf8"),
  );
  const secondRecord = JSON.parse(
    await readFile(JSON.parse(second.stdout).resultPath, "utf8"),
  );
  assert.deepEqual(firstRecord.result, secondRecord.result);
  const duplicate = await runCli(["status", "--env", "dev", "--input", "-"], {
    entry: fixture.entry,
    input: '{"env":"prod"}',
  });
  assert.equal(duplicate.code, 2);
  assert.match(duplicate.stderr, /重复/);
});

test("failed operations leave readable records and redact secrets from stderr and JSON", async (t) => {
  const fixture = await cliFixture(t);
  const secret = "private-cli-fixture-key";
  const config = join(fixture.sandbox, "dev/config");
  await mkdir(config, { recursive: true });
  await mkdir(join(fixture.sandbox, "dev/logs/operations"), {
    recursive: true,
  });
  await writeFile(join(config, "secrets.env"), `AUTH_API_KEYS=${secret}\n`, {
    mode: 0o600,
  });
  const result = await runCli(
    ["logs", "--env", "dev", "--sandbox", fixture.sandbox, "--input", "-"],
    {
      entry: fixture.entry,
      input: JSON.stringify({ component: "operations", operation: secret }),
    },
  );
  assert.equal(result.code, 3);
  const envelope = JSON.parse(result.stdout);
  const saved = await readFile(envelope.resultPath, "utf8");
  assert.equal(JSON.parse(saved).status, "failed");
  assert.equal(JSON.parse(saved).exitCode, 3);
  assert.match(saved, /REDACTED/);
  assert.doesNotMatch(
    result.stderr + result.stdout + saved,
    new RegExp(secret),
  );
});

test("CLI init creates a Git worktree before writing environment directories", async (t) => {
  const fixture = await cliFixture(t);
  await assert.rejects(access(join(fixture.sandbox, "dev")));
  const result = await runCli(
    ["init", "--env", "dev", "--sandbox", fixture.sandbox],
    { entry: fixture.entry },
  );
  assert.equal(result.code, 0, result.stderr);
  await access(join(fixture.sandbox, "dev/.git"));
  const envelope = JSON.parse(result.stdout);
  assert.ok(
    envelope.resultPath.startsWith(
      join(fixture.sandbox, "dev/logs/operations"),
    ),
  );
  assert.equal(
    JSON.parse(await readFile(envelope.resultPath, "utf8")).result.state,
    "stopped",
  );
});
