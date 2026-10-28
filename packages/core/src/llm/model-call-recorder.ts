import { apiErrorMessages } from "@tavern/shared";
import type {
  ModelCallContext,
  ModelCallRecord,
  ModelCallError,
  ModelCallPersistenceScope,
  ModelCallPersistenceDetails,
} from "@tavern/shared";

export interface ModelCallRecorder {
  save(record: ModelCallRecord): Promise<void>;
}

export interface ModelCallRecording {
  context: ModelCallContext;
  recorder: ModelCallRecorder;
  streamSaveIntervalMs: number;
}

export class ModelCallPersistenceError extends Error {
  readonly code = "MODEL_CALL_SAVE_FAILED";

  constructor(
    readonly callId: string | null,
    readonly stage: ModelCallRecord["status"] | "turn_outcome",
    cause: unknown,
    readonly turnCommitted = false,
    readonly scope: ModelCallPersistenceScope = {},
  ) {
    super(
      apiErrorMessages.MODEL_CALL_SAVE_DIAGNOSTIC.replace(
        "{identity}",
        JSON.stringify({ callId, ...scope }),
      )
        .replace("{stage}", stage)
        .replace(
          "{commitNotice}",
          turnCommitted
            ? apiErrorMessages.MODEL_CALL_SAVE_COMMITTED_NOTICE
            : "",
        ),
      { cause },
    );
    this.name = "ModelCallPersistenceError";
  }
}

export function findModelCallPersistenceError(
  error: unknown,
): ModelCallPersistenceError | undefined {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length) {
    const item = pending.pop();
    if (item instanceof ModelCallPersistenceError) return item;
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if ("cause" in item) pending.push(item.cause);
    if ("errors" in item && Array.isArray(item.errors))
      pending.push(...item.errors);
  }
  return undefined;
}

export function modelCallErrorEvidence(error: unknown): ModelCallError {
  const causes: ModelCallError["causes"] = [];
  const visited = new Set<unknown>();
  const pending = [error];
  while (pending.length) {
    const value = pending.shift();
    if (visited.has(value)) continue;
    visited.add(value);
    const entry = value as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown[];
    } | null;
    causes.push({
      code: String(entry?.code ?? "MODEL_CALL_FAILED"),
      message: String(entry?.message ?? value),
    });
    if (entry?.cause) pending.push(entry.cause);
    if (Array.isArray(entry?.errors)) pending.push(...entry.errors);
  }
  const [first, ...rest] = causes;
  return { ...first!, causes: rest };
}

export function modelCallPersistenceDetails(
  error: unknown,
): ModelCallPersistenceDetails | undefined {
  const failure = findModelCallPersistenceError(error);
  if (!failure) return undefined;
  return {
    call_id: failure.callId,
    floor_id: failure.scope.floorId ?? null,
    run_id: failure.scope.runId ?? null,
    stage: failure.stage,
    turn_committed: failure.turnCommitted,
    error: modelCallErrorEvidence(error),
  };
}
