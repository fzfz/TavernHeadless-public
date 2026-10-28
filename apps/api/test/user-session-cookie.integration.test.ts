import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTestApp } from "./helpers/create-test-db.js";
import type { BuildAppOptions } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
});

async function start(options: BuildAppOptions = {}) {
  const { app } = await buildTestApp({
    databasePath: ":memory:",
    logger: false,
    accountMode: "multi",
    auth: { mode: "api_key", apiKeys: ["admin-key"] },
    ...options,
  });
  apps.push(app);
  return app;
}

const account = {
  name: "林远",
  email: "lin@example.com",
  password: "correct horse battery",
};

async function login(app: FastifyInstance, cookie?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    headers: cookie ? { cookie } : {},
    payload: account,
  });
  expect(response.statusCode, response.body).toBe(200);
  return String(response.headers["set-cookie"]);
}

async function register(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: account,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data.id as string;
}

async function current(app: FastifyInstance, cookie: string) {
  return app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
}

describe("browser session cookie HTTP", () => {
  it.each([
    { nodeEnv: "test", setting: undefined, secure: false },
    { nodeEnv: "production", setting: undefined, secure: true },
    { nodeEnv: "test", setting: "true", secure: true },
  ])(
    "uses Secure=$secure for HTTP in $nodeEnv with setting $setting",
    async ({ nodeEnv, setting, secure }) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("USER_SESSION_COOKIE_NAME", undefined);
      vi.stubEnv("USER_SESSION_COOKIE_SECURE", setting);
      const app = await start();
      await register(app);

      const setCookie = await login(app);
      expect(setCookie).toMatch(/^tavern_session=/);
      expect(/; Secure(?:;|$)/.test(setCookie)).toBe(secure);
      const logout = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { cookie: setCookie.split(";")[0]! },
      });
      expect(logout.statusCode, logout.body).toBe(200);
      expect(/; Secure(?:;|$)/.test(String(logout.headers["set-cookie"]))).toBe(
        secure,
      );
      expect(logout.headers["set-cookie"]).toContain("tavern_session=;");
    },
  );

  it("isolates login, session rotation and logout for two environments in the same Cookie header", async () => {
    const dev = await start({
      userSessionCookie: { name: "tavern_dev_session", secure: false },
    });
    const staging = await start({
      userSessionCookie: { name: "tavern_staging_session", secure: false },
    });
    const devId = await register(dev);
    const stagingId = await register(staging);
    const devCookie = (await login(dev)).split(";")[0]!;
    const stagingCookie = (await login(staging)).split(";")[0]!;
    expect(devCookie).toMatch(/^tavern_dev_session=.+/);
    expect(stagingCookie).toMatch(/^tavern_staging_session=.+/);

    const shared = `tavern_session=stale; ${stagingCookie}; ${devCookie}`;
    const devMe = await current(dev, shared);
    const stagingMe = await current(staging, shared);
    expect(devMe.statusCode, devMe.body).toBe(200);
    expect(stagingMe.statusCode, stagingMe.body).toBe(200);
    expect(devMe.json().data.id).toBe(devId);
    expect(stagingMe.json().data.id).toBe(stagingId);
    for (const [app, name] of [
      [dev, "tavern_dev_session"],
      [staging, "tavern_staging_session"],
    ] as const) {
      const specification = await app.inject({
        method: "GET",
        url: "/openapi.json",
      });
      expect(specification.statusCode, specification.body).toBe(200);
      expect(
        specification.json().components.securitySchemes.BrowserSessionAuth,
      ).toMatchObject({
        type: "apiKey",
        in: "cookie",
        name,
      });
    }
    expect((await current(dev, stagingCookie)).statusCode).toBe(401);
    expect((await current(staging, devCookie)).statusCode).toBe(401);

    const rotatedDevCookie = (await login(dev, shared)).split(";")[0]!;
    expect((await current(dev, shared)).statusCode).toBe(401);
    expect((await current(staging, shared)).statusCode).toBe(200);
    const rotatedShared = `${rotatedDevCookie}; ${stagingCookie}`;
    expect((await current(dev, rotatedShared)).statusCode).toBe(200);

    const logout = await dev.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: rotatedShared },
    });
    expect(logout.statusCode, logout.body).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("tavern_dev_session=;");
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect((await current(dev, rotatedShared)).statusCode).toBe(401);
    expect((await current(staging, rotatedShared)).statusCode).toBe(200);
  }, 20_000);

  it("sets and clears a non-Secure cookie for explicitly configured HTTP production access", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "api_key");
    vi.stubEnv("AUTH_API_KEYS", "admin-key");
    vi.stubEnv("USER_SESSION_COOKIE_NAME", "tavern_http_session");
    vi.stubEnv("USER_SESSION_COOKIE_SECURE", "false");
    const app = await start({
      userSessionCookie: loadConfig().userSessionCookie,
    });
    await register(app);

    const setCookie = await login(app);
    expect(setCookie).toMatch(/^tavern_http_session=/);
    expect(setCookie).toContain("Path=/; HttpOnly; SameSite=Lax; Max-Age=");
    expect(setCookie).not.toMatch(/; Secure(?:;|$)/);
    const cookie = setCookie.split(";")[0]!;
    expect((await current(app, cookie)).statusCode).toBe(200);
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
    });
    expect(logout.headers["set-cookie"]).not.toMatch(/; Secure(?:;|$)/);
    expect(logout.headers["set-cookie"]).toContain("tavern_http_session=;");
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
  });
});
