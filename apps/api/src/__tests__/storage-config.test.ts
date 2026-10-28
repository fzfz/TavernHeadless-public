import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadStorageConfig,
  prepareStorageDirectories,
} from "../storage-config.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("persistent storage configuration", () => {
  it("resolves default storage beneath the configured data root", () => {
    const config = loadStorageConfig({ DATA_DIR: "persistent" }, "/srv/tavern");
    expect(config.dataRoot).toBe("/srv/tavern/persistent");
    expect(config.databasePath).toBe(
      "/srv/tavern/persistent/tavern-headless.db",
    );
    expect(config.roleAssetsDir).toBe("/srv/tavern/persistent/role-assets");
    expect(config.roleAssetStagingDir).toBe(
      "/srv/tavern/persistent/role-asset-staging",
    );
    expect(config.chatTransferArtifactDir).toBe(
      "/srv/tavern/persistent/chat-transfer-artifacts",
    );
    expect(config.backupArtifactDir).toBe(
      "/srv/tavern/persistent/backup-artifacts",
    );
  });

  it("keeps environment path overrides relative to the process working directory", () => {
    const config = loadStorageConfig(
      {
        DATA_DIR: "/mnt/data",
        DATABASE_URL: "db/current.db",
        DB_PATH: "/ignored.db",
        CHAT_TRANSFER_ARTIFACT_DIR: "exports",
        BACKUP_ARTIFACT_DIR: "/mnt/backups",
      },
      "/srv/tavern",
    );
    expect(config.databasePath).toBe("/srv/tavern/db/current.db");
    expect(config.chatTransferArtifactDir).toBe("/srv/tavern/exports");
    expect(config.backupArtifactDir).toBe("/mnt/backups");
    expect(
      loadStorageConfig({ DB_PATH: "legacy.db" }, "/srv/tavern").databasePath,
    ).toBe("/srv/tavern/legacy.db");
    expect(loadStorageConfig({ DATABASE_URL: ":memory:" }).databasePath).toBe(
      ":memory:",
    );
  });

  it("creates persistent directories on first startup and retains existing files", () => {
    const root = mkdtempSync(join(tmpdir(), "tavern-storage-"));
    roots.push(root);
    const config = loadStorageConfig({
      DATA_DIR: join(root, "data"),
      DATABASE_URL: join(root, "database/store.db"),
    });
    prepareStorageDirectories(config);
    const asset = join(config.roleAssetsDir, "existing.txt");
    writeFileSync(asset, "persisted");
    prepareStorageDirectories(config);
    for (const path of [
      config.dataRoot,
      config.roleAssetsDir,
      config.roleAssetStagingDir,
      config.chatTransferArtifactDir,
      config.backupArtifactDir,
      join(root, "database"),
      asset,
    ]) {
      expect(existsSync(path)).toBe(true);
    }
  });

  it("reports the failed path, original cause and corrective action", () => {
    const root = mkdtempSync(join(tmpdir(), "tavern-storage-"));
    roots.push(root);
    const blockedPath = join(root, "file");
    writeFileSync(blockedPath, "not a directory");
    const config = loadStorageConfig({ DATA_DIR: blockedPath });
    expect(() => prepareStorageDirectories(config)).toThrow(blockedPath);
    expect(() => prepareStorageDirectories(config)).toThrow(
      "Check the path configuration",
    );
  });
});
