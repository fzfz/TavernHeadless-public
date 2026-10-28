import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { DatabaseConnection } from "./client.js";
import {
  backfillAssetVersions,
  repairKnownAdditiveSchemaDrift,
  repairScopeIntegrity,
} from "./repairs.js";

export const DEFAULT_MIGRATIONS_PATH = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export type MigrationEntry = { idx: number; tag: string; when: number };
export type AppliedMigrationEntry = { when: number; tag: string | null };
const MIGRATION_PHASES = [
  "schema-migrations",
  "schema-repairs",
  "asset-versions",
  "scope-integrity",
  "verification",
] as const;
export type MigrationPhase = (typeof MIGRATION_PHASES)[number];
export type MigrationPhaseResult = {
  phase: MigrationPhase;
  status: "pending" | "running" | "committed" | "rolled_back";
  error?: string;
};
export type MigrationRun = {
  status: "running" | "failed" | "complete";
  startedAt: string;
  completedAt?: string;
  phases: MigrationPhaseResult[];
};
export type ForeignKeyViolation = {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
};
export type DatabaseStatus = {
  ready: boolean;
  migrationState:
    | "pending"
    | "ahead"
    | "diverged"
    | "failed"
    | "incomplete"
    | "ready";
  expectedMigrationSequence: MigrationEntry[];
  appliedMigrationSequence: AppliedMigrationEntry[];
  integrity: { ok: boolean; results: string[] };
  foreignKeys: { ok: boolean; violations: ForeignKeyViolation[] };
  lastRun: MigrationRun | null;
  tableRowCounts: Record<string, number>;
};

export class DatabaseNotReadyError extends Error {
  constructor(public readonly status: DatabaseStatus) {
    super(
      `Database startup precheck failed (migration state: ${status.migrationState}). Stop API and workers, then run the environment migrate command; inspect integrity and foreignKeys in the status result.`,
    );
    this.name = "DatabaseNotReadyError";
  }
}

export class DatabaseMigrationError extends Error {
  constructor(
    public readonly result: DatabaseStatus,
    options: ErrorOptions,
  ) {
    super(
      "Database migration failed. Inspect lastRun.phases, correct the failed stage or restore the pre-migration backup, then retry migrate.",
      options,
    );
    this.name = "DatabaseMigrationError";
  }
}

export function readMigrationSequence(
  migrationsPath = DEFAULT_MIGRATIONS_PATH,
): MigrationEntry[] {
  const journal = JSON.parse(
    readFileSync(resolve(migrationsPath, "meta/_journal.json"), "utf8"),
  ) as { entries: MigrationEntry[] };
  return journal.entries.map(({ idx, tag, when }) => ({ idx, tag, when }));
}

function readTableRowCounts(
  connection: DatabaseConnection,
): Record<string, number> {
  const sqlite = connection.db.$client;
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => {
      const row = sqlite
        .prepare(
          `SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`,
        )
        .get() as { count: number };
      return [name, row.count];
    }),
  );
}

export function getDatabaseStatus(
  connection: DatabaseConnection,
  migrationsPath = DEFAULT_MIGRATIONS_PATH,
): DatabaseStatus {
  const sqlite = connection.db.$client;
  const expectedMigrationSequence = readMigrationSequence(migrationsPath);
  const hasTable = (name: string) =>
    !!sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
  const appliedRows = hasTable("__drizzle_migrations")
    ? (sqlite
        .prepare(
          "SELECT created_at AS 'when' FROM __drizzle_migrations ORDER BY created_at, id",
        )
        .all() as { when: number }[])
    : [];
  const appliedMigrationSequence = appliedRows.map(({ when }) => ({
    when,
    tag:
      expectedMigrationSequence.find((entry) => entry.when === when)?.tag ??
      null,
  }));
  const lastRunRow = hasTable("__tavern_migration_state")
    ? (sqlite
        .prepare(
          "SELECT result_json FROM __tavern_migration_state WHERE id = 1",
        )
        .get() as { result_json: string } | undefined)
    : undefined;
  const lastRun = lastRunRow
    ? (JSON.parse(lastRunRow.result_json) as MigrationRun)
    : null;
  const integrityResults = (
    sqlite.pragma("integrity_check") as { integrity_check: string }[]
  ).map((row) => row.integrity_check);
  const violations = sqlite.pragma(
    "foreign_key_check",
  ) as ForeignKeyViolation[];
  const integrity = {
    ok: integrityResults.length === 1 && integrityResults[0] === "ok",
    results: integrityResults,
  };
  const foreignKeys = { ok: violations.length === 0, violations };
  let migrationState: DatabaseStatus["migrationState"] = "ready";
  if (
    appliedRows.length > expectedMigrationSequence.length ||
    appliedRows.some(
      (row) => row.when > (expectedMigrationSequence.at(-1)?.when ?? -1),
    )
  )
    migrationState = "ahead";
  else if (
    appliedRows.some(
      (row, index) => row.when !== expectedMigrationSequence[index]?.when,
    )
  )
    migrationState = "diverged";
  else if (lastRun?.status === "failed") migrationState = "failed";
  else if (lastRun?.status === "running") migrationState = "incomplete";
  else if (appliedRows.length < expectedMigrationSequence.length)
    migrationState = "pending";
  return {
    ready: migrationState === "ready" && integrity.ok && foreignKeys.ok,
    migrationState,
    expectedMigrationSequence,
    appliedMigrationSequence,
    integrity,
    foreignKeys,
    lastRun,
    tableRowCounts: readTableRowCounts(connection),
  };
}

export function assertDatabaseReady(
  connection: DatabaseConnection,
  migrationsPath = DEFAULT_MIGRATIONS_PATH,
): DatabaseStatus {
  const status = getDatabaseStatus(connection, migrationsPath);
  if (!status.ready) throw new DatabaseNotReadyError(status);
  return status;
}

export function migrateDatabase(
  connection: DatabaseConnection,
  migrationsPath = DEFAULT_MIGRATIONS_PATH,
): DatabaseStatus {
  const sqlite = connection.db.$client;
  const before = getDatabaseStatus(connection, migrationsPath);
  if (
    before.migrationState === "ahead" ||
    before.migrationState === "diverged" ||
    !before.integrity.ok
  )
    throw new DatabaseNotReadyError(before);
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS __tavern_migration_state (id INTEGER PRIMARY KEY CHECK (id = 1), result_json TEXT NOT NULL)",
  );
  const run: MigrationRun = {
    status: "running",
    startedAt: new Date().toISOString(),
    phases: MIGRATION_PHASES.map((phase) => ({ phase, status: "pending" })),
  };
  const save = () =>
    sqlite
      .prepare(
        "INSERT INTO __tavern_migration_state (id, result_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET result_json = excluded.result_json",
      )
      .run(JSON.stringify(run));
  save();
  for (const stage of run.phases) {
    stage.status = "running";
    save();
    try {
      switch (stage.phase) {
        case "schema-migrations":
          sqlite.pragma("foreign_keys = OFF");
          try {
            migrate(connection.db, {
              migrationsFolder: resolve(migrationsPath),
            });
          } finally {
            sqlite.pragma("foreign_keys = ON");
          }
          break;
        case "schema-repairs":
          sqlite.transaction(() => repairKnownAdditiveSchemaDrift(sqlite))();
          break;
        case "asset-versions":
          sqlite.transaction(() => backfillAssetVersions(connection.db))();
          break;
        case "scope-integrity":
          sqlite.transaction(() => repairScopeIntegrity(connection.db))();
          break;
        case "verification": {
          const status = getDatabaseStatus(connection, migrationsPath);
          if (!status.integrity.ok || !status.foreignKeys.ok)
            throw new Error(
              "Database integrity or foreign-key verification failed",
            );
          break;
        }
      }
      stage.status = "committed";
      save();
    } catch (cause) {
      if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
      stage.status = "rolled_back";
      stage.error = cause instanceof Error ? cause.message : String(cause);
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      save();
      throw new DatabaseMigrationError(
        getDatabaseStatus(connection, migrationsPath),
        { cause },
      );
    }
  }
  run.status = "complete";
  run.completedAt = new Date().toISOString();
  save();
  return assertDatabaseReady(connection, migrationsPath);
}
