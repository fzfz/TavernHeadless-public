import { get, type IncomingMessage } from "node:http";
import { expect, it, vi } from "vitest";

import { buildTestApp } from "../../test/helpers/create-test-db.js";
import { createPersistentSseLifecycle } from "./persistent-sse-lifecycle.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function openStream(address: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    get(`${address}/subscription`, { agent: false }, resolve).once(
      "error",
      reject,
    );
  });
}

it("disposes a disconnected subscription once across repeated cleanup and application close", async () => {
  const { app } = await buildTestApp({ logger: false, auth: { mode: "off" } });
  const lifecycle = createPersistentSseLifecycle(app);
  let disposed = 0;
  let close = () => {};
  app.get("/subscription", (_request, reply) => {
    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.flushHeaders();
    close = lifecycle.track(reply.raw, () => {
      disposed += 1;
    });
  });
  let response: IncomingMessage | undefined;
  try {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    response = await openStream(address);
    response.destroy();
    await vi.waitFor(() => expect(disposed).toBe(1));
    close();
    close();
    await app.close();
    expect(disposed).toBe(1);
  } finally {
    response?.destroy();
    await app.close();
  }
});

it("immediately disposes a subscription registered after application shutdown begins", async () => {
  const { app } = await buildTestApp({ logger: false, auth: { mode: "off" } });
  const lifecycle = createPersistentSseLifecycle(app);
  const register = deferred();
  const stopping = deferred();
  let disposed = 0;
  app.addHook("preClose", async () => {
    stopping.resolve();
  });
  app.get("/subscription", async (_request, reply) => {
    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.flushHeaders();
    await register.promise;
    lifecycle.track(reply.raw, () => {
      disposed += 1;
    });
  });
  let response: IncomingMessage | undefined;
  let closing: Promise<void> | undefined;
  try {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    response = await openStream(address);
    response.resume();
    let closed = false;
    closing = app.close().then(() => {
      closed = true;
    });
    await stopping.promise;
    register.resolve();
    await vi.waitFor(() => {
      expect(closed).toBe(true);
      expect(response!.complete).toBe(true);
    });
    expect(disposed).toBe(1);
  } finally {
    register.resolve();
    response?.destroy();
    await (closing ?? app.close());
  }
});
