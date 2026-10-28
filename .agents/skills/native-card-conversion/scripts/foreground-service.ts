import { join } from "node:path";
import { markCreationReady, markCreationClosed } from "./creation.ts";
import { emitCommandResult } from "./output.ts";

type ForegroundService = {
  command: "preview" | "replay-fixture";
  callDirectory: string;
  ready: Record<string, unknown>;
  close: () => Promise<void>;
  snapshot: () => Record<string, unknown>;
  failure: { describe: (error: unknown) => string; action: string };
};

export async function runForegroundService(
  service: ForegroundService,
): Promise<void> {
  let receiveSignal!: (signal: "SIGINT" | "SIGTERM") => void;
  const terminated = new Promise<"SIGINT" | "SIGTERM">((resolve) => {
    receiveSignal = resolve;
  });
  const onInterrupt = () => receiveSignal("SIGINT");
  const onTerminate = () => receiveSignal("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    let ready;
    try {
      await markCreationReady(service.ready);
      ready = await emitCommandResult(
        service.command,
        service.ready,
        join(service.callDirectory, "ready"),
      );
    } catch (error) {
      await service.close();
      throw error;
    }
    if (!ready) {
      await service.close();
      await markCreationClosed({ status: "failed", stage: "ready_record" });
      return;
    }

    const signal = await terminated;
    try {
      await service.close();
      const closed = { status: "stopped", signal, ...service.snapshot() };
      await markCreationClosed(closed);
      await emitCommandResult(
        service.command,
        closed,
        join(service.callDirectory, "closed"),
      );
    } catch (error) {
      const data = {
        error: service.failure.describe(error),
        action: service.failure.action,
      };
      await markCreationClosed(data).catch((recordError) => {
        data.error += `；关闭记录保存失败：${service.failure.describe(recordError)}`;
      });
      await emitCommandResult(
        service.command,
        data,
        join(service.callDirectory, "closed"),
        false,
      );
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}
