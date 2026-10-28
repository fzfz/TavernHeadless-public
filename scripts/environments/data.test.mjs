import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { watch } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { loadEnvironment } from "./config.mjs";
import { runDatabaseCommand } from "./api-command.mjs";
import {
  backupEnvironment,
  migrateEnvironment,
  restoreEnvironment,
} from "./data.mjs";

async function cleanSourceEnvironment(sandboxRoot) {
  const env = await loadEnvironment("dev", { sandboxRoot });
  const source = join(sandboxRoot, "source");
  await mkdir(join(source, "apps/api"), { recursive: true });
  for (const name of ["src", "config", "drizzle"])
    await cp(
      join(env.sourceRoot, "apps/api", name),
      join(source, "apps/api", name),
      { recursive: true },
    );
  await cp(
    join(env.sourceRoot, "apps/api/package.json"),
    join(source, "apps/api/package.json"),
  );
  await symlink(
    join(env.sourceRoot, "node_modules"),
    join(source, "node_modules"),
  );
  await symlink(
    join(env.sourceRoot, "apps/api/node_modules"),
    join(source, "apps/api/node_modules"),
  );
  await writeFile(join(source, "package.json"), '{"type":"module"}\n');
  await writeFile(join(source, ".gitignore"), "node_modules/\n");
  for (const args of [
    ["init"],
    ["add", "."],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "maintenance.auto=false",
      "commit",
      "-m",
      "fixture",
    ],
  ])
    execFileSync("git", args, { cwd: source, stdio: "pipe" });
  return { ...env, sourceRoot: source };
}

test("backs up SQLite, native role files and the matching private configuration as one complete snapshot", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-backup-"));
  try {
    const env = await loadEnvironment("dev", { sandboxRoot });
    await migrateEnvironment(env, {});
    await mkdir(join(env.paths.data, "native-cards/card"), { recursive: true });
    await writeFile(
      join(env.paths.data, "native-cards/card/source.txt"),
      "role-file",
    );
    await mkdir(dirname(env.paths.secretsEnv), { recursive: true });
    await writeFile(
      env.paths.secretsEnv,
      "APP_SECRETS_MASTER_KEY=isolated-backup-key\n",
    );
    await chmod(env.paths.secretsEnv, 0o600);
    const result = await backupEnvironment(env, { backup: "snapshot" });
    assert.equal(result.manifest.status, "complete");
    assert.equal(
      await readFile(
        join(result.backupDirectory, "data/native-cards/card/source.txt"),
        "utf8",
      ),
      "role-file",
    );
    assert.equal((await stat(result.backupDirectory)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(join(result.backupDirectory, "configuration/secrets.env")))
        .mode & 0o777,
      0o600,
    );
    assert.ok(result.manifest.tableRowCounts.account >= 1);
    const again = await backupEnvironment(env, { backup: "snapshot" });
    assert.equal(again.reused, true);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("migrates an isolated database through the real API CLI and reuses its completed migration state", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-data-"));
  try {
    const env = await loadEnvironment("dev", { sandboxRoot });
    await mkdir(env.paths.data, { recursive: true });
    const first = await migrateEnvironment(env, {});
    assert.equal(first.after.ready, true);
    assert.equal(first.after.integrity.ok, true);
    const second = await migrateEnvironment(env, {});
    assert.equal(second.reused, true);
    assert.deepEqual(
      second.after.appliedMigrationSequence,
      first.after.appliedMigrationSequence,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("backup validation detects a removed row even when SQLite integrity and foreign keys pass", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-backup-rows-"));
  try {
    const env = await loadEnvironment("dev", { sandboxRoot });
    await migrateEnvironment(env, {});
    const edit = (database, sql) =>
      execFileSync(
        process.execPath,
        [
          "-e",
          "const Database=require('better-sqlite3');const db=new Database(process.argv[1]);try{db.pragma('foreign_keys=ON');db.pragma('journal_mode=DELETE');db.exec(process.argv[2]);}finally{db.close();}",
          database,
          sql,
        ],
        { cwd: join(env.sourceRoot, "apps/api"), stdio: "pipe" },
      );
    edit(
      env.paths.database,
      "INSERT INTO preset (id,name,source,account_id,data_json,version,created_at,updated_at) SELECT 'backup-row','Backup row','sillytavern',id,'{}',1,0,0 FROM account LIMIT 1",
    );
    const result = await backupEnvironment(env, { backup: "snapshot" });
    const database = join(result.backupDirectory, result.manifest.database);
    const before = (await stat(database)).size;
    edit(database, "DELETE FROM preset WHERE id='backup-row'");
    assert.equal((await stat(database)).size, before);
    const status = await runDatabaseCommand(env, "status", {
      databasePath: database,
      dataDirectory: join(result.backupDirectory, "data"),
      outputPath: join(sandboxRoot, "changed-status.json"),
    });
    assert.equal(status.integrity.ok, true);
    assert.equal(status.foreignKeys.ok, true);
    await assert.rejects(
      restoreEnvironment(env, { backup: "snapshot", preview: true }),
      (error) => error.exitCode === 6 && error.details.backup === "snapshot",
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("backup requires its copied master key even when the current shell has the correct decryption key", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-backup-key-"));
  try {
    const env = await loadEnvironment("dev", { sandboxRoot });
    await migrateEnvironment(env, {});
    const key = "isolated-encrypted-profile-key";
    const source = `import {createDatabase} from './src/db/client.ts';import {LlmProfileService} from './src/services/llm-profile-service.ts';const db=createDatabase(process.env.DATABASE_URL);try{await new LlmProfileService(db.db,{masterKey:process.env.APP_SECRETS_MASTER_KEY}).createProfile({presetName:'Backup profile',provider:'openai-compatible',modelId:'fixture',apiKey:'private-profile-key'});}finally{db.close();}`;
    execFileSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        source,
      ],
      {
        cwd: join(env.sourceRoot, "apps/api"),
        env: { ...env.runtimeEnv, APP_SECRETS_MASTER_KEY: key },
        stdio: "pipe",
      },
    );
    env.runtimeEnv.APP_SECRETS_MASTER_KEY = key;
    env.secretValues.push(key);
    await assert.rejects(
      backupEnvironment(env, { backup: "missing-key" }),
      (error) => error.exitCode === 6,
    );
    await mkdir(dirname(env.paths.secretsEnv), { recursive: true });
    await writeFile(env.paths.secretsEnv, `APP_SECRETS_MASTER_KEY=${key}\n`, {
      mode: 0o600,
    });
    const result = await backupEnvironment(env, { backup: "paired-key" });
    const check = await restoreEnvironment(env, {
      backup: result.backup,
      preview: true,
    });
    assert.equal(check.preview, true);
    await writeFile(
      join(result.backupDirectory, "configuration/secrets.env"),
      `APP_SECRETS_MASTER_KEY=${"x".repeat(key.length)}\n`,
    );
    await assert.rejects(
      restoreEnvironment(env, { backup: result.backup, preview: true }),
      (error) =>
        error.exitCode === 6 &&
        error.details.status.profileSecrets.ok === false,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("restore preview validates the backup and leaves data unchanged; replacement needs its explicit authorization", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-restore-preview-"));
  try {
    const env = await loadEnvironment("dev", { sandboxRoot });
    await migrateEnvironment(env, {});
    await writeFile(join(env.paths.data, "note.txt"), "before");
    await backupEnvironment(env, { backup: "snapshot" });
    await writeFile(join(env.paths.data, "note.txt"), "after");
    const preview = await restoreEnvironment(env, {
      backup: "snapshot",
      preview: true,
    });
    assert.equal(preview.preview, true);
    assert.equal(preview.backup, "snapshot");
    assert.equal(
      await readFile(join(env.paths.data, "note.txt"), "utf8"),
      "after",
    );
    await assert.rejects(
      restoreEnvironment(env, { backup: "snapshot" }),
      (error) => error.exitCode === 3,
    );
    assert.equal(
      await readFile(join(env.paths.data, "note.txt"), "utf8"),
      "after",
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("restores the selected data and secrets while preserving an operation-before snapshot", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-restore-complete-"));
  try {
    const env = await cleanSourceEnvironment(sandboxRoot);
    await migrateEnvironment(env, {});
    await mkdir(dirname(env.paths.secretsEnv), { recursive: true });
    await writeFile(
      env.paths.secretsEnv,
      "APP_SECRETS_MASTER_KEY=before-key\n",
      { mode: 0o600 },
    );
    await writeFile(join(env.paths.data, "note.txt"), "before");
    await backupEnvironment(env, { backup: "snapshot" });
    await writeFile(join(env.paths.data, "note.txt"), "after");
    await writeFile(env.paths.secretsEnv, "APP_SECRETS_MASTER_KEY=after-key\n");
    const authorization = join(sandboxRoot, "restore-authorization.json");
    await writeFile(
      authorization,
      JSON.stringify({
        approved: true,
        environment: "dev",
        backup: "snapshot",
        release: null,
      }),
    );
    const result = await restoreEnvironment(env, {
      backup: "snapshot",
      authorization,
    });
    assert.equal(result.after.ready, true);
    assert.equal(result.stopped, true);
    assert.equal(
      await readFile(join(env.paths.data, "note.txt"), "utf8"),
      "before",
    );
    assert.equal(
      await readFile(env.paths.secretsEnv, "utf8"),
      "APP_SECRETS_MASTER_KEY=before-key\n",
    );
    assert.equal(
      await readFile(
        join(result.previousSnapshot.directory, "data/note.txt"),
        "utf8",
      ),
      "after",
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("a configuration replacement failure restores the operation-before data directory", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-restore-recovery-"));
  let configurationDirectory;
  try {
    const env = await cleanSourceEnvironment(sandboxRoot);
    await migrateEnvironment(env, {});
    configurationDirectory = dirname(env.paths.secretsEnv);
    await mkdir(configurationDirectory, { recursive: true });
    await writeFile(
      env.paths.secretsEnv,
      "APP_SECRETS_MASTER_KEY=paired-key\n",
      { mode: 0o600 },
    );
    await writeFile(join(env.paths.data, "note.txt"), "snapshot");
    await backupEnvironment(env, { backup: "snapshot" });
    await writeFile(join(env.paths.data, "note.txt"), "current");
    const authorization = join(sandboxRoot, "restore-authorization.json");
    await writeFile(
      authorization,
      JSON.stringify({
        approved: true,
        environment: "dev",
        backup: "snapshot",
        release: null,
      }),
    );
    await chmod(configurationDirectory, 0o500);
    await assert.rejects(
      restoreEnvironment(env, { backup: "snapshot", authorization }),
      (error) => error.exitCode === 6 && error.details.recovery.length === 0,
    );
    assert.equal(
      await readFile(join(env.paths.data, "note.txt"), "utf8"),
      "current",
    );
    assert.equal(
      await readFile(env.paths.secretsEnv, "utf8"),
      "APP_SECRETS_MASTER_KEY=paired-key\n",
    );
  } finally {
    if (configurationDirectory) await chmod(configurationDirectory, 0o700);
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("interrupting data replacement restores the operation-before directory and reports exit 130", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-restore-abort-"));
  let watcher;
  try {
    const env = await cleanSourceEnvironment(sandboxRoot);
    await migrateEnvironment(env, {});
    await writeFile(join(env.paths.data, "note.txt"), "snapshot");
    await backupEnvironment(env, { backup: "snapshot" });
    await writeFile(join(env.paths.data, "note.txt"), "current");
    const authorization = join(sandboxRoot, "restore-authorization.json");
    await writeFile(
      authorization,
      JSON.stringify({
        approved: true,
        environment: "dev",
        backup: "snapshot",
        release: null,
      }),
    );
    const controller = new AbortController();
    watcher = watch(env.root, (_, filename) => {
      if (filename === "data") controller.abort();
    });
    await assert.rejects(
      restoreEnvironment(env, {
        backup: "snapshot",
        authorization,
        signal: controller.signal,
      }),
      (error) => error.exitCode === 130 && error.details.recovery.length === 0,
    );
    assert.equal(
      await readFile(join(env.paths.data, "note.txt"), "utf8"),
      "current",
    );
  } finally {
    watcher?.close();
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("cleanup failure preserves the verified restored data and reports its remaining directory", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-restore-cleanup-"));
  const makeWritable = async (directory) => {
    await chmod(directory, 0o700);
    for (const item of await readdir(directory, { withFileTypes: true }))
      if (item.isDirectory()) await makeWritable(join(directory, item.name));
  };
  try {
    const env = await cleanSourceEnvironment(sandboxRoot);
    await migrateEnvironment(env, {});
    await writeFile(join(env.paths.data, "note.txt"), "snapshot");
    await backupEnvironment(env, { backup: "snapshot" });
    await writeFile(join(env.paths.data, "note.txt"), "current");
    const protectedDirectory = join(env.paths.data, "protected");
    await mkdir(protectedDirectory);
    await writeFile(join(protectedDirectory, "retained.txt"), "current-only");
    await chmod(protectedDirectory, 0o500);
    const authorization = join(sandboxRoot, "restore-authorization.json");
    await writeFile(
      authorization,
      JSON.stringify({
        approved: true,
        environment: "dev",
        backup: "snapshot",
        release: null,
      }),
    );
    const result = await restoreEnvironment(env, {
      backup: "snapshot",
      authorization,
    });
    assert.equal(result.after.ready, true);
    assert.equal(
      await readFile(join(env.paths.data, "note.txt"), "utf8"),
      "snapshot",
    );
    assert.equal(result.cleanup.status, "pending");
    assert.ok(result.cleanup.directory.startsWith(env.root));
    assert.equal(
      await readFile(
        join(result.cleanup.directory, "previous/data/protected/retained.txt"),
        "utf8",
      ),
      "current-only",
    );
  } finally {
    await makeWritable(sandboxRoot);
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("an authorized restore repairs foreign-key damage while retaining the raw operation-before state", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-restore-damaged-"));
  let configurationDirectory;
  try {
    const env = await cleanSourceEnvironment(sandboxRoot);
    await migrateEnvironment(env, {});
    const edit = (sql) =>
      execFileSync(
        process.execPath,
        [
          "-e",
          "const Database=require('better-sqlite3');const db=new Database(process.argv[1]);try{db.exec(process.argv[2]);}finally{db.close();}",
          env.paths.database,
          sql,
        ],
        { cwd: join(env.sourceRoot, "apps/api"), stdio: "pipe" },
      );
    edit(
      "INSERT INTO llm_instance_config (id,account_id,scope,scope_id,instance_slot,created_at,updated_at) SELECT 'restore-row',id,'session','fixture','main',0,0 FROM account LIMIT 1",
    );
    await backupEnvironment(env, { backup: "valid-snapshot" });
    edit(
      "PRAGMA foreign_keys=OFF; UPDATE llm_instance_config SET account_id='missing-account' WHERE id='restore-row'",
    );
    await writeFile(
      join(env.paths.data, "fault-evidence.txt"),
      "before restore",
    );
    const before = await readFile(env.paths.database);
    const broken = await runDatabaseCommand(env, "status", {
      outputPath: join(sandboxRoot, "broken.json"),
    });
    assert.equal(broken.foreignKeys.ok, false);
    const authorization = join(sandboxRoot, "restore-authorization.json");
    await writeFile(
      authorization,
      JSON.stringify({
        approved: true,
        environment: "dev",
        backup: "valid-snapshot",
        release: null,
      }),
    );
    configurationDirectory = dirname(env.paths.secretsEnv);
    await mkdir(configurationDirectory, { recursive: true });
    await writeFile(
      env.paths.secretsEnv,
      "APP_SECRETS_MASTER_KEY=fault-state-key\n",
      { mode: 0o600 },
    );
    await chmod(configurationDirectory, 0o500);
    await assert.rejects(
      restoreEnvironment(env, { backup: "valid-snapshot", authorization }),
      (error) =>
        error.exitCode === 6 &&
        error.details.recovery.length === 0 &&
        Boolean(error.details.previousSnapshot.directory),
    );
    assert.deepEqual(await readFile(env.paths.database), before);
    const stillBroken = await runDatabaseCommand(env, "status", {
      outputPath: join(sandboxRoot, "after-failed-restore.json"),
    });
    assert.equal(stillBroken.foreignKeys.ok, false);
    await chmod(configurationDirectory, 0o700);
    const result = await restoreEnvironment(env, {
      backup: "valid-snapshot",
      authorization,
    });
    assert.equal(result.after.ready, true);
    assert.equal(result.after.foreignKeys.ok, true);
    const snapshot = result.previousSnapshot;
    const manifest = JSON.parse(await readFile(snapshot.manifestPath, "utf8"));
    assert.equal(manifest.kind, "environment-state-snapshot");
    assert.equal(manifest.status, "preserved");
    assert.equal(manifest.diagnostics.result.foreignKeys.ok, false);
    assert.deepEqual(
      await readFile(
        join(snapshot.directory, "data", env.storage.databaseFile),
      ),
      before,
    );
    assert.equal(
      await readFile(
        join(snapshot.directory, "data/fault-evidence.txt"),
        "utf8",
      ),
      "before restore",
    );
  } finally {
    if (configurationDirectory) await chmod(configurationDirectory, 0o700);
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});
