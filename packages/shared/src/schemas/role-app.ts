import { z } from "zod";
import { roleStateProfileSchema } from "./role-state.js";
import {
  createRoleReleaseBodySchema,
  createRoleReleaseSessionBodySchema,
} from "./role-release.js";
export const createRoleAppSchema = z
  .object({ configuration: createRoleReleaseBodySchema })
  .strict();
export const updateRoleAppSchema = createRoleAppSchema.extend({
  expected_revision: z.number().int().positive(),
});
export const roleAppRevisionSchema = z
  .object({ expected_revision: z.number().int().positive() })
  .strict();
export const createRolePreviewSessionSchema =
  createRoleReleaseSessionBodySchema.extend({
    expected_revision: z.number().int().positive(),
  });
export const roleAppSchema = z
  .object({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    configuration: createRoleReleaseBodySchema,
    updated_at: z.number().int(),
  })
  .strict();
export const rolePreviewSessionSummarySchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    draft_revision: z.number().int().positive(),
    created_at: z.number().int(),
    status: z.string(),
  })
  .strict();
export type RoleApp = z.infer<typeof roleAppSchema>;

export const rolePreviewSessionCreatedSchema = z
  .object({
    session: z.record(z.string(), z.unknown()),
    draft_id: z.string().min(1),
    draft_revision: z.number().int().positive(),
    opening_id: z.string().nullable(),
  })
  .strict();

export const roleAppValidationSchema = z
  .object({
    valid: z.literal(true),
    versionId: z.string(),
    files: z.array(
      z
        .object({
          name: z.string(),
          purpose: z.string(),
          byteSize: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    stateUpdate: roleStateProfileSchema.nullable(),
  })
  .strict();
