import { z } from "zod";
import { roleStateSourceMessageSchema } from "./role-state.js";

export const statePromptDryRunRequestSchema = z
  .object({
    floor_id: z.string().min(1),
    expected_snapshot_id: z.string().min(1),
  })
  .strict();
export const stateVariableHistoryRoundSchema = z
  .object({
    floorId: z.string().min(1),
    floorNo: z.number().int().nonnegative(),
    before: z.record(z.string(), z.unknown()),
    after: z.record(z.string(), z.unknown()),
    changes: z.array(
      z
        .object({
          op: z.enum(["set", "remove"]),
          path: z.string().startsWith("/"),
          value: z.unknown().optional(),
        })
        .strict(),
    ),
    snapshotIds: z.array(z.string().min(1)),
  })
  .strict();
export const statePromptPreviewSchema = z
  .object({
    messages: z.array(
      z
        .object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        })
        .strict(),
    ),
    preset: z
      .object({
        presetId: z.string().min(1),
        presetVersionId: z.string().min(1),
      })
      .strict(),
    before: z.record(z.string(), z.unknown()),
    previousSnapshotId: z.string().min(1),
    sources: z.array(roleStateSourceMessageSchema),
    variableHistory: z.array(stateVariableHistoryRoundSchema),
    sourceIdentity: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    prompt_snapshot: z.record(z.string(), z.unknown()),
    assembly: z.record(z.string(), z.unknown()),
    runtime_trace: z.record(z.string(), z.unknown()),
    token_usage: z
      .object({ total: z.number(), availableForReply: z.number() })
      .passthrough(),
  })
  .strict();
export const statePromptPreviewResponseSchema = z
  .object({ data: statePromptPreviewSchema })
  .strict();
export type StatePromptDryRunRequest = z.infer<
  typeof statePromptDryRunRequestSchema
>;
export type StatePromptPreview = z.infer<typeof statePromptPreviewSchema>;
export type StateVariableHistoryRound = z.infer<
  typeof stateVariableHistoryRoundSchema
>;
