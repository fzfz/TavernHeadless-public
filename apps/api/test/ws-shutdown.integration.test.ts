import http from "node:http";
import type { Socket } from "node:net";
import { describe, expect, it } from "vitest";

import { buildTestApp } from "./helpers/create-test-db.js";

describe("rejected WebSocket upgrades during API shutdown", () => {
  it.each([
    { name: "missing credentials", key: undefined, path: "/ws", status: 401 },
    {
      name: "invalid credentials",
      key: "invalid-key",
      path: "/ws",
      status: 403,
    },
    {
      name: "inaccessible session",
      key: "shutdown-test-key",
      path: "/ws?session_id=missing-session",
      status: 404,
    },
  ])(
    "closes after $name without waiting for a peer",
    async ({ key, path, status }) => {
      const { app } = await buildTestApp({
        databasePath: ":memory:",
        logger: false,
        auth: { mode: "api_key", apiKeys: ["shutdown-test-key"] },
        enableWebSocket: true,
        orchestration: {
          providers: [
            {
              id: "local",
              type: "openai-compatible",
              apiKey: "local-test-only",
              baseURL: "http://127.0.0.1:1",
            },
          ],
          defaultModel: { providerId: "local", modelId: "local-test" },
        },
      });
      const sockets = new Set<Socket>();
      app.server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      let closePromise: Promise<void> | undefined;
      let timer: NodeJS.Timeout | undefined;
      try {
        const origin = await app.listen({ host: "127.0.0.1", port: 0 });
        const response = await new Promise<{
          status: number | undefined;
          body: string;
        }>((resolve, reject) => {
          const request = http.get(
            origin + path,
            {
              agent: false,
              headers: {
                Connection: "Upgrade",
                Upgrade: "websocket",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
                ...(key ? { "x-api-key": key } : {}),
              },
            },
            (reply) => {
              let body = "";
              reply.setEncoding("utf8");
              reply.on("data", (chunk: string) => {
                body += chunk;
              });
              reply.once("error", reject);
              reply.once("end", () => {
                request.destroy();
                resolve({ status: reply.statusCode, body });
              });
            },
          );
          request.once("error", reject);
          request.once("upgrade", (_reply, socket) => {
            socket.destroy();
            reject(new Error("The unauthorized upgrade was accepted"));
          });
          request.setTimeout(2000, () =>
            request.destroy(new Error("Upgrade response timed out")),
          );
        });
        expect(response.status).toBe(status);
        expect(JSON.parse(response.body)).toHaveProperty("error");
        closePromise = app.close();
        const closed = await Promise.race([
          closePromise.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 1500);
          }),
        ]);
        expect(closed).toBe(true);
      } finally {
        clearTimeout(timer);
        for (const socket of sockets) socket.destroy();
        await (closePromise ?? app.close());
      }
    },
  );
});
