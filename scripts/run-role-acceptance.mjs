import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/api/dist/app.js";
import { loadConfig } from "../apps/api/dist/config.js";
import {
  roleAcceptanceConfigSchema,
  roleAcceptanceCredentialsSchema,
  roleAcceptanceBindingsSchema,
} from "./role-acceptance.schema.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const acceptance = roleAcceptanceConfigSchema.parse(
  await json(process.argv[2]),
);
const credentials = roleAcceptanceCredentialsSchema.parse(
  await json(acceptance.credentialsFile),
);
const bindings = roleAcceptanceBindingsSchema.parse(
  await json(resolve(acceptance.fixturesRoot, "bindings.json")),
);
Object.assign(process.env, {
  DATA_DIR: acceptance.dataRoot,
  DATABASE_URL: "",
  APP_SECRETS_MASTER_KEY: (
    await readFile(acceptance.masterKeyFile, "utf8")
  ).trim(),
  LLM_API_KEY: credentials.apiKey,
  LLM_BASE_URL: credentials.baseUrl,
  LLM_MODEL: credentials.narratorModel,
  LLM_PROVIDER: "openai-compatible",
  OPENAI_API_MODE: "chat",
  LLM_DEFAULT_TIMEOUT_MS: String(bindings.modelTimeoutMs),
  ENABLE_SSE_CHAT: "true",
  AUTH_MODE: "off",
  ACCOUNT_MODE: "single",
  CORS_ORIGINS: `http://127.0.0.1:${acceptance.adminPort},http://127.0.0.1:${acceptance.userPort}`,
});
const config = loadConfig();
const { app } = await buildApp({ ...config, logger: false });
const servers = [];
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
async function serve(directory, port, overrides) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (Object.hasOwn(overrides, path)) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(overrides[path]));
        return;
      }
      const file = resolve(
        directory,
        "." + (path === "/" ? "/index.html" : path),
      );
      if (!file.startsWith(directory + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      let target = file;
      try {
        if (!(await stat(file)).isFile()) throw new Error("Not a file");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (extname(path)) {
          res.writeHead(404);
          res.end();
          return;
        }
        target = resolve(directory, "index.html");
      }
      const body = await readFile(target);
      res.writeHead(200, {
        "Content-Type": mime[extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  servers.push(server);
}
try {
  await app.listen({ host: "127.0.0.1", port: acceptance.apiPort });
  await serve(resolve(root, "apps/web/dist"), acceptance.adminPort, {
    "/config/role-apps.json": {
      userWebBaseUrl: `http://127.0.0.1:${acceptance.userPort}`,
    },
  });
  await serve(resolve(root, "apps/user-web/dist"), acceptance.userPort, {
    "/config/application.json": {
      apiBaseUrl: `http://127.0.0.1:${acceptance.apiPort}`,
      adminBaseUrl: `http://127.0.0.1:${acceptance.adminPort}`,
    },
  });
  console.log(
    JSON.stringify({
      api: acceptance.apiPort,
      admin: acceptance.adminPort,
      user: acceptance.userPort,
      dataRoot: acceptance.dataRoot,
    }),
  );
} catch (error) {
  await app.close();
  for (const server of servers) server.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    for (const server of servers) server.close();
    await app.close();
    process.exit(0);
  });
