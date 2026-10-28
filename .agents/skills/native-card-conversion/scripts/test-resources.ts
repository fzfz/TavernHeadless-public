import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { onTestFinished, vi } from "vitest";
import testRuntime from "./test-runtime.json" with { type: "json" };

export { testRuntime };
const execute = promisify(execFile);
const current = new AsyncLocalStorage<TestResources>();
vi.setConfig({ hookTimeout: testRuntime.cleanupTimeoutMs + 1000 });

export class TestResources {
  private directories = new Set<string>();
  private cleanup: Array<() => void | Promise<void>> = [];
  private children = new Set<Promise<void>>();
  private work: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;

  private options: Pick<
    typeof testRuntime,
    "cleanupTimeoutMs" | "processTimeoutMs"
  >;

  constructor(
    options: Partial<
      Pick<typeof testRuntime, "cleanupTimeoutMs" | "processTimeoutMs">
    > = {},
  ) {
    this.options = { ...testRuntime, ...options };
  }

  addDirectory(path: string) {
    this.directories.add(path);
  }
  defer(cleanup: () => void | Promise<void>) {
    this.cleanup.push(cleanup);
  }

  run<T>(body: () => Promise<T>): Promise<T> {
    const work = Promise.resolve().then(body);
    this.work = work.catch(() => {});
    return work;
  }

  trackChild(child: ChildProcess): void {
    const stopped = new Promise<void>((resolve) => {
      const timer = setTimeout(
        () => child.kill("SIGKILL"),
        this.options.processTimeoutMs,
      );
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.children.add(stopped);
    void stopped.then(() => this.children.delete(stopped));
  }

  async measure<T>(stage: string, body: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await body();
    } finally {
      if (process.env.CI)
        console.info(
          JSON.stringify({
            stage,
            durationMs: Math.round(performance.now() - started),
          }),
        );
    }
  }

  async execute(file: string, args: string[]) {
    const running = execute(file, args, {
      timeout: this.options.processTimeoutMs,
      killSignal: "SIGKILL",
    });
    this.trackChild(running.child);
    return this.measure(`cli:${args[1] ?? "entry"}`, () => running);
  }

  close(): Promise<void> {
    return (this.closing ??= this.dispose());
  }

  private async dispose(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.work.then(() => Promise.all(this.children)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Test work is still active; retained directories: ${[...this.directories].join(", ")}`,
                ),
              ),
            this.options.cleanupTimeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    for (const cleanup of [...this.cleanup].reverse()) await cleanup();
    await Promise.all(
      [...this.directories].map((path) =>
        rm(path, { recursive: true, force: true }),
      ),
    );
  }
}

export function testResources(): TestResources {
  const resources = current.getStore();
  if (!resources)
    throw new Error(
      "Wrap this test with withTestResources before creating resources.",
    );
  return resources;
}

export function withTestResources<Args extends unknown[]>(
  body: (...args: Args) => Promise<void>,
) {
  return (...args: Args) => {
    const resources = new TestResources();
    onTestFinished(() => resources.close());
    return current.run(resources, () => resources.run(() => body(...args)));
  };
}
