import publicConfigurationFiles from "../../packages/shared/src/config/public-configuration-files.json" with { type: "json" };
import { readFile, readlink, realpath, stat } from "node:fs/promises";
import {
  resolve,
  dirname,
  join,
  relative,
  isAbsolute,
  basename,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import { execFile } from "node:child_process";
import Ajv from "ajv";

import { EnvironmentError } from "./errors.mjs";

export const sourceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function primaryWorktree(repository) {
  const gitEntry = await stat(join(repository, ".git")).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!gitEntry) return repository;
  const { stdout } = await promisify(execFile)(
    "git",
    ["-C", repository, "worktree", "list", "--porcelain", "-z"],
    { encoding: "utf8" },
  );
  const first = stdout.split("\0")[0];
  if (!first.startsWith("worktree ")) {
    throw new EnvironmentError(
      "无法定位 Git 主工作区。请运行 git worktree list 核对仓库目录后重试。",
      3,
    );
  }
  return first.slice("worktree ".length);
}

export async function loadEnvironment(name, options = {}) {
  const repository = options.sourceRoot ?? sourceRoot;
  const runtimeConfigPath = join(
    await primaryWorktree(repository),
    "config/environments.json",
  );
  const configPath =
    options.configPath ??
    (options.sandboxRoot
      ? join(repository, "config/environments.example.json")
      : runtimeConfigPath);
  const configuration = JSON.parse(
    await readFile(configPath, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      throw new EnvironmentError(
        `缺少环境配置 ${configPath}。请将 config/environments.example.json 复制为 config/environments.json，填写本机根目录、主机名和工具路径后重试。`,
        3,
        { configPath },
      );
    }),
  );
  const schema = JSON.parse(
    await readFile(join(repository, "config/environments.schema.json"), "utf8"),
  );
  const validate = new Ajv({ allErrors: true }).compile(schema);
  if (!validate(configuration)) {
    const failures = validate.errors.map((error) => {
      const parts = error.instancePath.split("/").filter(Boolean);
      const property =
        error.params.additionalProperty ?? error.params.missingProperty;
      if (property) parts.push(property);
      const field = parts.join(".");
      const value = parts.reduce((parent, key) => parent?.[key], configuration);
      return `${field}=${JSON.stringify(value)}（${error.message}）`;
    });
    throw new EnvironmentError(
      `环境配置格式错误：${failures.join("；")}。请修改 ${configPath} 中的对应字段。`,
      2,
      { configPath, errors: validate.errors },
    );
  }
  if (options.sandboxRoot) {
    const runtimeText = await readFile(runtimeConfigPath, "utf8").catch(
      (error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (runtimeText !== undefined) {
      const runtimeConfiguration = JSON.parse(runtimeText);
      if (!validate(runtimeConfiguration)) {
        throw new EnvironmentError(
          `本机环境配置 ${runtimeConfigPath} 格式错误。请按 config/environments.schema.json 修正字段后重试隔离验证。`,
          2,
          { configPath: runtimeConfigPath, errors: validate.errors },
        );
      }
      await validateLocations(
        runtimeConfiguration,
        repository,
        options.sandboxRoot,
        runtimeConfigPath,
      );
    }
  }
  await validateLocations(
    configuration,
    repository,
    options.sandboxRoot,
    configPath,
  );
  const selected = configuration.environments[name];
  if (!selected)
    throw new EnvironmentError(
      `环境 ${name} 无效。可用值：${Object.keys(configuration.environments).join("、")}。示例：node scripts/environments/cli.mjs status --env dev`,
    );
  const defaults = configuration.defaults;
  const root = options.sandboxRoot
    ? resolve(options.sandboxRoot, configuration.verification.rootNames[name])
    : selected.root;
  if (options.sandboxRoot && configuration.verification.portOffset) {
    selected.ports.api += configuration.verification.portOffset;
    for (const frontend of Object.values(selected.ports.frontends)) {
      frontend.http += configuration.verification.portOffset;
      frontend.dev += configuration.verification.portOffset;
    }
  }
  const paths = Object.fromEntries(
    Object.entries(defaults.layout).map(([key, value]) => [
      key,
      resolve(root, value),
    ]),
  );
  const [storage, nativeCard] = await Promise.all(
    ["storage", "native-card"].map(async (name) =>
      JSON.parse(
        await readFile(
          join(repository, "apps/api/config", name + ".json"),
          "utf8",
        ),
      ),
    ),
  );
  const storageConfigPath = join(repository, "apps/api/config/storage.json");
  const nativeCardConfigPath = join(
    repository,
    "apps/api/config/native-card.json",
  );
  const dataSettings = {
    database: [storageConfigPath, "databaseFile", storage.databaseFile],
    databaseWal: [
      storageConfigPath,
      "databaseFile",
      storage.databaseFile + "-wal",
    ],
    databaseShm: [
      storageConfigPath,
      "databaseFile",
      storage.databaseFile + "-shm",
    ],
    roleAssets: [storageConfigPath, "roleAssetsDir", storage.roleAssetsDir],
    roleAssetStaging: [
      storageConfigPath,
      "roleAssetStagingDir",
      storage.roleAssetStagingDir,
    ],
    chatTransferArtifacts: [
      storageConfigPath,
      "chatTransferArtifactDir",
      storage.chatTransferArtifactDir,
    ],
    backupArtifacts: [
      storageConfigPath,
      "backupArtifactDir",
      storage.backupArtifactDir,
    ],
    nativeCards: [nativeCardConfigPath, "storageRoot", nativeCard.storageRoot],
    nativeCardImports: [
      nativeCardConfigPath,
      "importStagingRoot",
      nativeCard.importStagingRoot,
    ],
    nativeCardBuilds: [nativeCardConfigPath, "buildRoot", nativeCard.buildRoot],
  };
  for (const [key, path] of Object.entries(paths))
    await assertOwnedPath(root, path, {
      configPath,
      field: `defaults.layout.${key}`,
      value: defaults.layout[key],
    });
  for (const [key, [settingPath, field, value]] of Object.entries(
    dataSettings,
  )) {
    paths[key] = await assertOwnedPath(paths.data, resolve(paths.data, value), {
      configPath: settingPath,
      field,
      value,
    });
  }
  const physical = await Promise.all(
    [
      "config",
      "data",
      "releases",
      "buildWork",
      "artifacts",
      "run",
      "processLogs",
      "operations",
      "backups",
    ].map(async (key) => [key, await physicalPath(paths[key])]),
  );
  for (const [index, [key, left]] of physical.entries()) {
    for (const [other, right] of physical.slice(index + 1)) {
      if (contains(left, right) || contains(right, left))
        throw directoryOverlap(
          defaults.layout,
          configPath,
          key,
          other,
          left,
          right,
        );
    }
  }
  const packageJson = JSON.parse(
    await readFile(join(repository, "package.json"), "utf8"),
  );
  const hostEnv = Object.fromEntries(
    defaults.hostVariables
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  const application = await readEnvironmentFile(paths.applicationEnv);
  const secrets = await readEnvironmentFile(paths.secretsEnv);
  for (const key of Object.keys(application)) {
    if (
      defaults.managedVariables.includes(key) ||
      defaults.secretVariables.includes(key) ||
      defaults.hostVariables.includes(key)
    ) {
      throw new EnvironmentError(
        `请从 ${paths.applicationEnv} 移除 ${key}。密钥写入 ${paths.secretsEnv}；管理值由 config/environments.json 派生，主机变量由启动 shell 提供。`,
      );
    }
  }
  for (const key of Object.keys(secrets)) {
    if (!defaults.secretVariables.includes(key))
      throw new EnvironmentError(
        `请从 ${paths.secretsEnv} 移除不支持的 ${key}。支持的变量名：${defaults.secretVariables.join("、")}。`,
      );
  }
  if (
    Object.keys(secrets).length &&
    (await stat(paths.secretsEnv)).mode & 0o077
  ) {
    throw new EnvironmentError(
      `密钥文件的组或其他用户权限未关闭。请执行 chmod 600 ${paths.secretsEnv} 后重试。`,
      3,
    );
  }
  return {
    ...defaults,
    ...selected,
    name,
    root,
    sourceRoot: repository,
    paths,
    publicConfigurationFiles,
    publicFiles: Object.fromEntries(
      defaults.frontends.map((frontend) => [
        frontend,
        Object.values(publicConfigurationFiles)
          .filter((file) => file.frontend === frontend)
          .map((file) => file.filename),
      ]),
    ),
    storage,
    hostEnv,
    sandbox: Boolean(options.sandboxRoot),
    sandboxRoot: options.sandboxRoot,
    environmentRoots: Object.fromEntries(
      Object.entries(configuration.environments).map(([key, value]) => [
        key,
        options.sandboxRoot
          ? resolve(
              options.sandboxRoot,
              configuration.verification.rootNames[key],
            )
          : value.root,
      ]),
    ),
    secretValues: secretValuesFrom(secrets),
    tools: {
      ...configuration.tools,
      node: {
        ...configuration.tools.node,
        path: process.execPath,
        version: packageJson.engines.node,
      },
      pnpm: {
        ...configuration.tools.pnpm,
        version: packageJson.packageManager.split("@").at(-1),
      },
    },
    runtimeEnv: {
      ...hostEnv,
      ...application,
      ...secrets,
      PORT: String(selected.ports.api),
      HOST: defaults.listenHost,
      USER_SESSION_COOKIE_NAME: selected.sessionCookieName,
      USER_SESSION_COOKIE_SECURE: String(selected.sessionCookieSecure),
      NODE_ENV: selected.mode === "development" ? "development" : "production",
      DATA_DIR: paths.data,
      DATABASE_URL: paths.database,
      TAVERN_ENVIRONMENT: name,
      TAVERN_LOG_DIR: join(paths.processLogs, "debug"),
      CHAT_TRANSFER_ARTIFACT_DIR: paths.chatTransferArtifacts,
      BACKUP_ARTIFACT_DIR: paths.backupArtifacts,
    },
    uploadMaxBytes: storage.roleAssetMaxUploadBytes * 2,
    configuration,
  };
}

async function physicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      const target = await readlink(path);
      return physicalPath(
        isAbsolute(target) ? target : dirname(path) + sep + target,
      );
    } catch (linkError) {
      if (!["ENOENT", "EINVAL"].includes(linkError.code)) throw linkError;
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await physicalPath(parent), basename(path));
  }
}

function contains(root, target) {
  const suffix = relative(root, target);
  return (
    suffix === "" ||
    (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(".." + sep))
  );
}

export async function assertOwnedPath(
  root,
  path,
  { configPath, field, value } = {},
) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  if (
    !contains(absoluteRoot, absolutePath) ||
    !contains(
      await physicalPath(absoluteRoot),
      await physicalPath(absolutePath),
    )
  ) {
    const setting = field
      ? `${field}=${JSON.stringify(value)}（${path}）`
      : path;
    const repair = field
      ? `请修改 ${configPath} 中的 ${field}，或修正 ${path} 的符号链接，使目标位于 ${root} 内。`
      : `请使用 ${root} 内的路径，并修正 ${path} 的符号链接目标。`;
    throw new EnvironmentError(`路径超出环境目录：${setting}。${repair}`, 3);
  }
  return absolutePath;
}

async function readEnvironmentFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const key = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)?.[1];
    if (!key || keys.has(key))
      throw new EnvironmentError(
        `${path} 必须每行定义一个变量，并使用唯一变量名。`,
      );
    keys.add(key);
  }
  return parseEnv(text);
}

function directoryOverlap(layout, configPath, key, other, left, right) {
  return new EnvironmentError(
    `目录职责重叠：defaults.layout.${key}=${JSON.stringify(layout[key])}（${left}）与 defaults.layout.${other}=${JSON.stringify(layout[other])}（${right}）。请修改 ${configPath} 中这两个字段，或修正对应符号链接，使目录互不包含。`,
  );
}

async function validateLocations(
  configuration,
  repository,
  sandboxRoot,
  configPath,
) {
  const environments = Object.entries(configuration.environments);
  const roots = await Promise.all(
    environments.map(async ([name, environment]) => [
      name,
      await physicalPath(resolve(environment.root)),
    ]),
  );
  for (const [index, [first, left]] of roots.entries()) {
    for (const [second, right] of roots.slice(index + 1)) {
      if (contains(left, right) || contains(right, left))
        throw new EnvironmentError(
          `环境根目录重叠：environments.${first}.root=${JSON.stringify(configuration.environments[first].root)}（${left}）与 environments.${second}.root=${JSON.stringify(configuration.environments[second].root)}（${right}）。请修改 ${configPath} 中这两个字段，使用互不包含的绝对目录。`,
        );
    }
  }
  if (sandboxRoot) {
    const example =
      "示例：node scripts/environments/cli.mjs verify --env dev --suite unit --sandbox /tmp/tavern-environments-verification";
    if (!isAbsolute(sandboxRoot))
      throw new EnvironmentError(
        `验证目录 --sandbox=${JSON.stringify(sandboxRoot)} 必须是绝对路径。${example}`,
      );
    const sandbox = await physicalPath(sandboxRoot);
    for (const [field, root] of [
      ...roots.map(([name, root]) => [`environments.${name}.root`, root]),
      ["sourceRoot", await physicalPath(repository)],
    ]) {
      if (contains(root, sandbox) || contains(sandbox, root))
        throw new EnvironmentError(
          `验证目录 --sandbox=${JSON.stringify(sandboxRoot)}（${sandbox}）与 ${field}=${JSON.stringify(root)} 重叠。请将 --sandbox 改为与源码及环境根目录互不包含的绝对目录。${example}`,
        );
    }
  }
  const ports = new Set();
  const identifiers = {
    processPrefix: new Map(),
    sessionCookieName: new Map(),
  };
  for (const [name, environment] of environments) {
    if (environment.mode !== (name === "dev" ? "development" : "release"))
      throw new EnvironmentError(
        `environments.${name}.mode=${JSON.stringify(environment.mode)} 与环境职责不符。请修改 ${configPath} 中该字段为 ${name === "dev" ? "development" : "release"}。`,
      );
    for (const port of [
      environment.ports.api,
      ...Object.values(environment.ports.frontends).flatMap((value) =>
        Object.values(value),
      ),
    ]) {
      const actual =
        port + (sandboxRoot ? configuration.verification.portOffset : 0);
      if (ports.has(actual) || actual > 65535)
        throw new EnvironmentError(
          `环境端口冲突或超出范围：${actual}。请修改 ${configPath} 中 environments.${name}.ports，使用 1 至 65535 内未被其他环境使用的端口，并核对 verification.portOffset。`,
        );
      ports.add(actual);
    }
    for (const [field, values] of Object.entries(identifiers)) {
      const value = environment[field];
      const previous = values.get(value);
      if (previous)
        throw new EnvironmentError(
          `环境标识重复：environments.${name}.${field}=${JSON.stringify(value)} 与 environments.${previous}.${field}=${JSON.stringify(value)}。请修改 ${configPath} 中任一字段，使各环境的 ${field} 唯一。`,
        );
      values.set(value, name);
    }
  }
  const layout = configuration.defaults.layout;
  for (const [key, value] of Object.entries(layout)) {
    if (value.split("/").includes(".."))
      throw new EnvironmentError(
        `目录配置包含越界路径：defaults.layout.${key}=${JSON.stringify(value)}。请修改 ${configPath} 中该字段，使用环境根目录内、不含 .. 的相对路径。`,
      );
  }
  const independent = [
    "data",
    "releases",
    "current",
    "buildWork",
    "artifacts",
    "run",
    "processLogs",
    "operations",
    "backups",
    "config",
  ];
  for (const [index, key] of independent.entries()) {
    for (const other of independent.slice(index + 1)) {
      const left = resolve("/", layout[key]),
        right = resolve("/", layout[other]);
      if (contains(left, right) || contains(right, left))
        throw directoryOverlap(layout, configPath, key, other, left, right);
    }
  }
}

export function secretValuesFrom(secrets) {
  const values = Object.values(secrets);
  values.push(
    ...(secrets.AUTH_API_KEYS ?? "").split(",").map((value) => value.trim()),
  );
  values.push(
    ...(secrets.AUTH_API_KEY_ACCOUNTS ?? "")
      .split(",")
      .map((value) => value.split(":")[0].trim()),
  );
  return [...new Set(values.filter(Boolean))];
}
