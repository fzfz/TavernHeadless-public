import { z } from "zod";

import type { RuntimeParamsResponse } from "./llm-generation-params.js";
import {
  llmProfileConfigSnapshotJsonSchema,
  llmProfileConfigSnapshotSchema,
} from "./llm-profile-config-snapshot.js";
import { llmGenerationParamsJsonSchema } from "./llm-generation-params.js";
import { buildZodObjectSchema } from "./json-schema-zod.js";
import { llmInstanceSlots } from "../generated/llm-slots.js";
import {
  roleModelCapabilitiesGrantJsonSchema,
  roleModelCapabilitiesGrantSchema,
  type RoleModelCapabilitiesGrant,
} from "./role-model-capabilities.js";
import {
  roleStateRuntimeConfigurationObjectSchema,
  roleStateRuntimeConfigurationJsonSchemaProperties,
  roleStateRuntimeConfigurationJsonSchema,
  validateRoleStateRuntimeConfiguration,
} from "./role-state.js";

export const roleReleaseListQueryJsonSchema = {
  type: "object",
  properties: {
    latest_per_character: { type: "boolean", default: false },
    active_only: { type: "boolean", default: false },
  },
  additionalProperties: false,
} as const;

export const roleReleasePromptModes = [
  "compat_strict",
  "compat_plus",
  "native",
] as const;
export const roleReleaseModelSlots = llmInstanceSlots;
export const roleReleaseOpeningKinds = ["story", "introduction"] as const;

export const roleReleaseModelParamsSchema =
  buildZodObjectSchema<RuntimeParamsResponse>(llmGenerationParamsJsonSchema);

export const roleReleaseModelSlotInputSchema = z
  .object({
    slot: z.enum(roleReleaseModelSlots),
    profile_id: z.string().trim().min(1),
    params: roleReleaseModelParamsSchema.nullable().optional(),
  })
  .strict();

export const roleReleaseModelSlotSchema =
  roleReleaseModelSlotInputSchema.extend({
    profile_snapshot: llmProfileConfigSnapshotSchema.nullable(),
  });

export const createRoleReleaseBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    character_id: z.string().trim().min(1),
    character_version_id: z.string().trim().min(1),
    preset_id: z.string().trim().min(1),
    preset_version_id: z.string().trim().min(1),
    regex_profile_id: z.string().trim().min(1).nullable(),
    regex_profile_version_id: z.string().trim().min(1).nullable(),
    worldbook_id: z.string().trim().min(1).nullable(),
    worldbook_version_id: z.string().trim().min(1).nullable(),
    prompt_mode: z.enum(roleReleasePromptModes),
    model_capabilities: roleModelCapabilitiesGrantSchema.nullable().optional(),
    model_slots: z
      .array(roleReleaseModelSlotInputSchema)
      .min(1)
      .max(roleReleaseModelSlots.length),
    default_user_id: z.string().trim().min(1),
    ...roleStateRuntimeConfigurationObjectSchema.shape,
  })
  .strict()
  .superRefine((value, context) => {
    validateRoleStateRuntimeConfiguration(value, context);
    if (
      (value.worldbook_id === null) !==
      (value.worldbook_version_id === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          value.worldbook_id === null ? "worldbook_version_id" : "worldbook_id",
        ],
        message:
          "worldbook_id and worldbook_version_id must both be null or both be strings",
      });
    }

    if (
      (value.regex_profile_id === null) !==
      (value.regex_profile_version_id === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          value.regex_profile_id === null
            ? "regex_profile_version_id"
            : "regex_profile_id",
        ],
        message:
          "regex_profile_id and regex_profile_version_id must both be null or both be strings",
      });
    }

    const seen = new Set<string>();
    value.model_slots.forEach((binding, index) => {
      if (seen.has(binding.slot)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["model_slots", index, "slot"],
          message: `Duplicate model slot: ${binding.slot}`,
        });
      }
      seen.add(binding.slot);
    });
  });

export const createRoleReleaseSessionBodySchema = z
  .object({
    user_id: z.string().trim().min(1).optional(),
    opening_id: z.string().trim().min(1).optional(),
    session_type: z.enum(["individual", "group"]).optional(),
  })
  .strict();

export const roleReleaseIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const nullableStringJsonSchema = {
  anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
} as const;

const roleReleaseModelSlotInputJsonSchema = {
  type: "object",
  required: ["slot", "profile_id", "params"],
  properties: {
    slot: { type: "string", enum: [...roleReleaseModelSlots] },
    profile_id: { type: "string", minLength: 1 },
    params: { anyOf: [llmGenerationParamsJsonSchema, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

export const roleReleaseModelSlotJsonSchema = {
  ...roleReleaseModelSlotInputJsonSchema,
  required: ["slot", "profile_id", "params", "profile_snapshot"],
  properties: {
    ...roleReleaseModelSlotInputJsonSchema.properties,
    profile_snapshot: {
      anyOf: [llmProfileConfigSnapshotJsonSchema, { type: "null" }],
    },
  },
} as const;

export const roleReleaseOpeningJsonSchema = {
  type: "object",
  required: ["id", "title", "kind", "summary", "display_text", "default"],
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    kind: { type: "string", enum: [...roleReleaseOpeningKinds] },
    summary: { type: "string" },
    display_text: { type: "string" },
    default: { type: "boolean" },
    audience: { type: "string", enum: ["individual", "group", "both"] },
  },
  additionalProperties: false,
} as const;

/**
 * The complete private opening snapshot persisted with a role release.
 * `default_for` is present for native packages so group and individual
 * defaults remain distinct; it stays optional for legacy stored snapshots.
 */
export const roleReleaseOpeningSnapshotSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    kind: z.enum(roleReleaseOpeningKinds),
    summary: z.string(),
    display_text: z.string(),
    default: z.boolean(),
    audience: z.enum(["individual", "group", "both"]).optional(),
    text: z.string(),
    variables: z.record(z.string(), z.unknown()),
    source_index: z.number().int().nonnegative(),
    default_for: z.array(z.enum(["individual", "group"])).optional(),
  })
  .strict();

export type RoleReleaseOpeningSnapshot = z.infer<
  typeof roleReleaseOpeningSnapshotSchema
>;

export const roleReleaseJsonSchema = {
  type: "object",
  required: [
    "id",
    "name",
    "character_id",
    "character_version_id",
    "character_snapshot",
    "preset_id",
    "preset_version_id",
    "regex_profile_id",
    "regex_profile_version_id",
    "worldbook_id",
    "worldbook_version_id",
    "prompt_mode",
    "model_capabilities",
    "model_slots",
    "state_preset_id",
    "state_preset_version_id",
    "state_history_turns",
    "default_user_id",
    "default_user_snapshot",
    "openings",
    "created_at",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    character_id: { type: "string" },
    character_version_id: { type: "string" },
    character_snapshot: { type: "object", additionalProperties: true },
    preset_id: { type: "string" },
    preset_version_id: { type: "string" },
    regex_profile_id: nullableStringJsonSchema,
    regex_profile_version_id: nullableStringJsonSchema,
    worldbook_id: nullableStringJsonSchema,
    worldbook_version_id: nullableStringJsonSchema,
    prompt_mode: { type: "string", enum: [...roleReleasePromptModes] },
    model_capabilities: {
      anyOf: [roleModelCapabilitiesGrantJsonSchema, { type: "null" }],
    },
    model_slots: {
      type: "array",
      minItems: 1,
      items: roleReleaseModelSlotJsonSchema,
    },
    state_preset_id: nullableStringJsonSchema,
    state_preset_version_id: nullableStringJsonSchema,
    state_history_turns: { type: "integer", minimum: 0 },
    default_user_id: { type: "string" },
    default_user_snapshot: { type: "object", additionalProperties: true },
    openings: { type: "array", items: roleReleaseOpeningJsonSchema },
    created_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

export const createRoleReleaseBodyJsonSchema = {
  type: "object",
  required: [
    "name",
    "character_id",
    "character_version_id",
    "preset_id",
    "preset_version_id",
    "regex_profile_id",
    "regex_profile_version_id",
    "worldbook_id",
    "worldbook_version_id",
    "prompt_mode",
    "model_slots",
    "default_user_id",
  ],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    character_id: { type: "string", minLength: 1 },
    character_version_id: { type: "string", minLength: 1 },
    preset_id: { type: "string", minLength: 1 },
    preset_version_id: { type: "string", minLength: 1 },
    regex_profile_id: nullableStringJsonSchema,
    regex_profile_version_id: nullableStringJsonSchema,
    worldbook_id: nullableStringJsonSchema,
    worldbook_version_id: nullableStringJsonSchema,
    prompt_mode: { type: "string", enum: [...roleReleasePromptModes] },
    model_capabilities: {
      anyOf: [roleModelCapabilitiesGrantJsonSchema, { type: "null" }],
    },
    model_slots: {
      type: "array",
      minItems: 1,
      maxItems: roleReleaseModelSlots.length,
      items: {
        ...roleReleaseModelSlotInputJsonSchema,
        required: ["slot", "profile_id"],
      },
    },
    ...roleStateRuntimeConfigurationJsonSchemaProperties,
    default_user_id: { type: "string", minLength: 1 },
  },
  allOf: roleStateRuntimeConfigurationJsonSchema.allOf,
  additionalProperties: false,
} as const;

export const createRoleReleaseSessionBodyJsonSchema = {
  type: "object",
  properties: {
    user_id: { type: "string", minLength: 1 },
    opening_id: { type: "string", minLength: 1 },
    session_type: { type: "string", enum: ["individual", "group"] },
  },
  additionalProperties: false,
} as const;

export const roleReleaseResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: roleReleaseJsonSchema },
  additionalProperties: false,
} as const;

export const roleReleaseListResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: { type: "array", items: roleReleaseJsonSchema } },
  additionalProperties: false,
} as const;

export const roleReleaseSessionResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["release", "session", "opening_id"],
      properties: {
        release: roleReleaseJsonSchema,
        session: { type: "object", additionalProperties: true },
        opening_id: nullableStringJsonSchema,
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export type CreateRoleReleaseBody = z.infer<typeof createRoleReleaseBodySchema>;
export type CreateRoleReleaseSessionBody = z.infer<
  typeof createRoleReleaseSessionBodySchema
>;
export type RoleReleaseModelSlot = z.infer<
  typeof roleReleaseModelSlotSchema
> & { params: z.infer<typeof roleReleaseModelParamsSchema> | null };

export const roleReleaseResponseSchema = buildZodObjectSchema<{
  data: RoleReleasePublic;
}>(roleReleaseResponseJsonSchema);
export const roleReleaseListResponseSchema = buildZodObjectSchema<{
  data: RoleReleasePublic[];
}>(roleReleaseListResponseJsonSchema);
export const roleReleaseSessionResponseSchema = buildZodObjectSchema<{
  data: {
    release: RoleReleasePublic;
    session: Record<string, unknown>;
    opening_id: string | null;
  };
}>(roleReleaseSessionResponseJsonSchema);
export type RoleReleasePublic = {
  id: string;
  name: string;
  character_id: string;
  character_version_id: string;
  character_snapshot: Record<string, unknown>;
  preset_id: string;
  preset_version_id: string;
  regex_profile_id: string | null;
  regex_profile_version_id: string | null;
  worldbook_id: string | null;
  worldbook_version_id: string | null;
  prompt_mode: (typeof roleReleasePromptModes)[number];
  state_preset_id: string | null;
  state_preset_version_id: string | null;
  state_history_turns: number;
  model_capabilities: RoleModelCapabilitiesGrant | null;
  model_slots: RoleReleaseModelSlot[];
  default_user_id: string;
  default_user_snapshot: Record<string, unknown>;
  openings: Array<{
    id: string;
    title: string;
    kind: "story" | "introduction";
    summary: string;
    display_text: string;
    default: boolean;
    audience?: "individual" | "group" | "both";
  }>;
  created_at: number;
};

export const rolePublicationBodyJsonSchema = {
  type: "object",
  required: ["active"],
  properties: { active: { type: "boolean" } },
  additionalProperties: false,
} as const;
export const rolePublicationBodySchema = buildZodObjectSchema<{
  active: boolean;
}>(rolePublicationBodyJsonSchema);
