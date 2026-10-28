import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ModelCallRecord } from "@tavern/shared";

import { createTestDatabase, type DatabaseConnection } from "../../../test/helpers/create-test-db.js";
import { accounts, floors, floorRunStates, sessions } from "../../db/schema.js";
import { ModelCallRecordService } from "../model-call-record-service.js";

let connection: DatabaseConnection;
let service: ModelCallRecordService;

function prepared(callId = "call-1"): ModelCallRecord {
  return {
    callId,
    invocationId: callId,
    requestAttemptNo: 1,
    accountId: "owner",
    sessionId: "session-1",
    branchId: "main",
    floorId: "floor-1",
    runId: "run-1",
    attemptNo: 1,
    stepIndex: 0,
    slot: "narrator",
    purpose: "narration",
    releaseId: null,
    draftRevision: null,
    resourceVersions: {},
    inputPageId: null,
    inputMessageId: null,
    provider: "openai",
    model: "test-model",
    endpoint: "https://provider.test/v1/chat/completions",
    requestBody: '{"model":"test-model","messages":[]}',
    responseBody: null,
    httpStatus: null,
    status: "prepared",
    preparedAt: 100,
    sentAt: null,
    firstResponseAt: null,
    endedAt: null,
    text: null,
    reasoning: null,
    toolData: null,
    usage: null,
    finishReason: null,
    error: null,
    outputPageId: null,
    outputMessageId: null,
  };
}

beforeEach(async () => {
  connection = createTestDatabase(":memory:");
  await connection.db
    .insert(accounts)
    .values({ id: "owner", name: "Owner", createdAt: 1, updatedAt: 1 });
  await connection.db
    .insert(sessions)
    .values({
      id: "session-1",
      accountId: "owner",
      title: "Session",
      createdAt: 1,
      updatedAt: 1,
    });
  await connection.db
    .insert(floors)
    .values({
      id: "floor-1",
      sessionId: "session-1",
      floorNo: 1,
      state: "generating",
      createdAt: 1,
      updatedAt: 1,
    });
  await connection.db
    .insert(floorRunStates)
    .values({
      floorId: "floor-1",
      runId: "run-1",
      runType: "respond",
      status: "running",
      phase: "page_generating",
      publicPhase: "generating",
      startedAt: 1,
      updatedAt: 1,
    });
  service = new ModelCallRecordService(connection.db, {
    maxRetries: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    streamSaveIntervalMs: 0,
  });
});
afterEach(() => connection?.close());

describe("independent model call history", () => {
  it("creates a recording context from the persisted run and fixed session bindings", async () => {
    await connection.db
      .update(sessions)
      .set({
        presetVersionId: "preset-version",
        metadataJson: JSON.stringify({ role_release_id: "release-1" }),
      })
      .where(eq(sessions.id, "session-1"));
    const recording = service.start({
      accountId: "owner",
      floorId: "floor-1",
      slot: "narrator",
      purpose: "narration",
      inputPageId: null,
      inputMessageId: null,
    });
    expect(recording.context).toMatchObject({
      runId: "run-1",
      sessionId: "session-1",
      branchId: "main",
      releaseId: "release-1",
      resourceVersions: { preset: "preset-version" },
    });
    expect(recording.recorder).toBe(service);
  });

  it("requires a saved running identity before constructing a recording context", async () => {
    await connection.db
      .delete(floorRunStates)
      .where(eq(floorRunStates.floorId, "floor-1"));
    expect(() =>
      service.start({
        accountId: "owner",
        floorId: "floor-1",
        slot: "narrator",
        purpose: "narration",
        inputPageId: null,
        inputMessageId: null,
      }),
    ).toThrow();
  });

  it("persists prepared evidence and returns unknown usage before completion", async () => {
    await service.save(prepared());
    expect(service.get("owner", "floor-1", "call-1")).toMatchObject({
      call: {
        requestBody: prepared().requestBody,
        status: "prepared",
        usage: null,
      },
      completionEvidence: "missing",
      turnCommitStatus: "pending",
    });
    expect(service.list("owner", "floor-1", {}).data).toHaveLength(1);
  });

  it("keeps the model success when floor submission subsequently fails", async () => {
    const record = prepared();
    await service.save(record);
    const result: ModelCallRecord = {
      ...record,
      status: "succeeded",
      sentAt: 101,
      endedAt: 102,
      responseBody: '{"text":"hello"}',
      text: "hello",
      httpStatus: 200,
    };
    await service.save(result);
    await service.save(result);
    await connection.db
      .update(floors)
      .set({ state: "failed" })
      .where(eq(floors.id, "floor-1"));
    expect(service.list("owner", "floor-1", {}).data).toHaveLength(1);
    expect(service.get("owner", "floor-1", "call-1")).toMatchObject({
      call: { status: "succeeded", text: "hello" },
      completionEvidence: "complete",
      turnCommitStatus: "failed",
    });
    await expect(service.save({ ...result, text: "changed" })).rejects.toThrow(
      "Could not save model call",
    );
  });

  it("separates new requests and paginates deterministically when timestamps match", async () => {
    for (const id of ["call-1", "call-2", "call-3"])
      await service.save(prepared(id));
    const first = service.list("owner", "floor-1", { limit: 2 });
    expect(first.data.map((item) => item.call.callId)).toEqual([
      "call-3",
      "call-2",
    ]);
    const second = service.list("owner", "floor-1", {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.data.map((item) => item.call.callId)).toEqual(["call-1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects another account and another session branch for reads and writes", async () => {
    await service.save(prepared());
    expect(() => service.get("other", "floor-1", "call-1")).toThrow();
    expect(() => service.list("other", "floor-1", {})).toThrow();
    await expect(
      service.save({ ...prepared("call-2"), branchId: "other" }),
    ).rejects.toThrow();
    await expect(
      service.save({ ...prepared("call-2"), sessionId: "other" }),
    ).rejects.toThrow();
  });

  it("keeps submitted output links after a later run replaces the current floor run", async () => {
    await service.save(prepared());
    await service.save({
      ...prepared(),
      status: "succeeded",
      sentAt: 101,
      endedAt: 102,
    });
    await service.finishTurn({
      accountId: "owner",
      floorId: "floor-1",
      runId: "run-1",
      status: "committed",
      outputPageId: null,
      outputMessageId: null,
    });
    await connection.db
      .update(floorRunStates)
      .set({ runId: "run-2" })
      .where(eq(floorRunStates.floorId, "floor-1"));
    expect(service.get("owner", "floor-1", "call-1").turnCommitStatus).toBe(
      "committed",
    );
    await expect(
      service.finishTurn({
        accountId: "owner",
        floorId: "floor-1",
        runId: "run-1",
        status: "failed",
        outputPageId: null,
        outputMessageId: null,
      }),
    ).rejects.toThrow();
  });

  it("returns an empty history for a floor with no recorded calls", () => {
    expect(service.list("owner", "floor-1", {})).toEqual({
      data: [],
      nextCursor: null,
    });
  });

  it("retries a busy write under the original call identity", async () => {
    let writes = 0;
    connection.db.$client.function("model_call_write", () => {
      writes++;
      if (writes === 1)
        throw Object.assign(new Error("database is busy"), {
          code: "SQLITE_BUSY",
        });
      return 1;
    });
    connection.db.$client.exec(
      "CREATE TRIGGER retry_model_call BEFORE INSERT ON model_call_records BEGIN SELECT model_call_write(); END",
    );
    await service.save(prepared());
    expect(writes).toBe(2);
    expect(service.list("owner", "floor-1", {}).data).toHaveLength(1);
  });

  it("reports exhausted response writes and leaves earlier request evidence readable", async () => {
    await service.save(prepared());
    connection.db.$client.function("model_call_write", () => {
      throw Object.assign(new Error("database is busy"), {
        code: "SQLITE_BUSY",
      });
    });
    connection.db.$client.exec(
      "CREATE TRIGGER retry_model_call BEFORE UPDATE ON model_call_records BEGIN SELECT model_call_write(); END",
    );
    await expect(
      service.save({
        ...prepared(),
        status: "succeeded",
        sentAt: 101,
        endedAt: 102,
      }),
    ).rejects.toMatchObject({
      code: "MODEL_CALL_SAVE_FAILED",
      callId: "call-1",
      stage: "succeeded",
    });
    expect(service.get("owner", "floor-1", "call-1")).toMatchObject({
      call: { status: "prepared" },
      completionEvidence: "missing",
    });
  });

  it("does not attribute a later run submission to an older call", async () => {
    await service.save(prepared());
    await connection.db
      .update(floorRunStates)
      .set({ runId: "run-2" })
      .where(eq(floorRunStates.floorId, "floor-1"));
    await connection.db
      .update(floors)
      .set({ state: "committed" })
      .where(eq(floors.id, "floor-1"));
    expect(service.get("owner", "floor-1", "call-1").turnCommitStatus).toBe(
      "unknown",
    );
  });
});
