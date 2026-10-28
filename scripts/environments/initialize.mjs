import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertOwnedPath } from "./config.mjs";
import { EnvironmentError } from "./errors.mjs";
import { verifyTools } from "./tools.mjs";
import { writePublicConfiguration } from "./public-config.mjs";
import { writeNginxConfig } from "./nginx.mjs";
import { assertEnvironmentStopped } from "./processes.mjs";

const execute = promisify(execFile);
const git = async (cwd, args) =>
  (await execute("git", ["-C", cwd, ...args])).stdout.trim();

export async function initializeEnvironment(env, options = {}) {
  await verifyTools(env);
  await assertEnvironmentStopped(env);
  const created = [];
  let existing = true;
  try {
    await access(join(env.root, ".git"));
  } catch {
    existing = false;
  }
  if (!existing) {
    if (env.name === "dev" && !env.sandbox)
      throw new EnvironmentError(
        "dev 根目录必须是 TavernHeadless 源码仓库。",
        3,
      );
    let commit = await git(env.sourceRoot, ["rev-parse", "HEAD"]);
    if (env.mode === "release") {
      if (!options.release)
        throw new EnvironmentError(
          "发布环境初始化需要 --release <发布标识>。",
          2,
        );
      const artifact = join(
        env.environmentRoots.dev,
        env.configuration.defaults.layout.artifacts,
        options.release,
      );
      await assertOwnedPath(env.environmentRoots.dev, artifact);
      const manifest = JSON.parse(
        await readFile(join(artifact, env.files.manifest), "utf8"),
      );
      if (
        manifest.release !== options.release ||
        !/^[a-f0-9]{40}$/.test(manifest.commit)
      )
        throw new EnvironmentError("发布清单中的标识或提交无效。", 5);
      commit = manifest.commit;
    }
    await git(env.sourceRoot, [
      "worktree",
      "add",
      "--detach",
      env.root,
      commit,
    ]);
    created.push(env.root);
  }
  const expected = await realpath(
    await git(env.sourceRoot, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  );
  const actual = await realpath(
    await git(env.root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  );
  if (expected !== actual)
    throw new EnvironmentError(
      "目标目录属于其他 Git 仓库，请核对环境根目录。",
      3,
    );
  for (const key of [
    "config",
    "publicConfig",
    "data",
    "releases",
    "buildWork",
    "artifacts",
    "run",
    "processLogs",
    "operations",
    "backups",
  ]) {
    await assertOwnedPath(env.root, env.paths[key]);
    await mkdir(env.paths[key], {
      recursive: true,
      mode: key === "backups" ? 0o700 : 0o755,
    });
  }
  for (const [key, template] of [
    ["applicationEnv", "application.env.example"],
    ["secretsEnv", "secrets.env.example"],
  ]) {
    const content = await readFile(
      join(env.sourceRoot, "config/environments", template),
    );
    await mkdir(dirname(env.paths[key]), { recursive: true });
    try {
      await writeFile(env.paths[key], content, { flag: "wx", mode: 0o600 });
      created.push(env.paths[key]);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  if (env.mode === "development") await writePublicConfiguration(env);
  await writeNginxConfig(env);
  return {
    environment: env.name,
    root: env.root,
    created,
    configuration: [env.paths.applicationEnv, env.paths.secretsEnv],
    state: "stopped",
  };
}
