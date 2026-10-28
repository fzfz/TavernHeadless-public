import { presetStreamingSchema } from "./preset-output.js";
import {
  rolePromptControllerConfigBaseSchema,
  rolePromptControllerConfigSchema,
} from "./role-prompt-controller.js";
import { z } from "zod";
import { roleStateBundleSchema } from "./role-state.js";

export const regexMigrationSchema = z
  .object({
    sources: z.record(z.string(),
      z
        .object({
          rules: z.array(
            z
              .object({
                id: z.string().min(1),
                name: z.string(),
                decision: z.enum(["keep", "remove"]),
                reason: z.string().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export const roleRegexScriptSchema = z
  .object({
    id: z.string().min(1),
    findRegex: z.string(),
    replaceString: z.string(),
    minDepth: z.number().nullable().optional(),
    maxDepth: z.number().nullable().optional(),
  })
  .passthrough();
export const roleRegexSourceSchema = z
  .object({
    key: z.string(),
    kind: z.string(),
    name: z.string(),
    resourceId: z.string().optional(),
    versionId: z.string().optional(),
    scripts: z.array(roleRegexScriptSchema),
  })
  .strict();
export const mvuMigrationPlanSchema = z
  .object({
    disabledEntryIds: z.array(z.number().int()),
    ruleEntryIds: z.array(z.number().int()),
    readonlyPaths: z.array(z.string()),
    cleanRuleFiles: z.array(z.string()),
    controllerEntryIds: z.array(z.number().int()),
    variableMacros:
      rolePromptControllerConfigBaseSchema.shape.variableMacros.optional(),
    initialEntryId: z.number().int(),
    updaterPrompt: z.string().optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();
export const mvuMigrationSchema = z.record(z.string(), mvuMigrationPlanSchema);
export const roleWorldbookEntrySchema = z
  .object({
    uid: z.number().int().optional(),
    id: z.number().int().optional(),
    comment: z.string().optional(),
    content: z.string(),
    enabled: z.boolean().optional(),
    disable: z.boolean().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export const roleWorldbookSchema = z
  .object({
    entries: z.union([
      z.array(roleWorldbookEntrySchema),
      z.record(z.string(), roleWorldbookEntrySchema),
    ]),
  })
  .passthrough();
export const roleImportCharacterSchema = z
  .object({
    name: z.string(),
    greeting: z.string(),
    alternateGreetings: z.array(z.string()).optional(),
    characterBook: roleWorldbookSchema,
    extensions: z
      .object({
        tavern_headless: z
          .object({
            stateUpdate: roleStateBundleSchema,
            promptController: rolePromptControllerConfigSchema.optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
export const rolePresetSourceSchema = z
  .object({
    prompts: z
      .array(
        z
          .object({
            identifier: z.string(),
            role: z.string().optional(),
            content: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    extensions: z
      .object({
        regex_scripts: z.array(roleRegexScriptSchema).optional(),
        tavern_headless: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export const presetOutputMigrationSchema = z
  .object({
    sourceRuleIds: z.array(z.string().min(1)).min(1),
    delivery: z.enum(["complete", "streaming"]),
    streaming: presetStreamingSchema.optional(),
  })
  .strict()
  .refine((p) => p.delivery !== "streaming" || !!p.streaming);
export const presetImportPolicySchema = z
  .object({
    roleAliases: z.record(z.string(), z.string()),
    commentMacros: z.boolean(),
    trimMacro: z.boolean(),
  })
  .strict();
export const openingImportMetadataSchema = z
  .object({
    defaultOpeningId: z.string().min(1),
    entries: z.record(z.string(),
      z
        .object({
          title: z.string().optional(),
          summary: z.string().optional(),
          kind: z.enum(["story", "introduction"]).optional(),
          variables: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export const openingPatchSchema = z.array(
  z
    .object({
      op: z.literal("replace"),
      path: z.string().startsWith("/"),
      value: z.unknown(),
    })
    .strict(),
);
export const openingSourceSchema = z
  .object({
    greeting: z.string(),
    alternateGreetings: z.array(z.string()).optional(),
  })
  .passthrough();
export type RoleRegexSource = z.infer<typeof roleRegexSourceSchema>;
export type RegexMigration = z.infer<typeof regexMigrationSchema>;
export type RoleWorldbookEntry = z.infer<typeof roleWorldbookEntrySchema>;
export type RoleWorldbook = z.infer<typeof roleWorldbookSchema>;
export type MvuMigrationPlan = z.infer<typeof mvuMigrationPlanSchema>;
export type RoleImportCharacter = z.infer<typeof roleImportCharacterSchema>;
export type RolePresetSource = z.infer<typeof rolePresetSourceSchema>;
export type PresetImportPolicy = z.infer<typeof presetImportPolicySchema>;
export type PresetOutputMigration = z.infer<typeof presetOutputMigrationSchema>;
export type OpeningImportMetadata = z.infer<typeof openingImportMetadataSchema>;

export const roleCharacterPreparationSchema = z
  .object({
    snapshot: roleImportCharacterSchema,
    metadata: openingImportMetadataSchema,
    migration: mvuMigrationPlanSchema,
  })
  .strict();
export type RoleCharacterPreparation = z.infer<
  typeof roleCharacterPreparationSchema
>;

export const roleCharacterMigrationOptionsSchema =
  roleCharacterPreparationSchema
    .omit({ snapshot: true })
    .extend({ stateUpdate: roleStateBundleSchema });
export type RoleCharacterMigrationOptions = z.infer<
  typeof roleCharacterMigrationOptionsSchema
>;
