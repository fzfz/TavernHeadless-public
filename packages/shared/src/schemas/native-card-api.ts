import { z } from "zod";
import {
  nativeCardPackageManifestSchema,
  nativeCardWorldbookSchema,
} from "./native-card-package/schema.js";
import { roleAssetPathSchema, roleAssetPurposeSchema } from "./role-assets.js";
import {
  roleReleaseModelSlotInputSchema,
  roleReleasePromptModes,
} from "./role-release.js";
import { roleModelCapabilitiesGrantSchema } from "./role-model-capabilities.js";
import {
  roleStateRuntimeConfigurationObjectSchema,
  validateRoleStateRuntimeConfiguration,
} from "./role-state.js";

const id = z.string().trim().min(1);
const revision = z.number().int().positive();
export const nativeCardIssueSchema = z
  .object({
    code: id,
    path: z.string(),
    pointer: z.string().optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    operationIndex: z.number().int().nonnegative().optional(),
    message: z.string().min(1),
    action: z.string().min(1),
    expected: z.string().optional(),
  })
  .strict();
export const nativeCardFileInfoSchema = z
  .object({
    path: roleAssetPathSchema,
    mediaType: id,
    purpose: roleAssetPurposeSchema,
    byteSize: z.number().int().nonnegative(),
  })
  .strict();
export const nativeCardVersionSchema = z
  .object({
    id,
    revision,
    createdAt: z.number().int().nonnegative(),
    note: z.string().optional(),
  })
  .strict();
export const nativeCardSchema = z
  .object({
    id,
    characterId: id,
    packageId: id,
    name: id,
    revision,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    files: z.array(nativeCardFileInfoSchema),
    versions: z.array(nativeCardVersionSchema),
  })
  .strict();
export const nativeCardFileContentSchema = z
  .object({
    path: roleAssetPathSchema,
    mediaType: id,
    encoding: z.enum(["utf8", "base64"]),
    content: z.string(),
  })
  .strict();
export const nativeCardOperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("write"),
      path: roleAssetPathSchema,
      encoding: z.enum(["utf8", "base64"]),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("move"),
      path: roleAssetPathSchema,
      to: roleAssetPathSchema,
    })
    .strict(),
  z.object({ op: z.literal("delete"), path: roleAssetPathSchema }).strict(),
]);
export const nativeCardSaveSchema = z
  .object({
    expectedRevision: revision,
    operations: z.array(nativeCardOperationSchema).min(1),
  })
  .strict();
export const nativeCardCreateSchema = z
  .object({ name: id.max(200), sourceVersionId: id.optional() })
  .strict();
export const nativeCardValidationSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(nativeCardIssueSchema),
  })
  .strict();
export const nativeCardImportSummarySchema = z
  .object({
    formatVersion: nativeCardPackageManifestSchema.shape.formatVersion,
    worldbookCount: z.number().int().nonnegative(),
    openingCount: z.number().int().nonnegative(),
    initialStateCount: z.number().int().nonnegative(),
    stateUpdate: z
      .object({
        rules: z.boolean(),
        schema: z.boolean(),
        validators: z.boolean(),
        tools: z.boolean(),
      })
      .strict(),
    promptController: z.boolean(),
    frontend: z
      .object({
        page: z.boolean(),
        script: z.boolean(),
        style: z.boolean(),
        media: z.boolean(),
      })
      .strict(),
    regexProfileCount: z.number().int().nonnegative(),
  })
  .strict();
export type NativeCardImportSummary = z.infer<
  typeof nativeCardImportSummarySchema
>;

export const nativeCardImportSchema = z
  .object({
    id,
    fileName: z.string(),
    packageId: z.string(),
    name: z.string(),
    summary: nativeCardImportSummarySchema.nullable(),
    files: z.array(nativeCardFileInfoSchema),
    issues: z.array(nativeCardIssueSchema),
    status: z.enum(["ready", "invalid"]),
  })
  .strict();
export const nativeCardBuildSourceSchema = z.union([
  z.object({ revision }).strict(),
  z.object({ versionId: id }).strict(),
]);
export const nativeCardBuildRequestSchema = z
  .object({ source: nativeCardBuildSourceSchema })
  .strict();
export const nativeCardBuildSchema = z
  .object({
    id,
    cardId: id,
    revision,
    versionId: id.optional(),
    status: z.enum(["queued", "running", "succeeded", "failed"]),
    stage: z.enum(["validating", "archiving", "ready"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    issues: z.array(nativeCardIssueSchema),
    downloadUrl: z.string().optional(),
  })
  .strict();
export const nativeCardSystemConfigurationSchema = z
  .object({
    presetId: id,
    presetVersionId: id,
    defaultUserId: id,
    promptMode: z.enum(roleReleasePromptModes),
    modelSlots: z.array(roleReleaseModelSlotInputSchema).min(1),
    model_capabilities: roleModelCapabilitiesGrantSchema.nullable().optional(),
  })
  .extend(roleStateRuntimeConfigurationObjectSchema.shape)
  .strict()
  .superRefine(validateRoleStateRuntimeConfiguration);
export const nativeCardPublishSchema = z
  .object({
    revision,
    configuration: nativeCardSystemConfigurationSchema,
    note: z.string().optional(),
  })
  .strict();
export const nativeCardPreviewSchema = nativeCardPublishSchema.extend({
  openingId: id.optional(),
  userId: id.optional(),
  sessionType: z.enum(["individual", "group"]).optional(),
});
export const nativeCardPreviewResultSchema = z
  .object({
    cardId: id,
    revision,
    sessionId: id,
    openingId: id.nullable(),
  })
  .strict();
export const nativeCardPublicationSchema = nativeCardVersionSchema.extend({
  cardId: id,
  characterId: id,
  characterVersionId: id,
  releaseId: id,
});
export const nativeCardIdParamsSchema = z.object({ cardId: id }).strict();
export const nativeCardImportParamsSchema = z.object({ importId: id }).strict();
export const nativeCardBuildParamsSchema = z.object({ buildId: id }).strict();
export const nativeCardRevisionQuerySchema = z
  .object({ revision: revision.optional() })
  .strict();
export const nativeCardFileQuerySchema = z
  .object({ revision: revision.optional(), path: roleAssetPathSchema })
  .strict();
export type NativeCard = z.infer<typeof nativeCardSchema>;
export type NativeCardCreate = z.infer<typeof nativeCardCreateSchema>;
export type NativeCardFileContent = z.infer<typeof nativeCardFileContentSchema>;
export type NativeCardFileInfo = z.infer<typeof nativeCardFileInfoSchema>;
export type NativeCardIssue = z.infer<typeof nativeCardIssueSchema>;
export type NativeCardOperation = z.infer<typeof nativeCardOperationSchema>;
export type NativeCardSave = z.infer<typeof nativeCardSaveSchema>;
export type NativeCardImport = z.infer<typeof nativeCardImportSchema>;
export type NativeCardValidation = z.infer<typeof nativeCardValidationSchema>;
export type NativeCardBuild = z.infer<typeof nativeCardBuildSchema>;
export type NativeCardBuildSource = z.infer<typeof nativeCardBuildSourceSchema>;
export type NativeCardSystemConfiguration = z.infer<
  typeof nativeCardSystemConfigurationSchema
>;
export type NativeCardPublish = z.infer<typeof nativeCardPublishSchema>;
export type NativeCardPreview = z.infer<typeof nativeCardPreviewSchema>;
export type NativeCardPreviewResult = z.infer<
  typeof nativeCardPreviewResultSchema
>;
export type NativeCardPublication = z.infer<typeof nativeCardPublicationSchema>;
export const nativeCardImportQuerySchema = z
  .object({ fileName: z.string().min(1).max(255).optional() })
  .strict();

export const nativeCardWriteFailureDetailsSchema = z
  .object({
    stage: z.enum(["file-commit", "database-commit"]),
    committed: z.literal(false).optional(),
    cardId: id.optional(),
    revision: revision.optional(),
    importId: id.optional(),
    cleanupFailed: z.boolean().optional(),
  })
  .strict();
export type NativeCardWriteFailureDetails = z.infer<
  typeof nativeCardWriteFailureDetailsSchema
>;

export const nativeCardRevisionConflictDetailsSchema = z
  .object({
    expectedRevision: revision,
    actualRevision: revision,
  })
  .strict();
export type NativeCardRevisionConflictDetails = z.infer<
  typeof nativeCardRevisionConflictDetailsSchema
>;

export const nativeCardAllocateEntryUidSchema = z
  .object({
    expectedRevision: revision,
    bookId: id,
    reservedUids: z.array(z.number().int().safe().nonnegative()),
    draftBook: nativeCardWorldbookSchema.optional(),
  })
  .strict();
export const nativeCardAllocateEntryUidResultSchema = z
  .object({
    uid: z.number().int().safe().nonnegative(),
  })
  .strict();
export type NativeCardAllocateEntryUid = z.infer<
  typeof nativeCardAllocateEntryUidSchema
>;
export type NativeCardAllocateEntryUidResult = z.infer<
  typeof nativeCardAllocateEntryUidResultSchema
>;
