import { describe, expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";

const account = {
  id: "account-a",
  name: "阿离",
  email: "alice@example.com",
  role: "user",
  status: "active",
  default_persona_id: "persona-a",
  created_at: 10,
  updated_at: 20,
};
const response = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });

describe("SDK browser identity", () => {
  it("sends a registration operation and resolves its saved result without credentials", async () => {
    const operationId = "1b6cfc9d-bf6e-4c33-9681-f77a25f01044";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(account))
      .mockResolvedValueOnce(
        response({ operation_id: operationId, status: "created" }),
      );
    const client = createTavernClient({
      baseUrl: "http://example.test",
      fetchImpl,
    });
    await client.auth.register({
      name: "阿离",
      email: account.email,
      password: "some password",
      operationId,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)).toEqual({
      name: "阿离",
      email: account.email,
      password: "some password",
      operation_id: operationId,
    });
    expect(await client.auth.resolveRegistration({ operationId })).toEqual({
      operationId,
      status: "created",
    });
    expect(JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string)).toEqual({
      operation_id: operationId,
    });
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      "http://example.test/auth/register/operations/resolve",
    );
  });

  it("uses authenticated browser credentials and maps account and preference endpoints", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(account))
      .mockResolvedValueOnce(response(account))
      .mockResolvedValueOnce(response(account))
      .mockResolvedValueOnce(response({ ...account, name: "新昵称" }))
      .mockResolvedValueOnce(response({ default_persona_id: "persona-a" }))
      .mockResolvedValueOnce(response({ default_persona_id: "persona-b" }))
      .mockResolvedValueOnce(response({ logged_out: true }));
    const client = createTavernClient({
      baseUrl: "http://example.test/api",
      fetchImpl,
      credentials: "include",
    });
    const input = {
      name: "阿离",
      email: "alice@example.com",
      password: "some password",
    };
    expect(await client.auth.register(input)).toMatchObject({
      id: "account-a",
      defaultPersonaId: "persona-a",
      createdAt: 10,
    });
    await client.auth.login({ email: input.email, password: input.password });
    expect((await client.auth.me()).email).toBe(input.email);
    expect((await client.auth.updateMe({ name: "新昵称" })).name).toBe(
      "新昵称",
    );
    expect(await client.auth.getPreferences()).toEqual({
      defaultPersonaId: "persona-a",
    });
    expect(
      await client.auth.updatePreferences({ defaultPersonaId: "persona-b" }),
    ).toEqual({ defaultPersonaId: "persona-b" });
    expect(await client.auth.logout()).toBe(true);
    expect(
      fetchImpl.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([
      ["http://example.test/api/auth/register", "POST"],
      ["http://example.test/api/auth/login", "POST"],
      ["http://example.test/api/auth/me", "GET"],
      ["http://example.test/api/auth/me", "PATCH"],
      ["http://example.test/api/auth/preferences", "GET"],
      ["http://example.test/api/auth/preferences", "PATCH"],
      ["http://example.test/api/auth/logout", "POST"],
    ]);
    expect(
      fetchImpl.mock.calls.every(([, init]) => init?.credentials === "include"),
    ).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[5]![1]!.body as string)).toEqual({
      default_persona_id: "persona-b",
    });
  });
});
