const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const root = process.env.USER_WEB_DATA_DIR;
if (!root)
  throw new Error(
    "Set USER_WEB_DATA_DIR to the isolated server fixture directory before running browser acceptance.",
  );
const baseURL = (process.env.USER_WEB_URL || "http://127.0.0.1:4190").replace(
  /\/$/,
  "",
);
const origin = new URL(baseURL).origin;
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "fixture.json"), "utf8"),
);
const apiURL = (process.env.USER_WEB_API_URL || fixture.apiUrl).replace(
  /\/$/,
  "",
);

async function seedHistory(count, label) {
  const credentials = {
    email: `history-${label}-${randomUUID()}@example.test`,
    password: "History-2026!",
  };
  let cookie = "";
  async function call(method, route, data) {
    const response = await fetch(apiURL + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const nextCookie = response.headers.get("set-cookie");
    if (nextCookie) cookie = nextCookie.split(";")[0];
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        `${method} ${route}: ${response.status} ${JSON.stringify(body)}`,
      );
    return body.data;
  }
  await call("POST", "/auth/register", { ...credentials, name: "历史验收" });
  await call("POST", "/auth/login", credentials);
  const personas = [];
  for (const name of ["沈观澜", "陆知行"])
    personas.push(
      await call("POST", "/users", {
        snapshot: {
          name,
          description: `${name}，二十七岁，夜间档案员，细心谨慎。`,
        },
      }),
    );
  const role = fixture.roles.find((item) => item.mode === "system_chat");
  if (!role)
    throw new Error("The isolated fixture must publish a system_chat role.");
  const sessions = [];
  for (let index = 0; index < count; index++) {
    const result = await call("POST", `/public/roles/${role.id}/sessions`, {
      user_id: personas[index === count - 1 ? 1 : 0].id,
      opening_id: "first",
      operation_id: `history-${label}-${index}`,
    });
    sessions.push(
      await call("PATCH", `/sessions/${result.session.id}`, {
        title: `历史验收 ${String(index + 1).padStart(2, "0")}`,
      }),
    );
  }
  const seeded = { credentials, personas, sessions, apiUrl: apiURL };
  fs.writeFileSync(
    path.join(root, `history-${label}-fixture.json`),
    JSON.stringify(seeded, null, 2),
  );
  return seeded;
}
async function ensureEmptyApi() {
  const url = process.env.USER_WEB_EMPTY_API_URL || "http://127.0.0.1:4314";
  let child;
  try {
    await fetch(url + "/health");
  } catch {
    child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(__dirname, "empty-server.ts")],
      {
        cwd: path.resolve(__dirname, "../../.."),
        env: { ...process.env, USER_WEB_EMPTY_API_PORT: new URL(url).port },
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null)
        throw new Error(`Empty API exited with status ${child.exitCode}.`);
      try {
        if ((await fetch(url + "/health")).ok) break;
      } catch {
        /* Startup is still in progress. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const catalogue = await (await fetch(url + "/public/roles")).json();
  if (catalogue.meta.total !== 0)
    throw new Error(
      "USER_WEB_EMPTY_API_URL must point to an API with no published roles.",
    );
  return { url, close: () => child?.kill("SIGTERM") };
}
async function launchNativeChrome(chromium) {
  const profile = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "user-web-chrome-"),
  );
  const executable =
    process.env.USER_WEB_CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const child = spawn(
    executable,
    [
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; !fs.existsSync(portFile) && attempt < 100; attempt++) {
    if (child.exitCode !== null)
      throw new Error(
        "Chrome exited before opening its debug port. Set USER_WEB_CHROME_PATH to the installed Chrome executable.",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
  const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, {
    noDefaults: true,
  });
  return {
    browser,
    close: async () => {
      await browser.close();
      if (child.exitCode === null && child.signalCode === null)
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill("SIGTERM");
        });
      fs.rmSync(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}
module.exports = {
  launchNativeChrome,
  root,
  baseURL,
  origin,
  apiURL,
  fixture,
  seedHistory,
  ensureEmptyApi,
};
