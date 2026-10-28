import { isMainThread } from "node:worker_threads";

export function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, {
    ...context,
    conditions: [...context.conditions, "development"],
  });
}

if (isMainThread) {
  try {
    const { register: registerLoader } = await import("node:module");
    const { register } = await import("tsx/esm/api");
    const { fileURLToPath } = await import("node:url");
    register({
      tsconfig: fileURLToPath(
        new URL("../../../../tsconfig.json", import.meta.url),
      ),
    });
    registerLoader(import.meta.url);
    const { runCli } = await import("./cli.ts");
    await runCli();
  } catch (error) {
    try {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const directory = await mkdtemp(join(tmpdir(), "native-card-cli-"));
      const diagnosticFile = join(directory, "result.json");
      await writeFile(
        diagnosticFile,
        JSON.stringify({
          command: process.argv[2],
          passed: false,
          data: {
            error: String(error),
            action: "恢复CLI文件及已安装的tsx运行环境后重试。",
          },
        }),
      );
      process.stderr.write(JSON.stringify({ diagnosticFile }) + "\n");
    } catch {
      process.stderr.write(
        '{"code":"CLI_LOAD_FAILED","action":"检查CLI文件、tsx运行环境和临时目录权限后重试。"}\n',
      );
    }
    process.exitCode = 1;
  }
}
