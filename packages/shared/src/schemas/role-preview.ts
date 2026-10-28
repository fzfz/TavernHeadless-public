import { z } from "zod";
import { roleModelCapabilitiesGrantSchema } from "./role-model-capabilities.js";
export const rolePreviewMetadataSchema = z
  .object({
    draft_id: z.string().min(1),
    draft_revision: z.number().int().positive(),
    creator_id: z.string().min(1),
  })
  .strict();
export const rolePreviewSessionMetadataSchema = z
  .object({
    role_preview: rolePreviewMetadataSchema,
    model_capabilities: roleModelCapabilitiesGrantSchema.nullable().optional(),
  })
  .passthrough();

export type RolePreviewMetadata = z.infer<typeof rolePreviewMetadataSchema>;
