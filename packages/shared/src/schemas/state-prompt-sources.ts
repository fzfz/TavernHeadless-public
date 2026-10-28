import config from "../config/state-prompt-sources.json" with { type: "json" };
import { z } from "zod";

const statePromptSourcesConfigSchema = z.object({
  defaultParameters: z.object({
    role: z.enum(["system", "user", "assistant"]),
    budgetGroup: z.string().min(1),
    pinned: z.boolean(),
    prunable: z.boolean(),
  }).strict(),
  sources: z.object({
    definition: z.string().min(1),
    rules: z.string().min(1),
    before: z.string().min(1),
    history: z.string().min(1),
    evidence: z.string().min(1),
    outputContract: z.string().min(1),
  }).strict(),
  errors: z.object({
    duplicateSourceId: z.string().min(1),
    unknownSourceId: z.string().min(1),
  }).strict(),
}).strict().superRefine((value, context) => {
  const sourceIds = Object.values(value.sources);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["sources"],
      message: value.errors.duplicateSourceId,
    });
  }
});

export const statePromptSources = statePromptSourcesConfigSchema.parse(config);
export const statePromptSourceNames = statePromptSources.sources;
export const statePromptSourceIds = Object.values(statePromptSourceNames);
export const statePromptSourceIdSchema = z.string().refine(
  (sourceId) => statePromptSourceIds.includes(sourceId),
  { message: statePromptSources.errors.unknownSourceId },
);
export type StatePromptSourceId = z.infer<typeof statePromptSourceIdSchema>;
export type StatePromptSourceDefaults = typeof statePromptSources.defaultParameters;

export function isStatePromptSourceId(sourceId: string): sourceId is StatePromptSourceId {
  return statePromptSourceIds.includes(sourceId);
}
