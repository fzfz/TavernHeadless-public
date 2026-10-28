import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/create-test-db.js";
import { loadStorageConfig } from "../src/storage-config.js";
import { DEFAULT_ADMIN_ACCOUNT_ID as accountId } from "../src/accounts/constants.js";
import {
  characters,
  characterVersions,
  sessions,
  floors,
  floorRunStates,
  messagePages,
  messages,
} from "../src/db/schema.js";
import { DisplaySnapshotService } from "../src/services/role-runtime/display-snapshot-service.js";

let app: FastifyInstance | undefined;
let root: string;
afterEach(async () => {
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

it("delivers fixed files and persisted role snapshots through the standard application across a restart", async () => {
  root = await mkdtemp(join(tmpdir(), "role-view-api-"));
  const storage = loadStorageConfig({ DATA_DIR: root });
  let built = await buildTestApp({
    databasePath: storage.databasePath,
    storage,
    logger: false,
    auth: { mode: "off" },
  });
  app = built.app;
  const db = built.database;
  db.insert(characters)
    .values({
      id: "character",
      accountId,
      name: "Role",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  db.insert(characterVersions)
    .values({
      id: "version",
      characterId: "character",
      versionNo: 1,
      dataJson: "{}",
      contentHash: "fixture",
      createdAt: 1,
    })
    .run();
  const file = (name: string, purpose: string, text: string) => ({
    name,
    purpose,
    mime: "text/plain",
    base64: Buffer.from(text).toString("base64"),
  });
  const imported = await app.inject({
    method: "POST",
    url: "/role-assets/version",
    payload: {
      character_id: "character",
      files: [
        file(
          "manifest.json",
          "manifest",
          JSON.stringify({
            apiVersion: 1,
            html: "view.html",
            css: "view.css",
            script: "main.js",
            assets: {},
            data: {},
          }),
        ),
        file("view.html", "template", "<p>Role</p>"),
        file("view.css", "template", "p{}"),
        file("main.js", "browser_script", "export {}"),
      ],
    },
  });
  expect(imported.statusCode, imported.body).toBe(201);
  db.insert(sessions)
    .values({
      id: "session",
      accountId,
      characterId: "character",
      characterVersionId: "version",
      title: "Role",
      characterSnapshotJson: JSON.stringify({
        extensions: {
          tavern_headless: {
            openings: {
              items: [{ id: "first", displayText: "Welcome", variables: {} }],
            },
          },
        },
      }),
      metadataJson: JSON.stringify({ opening_id: "first" }),
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  new DisplaySnapshotService(db).initialize(accountId, "session", { score: 1 });
  db.insert(floors)
    .values({
      id: "floor",
      sessionId: "session",
      floorNo: 1,
      state: "committed",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  db.insert(messagePages)
    .values({
      id: "page-floor",
      floorId: "floor",
      pageNo: 1,
      pageKind: "mixed",
      isActive: true,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  db.insert(messages)
    .values([
      {
        id: "user-message",
        pageId: "page-floor",
        seq: 1,
        role: "user",
        content: "Hello",
        createdAt: 1,
      },
      {
        id: "assistant-message",
        pageId: "page-floor",
        seq: 2,
        role: "assistant",
        content: "Welcome",
        createdAt: 1,
      },
    ])
    .run();
  db.insert(floorRunStates)
    .values({
      floorId: "floor",
      runId: "run",
      runType: "respond",
      status: "completed",
      phase: "transaction_committed",
      publicPhase: "committing",
      startedAt: 1,
      updatedAt: 1,
    })
    .run();
  const before = await app.inject("/sessions/session/role-view");
  expect(before.statusCode, before.body).toBe(200);
  expect(before.json().data).toMatchObject({
    delivery: {
      html: "<p>Role</p>",
      scriptUrl: "/role-assets/version/main.js",
      data: { opening: "Welcome" },
    },
    processing: { pendingStateFloorId: "floor" },
    capabilities: { send: false },
  });
  const update = await app.inject({
    method: "POST",
    url: "/sessions/session/role-state/updates",
    payload: { floor_id: "floor" },
  });
  expect(update.statusCode, update.body).toBe(200);
  const snapshot = update.json().data;
  expect(snapshot.variables).toEqual({ score: 1 });
  expect(
    (
      await app.inject(
        `/sessions/session/role-view/snapshots/${snapshot.snapshotId}`,
      )
    ).json().data,
  ).toEqual(snapshot);
  const snapshotPage = await app.inject(
    "/sessions/session/role-view/snapshots?branch_id=main",
  );
  expect(snapshotPage.statusCode, snapshotPage.body).toBe(200);
  expect(snapshotPage.json().data).toMatchObject({
    items: [
      { snapshotId: snapshot.snapshotId, floorId: "floor", attemptId: "run:1" },
      { floorId: null, attemptId: null },
    ],
    nextCursor: null,
  });
  const floorPage = await app.inject(
    "/sessions/session/role-messages/floors?branch_id=main",
  );
  expect(floorPage.statusCode, floorPage.body).toBe(200);
  expect(floorPage.json().data).toEqual({
    items: [{ floorId: "floor", floorNo: 1, state: "committed" }],
    nextCursor: null,
  });
  expect(
    (
      await app.inject(
        "/sessions/session/role-messages?branch_id=main&floor_id=floor",
      )
    ).json().data,
  ).toEqual([
    { id: "user-message", role: "user", source: null, content: "Hello" },
    {
      id: "assistant-message",
      role: "assistant",
      source: null,
      content: "Welcome",
    },
  ]);
  expect(
    (await app.inject("/sessions/session/role-view/floors/floor")).statusCode,
  ).toBe(404);
  expect((await app.inject("/sessions/foreign/role-view")).statusCode).toBe(
    404,
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/sessions/session/role-state/updates",
        payload: {},
      })
    ).statusCode,
  ).toBe(400);
  await app.close();
  built = await buildTestApp({
    databasePath: storage.databasePath,
    storage,
    logger: false,
    auth: { mode: "off" },
  });
  app = built.app;
  const restored = await app.inject("/sessions/session/role-view");
  expect(restored.json().data).toMatchObject({
    current: snapshot,
    capabilities: { send: true },
    processing: { pendingStateFloorId: null },
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/sessions/session/role-state/updates",
        payload: { floor_id: "floor" },
      })
    ).json().data,
  ).toEqual(snapshot);
});
