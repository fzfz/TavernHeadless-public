import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer, request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { generateNginxConfig, writeNginxConfig } from "./nginx.mjs";

function environment(root, mode = "development") {
  return {
    name: "dev",
    mode,
    hostname: "192.0.2.31",
    listenHost: "127.0.0.1",
    gatewayListenHost: "0.0.0.0",
    hostAliases: ["127.0.0.1", "localhost", "tavern.local"],
    frontends: ["web", "user-web", "studio"],
    uploadMaxBytes: 83886080,
    publicFiles: {
      web: ["role-apps.json"],
      "user-web": ["application.json", "runtime-policy.json"],
      studio: [],
    },
    timeouts: { proxySeconds: 3600 },
    ports: {
      api: 4010,
      frontends: {
        web: { http: 4000, dev: 4020 },
        "user-web": { http: 4001, dev: 4021 },
        studio: { http: 4002, dev: 4022 },
      },
    },
    paths: {
      nginxConfig: join(root, "config/nginx/nginx.conf"),
      publicConfig: join(root, "config/public"),
      current: join(root, "current"),
      run: join(root, "run"),
      processLogs: join(root, "logs/processes"),
    },
  };
}

test("development Nginx preserves Vite pages and returns 404 for missing resources", async (t) => {
  const executable = process.env.TAVERN_TEST_NGINX || "nginx";
  try {
    await promisify(execFile)(executable, ["-v"]);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Nginx is not installed");
      return;
    }
    throw error;
  }
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "tavern-nginx-vite-assets-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "frontend"));
  await writeFile(
    join(root, "frontend/index.html"),
    "<!doctype html><html><body>Vite page</body></html>",
  );
  await writeFile(
    join(root, "frontend/main.js"),
    "import './style.css'; export const value = 42;",
  );
  await writeFile(join(root, "frontend/style.css"), "body { color: red; }");
  const { createServer: createViteServer } =
    await import("../../apps/web/node_modules/vite/dist/node/index.js");
  const viteReservation = createServer();
  await new Promise((resolve) =>
    viteReservation.listen(0, "127.0.0.1", resolve),
  );
  const vitePort = viteReservation.address().port;
  await new Promise((resolve) => viteReservation.close(resolve));
  const vite = await createViteServer({
    root: join(root, "frontend"),
    configFile: false,
    appType: "mpa",
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: vitePort,
      strictPort: true,
      preTransformRequests: false,
    },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  await vite.listen();
  const api = createHttpServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ accept: req.headers.accept, host: req.headers.host }),
    );
  });
  t.after(() => new Promise((resolve) => api.close(resolve)));
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const env = environment(root);
  env.ports.api = api.address().port;
  for (const ports of Object.values(env.ports.frontends)) {
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    ports.http = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    ports.dev = vite.httpServer.address().port;
  }
  await writeNginxConfig(env);
  const child = spawn(
    executable,
    ["-p", `${env.paths.run}/`, "-c", env.paths.nginxConfig],
    { stdio: "ignore" },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGQUIT");
    await closed;
  });
  const deadline = Date.now() + 3000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    ready = await fetch(
      `http://127.0.0.1:${env.ports.frontends.web.http}/healthz`,
    ).then(
      (r) => r.status === 204,
      () => false,
    );
    if (!ready) await delay(25);
  }
  assert.equal(ready, true);
  for (const ports of Object.values(env.ports.frontends)) {
    const origin = `http://127.0.0.1:${ports.http}`;
    for (const path of ["/", "/editor/verification"]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      assert.match(await response.text(), /Vite page/);
    }
    const head = await fetch(origin + "/editor/verification", {
      method: "HEAD",
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    for (const options of [
      { method: "POST", headers: { accept: "text/html" } },
      { method: "GET", headers: { accept: "application/json" } },
    ]) {
      const response = await fetch(origin + "/editor/verification", options);
      assert.equal(response.status, 404, JSON.stringify(options));
      await response.text();
    }
    for (const path of ["/main.js", "/@vite/client"]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /javascript/);
      await response.text();
    }
    for (const [accept, contentType] of [
      ["text/css,*/*;q=0.1", /text\/css/],
      ["*/*", /javascript/],
    ]) {
      const response = await fetch(origin + "/style.css", {
        headers: { accept },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), contentType, accept);
      const body = await response.text();
      assert.match(body, /color:\s*red/);
      if (accept === "*/*") assert.match(body, /updateStyle/);
      else assert.doesNotMatch(body, /updateStyle/);
    }
    for (const path of [
      "/assets/missing.js",
      "/assets/missing",
      "/missing.css",
      "/missing.png",
    ]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 404, path);
      assert.doesNotMatch(await response.text(), /Vite page/);
    }
    const apiResponse = await fetch(origin + "/api/export.json", {
      headers: { accept: "application/json" },
    });
    assert.deepEqual(await apiResponse.json(), {
      accept: "application/json",
      host: `127.0.0.1:${ports.http}`,
    });
  }
});

test("installed Nginx accepts canonical and alias Hosts and closes other Hosts", async (t) => {
  const executable = process.env.TAVERN_TEST_NGINX || "nginx";
  try {
    await promisify(execFile)(executable, ["-v"]);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Nginx is not installed");
      return;
    }
    throw error;
  }
  const root = await mkdtemp(join(tmpdir(), "tavern-nginx-hosts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = environment(root, "release");
  for (const ports of Object.values(env.ports.frontends)) {
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    ports.http = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
  }
  await writeNginxConfig(env);
  const child = spawn(
    executable,
    ["-p", `${env.paths.run}/`, "-c", env.paths.nginxConfig],
    { stdio: "ignore" },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGQUIT");
    await closed;
  });
  const requestHost = (port, host) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/healthz",
          headers: { Host: host },
          agent: false,
          timeout: 500,
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on("error", reject);
      req.on("timeout", () =>
        req.destroy(new Error("Nginx request timed out")),
      );
      req.end();
    });
  let ready = false;
  const deadline = Date.now() + 3000;
  while (!ready && Date.now() < deadline) {
    ready = await requestHost(env.ports.frontends.web.http, env.hostname).then(
      (status) => status === 204,
      () => false,
    );
    if (!ready) await delay(25);
  }
  assert.equal(ready, true, "Nginx must serve its canonical Host");
  for (const ports of Object.values(env.ports.frontends)) {
    for (const host of [
      env.hostname,
      "127.0.0.1",
      "localhost",
      "tavern.local",
    ])
      assert.equal(await requestHost(ports.http, `${host}:${ports.http}`), 204);
    await assert.rejects(requestHost(ports.http, "unexpected.invalid"), {
      code: "ECONNRESET",
    });
  }
});

test("installed Nginx accepts the generated release configuration", async (t) => {
  const executable = process.env.TAVERN_TEST_NGINX || "nginx";
  try {
    await promisify(execFile)(executable, ["-v"]);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Nginx is not installed");
      return;
    }
    throw error;
  }
  const root = await mkdtemp(join(tmpdir(), "tavern-nginx-syntax-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = environment(root, "release");
  await writeNginxConfig(env);
  await promisify(execFile)(executable, [
    "-t",
    "-p",
    `${env.paths.run}/`,
    "-c",
    env.paths.nginxConfig,
  ]);
});

test("release serves SPA routes while missing assets return 404 and runtime configuration bypasses caches", () => {
  const env = environment("/tmp/tavern-nginx-release", "release");
  const config = generateNginxConfig(env);
  for (const frontend of ["web", "user-web", "studio"]) {
    assert.ok(
      config.includes(`root "/tmp/tavern-nginx-release/current/${frontend}";`),
    );
  }
  assert.match(config, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.match(config, /location ~\* \\\.[^\n]+try_files \$uri =404;/);
  assert.ok(config.includes("location ^~ /api/ {"));
  assert.ok(config.includes("location ^~ /assets/ { try_files $uri =404;"));
  assert.ok(config.includes("location ^~ /config/ { return 404;"));
  assert.match(config, /location = \/config\/runtime-policy\.json/);
  assert.match(config, /location = \/config\/role-apps\.json/);
  assert.doesNotMatch(config, /proxy_pass http:\/\/127\.0\.0\.1:4020/);
});

test("development serves separate frontends and upgrades API and HMR connections", async () => {
  const root = await mkdtemp(join(tmpdir(), "tavern-nginx-"));
  try {
    const env = environment(root);
    const config = generateNginxConfig(env);
    for (const port of [4000, 4001, 4002]) {
      assert.match(
        config,
        new RegExp(`listen 0\\.0\\.0\\.0:${port} default_server;`),
      );
    }
    for (const port of [4020, 4021, 4022]) {
      assert.match(
        config,
        new RegExp(`proxy_pass http://127\\.0\\.0\\.1:${port};`),
      );
    }
    assert.match(
      config,
      /server_name 192\.0\.2\.31 127\.0\.0\.1 localhost tavern\.local;/,
    );
    assert.doesNotMatch(config, /listen 127\.0\.0\.1:/);
    assert.match(
      config,
      /location \^~ \/api\/ \{\s*proxy_pass http:\/\/127\.0\.0\.1:4010\//,
    );
    assert.match(config, /location = \/ws \{/);
    assert.match(config, /proxy_buffering off;/);
    assert.match(config, /proxy_cache off;/);
    assert.match(config, /proxy_http_version 1\.1;/);
    assert.match(config, /proxy_set_header Upgrade \$http_upgrade;/);
    assert.match(config, /proxy_set_header Connection \$connection_upgrade;/);
    assert.match(config, /proxy_read_timeout 3600s;/);
    assert.match(config, /client_max_body_size 83886080;/);
    assert.match(config, /location = \/config\/application\.json/);
    assert.match(config, /Cache-Control "no-store" always;/);
    assert.match(config, /daemon off;/);
    assert.match(config, /return 444;/);
    await writeNginxConfig(env);
    assert.equal(await readFile(env.paths.nginxConfig, "utf8"), config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
