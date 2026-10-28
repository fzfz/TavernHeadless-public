import { z } from "zod";
import { rolePreviewMetadataSchema } from "./role-preview.js";
import { roleModelCapabilitiesGrantSchema } from "./role-model-capabilities.js";

const roleModelCapabilityReleaseMetadataSchema = z
  .object({
    role_release_id: z.string().trim().min(1),
    model_capabilities: roleModelCapabilitiesGrantSchema.nullable(),
  })
  .strict();

const roleModelCapabilityPreviewMetadataSchema = z
  .object({
    role_preview: rolePreviewMetadataSchema,
    model_capabilities: roleModelCapabilitiesGrantSchema.nullable(),
  })
  .strict();

const nativeCardMetadataSchema = z
  .object({
    card_id: z.string().trim().min(1),
    revision: z.number().int().positive(),
  })
  .passthrough();

const roleModelCapabilityNativeCardMetadataSchema = z
  .object({
    native_card: nativeCardMetadataSchema,
    model_capabilities: roleModelCapabilitiesGrantSchema.nullable(),
  })
  .strict();

export const roleModelCapabilitySessionMetadataSchema = z.union([
  roleModelCapabilityReleaseMetadataSchema,
  roleModelCapabilityPreviewMetadataSchema,
  roleModelCapabilityNativeCardMetadataSchema,
]);

export const roleModelCapabilitySessionSnapshotSchema = z
  .object({
    metadata: roleModelCapabilitySessionMetadataSchema,
    character_id: z.string().trim().min(1),
    character_version_id: z.string().trim().min(1),
  })
  .strict();

export type RoleModelCapabilitySessionMetadata = z.infer<
  typeof roleModelCapabilitySessionMetadataSchema
>;
export type RoleModelCapabilitySessionSnapshot = z.infer<
  typeof roleModelCapabilitySessionSnapshotSchema
>;

const protectedRootFields = roleModelCapabilitySessionMetadataSchema.options
  .flatMap((variant) => Object.keys(variant.shape))
  .filter((field, index, fields) => fields.indexOf(field) === index);

/** Root metadata fields owned by the immutable role capability session snapshot. */
export const roleModelCapabilityProtectedMetadataRootFields: readonly string[] =
  Object.freeze(protectedRootFields);
