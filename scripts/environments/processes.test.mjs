import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  startEnvironment,
  stopEnvironment,
  getEnvironmentStatus,
  createProcessLogRedactor,
  inspectProcess,
} from "./processes.mjs";

const fixtures = fileURLToPath(new URL("./test-fixtures/", import.meta.url));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function environment(t, name = "dev") {
  const root = await mkdtemp(join(tmpdir(), `tavern-process-${name}-`));
  const env = {
    name,
    root,
    sourceRoot: root,
    mode: "release",
    hostname: `${name}.tavern.localhost`,
    listenHost: "127.0.0.1",
    gatewayListenHost: "127.0.0.1",
    hostAliases: ["127.0.0.1", "localhost", "tavern.local"],
    processPrefix: `tavern:${name}`,
    sessionCookieName: `tavern_${name}_session`,
    sessionCookieSecure: false,
    frontends: ["web", "user-web", "studio"],
    uploadMaxBytes: 83886080,
    timeouts: {
      startSeconds: 6,
      stopSeconds: 3,
      pollMs: 40,
      proxySeconds: 3600,
      probeSeconds: 1,
    },
    probes: { api: "/health", frontend: "/" },
    files: { processIdentity: "processes.json" },
    publicFiles: {
      web: ["role-apps.json"],
      "user-web": ["application.json", "runtime-policy.json"],
      studio: [],
    },
    ports: { api: await freePort(), frontends: {} },
    hostEnv: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin`,
      LC_ALL: "C",
    },
    secretValues: ["test-private-key", "fixture-master-key"],
    paths: {},
    tools: {},
  };
  for (const frontend of env.frontends)
    env.ports.frontends[frontend] = {
      http: await freePort(),
      dev: await freePort(),
    };
  for (const [name, path] of Object.entries({
    config: "config",
    applicationEnv: "config/application.env",
    secretsEnv: "config/secrets.env",
    publicConfig: "config/public",
    nginxConfig: "config/nginx/nginx.conf",
    data: "data",
    database: "data/database.db",
    releases: "releases",
    current: "current",
    buildWork: "build/work",
    artifacts: "build/artifacts",
    run: "run",
    processLogs: "logs/processes",
    operations: "logs/operations",
    backups: "backups",
  }))
    env.paths[name] = join(root, path);
  await mkdir(join(root, "current/api/dist/db"), { recursive: true });
  await mkdir(join(root, "config/nginx"), { recursive: true });
  await writeFile(join(root, "current/api/package.json"), '{"type":"module"}');
  await copyFile(
    join(fixtures, "process-api.mjs"),
    join(root, "current/api/dist/index.js"),
  );
  await copyFile(
    join(fixtures, "process-api.mjs"),
    join(root, "current/api/dist/db/environment-command.js"),
  );
  await copyFile(join(fixtures, "process-nginx.mjs"), join(root, "nginx"));
  await chmod(join(root, "nginx"), 0o700);
  env.tools = {
    node: { path: process.execPath },
    nginx: { path: join(root, "nginx") },
    pnpm: { path: "/unavailable/pnpm" },
  };
  env.runtimeEnv = {
    ...env.hostEnv,
    HOST: env.listenHost,
    USER_SESSION_COOKIE_NAME: env.sessionCookieName,
    USER_SESSION_COOKIE_SECURE: String(env.sessionCookieSecure),
    PORT: String(env.ports.api),
    API_KEY: "test-private-key",
    APP_SECRETS_MASTER_KEY: "fixture-master-key",
    TAVERN_ENVIRONMENT: name,
  };
  t.after(async () => {
    await stopEnvironment(env, { force: true });
    await rm(root, { recursive: true, force: true });
  });
  return env;
}

async function terminateRunner(env, started) {
  const pid = started.components.runner.pid;
  process.kill(pid, "SIGKILL");
  const deadline = Date.now() + env.timeouts.stopSeconds * 1000;
  while (Date.now() < deadline && (await inspectProcess(pid)))
    await delay(env.timeouts.pollMs);
  assert.equal(await inspectProcess(pid), null);
}

async function processInspectionFixture(t, snapshots) {
  const root = await mkdtemp(join(tmpdir(), "tavern-process-inspection-"));
  const previousPath = process.env.PATH;
  t.after(async () => {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, "snapshots.json"), JSON.stringify(snapshots));
  const script = String.raw`#!${process.execPath}
const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { join, basename } = require("node:path");
const snapshots = JSON.parse(readFileSync(join(__dirname, "snapshots.json"), "utf8"));
const counterPath = join(__dirname, "counter");
const counter = existsSync(counterPath) ? Number(readFileSync(counterPath, "utf8")) : 0;
if (basename(process.argv[1]) === "ps") {
  const fields = process.argv.at(-1).split(",").map((field) => field.replace(/=$/, ""));
  const snapshot = snapshots[Math.min(counter, snapshots.length - 1)];
  if (fields.includes("pid")) writeFileSync(counterPath, String(counter + 1));
  console.log(fields.map((field) => snapshot[field]).join(" "));
} else {
  const snapshot = snapshots[Math.max(0, Math.min(counter - 1, snapshots.length - 1))];
  console.log("p" + snapshot.pid + "\nn" + snapshot.cwd);
}
`;
  for (const command of ["ps", "lsof"]) {
    await writeFile(join(root, command), script, { mode: 0o700 });
  }
  process.env.PATH = root;
}

test(
  "process inspection treats a process that exits between OS samples as stopped",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    const running = {
      pid: 4242,
      pgid: 4242,
      uid: 501,
      lstart: "Tue Oct 27 16:00:00 2026",
      stat: "S",
      command: "/fixture/node /fixture/app.mjs",
      cwd: "/fixture",
      comm: "/fixture/node",
    };
    await processInspectionFixture(t, [
      running,
      { ...running, stat: "Z", comm: "<defunct>" },
    ]);
    assert.equal(await inspectProcess(running.pid), null);
  },
);

test(
  "process inspection resamples a replaced PID before returning its complete identity",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    const previous = {
      pid: 4242,
      pgid: 4242,
      uid: 501,
      lstart: "Tue Oct 27 16:00:00 2026",
      stat: "S",
      command: "/fixture/previous-node /fixture/previous.mjs",
      cwd: "/fixture/previous",
      comm: "/fixture/previous-node",
    };
    const current = {
      ...previous,
      lstart: "Tue Oct 27 16:01:00 2026",
      command: "/fixture/current-node /fixture/current.mjs",
      cwd: "/fixture/current",
      comm: "/fixture/current-node",
    };
    await processInspectionFixture(t, [previous, current]);
    assert.deepEqual(await inspectProcess(previous.pid), {
      pid: 4242,
      pgid: 4242,
      uid: 501,
      startTime: "Tue Oct 27 16:01:00 2026",
      command: current.command,
      cwd: current.cwd,
      executable: current.comm,
    });
  },
);

for (const runnerAlive of [true, false]) {
  const runnerState = runnerAlive ? "running" : "exited";

  test(`graceful stop preserves upstreams and process identities when gateway listeners stay open (${runnerState} runner)`, async (t) => {
    const env = await environment(t);
    await writeFile(
      env.tools.nginx.path,
      `${await readFile(env.tools.nginx.path, "utf8")}
process.removeAllListeners("SIGQUIT");
process.on("SIGQUIT", () => {});
`,
    );
    const started = await startEnvironment(env);
    if (!runnerAlive) await terminateRunner(env, started);
    await assert.rejects(
      stopEnvironment(env),
      (error) => error.exitCode === 4 && /stop --force/.test(error.message),
    );
    const status = await getEnvironmentStatus(env, { probe: false });
    assert.equal(status.state, "degraded");
    for (const [name, component] of Object.entries(status.components)) {
      if (name === "runner" && !runnerAlive) {
        assert.equal(component.alive, false);
      } else {
        assert.equal(component.alive, true, name);
        assert.equal(component.identityMatches, true, name);
      }
    }
    assert.equal(
      (await fetch(`http://127.0.0.1:${env.ports.api}/health`)).status,
      200,
    );
    const record = JSON.parse(await readFile(started.recordPath, "utf8"));
    assert.equal(record.startId, started.startId);
    assert.equal(
      (await stopEnvironment(env, { force: true })).state,
      "stopped",
    );
  });

  test(`graceful stop releases gateway listeners before stopping its connected upstream (${runnerState} runner)`, async (t) => {
    const env = await environment(t);
    const eventsPath = join(env.paths.run, "gateway-events.log");
    await writeFile(
      env.tools.nginx.path,
      String.raw`#!/usr/bin/env node
import http from "node:http";
import net from "node:net";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const config = await readFile(process.argv[process.argv.indexOf("-c") + 1], "utf8");
if (!process.argv.includes("-t")) {
  const event = (message) => appendFileSync(${JSON.stringify(eventsPath)}, message + "\n");
  let accepting = true;
  const upstream = net.connect(${env.ports.api}, "127.0.0.1");
  const disconnected = new Promise((resolve) => upstream.once("close", resolve));
  upstream.on("error", () => {});
  const request = () => upstream.write("GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
  upstream.once("connect", request);
  await new Promise((resolve) => upstream.once("data", resolve));
  upstream.on("data", () => {});
  const requests = setInterval(request, 50);
  const ports = [...new Set([...config.matchAll(/listen 127\.0\.0\.1:(\d+)/g)].map((match) => Number(match[1])))];
  const servers = ports.map((port) => {
    const server = http.createServer((request, response) => {
      response.writeHead(request.url === "/healthz" ? 204 : 200);
      response.end(request.url === "/healthz" ? "" : "fixture");
    });
    server.listen(port, "127.0.0.1");
    return server;
  });
  upstream.once("close", () => {
    clearInterval(requests);
    event(accepting ? "upstream closed while accepting" : "upstream closed after listeners");
  });
  process.on("SIGQUIT", async () => {
    await delay(150);
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    accepting = false;
    event("gateway listeners closed");
    await disconnected;
    event("gateway drained");
    process.exit(0);
  });
}
`,
    );
    const started = await startEnvironment(env);
    assert.equal(started.state, "running");
    if (!runnerAlive) await terminateRunner(env, started);
    const stopped = await stopEnvironment(env);
    assert.equal(stopped.state, "stopped");
    assert.ok(
      Object.values(stopped.components).every((component) => !component.alive),
    );
    assert.match(
      await readFile(eventsPath, "utf8"),
      /gateway listeners closed\nupstream closed after listeners\ngateway drained\n/,
    );
  });
}

test("process logs redact raw and JSON-escaped secrets across every chunk boundary", async () => {
  for (const secret of [
    'quote"inside',
    "slash\\inside",
    "line\ninside",
    '混合"斜\\线\n密钥',
  ]) {
    const input = Buffer.from(`raw:${secret}\n${JSON.stringify({ secret })}\n`);
    for (let split = 1; split < input.length; split += 1) {
      const stream = Readable.from([
        input.subarray(0, split),
        input.subarray(split),
      ]).pipe(createProcessLogRedactor([secret]));
      let output = "";
      for await (const chunk of stream) output += chunk.toString();
      assert.equal(
        output,
        'raw:[REDACTED]\n{"secret":"[REDACTED]"}\n',
        `chunk boundary ${split} for ${JSON.stringify(secret)}`,
      );
    }
  }
});

test("release start requires an application master key before creating processes", async (t) => {
  const env = await environment(t);
  delete env.runtimeEnv.APP_SECRETS_MASTER_KEY;
  await assert.rejects(
    startEnvironment(env),
    (error) =>
      error.exitCode === 3 && /APP_SECRETS_MASTER_KEY/.test(error.message),
  );
  assert.equal(
    (await getEnvironmentStatus(env, { probe: false })).state,
    "stopped",
  );
  await assert.rejects(
    readFile(join(env.paths.run, env.files.processIdentity)),
    (error) => error.code === "ENOENT",
  );
});

test("interrupting stop finishes the recorded cleanup and returns 130", async (t) => {
  const env = await environment(t);
  env.runtimeEnv.FIXTURE_STOP_WAIT_MS = "300";
  await startEnvironment(env);
  const controller = new AbortController();
  const pending = stopEnvironment(env, { signal: controller.signal });
  const rejected = assert.rejects(pending, (error) => error.exitCode === 130);
  const deadline = Date.now() + env.timeouts.stopSeconds * 1000;
  while (Date.now() < deadline) {
    const record = await readFile(
      join(env.paths.run, env.files.processIdentity),
      "utf8",
    ).then(JSON.parse, () => null);
    if (record?.phase === "stopping") break;
    await delay(env.timeouts.pollMs);
  }
  controller.abort();
  await rejected;
  assert.equal(
    (await getEnvironmentStatus(env, { probe: false })).state,
    "stopped",
  );
});

test("aborting startup during component readiness reclaims its process group", async (t) => {
  const env = await environment(t);
  await writeFile(join(env.root, "config/nginx/hold"), "hold");
  const controller = new AbortController();
  const started = startEnvironment(env, { signal: controller.signal });
  const rejected = assert.rejects(started, (error) => error.exitCode === 130);
  const deadline = Date.now() + env.timeouts.startSeconds * 1000;
  while (Date.now() < deadline) {
    const record = await readFile(
      join(env.paths.run, env.files.processIdentity),
      "utf8",
    ).then(JSON.parse, () => null);
    if (record?.components.api) break;
    await delay(env.timeouts.pollMs);
  }
  controller.abort();
  await rejected;
  assert.equal(
    (await getEnvironmentStatus(env, { probe: false })).state,
    "stopped",
  );
});

test("changed gateway or session cookie settings require restarting the running environment", async (t) => {
  const env = await environment(t);
  const started = await startEnvironment(env);
  for (const changed of [
    { ...env, gatewayListenHost: "0.0.0.0" },
    { ...env, hostAliases: [...env.hostAliases, "other.local"] },
    { ...env, sessionCookieName: "another_session" },
    { ...env, sessionCookieSecure: true },
  ]) {
    const status = await getEnvironmentStatus(changed, { probe: false });
    assert.equal(status.state, "degraded");
    assert.equal(status.configurationChanged, true);
    await assert.rejects(
      startEnvironment(changed),
      (error) => error.exitCode === 4,
    );
    assert.equal(status.components.api.pid, started.components.api.pid);
  }
  assert.equal((await getEnvironmentStatus(env)).state, "running");
});

test("changed configuration requires restart while stop still uses the recorded ports", async (t) => {
  const env = await environment(t);
  await mkdir(env.paths.config, { recursive: true });
  await writeFile(env.paths.applicationEnv, "ENABLE_WEBSOCKET=true\n");
  await writeFile(env.paths.secretsEnv, "AUTH_API_KEYS=test-private-key\n", {
    mode: 0o600,
  });
  const started = await startEnvironment(env);
  await writeFile(env.paths.applicationEnv, "ENABLE_WEBSOCKET=false\n");
  await writeFile(
    env.paths.secretsEnv,
    "AUTH_API_KEYS=replaced-private-key\n",
    { mode: 0o600 },
  );
  assert.equal(
    (await getEnvironmentStatus(env, { probe: false })).state,
    "degraded",
  );
  await assert.rejects(startEnvironment(env), (error) => error.exitCode === 4);
  const previousPort = env.ports.api;
  env.ports.api = await freePort();
  env.tools.node.version = "changed-version";
  assert.equal((await stopEnvironment(env)).state, "stopped");
  assert.equal(
    await fetch(`http://127.0.0.1:${previousPort}/health`).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.doesNotMatch(
    await readFile(
      join(env.paths.operations, started.startId, "database-status.json"),
      "utf8",
    ),
    /test-private-key|replaced-private-key/,
  );
});

test("concurrent starts preserve one environment identity and do not create duplicate components", async (t) => {
  const env = await environment(t);
  const results = await Promise.allSettled([
    startEnvironment(env),
    startEnvironment(env),
  ]);
  const completed = results.filter((result) => result.status === "fulfilled");
  assert.ok(completed.length >= 1);
  for (const result of results) {
    if (result.status === "rejected") assert.equal(result.reason.exitCode, 4);
    else
      assert.equal(
        result.value.components.api.pid,
        completed[0].value.components.api.pid,
      );
  }
  assert.equal((await getEnvironmentStatus(env)).state, "running");
});

test("force stop reclaims known process groups after the runner is killed", async (t) => {
  const env = await environment(t);
  env.runtimeEnv.FIXTURE_CHILD = "true";
  const started = await startEnvironment(env);
  process.kill(started.components.runner.pid, "SIGKILL");
  await delay(100);
  try {
    assert.equal(
      (await stopEnvironment(env, { force: true })).state,
      "stopped",
    );
  } finally {
    try {
      process.kill(-started.components.runner.pgid, "SIGKILL");
    } catch (error) {
      assert.equal(error.code, "ESRCH");
    }
  }
});

test("development starts three frontends with environment HMR ports and isolates API secrets", async (t) => {
  const env = await environment(t);
  env.mode = "development";
  const api = join(env.root, "apps/api");
  await mkdir(join(api, "src/db"), { recursive: true });
  await writeFile(join(api, "package.json"), '{"type":"module"}');
  await copyFile(
    join(fixtures, "process-watch-api.mjs"),
    join(api, "src/index.ts"),
  );
  await mkdir(join(env.root, "packages/shared"), { recursive: true });
  const sharedSource = join(env.root, "packages/shared/watch-source.mjs");
  await writeFile(sharedSource, "export const watchValue = 'initial';\n");
  await copyFile(
    join(fixtures, "process-api.mjs"),
    join(api, "src/db/environment-command.ts"),
  );
  await symlink(
    fileURLToPath(new URL("../../node_modules", import.meta.url)),
    join(env.root, "node_modules"),
  );
  await copyFile(join(fixtures, "process-vite.mjs"), join(env.root, "pnpm"));
  await chmod(join(env.root, "pnpm"), 0o700);
  env.tools.pnpm.path = join(env.root, "pnpm");
  for (const frontend of env.frontends)
    await mkdir(join(env.root, "apps", frontend), { recursive: true });
  const started = await startEnvironment(env);
  assert.equal(started.state, "running");
  for (const frontend of env.frontends) {
    const response = await fetch(
      `http://127.0.0.1:${env.ports.frontends[frontend].dev}/`,
    );
    assert.deepEqual(await response.json(), {
      environment: "dev",
      hmrHost: env.hostname,
      allowedHosts: [
        env.hostname,
        "127.0.0.1",
        "localhost",
        "tavern.local",
      ],
      hmrPort: env.ports.frontends[frontend].http,
      secretPresent: false,
    });
  }
  assert.equal(
    (await (await fetch(`http://127.0.0.1:${env.ports.api}/health`)).json())
      .watchValue,
    "initial",
  );
  await writeFile(sharedSource, "export const watchValue = 'updated';\n");
  let watchedValue;
  const deadline = Date.now() + env.timeouts.startSeconds * 1000;
  while (Date.now() < deadline) {
    watchedValue = await fetch(`http://127.0.0.1:${env.ports.api}/health`)
      .then((response) => response.json())
      .then(
        (value) => value.watchValue,
        () => undefined,
      );
    if (watchedValue === "updated") break;
    await delay(env.timeouts.pollMs);
  }
  assert.equal(watchedValue, "updated");
  assert.equal(
    (await getEnvironmentStatus(env)).components.api.pid,
    started.components.api.pid,
  );
  assert.equal((await stopEnvironment(env)).state, "stopped");
});

for (const failedComponent of ["api", "nginx"]) {
  test(`a running ${failedComponent} exit preserves other components until manual restart`, async (t) => {
    const env = await environment(t, "staging");
    const other = await environment(t, "prod");
    const started = await startEnvironment(env);
    const otherStarted = await startEnvironment(other);
    process.kill(started.components[failedComponent].pid, "SIGTERM");
    let status;
    const deadline = Date.now() + env.timeouts.stopSeconds * 1000;
    do {
      status = await getEnvironmentStatus(env, { probe: false });
      if (!status.components[failedComponent]?.alive) break;
      await delay(env.timeouts.pollMs);
    } while (Date.now() < deadline);
    assert.equal(status.state, "degraded");
    assert.equal(status.components[failedComponent].alive, false);
    const surviving = failedComponent === "api" ? "nginx" : "api";
    assert.equal(status.components[surviving].alive, true);
    assert.equal(
      status.components[surviving].pid,
      started.components[surviving].pid,
    );
    const survivorUrl =
      failedComponent === "api"
        ? `http://127.0.0.1:${env.ports.frontends.web.http}/healthz`
        : `http://127.0.0.1:${env.ports.api}/health`;
    assert.equal(
      (await fetch(survivorUrl)).status,
      failedComponent === "api" ? 204 : 200,
    );
    const otherAfter = await getEnvironmentStatus(other);
    assert.equal(otherAfter.state, "running");
    assert.equal(otherAfter.startId, otherStarted.startId);
    await assert.rejects(
      startEnvironment(env),
      (error) => error.exitCode === 4,
    );
    assert.equal((await stopEnvironment(env)).state, "stopped");
    const restarted = await startEnvironment(env);
    assert.equal(restarted.state, "running");
    assert.notEqual(restarted.startId, started.startId);
    const record = JSON.parse(await readFile(restarted.recordPath, "utf8"));
    assert.deepEqual(record.exits, {});
  });
}

test("a failed environment start cleans its processes and leaves another environment running", async (t) => {
  const first = await environment(t, "staging");
  const second = await environment(t, "prod");
  const firstStarted = await startEnvironment(first);
  await writeFile(join(second.root, "config/nginx/fail"), "fail");
  let failure;
  await assert.rejects(startEnvironment(second), (error) => {
    failure = error;
    return error.exitCode === 7;
  });
  const failedStatus = await getEnvironmentStatus(second, { probe: false });
  assert.equal(
    failedStatus.state,
    "stopped",
    JSON.stringify({ failure: failure.details, failedStatus }),
  );
  const firstAfter = await getEnvironmentStatus(first);
  assert.equal(firstAfter.state, "running");
  assert.equal(firstAfter.components.api.pid, firstStarted.components.api.pid);
  assert.equal(
    (await fetch(`http://127.0.0.1:${first.ports.api}/health`)).status,
    200,
  );
});

test("changed start times are rejected before any signal is sent", async (t) => {
  const env = await environment(t);
  const started = await startEnvironment(env);
  const original = await readFile(started.recordPath, "utf8");
  const changed = JSON.parse(original);
  changed.components.api.startTime = "simulated-reused-pid";
  await writeFile(started.recordPath, JSON.stringify(changed));
  try {
    assert.equal((await getEnvironmentStatus(env)).state, "identity-conflict");
    await assert.rejects(
      stopEnvironment(env, { force: true }),
      (error) => error.exitCode === 4,
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${env.ports.api}/health`)).status,
      200,
    );
  } finally {
    await writeFile(started.recordPath, original);
  }
});

test("unmanaged port owners are reported as identity conflicts and are preserved by stop", async (t) => {
  const env = await environment(t);
  const child = spawn(process.execPath, [join(fixtures, "process-api.mjs")], {
    env: env.runtimeEnv,
    stdio: "ignore",
  });
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        await fetch(`http://127.0.0.1:${env.ports.api}/health`).then(
          () => true,
          () => false,
        )
      )
        break;
      await delay(20);
    }
    assert.equal((await getEnvironmentStatus(env)).state, "identity-conflict");
    await assert.rejects(
      stopEnvironment(env, { force: true }),
      (error) => error.exitCode === 4,
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${env.ports.api}/health`)).status,
      200,
    );
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
});

test("release start and stop are repeatable and keep API secrets out of process logs", async (t) => {
  const env = await environment(t);
  assert.equal((await getEnvironmentStatus(env)).state, "stopped");
  const first = await startEnvironment(env);
  assert.equal(first.state, "running");
  const second = await startEnvironment(env);
  assert.equal(second.components.api.pid, first.components.api.pid);
  assert.equal(
    (await getEnvironmentStatus(env, { probe: false })).health,
    "not-checked",
  );
  assert.doesNotMatch(
    await readFile(join(env.paths.processLogs, "api.log"), "utf8"),
    /test-private-key/,
  );
  assert.equal((await stopEnvironment(env)).state, "stopped");
  assert.equal((await stopEnvironment(env)).state, "stopped");
  const restarted = await startEnvironment(env);
  assert.equal(restarted.state, "running");
  assert.notEqual(restarted.components.api.pid, first.components.api.pid);
});
