import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  storageConfigSchema,
  type ResolvedStorageConfig,
} from "./storage-config.schema.js";

export function loadStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): ResolvedStorageConfig {
  const config = storageConfigSchema.parse(
    JSON.parse(
      readFileSync(new URL("../config/storage.json", import.meta.url), "utf8"),
    ),
  );
  const dataRoot = resolve(
    workingDirectory,
    environment.DATA_DIR || config.dataRoot,
  );
  const databaseOverride = environment.DATABASE_URL || environment.DB_PATH;
  const databasePath =
    databaseOverride === ":memory:"
      ? ":memory:"
      : databaseOverride
        ? resolve(workingDirectory, databaseOverride)
        : resolve(dataRoot, config.databaseFile);
  return {
    dataRoot,
    roleAssetMaxUploadBytes: config.roleAssetMaxUploadBytes,
    databasePath,
    roleAssetsDir: resolve(dataRoot, config.roleAssetsDir),
    roleAssetStagingDir: resolve(dataRoot, config.roleAssetStagingDir),
    chatTransferArtifactDir: environment.CHAT_TRANSFER_ARTIFACT_DIR
      ? resolve(workingDirectory, environment.CHAT_TRANSFER_ARTIFACT_DIR)
      : resolve(dataRoot, config.chatTransferArtifactDir),
    backupArtifactDir: environment.BACKUP_ARTIFACT_DIR
      ? resolve(workingDirectory, environment.BACKUP_ARTIFACT_DIR)
      : resolve(dataRoot, config.backupArtifactDir),
  };
}

export function prepareStorageDirectories(config: ResolvedStorageConfig): void {
  const directories = new Set([
    config.dataRoot,
    config.roleAssetsDir,
    config.roleAssetStagingDir,
    config.chatTransferArtifactDir,
    config.backupArtifactDir,
    ...(config.databasePath === ":memory:"
      ? []
      : [dirname(config.databasePath)]),
  ]);
  for (const path of directories) {
    try {
      mkdirSync(path, { recursive: true });
      accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch (cause) {
      throw new Error(
        `Storage directory ${path} is unavailable: ${cause instanceof Error ? cause.message : String(cause)}. Check the path configuration and grant the API process read, write and directory access.`,
        { cause },
      );
    }
  }
}
