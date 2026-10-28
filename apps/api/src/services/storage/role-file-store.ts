import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import {
  roleAssetPathSchema,
  roleFileSetSchema,
  roleStorageKeySchema,
  type RoleFile,
} from "@tavern/shared";

import type { ResolvedStorageConfig } from "../../storage-config.schema.js";

export class RoleFileStore {
  constructor(
    private readonly config: Pick<
      ResolvedStorageConfig,
      "roleAssetsDir" | "roleAssetStagingDir"
    >,
  ) {}

  importPath(
    importId: string,
    destination?: { accountId: string; versionId: string },
  ): string {
    roleStorageKeySchema.parse(importId);
    if (!destination) return resolve(this.config.roleAssetStagingDir, importId);
    roleStorageKeySchema.parse(destination.accountId);
    roleStorageKeySchema.parse(destination.versionId);
    return resolve(
      this.config.roleAssetsDir,
      destination.accountId,
      destination.versionId,
    );
  }

  async stage(importId: string, files: ReadonlyArray<RoleFile>): Promise<void> {
    roleStorageKeySchema.parse(importId);
    roleFileSetSchema.parse(files);
    const root = resolve(this.config.roleAssetStagingDir, importId);
    await mkdir(this.config.roleAssetStagingDir, { recursive: true });
    await mkdir(root);
    try {
      for (const file of files) {
        const path = resolve(root, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content, { flag: "wx" });
      }
    } catch (cause) {
      try {
        await this.removeStaging(importId);
      } catch (cleanupError) {
        throw new AggregateError(
          [cause, cleanupError],
          `Role import failed and staging cleanup failed at ${root}. Ask an administrator to check role_asset_bundle.import_id for ${importId} and remove ${root} only after confirming it has no registered bundle.`,
          { cause },
        );
      }
      throw cause;
    }
  }

  async commit(
    importId: string,
    accountId: string,
    versionId: string,
  ): Promise<void> {
    for (const key of [importId, accountId, versionId])
      roleStorageKeySchema.parse(key);
    const root = resolve(this.config.roleAssetsDir, accountId, versionId);
    await mkdir(dirname(root), { recursive: true });
    const base = await realpath(this.config.roleAssetsDir);
    if ((await realpath(dirname(root))) !== resolve(base, accountId)) {
      throw new Error(
        `Role account directory is redirected: ${accountId}. Restore its directory under the configured role asset root.`,
      );
    }
    await rename(resolve(this.config.roleAssetStagingDir, importId), root);
  }

  async read(
    accountId: string,
    versionId: string,
    path: string,
  ): Promise<Buffer> {
    return readFile(await this.resolveFile(accountId, versionId, path));
  }

  async resolveFile(
    accountId: string,
    versionId: string,
    path: string,
  ): Promise<string> {
    roleAssetPathSchema.parse(path);
    const versionRoot = await this.resolveVersion(accountId, versionId);
    const file = await realpath(resolve(versionRoot, path));
    if (!file.startsWith(versionRoot + sep)) {
      throw new Error(
        `Role asset leaves version ${versionId}: ${path}. Restore the file inside this resource version.`,
      );
    }
    return file;
  }

  async removeStaging(importId: string): Promise<void> {
    roleStorageKeySchema.parse(importId);
    await rm(resolve(this.config.roleAssetStagingDir, importId), {
      recursive: true,
      force: true,
    });
  }

  async removeVersion(accountId: string, versionId: string): Promise<void> {
    await rm(await this.resolveVersion(accountId, versionId), {
      recursive: true,
    });
  }

  private async resolveVersion(
    accountId: string,
    versionId: string,
  ): Promise<string> {
    for (const key of [accountId, versionId]) roleStorageKeySchema.parse(key);
    const base = await realpath(this.config.roleAssetsDir);
    const expected = resolve(base, accountId, versionId);
    const actual = await realpath(expected);
    if (actual !== expected) {
      throw new Error(
        `Role version directory is redirected: ${versionId}. Restore its directory under account ${accountId}.`,
      );
    }
    return actual;
  }
}
