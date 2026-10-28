import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/create-test-db.js";
import { loadStorageConfig } from "../src/storage-config.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { characters, characterVersions } from "../src/db/schema.js";

let app: FastifyInstance | undefined;
let root: string;
afterEach(async () => {
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("formal role resource endpoint", () => {
  it("imports and reads a version through the standard application and retains it on restart", async () => {
    root = await mkdtemp(join(tmpdir(), "role-resource-api-"));
    const storage = loadStorageConfig({ DATA_DIR: root });
    let built = await buildTestApp({
      databasePath: storage.databasePath,
      storage,
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;
    await built.database
      .insert(characters)
      .values({
        id: "character",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        name: "Character",
        createdAt: 1,
        updatedAt: 1,
      });
    await built.database
      .insert(characterVersions)
      .values({
        id: "version",
        characterId: "character",
        versionNo: 1,
        dataJson: "{}",
        contentHash: "fixture",
        createdAt: 1,
      });
    const file = (name: string, purpose: string, text: string) => ({
      name,
      purpose,
      mime: "text/plain",
      base64: Buffer.from(text).toString("base64"),
    });
    const payload = {
      character_id: "character",
      files: [
        file(
          "manifest.json",
          "manifest",
          JSON.stringify({
            apiVersion: 1,
            html: "view.html",
            css: "view.css",
            script: "main.js",
            assets: {},
            data: {},
          }),
        ),
        file("view.html", "template", "<p>Role</p>"),
        file("view.css", "template", "p{}"),
        file("main.js", "browser_script", "export {}"),
        file("derive.js", "server_script", "export {}"),
      ],
    };
    const imported = await app.inject({
      method: "POST",
      url: "/role-assets/version",
      payload,
    });
    expect(imported.statusCode, imported.body).toBe(201);
    expect(imported.json()).toEqual({
      data: { version_id: "version", count: 5 },
    });
    expect((await app.inject("/role-assets/version/view.html")).body).toBe(
      "<p>Role</p>",
    );
    expect(
      (await app.inject("/role-assets/version/derive.js")).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/role-assets/version",
          payload,
        })
      ).statusCode,
    ).toBe(409);
    await app.close();
    built = await buildTestApp({
      databasePath: storage.databasePath,
      storage,
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;
    expect((await app.inject("/role-assets/version/view.html")).body).toBe(
      "<p>Role</p>",
    );
  });
});
