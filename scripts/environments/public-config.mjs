import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { assertOwnedPath } from "./config.mjs";
import { EnvironmentError } from "./errors.mjs";

export async function writePublicConfiguration(
  env,
  { releaseDirectory = env.paths.current } = {},
) {
  const development = env.mode === "development";
  if (!development) {
    await assertOwnedPath(env.root, releaseDirectory);
    await assertOwnedPath(
      await realpath(env.paths.releases),
      await realpath(releaseDirectory),
    );
  }
  const shared = development
    ? join(env.sourceRoot, "packages/shared/dist")
    : join(releaseDirectory, "api/node_modules/@tavern/shared/dist");
  const policyFile = env.publicConfigurationFiles.resourcePolicy;
  const sourcePolicy = join(
    env.sourceRoot,
    "apps",
    policyFile.frontend,
    "public/config",
    policyFile.filename,
  );
  const policyPath = development
    ? sourcePolicy
    : join(
        releaseDirectory,
        policyFile.frontend,
        "config",
        policyFile.filename,
      );
  const repairPolicy = development
    ? `请修改源配置 ${sourcePolicy}，再重新生成公开配置。`
    : `请修改源配置 ${sourcePolicy}，重新构建新发布归档，再部署至 ${env.name}。`;
  let schemas, validators;
  try {
    schemas = await import(
      pathToFileURL(join(shared, "schemas/role-user-web.js")).href
    );
    validators = await import(
      pathToFileURL(join(shared, "generated/role-runtime-validators.js")).href
    );
  } catch (cause) {
    throw new EnvironmentError(
      development
        ? "请先执行 pnpm --filter @tavern/shared build，生成前端配置契约。"
        : "发布产物缺少前端配置契约，请验证归档并重新部署。",
      3,
      { cause: cause.code },
    );
  }
  let policy;
  try {
    policy = JSON.parse(await readFile(policyPath, "utf8"));
  } catch (cause) {
    throw new EnvironmentError(
      `运行策略 ${policyPath} 的根字段 / 无法读取为 JSON。${repairPolicy}`,
      2,
      { policyPath, cause: cause.code ?? cause.name },
    );
  }
  if (!validators.resourcePolicy(policy)) {
    const errors = validators.resourcePolicy.errors;
    const fields = errors.map((error) =>
      [
        error.instancePath || "/",
        error.params.additionalProperty ?? error.params.missingProperty,
      ]
        .filter(Boolean)
        .join("/")
        .replaceAll("//", "/"),
    );
    throw new EnvironmentError(
      `运行策略 ${policyPath} 的字段 ${[...new Set(fields)].join("、")} 不符合共享契约。${repairPolicy}`,
      2,
      { policyPath, errors },
    );
  }
  const origin = (frontend) =>
    `http://${env.hostname}:${env.ports.frontends[frontend].http}`;
  const values = {
    roleAdminWeb: schemas.roleAdminWebConfigSchema.parse({
      userWebBaseUrl: origin("user-web"),
    }),
    roleUserWeb: schemas.roleUserWebConfigSchema.parse({
      apiBaseUrl: "/api",
      adminBaseUrl: origin("web"),
    }),
    resourcePolicy: policy,
  };
  const paths = [];
  for (const [key, file] of Object.entries(env.publicConfigurationFiles)) {
    const target = await assertOwnedPath(
      env.root,
      join(env.paths.publicConfig, file.frontend, file.filename),
    );
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(values[key], null, 2)}\n`, {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporary, target);
    paths.push(target);
  }
  return paths;
}
