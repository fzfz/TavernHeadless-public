import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../client.js";

import {
  DEFAULT_MIGRATIONS_PATH,
  DatabaseMigrationError,
  assertDatabaseReady,
  getDatabaseStatus,
  migrateDatabase,
} from "../migrations.js";

const connections: DatabaseConnection[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("database lifecycle", () => {
  it("records migration rollback across reopen and can retry corrected SQL", () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-migration-failure-"));
    directories.push(directory);
    const migrations = join(directory, "drizzle");
    cpSync(DEFAULT_MIGRATIONS_PATH, migrations, { recursive: true });
    const journalPath = join(migrations, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries.push({
      idx: 106,
      version: "7",
      tag: "9999_failure",
      when: 1900000000000,
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(journal));
    const migrationPath = join(migrations, "9999_failure.sql");
    writeFileSync(
      migrationPath,
      "CREATE TABLE rollback_probe (id INTEGER);\n--> statement-breakpoint\nINVALID SQL;",
    );
    const path = join(directory, "database.sqlite");
    const first = createDatabase(path);
    expect(() => migrateDatabase(first, migrations)).toThrow(
      DatabaseMigrationError,
    );
    expect(
      first.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE name = 'rollback_probe'")
        .get(),
    ).toBeUndefined();
    expect(first.db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    first.close();
    const reopened = createDatabase(path);
    connections.push(reopened);
    const failed = getDatabaseStatus(reopened, migrations);
    expect(failed.ready).toBe(false);
    expect(failed.lastRun?.phases.slice(0, 2)).toEqual([
      expect.objectContaining({
        phase: "schema-migrations",
        status: "rolled_back",
      }),
      { phase: "schema-repairs", status: "pending" },
    ]);
    expect(() => assertDatabaseReady(reopened, migrations)).toThrow();
    writeFileSync(migrationPath, "CREATE TABLE rollback_probe (id INTEGER);");
    expect(migrateDatabase(reopened, migrations).ready).toBe(true);
  });

  it("rolls back schema repairs, preserves committed migrations and retries after correcting the data constraint", () => {
    const connection = createDatabase(":memory:");
    connections.push(connection);
    migrateDatabase(connection);
    const sqlite = connection.db.$client;
    sqlite
      .prepare(
        "INSERT INTO account (id, name, status, is_default, created_at, updated_at) VALUES ('repair-test', 'Repair test', 'active', 0, 1, 1)",
      )
      .run();
    sqlite.exec(
      "DROP TABLE branch_local_variable_snapshot; CREATE TRIGGER reject_workspace BEFORE INSERT ON workspace BEGIN SELECT RAISE(ABORT, 'injected repair failure'); END;",
    );
    expect(() => migrateDatabase(connection)).toThrow(DatabaseMigrationError);
    const failed = getDatabaseStatus(connection);
    expect(failed.migrationState).toBe("failed");
    expect(failed.lastRun?.phases).toEqual([
      { phase: "schema-migrations", status: "committed" },
      expect.objectContaining({
        phase: "schema-repairs",
        status: "rolled_back",
        error: "injected repair failure",
      }),
      { phase: "asset-versions", status: "pending" },
      { phase: "scope-integrity", status: "pending" },
      { phase: "verification", status: "pending" },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'branch_local_variable_snapshot'",
        )
        .get(),
    ).toBeUndefined();
    sqlite.exec("DROP TRIGGER reject_workspace");
    expect(migrateDatabase(connection).ready).toBe(true);
  });

  it("refuses databases ahead of or divergent from the supplied migration sequence", () => {
    const connection = createDatabase(":memory:");
    connections.push(connection);
    migrateDatabase(connection);
    connection.db.$client
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 1900000000000)",
      )
      .run();
    expect(getDatabaseStatus(connection).migrationState).toBe("ahead");
    expect(() => assertDatabaseReady(connection)).toThrow();
    expect(() => migrateDatabase(connection)).toThrow();
    connection.db.$client
      .prepare(
        "DELETE FROM __drizzle_migrations WHERE created_at = 1900000000000",
      )
      .run();
    connection.db.$client
      .prepare(
        "DELETE FROM __drizzle_migrations WHERE created_at = (SELECT min(created_at) FROM __drizzle_migrations)",
      )
      .run();
    expect(getDatabaseStatus(connection).migrationState).toBe("diverged");
    expect(() => assertDatabaseReady(connection)).toThrow();
  });

  it("explicitly migrates and accepts repeated execution without rewriting business rows", () => {
    const connection = createDatabase(":memory:");
    connections.push(connection);
    expect(getDatabaseStatus(connection).ready).toBe(false);

    const first = migrateDatabase(connection);
    expect(first.ready).toBe(true);
    connection.db.$client
      .prepare(
        "INSERT INTO account (id, name, status, is_default, created_at, updated_at) VALUES ('repeat-test', 'Repeat test', 'active', 0, 1, 1)",
      )
      .run();
    const second = migrateDatabase(connection);
    expect(second.ready).toBe(true);
    expect(second.appliedMigrationSequence).toEqual(
      first.appliedMigrationSequence,
    );
    expect(
      connection.db.$client
        .prepare(
          "SELECT count(*) AS count FROM account WHERE id = 'repeat-test'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("opens an empty connection without applying schema or data changes", () => {
    const connection = createDatabase(":memory:");
    connections.push(connection);

    expect(
      connection.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all(),
    ).toEqual([]);
    expect(connection.db.$client.pragma("foreign_keys", { simple: true })).toBe(
      1,
    );
    expect(connection.db.$client.pragma("busy_timeout", { simple: true })).toBe(
      5000,
    );
  });
});
