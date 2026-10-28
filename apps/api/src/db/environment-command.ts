import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { backupDatabase, BackupTargetExistsError } from "./backup.js";
import { createDatabase, type DatabaseConnection } from "./client.js";
import { validateDatabaseFileReferences } from "./file-references.js";
import { validateDatabaseProfileSecrets } from "./profile-secrets.js";
import {
  DatabaseMigrationError,
  DatabaseNotReadyError,
  getDatabaseStatus,
  migrateDatabase,
} from "./migrations.js";

const USAGE =
  "node environment-command.js <status|migrate|backup> --database <absolute-path> --output <absolute-json-path> [--target <absolute-backup-path>] [--data-directory <absolute-data-path>]";
type Operation = "status" | "migrate" | "backup";

function writeResult(output: string, result: unknown): void {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function runEnvironmentCommand(args: string[]): Promise<number> {
  let output: string | undefined;
  let databasePath: string | undefined;
  let operation: Operation | undefined;
  let connection: DatabaseConnection | undefined;
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        database: { type: "string" },
        output: { type: "string" },
        target: { type: "string" },
        "data-directory": { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(
        `${USAGE}\nstatus: inspect migration sequence, integrity, foreign keys and stored profile secret decryption (read only); APP_SECRETS_MASTER_KEY is required when profiles contain encrypted keys; --data-directory also checks stored role file references.\nmigrate: apply schema, repairs and backfills to a stopped environment.\nbackup: create and validate a SQLite backup at an unused target path.\nAll paths are absolute strings; --database and --output are required; backup also requires --target.\nExample: node environment-command.js status --database /srv/tavern/data/database.sqlite --output /tmp/database-status.json`,
      );
      return 0;
    }
    if (values.output && isAbsolute(values.output))
      output = resolve(values.output);
    if (
      positionals.length !== 1 ||
      !["status", "migrate", "backup"].includes(positionals[0]!)
    )
      throw new Error(
        `Choose one operation: status, migrate, backup. Example: ${USAGE}`,
      );
    operation = positionals[0] as Operation;
    if (!values.database || !isAbsolute(values.database) || !output)
      throw new Error(
        `--database and --output require absolute paths. Example: ${USAGE}`,
      );
    databasePath = resolve(values.database);
    if (
      [
        databasePath,
        databasePath + "-wal",
        databasePath + "-shm",
        ...(values.target ? [resolve(values.target)] : []),
      ].includes(output)
    ) {
      output = undefined;
      throw new Error(
        "--output must use a separate JSON file. Choose a path outside the database and backup files.",
      );
    }
    if (
      operation === "backup" &&
      (!values.target || !isAbsolute(values.target))
    )
      throw new Error(
        `backup requires --target with an absolute path. Example: ${USAGE}`,
      );
    if (
      values["data-directory"] &&
      (operation !== "status" || !isAbsolute(values["data-directory"]))
    )
      throw new Error(
        "--data-directory is available on status and requires an absolute data root path.",
      );
    if (operation !== "backup" && values.target)
      throw new Error(
        "--target is available only for backup. Choose status or migrate without --target.",
      );
    if (!existsSync(databasePath) && operation === "backup")
      throw new Error(
        `Database does not exist: ${databasePath}. Run migrate to initialize the environment before backup.`,
      );
    connection =
      !existsSync(databasePath) && operation === "status"
        ? createDatabase(":memory:")
        : createDatabase(
            databasePath,
            operation === "migrate"
              ? {}
              : { readonly: true, fileMustExist: true },
          );
    const result =
      operation === "backup"
        ? await backupDatabase(connection, values.target!)
        : operation === "migrate"
          ? migrateDatabase(connection)
          : getDatabaseStatus(connection);
    const fileReferences = values["data-directory"]
      ? await validateDatabaseFileReferences(
          connection,
          resolve(values["data-directory"]),
        )
      : undefined;
    const profileSecrets =
      operation === "status"
        ? validateDatabaseProfileSecrets(
            connection,
            process.env.APP_SECRETS_MASTER_KEY ?? "",
          )
        : undefined;
    const ready =
      result.ready &&
      (fileReferences?.ok ?? true) &&
      (profileSecrets?.ok ?? true);
    const ok = operation === "backup" || ready;
    writeResult(output, {
      ...result,
      ready,
      ...(fileReferences ? { fileReferences } : {}),
      ...(profileSecrets ? { profileSecrets } : {}),
      ok,
      operation,
      databasePath,
    });
    console.log(
      `${operation}: ${ok ? "complete" : "not ready"}; result: ${output}`,
    );
    if (!ok)
      console.error(
        profileSecrets && !profileSecrets.ok
          ? "Profile secret decryption failed. Set APP_SECRETS_MASTER_KEY to the master key paired with this database and retry status; inspect profileSecrets in the result file."
          : "Database preconditions are not satisfied. Inspect the result file; stop API and workers before running migrate or restoring a backup.",
      );
    return ok ? 0 : 3;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof DatabaseMigrationError
        ? error.result
        : error instanceof DatabaseNotReadyError
          ? error.status
          : undefined;
    if (output)
      writeResult(output, {
        ...status,
        ready: false,
        ok: false,
        operation,
        databasePath,
        error: message,
      });
    console.error(`${message}\nUsage: ${USAGE}`);
    return error instanceof DatabaseMigrationError
      ? 6
      : error instanceof DatabaseNotReadyError ||
          error instanceof BackupTargetExistsError ||
          !connection
        ? 3
        : operation === "migrate" || operation === "backup"
          ? 6
          : 3;
  } finally {
    connection?.close();
  }
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  void runEnvironmentCommand(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 6;
    });
}
