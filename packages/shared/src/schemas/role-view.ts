import { z } from "zod";

export const roleSnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    branchId: z.string().min(1),
    floorId: z.string().min(1).nullable(),
    attemptId: z.string().min(1).nullable(),
    versionId: z.string().min(1),
    snapshotId: z.string().min(1),
    parentSnapshotId: z.string().min(1).nullable(),
    variables: z.record(z.string(), z.unknown()),
    source: z
      .object({
        kind: z.enum(["initial", "floor", "job", "manual"]),
        runId: z.string().nullable(),
        jobId: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
export const roleDocumentAssetOriginOffsetsSchema = z.array(z.number().int().nonnegative())
  .refine(offsets => offsets.every((offset, index) => index === 0 || offset > offsets[index - 1]!))
  .describe("Strictly increasing, unique UTF-16 offsets into the delivered HTML. Each offset identifies the start of a package resource's root-relative URL, where the client inserts the corresponding HTML URL's origin.");

const roleDeliveryBaseSchema = z
  .object({
    html: z.string(),
    css: z.string(),
    htmlUrl: z.string().min(1).optional(),
    htmlAssetOriginOffsets: roleDocumentAssetOriginOffsetsSchema.optional(),
    dataUrls: z.record(z.string(), z.string().min(1)).optional(),
    cssUrl: z.string().min(1).optional(),
    floorHtmlUrl: z.string().min(1).optional(),
    floorHtmlAssetOriginOffsets: roleDocumentAssetOriginOffsetsSchema.optional(),
    floorHtml: z.string().nullable(),
    assets: z.record(z.string(),
      z
        .object({
          kind: z.enum(["image", "audio"]),
          url: z.string().min(1),
          label: z.string(),
          tags: z.array(z.string()),
        })
        .strict(),
    ),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export const roleDeliverySchema = z.union([
  roleDeliveryBaseSchema.extend({
    mode: z.literal("custom").optional(),
    scriptUrl: z.string().min(1),
  }),
  roleDeliveryBaseSchema.extend({
    mode: z.literal("system_chat"),
    scriptUrl: z.null(),
    html: z.literal(""),
    css: z.literal(""),
    floorHtml: z.null(),
  }),
]).refine(delivery => {
  const validOffsets = (html: string | null, url: string | undefined, offsets: number[] | undefined) =>
    offsets === undefined || (html !== null && url !== undefined && offsets.every(offset => offset < html.length && html[offset] === "/" && html[offset + 1] !== "/"));
  return validOffsets(delivery.html, delivery.htmlUrl, delivery.htmlAssetOriginOffsets)
    && validOffsets(delivery.floorHtml, delivery.floorHtmlUrl, delivery.floorHtmlAssetOriginOffsets);
});
export const roleViewSchema = z
  .object({
    character_id: z.string().nullable(),
    character_version_id: z.string().min(1),
    name: z.string().nullable(),
    delivery: roleDeliverySchema,
    initial: roleSnapshotSchema,
    current: roleSnapshotSchema,
    processing: z
      .object({
        pendingMain: z.null(),
        pendingFollowups: z.boolean(),
        pendingStateFloorId: z.string().nullable(),
      })
      .strict(),
    capabilities: z
      .object({
        send: z.boolean(),
        history: z.boolean(),
        customFloors: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const roleSessionParamsSchema = z
  .object({ id: z.string().min(1) })
  .strict();
export const roleSnapshotParamsSchema = roleSessionParamsSchema.extend({
  snapshotId: z.string().min(1),
});
export const roleViewQuerySchema = z.object({ branch_id: z.string().min(1).optional() }).strict();
const roleHistoryPaginationQueryFields = {
  branch_id: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional(),
};
export const roleSnapshotListQuerySchema = z
  .object(roleHistoryPaginationQueryFields)
  .strict();
export const roleFloorListQuerySchema = z
  .object(roleHistoryPaginationQueryFields)
  .strict();
export const roleSnapshotPointerSchema = z
  .object({
    snapshotId: z.string().min(1),
    floorId: z.string().min(1).nullable(),
    attemptId: z.string().min(1).nullable(),
  })
  .strict();
export const roleSnapshotPageSchema = z
  .object({
    items: z.array(roleSnapshotPointerSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export const roleFloorSummarySchema = z
  .object({
    floorId: z.string().min(1),
    floorNo: z.number().int().nonnegative(),
    state: z.enum(["draft", "generating", "committed", "failed"]),
  })
  .strict();
export const roleFloorPageSchema = z
  .object({
    items: z.array(roleFloorSummarySchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export const roleSnapshotPageResponseSchema = z
  .object({ data: roleSnapshotPageSchema })
  .strict();
export const roleFloorPageResponseSchema = z
  .object({ data: roleFloorPageSchema })
  .strict();
export const roleViewResponseSchema = z
  .object({ data: roleViewSchema })
  .strict();
export const roleSnapshotResponseSchema = z
  .object({ data: roleSnapshotSchema })
  .strict();
export type RoleView = z.infer<typeof roleViewSchema>;
export type RoleDelivery = z.infer<typeof roleDeliverySchema>;

export const roleOpeningStateSchema = z
  .object({
    id: z.string(),
    displayText: z.string(),
    variables: z.record(z.string(), z.unknown()),
  })
  .passthrough();
export const roleSessionCharacterSchema = z
  .object({
    extensions: z
      .object({
        tavern_headless: z
          .object({
            openings: z
              .object({ items: z.array(roleOpeningStateSchema) })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
export const roleSessionPersonaSchema = z
  .object({
    name: z.string().optional(),
    avatar: z.string().nullable().optional(),
  })
  .passthrough();
export const roleSessionMetadataSchema = z
  .object({ opening_id: z.string().optional() })
  .passthrough();
