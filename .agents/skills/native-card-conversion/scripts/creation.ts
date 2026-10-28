import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import runtime from "./runtime.json" with { type: "json" };

type CreationRecord = {
  command: string;
  inputs: unknown;
  status: "starting" | "listening" | "complete" | "failed" | "closed";
  data?: unknown;
};
const activeCreation = new AsyncLocalStorage<{
  directory: string;
  record: CreationRecord;
}>();
async function update(status: CreationRecord["status"], data: unknown) {
  const current = activeCreation.getStore();
  if (!current) return;
  current.record = { ...current.record, status, data };
  await writeFile(
    join(current.directory, "creation.json"),
    JSON.stringify(current.record),
  );
}
export const markCreationReady = (data: unknown) => update("listening", data);
export const markCreationClosed = (data: unknown) => update("closed", data);

export async function withCreation<T>(
  root: string,
  command: string,
  requestId: string | undefined,
  inputs: unknown,
  operation: () => Promise<T>,
  waitMs = runtime.creationWaitMs,
): Promise<T | unknown> {
  requestId ??= randomUUID();
  const parent = join(root, "creations", command),
    directory = join(parent, requestId);
  await mkdir(parent, { recursive: true });
  let owner = false;
  try {
    await mkdir(directory);
    owner = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const file = join(directory, "creation.json");
  if (!owner) {
    const deadline = Date.now() + waitMs;
    do {
      let record: CreationRecord | undefined;
      try {
        record = JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" &&
          !(error instanceof SyntaxError)
        )
          throw error;
      }
      if (record) {
        if (
          !isDeepStrictEqual(record.inputs, inputs) ||
          record.command !== command
        )
          throw new Error(
            `request-id输入冲突：${directory}。请沿用原参数，或用新的UUID创建。`,
          );
        if (record.status === "listening") {
          const data = record.data as { url?: string; baseUrl?: string };
          const address = data?.url ?? data?.baseUrl;
          try {
            if (!address || new URL(address).hostname !== "127.0.0.1")
              throw new Error("创建记录缺少本机服务地址");
            await fetch(address, { signal: AbortSignal.timeout(3000) });
          } catch (error) {
            throw new Error(
              `request-id服务不可访问：${directory}。请检查原服务；已结束时使用新的UUID启动。`,
              { cause: error },
            );
          }
        }
        if (record.status === "complete" || record.status === "listening")
          return record.data;
        if (record.status !== "starting")
          throw new Error(
            `request-id状态为${record.status}：${directory}。请读取creation.json诊断，修正后使用新的UUID。`,
          );
      }
      if (Date.now() >= deadline) break;
      await new Promise((done) =>
        setTimeout(done, Math.min(50, Math.max(0, deadline - Date.now()))),
      );
    } while (Date.now() <= deadline);
    throw new Error(
      `等待request-id结果超时：${directory}。请读取creation.json检查原调用；已终止的调用需使用新的UUID。`,
    );
  }
  const record: CreationRecord = {
    command,
    inputs,

    status: "starting",
  };
  await writeFile(file, JSON.stringify(record));
  return activeCreation.run({ directory, record }, async () => {
    try {
      const result = await operation();
      if (activeCreation.getStore()!.record.status === "starting")
        await update(
          result &&
            typeof result === "object" &&
            "passed" in result &&
            result.passed === false
            ? "failed"
            : "complete",
          result,
        );
      return result;
    } catch (error) {
      await update("failed", {
        error: String(error),
        action: "修正输入或环境后使用新的UUID。",
      });
      throw error;
    }
  });
}
