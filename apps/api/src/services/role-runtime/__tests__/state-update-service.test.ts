import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type DatabaseConnection } from "../../../../test/helpers/create-test-db.js";
import {
  accounts,
  characters,
  characterVersions,
  sessions,
  floors,
  floorRunStates,
  messagePages,
  messages,
  roleDisplaySnapshots,
  roleStateOperations,
  modelCallRecords,
  toolExecutionRecords,
  variables,
  presets,
  presetVersions,
} from "../../../db/schema.js";
import { RoleFileStore } from "../../storage/role-file-store.js";
import { RoleAssetService } from "../role-asset-service.js";
import { DisplaySnapshotService } from "../display-snapshot-service.js";
import { StateUpdateService } from "../state-update-service.js";
import { ModelCallRecordService } from "../../model-call-record-service.js";
import { LlmProfileService } from "../../llm-profile-service.js";
import { apiErrorMessages, buildBranchVariableScopeId, type RoleStateOutput } from "@tavern/shared";
import { VariableService } from "../../variables/variable-service.js";

let connection: DatabaseConnection;
let root: string;
let snapshots: DisplaySnapshotService;
let calls: ModelCallRecordService;
let service: StateUpdateService;
let network: ReturnType<typeof vi.fn>;
const proposal: RoleStateOutput = {
  changes: [{ op: "set", path: "/score", value: 2 }],
  evidenceMessageIds: ["assistant"],
};
const complete = (value: unknown, finishReason = "stop") =>
  new Response(
    JSON.stringify({
      id: "response",
      object: "chat.completion",
      created: 1,
      model: "test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(value) },
          finish_reason: finishReason,
        },
      ],
    }),
    { headers: { "content-type": "application/json" } },
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "state-update-"));
  connection = createTestDatabase(":memory:");
  const db = connection.db;
  db.insert(accounts)
    .values({ id: "owner", name: "Owner", createdAt: 1, updatedAt: 1 })
    .run();
  const ids = ["main", "stateDefinition", "stateRules", "stateBefore", "stateHistory", "stateEvidence", "stateOutputContract", "chatHistory"];
  const dataJson = JSON.stringify({openai_max_context: 20000, openai_max_tokens: 1000, prompts: ids.map(identifier => ({identifier, role: ["stateDefinition", "stateHistory", "stateOutputContract"].includes(identifier) ? "user" : "system", marker: identifier !== "main", enabled: true, content: identifier === "main" ? "Determine variable changes from the saved story." : ""})), prompt_order: [{character_id: 100001, order: ids.map(identifier => ({identifier, enabled: true}))}]});
  db.insert(presets).values({id: "state-preset", accountId: "owner", name: "State", dataJson, createdAt: 1, updatedAt: 1}).run();
  db.insert(presetVersions).values({id: "state-preset-v1", presetId: "state-preset", versionNo: 1, dataJson, contentHash: "fixture", createdAt: 1}).run();
  db.insert(characters)
    .values({
      id: "character",
      accountId: "owner",
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
  db.insert(sessions)
    .values({
      id: "session",
      accountId: "owner",
      metadataJson: JSON.stringify({statePrompt: {presetId: "state-preset", presetVersionId: "state-preset-v1", historyTurns: 5}}),
      characterVersionId: "version",
      characterSnapshotJson: JSON.stringify({
        extensions: {
          tavern_headless: {
            stateUpdate: {
              profile: {
                updaterPrompt: "Update score from the source messages.",
                writablePaths: ["/score"],
                stateSchema: {
                  type: "object",
                  required: ["score"],
                  properties: { score: { type: "integer" } },
                  additionalProperties: false,
                },
              },
              files: {},
            },
          },
        },
      }),
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
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
  db.insert(messagePages)
    .values({
      id: "page",
      floorId: "floor",
      pageNo: 0,
      pageKind: "output",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  db.insert(messages)
    .values({
      id: "assistant",
      pageId: "page",
      role: "assistant",
      content: "The score increases.",
      seq: 0,
      createdAt: 1,
    })
    .run();
  calls = new ModelCallRecordService(db, {
    maxRetries: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    streamSaveIntervalMs: 0,
  });
  snapshots = new DisplaySnapshotService(db);
  service = new StateUpdateService(
    db,
    snapshots,
    new RoleAssetService(
      db,
      new RoleFileStore({
        roleAssetsDir: join(root, "files"),
        roleAssetStagingDir: join(root, "staging"),
      }),
    ),
    calls,
  );
  vi.spyOn(
    LlmProfileService.prototype,
    "resolveActiveProfiles",
  ).mockResolvedValue({
    verifier: {
      source: "session",
      profileId: "profile",
      presetName: "Test",
      provider: "openai-compatible",
      modelId: "test",
      baseUrl: "https://provider.test/v1",
      apiKey: "private-key",
      params: {},
    },
  });
  network = vi.fn(async () => complete(proposal));
  vi.stubGlobal("fetch", network);
  await service.initialize("owner", "session", { score: 1 });
});

function requestData(request: {messages: Array<{content: string}>}) {
  const data: Record<string, any> = {};
  for (const message of request.messages) {
    try { const value = JSON.parse(message.content); if (value && !Array.isArray(value) && typeof value === "object") Object.assign(data, value); } catch { /* text and story messages */ }
  }
  return data;
}

describe("final body tool evidence", () => {
  function insertEvidence(id: string, acceptedPageId: string | null, generationAttemptNo: number, result = { ok: true, data: { type: "number", value: 2 } }) {
    connection.db.insert(toolExecutionRecords).values({ id, runId: "run", floorId: "floor", acceptedPageId,
      callerSlot: "narrator", providerId: "system-model-capabilities", providerType: "builtin", toolName: "calculate",
      argsJson: JSON.stringify({ expression: 2 }), resultJson: JSON.stringify(result), status: "success",
      lifecycleState: "finished", commitOutcome: "committed", callId: `call-${id}`, generationAttemptNo,
      generationStepNo: 1, startedAt: 1, createdAt: 1 }).run();
  }

  it("sends only final body accepted evidence and keeps it during state recalculation", async () => {
    insertEvidence("accepted", "page", 2);
    insertEvidence("rejected", null, 1);
    network.mockImplementation(async () => complete({ ...proposal, evidenceExecutionIds: ["accepted"] }));
    const snapshot = await service.update("owner", "session", "floor");
    const firstRequest = JSON.parse(calls.list("owner", "floor", {}).data[0]!.call.requestBody!);
    const input = requestData(firstRequest);
    expect(input.toolEvidence).toEqual([expect.objectContaining({ executionId: "accepted", generationAttemptNo: 2,
      result: { ok: true, data: { type: "number", value: 2 } } })]);
    await service.recalculate("owner", "session", { branch_id: "main", floor_id: "floor", expected_snapshot_id: snapshot.snapshotId, operation_id: "evidence-repair" });
    const requests = calls.list("owner", "floor", {}).data.map((item) => JSON.parse(item.call.requestBody!));
    expect(requests.map((request) => requestData(request).toolEvidence)).toEqual([input.toolEvidence, input.toolEvidence]);
    expect(connection.db.select().from(toolExecutionRecords).all()).toHaveLength(2);
  });

  it("rejects proposal references to another generation attempt before saving state", async () => {
    insertEvidence("accepted", "page", 2);
    insertEvidence("rejected", null, 1);
    network.mockImplementationOnce(async () => complete({ ...proposal, evidenceExecutionIds: ["rejected"] }));
    await expect(service.update("owner", "session", "floor")).rejects.toMatchObject({ code: "STATE_EVIDENCE_INVALID" });
    expect(snapshots.latest("owner", "session")!.variables).toEqual({ score: 1 });
  });

  it("accepts omitted execution references when tool evidence is available", async () => {
    insertEvidence("accepted", "page", 2);
    const snapshot = await service.update("owner", "session", "floor");
    expect(snapshot.variables).toEqual({ score: 2 });
    const request = JSON.parse(calls.list("owner", "floor", {}).data[0]!.call.requestBody!);
    const input = requestData(request);
    expect(input.outputSchema.required).not.toContain("evidenceExecutionIds");
    expect(input.outputSchema.properties.evidenceExecutionIds.items.enum).toEqual(["accepted"]);
  });

  it("keeps execution results separate from an empty story change proposal", async () => {
    insertEvidence("calculated-only", "page", 1);
    network.mockImplementationOnce(async () => complete({ changes: [], evidenceMessageIds: [], evidenceExecutionIds: [] }));
    expect((await service.update("owner", "session", "floor")).variables).toEqual({ score: 1 });
  });
});

describe("role state repair operations", () => {
  it("recalculates the latest floor from its original before snapshot on every operation and preserves each version", async () => {
    const original = await service.update("owner", "session", "floor");
    network.mockImplementationOnce(async () => complete({ ...proposal, changes: [{ op: "set", path: "/score", value: 3 }] }));
    const first = await service.recalculate("owner", "session", {
      branch_id: "main", floor_id: "floor", expected_snapshot_id: original.snapshotId, operation_id: "repair-1",
    });
    network.mockImplementationOnce(async () => complete({ ...proposal, changes: [{ op: "set", path: "/score", value: 4 }] }));
    const second = await service.recalculate("owner", "session", {
      branch_id: "main", floor_id: "floor", expected_snapshot_id: first.after.snapshotId, operation_id: "repair-2",
    });
    expect(first.before.snapshotId).toBe(original.snapshotId);
    expect(first.after.variables).toEqual({ score: 3 });
    expect(second.before.snapshotId).toBe(first.after.snapshotId);
    expect(second.after.variables).toEqual({ score: 4 });
    expect(second.after.parentSnapshotId).toBe(first.after.snapshotId);
    expect(snapshots.getByFloor("owner", "session", "floor")?.snapshotId).toBe(second.after.snapshotId);
    expect(snapshots.listPage("owner", "session", "main").items).toHaveLength(4);
    expect(snapshots.get("owner", "session", { snapshotId: original.snapshotId }).variables).toEqual({ score: 2 });
    const callsForFloor = calls.list("owner", "floor", {}).data;
    expect(callsForFloor).toHaveLength(3);
    for (const call of callsForFloor) expect(call.call.requestBody).toContain('\\"before\\":{\\"score\\":1}');
    const replay = await service.recalculate("owner", "session", {
      branch_id: "main", floor_id: "floor", expected_snapshot_id: first.after.snapshotId, operation_id: "repair-2",
    });
    expect(replay).toEqual(second);
    expect(network).toHaveBeenCalledTimes(3);
    expect(service.getRepairOperation("owner", "session", "repair-2")).toMatchObject({
      status: "succeeded", beforeSnapshotId: first.after.snapshotId,
      sourceSnapshotId: snapshots.first("owner", "session")?.snapshotId,
      afterSnapshotId: second.after.snapshotId,
    });
  });

  it("restores only missing object members, refreshes declared descriptions, and makes no model call", async () => {
    const db = connection.db;
    db.delete(roleDisplaySnapshots).where(eq(roleDisplaySnapshots.sessionId, "session")).run();
    const row = db.select().from(sessions).where(eq(sessions.id, "session")).get()!;
    const character = JSON.parse(row.characterSnapshotJson!);
    character.extensions.tavern_headless.stateUpdate.profile.stateSchema = {
      type: "object", additionalProperties: true,
    };
    character.extensions.tavern_headless.stateUpdate.profile.initialDescriptionPaths = ["/nested/description", "/pairs/0/1"];
    db.update(sessions).set({ characterSnapshotJson: JSON.stringify(character) }).where(eq(sessions.id, "session")).run();
    const initial = await service.initialize("owner", "session", {
      zero: 9, flag: true, empty: "init", nil: "init", pairs: [[1, "old"]],
      nested: { existing: 1, missing: { value: 2 }, description: "initial description" },
    });
    const current = { ...initial, snapshotId: "current-restore", parentSnapshotId: initial.snapshotId,
      floorId: "floor", attemptId: "run:1", source: { kind: "floor" as const, runId: "run", jobId: null },
      variables: { zero: 0, flag: false, empty: "", nil: null, pairs: [[9]],
        nested: { existing: 0, description: "changed description" } } };
    snapshots.save("owner", current);
    const result = await service.restoreMissing("owner", "session", {
      branch_id: "main", expected_snapshot_id: current.snapshotId, operation_id: "restore-1",
    });
    expect(result.after.variables).toEqual({
      zero: 0, flag: false, empty: "", nil: null, pairs: [[9, "old"]],
      nested: { existing: 0, missing: { value: 2 }, description: "initial description" },
    });
    expect(network).not.toHaveBeenCalled();
    expect(snapshots.first("owner", "session")?.snapshotId).toBe(initial.snapshotId);
    expect(snapshots.latest("owner", "session")?.snapshotId).toBe(result.after.snapshotId);
    const noop = await service.restoreMissing("owner", "session", {
      branch_id: "main", expected_snapshot_id: result.after.snapshotId, operation_id: "restore-2",
    });
    expect(noop.after.snapshotId).toBe(result.after.snapshotId);
    expect(db.select().from(roleDisplaySnapshots).all()).toHaveLength(3);
    expect(db.select().from(roleStateOperations).all()).toHaveLength(2);
  });

  it("rejects stale, nonlatest, conflicting IDs and invalid state without changing committed variables", async () => {
    const current = await service.update("owner", "session", "floor");
    const stale = { branch_id: "main", floor_id: "floor", expected_snapshot_id: "old", operation_id: "stale" };
    await expect(service.recalculate("owner", "session", stale)).rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_STALE" });
    await expect(service.recalculate("owner", "session", stale)).rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_STALE" });
    await expect(service.recalculate("owner", "session", { ...stale, floor_id: "other" })).rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_OPERATION_CONFLICT" });
    connection.db.insert(floors).values({ id: "later", sessionId: "session", floorNo: 2, state: "committed", createdAt: 2, updatedAt: 2 }).run();
    await expect(service.recalculate("owner", "session", { ...stale, expected_snapshot_id: current.snapshotId, operation_id: "not-latest" }))
      .rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_FLOOR_CHANGED" });
    expect(snapshots.latest("owner", "session")?.snapshotId).toBe(current.snapshotId);
    expect(network).toHaveBeenCalledTimes(1);
    expect(service.getRepairOperation("owner", "session", "not-latest")).toMatchObject({ status: "failed", afterSnapshotId: null });
  });

  it("keeps the active lock when a concurrent repair is rejected and publishes only a committed repair", async () => {
    const original = await service.update("owner", "session", "floor");
    let release!: (response: Response) => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    network.mockImplementationOnce(async () => {
      entered();
      return new Promise<Response>((resolve) => { release = resolve; });
    });
    const events: unknown[] = [];
    const unsubscribe = service.subscribeRepair("owner", "session", "main", (event) => events.push(event));
    const pending = service.recalculate("owner", "session", {
      branch_id: "main", floor_id: "floor", expected_snapshot_id: original.snapshotId, operation_id: "slow-repair",
    });
    await enteredPromise;
    await expect(service.restoreMissing("owner", "session", {
      branch_id: "main", expected_snapshot_id: original.snapshotId, operation_id: "busy-restore",
    })).rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_BUSY" });
    expect(service.isRunning("session")).toBe(true);
    release(complete(proposal));
    const result = await pending;
    expect(events).toEqual([{ operationId: "slow-repair", after: result.after }]);
    unsubscribe();
    expect(service.isRunning("session")).toBe(false);
  });

  it("holds the repair lock while loading the fixed configuration and releases it after a load failure", async () => {
    const original = await service.update("owner", "session", "floor");
    let rejectLoad!: (error: Error) => void;
    const load = vi.spyOn(service as any, "load").mockImplementationOnce(() => new Promise((_, reject) => { rejectLoad = reject; }));
    const pending = service.restoreMissing("owner", "session", {
      branch_id: "main", expected_snapshot_id: original.snapshotId, operation_id: "loading-repair",
    });
    expect(service.isRunning("session")).toBe(true);
    await expect(service.recalculate("owner", "session", {
      branch_id: "main", floor_id: "floor", expected_snapshot_id: original.snapshotId, operation_id: "loading-conflict",
    })).rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_BUSY" });
    rejectLoad(new Error("fixture loading failed"));
    await expect(pending).rejects.toThrow("fixture loading failed");
    expect(service.isRunning("session")).toBe(false);
    expect(snapshots.latest("owner", "session")?.snapshotId).toBe(original.snapshotId);
    expect(service.getRepairOperation("owner", "session", "loading-repair").status).toBe("failed");
    load.mockRestore();
  });

  it("records a failed model repair, replays its failure, and retains the committed state", async () => {
    const original = await service.update("owner", "session", "floor");
    const generate = vi.spyOn(service as any, "generate").mockRejectedValueOnce(new Error("fixture model unavailable"));
    const input = { branch_id: "main", floor_id: "floor", expected_snapshot_id: original.snapshotId, operation_id: "failed-model" };
    await expect(service.recalculate("owner", "session", input)).rejects.toThrow("fixture model unavailable");
    await expect(service.recalculate("owner", "session", input)).rejects.toThrow("fixture model unavailable");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(snapshots.latest("owner", "session")?.snapshotId).toBe(original.snapshotId);
    expect(service.getRepairOperation("owner", "session", "failed-model")).toMatchObject({ status: "failed", afterSnapshotId: null });
    expect(service.isRunning("session")).toBe(false);
  });

  it("rolls back the repair snapshot and operation success when model outcome persistence fails", async () => {
    const original = await service.update("owner", "session", "floor");
    connection.db.$client.exec("CREATE TRIGGER deny_repair_outcome BEFORE UPDATE ON model_call_records WHEN NEW.turn_commit_status = 'committed' BEGIN SELECT RAISE(ABORT, 'repair outcome unavailable'); END");
    const events: unknown[] = [];
    const unsubscribe = service.subscribeRepair("owner", "session", "main", (event) => events.push(event));
    await expect(service.recalculate("owner", "session", {
      branch_id: "main", floor_id: "floor", expected_snapshot_id: original.snapshotId, operation_id: "outcome-failure",
    })).rejects.toThrow("repair outcome unavailable");
    expect(snapshots.latest("owner", "session")).toEqual(original);
    expect(service.getRepairOperation("owner", "session", "outcome-failure")).toMatchObject({ status: "failed", afterSnapshotId: null });
    expect(calls.list("owner", "floor", {}).data.map((item) => item.turnCommitStatus).sort()).toEqual(["committed", "failed"]);
    const state = connection.db.select().from(variables).where(eq(variables.scopeId, buildBranchVariableScopeId("session", "main"))).get();
    expect(JSON.parse(state!.valueJson)).toEqual(original.variables);
    expect(events).toEqual([]);
    unsubscribe();
  });

  it("aborts a model result if another writer advances the snapshot during generation", async () => {
    const original = await service.update("owner", "session", "floor");
    let release!: (response: Response) => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    network.mockImplementationOnce(async () => {
      entered();
      return new Promise<Response>((resolve) => { release = resolve; });
    });
    const pending = service.recalculate("owner", "session", {
      branch_id: "main", floor_id: "floor", expected_snapshot_id: original.snapshotId, operation_id: "racing-repair",
    });
    await enteredPromise;
    snapshots.save("owner", { ...original, snapshotId: "outside-writer", parentSnapshotId: original.snapshotId,
      variables: { score: 9 }, source: { kind: "manual", runId: null, jobId: null } });
    release(complete(proposal));
    await expect(pending).rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_STALE" });
    expect(snapshots.latest("owner", "session")?.variables).toEqual({ score: 9 });
    expect(service.getRepairOperation("owner", "session", "racing-repair")).toMatchObject({ status: "failed", afterSnapshotId: null });
  });

  it("rejects invalid restored state with a field path and leaves the snapshot and branch variable unchanged", async () => {
    const initial = snapshots.first("owner", "session")!;
    snapshots.save("owner", { ...initial, snapshotId: "bad-current", parentSnapshotId: initial.snapshotId,
      floorId: "floor", attemptId: "run:1", variables: { score: "invalid" },
      source: { kind: "floor", runId: "run", jobId: null } });
    await expect(service.restoreMissing("owner", "session", {
      branch_id: "main", expected_snapshot_id: "bad-current", operation_id: "invalid-restore",
    })).rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_VALIDATION_FAILED", details: { path: "/score" } });
    expect(snapshots.latest("owner", "session")?.snapshotId).toBe("bad-current");
    expect(connection.db.select().from(roleDisplaySnapshots).all()).toHaveLength(2);
    const value = connection.db.select().from(variables).where(eq(variables.scopeId, buildBranchVariableScopeId("session", "main"))).get();
    expect(JSON.parse(value!.valueJson)).toEqual({ score: "invalid" });
    expect(network).not.toHaveBeenCalled();
  });

  it("can append an initial-state repair while retaining the original initial snapshot", async () => {
    const initial = snapshots.first("owner", "session")!;
    connection.db.delete(roleDisplaySnapshots).where(eq(roleDisplaySnapshots.sessionId, "session")).run();
    const row = connection.db.select().from(sessions).where(eq(sessions.id, "session")).get()!;
    const character = JSON.parse(row.characterSnapshotJson!);
    character.extensions.tavern_headless.stateUpdate.profile.stateSchema = {
      type: "object", required: ["score", "label"], properties: { score: { type: "integer" }, label: { type: "string" } }, additionalProperties: false,
    };
    connection.db.update(sessions).set({ characterSnapshotJson: JSON.stringify(character) }).where(eq(sessions.id, "session")).run();
    const restoredInitial = await service.initialize("owner", "session", { score: 1, label: "start" });
    expect(restoredInitial.snapshotId).not.toBe(initial.snapshotId);
    // A prior version of state can lack a newly configured field while the fixed initial record retains it.
    const current = { ...restoredInitial, snapshotId: "initial-current", parentSnapshotId: restoredInitial.snapshotId,
      variables: { score: 1 }, source: { kind: "manual" as const, runId: null, jobId: null } };
    snapshots.save("owner", current);
    const result = await service.restoreMissing("owner", "session", {
      branch_id: "main", expected_snapshot_id: current.snapshotId, operation_id: "initial-repair",
    });
    expect(result.after.floorId).toBeNull();
    expect(result.after.variables).toEqual({ score: 1, label: "start" });
    expect(snapshots.first("owner", "session")?.snapshotId).toBe(restoredInitial.snapshotId);
    expect(snapshots.latest("owner", "session")?.snapshotId).toBe(result.after.snapshotId);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  connection?.close();
  await rm(root, { recursive: true, force: true });
});

describe("recorded role state updates", () => {
  it("inspects against the same controller-merged before state as formal submission", async () => {
    const moduleFiles = new Map([
      ["backend/variable-tools/derive.js", Buffer.from(
        "export function derive(context) { return { ...context.candidate, derived: context.before.controller * 10 }; }",
      )],
    ]);
    const nativeAssets = {
      nativeRevision: vi.fn(async () => ({
        cardId: "native-card",
        revision: 1,
        files: moduleFiles,
        fileRecords: [...moduleFiles].map(([path, bytes]) => ({
          path,
          purpose: "server_script",
          byteSize: bytes.byteLength,
        })),
      } as never)),
    } as unknown as RoleAssetService;
    connection.db.delete(roleDisplaySnapshots)
      .where(eq(roleDisplaySnapshots.sessionId, "session")).run();
    connection.db.update(sessions).set({
      characterSnapshotJson: JSON.stringify({
        extensions: { tavern_headless: {
          nativePackage: { cardId: "native-card", revision: 1, packageId: "package" },
          stateUpdate: { profile: {
            updaterPrompt: "Update the score.",
            writablePaths: ["/score"],
            controllerOwnedPaths: ["/controller"],
            deriveScript: "backend/variable-tools/derive.js",
            stateSchema: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              required: ["score", "controller", "derived"],
              properties: {
                score: { type: "integer" },
                controller: { type: "integer" },
                derived: { type: "integer" },
              },
              additionalProperties: false,
            },
          }, files: {} },
        } },
      }),
    }).where(eq(sessions.id, "session")).run();
    const nativeService = new StateUpdateService(connection.db, snapshots, nativeAssets, calls);
    await nativeService.initialize("owner", "session", {
      score: 1,
      controller: 1,
      derived: 0,
    });
    const resolveSnapshot = vi.spyOn(VariableService.prototype, "resolveSnapshot")
      .mockResolvedValue({
        resolved: [{ key: "stat_data", value: { score: 90, controller: 5, derived: 90 } }],
      } as never);

    const inspected = await nativeService.inspectProposal("owner", "session", {
      proposal,
      sourceMessages: [{
        messageId: "assistant",
        revision: 1,
        role: "assistant",
        text: "The score increases.",
      }],
    });

    expect(inspected).toMatchObject({
      before: { score: 1, controller: 5, derived: 0 },
      candidate: { score: 2, controller: 5, derived: 0 },
      derived: { score: 2, controller: 5, derived: 50 },
      issues: [],
      valid: true,
    });
    expect(resolveSnapshot).toHaveBeenCalledWith({
      accountId: "owner",
      sessionId: "session",
      branchId: "main",
    });
    expect(connection.db.select().from(roleDisplaySnapshots).all()).toHaveLength(1);
    expect(network).not.toHaveBeenCalled();

    const submitted = await nativeService.update("owner", "session", "floor");

    expect(submitted.variables).toEqual(inspected.derived);
    expect(network).toHaveBeenCalledTimes(1);
    const saved = connection.db.select().from(roleDisplaySnapshots).where(eq(roleDisplaySnapshots.id, submitted.snapshotId)).get()!;
    expect(JSON.parse(saved.calculationBeforeJson!)).toEqual(inspected.before);
    resolveSnapshot.mockResolvedValue({ resolved: [{ key: "stat_data", value: { score: 100, controller: 99, derived: 100 } }] } as never);
    const recalculated = await nativeService.recalculate("owner", "session", { branch_id: "main", floor_id: "floor", expected_snapshot_id: submitted.snapshotId, operation_id: "controller-recalc" });
    expect(recalculated.after.variables).toEqual(inspected.derived);
    connection.db.update(roleDisplaySnapshots).set({ calculationBeforeJson: null }).where(eq(roleDisplaySnapshots.id, submitted.snapshotId)).run();
    const migrated = await nativeService.recalculate("owner", "session", { branch_id: "main", floor_id: "floor", expected_snapshot_id: recalculated.after.snapshotId, operation_id: "legacy-controller-recalc" });
    expect(migrated.after.variables).toEqual(inspected.derived);
    expect(JSON.parse(connection.db.select().from(roleDisplaySnapshots).where(eq(roleDisplaySnapshots.id, submitted.snapshotId)).get()!.calculationBeforeJson!)).toEqual(inspected.before);
    connection.db.update(roleDisplaySnapshots).set({ calculationBeforeJson: null }).where(eq(roleDisplaySnapshots.id, submitted.snapshotId)).run();
    connection.db.delete(modelCallRecords).run();
    await expect(nativeService.recalculate("owner", "session", { branch_id: "main", floor_id: "floor", expected_snapshot_id: migrated.after.snapshotId, operation_id: "missing-controller-source" })).rejects.toMatchObject({ code: "ROLE_STATE_REPAIR_SOURCE_MISSING" });
    expect(snapshots.latest("owner", "session")?.snapshotId).toBe(migrated.after.snapshotId);

  });

  it("uses Draft 2020-12 for native package schemas without a declared dialect and retains exact initialization validation", async () => {
    const db = connection.db;
    db.delete(roleDisplaySnapshots).where(eq(roleDisplaySnapshots.sessionId, "session")).run();
    db.update(sessions).set({
      characterSnapshotJson: JSON.stringify({
        extensions: {
          tavern_headless: {
            nativePackage: { cardId: "card", revision: 1, packageId: "pkg" },
            stateUpdate: {
              profile: {
                updaterPrompt: "Update score from source messages.",
                writablePaths: ["/score"],
                stateSchema: {
                  type: "object",
                  required: ["score"],
                  properties: { score: { type: "integer" } },
                  unevaluatedProperties: false,
                },
              },
              files: {},
            },
          },
        },
      }),
    }).where(eq(sessions.id, "session")).run();

    await expect(service.initialize("owner", "session", { score: 1, extra: true }))
      .rejects.toMatchObject({ code: "ROLE_INITIAL_STATE_INVALID" });
    expect((await service.initialize("owner", "session", { score: 1 })).variables).toEqual({ score: 1 });
    expect((await service.update("owner", "session", "floor")).variables).toEqual({ score: 2 });
  });

  it("runs native derive and validator modules in the restricted worker and commits no rejected state", async () => {
    const moduleFiles = new Map([
      ["state/schema.json", Buffer.from(JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["score"],
        properties: { score: { type: "integer" } },
        additionalProperties: false,
      }))],
      ["backend/variable-tools/derive.js", Buffer.from(
        "export function derive(context) { return { score: context.candidate.score + context.before.score }; }",
      )],
      ["backend/validators/validate.js", Buffer.from(
        "export function validate(context) { return { issues: context.candidate.score >= 100 ? [{ message: 'scores at or above 100 are not allowed' }] : [] }; }",
      )],
    ]);
    const nativeAssets = {
      nativeRevision: vi.fn(async () => ({
        cardId: "native-card",
        revision: 1,
        files: moduleFiles,
        fileRecords: [...moduleFiles].map(([path, bytes]) => ({
          path,
          purpose: path.endsWith(".js") ? "server_script" : "data",
          byteSize: bytes.byteLength,
        })),
      } as never)),
      readData: vi.fn(async (_accountId: string, _versionId: string, path: string) =>
        Buffer.from(moduleFiles.get(path)!).toString("utf8")),
    } as unknown as RoleAssetService;
    connection.db.update(sessions).set({
      characterSnapshotJson: JSON.stringify({
        extensions: { tavern_headless: {
          nativePackage: { cardId: "native-card", revision: 1, packageId: "package" },
          stateUpdate: { profile: {
            updaterPrompt: "Update the score.",
            writablePaths: ["/score"],
            stateSchemaFile: "state/schema.json",
            deriveScript: "backend/variable-tools/derive.js",
            validateScript: "backend/validators/validate.js",
          }, files: {} },
        } },
      }),
    }).where(eq(sessions.id, "session")).run();
    const nativeService = new StateUpdateService(connection.db, snapshots, nativeAssets, calls);
    const fixedMessages = [{
      messageId: "assistant",
      revision: 1,
      role: "assistant",
      text: "The score increases.",
    }];
    const invalidInspection = await nativeService.inspectProposal("owner", "session", {
      proposal: {
        changes: [{ op: "set", path: "/score", value: 99 }],
        evidenceMessageIds: ["assistant"],
      },
      sourceMessages: fixedMessages,
    });
    expect(invalidInspection).toEqual({
      before: { score: 1 },
      candidate: { score: 99 },
      derived: { score: 100 },
      issues: [{
        code: "STATE_RULE_INVALID",
        message: apiErrorMessages.STATE_RULE_INVALID,
        details: [{ message: "scores at or above 100 are not allowed" }],
      }],
      valid: false,
    });
    const validInspection = await nativeService.inspectProposal("owner", "session", {
      proposal: {
        changes: [{ op: "set", path: "/score", value: 2 }],
        evidenceMessageIds: ["assistant"],
      },
      sourceMessages: fixedMessages,
    });
    expect(validInspection).toEqual({
      before: { score: 1 },
      candidate: { score: 2 },
      derived: { score: 3 },
      issues: [],
      valid: true,
    });
    expect(network).not.toHaveBeenCalled();
    expect(connection.db.select().from(roleDisplaySnapshots).all()).toHaveLength(1);
    expect(snapshots.latest("owner", "session")?.variables).toEqual({ score: 1 });
    network.mockImplementationOnce(async () => complete({
      changes: [{ op: "set", path: "/score", value: 2 }],
      evidenceMessageIds: ["assistant"],
    }));

    const accepted = await nativeService.update("owner", "session", "floor");

    expect(accepted.variables).toEqual({ score: 3 });
    connection.db.insert(floors).values({
      id: "floor-rejected",
      sessionId: "session",
      floorNo: 2,
      state: "committed",
      createdAt: 2,
      updatedAt: 2,
    }).run();
    connection.db.insert(floorRunStates).values({
      floorId: "floor-rejected",
      runId: "run-rejected",
      runType: "respond",
      status: "completed",
      phase: "transaction_committed",
      publicPhase: "committing",
      startedAt: 2,
      updatedAt: 2,
    }).run();
    const rejectedPage = connection.db.insert(messagePages).values({
      id: "page-rejected",
      floorId: "floor-rejected",
      pageNo: 0,
      pageKind: "output",
      createdAt: 2,
      updatedAt: 2,
    }).returning().get()!;
    connection.db.insert(messages).values({
      id: "assistant-rejected",
      pageId: rejectedPage.id,
      role: "assistant",
      content: "The proposed score is too high.",
      seq: 0,
      createdAt: 2,
    }).run();
    network.mockImplementationOnce(async () => complete({
      changes: [{ op: "set", path: "/score", value: 99 }],
      evidenceMessageIds: ["assistant-rejected"],
    }));

    await expect(nativeService.update("owner", "session", "floor-rejected"))
      .rejects.toMatchObject({ code: "STATE_RULE_INVALID" });
    expect(snapshots.latest("owner", "session")?.variables).toEqual({ score: 3 });
    expect(connection.db.select().from(roleDisplaySnapshots).all()).toHaveLength(2);
    expect(nativeAssets.nativeRevision).toHaveBeenCalled();
  });

  it("uses the session's current character version while preserving prior snapshots", async () => {
    const db = connection.db;
    db.insert(characterVersions)
      .values({
        id: "updated-version",
        characterId: "character",
        versionNo: 2,
        dataJson: "{}",
        contentHash: "updated-fixture",
        createdAt: 2,
      })
      .run();
    db.update(sessions)
      .set({ characterVersionId: "updated-version" })
      .where(eq(sessions.id, "session"))
      .run();
    const previous = snapshots.first("owner", "session")!;
    const result = await service.update("owner", "session", "floor");
    expect(result.versionId).toBe("updated-version");
    expect(result.parentSnapshotId).toBe(previous.snapshotId);
    expect(result.variables).toEqual({ score: 2 });
    expect(snapshots.first("owner", "session")).toEqual(previous);
  });

  it("records the actual provider request and atomically commits state, then returns the same snapshot on retry", async () => {
    const result = await service.update("owner", "session", "floor");
    expect(result.variables).toEqual({ score: 2 });
    expect(await service.update("owner", "session", "floor")).toEqual(result);
    expect(network).toHaveBeenCalledTimes(1);
    const history = calls.list("owner", "floor", {}).data;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      call: {
        purpose: "state_update",
        status: "succeeded",
        runId: "run",
        slot: "verifier",
      },
      turnCommitStatus: "committed",
    });
    expect(history[0]!.call.requestBody).toContain("The score increases.");
    expect(history[0]!.call.requestBody).not.toContain("private-key");
  });
  it("uses the fixed model binding parameters in the actual state-update request", async () => {
    const profiles = await new LlmProfileService(
      connection.db,
    ).resolveActiveProfiles("session", "owner");
    profiles.verifier!.params = {
      maxOutputTokens: 333,
      temperature: 0.35,
      topP: 0.8,
      seed: 42,
    };
    vi.mocked(
      LlmProfileService.prototype.resolveActiveProfiles,
    ).mockResolvedValue(profiles);
    await service.update("owner", "session", "floor");
    const recorded = calls.list("owner", "floor", {}).data[0]!.call;
    expect(JSON.parse(recorded.requestBody!)).toMatchObject({
      max_tokens: 333,
      temperature: 0.35,
      top_p: 0.8,
      seed: 42,
    });
  });
  it("retains an invalid proposal as successful model evidence without changing committed state and can retry", async () => {
    network.mockImplementationOnce(async () =>
      complete({
        changes: [{ op: "set", path: "/score", value: "bad" }],
        evidenceMessageIds: ["assistant"],
      }),
    );
    await expect(service.update("owner", "session", "floor")).rejects.toThrow();
    expect(
      connection.db.select().from(roleDisplaySnapshots).all(),
    ).toHaveLength(1);
    expect(calls.list("owner", "floor", {}).data[0]).toMatchObject({
      call: { status: "succeeded" },
      turnCommitStatus: "failed",
    });
    await service.update("owner", "session", "floor");
    expect(
      calls
        .list("owner", "floor", {})
        .data.map((item) => item.turnCommitStatus)
        .sort(),
    ).toEqual(["committed", "failed"]);
  });
  it("preserves model success and previous state when snapshot persistence fails", async () => {
    connection.db.$client.exec(
      "CREATE TRIGGER deny_snapshot BEFORE INSERT ON role_display_snapshot BEGIN SELECT RAISE(ABORT, 'snapshot unavailable'); END",
    );
    await expect(service.update("owner", "session", "floor")).rejects.toThrow(
      "snapshot unavailable",
    );
    expect(
      connection.db.select().from(roleDisplaySnapshots).all(),
    ).toHaveLength(1);
    expect(calls.list("owner", "floor", {}).data[0]).toMatchObject({
      call: { status: "succeeded" },
      turnCommitStatus: "failed",
    });
  });
  it("does not contact the provider when request evidence cannot be saved", async () => {
    connection.db.$client.exec(
      "CREATE TRIGGER deny_call BEFORE INSERT ON model_call_records BEGIN SELECT RAISE(ABORT, 'call unavailable'); END",
    );
    await expect(service.update("owner", "session", "floor")).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
    expect(
      connection.db.select().from(roleDisplaySnapshots).all(),
    ).toHaveLength(1);
  });
  it("retains a committed snapshot when final call outcome persistence fails", async () => {
    vi.spyOn(calls, "finishTurn").mockRejectedValue(
      new Error("outcome unavailable"),
    );
    await expect(service.update("owner", "session", "floor")).rejects.toThrow(
      "outcome unavailable",
    );
    expect(snapshots.latest("owner", "session")?.variables).toEqual({
      score: 2,
    });
    expect(
      (await service.update("owner", "session", "floor")).variables,
    ).toEqual({ score: 2 });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("rejects foreign accounts, incomplete runs and out of order floors before any model request", async () => {
    await expect(service.update("other", "session", "floor")).rejects.toThrow();
    connection.db
      .update(floorRunStates)
      .set({ status: "running" })
      .where(eq(floorRunStates.floorId, "floor"))
      .run();
    await expect(
      service.update("owner", "session", "floor"),
    ).rejects.toMatchObject({ code: "ROLE_FLOOR_RUN_INCOMPLETE" });
    connection.db
      .insert(floors)
      .values({
        id: "later",
        sessionId: "session",
        floorNo: 2,
        state: "committed",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    await expect(
      service.update("owner", "session", "later"),
    ).rejects.toMatchObject({ code: "ROLE_STATE_OUT_OF_ORDER" });
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects truncated output and clears the active update lock", async () => {
    network.mockImplementationOnce(async () => complete(proposal, "length"));
    await expect(
      service.update("owner", "session", "floor"),
    ).rejects.toMatchObject({ code: "ROLE_STATE_OUTPUT_INCOMPLETE" });
    expect(service.isRunning("session")).toBe(false);
    expect(calls.list("owner", "floor", {}).data[0]?.turnCommitStatus).toBe(
      "failed",
    );
  });
});


describe("shared state request preview", () => {
  it("previews the successful floor without generating or committing state", async () => {
    const previous = snapshots.latest("owner", "session")!;
    const preview = await service.dryRun("owner", "session", {
      floor_id: "floor", expected_snapshot_id: previous.snapshotId,
    });
    expect(preview.sources).toEqual([{ messageId: "assistant", revision: 1, role: "assistant", text: "The score increases." }]);
    expect(preview.messages).toEqual(expect.arrayContaining([{role: "assistant", content: "The score increases."}]));
    expect(preview.messages.some(message => message.role === "user" && message.content === "")).toBe(false);
    expect(preview.before).toEqual({ score: 1 });
    expect(snapshots.latest("owner", "session")!.snapshotId).toBe(previous.snapshotId);
    expect(calls.list("owner", "floor", {}).data).toHaveLength(0);
    expect(network).not.toHaveBeenCalled();
  });
});
