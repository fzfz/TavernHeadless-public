import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import Database from "better-sqlite3";
import { createDatabase } from "../client.js";
import {
  buildTestApp,
  createTestDatabase,
} from "../../../test/helpers/create-test-db.js";
import { LlmProfileService } from "../../services/llm-profile-service.js";
import { loadStorageConfig } from "../../storage-config.js";
import { NativeCardService } from "../../services/native-card/native-card-service.js";
import { loadNativeCardConfig } from "../../native-card-config.js";

const directories: string[] = [];
const command = fileURLToPath(
  new URL("../environment-command.ts", import.meta.url),
);

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("environment database command", () => {
  it("checks stored profile secrets with the supplied master key without returning secret content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-db-command-secrets-"));
    directories.push(directory);
    const database = join(directory, "database.sqlite");
    const output = join(directory, "status.json");
    const source = createTestDatabase(database);
    const run = (masterKey: string | undefined) => {
      const env = { ...process.env };
      if (masterKey === undefined) delete env.APP_SECRETS_MASTER_KEY;
      else env.APP_SECRETS_MASTER_KEY = masterKey;
      const result = spawnSync(
        process.execPath,
        [
          "--conditions=development",
          "--import",
          "tsx",
          command,
          "status",
          "--database",
          database,
          "--output",
          output,
        ],
        {
          encoding: "utf8",
          env,
        },
      );
      return { ...result, body: JSON.parse(readFileSync(output, "utf8")) };
    };
    const empty = run(undefined);
    expect(empty.status, empty.stderr).toBe(0);
    expect(empty.body).toMatchObject({
      ready: true,
      profileSecrets: { ok: true, checked: 0, issues: [] },
    });
    const apiKey = "profile-secret-that-must-not-appear";
    const masterKey = "backup-matching-master-key";
    const profile = await new LlmProfileService(source.db, {
      masterKey,
    }).createProfile({
      presetName: "Backup secret",
      provider: "openai-compatible",
      modelId: "fixture-model",
      apiKey,
    });
    source.close();
    const valid = run(masterKey);
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.body).toMatchObject({
      ready: true,
      profileSecrets: { ok: true, checked: 1, issues: [] },
    });
    const missing = run(undefined);
    expect(missing.status, missing.stderr).toBe(3);
    expect(missing.body).toMatchObject({
      ready: false,
      profileSecrets: {
        ok: false,
        checked: 1,
        issues: [{ id: profile.id, errorType: "secret_unavailable" }],
      },
    });
    const invalid = run("incorrect-master-key");
    expect(invalid.status, invalid.stderr).toBe(3);
    expect(invalid.body).toMatchObject({
      ready: false,
      profileSecrets: {
        ok: false,
        checked: 1,
        issues: [{ id: profile.id, errorType: "secret_invalid_format" }],
      },
    });
    const published = JSON.stringify([
      valid.body,
      invalid.body,
      valid.stdout,
      invalid.stdout,
      valid.stderr,
      invalid.stderr,
    ]);
    expect(published).not.toContain(apiKey);
    expect(published).not.toContain(masterKey);
  }, 30000);

  it("executes the command when its entry path is a symbolic link", () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-db-command-link-"));
    directories.push(directory);
    const entry = join(directory, "database-command.ts");
    symlinkSync(command, entry);
    const output = join(directory, "status.json");
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "tsx",
        entry,
        "status",
        "--database",
        join(directory, "database.sqlite"),
        "--output",
        output,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(3);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      ready: false,
      migrationState: "pending",
    });
  }, 30000);

  it("includes file references in status and refuses a missing native revision file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-db-command-files-"));
    directories.push(directory);
    const storage = loadStorageConfig({ DATA_DIR: directory });
    const built = await buildTestApp({
      storage,
      databasePath: storage.databasePath,
      logger: false,
    });
    const card = await new NativeCardService(
      built.database,
      loadNativeCardConfig(directory),
    ).create("default-admin", { name: "Stored files" });
    const row = built.database.$client
      .prepare(
        "SELECT storage_key AS storageKey FROM native_card_revision WHERE card_id = ?",
      )
      .get(card.id) as { storageKey: string };
    await built.app.close();
    const output = join(directory, "status.json");
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "--conditions=development",
          "--import",
          "tsx",
          command,
          "status",
          "--database",
          storage.databasePath,
          "--output",
          output,
          "--data-directory",
          directory,
        ],
        { encoding: "utf8" },
      );
    expect(run().status).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      ready: true,
      fileReferences: { ok: true },
    });
    rmSync(join(directory, "native-cards", row.storageKey, "manifest.json"));
    const missing = run();
    expect(missing.status, missing.stderr).toBe(3);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      ready: false,
      fileReferences: {
        ok: false,
        issues: [{ kind: "missing", table: "native_card_revision" }],
      },
    });
  }, 30000);

  it("returns migration failure details and allows retry after the failing constraint is removed", () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-db-command-failure-"));
    directories.push(directory);
    const database = join(directory, "database.sqlite");
    const output = join(directory, "result.json");
    const run = (operation: string) =>
      spawnSync(
        process.execPath,
        [
          "--conditions=development",
          "--import",
          "tsx",
          command,
          operation,
          "--database",
          database,
          "--output",
          output,
        ],
        { encoding: "utf8" },
      );
    expect(run("migrate").status).toBe(0);
    const source = createDatabase(database);
    source.db.$client
      .prepare(
        "INSERT INTO account (id, name, status, is_default, created_at, updated_at) VALUES ('failure-test', 'Failure test', 'active', 0, 1, 1)",
      )
      .run();
    source.db.$client.exec(
      "CREATE TRIGGER fail_repair BEFORE INSERT ON workspace BEGIN SELECT RAISE(ABORT, 'command repair failure'); END;",
    );
    const failed = run("migrate");
    expect(failed.status, failed.stderr).toBe(6);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      ready: false,
      lastRun: {
        status: "failed",
        phases: [
          { phase: "schema-migrations", status: "committed" },
          { phase: "schema-repairs", status: "rolled_back" },
          { phase: "asset-versions", status: "pending" },
          { phase: "scope-integrity", status: "pending" },
          { phase: "verification", status: "pending" },
        ],
      },
    });
    expect(run("status").status).toBe(3);
    source.db.$client.exec("DROP TRIGGER fail_repair");
    source.close();
    expect(run("migrate").status).toBe(0);
  }, 30000);

  it("reports backup failure without publishing a partial copy", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "tavern-db-command-backup-failure-"),
    );
    directories.push(directory);
    const database = join(directory, "database.sqlite");
    const source = new Database(database);
    source.pragma("foreign_keys = OFF");
    source.exec(
      "CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (1, 99);",
    );
    source.close();
    const target = join(directory, "backup.sqlite");
    const output = join(directory, "result.json");
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "tsx",
        command,
        "backup",
        "--database",
        database,
        "--output",
        output,
        "--target",
        target,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(6);
    expect(existsSync(target)).toBe(false);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      ready: false,
      ok: false,
    });
  }, 30000);

  it("reads status without changing an existing database journal mode", () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-db-readonly-"));
    directories.push(directory);
    const database = join(directory, "database.sqlite");
    const source = new Database(database);
    source.pragma("journal_mode = DELETE");
    source.close();
    const status = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "tsx",
        command,
        "status",
        "--database",
        database,
        "--output",
        join(directory, "status.json"),
      ],
      { encoding: "utf8" },
    );
    expect(status.status, status.stderr).toBe(3);
    const check = new Database(database);
    expect(check.pragma("journal_mode", { simple: true })).toBe("delete");
    check.close();
  }, 30000);

  it("rejects a normalized output path that aliases the source database", () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-db-output-"));
    directories.push(directory);
    const database = join(directory, "database.sqlite");
    const output = join(directory, "result.json");
    const migrated = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "tsx",
        command,
        "migrate",
        "--database",
        database,
        "--output",
        output,
      ],
      { encoding: "utf8" },
    );
    expect(migrated.status, migrated.stderr).toBe(0);
    const before = readFileSync(database);
    const aliasedOutput = directory + "/sub/../database.sqlite";
    const status = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "tsx",
        command,
        "status",
        "--database",
        database,
        "--output",
        aliasedOutput,
      ],
      { encoding: "utf8" },
    );
    expect(status.status, status.stderr).toBe(3);
    expect(readFileSync(database)).toEqual(before);
  }, 30000);

  it("writes status for a missing database and migrates explicitly before making a verified backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "tavern-db-command-"));
    directories.push(directory);
    const database = join(directory, "database.sqlite");
    const output = join(directory, "result.json");
    const run = (operation: string, extra: string[] = []) =>
      spawnSync(
        process.execPath,
        [
          "--conditions=development",
          "--import",
          "tsx",
          command,
          operation,
          "--database",
          database,
          "--output",
          output,
          ...extra,
        ],
        { encoding: "utf8" },
      );

    const pending = run("status");
    expect(pending.status, pending.stderr).toBe(3);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      ready: false,
      migrationState: "pending",
      integrity: { ok: true },
      foreignKeys: { ok: true },
    });
    expect(existsSync(database)).toBe(false);
    const migrated = run("migrate");
    expect(migrated.status, migrated.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      ready: true,
    });
    expect(migrated.stdout.length).toBeLessThan(500);

    const source = createDatabase(database);
    source.db.$client
      .prepare(
        "INSERT INTO account (id, name, status, is_default, created_at, updated_at) VALUES ('backup-test', 'Backup test', 'active', 0, 1, 1)",
      )
      .run();
    const status = run("status");
    expect(status.status, status.stderr).toBe(0);
    const tableRowCounts = JSON.parse(
      readFileSync(output, "utf8"),
    ).tableRowCounts;
    expect(tableRowCounts).toMatchObject({ account: 2 });
    const target = join(directory, "backup.sqlite");
    const backup = run("backup", ["--target", target]);
    source.close();
    expect(backup.status, backup.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      ok: true,
      targetPath: target,
      integrity: { ok: true },
      foreignKeys: { ok: true },
      tableRowCounts: { account: 2 },
    });
    expect(JSON.parse(readFileSync(output, "utf8")).tableRowCounts).toEqual(
      tableRowCounts,
    );
    const copy = createDatabase(target);
    expect(
      copy.db.$client
        .prepare("SELECT name FROM account WHERE id = 'backup-test'")
        .get(),
    ).toEqual({ name: "Backup test" });
    copy.close();
    expect(run("backup", ["--target", target]).status).toBe(3);
  }, 30000);
});
