import { closeSync, existsSync, openSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { createDatabase, type DatabaseConnection } from "./client.js";
import { getDatabaseStatus, type DatabaseStatus } from "./migrations.js";

export class BackupTargetExistsError extends Error {
  constructor(targetPath: string) {
    super(
      `Backup target already exists: ${targetPath}. Choose an unused --target path.`,
    );
    this.name = "BackupTargetExistsError";
  }
}

export type DatabaseBackupResult = DatabaseStatus & {
  targetPath: string;
  bytes: number;
};

export async function backupDatabase(
  connection: DatabaseConnection,
  target: string,
): Promise<DatabaseBackupResult> {
  const targetPath = resolve(target);
  if (existsSync(targetPath)) throw new BackupTargetExistsError(targetPath);
  closeSync(openSync(targetPath, "wx", 0o600));
  let copy: DatabaseConnection | undefined;
  try {
    await connection.db.$client.backup(targetPath);
    copy = createDatabase(targetPath, { readonly: true, fileMustExist: true });
    const status = getDatabaseStatus(copy);
    if (!status.integrity.ok || !status.foreignKeys.ok)
      throw new Error(
        "Backup validation failed. Inspect the source database integrity and foreign keys, then retry with a new target.",
      );
    copy.close();
    copy = undefined;
    return {
      ...status,
      targetPath,
      bytes: statSync(targetPath).size,
    };
  } catch (error) {
    copy?.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${targetPath}${suffix}`, { force: true });
    throw error;
  }
}
