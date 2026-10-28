import { buildZodObjectSchema } from "./json-schema-zod.js";

export interface PublicRoleOpening {
  id: string;
  title: string;
  summary: string;
  kind: "story" | "introduction";
  display_text: string;
  is_default: boolean;
  default_for: ("individual" | "group")[];
}

export interface PublicRole {
  id: string;
  character_id: string;
  name: string;
  description: string;
  creator: string;
  tags: string[];
  openings: PublicRoleOpening[];
  created_at: number;
}

export interface PublicRoleListMeta {
  total: number;
  limit: number;
  offset: number;
  tags: string[];
}

export const publicRoleJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "character_id",
    "name",
    "description",
    "creator",
    "tags",
    "openings",
    "created_at",
  ],
  properties: {
    id: { type: "string" },
    character_id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    creator: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    openings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "summary",
          "kind",
          "display_text",
          "is_default",
          "default_for",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          kind: { type: "string", enum: ["story", "introduction"] },
          display_text: { type: "string" },
          is_default: { type: "boolean" },
          default_for: {
            type: "array",
            items: { type: "string", enum: ["individual", "group"] },
          },
        },
      },
    },
    created_at: { type: "number" },
  },
} as const;

export const publicRoleListQueryJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    keyword: { type: "string", maxLength: 200 },
    tag: { type: "string", maxLength: 100 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 24 },
    offset: { type: "integer", minimum: 0, default: 0 },
  },
} as const;

export const publicRoleListMetaJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["total", "limit", "offset", "tags"],
  properties: {
    total: { type: "integer" },
    limit: { type: "integer" },
    offset: { type: "integer" },
    tags: { type: "array", items: { type: "string" } },
  },
} as const;

export const publicRoleListResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: publicRoleJsonSchema },
    meta: publicRoleListMetaJsonSchema,
  },
} as const;
export const publicRoleResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data"],
  properties: { data: publicRoleJsonSchema },
} as const;
export const publicRoleSchema =
  buildZodObjectSchema<PublicRole>(publicRoleJsonSchema);
export const publicRoleListResponseSchema = buildZodObjectSchema<{
  data: PublicRole[];
  meta: PublicRoleListMeta;
}>(publicRoleListResponseJsonSchema);
export const publicRoleResponseSchema = buildZodObjectSchema<{
  data: PublicRole;
}>(publicRoleResponseJsonSchema);

export interface CreatePublicRoleSessionInput {
  user_id: string;
  expected_user_revision?: number;
  opening_id?: string;
  operation_id: string;
  session_type?: "individual" | "group";
}
export const createPublicRoleSessionBodyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["user_id", "operation_id"],
  properties: {
    user_id: { type: "string", minLength: 1, maxLength: 200 },
    expected_user_revision: { type: "integer", minimum: 0 },
    opening_id: { type: "string", minLength: 1, maxLength: 200 },
    operation_id: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      pattern: "^[A-Za-z0-9_-]+$",
    },
    session_type: { type: "string", enum: ["individual", "group"] },
  },
} as const;
export const createPublicRoleSessionBodySchema =
  buildZodObjectSchema<CreatePublicRoleSessionInput>(
    createPublicRoleSessionBodyJsonSchema,
  );
export const publicRoleSessionResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data"],
  properties: {
    data: {
      type: "object",
      additionalProperties: false,
      required: ["status", "session", "release", "opening_id"],
      properties: {
        status: { type: "string", const: "complete" },
        session: { type: "object", additionalProperties: true },
        release: publicRoleJsonSchema,
        opening_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
  },
} as const;
export const publicRoleSessionPendingResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data"],
  properties: {
    data: {
      type: "object",
      additionalProperties: false,
      required: ["status", "session_id"],
      properties: {
        status: { type: "string", const: "initializing" },
        session_id: { type: "string" },
      },
    },
  },
} as const;
export interface PublicRoleSessionResult {
  status: "complete";
  session: Record<string, unknown>;
  release: PublicRole;
  opening_id: string | null;
}
export interface PublicRoleSessionPending {
  status: "initializing";
  session_id: string;
}
export const publicRoleSessionResponseSchema = buildZodObjectSchema<{
  data: PublicRoleSessionResult;
}>(publicRoleSessionResponseJsonSchema);
export const publicRoleSessionPendingResponseSchema = buildZodObjectSchema<{
  data: PublicRoleSessionPending;
}>(publicRoleSessionPendingResponseJsonSchema);
