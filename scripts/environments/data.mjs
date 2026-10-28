import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";

import { runDatabaseCommand } from "./api-command.mjs";
import { assertOwnedPath, secretValuesFrom } from "./config.mjs";
import { EnvironmentError } from "./errors.mjs";
import { assertEnvironmentStopped } from "./processes.mjs";

import {
  activatePreparedRelease,
  assertIdentifier,
  assertMigrationSequence,
  assertNotAborted,
  beginOperation,
  exists,
  getCurrentRelease,
  getSourceState,
  inventoryDirectory,
  prepareRelease,
  readJson,
  restoreReleaseState,
  runCommand,
  sameFile,
  verifyInventory,
  writeJson,
} from "./release.mjs";

const privateConfigurationFiles = [
  ["applicationEnv", "application.env"],
  ["secretsEnv", "secrets.env"],
];

async function dataIdentity(env) {
  const files = [];
  for (const suffix of ["", "-wal"]) {
    const path = env.paths.database + suffix;
    if (await exists(path)) {
      const stat = await lstat(path);
      if (suffix === "-wal" && stat.size === 0) continue;
      files.push({
        path,
        bytes: stat.size,
        modified: stat.mtimeMs,
        inode: stat.ino,
      });
    }
  }
  return files;
}

async function assertUnchanged(env, before) {
  await assertEnvironmentStopped(env);
  const after = await dataIdentity(env);
  if (JSON.stringify(after) !== JSON.stringify(before))
    throw new EnvironmentError(
      "操作期间数据库文件已变化，请重新备份并查询状态。",
      4,
      { before, after },
    );
}

async function sourceCommit(env, operation) {
  return runCommand(env, "git", ["rev-parse", "HEAD"], {
    cwd: env.mode === "development" ? env.sourceRoot : env.root,
    logPath: join(operation.work, "source.log"),
  });
}

async function backupLocation(env, backup) {
  assertIdentifier(backup, "backup");
  const directory = join(env.paths.backups, backup);
  await assertOwnedPath(env.root, directory);
  return directory;
}

function backupValidationEnvironment(env, secrets) {
  const baseRuntimeEnv = Object.fromEntries(
    Object.entries(env.runtimeEnv).filter(
      ([key]) => !env.secretVariables.includes(key),
    ),
  );
  return {
    ...env,
    runtimeEnv: { ...baseRuntimeEnv, ...secrets },
    secretValues: [...(env.secretValues ?? []), ...secretValuesFrom(secrets)],
  };
}

function sameTableRowCounts(actual, expected) {
  const entries = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const rows = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (rows.some(([, count]) => !Number.isSafeInteger(count) || count < 0))
      return null;
    return rows;
  };
  const left = entries(actual),
    right = entries(expected);
  return (
    left !== null &&
    right !== null &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

async function assertBackupMatchesCurrentData(env, directory, manifest) {
  if (
    JSON.stringify(manifest.sourceIdentity) !==
    JSON.stringify(await dataIdentity(env))
  )
    throw new EnvironmentError(
      "操作前备份与当前数据库文件不匹配，请重新备份。",
      3,
    );
  const excluded = new Set(
    ["", "-wal", "-shm"].map((suffix) => env.storage.databaseFile + suffix),
  );
  const current = (await inventoryDirectory(env.paths.data)).filter(
    (item) => !excluded.has(item.path),
  );
  const snapshot = (await inventoryDirectory(join(directory, "data"))).filter(
    (item) => !excluded.has(item.path),
  );
  if (JSON.stringify(current) !== JSON.stringify(snapshot))
    throw new EnvironmentError("备份后的数据文件发生变化，请重新备份。", 3);
  for (const item of current)
    if (
      item.type === "file" &&
      !(await sameFile(
        join(env.paths.data, item.path),
        join(directory, "data", item.path),
      ))
    )
      throw new EnvironmentError(
        "备份后的数据文件内容发生变化，请重新备份。",
        3,
        { path: item.path },
      );
  for (const [key, name] of privateConfigurationFiles) {
    const saved = join(directory, "configuration", name),
      present = await exists(env.paths[key]);
    if (
      present !== (await exists(saved)) ||
      (present && !(await sameFile(env.paths[key], saved)))
    )
      throw new EnvironmentError("备份后的环境配置发生变化，请重新备份。", 3, {
        key,
      });
  }
}

export async function validateBackup(
  env,
  backup,
  operation,
  { apiDirectory, requireCurrent = false } = {},
) {
  const directory = await backupLocation(env, backup);
  const manifest = await readJson(join(directory, "manifest.json"));
  if (
    manifest.version !== 1 ||
    manifest.status !== "complete" ||
    manifest.environment !== env.name ||
    manifest.root !== env.root ||
    manifest.backup !== backup ||
    !Array.isArray(manifest.files) ||
    typeof manifest.database !== "string"
  )
    throw new EnvironmentError(
      "备份清单与目标环境不匹配。请核对 --env 和 --backup，选择该环境的完整备份，再运行 restore --preview。",
      3,
      { backup },
    );
  await verifyInventory(directory, manifest.files, {
    exclude: ["manifest.json"],
  });
  if (manifest.database !== join("data", env.storage.databaseFile))
    throw new EnvironmentError("备份数据库路径与环境存储配置不匹配。", 3, {
      backup,
    });
  const secretsPath = join(directory, "configuration/secrets.env");
  const secrets = (await exists(secretsPath))
    ? parseEnv(await readFile(secretsPath, "utf8"))
    : {};
  if (Boolean(secrets.APP_SECRETS_MASTER_KEY) !== Boolean(manifest.keyId))
    throw new EnvironmentError(
      "备份缺少配套的加密主密钥记录。请选择包含同批 configuration/secrets.env 和 manifest.json 的完整备份，再运行 restore --preview；重新创建备份前，先将配套主密钥保存到目标环境的 config/secrets.env。",
      3,
      { backup },
    );
  const validationEnv = backupValidationEnvironment(env, secrets);
  const status = await runDatabaseCommand(validationEnv, "status", {
    apiDirectory,
    databasePath: join(directory, manifest.database),
    dataDirectory: join(directory, "data"),
    outputPath: join(operation.work, `backup-${backup}-validation.json`),
  });
  assertNotAborted(env.signal);
  if (
    !status.integrity?.ok ||
    !status.foreignKeys?.ok ||
    status.fileReferences?.ok !== true ||
    status.profileSecrets?.ok !== true ||
    !sameTableRowCounts(status.tableRowCounts, manifest.tableRowCounts) ||
    JSON.stringify(status.appliedMigrationSequence) !==
      JSON.stringify(manifest.appliedMigrationSequence)
  )
    throw new EnvironmentError(
      "备份数据库完整性、迁移序列、表行数、文件引用或密钥解密未通过验证。",
      6,
      { backup, status },
    );
  if (requireCurrent)
    await assertBackupMatchesCurrentData(env, directory, manifest);
  return { backup, directory, manifest, status, secrets, validationEnv };
}

export async function migrateEnvironment(
  env,
  { release, artifact, backup, operationId, signal } = {},
) {
  env = { ...env, signal: signal ?? env.signal };
  assertNotAborted(env.signal);
  await assertEnvironmentStopped(env);
  await assertOwnedPath(env.root, env.paths.data);
  const operation = await beginOperation(env, "migrate", operationId);
  let prepared;
  if (env.mode === "release") {
    if (!release)
      throw new EnvironmentError(
        "发布环境迁移需要发布标识，请通过 --release <releaseId> 指定目标产物。",
        3,
      );
    prepared = await prepareRelease(env, {
      release,
      artifact,
      operationId: operation.operationId,
    });
  }
  const apiDirectory = prepared?.apiDirectory;
  const before = await runDatabaseCommand(env, "status", {
    apiDirectory,
    outputPath: join(operation.work, "before.json"),
  });
  if (before.ready) {
    if (prepared) assertMigrationSequence(before, prepared.manifest);
    return {
      environment: env.name,
      release: release ?? null,
      before,
      after: before,
      reused: true,
      operationId: operation.operationId,
      evidencePath: operation.path,
    };
  }
  if (await exists(env.paths.database)) {
    if (!backup)
      throw new EnvironmentError(
        "已有数据库迁移需要操作前 backup 标识。请先运行 backup，再带 --backup 运行 migrate。",
        3,
      );
    await validateBackup(env, backup, operation, {
      apiDirectory,
      requireCurrent: true,
    });
  }
  const identity = await dataIdentity(env);
  await assertUnchanged(env, identity);
  await mkdir(env.paths.data, { recursive: true });
  let after;
  try {
    after = await operation.stage("apply-migrations", () =>
      runDatabaseCommand(env, "migrate", {
        apiDirectory,
        outputPath: join(operation.work, "migration.json"),
      }),
    );
    if (!after.ready || !after.integrity?.ok || !after.foreignKeys?.ok)
      throw new EnvironmentError(
        "迁移结果尚未满足启动条件，请查看迁移阶段记录。",
        6,
        { after },
      );
    if (prepared) assertMigrationSequence(after, prepared.manifest);
  } catch (error) {
    if ([4, 130].includes(error.exitCode)) throw error;
    throw new EnvironmentError(
      "数据库迁移失败，环境保持停止。请查看阶段记录并选择重试或恢复备份。",
      6,
      {
        cause: error.message,
        result: error.details,
        evidencePath: operation.path,
        backup,
      },
    );
  }
  return {
    environment: env.name,
    release: release ?? null,
    backup: backup ?? null,
    before,
    after,
    reused: false,
    operationId: operation.operationId,
    evidencePath: operation.path,
  };
}

async function copyConfiguration(env, directory) {
  const configuration = [];
  for (const [key, name] of privateConfigurationFiles) {
    const source = env.paths[key];
    await assertOwnedPath(env.root, source);
    if (!(await exists(source))) continue;
    const path = join("configuration", name),
      destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await cp(source, destination);
    await chmod(destination, 0o600);
    if (!(await sameFile(source, destination)))
      throw new EnvironmentError("环境配置复制后字节不一致。", 6, { key });
    configuration.push({ key, path });
  }
  return configuration;
}

async function copyDataFiles(env, directory) {
  const excluded = ["", "-wal", "-shm"].map((suffix) =>
    resolve(env.paths.database + suffix),
  );
  await inventoryDirectory(env.paths.data);
  await cp(env.paths.data, join(directory, "data"), {
    recursive: true,
    dereference: false,
    filter: (path) => !excluded.includes(resolve(path)),
  });
  for (const item of await inventoryDirectory(env.paths.data)) {
    if (
      item.type === "file" &&
      !excluded.includes(resolve(env.paths.data, item.path)) &&
      !(await sameFile(
        join(env.paths.data, item.path),
        join(directory, "data", item.path),
      ))
    )
      throw new EnvironmentError("数据文件复制后字节不一致。", 6, {
        path: item.path,
      });
  }
}

export async function backupEnvironment(
  env,
  { backup = randomUUID(), operationId, apiDirectory, signal } = {},
) {
  env = { ...env, signal: signal ?? env.signal };
  assertNotAborted(env.signal);
  await assertEnvironmentStopped(env);
  const destination = await backupLocation(env, backup);
  const operation = await beginOperation(env, "backup", operationId);
  if (await exists(destination)) {
    const valid = await validateBackup(env, backup, operation, {
      apiDirectory,
    });
    return {
      backup,
      backupDirectory: destination,
      manifest: valid.manifest,
      reused: true,
      operationId: operation.operationId,
      evidencePath: operation.path,
    };
  }
  await assertOwnedPath(env.root, env.paths.data);
  await assertOwnedPath(env.root, env.paths.database);
  if (!(await exists(env.paths.database)))
    throw new EnvironmentError(
      "数据库尚未创建，请先运行 migrate 初始化，再执行 backup。",
      3,
    );
  const identity = await dataIdentity(env),
    current = await getCurrentRelease(env);
  const commit = await sourceCommit(env, operation);
  await mkdir(env.paths.backups, { recursive: true, mode: 0o700 });
  const staged = await mkdtemp(join(env.paths.backups, `.${backup}-`));
  await chmod(staged, 0o700);
  let database, configuration;
  try {
    await operation.stage("sqlite-backup", async () => {
      await mkdir(join(staged, "data"), { recursive: true, mode: 0o700 });
      database = await runDatabaseCommand(env, "backup", {
        apiDirectory,
        target: join(staged, "data", env.storage.databaseFile),
        outputPath: join(operation.work, "database-backup.json"),
      });
      if (!database.integrity?.ok || !database.foreignKeys?.ok)
        throw new EnvironmentError("SQLite 备份未通过完整性或外键验证。", 6);
    });
    await operation.stage("copy-files-and-private-configuration", async () => {
      await copyDataFiles(env, staged);
      configuration = await copyConfiguration(env, staged);
      await assertUnchanged(env, identity);
      if (
        (await getCurrentRelease(env))?.target !== current?.target ||
        (await sourceCommit(env, operation)) !== commit
      )
        throw new EnvironmentError(
          "备份期间发布版本或源码提交发生变化，请重试。",
          4,
        );
    });
    const secretsFile = join(staged, "configuration/secrets.env");
    const secrets = (await exists(secretsFile))
      ? parseEnv(await readFile(secretsFile, "utf8"))
      : {};
    const manifest = {
      version: 1,
      status: "complete",
      backup,
      environment: env.name,
      root: env.root,
      createdAt: new Date().toISOString(),
      release: env.mode === "release" ? (current?.release ?? null) : null,
      commit,
      sourceIdentity: identity,
      database: join("data", env.storage.databaseFile),
      configuration,
      appliedMigrationSequence: database.appliedMigrationSequence,
      migrationSequence: database.expectedMigrationSequence,
      tableRowCounts: database.tableRowCounts,
      keyId: secrets.APP_SECRETS_MASTER_KEY
        ? `${env.name}:${backup}/configuration/secrets.env#APP_SECRETS_MASTER_KEY`
        : null,
      files: await inventoryDirectory(staged),
    };
    await writeJson(join(staged, "manifest.json"), manifest);
    await operation.stage("verify-backup-files", async () => {
      const check = await runDatabaseCommand(
        backupValidationEnvironment(env, secrets),
        "status",
        {
          apiDirectory,
          databasePath: join(staged, manifest.database),
          dataDirectory: join(staged, "data"),
          outputPath: join(operation.work, "backup-file-references.json"),
        },
      );
      if (
        !check.integrity?.ok ||
        !check.foreignKeys?.ok ||
        check.fileReferences?.ok !== true ||
        check.profileSecrets?.ok !== true ||
        !sameTableRowCounts(check.tableRowCounts, manifest.tableRowCounts)
      )
        throw new EnvironmentError(
          "备份数据库、表行数、文件引用或密钥解密验证失败。",
          6,
          {
            result: check,
          },
        );
      await verifyInventory(staged, manifest.files, {
        exclude: ["manifest.json"],
      });
    });
    await operation.stage("publish-complete-backup", async () => {
      try {
        await rename(staged, destination);
      } catch (error) {
        if (!(await exists(destination))) throw error;
        const existing = await readJson(join(destination, "manifest.json"));
        if (JSON.stringify(existing) !== JSON.stringify(manifest))
          throw new EnvironmentError(
            "另一操作已创建同名备份，请使用新的 backup 标识。",
            4,
            { backup },
          );
        await verifyInventory(destination, manifest.files, {
          exclude: ["manifest.json"],
        });
        await rm(staged, { recursive: true });
      }
    });
    return {
      backup,
      backupDirectory: destination,
      manifest,
      reused: false,
      operationId: operation.operationId,
      evidencePath: operation.path,
    };
  } catch (error) {
    if (
      error instanceof EnvironmentError &&
      [3, 4, 6, 130].includes(error.exitCode)
    )
      throw error;
    throw new EnvironmentError(
      "环境备份失败，请查看最后完成的阶段并使用新的备份标识重试。",
      6,
      {
        cause: error.message,
        temporaryDirectory: staged,
        evidencePath: operation.path,
      },
    );
  }
}

async function preserveCurrentState(env, operation, identity) {
  await assertOwnedPath(env.root, env.paths.backups);
  await assertOwnedPath(env.root, env.paths.data);
  await mkdir(env.paths.backups, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(
    join(env.paths.backups, `.restore-${operation.operationId}-`),
  );
  await chmod(directory, 0o700);
  const diagnosticPath = join(directory, "diagnostic.json");
  try {
    const dataPresent = await exists(env.paths.data);
    if (dataPresent) {
      const files = await inventoryDirectory(env.paths.data, {
        allowExternalSymlinks: true,
      });
      await cp(env.paths.data, join(directory, "data"), {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        preserveTimestamps: true,
      });
      const copied = await inventoryDirectory(join(directory, "data"), {
        allowExternalSymlinks: true,
      });
      if (JSON.stringify(files) !== JSON.stringify(copied))
        throw new EnvironmentError(
          "原始数据文件在保全期间发生变化，请停止写入后重试恢复。",
          4,
        );
      for (const item of files)
        if (
          item.type === "file" &&
          !(await sameFile(
            join(env.paths.data, item.path),
            join(directory, "data", item.path),
          ))
        )
          throw new EnvironmentError(
            "原始数据文件复制后字节不一致，请停止写入后重试恢复。",
            4,
            { path: item.path },
          );
    }
    const configuration = await copyConfiguration(env, directory);
    await assertUnchanged(env, identity);
    let diagnostics;
    try {
      const secretsFile = join(directory, "configuration/secrets.env");
      const secrets = (await exists(secretsFile))
        ? parseEnv(await readFile(secretsFile, "utf8"))
        : {};
      const diagnosticEnv = backupValidationEnvironment(env, secrets);
      const diagnosticData = join(operation.work, "before-state-diagnostic");
      await mkdir(diagnosticData, { recursive: true, mode: 0o700 });
      const databasePath = join(diagnosticData, env.storage.databaseFile);
      for (const suffix of ["", "-wal", "-shm"]) {
        const source = join(
          directory,
          "data",
          env.storage.databaseFile + suffix,
        );
        if (await exists(source)) await cp(source, databasePath + suffix);
      }
      const result = await runDatabaseCommand(diagnosticEnv, "status", {
        databasePath,
        dataDirectory: join(directory, "data"),
        outputPath: diagnosticPath,
      });
      diagnostics = { status: "reported", result };
    } catch (error) {
      if (error.exitCode === 130) throw error;
      diagnostics = {
        status: "unavailable",
        exitCode: error.exitCode ?? 6,
        result: error.details?.result ?? null,
      };
      await writeJson(diagnosticPath, diagnostics);
    }
    await assertUnchanged(env, identity);
    const manifestPath = join(directory, "manifest.json");
    await writeJson(manifestPath, {
      version: 1,
      kind: "environment-state-snapshot",
      status: "preserved",
      environment: env.name,
      root: env.root,
      capturedAt: new Date().toISOString(),
      operationId: operation.operationId,
      dataPresent,
      configuration,
      sourceIdentity: identity,
      diagnostics,
      files: await inventoryDirectory(directory, {
        allowExternalSymlinks: true,
      }),
    });
    return { directory, manifestPath, diagnosticPath };
  } catch (error) {
    if (error instanceof EnvironmentError) {
      error.details = { ...error.details, snapshotDirectory: directory };
      throw error;
    }
    throw new EnvironmentError(
      "操作前原始状态保全失败。请查看快照目录、停止写入并修正读取权限后重试恢复。",
      6,
      { reason: error.code ?? error.name, snapshotDirectory: directory },
    );
  }
}

async function assertDevelopmentSource(env, manifest, operation) {
  if ((await sourceCommit(env, operation)) !== manifest.commit)
    throw new EnvironmentError(
      "dev 当前源码提交与备份不一致，请先切换到备份记录的提交。",
      3,
      { commit: manifest.commit },
    );
  const dirty = await runCommand(
    env,
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd: env.sourceRoot, logPath: join(operation.work, "source.log") },
  );
  if (dirty)
    throw new EnvironmentError(
      "dev 受版本控制的文件存在未提交改动，请先整理源码再恢复。",
      3,
    );
}

export async function restoreEnvironment(
  env,
  { backup, release, preview = false, authorization, operationId, signal } = {},
) {
  env = { ...env, signal: signal ?? env.signal };
  assertNotAborted(env.signal);
  assertIdentifier(backup, "backup");
  await assertEnvironmentStopped(env);
  const operation = await beginOperation(env, "restore", operationId);
  const directory = await backupLocation(env, backup);
  const manifest = await readJson(join(directory, "manifest.json"));
  let prepared, originalRelease;
  if (env.mode === "release") {
    if (!release)
      throw new EnvironmentError(
        "发布环境恢复需要与备份配套的发布标识，请通过 --release <releaseId> 指定匹配产物。",
        3,
      );
    if (manifest.release && manifest.release !== release)
      throw new EnvironmentError(
        "--release 指定的发布标识与备份清单的 release 不一致。请选择备份配套的发布标识，再执行 restore --preview。",
        3,
      );
    prepared = await prepareRelease(env, {
      release,
      operationId: operation.operationId,
    });
    if (prepared.manifest.commit !== manifest.commit)
      throw new EnvironmentError(
        "目标产物的源码提交与备份清单不一致。请选择备份配套的产物，再执行 restore --preview。",
        3,
      );
  }
  const valid = await validateBackup(env, backup, operation, {
    apiDirectory: prepared?.apiDirectory,
  });
  const targets = [
    env.paths.data,
    env.paths.applicationEnv,
    env.paths.secretsEnv,
  ];
  if (preview)
    return {
      preview: true,
      environment: env.name,
      backup,
      release: release ?? null,
      createdAt: manifest.createdAt,
      targets,
      operationId: operation.operationId,
      evidencePath: operation.path,
    };
  if (!authorization)
    throw new EnvironmentError(
      "恢复会替换当前数据，请通过 --authorization <授权JSON> 提供授权记录。格式见 docs/environment-operations.md 第 6.2 节。",
      3,
    );
  const approval = await readJson(resolve(authorization));
  if (
    approval.approved !== true ||
    approval.environment !== env.name ||
    approval.backup !== backup ||
    approval.release !== (release ?? null)
  )
    throw new EnvironmentError(
      "恢复授权记录尚未确认，或记录中的环境、备份、发布标识与本次恢复不一致。请核对 --preview 结果，并按 docs/environment-operations.md 第 6.2 节取得并保存对应授权。",
      3,
    );
  if (env.mode === "development")
    await assertDevelopmentSource(env, manifest, operation);
  else originalRelease = await getSourceState(env, operation);
  const identity = await dataIdentity(env);
  const previousSnapshot = await operation.stage(
    "preserve-current-raw-state",
    () => preserveCurrentState(env, operation, identity),
  );
  await assertUnchanged(env, identity);
  const staged = await mkdtemp(
    join(env.root, `.restore-${operation.operationId}-`),
  );
  const rollback = join(staged, "previous");
  await mkdir(rollback, { mode: 0o700 });
  await chmod(staged, 0o700);
  const swaps = [];
  let releaseChanged = false;
  let after;
  const replace = async (target, source, previous) => {
    assertNotAborted(env.signal);
    await assertOwnedPath(env.root, target);
    await mkdir(dirname(previous), { recursive: true, mode: 0o700 });
    const swap = {
      target,
      previous,
      existed: await exists(target),
      installed: false,
    };
    if (swap.existed) await rename(target, previous);
    swaps.push(swap);
    if (source) {
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      swap.installed = true;
    }
  };
  try {
    await operation.stage("prepare-restored-data", async () => {
      await cp(join(directory, "data"), join(staged, "data"), {
        recursive: true,
        dereference: false,
      });
      if (await exists(join(directory, "configuration")))
        await cp(
          join(directory, "configuration"),
          join(staged, "configuration"),
          { recursive: true },
        );
      const status = await runDatabaseCommand(valid.validationEnv, "status", {
        apiDirectory: prepared?.apiDirectory,
        databasePath: join(staged, "data", env.storage.databaseFile),
        dataDirectory: join(staged, "data"),
        outputPath: join(operation.work, "staged-database.json"),
      });
      if (
        !status.ready ||
        !status.integrity?.ok ||
        !status.foreignKeys?.ok ||
        status.fileReferences?.ok !== true ||
        status.profileSecrets?.ok !== true
      )
        throw new EnvironmentError(
          "恢复候选目录未通过数据库与文件引用验证。",
          6,
          { status },
        );
      await assertUnchanged(env, identity);
      if (env.mode === "development")
        await assertDevelopmentSource(env, manifest, operation);
    });
    await operation.stage("replace-data-and-configuration", async () => {
      await replace(
        env.paths.data,
        join(staged, "data"),
        join(rollback, "data"),
      );
      for (const [key, name] of privateConfigurationFiles) {
        const source = join(staged, "configuration", name);
        await replace(
          env.paths[key],
          (await exists(source)) ? source : null,
          join(rollback, "configuration", name),
        );
        if (await exists(env.paths[key])) await chmod(env.paths[key], 0o600);
      }
    });
    if (prepared) {
      await activatePreparedRelease(env, prepared, operation, originalRelease);
      releaseChanged = true;
    }
    after = await operation.stage("verify-restored-environment", async () => {
      const status = await runDatabaseCommand(valid.validationEnv, "status", {
        apiDirectory: prepared?.apiDirectory,
        databasePath: env.paths.database,
        dataDirectory: env.paths.data,
        outputPath: join(operation.work, "restored-database.json"),
      });
      if (
        !status.ready ||
        !status.integrity?.ok ||
        !status.foreignKeys?.ok ||
        status.fileReferences?.ok !== true ||
        status.profileSecrets?.ok !== true
      )
        throw new EnvironmentError("恢复后的数据库与文件引用未通过验证。", 6, {
          status,
        });
      return status;
    });
  } catch (error) {
    const recovery = [];
    if (releaseChanged) {
      try {
        await restoreReleaseState(
          env,
          originalRelease,
          operation,
          prepared.release,
        );
      } catch (failure) {
        recovery.push({ target: "current", reason: failure.message });
      }
    }
    for (const swap of swaps.reverse()) {
      try {
        if (swap.installed)
          await rm(swap.target, { recursive: true, force: true });
        if (swap.existed) await rename(swap.previous, swap.target);
      } catch (failure) {
        recovery.push({ target: swap.target, reason: failure.message });
      }
    }
    throw new EnvironmentError(
      "环境恢复失败，服务保持停止。请查看阶段记录和操作前原始快照，核对原始目录的恢复结果。",
      recovery.length
        ? 6
        : [4, 130].includes(error.exitCode)
          ? error.exitCode
          : 6,
      {
        cause: error.message,
        previousSnapshot,
        recovery,
        temporaryDirectory: staged,
        evidencePath: operation.path,
      },
    );
  }
  let cleanup = { status: "complete" };
  try {
    await operation.stage("cleanup-previous-directories", () =>
      rm(staged, { recursive: true }),
    );
  } catch (error) {
    cleanup = {
      status: "pending",
      directory: staged,
      reason: error.code ?? error.message,
    };
  }
  return {
    environment: env.name,
    backup,
    release: release ?? null,
    previousSnapshot,
    stopped: true,
    after,
    cleanup,
    operationId: operation.operationId,
    evidencePath: operation.path,
  };
}
