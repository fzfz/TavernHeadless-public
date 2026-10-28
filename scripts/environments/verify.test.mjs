import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { loadEnvironment } from "./config.mjs";
import { verifyEnvironment } from "./verify.mjs";

const contract = JSON.parse(
  await readFile(new URL("./acceptance.json", import.meta.url), "utf8"),
);

async function serveEntries(t, env) {
  const state = {
    healthy: true,
    assetPresent: true,
    configurationCorrect: true,
  };
  const servers = [];
  for (const frontend of env.frontends) {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(204);
        response.end();
      } else if (request.url === "/api/health") {
        response.writeHead(state.healthy ? 200 : 502, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            ok: true,
            service: "@tavern/api",
            database: "ready",
          }),
        );
      } else if (request.url.startsWith("/config/")) {
        response.setHeader("content-type", "application/json");
        response.end(
          state.configurationCorrect
            ? "{}"
            : JSON.stringify({ wrongEnvironment: true }),
        );
      } else if (request.url === "/assets/main.js") {
        response.writeHead(state.assetPresent ? 200 : 404, {
          "content-type": "application/javascript",
        });
        response.end(state.assetPresent ? "export {};" : "");
      } else if (request.url.startsWith("/assets/")) {
        response.writeHead(404);
        response.end();
      } else {
        response.setHeader("content-type", "text/html");
        response.end(
          '<!doctype html><html><body>Fixture<script type="module" src="/assets/main.js"></script></body></html>',
        );
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    env.ports.frontends[frontend].http = server.address().port;
    servers.push(server);
  }
  t.after(async () => {
    for (const server of servers)
      await new Promise((resolve) => server.close(resolve));
  });
  return state;
}

async function businessBoundary(env) {
  const runner = join(env.sourceRoot, "pnpm");
  await writeFile(
    runner,
    `#!${process.execPath}\nimport {existsSync} from 'node:fs';\nconst args=process.argv.slice(2);if(args[0]!=='exec'||args[1]!=='vitest'||args[2]!=='run')process.exit(2);for(const path of args.filter(arg=>arg.endsWith('.test.ts')))if(!existsSync(path))process.exit(3);console.log('fixture boundary executed');\n`,
  );
  await chmod(runner, 0o700);
  env.tools.pnpm.path = runner;
  for (const path of contract.businessFixtures) {
    await mkdir(dirname(join(env.sourceRoot, path)), { recursive: true });
    await writeFile(
      join(env.sourceRoot, path),
      "// Fixture for command boundary verification.\n",
    );
  }
}

async function acceptanceEvidence(env, overrides = {}) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: env.sourceRoot,
    encoding: "utf8",
  }).trim();
  const root = join(env.root, "supplied-evidence");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "operation.log"), "Fixture operation completed\n");
  const identity = {
    schemaVersion: 1,
    environment: env.name,
    release: null,
    commit,
  };
  const checks = [];
  for (const id of contract.stages[env.name].required) {
    const path = join(root, id + ".json");
    await writeFile(
      path,
      JSON.stringify({
        ...identity,
        id,
        status: "passed",
        commands: [{ file: "fixture", args: [id] }],
        preconditions: { isolated: true },
        expected: { completed: true },
        actual: { completed: true },
        logs: ["operation.log"],
        ...overrides,
      }),
    );
    checks.push({ id, evidencePath: path });
  }
  const path = join(root, "index.json");
  await writeFile(
    path,
    JSON.stringify({ ...identity, operatorConfirmed: true, checks }),
  );
  return path;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "tavern-verify-"));
  const env = await loadEnvironment("dev", { sandboxRoot: root });
  const source = join(root, "source");
  await mkdir(source);
  for (const args of [
    ["init"],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ],
  ])
    execFileSync("git", args, { cwd: source, stdio: "ignore" });
  env.sourceRoot = source;
  env.hostEnv = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    LC_ALL: "C",
  };
  env.tools.node.path = process.execPath;
  env.tools.pnpm.path = process.execPath;
  for (const frontend of env.frontends)
    for (const file of env.publicFiles[frontend]) {
      const path = join(env.paths.publicConfig, frontend, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "{}");
    }
  t.after(() => rm(root, { recursive: true, force: true }));
  return env;
}

test("unit verification runs discovered environment tests and the native build tests into a result file", async (t) => {
  const env = await fixture(t);
  for (const file of [
    "scripts/environments/basic.test.mjs",
    ...contract.unitTests,
  ]) {
    await mkdir(dirname(join(env.sourceRoot, file)), { recursive: true });
    await writeFile(
      join(env.sourceRoot, file),
      "import test from 'node:test';test('fixture',()=>{});\n",
    );
  }
  const result = await verifyEnvironment(env, { suite: "unit" });
  assert.equal(result.status, "passed");
  assert.equal(result.checks.length, 1 + contract.unitTests.length);
  const saved = JSON.parse(await readFile(result.evidencePath, "utf8"));
  assert.equal(saved.environment, "dev");
  assert.equal(saved.suite, "unit");
  assert.ok(
    saved.checks.every(
      (check) => check.status === "passed" && check.evidencePath,
    ),
  );
});

test("acceptance records missing evidence after probing all three HTTP entries", async (t) => {
  const env = await fixture(t);
  const servers = [];
  for (const frontend of env.frontends) {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(204);
        response.end();
      } else if (request.url === "/api/health") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            ok: true,
            service: "@tavern/api",
            database: "ready",
          }),
        );
      } else if (request.url.startsWith("/config/")) {
        response.setHeader("content-type", "application/json");
        response.end("{}");
      } else if (request.url.startsWith("/assets/")) {
        response.writeHead(404);
        response.end();
      } else {
        response.setHeader("content-type", "text/html");
        response.end("<!doctype html><html><body>Fixture</body></html>");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    env.ports.frontends[frontend].http = server.address().port;
    servers.push(server);
  }
  t.after(async () => {
    for (const server of servers)
      await new Promise((resolve) => server.close(resolve));
  });
  let error;
  try {
    await verifyEnvironment(env, { suite: "acceptance" });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error.exitCode, 3);
  const record = JSON.parse(await readFile(error.details.evidencePath, "utf8"));
  assert.equal(record.status, "incomplete");
  assert.ok(
    record.checks.some(
      (check) => check.id === "probe:web:health" && check.status === "passed",
    ),
  );
  assert.ok(
    record.checks.some(
      (check) => check.id === "B03" && check.status === "missing",
    ),
  );
});

test("full verification uses the repository check table and limits an explicit CI selection", async (t) => {
  const env = await fixture(t);
  await mkdir(join(env.sourceRoot, "docs/agents"), { recursive: true });
  await writeFile(
    join(env.sourceRoot, "docs/agents/development-checks.json"),
    JSON.stringify({
      static: `${process.execPath} -e "console.log('source-check-command')"`,
      types: `${process.execPath} -e "process.exit(8)"`,
    }),
  );
  const result = await verifyEnvironment(env, {
    suite: "full",
    checks: ["static"],
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(
    result.checks.map((check) => check.id),
    ["static"],
  );
  assert.match(
    await readFile(result.checks[0].evidencePath, "utf8"),
    /source-check-command/,
  );
});

test("a failing external check returns verification exit code 7 and saves its log", async (t) => {
  const env = await fixture(t);
  await mkdir(join(env.sourceRoot, "docs/agents"), { recursive: true });
  await writeFile(
    join(env.sourceRoot, "docs/agents/development-checks.json"),
    JSON.stringify({ types: `${process.execPath} -e "process.exit(8)"` }),
  );
  let error;
  try {
    await verifyEnvironment(env, { suite: "full", checks: "types" });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error.exitCode, 7);
  const result = JSON.parse(await readFile(error.details.evidencePath, "utf8"));
  assert.equal(result.status, "failed");
  assert.equal(result.checks[0].id, "types");
  assert.equal(result.checks[0].status, "failed");
});

test("acceptance requires matching operation evidence and keeps failing live probes failed", async (t) => {
  const env = await fixture(t);
  const state = await serveEntries(t, env);
  await businessBoundary(env);
  const evidence = await acceptanceEvidence(env);
  const passed = await verifyEnvironment(env, {
    suite: "acceptance",
    evidence,
  });
  assert.equal(passed.status, "passed");
  assert.ok(
    passed.checks.some(
      (check) => check.id === "business:fixtures" && check.status === "passed",
    ),
  );
  const mismatch = await acceptanceEvidence(env, { commit: "0".repeat(40) });
  await assert.rejects(
    verifyEnvironment(env, { suite: "acceptance", evidence: mismatch }),
    (error) => error.exitCode === 3,
  );
  await acceptanceEvidence(env);
  state.configurationCorrect = false;
  await assert.rejects(
    verifyEnvironment(env, { suite: "acceptance", evidence }),
    (error) => error.exitCode === 7,
  );
  state.configurationCorrect = true;
  state.assetPresent = false;
  await assert.rejects(
    verifyEnvironment(env, { suite: "acceptance", evidence }),
    (error) => error.exitCode === 7,
  );
  state.assetPresent = true;
  state.healthy = false;
  await assert.rejects(
    verifyEnvironment(env, { suite: "acceptance", evidence }),
    (error) => error.exitCode === 7,
  );
});

test("release verification rejects a missing original artifact instead of recording a pass", async (t) => {
  const env = await fixture(t);
  await assert.rejects(
    verifyEnvironment(env, { suite: "release", release: "missing-artifact" }),
    (error) => error.exitCode === 3,
  );
});

test("release verification records a corrupt original manifest as a failed check", async (t) => {
  const env = await fixture(t);
  const directory = join(
    env.environmentRoots.dev,
    env.configuration.defaults.layout.artifacts,
    "corrupt-artifact",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, env.files.manifest),
    JSON.stringify({
      version: 1,
      release: "corrupt-artifact",
      commit: "invalid",
    }),
  );
  let error;
  try {
    await verifyEnvironment(env, {
      suite: "release",
      release: "corrupt-artifact",
    });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error.exitCode, 7);
  const record = JSON.parse(await readFile(error.details.evidencePath, "utf8"));
  assert.equal(record.status, "failed");
  assert.equal(record.suite, "release");
});

test("unknown CI check IDs are rejected as invalid arguments", async (t) => {
  const env = await fixture(t);
  await mkdir(join(env.sourceRoot, "docs/agents"), { recursive: true });
  await writeFile(
    join(env.sourceRoot, "docs/agents/development-checks.json"),
    "{}",
  );
  await assert.rejects(
    verifyEnvironment(env, { suite: "full", checks: "unrecognized" }),
    (error) => error.exitCode === 2,
  );
});
