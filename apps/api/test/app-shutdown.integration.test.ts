import { get, type IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createTestProject } from "../src/__tests__/helpers/workspace-project.js";
import { characters, characterVersions, sessions } from "../src/db/schema.js";
import { DisplaySnapshotService } from "../src/services/role-runtime/display-snapshot-service.js";
import { buildTestApp, type BuildAppResult } from "./helpers/create-test-db.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function openResponse(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    get(url, { agent: false }, resolve).once("error", reject);
  });
}

function seedRoleSession({ database }: BuildAppResult): void {
  database
    .insert(characters)
    .values({
      id: "shutdown-character",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Shutdown fixture",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  database
    .insert(characterVersions)
    .values({
      id: "shutdown-version",
      characterId: "shutdown-character",
      versionNo: 1,
      dataJson: "{}",
      contentHash: "fixture",
      createdAt: 1,
    })
    .run();
  database
    .insert(sessions)
    .values({
      id: "shutdown-session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      characterId: "shutdown-character",
      characterVersionId: "shutdown-version",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  new DisplaySnapshotService(database).initialize(
    DEFAULT_ADMIN_ACCOUNT_ID,
    "shutdown-session",
    { hp: 1 },
  );
}

async function listen(app: FastifyInstance): Promise<string> {
  return app.listen({ host: "127.0.0.1", port: 0 });
}

describe("application shutdown over TCP", () => {
  it.each(["role state", "project events"])(
    "ends the %s subscription and closes without a client disconnect",
    async (kind) => {
      const built = await buildTestApp({
        logger: false,
        auth: { mode: "off" },
      });
      const { app } = built;
      const project = createTestProject(built.database, {
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      });
      seedRoleSession(built);
      const address = await listen(app);
      let response: IncomingMessage | undefined;
      let closing: Promise<void> | undefined;
      try {
        response = await openResponse(
          `${address}${
            kind === "role state"
              ? "/sessions/shutdown-session/role-state/events?branch_id=main"
              : `/projects/${project.projectId}/events/stream`
          }`,
        );
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toContain("text/event-stream");
        response.resume();
        let closed = false;
        closing = app.close().then(() => {
          closed = true;
        });
        await vi.waitFor(
          () => {
            expect(closed).toBe(true);
            expect(response!.complete).toBe(true);
          },
          { timeout: 1500 },
        );
      } finally {
        response?.destroy();
        await (closing ?? app.close());
      }
    },
  );

  it("closes both subscriptions and WebSocket while finite HTTP and SSE responses finish", async () => {
    const built = await buildTestApp({
      logger: false,
      auth: { mode: "off" },
      enableWebSocket: true,
      orchestration: {
        providers: [
          { id: "fixture", type: "openai-compatible", apiKey: "fixture" },
        ],
        defaultModel: { providerId: "fixture", modelId: "fixture" },
      },
    });
    const { app } = built;
    const project = createTestProject(built.database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    });
    seedRoleSession(built);
    const finish = deferred();
    const httpStarted = deferred();
    const stopping = deferred();
    app.addHook("preClose", async () => {
      stopping.resolve();
    });
    app.get("/shutdown-test/http", async () => {
      httpStarted.resolve();
      await finish.promise;
      return { completed: true };
    });
    app.get("/shutdown-test/finite-sse", async (_request, reply) => {
      reply.hijack();
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.write("event: chunk\ndata: first\n\n");
      await finish.promise;
      reply.raw.end("event: done\ndata: complete\n\n");
    });
    const address = await listen(app);

    const responses: IncomingMessage[] = [];
    let socket: WebSocket | undefined;
    let closing: Promise<void> | undefined;
    try {
      for (const path of [
        "/sessions/shutdown-session/role-state/events?branch_id=main",
        `/projects/${project.projectId}/events/stream`,
      ]) {
        const response = await openResponse(address + path);
        expect(response.statusCode).toBe(200);
        response.resume();
        responses.push(response);
      }

      const finiteSse = await openResponse(
        `${address}/shutdown-test/finite-sse`,
      );
      responses.push(finiteSse);
      let finiteWire = "";
      finiteSse.on("data", (chunk) => {
        finiteWire += chunk.toString();
      });
      const httpResponse = openResponse(`${address}/shutdown-test/http`);
      await httpStarted.promise;

      socket = new WebSocket(`${address.replace("http:", "ws:")}/ws`);
      await new Promise<void>((resolve, reject) => {
        socket!.addEventListener("open", () => resolve(), { once: true });
        socket!.addEventListener("error", reject, { once: true });
      });

      let closed = false;
      closing = app.close().then(() => {
        closed = true;
      });
      await stopping.promise;

      await vi.waitFor(() => {
        expect(
          responses.slice(0, 2).every((response) => response.complete),
        ).toBe(true);
        expect(socket!.readyState).toBe(WebSocket.CLOSED);
      });

      expect(closed).toBe(false);
      expect(finiteSse.complete).toBe(false);
      finish.resolve();

      const completedHttp = await httpResponse;
      responses.push(completedHttp);
      let httpBody = "";
      for await (const chunk of completedHttp) httpBody += chunk.toString();
      expect(JSON.parse(httpBody)).toEqual({ completed: true });

      await vi.waitFor(() => {
        expect(closed).toBe(true);
        expect(finiteSse.complete).toBe(true);
      });
      expect(finiteWire).toBe(
        "event: chunk\ndata: first\n\nevent: done\ndata: complete\n\n",
      );
      await app.close();
    } finally {
      finish.resolve();
      socket?.close();
      for (const response of responses) response.destroy();
      await (closing ?? app.close());
    }
  });
});
