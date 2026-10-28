import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTestApp } from "./helpers/create-test-db.js";
import { UserIdentityService } from "../src/services/user-identity-service.js";
import { randomUUID } from "node:crypto";

let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = undefined;
});

async function start() {
  ({ app } = await buildTestApp({
    databasePath: ":memory:",
    logger: false,
    accountMode: "multi",
    auth: {
      mode: "api_key",
      apiKeys: ["admin-key"],
      apiKeyAccountMap: { "admin-key": "default-admin" },
    },
  }));
  return app;
}

const alice = {
  name: "阿离",
  email: "Alice@Example.com",
  password: "correct horse battery",
};

async function registerAndLogin(
  api: FastifyInstance,
  email: string,
  name = "测试账号",
) {
  const payload = { name, email, password: alice.password };
  const registered = await api.inject({
    method: "POST",
    url: "/auth/register",
    payload,
  });
  expect(registered.statusCode, registered.body).toBe(201);
  const login = await api.inject({
    method: "POST",
    url: "/auth/login",
    payload,
  });
  expect(login.statusCode, login.body).toBe(200);
  return {
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
    id: registered.json().data.id as string,
  };
}

describe("user identity HTTP", () => {
  it("keeps single-account registration and account changes restricted", async () => {
    const built = await buildTestApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "single",
      auth: { mode: "api_key", apiKeys: ["admin-key"] },
    });
    app = built.app;
    for (const path of ["/auth/register", "/auth/login"]) {
      const response = await app.inject({
        method: "POST",
        url: path,
        payload: alice,
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe("account_mode_restricted");
    }
    const changed = await app.inject({
      method: "PATCH",
      url: "/auth/me",
      headers: { "x-api-key": "admin-key" },
      payload: { name: "账号名称" },
    });
    expect(changed.statusCode, changed.body).toBe(409);
    const service = new UserIdentityService(built.database);
    await service.register(alice);
    const session = await service.login(alice);
    const existingSession = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: `tavern_session=${session.token}` },
    });
    expect(existingSession.statusCode, existingSession.body).toBe(409);
    expect(existingSession.json().error.code).toBe("account_mode_restricted");
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: `tavern_session=${session.token}` },
    });
    expect(logout.statusCode, logout.body).toBe(200);
  });

  it("confirms the exact registration operation and safely repeats a saved request", async () => {
    const api = await start();
    const operationId = randomUUID();
    const payload = { ...alice, operation_id: operationId };
    const first = await api.inject({
      method: "POST",
      url: "/auth/register",
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);
    const resolved = await api.inject({
      method: "POST",
      url: "/auth/register/operations/resolve",
      payload: { operation_id: operationId },
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(resolved.json().data).toEqual({
      operation_id: operationId,
      status: "created",
    });
    const repeated = await api.inject({
      method: "POST",
      url: "/auth/register",
      payload,
    });
    expect(repeated.statusCode, repeated.body).toBe(201);
    expect(repeated.json().data.id).toBe(first.json().data.id);
    const mismatch = await api.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...payload, name: "另一份请求" },
    });
    expect(mismatch.statusCode, mismatch.body).toBe(409);
  });

  it("closes an unreceived registration before permitting a fresh submission", async () => {
    const api = await start();
    const operationId = randomUUID();
    const resolved = await api.inject({
      method: "POST",
      url: "/auth/register/operations/resolve",
      payload: { operation_id: operationId },
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(resolved.json().data.status).toBe("not_created");
    const late = await api.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...alice, operation_id: operationId },
    });
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json().error.code).toBe("auth_registration_closed");
    const fresh = await api.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...alice, operation_id: randomUUID() },
    });
    expect(fresh.statusCode, fresh.body).toBe(201);
  });

  it("cancels an accepted registration before password derivation completes", async () => {
    const built = await buildTestApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "api_key", apiKeys: ["admin-key"] },
    });
    app = built.app;
    const service = new UserIdentityService(built.database);
    const operationId = randomUUID();
    const pending = service
      .register({ ...alice, operationId })
      .catch((error: unknown) => error);
    const cancelled = await app.inject({
      method: "POST",
      url: "/auth/register/operations/resolve",
      payload: { operation_id: operationId },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().data.status).toBe("not_created");
    expect(await pending).toMatchObject({ code: "auth_registration_closed" });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: alice,
    });
    expect(login.statusCode).toBe(401);
  });

  it("persists a first default persona, user selection, deletion fallback and an empty library", async () => {
    const api = await start();
    const { cookie } = await registerAndLogin(api, "defaults@example.com");
    const create = async (name: string) => {
      const response = await api.inject({
        method: "POST",
        url: "/users",
        headers: { cookie },
        payload: { snapshot: { name, description: `${name}的完整描述` } },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().data.id as string;
    };
    const preference = async () =>
      (
        await api.inject({
          method: "GET",
          url: "/auth/preferences",
          headers: { cookie },
        })
      ).json().data.default_persona_id;
    const first = await create("林远");
    expect(await preference()).toBe(first);
    const second = await create("苏明");
    expect(await preference()).toBe(first);
    const selected = await api.inject({
      method: "PATCH",
      url: "/auth/preferences",
      headers: { cookie },
      payload: { default_persona_id: second },
    });
    expect(selected.statusCode, selected.body).toBe(200);
    expect(
      (
        await api.inject({
          method: "GET",
          url: "/auth/me",
          headers: { cookie },
        })
      ).json().data.default_persona_id,
    ).toBe(second);
    expect(
      (
        await api.inject({
          method: "DELETE",
          url: `/users/${second}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(await preference()).toBe(first);
    expect(
      (
        await api.inject({
          method: "DELETE",
          url: `/users/${first}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(await preference()).toBeNull();
  });
  it("isolates account data and persists profile changes and defaults across login sessions", async () => {
    const api = await start();
    const a = await registerAndLogin(api, "a@example.com");
    const b = await registerAndLogin(api, "b@example.com");
    const created = await api.inject({
      method: "POST",
      url: "/users",
      headers: { cookie: a.cookie },
      payload: {
        snapshot: {
          name: "裴修远",
          description: "裴修远，二十八岁，男性，行医的旅人，沉着细致。",
        },
      },
    });
    const personaId = created.json().data.id;
    expect(created.statusCode, created.body).toBe(201);
    const otherList = await api.inject({
      method: "GET",
      url: "/users",
      headers: { cookie: b.cookie, "x-account-id": a.id },
    });
    expect(otherList.json().data).toEqual([]);
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const result = await api.inject({
        method,
        url: `/users/${personaId}`,
        headers: { cookie: b.cookie },
        ...(method === "PATCH"
          ? { payload: { snapshot: { name: "不可访问" } } }
          : {}),
      });
      expect(result.statusCode, result.body).toBe(404);
    }
    const invalidDefault = await api.inject({
      method: "PATCH",
      url: "/auth/preferences",
      headers: { cookie: b.cookie },
      payload: { default_persona_id: personaId },
    });
    expect(invalidDefault.statusCode).toBe(404);
    const renamed = await api.inject({
      method: "PATCH",
      url: "/auth/me",
      headers: { cookie: a.cookie },
      payload: { name: "行者" },
    });
    expect(renamed.json().data.name).toBe("行者");
    expect(
      (
        await api.inject({
          method: "GET",
          url: "/auth/me",
          headers: { cookie: b.cookie },
        })
      ).json().data.name,
    ).toBe("测试账号");
    const logout = await api.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: a.cookie },
    });
    expect(logout.statusCode, logout.body).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect(
      (
        await api.inject({
          method: "GET",
          url: "/users",
          headers: { cookie: a.cookie },
        })
      ).statusCode,
    ).toBe(401);
    const again = await api.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "a@example.com", password: alice.password },
    });
    expect(again.json().data).toMatchObject({
      name: "行者",
      default_persona_id: personaId,
    });
  });

  it("rejects invalid credentials, duplicate email and cross-origin browser writes", async () => {
    const api = await start();
    const { cookie } = await registerAndLogin(api, "valid@example.com");
    const duplicate = await api.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...alice, email: "VALID@example.com" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    const invalid = await api.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "valid@example.com", password: "wrong password" },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().error.code).toBe("auth_invalid_credentials");
    const tooShort = await api.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...alice, password: "short" },
    });
    expect(tooShort.statusCode).toBe(400);
    for (const url of ["/auth/login", "/auth/logout"]) {
      const response = await api.inject({
        method: "POST",
        url,
        headers: { origin: "https://other.example", cookie },
        ...(url.endsWith("login")
          ? {
              payload: { email: "valid@example.com", password: alice.password },
            }
          : {}),
      });
      expect(response.statusCode, response.body).toBe(403);
    }
    const update = await api.inject({
      method: "PATCH",
      url: "/auth/me",
      headers: { origin: "https://other.example", cookie },
      payload: { name: "无效修改" },
    });
    expect(update.statusCode).toBe(403);
    expect(
      (
        await api.inject({
          method: "GET",
          url: "/auth/me",
          headers: { cookie },
        })
      ).json().data.name,
    ).toBe("测试账号");
  });

  it("expires browser sessions and rejects a disabled account", async () => {
    const api = await start();
    const { cookie, id } = await registerAndLogin(api, "expiry@example.com");
    const disabled = await api.inject({
      method: "PATCH",
      url: `/accounts/${id}`,
      headers: { "x-api-key": "admin-key" },
      payload: { status: "disabled" },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(
      (
        await api.inject({
          method: "GET",
          url: "/auth/me",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    const enabled = await api.inject({
      method: "PATCH",
      url: `/accounts/${id}`,
      headers: { "x-api-key": "admin-key" },
      payload: { status: "active" },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 8 * 24 * 60 * 60 * 1000);
    const expired = await api.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe("auth_session_expired");
  });

  it("restores identity, profile and default persona from the database after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-identity-"));
    try {
      const options = {
        databasePath: join(directory, "identity.db"),
        logger: false as const,
        accountMode: "multi" as const,
      };
      ({ app } = await buildTestApp(options));
      const { cookie } = await registerAndLogin(app, "persist@example.com");
      const registrationId = randomUUID(),
        closedId = randomUUID();
      const receipt = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          ...alice,
          email: "receipt-persist@example.com",
          operation_id: registrationId,
        },
      });
      expect(receipt.statusCode, receipt.body).toBe(201);
      await app.inject({
        method: "POST",
        url: "/auth/register/operations/resolve",
        payload: { operation_id: closedId },
      });
      const created = await app.inject({
        method: "POST",
        url: "/users",
        headers: { cookie },
        payload: {
          snapshot: { name: "林远", description: "林远是记录旅途的书商。" },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const personaId = created.json().data.id;
      await app.close();
      ({ app } = await buildTestApp(options));
      const me = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie },
      });
      expect(me.statusCode, me.body).toBe(200);
      for (const [operationId, status] of [
        [registrationId, "created"],
        [closedId, "not_created"],
      ]) {
        const checked = await app.inject({
          method: "POST",
          url: "/auth/register/operations/resolve",
          payload: { operation_id: operationId },
        });
        expect(checked.statusCode, checked.body).toBe(200);
        expect(checked.json().data.status).toBe(status);
      }
      expect(me.json().data).toMatchObject({
        email: "persist@example.com",
        default_persona_id: personaId,
      });
      const user = await app.inject({
        method: "GET",
        url: `/users/${personaId}`,
        headers: { cookie },
      });
      expect(user.json().data.snapshot.description).toBe(
        "林远是记录旅途的书商。",
      );
    } finally {
      await app?.close();
      app = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retries a persona creation by operation id without duplicating the account library", async () => {
    const api = await start();
    const a = await registerAndLogin(api, "create-a@example.com");
    const b = await registerAndLogin(api, "create-b@example.com");
    const payload = {
      operation_id: "create-lin-1",
      snapshot: { name: "林远", description: "林远是记录旅途的书商。" },
    };
    const first = await api.inject({
      method: "POST",
      url: "/users",
      headers: { cookie: a.cookie },
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);
    const repeat = await api.inject({
      method: "POST",
      url: "/users",
      headers: { cookie: a.cookie },
      payload,
    });
    expect(repeat.statusCode, repeat.body).toBe(201);
    expect(repeat.json().data.id).toBe(first.json().data.id);
    const list = await api.inject({
      method: "GET",
      url: "/users",
      headers: { cookie: a.cookie },
    });
    expect(list.json().data).toHaveLength(1);
    const changed = await api.inject({
      method: "POST",
      url: "/users",
      headers: { cookie: a.cookie },
      payload: {
        ...payload,
        snapshot: { ...payload.snapshot, description: "不同描述" },
      },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe("operation_conflict");
    const separate = await api.inject({
      method: "POST",
      url: "/users",
      headers: { cookie: b.cookie },
      payload,
    });
    expect(separate.statusCode, separate.body).toBe(201);
    expect(separate.json().data.id).not.toBe(first.json().data.id);
  });

  it("registers an account with an empty persona library and requires a separate login", async () => {
    const api = await start();
    const response = await api.inject({
      method: "POST",
      url: "/auth/register",
      payload: alice,
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().data).toMatchObject({
      name: "阿离",
      email: "alice@example.com",
      role: "user",
      default_persona_id: null,
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(
      (await api.inject({ method: "GET", url: "/auth/me" })).statusCode,
    ).toBe(401);
    const login = await api.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "alice@example.com", password: alice.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(
      (
        await api.inject({
          method: "GET",
          url: "/auth/me",
          headers: { cookie },
        })
      ).json().data.id,
    ).toBe(response.json().data.id);
    const personas = await api.inject({
      method: "GET",
      url: "/users",
      headers: { cookie },
    });
    expect(personas.statusCode, personas.body).toBe(200);
    expect(personas.json().data).toEqual([]);
  });
});
