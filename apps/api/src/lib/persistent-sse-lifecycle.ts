import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

export function createPersistentSseLifecycle(app: FastifyInstance) {
  const subscriptions = new Set<() => void>();
  let closing = false;

  app.addHook("preClose", async () => {
    closing = true;
    for (const close of subscriptions) close();
  });

  return {
    track(response: ServerResponse, dispose: () => void): () => void {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        subscriptions.delete(close);
        response.removeListener("close", close);
        try {
          dispose();
        } finally {
          if (!response.destroyed && !response.writableEnded) response.end();
        }
      };

      subscriptions.add(close);
      response.once("close", close);
      if (closing || response.destroyed || response.writableEnded) close();
      return close;
    },
  };
}
