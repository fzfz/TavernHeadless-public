import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { createTestDatabase } from "../../../test/helpers/create-test-db.js";
import { NativeCardService } from "../../services/native-card/native-card-service.js";
import { loadNativeCardConfig } from "../../native-card-config.js";
import { validateDatabaseFileReferences } from "../file-references.js";

it("checks every native card revision through native package storage and rejects missing or redirected files", async () => {
  const root = await mkdtemp(join(tmpdir(), "tavern-native-file-references-"));
  const database = createTestDatabase();
  try {
    const service = new NativeCardService(
      database.db,
      loadNativeCardConfig(root),
    );
    const card = await service.create("default-admin", {
      name: "File reference card",
    });
    const revision = database.db.$client
      .prepare(
        "SELECT storage_key AS storageKey FROM native_card_revision WHERE card_id = ?",
      )
      .get(card.id) as { storageKey: string };
    const valid = await validateDatabaseFileReferences(database, root);
    expect(valid.ok).toBe(true);
    expect(valid.checked).toBeGreaterThan(1);
    await rm(join(root, "native-cards", revision.storageKey, "manifest.json"));
    const missing = await validateDatabaseFileReferences(database, root);
    expect(missing.ok).toBe(false);
    expect(missing.issues).toEqual([
      expect.objectContaining({
        kind: "missing",
        table: "native_card_revision",
        fileKey: revision.storageKey + "/manifest.json",
      }),
    ]);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("checks live native imports and builds while allowing expired artifacts to be absent", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "tavern-native-artifact-references-"),
  );
  const database = createTestDatabase();
  try {
    const service = new NativeCardService(
      database.db,
      loadNativeCardConfig(root),
    );
    const card = await service.create("default-admin", {
      name: "Artifact references",
    });
    const build = await service.createBuild("default-admin", card.id, {
      revision: card.revision,
    });
    await service.executeBuild("default-admin", build.id);
    const zip = await service.readBuildZip("default-admin", build.id);
    const imported = await service.inspectImport(
      "default-admin",
      zip,
      "reference.zip",
    );
    const buildRow = database.db.$client
      .prepare(
        "SELECT storage_key AS storageKey FROM native_card_build WHERE id = ?",
      )
      .get(build.id) as { storageKey: string };
    const importRow = database.db.$client
      .prepare(
        "SELECT storage_key AS storageKey FROM native_card_import WHERE id = ?",
      )
      .get(imported.id) as { storageKey: string };
    expect((await validateDatabaseFileReferences(database, root)).ok).toBe(
      true,
    );
    await rm(
      join(root, "native-card-builds", buildRow.storageKey, "package.zip"),
    );
    await rm(
      join(root, "native-card-imports", importRow.storageKey, "manifest.json"),
    );
    const missing = await validateDatabaseFileReferences(database, root);
    expect(missing.issues.map((issue) => issue.table).sort()).toEqual([
      "native_card_build",
      "native_card_import",
    ]);
    database.db.$client.exec(
      "UPDATE native_card_build SET expires_at = 0; UPDATE native_card_import SET expires_at = 0",
    );
    expect((await validateDatabaseFileReferences(database, root)).ok).toBe(
      true,
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("checks persisted role files through their configured storage and reports missing references without file contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "tavern-file-references-"));
  const database = createTestDatabase();
  try {
    database.db.$client
      .prepare(
        "INSERT INTO role_asset_bundle (version_id, account_id, character_id, storage_key, import_id, created_at) VALUES ('asset-version', 'default-admin', 'character', 'default-admin/asset-version', 'import', 1)",
      )
      .run();
    database.db.$client
      .prepare(
        "INSERT INTO role_asset (version_id, name, mime, byte_size, purpose) VALUES ('asset-version', 'view.html', 'text/html', 6, 'template')",
      )
      .run();
    await mkdir(join(root, "role-assets/default-admin/asset-version"), {
      recursive: true,
    });
    await writeFile(
      join(root, "role-assets/default-admin/asset-version/view.html"),
      "secret",
    );
    expect(await validateDatabaseFileReferences(database, root)).toEqual({
      ok: true,
      checked: 1,
      issues: [],
    });
    await rm(join(root, "role-assets/default-admin/asset-version/view.html"));
    const result = await validateDatabaseFileReferences(database, root);
    expect(result).toMatchObject({
      ok: false,
      checked: 1,
      issues: [
        {
          kind: "missing",
          table: "role_asset",
          rowId: "asset-version:view.html",
          field: "name",
          fileKey: "view.html",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
