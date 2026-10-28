import { and, desc, eq, lt, or, inArray } from "drizzle-orm";
import {
  ModelCallPersistenceError,
  type ModelCallRecording,
  type ModelCallRecorder,
} from "@tavern/core";
import {
  modelCallContextSchema,
  modelCallQuerySchema,
  modelCallRecordSchema,
  modelCallStartSchema,
  modelCallSessionMetadataSchema,
  modelCallOutcomeSchema,
  type ModelCallDetail,
  type ModelCallRecord,
  type ModelCallStart,
  type ModelCallOutcome,
} from "@tavern/shared";

import type { AppDb } from "../db/client.js";
import {
  floors,
  floorRunStates,
  modelCallRecords,
  sessions,
  messagePages,
  messages,
} from "../db/schema.js";
import { executeWithSqliteBusyRetry } from "../lib/retry.js";
import type { ModelCallRecordingConfig } from "../model-call-recording.schema.js";

export class ModelCallQueryError extends Error {
  constructor(
    readonly code: "MODEL_CALL_NOT_FOUND" | "MODEL_CALL_QUERY_INVALID",
  ) {
    super(code);
  }
}

export class ModelCallRecordService implements ModelCallRecorder {
  constructor(
    private readonly db: AppDb,
    private readonly config: ModelCallRecordingConfig,
  ) {}

  start(input: ModelCallStart): ModelCallRecording {
    const scope = modelCallStartSchema.parse(input);
    const floor = this.requireFloor(scope.accountId, scope.floorId);
    const run = this.db
      .select()
      .from(floorRunStates)
      .where(eq(floorRunStates.floorId, scope.floorId))
      .get();
    if (
      !run ||
      (run.status !== "running" &&
        !(
          scope.purpose === "state_update" &&
          run.status === "completed" &&
          floor.state === "committed"
        ))
    ) {
      throw new ModelCallPersistenceError(
        null,
        "prepared",
        new Error(
          "A running generation identity is required. Initialize the floor run before calling the model.",
        ),
        false,
        { floorId: scope.floorId },
      );
    }
    const session = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, floor.sessionId))
      .get()!;
    const metadata = modelCallSessionMetadataSchema.parse(
      JSON.parse(session.metadataJson ?? "{}"),
    );
    const resourceVersions: Record<string, string> = {};
    if (session.characterVersionId)
      resourceVersions.character = session.characterVersionId;
    if (session.presetVersionId)
      resourceVersions.preset = session.presetVersionId;
    if (session.worldbookVersionId)
      resourceVersions.worldbook = session.worldbookVersionId;
    if (session.regexProfileVersionId)
      resourceVersions.regex = session.regexProfileVersionId;
    return {
      context: modelCallContextSchema.parse({
        ...scope,
        sessionId: floor.sessionId,
        branchId: floor.branchId,
        runId: run.runId,
        attemptNo: run.attemptNo,
        stepIndex: 0,
        releaseId: metadata.role_release_id ?? null,
        draftRevision: metadata.draft_revision ?? null,
        resourceVersions,
      }),
      recorder: this,
      streamSaveIntervalMs: this.config.streamSaveIntervalMs,
    };
  }

  async save(input: ModelCallRecord): Promise<void> {
    const record = modelCallRecordSchema.parse(input);
    try {
      await executeWithSqliteBusyRetry(async () => {
        this.db.transaction((tx) => {
          const floor = this.requireFloor(record.accountId, record.floorId);
          if (
            floor.sessionId !== record.sessionId ||
            floor.branchId !== record.branchId
          ) {
            throw new Error(
              "Model call does not belong to this session branch. Use the active generation identity.",
            );
          }
          const previous = tx
            .select()
            .from(modelCallRecords)
            .where(eq(modelCallRecords.callId, record.callId))
            .get();
          const recordJson = JSON.stringify(record);
          if (previous) {
            if (previous.recordJson === recordJson) return;
            const saved = modelCallRecordSchema.parse(
              JSON.parse(previous.recordJson),
            );
            if (["succeeded", "failed", "interrupted"].includes(saved.status)) {
              throw new Error(
                "Model call completion already exists. Read the saved result using the original call identifier.",
              );
            }
            if (
              JSON.stringify(modelCallContextSchema.strip().parse(saved)) !==
                JSON.stringify(modelCallContextSchema.strip().parse(record)) ||
              saved.invocationId !== record.invocationId ||
              saved.requestAttemptNo !== record.requestAttemptNo ||
              saved.requestBody !== record.requestBody ||
              saved.provider !== record.provider ||
              saved.model !== record.model ||
              saved.endpoint !== record.endpoint ||
              saved.preparedAt !== record.preparedAt
            ) {
              throw new Error(
                "Model call request identity changed. Create a new call record for a new provider request.",
              );
            }
            if (saved.status === "in_flight" && record.status === "prepared") {
              throw new Error(
                "Model call has already entered the sending phase. Save its current response state.",
              );
            }
            tx.update(modelCallRecords)
              .set({ recordJson, status: record.status })
              .where(eq(modelCallRecords.callId, record.callId))
              .run();
          } else {
            if (record.status !== "prepared") {
              throw new Error(
                "Model call request has not been saved. Save the prepared request before sending it.",
              );
            }
            tx.insert(modelCallRecords)
              .values({
                callId: record.callId,
                invocationId: record.invocationId,
                requestAttemptNo: record.requestAttemptNo,
                accountId: record.accountId,
                sessionId: record.sessionId,
                branchId: record.branchId,
                floorId: record.floorId,
                runId: record.runId,
                attemptNo: record.attemptNo,
                preparedAt: record.preparedAt,
                status: record.status,
                recordJson,
              })
              .run();
          }
        });
      }, this.config);
    } catch (cause) {
      throw new ModelCallPersistenceError(record.callId, record.status, cause);
    }
  }

  async finishTurn(input: ModelCallOutcome): Promise<void> {
    const outcome = modelCallOutcomeSchema.parse(input);
    this.requireFloor(outcome.accountId, outcome.floorId);
    try {
      await executeWithSqliteBusyRetry(async () => {
        this.db.transaction((tx) => this.finishTurnInTransaction(input, tx));
      }, this.config);
    } catch (cause) {
      throw new ModelCallPersistenceError(
        null,
        "turn_outcome",
        cause,
        outcome.status === "committed",
        { floorId: outcome.floorId, runId: outcome.runId },
      );
    }
  }

  finishTurnInTransaction(
    input: ModelCallOutcome,
    tx: Pick<AppDb, "select" | "update">,
  ): void {
    const outcome = modelCallOutcomeSchema.parse(input);
    this.requireFloor(outcome.accountId, outcome.floorId);

    if (outcome.outputPageId) {
      const page = tx
        .select()
        .from(messagePages)
        .where(
          and(
            eq(messagePages.id, outcome.outputPageId),
            eq(messagePages.floorId, outcome.floorId),
          ),
        )
        .get();
      if (!page)
        throw new Error(
          "The output page does not belong to this floor. Use the page identifier returned by this turn commit.",
        );
    }
    if (outcome.outputMessageId) {
      const message = tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.id, outcome.outputMessageId),
            eq(messages.pageId, outcome.outputPageId ?? ""),
          ),
        )
        .get();
      if (!message)
        throw new Error(
          "The output message does not belong to the supplied page. Use the message and page identifiers returned by this turn commit.",
        );
    }
    const rows = tx
      .select()
      .from(modelCallRecords)
      .where(
        and(
          eq(modelCallRecords.accountId, outcome.accountId),
          eq(modelCallRecords.floorId, outcome.floorId),
          eq(modelCallRecords.runId, outcome.runId),
          ...(outcome.callIds
            ? [inArray(modelCallRecords.callId, outcome.callIds)]
            : []),
        ),
      )
      .all()
      .filter(
        (row) =>
          !outcome.purpose ||
          modelCallRecordSchema.parse(JSON.parse(row.recordJson)).purpose ===
            outcome.purpose,
      );
    const lastAttempt = Math.max(0, ...rows.map((row) => row.attemptNo));
    for (const row of rows) {
      const record = modelCallRecordSchema.parse(JSON.parse(row.recordJson));
      if (
        row.turnCommitStatus !== "pending" &&
        row.turnCommitStatus !== outcome.status
      ) {
        throw new Error(
          "The saved turn outcome is final. Read the existing outcome before starting another run.",
        );
      }
      if (
        outcome.status === "committed" &&
        record.status === "succeeded" &&
        record.attemptNo === lastAttempt
      ) {
        if (
          record.outputPageId !== null &&
          (record.outputPageId !== outcome.outputPageId ||
            record.outputMessageId !== outcome.outputMessageId)
        ) {
          throw new Error(
            "The model call already references a submitted output. Read the existing output before starting another run.",
          );
        }
        record.outputPageId = outcome.outputPageId;
        record.outputMessageId = outcome.outputMessageId;
      }
      tx.update(modelCallRecords)
        .set({
          recordJson: JSON.stringify(record),
          turnCommitStatus: outcome.status,
        })
        .where(eq(modelCallRecords.callId, row.callId))
        .run();
    }
  }

  get(accountId: string, floorId: string, callId: string): ModelCallDetail {
    const floor = this.requireFloor(accountId, floorId);
    const row = this.db
      .select()
      .from(modelCallRecords)
      .where(
        and(
          eq(modelCallRecords.accountId, accountId),
          eq(modelCallRecords.floorId, floorId),
          eq(modelCallRecords.callId, callId),
        ),
      )
      .get();
    if (!row) throw new ModelCallQueryError("MODEL_CALL_NOT_FOUND");
    return this.detail(
      row.recordJson,
      floor.state,
      floor.runId,
      row.turnCommitStatus,
    );
  }

  list(
    accountId: string,
    floorId: string,
    input: unknown,
  ): { data: ModelCallDetail[]; nextCursor: string | null } {
    const floor = this.requireFloor(accountId, floorId);
    const query = modelCallQuerySchema.parse(input);
    const conditions = [
      eq(modelCallRecords.accountId, accountId),
      eq(modelCallRecords.floorId, floorId),
    ];
    if (query.runId) conditions.push(eq(modelCallRecords.runId, query.runId));
    if (query.attemptNo)
      conditions.push(eq(modelCallRecords.attemptNo, query.attemptNo));
    if (query.cursor) {
      const cursor = this.get(accountId, floorId, query.cursor).call;
      if (
        (query.runId && cursor.runId !== query.runId) ||
        (query.attemptNo && cursor.attemptNo !== query.attemptNo)
      ) {
        throw new ModelCallQueryError("MODEL_CALL_QUERY_INVALID");
      }
      conditions.push(
        or(
          lt(modelCallRecords.preparedAt, cursor.preparedAt),
          and(
            eq(modelCallRecords.preparedAt, cursor.preparedAt),
            lt(modelCallRecords.callId, cursor.callId),
          ),
        )!,
      );
    }
    const rows = this.db
      .select()
      .from(modelCallRecords)
      .where(and(...conditions))
      .orderBy(desc(modelCallRecords.preparedAt), desc(modelCallRecords.callId))
      .limit(query.limit + 1)
      .all();
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((row) =>
        this.detail(
          row.recordJson,
          floor.state,
          floor.runId,
          row.turnCommitStatus,
        ),
      ),
      nextCursor: rows.length > query.limit ? page.at(-1)!.callId : null,
    };
  }

  private requireFloor(accountId: string, floorId: string) {
    const floor = this.db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        branchId: floors.branchId,
        state: floors.state,
        runId: floorRunStates.runId,
      })
      .from(floors)
      .innerJoin(sessions, eq(sessions.id, floors.sessionId))
      .leftJoin(floorRunStates, eq(floorRunStates.floorId, floors.id))
      .where(and(eq(floors.id, floorId), eq(sessions.accountId, accountId)))
      .get();
    if (!floor) throw new ModelCallQueryError("MODEL_CALL_NOT_FOUND");
    return floor;
  }

  private detail(
    recordJson: string,
    state: (typeof floors.$inferSelect)["state"],
    runId: string | null,
    savedOutcome: "pending" | "committed" | "failed",
  ): ModelCallDetail {
    const call = modelCallRecordSchema.parse(JSON.parse(recordJson));
    return {
      call,
      completionEvidence: ["succeeded", "failed", "interrupted"].includes(
        call.status,
      )
        ? "complete"
        : "missing",
      turnCommitStatus:
        savedOutcome !== "pending"
          ? savedOutcome
          : call.purpose === "state_update"
            ? "pending"
            : runId !== call.runId
              ? "unknown"
              : state === "committed"
                ? "committed"
                : state === "failed"
                  ? "failed"
                  : "pending",
    };
  }
}
