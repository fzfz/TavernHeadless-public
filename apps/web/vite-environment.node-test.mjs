import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfigFromFile } from "vite";
import { request } from "node:http";
import { createServer as createPortReservation } from "node:net";

test("all installed Vite servers load approved Hosts and reject unknown Hosts", async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    TAVERN_ENVIRONMENT: "dev",
    TAVERN_VITE_HOST: "127.0.0.1",
    TAVERN_VITE_PORT: "0",
    TAVERN_HMR_HOST: "192.0.2.31",
    TAVERN_HMR_PORT: "4800",
    TAVERN_ALLOWED_HOSTS: JSON.stringify([
      "192.0.2.31",
      "127.0.0.1",
      "localhost",
      "tavern.local",
    ]),
  });
  try {
    for (const application of ["web", "user-web", "studio"])
      await t.test(application, async () => {
        const reservation = createPortReservation();
        await new Promise((resolve) =>
          reservation.listen(0, "127.0.0.1", resolve),
        );
        process.env.TAVERN_VITE_PORT = String(reservation.address().port);
        await new Promise((resolve) => reservation.close(resolve));
        const root = fileURLToPath(
          new URL(`../${application}/`, import.meta.url),
        );
        const { createServer } = await import(
          new URL(
            `../${application}/node_modules/vite/dist/node/index.js`,
            import.meta.url,
          )
        );
        const server = await createServer({
          root,
          configFile: `${root}vite.config.ts`,
          logLevel: "silent",
          server: { preTransformRequests: false },
          optimizeDeps: { noDiscovery: true, include: [] },
        });
        try {
          await server.listen();
          const address = server.httpServer.address();
          assert.equal(address.address, "127.0.0.1");
          const responseForHost = (host) =>
            new Promise((resolve, reject) => {
              const req = request(
                {
                  hostname: "127.0.0.1",
                  port: address.port,
                  path: "/",
                  headers: { Host: `${host}:${address.port}` },
                  agent: false,
                  timeout: 3000,
                },
                (response) => {
                  let body = "";
                  response.setEncoding("utf8");
                  response.on("data", (chunk) => {
                    body += chunk;
                  });
                  response.on("end", () =>
                    resolve({ status: response.statusCode, body }),
                  );
                },
              );
              req.on("error", reject);
              req.on("timeout", () =>
                req.destroy(new Error("Vite request timed out")),
              );
              req.end();
            });
          for (const host of [
            "192.0.2.31",
            "127.0.0.1",
            "localhost",
            "tavern.local",
          ]) {
            const response = await responseForHost(host);
            assert.equal(
              response.status,
              200,
              `${application}: ${host} ${response.body}`,
            );
            assert.match(response.body, /<!doctype html>/i);
          }
          assert.equal(
            (await responseForHost("unknown.tavern.invalid")).status,
            403,
          );
        } finally {
          await server.close();
        }
      });
  } finally {
    process.env = previous;
  }
});

test("all development frontends use the environment listener and public HMR endpoint", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    TAVERN_ENVIRONMENT: "dev",
    TAVERN_VITE_HOST: "127.0.0.1",
    TAVERN_VITE_PORT: "4820",
    TAVERN_HMR_HOST: "192.0.2.31",
    TAVERN_ALLOWED_HOSTS: JSON.stringify([
      "192.0.2.31",
      "127.0.0.1",
      "localhost",
      "tavern.local",
    ]),
    TAVERN_HMR_PORT: "4800",
  });
  try {
    for (const application of ["web", "user-web", "studio"]) {
      const root = fileURLToPath(
        new URL(`../${application}/`, import.meta.url),
      );
      const result = await loadConfigFromFile(
        { command: "serve", mode: "development" },
        `${root}vite.config.ts`,
        root,
      );
      assert.ok(result, application);
      assert.equal(result.config.appType, "mpa", application);
      assert.equal(result.config.server.port, 4820, application);
      assert.equal(result.config.server.host, "127.0.0.1", application);
      assert.equal(result.config.server.strictPort, true, application);
      assert.equal(
        result.config.server.hmr.host,
        "192.0.2.31",
        application,
      );
      assert.equal(result.config.server.hmr.clientPort, 4800, application);
      assert.deepEqual(
        result.config.server.allowedHosts,
        ["192.0.2.31", "127.0.0.1", "localhost", "tavern.local"],
        application,
      );
      assert.ok(
        result.config.resolve.conditions.includes("development"),
        application,
      );
      assert.equal(result.config.server.proxy, undefined, application);
    }
  } finally {
    process.env = previous;
  }
});
