import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import runtime from "./runtime.json" with { type: "json" };
const callContext = new AsyncLocalStorage<string>();
export const withCallContext = <T>(directory: string, operation: () => T): T =>
  callContext.run(directory, operation);
export const getCallDirectory = () => callContext.getStore();
export async function createCallDirectory(root: string): Promise<string> {
  const parent = join(root, "calls");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "call-"));
}
export async function saveTextParts(
  text: string,
  directory: string,
  partBytes = runtime.resultPartBytes,
) {
  if (!Number.isSafeInteger(partBytes) || partBytes < 4)
    throw new RangeError(
      "resultPartBytes必须为不小于4的整数。请修正工具配置后重试。",
    );
  if (Buffer.byteLength(text) <= partBytes) return { partCount: 0 };
  const partsDirectory = join(directory, "parts");
  await mkdir(partsDirectory, { recursive: true });
  let buffer = "",
    bytes = 0,
    partCount = 0;
  const flush = async () => {
    await writeFile(
      join(partsDirectory, `part-${String(++partCount).padStart(6, "0")}.txt`),
      buffer,
    );
    buffer = "";
    bytes = 0;
  };
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > partBytes) await flush();
    buffer += character;
    bytes += size;
  }
  if (buffer) await flush();
  return { partsDirectory, partCount };
}
type ResultReference = {
  resultFile?: string;
  diagnosticFile?: string;
  bytes: number;
  partsDirectory?: string;
  partCount: number;
};
export async function saveCommandResult(
  command: string,
  data: unknown,
  directory: string,
  passed = true,
): Promise<ResultReference> {
  await mkdir(directory, { recursive: true });
  const resultFile = join(directory, "result.json");
  const text = JSON.stringify({ command, passed, data }, null, 2) + "\n";
  await writeFile(resultFile, text);
  const parts = await saveTextParts(text, directory);
  return {
    ...(passed ? { resultFile } : { diagnosticFile: resultFile }),
    bytes: Buffer.byteLength(text),
    ...parts,
  };
}
export async function emitCommandResult(
  command: string,
  data: unknown,
  directory: string,
  passed = true,
) {
  try {
    const ref = await saveCommandResult(command, data, directory, passed);
    (passed ? process.stdout : process.stderr).write(
      JSON.stringify(ref) + "\n",
    );
    if (!passed) process.exitCode = 1;
    return ref;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "RESULT_SAVE_FAILED";
    process.stderr.write(
      JSON.stringify({
        code,
        directory,
        action: "检查结果目录的写入权限与磁盘空间后重试。",
      }) + "\n",
    );
    process.exitCode = 1;
    return undefined;
  }
}
