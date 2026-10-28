import { z } from "zod";

const identifier = z.string().min(1);
const timestamp = z.number().int().nonnegative();

export const modelCallContextSchema = z
  .object({
    accountId: identifier,
    sessionId: identifier,
    branchId: identifier,
    floorId: identifier,
    runId: identifier,
    attemptNo: z.number().int().positive(),
    stepIndex: z.number().int().nonnegative(),
    slot: identifier,
    purpose: identifier,
    releaseId: identifier.nullable(),
    draftRevision: z.number().int().nonnegative().nullable(),
    resourceVersions: z.record(z.string(), identifier),
    inputPageId: identifier.nullable(),
    inputMessageId: identifier.nullable(),
  })
  .strict();

export const modelCallErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    causes: z.array(
      z.object({ code: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();

export const modelCallRecordSchema = modelCallContextSchema
  .extend({
    callId: identifier,
    invocationId: identifier,
    requestAttemptNo: z.number().int().positive(),
    provider: identifier,
    model: identifier,
    endpoint: z.string().url(),
    requestBody: z.string(),
    responseBody: z.string().nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    status: z.enum([
      "prepared",
      "in_flight",
      "succeeded",
      "failed",
      "interrupted",
    ]),
    preparedAt: timestamp,
    sentAt: timestamp.nullable(),
    firstResponseAt: timestamp.nullable(),
    endedAt: timestamp.nullable(),
    text: z.string().nullable(),
    reasoning: z.string().nullable(),
    toolData: z.array(z.unknown()).nullable(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        totalTokens: z.number().int().nonnegative().nullable(),
      })
      .strict()
      .nullable(),
    finishReason: z.string().nullable(),
    error: modelCallErrorSchema.nullable(),
    outputPageId: identifier.nullable(),
    outputMessageId: identifier.nullable(),
  })
  .strict();

export const modelCallQuerySchema = z
  .object({
    runId: identifier.optional(),
    attemptNo: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: identifier.optional(),
  })
  .strict();

export const modelCallResultSchema = modelCallRecordSchema.pick({
  text: true,
  reasoning: true,
  toolData: true,
  usage: true,
  finishReason: true,
});

export const modelCallDetailSchema = z
  .object({
    call: modelCallRecordSchema,
    completionEvidence: z.enum(["complete", "missing"]),
    turnCommitStatus: z.enum(["pending", "committed", "failed", "unknown"]),
  })
  .strict();

export const modelCallListSchema = z
  .object({
    data: z.array(modelCallDetailSchema),
    nextCursor: identifier.nullable(),
  })
  .strict();

export type ModelCallContext = z.infer<typeof modelCallContextSchema>;
export type ModelCallRecord = z.infer<typeof modelCallRecordSchema>;
export type ModelCallError = z.infer<typeof modelCallErrorSchema>;
export type ModelCallQuery = z.infer<typeof modelCallQuerySchema>;
export type ModelCallDetail = z.infer<typeof modelCallDetailSchema>;
export type ModelCallResult = z.infer<typeof modelCallResultSchema>;

export const modelCallStartSchema = modelCallContextSchema.pick({
  accountId: true,
  floorId: true,
  slot: true,
  purpose: true,
  inputPageId: true,
  inputMessageId: true,
});
export const modelCallSessionMetadataSchema = z
  .object({
    role_release_id: identifier.optional(),
    draft_revision: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type ModelCallStart = z.infer<typeof modelCallStartSchema>;

export const modelCallOutcomeSchema = modelCallContextSchema
  .pick({
    accountId: true,
    floorId: true,
    runId: true,
  })
  .extend({
    status: z.enum(["committed", "failed"]),
    purpose: identifier.optional(),
    callIds: z.array(identifier).min(1).optional(),
    outputPageId: identifier.nullable(),
    outputMessageId: identifier.nullable(),
  })
  .strict();
export type ModelCallOutcome = z.infer<typeof modelCallOutcomeSchema>;

export const modelCallPersistenceScopeSchema = modelCallContextSchema
  .pick({ floorId: true, runId: true })
  .partial();
export type ModelCallPersistenceScope = z.infer<
  typeof modelCallPersistenceScopeSchema
>;
export const modelCallPersistenceDetailsSchema = z
  .object({
    call_id: identifier.nullable(),
    floor_id: identifier.nullable(),
    run_id: identifier.nullable(),
    stage: z.enum([
      "prepared",
      "in_flight",
      "succeeded",
      "failed",
      "interrupted",
      "turn_outcome",
    ]),
    turn_committed: z.boolean(),
    error: modelCallErrorSchema,
  })
  .strict();
export type ModelCallPersistenceDetails = z.infer<
  typeof modelCallPersistenceDetailsSchema
>;

export const generationDetailLocationSchema = z
  .object({
    sessionId: identifier,
    branchId: identifier,
    floorId: identifier,
    runId: identifier.optional(),
    pageId: identifier.optional(),
    callId: identifier.optional(),
  })
  .strict();
export type GenerationDetailLocation = z.infer<
  typeof generationDetailLocationSchema
>;
