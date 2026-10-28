#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  glob,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

import { EnvironmentError } from "./errors.mjs";

const execute = promisify(execFile);
const policyPath = "scripts/environments/installation-policy.json";
const { parse: parseYaml } = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)("yaml");

function workspacePackagePaths(workspace, paths) {
  if (
    !Array.isArray(workspace.packages) ||
    workspace.packages.some(
      (pattern) => typeof pattern !== "string" || !pattern,
    )
  )
    throw new EnvironmentError(
      "工作区包路径配置无效，请核对标签中的 pnpm-workspace.yaml。",
      3,
    );
  const included = workspace.packages.filter(
    (pattern) => !pattern.startsWith("!"),
  );
  const excluded = workspace.packages
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  return paths.filter(
    (path) =>
      path !== "package.json" &&
      path.endsWith("/package.json") &&
      !path.split("/").includes("node_modules") &&
      included.some((pattern) => matchesGlob(dirname(path), pattern)) &&
      !excluded.some((pattern) => matchesGlob(dirname(path), pattern)),
  );
}

function installationRequirements(pkg, policy, workspace, packages) {
  if (
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.rootScripts) ||
    policy.rootScripts.some((name) => typeof name !== "string" || !name) ||
    !policy.dependencyScripts ||
    Array.isArray(policy.dependencyScripts)
  )
    throw new EnvironmentError(
      "安装脚本配置无效，请核对标签中的 installation-policy.json。",
      3,
    );
  const allowed = workspace.onlyBuiltDependencies;
  if (
    !Array.isArray(allowed) ||
    allowed.some((name) => typeof name !== "string" || !name) ||
    JSON.stringify([...allowed].sort()) !==
      JSON.stringify(Object.keys(policy.dependencyScripts).sort())
  )
    throw new EnvironmentError(
      "installation-policy.json 的依赖集合与标签 pnpm-workspace.yaml 的 onlyBuiltDependencies 不一致。请补齐对应脚本映射，再重新生成安装授权 JSON。",
      3,
    );
  const lifecycleScripts = [];
  for (const item of [pkg, ...packages]) {
    if (typeof item.name !== "string" || !item.name)
      throw new EnvironmentError(
        "工作区包缺少名称，请核对标签中的 package.json，再重新生成安装授权 JSON。",
        3,
      );
    lifecycleScripts.push(
      ...policy.rootScripts
        .filter((name) => Object.hasOwn(item.scripts ?? {}, name))
        .map((name) => `${item.name}:${name}`),
    );
  }
  for (const [name, scripts] of Object.entries(policy.dependencyScripts)) {
    if (
      !Array.isArray(scripts) ||
      !scripts.length ||
      scripts.some((script) => typeof script !== "string" || !script)
    )
      throw new EnvironmentError(
        "依赖安装脚本配置无效，请核对标签中的 installation-policy.json。",
        3,
        { package: name },
      );
    lifecycleScripts.push(...scripts.map((script) => `${name}:${script}`));
  }
  const nodeVersion = pkg.engines?.node;
  const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(
    pkg.packageManager ?? "",
  )?.[1];
  if (
    typeof nodeVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(nodeVersion) ||
    !pnpmVersion
  )
    throw new EnvironmentError(
      "标签中的工具版本不精确，请在 package.json 填写完整 Node 版本和 pnpm@版本后重新批准标签。",
      3,
    );
  return {
    nodeVersion,
    pnpmVersion,
    lifecycleScripts: [...new Set(lifecycleScripts)].sort(),
  };
}

export async function readInstallationRequirements(source) {
  try {
    const [pkg, policy, workspace] = await Promise.all([
      readFile(join(source, "package.json"), "utf8").then(JSON.parse),
      readFile(join(source, policyPath), "utf8").then(JSON.parse),
      readFile(join(source, "pnpm-workspace.yaml"), "utf8").then(parseYaml),
    ]);
    const paths = [];
    for await (const path of glob("**/package.json", {
      cwd: source,
      exclude: ["**/node_modules/**", ".git/**"],
    }))
      paths.push(path);
    const packages = await Promise.all(
      workspacePackagePaths(workspace, paths).map((path) =>
        readFile(join(source, path), "utf8").then(JSON.parse),
      ),
    );
    return installationRequirements(pkg, policy, workspace, packages);
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    throw new EnvironmentError(
      "标签源码的安装配置无法读取。请核对 pnpm-workspace.yaml、installation-policy.json 和各工作区 package.json，再重新生成授权 JSON。",
      3,
    );
  }
}

export async function generateInstallationApproval({
  source,
  ref,
  output,
  approved = false,
}) {
  if (
    typeof ref !== "string" ||
    !ref ||
    ref.startsWith("-") ||
    /[\s\0]/.test(ref) ||
    !output
  )
    throw new EnvironmentError(
      "请提供已批准标签和 JSON 输出路径。示例：node scripts/environments/installation-approval.mjs --ref v1.0.0 --output /tmp/installation-approval.json。",
      2,
    );
  source = resolve(source ?? fileURLToPath(new URL("../../", import.meta.url)));
  const git = async (args) =>
    (
      await execute("git", args, {
        cwd: source,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  let commit, pkg, policy, workspace, packages;
  try {
    await git(["check-ref-format", `refs/tags/${ref}`]);
    commit = await git(["rev-parse", "--verify", `refs/tags/${ref}^{commit}`]);
    [pkg, policy, workspace] = await Promise.all([
      git(["show", `${commit}:package.json`]).then(JSON.parse),
      git(["show", `${commit}:${policyPath}`]).then(JSON.parse),
      git(["show", `${commit}:pnpm-workspace.yaml`]).then(parseYaml),
    ]);
    const paths = (await git(["ls-tree", "-rz", "--name-only", commit])).split(
      "\0",
    );
    packages = await Promise.all(
      workspacePackagePaths(workspace, paths).map((path) =>
        git(["show", `${commit}:${path}`]).then(JSON.parse),
      ),
    );
  } catch {
    throw new EnvironmentError(
      "标签或安装脚本配置无法读取，请核对本地 Git 标签及标签内的 package.json、installation-policy.json，再重新生成授权 JSON。",
      3,
      { ref },
    );
  }
  const approval = {
    approved: approved === true,
    ref,
    commit,
    ...installationRequirements(pkg, policy, workspace, packages),
  };
  output = resolve(output);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(approval, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, output);
  return { outputPath: output, approved: approval.approved };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        ref: { type: "string" },
        output: { type: "string" },
        source: { type: "string" },
        approved: { type: "boolean", default: false },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      process.stdout.write(
        "生成标签安装授权 JSON：node scripts/environments/installation-approval.mjs --ref <tag> --output <JSON>\n--ref (string；必填) 本地 Git 标签\n--output (string；必填) JSON 输出路径\n--source (string；可选) Git 仓库目录；默认当前脚本所属仓库\n--approved (boolean；可选；默认 false) 记录已取得的安装授权；须先获得对应标签、工具和脚本的授权\n",
      );
      return 0;
    }
    const result = await generateInstallationApproval(values);
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write(error.message + "\n");
    return error.exitCode ?? 2;
  }
}

if (
  process.argv[1] &&
  (await realpath(process.argv[1])) ===
    (await realpath(fileURLToPath(import.meta.url)))
)
  process.exitCode = await main();
