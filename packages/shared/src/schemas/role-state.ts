import policy from "../config/role-state.json" with { type: "json" };
import { z } from "zod";
import {
  evidenceExecutionIdsSchema,
  type RoleToolEvidence,
} from "./role-tool-evidence.js";
import {
  defaultStateModelSlots,
  llmModelSlots,
} from "../generated/llm-slots.js";
export type RoleState = Record<string, unknown>;
const resourceId = z.string().trim().min(1);
export const roleStatePresetRefSchema = z
  .object({
    presetId: resourceId,
    presetVersionId: resourceId,
  })
  .strict();

export const roleStateRuntimeConfigurationObjectSchema = z
  .object({
    statePresetId: resourceId.optional(),
    statePresetVersionId: resourceId.optional(),
    stateHistoryTurns: z.number().int().nonnegative().optional(),
  })
  .strict();

export type RoleStateRuntimeConfiguration = z.infer<
  typeof roleStateRuntimeConfigurationObjectSchema
>;

export function validateRoleStateRuntimeConfiguration(
  value: RoleStateRuntimeConfiguration,
  context: z.RefinementCtx,
): void {
  if (
    (value.statePresetId === undefined) !==
    (value.statePresetVersionId === undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [
        value.statePresetId === undefined
          ? "statePresetId"
          : "statePresetVersionId",
      ],
      message: roleStatePolicy.runtimeConfigurationErrors.presetPairRequired,
    });
  }
}

export const roleStateRuntimeConfigurationSchema =
  roleStateRuntimeConfigurationObjectSchema.superRefine(
    validateRoleStateRuntimeConfiguration,
  );

export const roleStateRuntimeConfigurationJsonSchemaProperties = {
  statePresetId: { type: "string", minLength: 1 },
  statePresetVersionId: { type: "string", minLength: 1 },
  stateHistoryTurns: { type: "integer", minimum: 0 },
} as const;

export const roleStateRuntimeConfigurationJsonSchema = {
  type: "object",
  properties: roleStateRuntimeConfigurationJsonSchemaProperties,
  allOf: [
    {
      anyOf: [
        {
          not: {
            anyOf: [
              { required: ["statePresetId"] },
              { required: ["statePresetVersionId"] },
            ],
          },
        },
        { required: ["statePresetId", "statePresetVersionId"] },
      ],
    },
  ],
  additionalProperties: false,
} as const;
export const roleStateSourceMessageSchema = z
  .object({
    messageId: z.string().min(1),
    revision: z.number().int().positive(),
    role: z.string().min(1),
    text: z.string(),
  })
  .strict();
export type RoleStateSourceMessage = z.infer<
  typeof roleStateSourceMessageSchema
>;
export const roleStateOutputSchema = z
  .object({
    changes: z.array(
      z
        .object({
          op: z.enum(["set", "remove"]),
          path: z.string().startsWith("/"),
          value: z.unknown().optional(),
        })
        .strict(),
    ),
    evidenceMessageIds: z.array(z.string().min(1)),
    evidenceExecutionIds: evidenceExecutionIdsSchema.optional(),
    facts: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type RoleStateOutput = z.infer<typeof roleStateOutputSchema>;
export const roleStateProposalInspectionInputSchema = z
  .object({
    proposal: roleStateOutputSchema,
    sourceMessages: z.array(roleStateSourceMessageSchema).min(1),
  })
  .strict();
export const roleStateProposalInspectionResultSchema = z
  .object({
    before: z.record(z.string(), z.unknown()),
    candidate: z.record(z.string(), z.unknown()).nullable(),
    derived: z.record(z.string(), z.unknown()).nullable(),
    issues: z.array(
      z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          details: z.unknown().optional(),
        })
        .strict(),
    ),
    valid: z.boolean(),
  })
  .strict();
export const roleStateProposalInspectionResponseSchema = z
  .object({
    data: roleStateProposalInspectionResultSchema,
  })
  .strict();
export type RoleStateProposalInspectionInput = z.infer<
  typeof roleStateProposalInspectionInputSchema
>;
export type RoleStateProposalInspectionResult = z.infer<
  typeof roleStateProposalInspectionResultSchema
>;
export type RoleStateValidator = ((value: unknown) => boolean) & {
  errors?: unknown;
};
export type RoleStateDerivationContext = {
  before: RoleState;
  candidate: RoleState;
  sourceMessages: RoleStateSourceMessage[];
  toolEvidence: RoleToolEvidence[];
  priorFacts: unknown[];
  floorBefore: RoleState;
  facts: Record<string, unknown>;
};
export type RoleStateProposalProfile = {
  writablePaths: string[];
  derivedPaths?: string[];
  factsSchema?: Record<string, unknown>;
  validateFacts?: RoleStateValidator;
  derive?: (context: RoleStateDerivationContext) => RoleState;
  validate?: (context: RoleStateDerivationContext) => { issues: unknown[] };
};

export type RoleDisplaySnapshot = {
  sessionId: string;
  branchId: string;
  floorId: string | null;
  attemptId: string | null;
  versionId: string;
  snapshotId: string;
  parentSnapshotId: string | null;
  variables: RoleState;
  source: {
    kind: "initial" | "floor" | "job" | "manual";
    runId: string | null;
    jobId: string | null;
  };
};

export const roleStateProfileSchema = z
  .object({
    id: z.string().optional(),
    updaterPrompt: z.string(),
    presetRef: roleStatePresetRefSchema.optional(),
    writablePaths: z.array(z.string().startsWith("/")),
    stateSchema: z.record(z.string(), z.unknown()).optional(),
    stateSchemaFile: z.string().optional(),
    ruleFiles: z.array(z.string()).optional(),
    deriveScript: z.string().optional(),
    validateScript: z.string().optional(),
    moduleFiles: z.array(z.string()).optional(),
    factsSchema: z.record(z.string(), z.unknown()).optional(),
    derivedPaths: z.array(z.string()).optional(),
    controllerOwnedPaths: z.array(z.string()).optional(),
    initialDescriptionPaths: z.array(z.string().startsWith("/")).optional(),
    modelSlot: z.enum(llmModelSlots).optional(),
    maxTokens: z.number().int().positive().optional(),
    updaterReasoning: z
      .object({ effort: z.enum(["none", "low", "medium", "high"]) })
      .passthrough()
      .optional(),
  })
  .passthrough();
export const roleStateBundleSchema = z
  .object({ profile: roleStateProfileSchema, files: z.record(z.string(), z.string()) })
  .strict();
export type RoleStateProfile = z.infer<typeof roleStateProfileSchema>;
export const roleStateUpdateRequestSchema = z
  .object({ floor_id: z.string().min(1) })
  .strict();

export const roleStatePolicySchema = z
  .object({
    releaseFieldNames: z
      .object({
        statePresetId: z.literal("state_preset_id"),
        statePresetVersionId: z.literal("state_preset_version_id"),
        stateHistoryTurns: z.literal("state_history_turns"),
      })
      .strict(),
    runtimeConfigurationErrors: z
      .object({ presetPairRequired: z.string().min(1) })
      .strict(),
    controllerModulePath: z.string().min(1),
    retryHeader: z.string().min(1),
    eventReconnectDelayMs: z.number().int().positive(),
    defaultHistoryTurns: z.number().int().nonnegative(),
    defaultModelSlot: z.enum(defaultStateModelSlots),
    outputInstructions: z.array(z.string().min(1)),
    factsEvidenceInstruction: z.string().min(1),
    changesEvidenceInstruction: z.string().min(1),
    changesDescription: z.string().min(1),
  })
  .strict();
export const roleStatePolicy = roleStatePolicySchema.parse(policy);

export const statePromptBindingSchema = z
  .object({
    ...roleStatePresetRefSchema.shape,
    historyTurns: z
      .number()
      .int()
      .nonnegative()
      .default(roleStatePolicy.defaultHistoryTurns),
  })
  .strict();
export type StatePromptBinding = z.infer<typeof statePromptBindingSchema>;
