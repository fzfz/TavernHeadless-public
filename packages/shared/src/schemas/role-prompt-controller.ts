import { z } from "zod";
const uniqueEntryIdsSchema = z
  .array(z.number().int())
  .refine(
    (items) => new Set(items).size === items.length,
    "Entry ids must be unique",
  );
const entryReferenceSchema = z.object({
  bookId: z.string().trim().min(1),
  entryId: z.number().int(),
}).strict();
const uniqueEntryReferencesSchema = z.array(entryReferenceSchema).refine(
  (items) => new Set(items.map((item) => `${item.bookId}\u0000${item.entryId}`)).size === items.length,
  "Worldbook entry references must be unique",
);

export const rolePromptControllerConfigBaseSchema = z
  .object({
    modulePath: z.string().min(1),
    controllerEntryIds: uniqueEntryIdsSchema.optional(),
    updaterEntryIds: uniqueEntryIdsSchema.optional(),
    controllerEntries: uniqueEntryReferencesSchema.optional(),
    updaterEntries: uniqueEntryReferencesSchema.optional(),
    variableRoot: z.string().min(1),
    variableMacros: z.array(
      z
        .object({
          source: z.string().min(1),
          target: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const rolePromptControllerConfigSchema = rolePromptControllerConfigBaseSchema.superRefine((value, context) => {
    const legacyConfigured = value.controllerEntryIds !== undefined || value.updaterEntryIds !== undefined;
    const scopedConfigured = value.controllerEntries !== undefined || value.updaterEntries !== undefined;
    if (legacyConfigured === scopedConfigured) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controllerEntries"],
        message: "Choose exactly one entry reference mode: legacy ids or worldbook-scoped entries.",
      });
    }
    if (legacyConfigured && (value.controllerEntryIds === undefined || value.updaterEntryIds === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["controllerEntryIds"], message: "Legacy controller and updater id lists must both be present." });
    }
    if (scopedConfigured && (value.controllerEntries === undefined || value.updaterEntries === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["controllerEntries"], message: "Scoped controller and updater entry lists must both be present." });
    }
  });

export const roleCharacterBookSchema = z
  .object({
    entries: z.array(
      z
        .object({
          id: z.number().int(),
          enabled: z.boolean(),
          content: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const rolePromptControllerResultSchema = z
  .object({
    text: z.string(),
    referencedEntryIds: uniqueEntryIdsSchema.optional(),
  })
  .passthrough();

export type RolePromptControllerConfig = z.infer<
  typeof rolePromptControllerConfigSchema
>;

export type RolePromptModuleLoader = (accountId: string, versionId: string, path: string) => Promise<Record<string, unknown>>;
