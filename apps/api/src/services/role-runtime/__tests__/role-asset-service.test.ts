import { mkdtemp, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type DatabaseConnection } from "../../../../test/helpers/create-test-db.js";
import {
  accounts,
  characters,
  characterVersions,
  roleAssetBundles,
  roleAssets,
} from "../../../db/schema.js";
import { RoleFileStore } from "../../storage/role-file-store.js";
import { RoleAssetService } from "../role-asset-service.js";
import { eq } from "drizzle-orm";
import type { CreateRoleAssets } from "@tavern/shared";

let root: string;
let connection: DatabaseConnection;
let service: RoleAssetService;
const packageFiles = (): CreateRoleAssets => ({
  character_id: "character",
  files: [
    {
      name: "manifest.json",
      mime: "application/json",
      purpose: "manifest",
      base64: Buffer.from(
        JSON.stringify({
          apiVersion: 1,
          html: "view.html",
          css: "view.css",
          script: "main.js",
          assets: {},
          data: {},
        }),
      ).toString("base64"),
    },
    ...[
      ["view.html", "template"],
      ["view.css", "template"],
      ["main.js", "browser_script"],
      ["derive.js", "server_script"],
    ].map(([name, purpose]) => ({
      name: name!,
      purpose: purpose as "template",
      mime: "text/plain",
      base64: Buffer.from("content").toString("base64"),
    })),
  ],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "role-assets-"));
  connection = createTestDatabase(":memory:");
  await connection.db
    .insert(accounts)
    .values({ id: "owner", name: "Owner", createdAt: 1, updatedAt: 1 });
  await connection.db
    .insert(characters)
    .values({
      id: "character",
      accountId: "owner",
      name: "Character",
      createdAt: 1,
      updatedAt: 1,
    });
  await connection.db
    .insert(characterVersions)
    .values({
      id: "version",
      characterId: "character",
      versionNo: 1,
      dataJson: "{}",
      contentHash: "fixture",
      createdAt: 1,
    });
  service = new RoleAssetService(
    connection.db,
    new RoleFileStore({
      roleAssetsDir: join(root, "files"),
      roleAssetStagingDir: join(root, "staging"),
    }),
    undefined,
    { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
  );
});
afterEach(async () => {
  connection?.close();
  await rm(root, { recursive: true, force: true });
});

describe("versioned role asset service", () => {
  it("commits files and metadata and delivers only browser resources", async () => {
    await service.import("owner", "version", packageFiles());
    const file = await service.read("owner", "version", "main.js");
    expect(file.content.toString()).toBe("content");
    expect(connection.db.select().from(roleAssetBundles).all()).toHaveLength(1);
    await expect(
      service.read("owner", "version", "derive.js"),
    ).rejects.toMatchObject({ code: "ROLE_ASSET_SERVER_ONLY" });
    await expect(
      service.read("other", "version", "main.js"),
    ).rejects.toMatchObject({ code: "ROLE_ASSET_NOT_FOUND" });
    await expect(
      service.import("owner", "version", packageFiles()),
    ).rejects.toMatchObject({ code: "ROLE_ASSETS_ALREADY_SAVED" });
  });

  it("rejects missing manifest references and incorrect ownership before committing files", async () => {
    const input = packageFiles();
    input.files = input.files.filter((file) => file.name !== "main.js");
    await expect(
      service.import("owner", "version", input),
    ).rejects.toMatchObject({ code: "ROLE_ASSET_PACKAGE_INVALID" });
    await expect(
      service.import("other", "version", packageFiles()),
    ).rejects.toMatchObject({ code: "ROLE_ASSET_NOT_FOUND" });
    expect(connection.db.select().from(roleAssetBundles).all()).toHaveLength(0);
  });

  it("removes only this import directory after index insertion fails", async () => {
    connection.db.$client.exec(
      "CREATE TRIGGER deny_bundle BEFORE INSERT ON role_asset_bundle BEGIN SELECT RAISE(ABORT, 'index unavailable'); END",
    );
    await expect(
      service.import("owner", "version", packageFiles()),
    ).rejects.toThrow("index unavailable");
    await expect(
      access(join(root, "files", "owner", "version")),
    ).rejects.toThrow();
    expect(connection.db.select().from(roleAssetBundles).all()).toHaveLength(0);
  });

  it("reports a missing fixed-version file with its version and path", async () => {
    await service.import("owner", "version", packageFiles());
    await rm(join(root, "files", "owner", "version", "main.js"));
    await expect(
      service.read("owner", "version", "main.js"),
    ).rejects.toMatchObject({
      code: "ROLE_ASSET_FILE_MISSING",
      details: { versionId: "version", path: "main.js" },
    });
  });
  it("blocks publication when referenced file metadata or physical files are incomplete", async () => {
    await service.import("owner", "version", packageFiles());
    await service.requireCompleteBundle("owner", "version");
    connection.db
      .delete(roleAssets)
      .where(eq(roleAssets.name, "main.js"))
      .run();
    await expect(
      service.requireCompleteBundle("owner", "version"),
    ).rejects.toMatchObject({
      code: "ROLE_ASSET_PACKAGE_INVALID",
      details: { path: "main.js" },
    });
    connection.db
      .insert(roleAssets)
      .values({
        versionId: "version",
        name: "main.js",
        mime: "text/plain",
        byteSize: 7,
        purpose: "browser_script",
      })
      .run();
    await rm(join(root, "files", "owner", "version", "main.js"));
    await expect(
      service.requireCompleteBundle("owner", "version"),
    ).rejects.toMatchObject({
      code: "ROLE_ASSET_FILE_MISSING",
      details: { path: "main.js" },
    });
  });

  it("reports a missing or malformed publication manifest with its file path", async () => {
    await service.import("owner", "version", packageFiles());
    const path = join(root, "files", "owner", "version", "manifest.json");
    await rm(path);
    await expect(
      service.requireCompleteBundle("owner", "version"),
    ).rejects.toMatchObject({
      code: "ROLE_ASSET_FILE_MISSING",
      details: { versionId: "version", path: "manifest.json" },
    });
    await writeFile(path, "{");
    await expect(
      service.requireCompleteBundle("owner", "version"),
    ).rejects.toMatchObject({
      code: "ROLE_ASSET_PACKAGE_INVALID",
      details: { versionId: "version", path: "manifest.json" },
      cause: expect.any(SyntaxError),
    });
  });

  it("allows only one concurrent import to claim an immutable version", async () => {
    const results = await Promise.allSettled([
      service.import("owner", "version", packageFiles()),
      service.import("owner", "version", packageFiles()),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    expect(
      (await service.read("owner", "version", "main.js")).content.toString(),
    ).toBe("content");
    expect(connection.db.select().from(roleAssetBundles).all()).toHaveLength(1);
  });

  it("retains both failures and the exact residual path when index rollback cleanup fails", async () => {
    const store = new RoleFileStore({
      roleAssetsDir: join(root, "files"),
      roleAssetStagingDir: join(root, "staging"),
    });
    service = new RoleAssetService(connection.db, store, undefined, {
      maxRetries: 0,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });
    vi.spyOn(store, "removeVersion").mockRejectedValue(
      new Error("directory locked"),
    );
    connection.db.$client.exec(
      "CREATE TRIGGER deny_bundle BEFORE INSERT ON role_asset_bundle BEGIN SELECT RAISE(ABORT, 'index unavailable'); END",
    );
    const error = await service
      .import("owner", "version", packageFiles())
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(
      (error as AggregateError).errors.map((item: Error) => item.message),
    ).toEqual(["index unavailable", "directory locked"]);
    expect((error as Error).message).toContain(
      join(root, "files", "owner", "version"),
    );
    expect(connection.db.select().from(roleAssetBundles).all()).toHaveLength(0);
  });
});
