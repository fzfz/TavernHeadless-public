import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { TestResources } from "./test-resources.ts";

it("finishes the full operation before restoring mocks and deleting its directory", async () => {
  const resources = new TestResources();
  const root = await mkdtemp(join(tmpdir(), "test-resource-"));
  resources.addDirectory(root);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const restore = vi.fn();
  resources.defer(restore);
  const work = resources.run(async () => {
    await gate;
    await writeFile(join(root, "result"), "finished");
    expect(restore).not.toHaveBeenCalled();
  });
  const closed = resources.close();
  expect(restore).not.toHaveBeenCalled();
  release();
  await work;
  await closed;
  expect(restore).toHaveBeenCalledOnce();
  await expect(readFile(join(root, "result"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("keeps the directory and cleanup callbacks when work exceeds the cleanup deadline", async () => {
  const resources = new TestResources({ cleanupTimeoutMs: 10 });
  const root = await mkdtemp(join(tmpdir(), "test-resource-"));
  resources.addDirectory(root);
  await writeFile(join(root, "result"), "pending");
  let release!: () => void;
  const restore = vi.fn();
  resources.defer(restore);
  const work = resources.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    await expect(resources.close()).rejects.toThrow(root);
    expect(restore).not.toHaveBeenCalled();
    expect(await readFile(join(root, "result"), "utf8")).toBe("pending");
  } finally {
    release();
    await work;
    await rm(root, { recursive: true, force: true });
  }
});

it("waits for a timed-out child to close before releasing resources", async () => {
  const resources = new TestResources({ processTimeoutMs: 50 });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const stopped = once(child, "close");
  resources.trackChild(child);
  const restore = vi.fn(() => expect(child.signalCode).toBe("SIGKILL"));
  resources.defer(restore);
  await resources.close();
  expect(await stopped).toEqual([null, "SIGKILL"]);
  expect(restore).toHaveBeenCalledOnce();
});

it("releases resources after a failed operation without replacing its error", async () => {
  const resources = new TestResources();
  const restore = vi.fn();
  resources.defer(restore);
  const error = new Error("operation failed");
  await expect(
    resources.run(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  await resources.close();
  expect(restore).toHaveBeenCalledOnce();
});
