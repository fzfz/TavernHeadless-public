import { stat } from "node:fs/promises";

import { nativeCardPackageManifestSchema } from "@tavern/shared";
import { NativeCardStore } from "../services/native-card/store.js";
import { loadNativeCardConfig } from "../native-card-config.js";
import { RoleFileStore } from "../services/storage/role-file-store.js";
import { loadStorageConfig } from "../storage-config.js";
import type { DatabaseConnection } from "./client.js";

export type FileReferenceIssue = {
  kind: "missing" | "invalid";
  table: string;
  rowId: string;
  field: string;
  fileKey: string;
};
export type FileReferenceResult = {
  ok: boolean;
  checked: number;
  issues: FileReferenceIssue[];
};

export async function validateDatabaseFileReferences(
  connection: DatabaseConnection,
  dataDirectory: string,
): Promise<FileReferenceResult> {
  const storage = loadStorageConfig({ DATA_DIR: dataDirectory });
  const store = new RoleFileStore(storage);
  const nativeStore = new NativeCardStore(loadNativeCardConfig(dataDirectory));
  const issues: FileReferenceIssue[] = [];
  let checked = 0;
  const check = async (
    reference: Omit<FileReferenceIssue, "kind">,
    action: () => Promise<unknown>,
  ) => {
    checked++;
    try {
      await action();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      issues.push({
        ...reference,
        kind: code === "ENOENT" || code === "ENOTDIR" ? "missing" : "invalid",
      });
    }
  };
  const sqlite = connection.db.$client;
  const rows = sqlite
    .prepare(
      "SELECT a.version_id AS versionId, a.name, b.account_id AS accountId FROM role_asset a JOIN role_asset_bundle b ON b.version_id = a.version_id ORDER BY a.version_id, a.name",
    )
    .all() as { versionId: string; name: string; accountId: string }[];
  for (const row of rows) {
    await check(
      {
        table: "role_asset",
        rowId: `${row.versionId}:${row.name}`,
        field: "name",
        fileKey: row.name,
      },
      async () => {
        const path = await store.resolveFile(
          row.accountId,
          row.versionId,
          row.name,
        );
        if (!(await stat(path)).isFile())
          throw new Error("Role asset reference must point to a regular file");
      },
    );
  }
  const revisions = sqlite
    .prepare(
      "SELECT card_id AS cardId, revision, storage_key AS storageKey, manifest_json AS manifestJson FROM native_card_revision ORDER BY card_id, revision",
    )
    .all() as {
    cardId: string;
    revision: number;
    storageKey: string;
    manifestJson: string;
  }[];
  for (const row of revisions) {
    const reference = {
      table: "native_card_revision",
      rowId: `${row.cardId}:${row.revision}`,
      field: "storage_key",
      fileKey: `${row.storageKey}/manifest.json`,
    };
    let manifest:
      | ReturnType<typeof nativeCardPackageManifestSchema.parse>
      | undefined;
    await check(reference, async () => {
      manifest = nativeCardPackageManifestSchema.parse(
        JSON.parse(row.manifestJson),
      );
      await nativeStore.read("cards", row.storageKey, "manifest.json");
    });
    if (manifest) {
      for (const file of manifest.files)
        await check(
          { ...reference, fileKey: `${row.storageKey}/${file.path}` },
          () => nativeStore.read("cards", row.storageKey, file.path),
        );
    }
  }
  const imports = sqlite
    .prepare(
      "SELECT id, storage_key AS storageKey FROM native_card_import WHERE status = 'ready' AND expires_at > ? ORDER BY id",
    )
    .all(Date.now()) as { id: string; storageKey: string }[];
  for (const row of imports) {
    const reference = {
      table: "native_card_import",
      rowId: row.id,
      field: "storage_key",
      fileKey: `${row.storageKey}/manifest.json`,
    };
    let manifest:
      | ReturnType<typeof nativeCardPackageManifestSchema.parse>
      | undefined;
    await check(reference, async () => {
      const content = await nativeStore.read(
        "imports",
        row.storageKey,
        "manifest.json",
      );
      manifest = nativeCardPackageManifestSchema.parse(
        JSON.parse(content.toString("utf8")),
      );
    });
    if (manifest) {
      for (const file of manifest.files)
        await check(
          { ...reference, fileKey: `${row.storageKey}/${file.path}` },
          () => nativeStore.read("imports", row.storageKey, file.path),
        );
    }
  }
  const builds = sqlite
    .prepare(
      "SELECT id, storage_key AS storageKey FROM native_card_build WHERE status = 'succeeded' AND storage_key IS NOT NULL AND expires_at > ? ORDER BY id",
    )
    .all(Date.now()) as { id: string; storageKey: string }[];
  for (const row of builds)
    await check(
      {
        table: "native_card_build",
        rowId: row.id,
        field: "storage_key",
        fileKey: `${row.storageKey}/package.zip`,
      },
      () => nativeStore.read("builds", row.storageKey, "package.zip"),
    );
  return { ok: issues.length === 0, checked, issues };
}
