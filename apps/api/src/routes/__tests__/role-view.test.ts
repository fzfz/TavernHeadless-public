import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ModelCallPersistenceError } from "@tavern/core";
import { buildBranchVariableScopeId } from "@tavern/shared";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { buildTestApp, type BuildAppResult } from "../../../test/helpers/create-test-db.js";
import {
  accounts,
  characters,
  characterVersions,
  floorRunStates,
  floors,
  messagePages,
  messages,
  sessionBranches,
  sessions,
  variables,
} from "../../db/schema.js";
import { buildRestrictedOutputSchema } from "../../services/role-runtime/state-contract.js";
import { StateUpdateService } from "../../services/role-runtime/state-update-service.js";
import { ChatHistoryLoader } from "../../services/chat-history-loader.js";
import { ChatTargetResolver } from "../../services/chat/target-resolver.js";
import { DisplaySnapshotService } from "../../services/role-runtime/display-snapshot-service.js";
import { RoleAssetService } from "../../services/role-runtime/role-asset-service.js";
import { RoleFileStore } from "../../services/storage/role-file-store.js";
import { ModelCallRecordService } from "../../services/model-call-record-service.js";
import { loadModelCallRecordingConfig } from "../../model-call-recording-config.js";
import type { CorsConfig } from "../../plugins/cors.js";
import { loadStorageConfig } from "../../storage-config.js";
const buildStateUpdateSystemPrompt = (
  profile: any,
  files: Record<string, string>,
) => StateUpdateService.prototype["prompt"](profile, files);

const openApps: BuildAppResult[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openApps.splice(0).map((built) => built.app.close()));
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("role view state contract", () => {
  it("opens a registered branch with its inherited role state and readable source messages", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "branch-view", { stateUpdate: false });
    await initialize(built, "branch-view");
    seedFloor(built, { sessionId: "branch-view", floorId: "branch-source", runId: "branch-run" });
    const update = await updateFloor(built, "branch-view", "branch-source");
    expect(update.statusCode, update.body).toBe(200);
    const created = await built.app.inject({ method: "POST", url: "/floors/branch-source/branch", payload: { branch_id: "alternative" } });
    expect(created.statusCode, created.body).toBe(201);
    const retried = await built.app.inject({ method: "POST", url: "/floors/branch-source/branch", payload: { branch_id: "alternative" } });
    expect(retried.statusCode, retried.body).toBe(201);
    expect(retried.json()).toEqual(created.json());
    const response = await built.app.inject({ method: "GET", url: "/sessions/branch-view/role-view?branch_id=alternative" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.current).toMatchObject({ branchId: "alternative", variables: update.json().data.variables });
    const history = await built.app.inject({ method: "GET", url: "/sessions/branch-view/role-messages/floors?branch_id=alternative" });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().data.items).toContainEqual(expect.objectContaining({ floorId: "branch-source" }));
    const body = await built.app.inject({ method: "GET", url: "/sessions/branch-view/role-messages?branch_id=alternative&floor_id=branch-source" });
    expect(body.statusCode, body.body).toBe(200);
    expect(body.json().data.length).toBeGreaterThan(0);
    built.database.update(floors).set({ supersededAt: Date.now() }).where(eq(floors.id, "branch-source")).run();
    seedFloor(built, { sessionId: "branch-view", floorId: "main-replacement", runId: "main-replacement-run" });
    built.database.update(floors).set({ parentFloorId: "branch-source" }).where(eq(floors.id, "main-replacement")).run();
    const pinnedHistory = await built.app.inject({ method: "GET", url: "/sessions/branch-view/role-messages/floors?branch_id=alternative&limit=1" });
    expect(pinnedHistory.statusCode, pinnedHistory.body).toBe(200);
    expect(pinnedHistory.json().data.items).toEqual([expect.objectContaining({floorId:"branch-source"})]);
    const loader = new ChatHistoryLoader(built.database);
    const pinnedEntries = await loader.loadHistoryEntries("branch-view", "alternative");
    expect(pinnedEntries.map(item=>item.floorId)).toContain("branch-source");
    expect(pinnedEntries.map(item=>item.floorId)).not.toContain("main-replacement");
    const target = new ChatTargetResolver(built.database, loader, (code,message)=>Object.assign(new Error(message),{code}));
    const context = await target.resolveRespondBranchContext("branch-view","alternative",undefined,DEFAULT_ADMIN_ACCOUNT_ID);
    expect(context.parentFloorId).toBe("branch-source");
    expect(context.historySourceBranchId).toBe("alternative");
    const mainEntries = await loader.loadHistoryEntries("branch-view", "main");
    expect(mainEntries.map(item=>item.floorId)).toContain("main-replacement");
    expect(mainEntries.map(item=>item.floorId)).not.toContain("branch-source");
    seedFloor(built, { sessionId: "branch-view", floorId: "branch-child", runId: "branch-child-run",branchId:"alternative",floorNo:2 });
    built.database.update(floors).set({parentFloorId:"branch-source"}).where(eq(floors.id,"branch-child")).run();
    const continuedEntries = await loader.loadHistoryEntries("branch-view", "alternative");
    expect([...new Set(continuedEntries.map(item=>item.floorId))]).toEqual(["branch-source","branch-child"]);
    const firstPage = await built.app.inject({method:"GET",url:"/sessions/branch-view/role-messages/floors?branch_id=alternative&limit=1"});
    expect(firstPage.json().data.items).toEqual([expect.objectContaining({floorId:"branch-child"})]);
    const secondPage = await built.app.inject({method:"GET",url:"/sessions/branch-view/role-messages/floors?branch_id=alternative&limit=1&cursor="+encodeURIComponent(firstPage.json().data.nextCursor)});
    expect(secondPage.json().data.items).toEqual([expect.objectContaining({floorId:"branch-source"})]);
    const missing = await built.app.inject({ method: "GET", url: "/sessions/branch-view/role-view?branch_id=unregistered" });
    expect(missing.statusCode).toBe(404);
  });
  it.each([
    { origin: "https://client.example", allowed: "https://client.example", credentials: true },
    { origin: "https://client.example", allowed: "https://client.example", credentials: false },
    { origin: "https://other.example", allowed: undefined, credentials: true },
    { origin: undefined, allowed: undefined, credentials: false },
  ])("preserves the configured CORS policy on state SSE for $origin with credentials=$credentials", async ({ origin, allowed, credentials }) => {
    const built = await buildRoleViewApp(vi.fn(), { origins: ["https://client.example"], credentials });
    await seedRoleSession(built, "cors-session", { stateUpdate: true });
    await initialize(built, "cors-session");
    const response = await built.app.inject({
      method: "GET",
      url: "/sessions/cors-session/role-state/events?branch_id=main",
      headers: origin ? { origin } : {},
      payloadAsStream: true,
    });
    try {
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(response.headers["access-control-allow-origin"]).toBe(allowed);
      if (allowed) {
        expect(response.headers["vary"]).toContain("Origin");
        expect(response.headers["access-control-allow-credentials"]).toBe(credentials ? "true" : undefined);
      }
    } finally {
      response.stream().destroy();
      response.raw.res.destroy();
    }
  });


  it("serves repair actions and persisted operation status through the formal HTTP routes", async () => {
    const generate = vi.fn(async () => ({
      changes: [{ op: "set", path: "/hp", value: 3 }],
      evidenceMessageIds: ["message-assistant-floor-repair"],
    }));
    const built = await buildRoleViewApp(generate);
    await seedRoleSession(built, "session-repair", { stateUpdate: true });
    await initialize(built, "session-repair");
    seedFloor(built, { sessionId: "session-repair", floorId: "floor-repair", runId: "run-repair" });
    const updated = await updateFloor(built, "session-repair", "floor-repair");
    expect(updated.statusCode, updated.body).toBe(200);
    const currentId = updated.json().data.snapshotId as string;
    const recalc = await built.app.inject({ method: "POST", url: "/sessions/session-repair/role-state/recalculate",
      payload: { branch_id: "main", floor_id: "floor-repair", expected_snapshot_id: currentId, operation_id: "http-repair" } });
    expect(recalc.statusCode, recalc.body).toBe(200);
    expect(recalc.json().data).toMatchObject({ operationId: "http-repair", before: { snapshotId: currentId }, after: { variables: { hp: 3 } } });
    const operation = await built.app.inject({ method: "GET", url: "/sessions/session-repair/role-state/operations/http-repair" });
    expect(operation.statusCode, operation.body).toBe(200);
    expect(operation.json().data).toMatchObject({ status: "succeeded", beforeSnapshotId: currentId,
      afterSnapshotId: recalc.json().data.after.snapshotId });
    const restored = await built.app.inject({ method: "POST", url: "/sessions/session-repair/role-state/restore-missing",
      payload: { branch_id: "main", expected_snapshot_id: recalc.json().data.after.snapshotId, operation_id: "http-restore" } });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().data.before.snapshotId).toBe(restored.json().data.after.snapshotId);
    const stale = await built.app.inject({ method: "POST", url: "/sessions/session-repair/role-state/restore-missing",
      payload: { branch_id: "main", expected_snapshot_id: currentId, operation_id: "http-stale" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("ROLE_STATE_REPAIR_STALE");
  });
  it("streams the current state and committed repairs to two clients, and replays HTTP operations without another generation", async () => {
    const generate = vi.fn(async () => ({ changes: [{ op: "set", path: "/hp", value: 3 }], evidenceMessageIds: ["message-assistant-stream-floor"] }));
    const built = await buildRoleViewApp(generate);
    await seedRoleSession(built, "stream-session", { stateUpdate: true });
    await initialize(built, "stream-session");
    seedFloor(built, { sessionId: "stream-session", floorId: "stream-floor", runId: "stream-run" });
    const updated = await updateFloor(built, "stream-session", "stream-floor");
    const current = updated.json().data;
    const responses = await Promise.all([0, 1].map(() => built.app.inject({ method: "GET", url: "/sessions/stream-session/role-state/events?branch_id=main", payloadAsStream: true })));
    const chunks = ["", ""];
    const streams = responses.map((response, index) => {
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");
      const stream = response.stream();
      stream.on("data", (chunk) => { chunks[index] += chunk.toString(); });
      return stream;
    });
    try {
      await vi.waitFor(() => { for (const chunk of chunks) expect(chunk).toContain(`"snapshotId":"${current.snapshotId}"`); });
      const payload = { branch_id: "main", floor_id: "stream-floor", expected_snapshot_id: current.snapshotId, operation_id: "stream-operation" };
      const result = await built.app.inject({ method: "POST", url: "/sessions/stream-session/role-state/recalculate", payload });
      expect(result.statusCode, result.body).toBe(200);
      await vi.waitFor(() => { for (const chunk of chunks) expect(chunk).toContain(`"snapshotId":"${result.json().data.after.snapshotId}"`); });
      const replay = await built.app.inject({ method: "POST", url: "/sessions/stream-session/role-state/recalculate", payload });
      expect(replay.json()).toEqual(result.json());
      expect(generate).toHaveBeenCalledTimes(2);
      for (const chunk of chunks) expect(chunk.match(/event: state_repair/g)).toHaveLength(1);
      const conflict = await built.app.inject({ method: "POST", url: "/sessions/stream-session/role-state/recalculate", payload: { ...payload, floor_id: "other" } });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error.code).toBe("ROLE_STATE_REPAIR_OPERATION_CONFLICT");
    } finally {
      for (const stream of streams) stream.destroy();
      for (const response of responses) response.raw.res.destroy();
    }
  });

  it("includes a commit during subscription setup in the initial SSE snapshot", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "subscribe-race", { stateUpdate: true });
    await initialize(built, "subscribe-race");
    const snapshots = new DisplaySnapshotService(built.database);
    const before = snapshots.latest(DEFAULT_ADMIN_ACCOUNT_ID, "subscribe-race")!;
    const after = { ...before, snapshotId: "subscribe-committed", parentSnapshotId: before.snapshotId, variables: { hp: 9 }, source: { kind: "manual" as const, runId: null, jobId: null } };
    const original = StateUpdateService.prototype.subscribeRepair;
    vi.spyOn(StateUpdateService.prototype, "subscribeRepair").mockImplementationOnce(function (this: StateUpdateService, accountId, sessionId, branchId, listener) {
      const unsubscribe = original.call(this, accountId, sessionId, branchId, listener);
      snapshots.save(accountId, after);
      listener({ operationId: "subscription-race", after });
      return unsubscribe;
    });
    const response = await built.app.inject({ method: "GET", url: "/sessions/subscribe-race/role-state/events?branch_id=main", payloadAsStream: true });
    const stream = response.stream();
    let text = "";
    stream.on("data", (chunk) => { text += chunk.toString(); });
    try {
      await vi.waitFor(() => expect(text).toContain('"snapshotId":"subscribe-committed"'));
      expect(text).toContain("event: state_current");
      expect(text).not.toContain(`"snapshotId":"${before.snapshotId}"`);
    } finally { stream.destroy(); response.raw.res.destroy(); }
  });

  it.each(["unknown", "persistence"])("preserves %s repair failure status and reason when replaying its operation", async (kind) => {
    const generate = vi.fn(async () => ({ changes: [{ op: "set", path: "/hp", value: 3 }], evidenceMessageIds: ["message-assistant-failed-floor"] }));
    const built = await buildRoleViewApp(generate);
    await seedRoleSession(built, "failed-session", { stateUpdate: true });
    await initialize(built, "failed-session");
    seedFloor(built, { sessionId: "failed-session", floorId: "failed-floor", runId: "failed-run" });
    const initial = await updateFloor(built, "failed-session", "failed-floor");
    const failure = kind === "unknown" ? new Error("fixture model unavailable") : new ModelCallPersistenceError(null, "turn_outcome", new Error("fixture persistence failure"), false, { floorId: "failed-floor", runId: "failed-run" });
    generate.mockRejectedValueOnce(failure);
    const request = { method: "POST" as const, url: "/sessions/failed-session/role-state/recalculate", payload: { branch_id: "main", floor_id: "failed-floor", expected_snapshot_id: initial.json().data.snapshotId, operation_id: "failed-http-operation" } };
    const first = await built.app.inject(request);
    const replay = await built.app.inject(request);
    expect(first.statusCode).toBe(kind === "unknown" ? 500 : 503);
    expect(replay.statusCode).toBe(first.statusCode);
    expect(replay.json().error.code).toBe(first.json().error.code);
    expect(replay.json().error.message).toBe(first.json().error.message);
    expect(generate).toHaveBeenCalledTimes(2);
    const operation = await built.app.inject({ method: "GET", url: "/sessions/failed-session/role-state/operations/failed-http-operation" });
    expect(operation.json().data.error.message).toBe(failure.message);
  });

  it("binds the restricted output schema to structured generation", () => {
    const outputSchema = buildRestrictedOutputSchema(
      {
        updaterPrompt: "Update",
        writablePaths: ["/hp"],
        stateSchema: { type: "object", properties: { hp: { type: "number" } } },
        factsSchema: { type: "object" },
      },
      ["message-user", "message-assistant"],
    );

    expect(outputSchema.properties.evidenceMessageIds).toMatchObject({
      minItems: 1,
      uniqueItems: true,
      items: { enum: ["message-user", "message-assistant"] },
    });
  });

  it("types each writable path and requires complete array values", () => {
    const result = buildRestrictedOutputSchema(
      {
        updaterPrompt: "Update",
        writablePaths: ["/choices"],
        stateSchema: {
          type: "object",
          properties: {
            choices: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: { type: "string" },
            },
          },
        },
      },
      ["m"],
    );
    expect(result.properties.changes.maxItems).toBe(1);
    const items = result.properties.changes.items;
    if (typeof items === "boolean") throw new Error("Expected change choices");
    expect(items.oneOf[0]!.properties.value).toEqual({
      type: "array",
      items: {},
      minItems: 2,
      maxItems: 2,
    });
    expect(() =>
      buildRestrictedOutputSchema(
        {
          updaterPrompt: "Update",
          writablePaths: ["/unknown"],
          stateSchema: { type: "object", properties: {} },
        },
        [],
      ),
    ).toThrow("Role state schema does not define /unknown");
    expect(
      buildRestrictedOutputSchema(
        {
          updaterPrompt: "Update",
          writablePaths: [],
          stateSchema: { type: "object", properties: {} },
        },
        [],
      ).properties.changes,
    ).toMatchObject({ maxItems: 0, items: false });
  });

  it("states the evidence contract independently of character-authored rules", () => {
    const prompt = buildStateUpdateSystemPrompt(
      {
        updaterPrompt: "Character updater instructions",
        ruleFiles: ["rules.json"],
        factsSchema: { type: "object" },
      },
      { "rules.json": "Character state rules" },
    );

    expect(prompt).toContain("Character updater instructions");
    expect(prompt).toContain("Character state rules");
    expect(prompt).toContain("matches outputSchema exactly");
    expect(prompt).toContain("exact sources[].messageId");
    expect(prompt).toContain("include at least one exact sources[].messageId");

    const noFactsSchema = buildRestrictedOutputSchema(
      {
        updaterPrompt: "Update",
        writablePaths: ["/hp"],
        stateSchema: { type: "object", properties: { hp: { type: "number" } } },
      },
      ["message-user"],
    );
    expect(noFactsSchema.properties.evidenceMessageIds).not.toHaveProperty(
      "minItems",
    );
    expect(
      buildStateUpdateSystemPrompt(
        {
          updaterPrompt: "Updater",
          ruleFiles: [],
        },
        {},
      ),
    ).toContain("When changes is non-empty");
  });

  it("initializes macro-expanded state once and persists it through VariableService", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "session-initial", {
      variables: {
        owner: "{{user}}",
        nested: ["Welcome, {{user}}", 3],
      },
    });

    const first = await built.views.initialize({
      session: { id: "session-initial" },
      opening: { id: "first" },
    });
    const second = await built.views.initialize({
      session: { id: "session-initial" },
      opening: { id: "first" },
    });

    expect(second).toEqual(first);
    expect(first.variables).toEqual({
      owner: "Test Persona",
      nested: ["Welcome, Test Persona", 3],
    });
    expect(readStatData(built, "session-initial")).toEqual(first.variables);
    expect(snapshotCount(built, "session-initial")).toBe(1);

    const response = await built.app.inject({
      method: "GET",
      url: "/sessions/session-initial/role-view",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.delivery.data.opening).toBe(
      "Hello Test Persona",
    );
    expect(response.json().data).not.toHaveProperty("snapshots");
  });

  it("returns projected floor messages and rejects cross-session reads", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "projection-owner");
    await seedRoleSession(built, "projection-other");
    seedFloor(built, {
      sessionId: "projection-owner",
      floorId: "projection-floor",
      runId: "projection-run",
    });
    const ok = await built.app.inject({
      method: "GET",
      url: "/sessions/projection-owner/role-messages?branch_id=main&floor_id=projection-floor",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.length).toBeGreaterThan(0);
    expect(
      (
        await built.app.inject({
          method: "GET",
          url: "/sessions/projection-other/role-messages?branch_id=main&floor_id=projection-floor",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await built.app.inject({
          method: "GET",
          url: "/sessions/projection-owner/role-messages",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await built.app.inject({
          method: "GET",
          url: "/sessions/missing/role-messages?branch_id=main&floor_id=projection-floor",
        })
      ).statusCode,
    ).toBe(404);
  });

  it("paginates snapshots and readable conversation floors newest-first within their scope", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "history-owner");
    const initialSnapshot = await initialize(built, "history-owner");
    for (const [floorNo, floorId] of [
      [1, "history-floor-1"],
      [2, "history-floor-2"],
      [3, "history-floor-3"],
    ] as const) {
      seedFloor(built, {
        sessionId: "history-owner",
        floorId,
        floorNo,
        runId: `run-${floorNo}`,
      });
    }
    seedFloor(built, {
      sessionId: "history-owner",
      floorId: "empty-failed-floor",
      floorNo: 4,
      runId: "run-empty",
      state: "failed",
      withMessages: false,
    });

    const snapshotService = new DisplaySnapshotService(built.database);
    let previous = snapshotService.latest(
      DEFAULT_ADMIN_ACCOUNT_ID,
      "history-owner",
    )!;
    for (let floorNo = 1; floorNo <= 3; floorNo += 1) {
      const floorId = `history-floor-${floorNo}`;
      const record = {
        ...previous,
        floorId,
        attemptId: `run-${floorNo}:2`,
        snapshotId: `history-snapshot-${floorNo}`,
        parentSnapshotId: previous.snapshotId,
        source: {
          kind: "floor" as const,
          runId: `run-${floorNo}`,
          jobId: null,
        },
      };
      snapshotService.save(DEFAULT_ADMIN_ACCOUNT_ID, record);
      previous = record;
    }

    const firstSnapshots = await built.app.inject({
      method: "GET",
      url: "/sessions/history-owner/role-view/snapshots?branch_id=main&limit=2",
    });
    expect(firstSnapshots.statusCode).toBe(200);
    expect(firstSnapshots.json().data.items).toEqual([
      {
        snapshotId: "history-snapshot-3",
        floorId: "history-floor-3",
        attemptId: "run-3:2",
      },
      {
        snapshotId: "history-snapshot-2",
        floorId: "history-floor-2",
        attemptId: "run-2:2",
      },
    ]);
    const snapshotCursor = firstSnapshots.json().data.nextCursor as string;
    const secondSnapshots = await built.app.inject({
      method: "GET",
      url: `/sessions/history-owner/role-view/snapshots?branch_id=main&limit=2&cursor=${snapshotCursor}`,
    });
    expect(secondSnapshots.json().data.items).toEqual([
      {
        snapshotId: "history-snapshot-1",
        floorId: "history-floor-1",
        attemptId: "run-1:2",
      },
      {
        snapshotId: initialSnapshot.snapshotId,
        floorId: null,
        attemptId: null,
      },
    ]);
    expect(secondSnapshots.json().data.nextCursor).toBeNull();

    const firstFloors = await built.app.inject({
      method: "GET",
      url: "/sessions/history-owner/role-messages/floors?branch_id=main&limit=2",
    });
    expect(firstFloors.statusCode).toBe(200);
    expect(firstFloors.json().data.items).toEqual([
      { floorId: "history-floor-3", floorNo: 3, state: "committed" },
      { floorId: "history-floor-2", floorNo: 2, state: "committed" },
    ]);
    const floorCursor = firstFloors.json().data.nextCursor as string;
    const secondFloors = await built.app.inject({
      method: "GET",
      url: `/sessions/history-owner/role-messages/floors?branch_id=main&limit=2&cursor=${floorCursor}`,
    });
    expect(secondFloors.json().data.items).toEqual([
      { floorId: "history-floor-1", floorNo: 1, state: "committed" },
    ]);
    expect(secondFloors.json().data.nextCursor).toBeNull();

    const otherBranch = await built.app.inject({
      method: "GET",
      url: "/sessions/history-owner/role-view/snapshots?branch_id=alternate",
    });
    expect(otherBranch.json().data.items).toEqual([]);
    expect(otherBranch.json().data.nextCursor).toBeNull();
    const otherSessionId = "history-other-session";
    built.database
      .insert(sessions)
      .values({
        id: otherSessionId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    for (const url of [
      `/sessions/history-owner/role-view/snapshots?branch_id=alternate&cursor=${snapshotCursor}`,
      `/sessions/${otherSessionId}/role-view/snapshots?branch_id=main&cursor=${snapshotCursor}`,
      `/sessions/history-owner/role-messages/floors?branch_id=main&cursor=${snapshotCursor}`,
      "/sessions/history-owner/role-view/snapshots?branch_id=main&cursor=invalid",
      "/sessions/history-owner/role-messages/floors?branch_id=main&limit=101",
    ]) {
      const invalid = await built.app.inject({ method: "GET", url });
      expect(invalid.statusCode).toBe(400);
    }

    built.database
      .insert(accounts)
      .values({
        id: "history-foreign-account",
        name: "Foreign account",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    built.database
      .insert(sessions)
      .values({
        id: "history-foreign-session",
        accountId: "history-foreign-account",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    for (const route of ["role-view/snapshots", "role-messages/floors"]) {
      const foreign = await built.app.inject({
        method: "GET",
        url: `/sessions/history-foreign-session/${route}?branch_id=main`,
      });
      expect(foreign.statusCode).toBe(404);
    }
  });

  it("includes the native package greeting floor in role conversation history only", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "native-greeting-history", {
      nativePackage: true,
    });
    await seedRoleSession(built, "legacy-greeting-history");

    for (const sessionId of [
      "native-greeting-history",
      "legacy-greeting-history",
    ]) {
      seedFloor(built, {
        sessionId,
        floorId: `greeting-${sessionId}`,
        floorNo: 0,
        runId: `run-${sessionId}`,
        withMessages: false,
      });
      const pageId = `page-greeting-${sessionId}`;
      built.database
        .insert(messagePages)
        .values({
          id: pageId,
          floorId: `greeting-${sessionId}`,
          pageNo: 0,
          pageKind: "output",
          isActive: true,
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      built.database
        .insert(messages)
        .values({
          id: `message-greeting-${sessionId}`,
          pageId,
          seq: 0,
          role: "assistant",
          content: "Welcome to the harbor.",
          source: "greeting",
          createdAt: 1,
        })
        .run();
    }

    const nativeFloors = await built.app.inject({
      method: "GET",
      url: "/sessions/native-greeting-history/role-messages/floors?branch_id=main",
    });
    expect(nativeFloors.statusCode).toBe(200);
    expect(nativeFloors.json().data.items).toContainEqual({
      floorId: "greeting-native-greeting-history",
      floorNo: 0,
      state: "committed",
    });
    const greeting = await built.app.inject({
      method: "GET",
      url: "/sessions/native-greeting-history/role-messages?branch_id=main&floor_id=greeting-native-greeting-history",
    });
    expect(greeting.statusCode).toBe(200);
    expect(greeting.json().data).toMatchObject([
      { role: "assistant", content: "Welcome to the harbor." },
    ]);

    const legacyFloors = await built.app.inject({
      method: "GET",
      url: "/sessions/legacy-greeting-history/role-messages/floors?branch_id=main",
    });
    expect(legacyFloors.statusCode).toBe(200);
    expect(legacyFloors.json().data.items).toEqual([]);
  });

  it("projects using the pinned preset version without rewriting raw messages", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "projection-version");
    seedFloor(built, {
      sessionId: "projection-version",
      floorId: "projection-version-floor",
      runId: "projection-version-run",
    });
    const policy = {
      extensions: {
        tavern_headless: {
          outputProcessing: {
            version: 1,
            delivery: "complete",
            rules: [
              {
                sourceRuleId: "r",
                pattern: "^raw:",
                flags: "",
                replacement: "",
              },
            ],
          },
        },
      },
    };
    const sqlite = built.database.$client;
    sqlite
      .prepare(
        "INSERT INTO preset (id,name,account_id,data_json,created_at,updated_at) VALUES (?,?,?,?,0,0)",
      )
      .run("p-output", "preset", DEFAULT_ADMIN_ACCOUNT_ID, "{}");
    sqlite
      .prepare(
        "INSERT INTO preset_version (id,preset_id,version_no,data_json,content_hash,created_at) VALUES (?,?,?,?,?,0)",
      )
      .run("pv-output", "p-output", 1, JSON.stringify(policy), "fixture");
    sqlite
      .prepare("UPDATE session SET preset_id=?,preset_version_id=? WHERE id=?")
      .run("p-output", "pv-output", "projection-version");
    sqlite
      .prepare(
        "UPDATE message SET content='raw:body' WHERE page_id=? AND role='assistant'",
      )
      .run("page-projection-version-floor");
    const response = await built.app.inject({
      method: "GET",
      url: "/sessions/projection-version/role-messages?branch_id=main&floor_id=projection-version-floor",
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json().data.find((m: { role: string }) => m.role === "assistant")
        .content,
    ).toBe("body");
    expect(
      sqlite
        .prepare(
          "SELECT content FROM message WHERE page_id=? AND role='assistant'",
        )
        .get("page-projection-version-floor"),
    ).toEqual({ content: "raw:body" });
  });

  it("commits a formal floor once with the real run identity and skips the model without stateUpdate", async () => {
    const generateStateUpdate = vi.fn();
    const built = await buildRoleViewApp(generateStateUpdate);
    await seedRoleSession(built, "session-success");
    await initialize(built, "session-success");
    seedFloor(built, {
      sessionId: "session-success",
      floorId: "floor-success",
      runId: "run-real",
    });

    const first = await updateFloor(built, "session-success", "floor-success");
    const second = await updateFloor(built, "session-success", "floor-success");

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toEqual(first.json().data);
    expect(first.json().data).toMatchObject({
      floorId: "floor-success",
      attemptId: "run-real:2",
      source: { kind: "floor", runId: "run-real", jobId: null },
      variables: { hp: 1 },
    });
    expect(snapshotCount(built, "session-success")).toBe(2);
    expect(readStatData(built, "session-success")).toEqual({ hp: 1 });
    expect(generateStateUpdate).not.toHaveBeenCalled();
  });

  it("rejects an opening whose variables violate the character state schema", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "bad-initial", {
      stateUpdate: true,
      variables: { hp: -1 },
    });
    await expect(initialize(built, "bad-initial")).rejects.toMatchObject({
      code: "ROLE_INITIAL_STATE_INVALID",
    });
    expect(snapshotCount(built, "bad-initial")).toBe(0);
  });

  it("reads a saved variable contract and reports absent configuration/version", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "contract", { stateUpdate: true });
    await seedRoleSession(built, "no-contract");
    const response = await built.app.inject({
      method: "GET",
      url: "/characters/character-contract/versions/version-contract/state-contract",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.systemPrompt).toContain("Update state");
    expect(
      response.json().data.outputSchema.properties.evidenceMessageIds.items,
    ).toEqual({ type: "string", minLength: 1 });
    expect(
      (
        await built.app.inject({
          method: "GET",
          url: "/characters/character-no-contract/versions/version-no-contract/state-contract",
        })
      ).json().error.code,
    ).toBe("ROLE_STATE_CONFIG_MISSING");
    expect(
      (
        await built.app.inject({
          method: "GET",
          url: "/characters/character-contract/versions/missing/state-contract",
        })
      ).statusCode,
    ).toBe(404);
  });

  it.each([false, true])(
    "preserves committed controller state across updater success/failure (%s)",
    async (fail) => {
      const generate = vi.fn(
        async ({ previous }: { previous: { variables: { hp: number } } }) => {
          expect(previous.variables.hp).toBe(7);
          if (fail) throw new Error("provider failed");
          return { changes: [], evidenceMessageIds: [] };
        },
      );
      const built = await buildRoleViewApp(generate);
      const id = `controller-${fail}`;
      await seedRoleSession(built, id, { stateUpdate: true });
      await initialize(built, id);
      const sqlite = built.database.$client;
      const stored = sqlite
        .prepare("SELECT character_snapshot_json FROM session WHERE id=?")
        .get(id) as { character_snapshot_json: string };
      const snapshot = JSON.parse(stored.character_snapshot_json);
      snapshot.extensions.tavern_headless.stateUpdate.profile.controllerOwnedPaths =
        ["/hp"];
      snapshot.extensions.tavern_headless.stateUpdate.profile.writablePaths =
        [];
      sqlite
        .prepare("UPDATE session SET character_snapshot_json=? WHERE id=?")
        .run(JSON.stringify(snapshot), id);
      built.database
        .update(variables)
        .set({ valueJson: JSON.stringify({ hp: 7 }) })
        .where(
          and(
            eq(variables.scopeId, buildBranchVariableScopeId(id, "main")),
            eq(variables.key, "stat_data"),
          ),
        )
        .run();
      seedFloor(built, {
        sessionId: id,
        floorId: `floor-${id}`,
        runId: `run-${id}`,
      });
      const response = await updateFloor(built, id, `floor-${id}`);
      expect(response.statusCode).toBe(fail ? 500 : 200);
      expect(readStatData(built, id)).toEqual({ hp: 7 });
      expect(snapshotCount(built, id)).toBe(fail ? 1 : 2);
      if (!fail) {
        expect(response.json().data.variables).toEqual({ hp: 7 });
        expect(
          (await updateFloor(built, id, `floor-${id}`)).json().data,
        ).toEqual(response.json().data);
        expect(generate).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("rejects a floor from another session and an out-of-order floor", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "session-owner");
    await seedRoleSession(built, "session-other", {
      characterId: "character-other",
    });
    await initialize(built, "session-owner");
    await initialize(built, "session-other");
    seedFloor(built, {
      sessionId: "session-other",
      floorId: "floor-other",
      runId: "run-other",
    });
    seedFloor(built, {
      sessionId: "session-owner",
      floorId: "floor-first",
      floorNo: 1,
      runId: "run-first",
    });
    seedFloor(built, {
      sessionId: "session-owner",
      floorId: "floor-second",
      floorNo: 2,
      runId: "run-second",
    });

    const crossSession = await updateFloor(
      built,
      "session-owner",
      "floor-other",
    );
    const outOfOrder = await updateFloor(
      built,
      "session-owner",
      "floor-second",
    );

    expect(crossSession.statusCode).toBe(404);
    expect(crossSession.json().error.code).toBe("ROLE_FLOOR_NOT_FOUND");
    expect(outOfOrder.statusCode).toBe(409);
    expect(outOfOrder.json().error).toMatchObject({
      code: "ROLE_STATE_OUT_OF_ORDER",
      details: { expected_floor_id: "floor-first" },
    });
    expect(snapshotCount(built, "session-owner")).toBe(1);
  });

  it("leaves both the snapshot and formal variable unchanged when a proposal fails", async () => {
    const generateStateUpdate = vi.fn(async () => ({
      changes: [{ op: "set", path: "/hp", value: 9 }],
      evidenceMessageIds: [],
    }));
    const built = await buildRoleViewApp(generateStateUpdate);
    await seedRoleSession(built, "session-failed", { stateUpdate: true });
    await initialize(built, "session-failed");
    seedFloor(built, {
      sessionId: "session-failed",
      floorId: "floor-failed",
      runId: "run-failed",
    });

    const response = await updateFloor(built, "session-failed", "floor-failed");

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("STATE_EVIDENCE_REQUIRED");
    expect(snapshotCount(built, "session-failed")).toBe(1);
    expect(readStatData(built, "session-failed")).toEqual({ hp: 1 });
    const conversations = await built.app.inject({
      method: "GET",
      url: "/sessions/session-failed/role-messages/floors?branch_id=main",
    });
    expect(conversations.statusCode).toBe(200);
    expect(conversations.json().data.items).toContainEqual({
      floorId: "floor-failed",
      floorNo: 1,
      state: "committed",
    });
    const snapshotHistory = await built.app.inject({
      method: "GET",
      url: "/sessions/session-failed/role-view/snapshots?branch_id=main",
    });
    expect(snapshotHistory.json().data.items).toHaveLength(1);
    expect(snapshotHistory.json().data.items[0]).toMatchObject({
      floorId: null,
      attemptId: null,
    });
  });

  it("rejects a second concurrent update while the first proposal is running", async () => {
    let releaseProposal!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    const blocked = new Promise<void>((resolveProposal) => {
      releaseProposal = resolveProposal;
    });
    const generateStateUpdate = vi.fn(async ({ sources }) => {
      markStarted();
      await blocked;
      return {
        changes: [{ op: "set", path: "/hp", value: 2 }],
        evidenceMessageIds: [sources[0].messageId],
      };
    });
    const built = await buildRoleViewApp(generateStateUpdate);
    await seedRoleSession(built, "session-concurrent", { stateUpdate: true });
    await initialize(built, "session-concurrent");
    seedFloor(built, {
      sessionId: "session-concurrent",
      floorId: "floor-concurrent",
      runId: "run-concurrent",
    });

    const firstPromise = updateFloor(
      built,
      "session-concurrent",
      "floor-concurrent",
    );
    await started;
    const second = await updateFloor(
      built,
      "session-concurrent",
      "floor-concurrent",
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("ROLE_STATE_BUSY");

    releaseProposal();
    const first = await firstPromise;
    expect(first.statusCode).toBe(200);
    expect(first.json().data.variables).toEqual({ hp: 2 });
    expect(generateStateUpdate).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a missing display snapshot and gates formal respond while state is pending", async () => {
    const built = await buildRoleViewApp();
    await seedRoleSession(built, "session-gate");
    await initialize(built, "session-gate");
    seedFloor(built, {
      sessionId: "session-gate",
      floorId: "floor-gate",
      runId: "run-gate",
    });

    const missing = await built.app.inject({
      method: "GET",
      url: "/sessions/session-gate/role-view/snapshots/missing-snapshot",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("ROLE_SNAPSHOT_NOT_FOUND");
    expect(
      (
        await built.app.inject({
          method: "GET",
          url: "/sessions/session-gate/role-view/floors/missing-floor",
        })
      ).statusCode,
    ).toBe(404);
    for (const suffix of ["respond", "respond/stream"]) {
      const respond = await built.app.inject({
        method: "POST",
        url: `/sessions/session-gate/${suffix}`,
        payload: { message: "Next turn" },
      });
      expect(respond.statusCode).toBe(409);
      expect(respond.json().error).toMatchObject({
        code: "ROLE_STATE_PENDING",
        details: { floor_id: "floor-gate" },
      });
    }
  });
});

it("checks fixed proposals through HTTP while retaining stored variables and avoiding model calls", async () => {
  const generateStateUpdate = vi.fn();
  const built = await buildRoleViewApp(generateStateUpdate);
  await seedRoleSession(built, "session-inspect", { stateUpdate: true });
  await initialize(built, "session-inspect");
  const payload = {
    sourceMessages: [{ messageId: "fixed-message", revision: 1, role: "assistant", text: "恢复生命值" }],
    proposal: { changes: [{ op: "set", path: "/hp", value: 5 }], evidenceMessageIds: ["fixed-message"] },
  };
  const inspect = (body: Record<string, unknown>) => built.app.inject({ method: "POST", url: "/sessions/session-inspect/role-state/inspect-proposal", payload: body });
  const accepted = await inspect(payload);
  expect(accepted.statusCode, accepted.body).toBe(200);
  expect(accepted.json().data).toMatchObject({ before: { hp: 1 }, candidate: { hp: 5 }, derived: { hp: 5 }, valid: true, issues: [] });
  const rejected = await inspect({ ...payload, proposal: { ...payload.proposal, changes: [{ op: "set", path: "/hp", value: -1 }] } });
  expect(rejected.statusCode, rejected.body).toBe(200);
  expect(rejected.json().data.valid).toBe(false);
  expect(rejected.json().data.issues.length).toBeGreaterThan(0);
  const malformed = await inspect({ ...payload, sourceMessages: [] });
  expect(malformed.statusCode).toBe(400);
  expect(snapshotCount(built, "session-inspect")).toBe(1);
  expect(generateStateUpdate).not.toHaveBeenCalled();
  const current = await built.app.inject({ method: "GET", url: "/sessions/session-inspect/role-view" });
  expect(current.statusCode, current.body).toBe(200);
  expect(current.json().data.current.variables).toEqual({ hp: 1 });
});

async function buildRoleViewApp(generateStateUpdate = vi.fn(), cors?: CorsConfig) {
  const directory = await mkdtemp(join(tmpdir(), "role-view-test-"));
  tempDirectories.push(directory);
  const storage = loadStorageConfig({ DATA_DIR: directory });
  const built = await buildTestApp({
    storage,
    logger: false,
    databasePath: ":memory:",
    auth: { mode: "off" },
    accountMode: "single",
    cors,
    enableWebSocket: false,
    enableSseChat: true,
    enableMemory: false,
    enableAgentRuntimeWorker: false,
    enableNodeGraphWorker: false,
  });
  if (!built.app.hasRoute({ method: "POST", url: "/sessions/:id/respond" })) {
    built.app.post("/sessions/:id/respond", async () => ({
      data: { accepted: true },
    }));
  }
  if (
    !built.app.hasRoute({ method: "POST", url: "/sessions/:id/respond/stream" })
  ) {
    built.app.post("/sessions/:id/respond/stream", async () => ({
      data: { accepted: true },
    }));
  }
  vi.spyOn(StateUpdateService.prototype as any, "generate").mockImplementation(
    async (...args: any[]) =>
      generateStateUpdate({
        previous: { variables: args[1] },
        sources: args[2],
      }),
  );
  const assets = new RoleAssetService(
    built.database,
    new RoleFileStore(storage),
  );
  const updates = new StateUpdateService(
    built.database,
    new DisplaySnapshotService(built.database),
    assets,
    new ModelCallRecordService(built.database, loadModelCallRecordingConfig()),
  );
  const views = {
    initialize: async ({
      session,
    }: {
      session: { id: string };
      opening: { id: string };
    }) => {
      const row = built.database
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.id))
        .get()!;
      const snapshot = JSON.parse(row.characterSnapshotJson!);
      return updates.initialize(
        row.accountId,
        session.id,
        snapshot.extensions.tavern_headless.openings.items[0].variables,
      );
    },
  };
  await built.app.ready();
  openApps.push(built);
  return { ...built, views };
}

async function seedRoleSession(
  built: Awaited<ReturnType<typeof buildRoleViewApp>>,
  sessionId: string,
  options: {
    characterId?: string;
    variables?: Record<string, unknown>;
    stateUpdate?: boolean;
    nativePackage?: boolean;
  } = {},
) {
  const characterId = options.characterId ?? `character-${sessionId}`;
  const versionId = `version-${sessionId}`;
  const now = Date.now();
  const stateUpdate = options.stateUpdate
    ? {
        profile: {
          id: "state-profile",
          stateSchemaFile: "state.schema.json",
          ruleFiles: [],
          modelSlot: "verifier",
          sourceAgentBindingIds: [],
          writablePaths: ["/hp"],
          stateSchema: {
            type: "object",
            properties: { hp: { type: "number" } },
          },
          derivedPaths: [],
          updaterPrompt: "Update state",
          maxTokens: 128,
        },
        files: {
          "state.schema.json": JSON.stringify({
            type: "object",
            required: ["hp"],
            additionalProperties: false,
            properties: { hp: { type: "integer", minimum: 0 } },
          }),
        },
      }
    : undefined;
  const characterSnapshot = {
    name: "Test Character",
    extensions: {
      tavern_headless: {
        ...(options.nativePackage
          ? { nativePackage: { cardId: "card-native", revision: 1 } }
          : {}),
        runtimeDelivery: {
          html: "<main></main>",
          css: "main {}",
          scriptUrl: "/role-assets/{version}/main.js",
          floorHtml: null,
          assets: {},
          data: { performerAvatar: "performer" },
        },
        openings: {
          defaultOpeningId: "first",
          items: [
            {
              id: "first",
              title: "Opening",
              summary: "Opening summary",
              kind: "story",
              displayText: "Hello {{user}}",
              variables: options.variables ?? { hp: 1 },
            },
          ],
        },
        ...(stateUpdate ? { stateUpdate } : {}),
      },
    },
  };
  built.database
    .insert(characters)
    .values({
      id: characterId,
      name: "Test Character",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  built.database
    .insert(characterVersions)
    .values({
      id: versionId,
      characterId,
      versionNo: 1,
      dataJson: JSON.stringify(characterSnapshot),
      contentHash: `hash-${sessionId}`,
      createdAt: now,
    })
    .run();
  built.database
    .insert(sessions)
    .values({
      id: sessionId,
      title: "Role session",
      characterId,
      characterVersionId: versionId,
      characterSnapshotJson: JSON.stringify(characterSnapshot),
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      userSnapshotJson: JSON.stringify({
        name: "Test Persona",
        description: "Persona",
      }),
      metadataJson: JSON.stringify({ opening_id: "first" }),
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  built.database
    .insert(sessionBranches)
    .values({
      id: `branch-${sessionId}`,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: null,
      sourceBranchId: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const file = (name: string, purpose: string, content: string) => ({
    name,
    purpose,
    mime: "text/plain",
    base64: Buffer.from(content).toString("base64"),
  });
  const imported = await built.app.inject({
    method: "POST",
    url: `/role-assets/${versionId}`,
    payload: {
      character_id: characterId,
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
            data: { performerAvatar: "performer" },
          }),
        ),
        file("view.html", "template", "<main></main>"),
        file("view.css", "template", "main{}"),
        file("main.js", "browser_script", "export {}"),
        ...(stateUpdate
          ? [
              file(
                "state.schema.json",
                "data",
                stateUpdate.files["state.schema.json"],
              ),
            ]
          : []),
      ],
    },
  });
  expect(imported.statusCode, imported.body).toBe(201);
}

function seedFloor(
  built: Awaited<ReturnType<typeof buildRoleViewApp>>,
  input: {
    sessionId: string;
    floorId: string;
    floorNo?: number;
    runId: string;
    branchId?: string;
    state?: "draft" | "generating" | "committed" | "failed";
    withMessages?: boolean;
  },
) {
  const now = Date.now();
  const pageId = `page-${input.floorId}`;
  built.database
    .insert(floors)
    .values({
      id: input.floorId,
      sessionId: input.sessionId,
      floorNo: input.floorNo ?? 1,
      branchId: input.branchId ?? "main",
      state: input.state ?? "committed",
      tokenIn: 1,
      tokenOut: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  built.database
    .insert(floorRunStates)
    .values({
      floorId: input.floorId,
      runId: input.runId,
      runType: "respond",
      status: "completed",
      phase: "post_commit_scheduled",
      publicPhase: "post_processing",
      phaseSeq: 10,
      attemptNo: 2,
      startedAt: now - 10,
      updatedAt: now,
      completedAt: now,
    })
    .run();
  if (input.withMessages === false) return;
  built.database
    .insert(messagePages)
    .values({
      id: pageId,
      floorId: input.floorId,
      pageNo: 1,
      pageKind: "mixed",
      isActive: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  built.database
    .insert(messages)
    .values([
      {
        id: `message-user-${input.floorId}`,
        pageId,
        seq: 1,
        role: "user",
        content: "User message",
        createdAt: now,
      },
      {
        id: `message-assistant-${input.floorId}`,
        pageId,
        seq: 2,
        role: "assistant",
        content: "Assistant message",
        createdAt: now,
      },
    ])
    .run();
}

async function initialize(
  built: Awaited<ReturnType<typeof buildRoleViewApp>>,
  sessionId: string,
) {
  return built.views.initialize({
    session: { id: sessionId },
    opening: { id: "first" },
  });
}

function updateFloor(
  built: Awaited<ReturnType<typeof buildRoleViewApp>>,
  sessionId: string,
  floorId: string,
) {
  return built.app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/role-state/updates`,
    payload: { floor_id: floorId },
  });
}

function snapshotCount(
  built: Awaited<ReturnType<typeof buildRoleViewApp>>,
  sessionId: string,
) {
  const row = built.database.$client
    .prepare(
      "SELECT COUNT(*) AS count FROM role_display_snapshot WHERE session_id=?",
    )
    .get(sessionId) as { count: number };
  return Number(row.count);
}

function readStatData(
  built: Awaited<ReturnType<typeof buildRoleViewApp>>,
  sessionId: string,
) {
  const row = built.database
    .select()
    .from(variables)
    .where(
      and(
        eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
        eq(variables.scope, "branch"),
        eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "main")),
        eq(variables.key, "stat_data"),
      ),
    )
    .get();
  return row ? JSON.parse(row.valueJson) : undefined;
}
