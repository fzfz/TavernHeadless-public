import { z } from "zod";

export const migratedEntryUsageSchema = z
  .object({
    sourceEntryId: z.number().int(),
    usage: z.enum(["variable-rule", "retired-protocol", "opening-state"]),
    target: z.string().min(1),
  })
  .strict();
export const migrationIssueSchema = z
  .object({
    reason: z.string(),
    entryId: z.union([z.number(), z.string()]).optional(),
    file: z.string().optional(),
    target: z.string().optional(),
  })
  .strict();
export const controllerOwnedPathsSchema = z
  .array(z.string().startsWith("/"))
  .refine((paths) => new Set(paths).size === paths.length);
export const stateContractParamsSchema = z
  .object({ id: z.string().min(1), versionId: z.string().min(1) })
  .strict();
export const stateContractResponseSchema = z
  .object({ systemPrompt: z.string(), outputSchema: z.record(z.string(), z.unknown()) })
  .strict();
export type MigrationIssue = z.infer<typeof migrationIssueSchema>;
