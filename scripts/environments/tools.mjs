import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EnvironmentError } from "./errors.mjs";

const execute = promisify(execFile);

export async function verifyTools(env, names = ["node", "pnpm", "nginx"]) {
  const results = {};
  for (const name of names) {
    const tool = env.tools[name];
    let output;
    try {
      const result = await execute(
        tool.path,
        [name === "nginx" ? "-v" : "--version"],
        { env: env.hostEnv, timeout: 10000 },
      );
      output = `${result.stdout}${result.stderr}`.trim();
    } catch {
      throw new EnvironmentError(
        `找不到可用的 ${name}。请先安装已批准的 ${tool.version}，再核对 config/environments.json 中的工具路径。`,
        3,
      );
    }
    const version = output.match(/(?:^|[^0-9])(\d+\.\d+\.\d+)(?:\s|$)/)?.[1];
    if (version !== tool.version)
      throw new EnvironmentError(
        `${name} 版本为 ${version ?? output}，要求 ${tool.version}。请切换到已批准版本后重试。`,
        3,
      );
    results[name] = { path: tool.path, version };
  }
  return results;
}
