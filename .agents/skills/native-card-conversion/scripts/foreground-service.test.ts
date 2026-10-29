import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runForegroundService } from "./foreground-service.ts";

let directory: string;
let initialExitCode: typeof process.exitCode;
let initialListeners: { interrupt: number; terminate: number };
let output: string[];
let errors: string[];
let onReady: () => void;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "foreground-service-"));
  initialExitCode = process.exitCode;
  initialListeners = {
    interrupt: process.listenerCount("SIGINT"),
    terminate: process.listenerCount("SIGTERM"),
  };
  output = [];
  errors = [];
  onReady = () => process.emit("SIGTERM");
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    const text = String(chunk);
    output.push(text);
    if (JSON.parse(text).resultFile.includes("/ready/")) onReady();
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errors.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = initialExitCode;
  await rm(directory, { recursive: true, force: true });
  expect(process.listenerCount("SIGINT")).toBe(initialListeners.interrupt);
  expect(process.listenerCount("SIGTERM")).toBe(initialListeners.terminate);
});

function service() {
  return {
    command: "replay-fixture" as const,
    callDirectory: directory,
    ready: { status: "listening", baseUrl: "http://127.0.0.1" },
    close: vi.fn(async () => {}),
    snapshot: vi.fn(() => ({ completed: 1 })),
    failure: { describe: String, action: "检查服务关闭记录。" },
  };
}

it.each(["SIGINT", "SIGTERM"] as const)(
  "closes once for repeated signals beginning with %s during readiness and shutdown",
  async (signal) => {
    const running = service();
    onReady = () => {
      process.emit(signal);
      process.emit("SIGINT");
      process.emit("SIGTERM");
    };
    let closed = false;
    running.close.mockImplementation(async () => {
      process.emit("SIGINT");
      process.emit("SIGTERM");
      await Promise.resolve();
      closed = true;
    });
    running.snapshot.mockImplementation(() => ({ completed: Number(closed) }));
    await runForegroundService(running);
    expect(running.close).toHaveBeenCalledOnce();
    expect(output).toHaveLength(2);
    expect(errors).toEqual([]);
    expect(process.exitCode).toBe(initialExitCode);
    const result = JSON.parse(
      await readFile(JSON.parse(output[1]!).resultFile, "utf8"),
    );
    expect(result).toMatchObject({
      passed: true,
      data: { status: "stopped", signal, completed: 1 },
    });
  },
);

it("releases the service when the ready result cannot be saved", async () => {
  const running = service();
  await writeFile(join(directory, "ready"), "block directory");
  await runForegroundService(running);
  expect(running.close).toHaveBeenCalledOnce();
  expect(running.snapshot).not.toHaveBeenCalled();
  expect(output).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(JSON.parse(errors[0]!)).toMatchObject({ code: "EEXIST" });
  expect(process.exitCode).toBe(1);
});

it("releases the service and reports a short error when the closed result cannot be saved", async () => {
  const running = service();
  await writeFile(join(directory, "closed"), "block directory");
  await runForegroundService(running);
  expect(running.close).toHaveBeenCalledOnce();
  expect(output).toHaveLength(1);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.length).toBeLessThan(1024);
  expect(JSON.parse(errors[0]!)).toMatchObject({ code: "EEXIST" });
  expect(process.exitCode).toBe(1);
});

it("saves a close failure diagnostic and returns without repeating close", async () => {
  const running = service();
  running.close.mockRejectedValue(new Error("close failed"));
  await runForegroundService(running);
  expect(running.close).toHaveBeenCalledOnce();
  expect(running.snapshot).not.toHaveBeenCalled();
  expect(output).toHaveLength(1);
  expect(errors).toHaveLength(1);
  const result = JSON.parse(
    await readFile(JSON.parse(errors[0]!).diagnosticFile, "utf8"),
  );
  expect(result).toMatchObject({
    passed: false,
    data: { error: "Error: close failed", action: running.failure.action },
  });
  expect(process.exitCode).toBe(1);
});
