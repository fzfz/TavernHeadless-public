import Fastify from "fastify";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../plugins/auth.ts", () => ({
  getRequestAuthContext: (request: { headers: Record<string, string> }) => ({
    accountId: request.headers["x-test-account"] ?? "owner",
  }),
}));
// @ts-expect-error Prototype extension has no generated declarations.
import { registerRoleAssetRoutes } from "../role-assets.mjs";

describe("role asset delivery", () => {
  it("stores immutable version files and checks schema, version ownership, conflicts and missing assets", async () => {
    const app = Fastify();
    const sqlite = new Database(":memory:");
    app.get("/characters/:id/versions", async (request) => ({
      data:
        request.headers["x-test-account"] === "other"
          ? []
          : [{ id: "version-1" }],
    }));
    registerRoleAssetRoutes(app, { $client: sqlite });
    const payload = {
      character_id: "character-1",
      files: [
        {
          name: "main.js",
          mime: "text/javascript",
          base64: Buffer.from("export const value=1;").toString("base64"),
        },
      ],
    };
    try {
      const created = await app.inject({
        method: "POST",
        url: "/role-assets/version-1",
        payload,
      });
      expect(created.statusCode).toBe(201);
      const loaded = await app.inject("/role-assets/version-1/main.js");
      expect(loaded.body).toBe("export const value=1;");
      expect(loaded.headers["content-type"]).toContain("text/javascript");
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/role-assets/version-1",
            payload,
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/role-assets/version-2",
            payload,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/role-assets/version-1",
            headers: { "x-test-account": "other" },
            payload,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            url: "/role-assets/version-1/main.js",
            headers: { "x-test-account": "other" },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await app.inject("/role-assets/version-1/missing.js")).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/role-assets/version-1",
            payload: { ...payload, files: [] },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/role-assets/version-1",
            payload: {
              ...payload,
              files: [payload.files[0], payload.files[0]],
            },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
      sqlite.close();
    }
  });
});
