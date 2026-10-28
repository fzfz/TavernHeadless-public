import { z } from "zod";

import { buildZodObjectSchema } from "./json-schema-zod.js";

export const projectAgentJobStatuses = [
  "pending",
  "leased",
  "running",
  "retry_waiting",
  "succeeded",
  "dead_letter",
  "cancelled",
] as const;

export type ProjectAgentJobStatus = (typeof projectAgentJobStatuses)[number];

export const projectAgentJobCancellableStatuses = [
  "pending",
  "retry_waiting",
] as const satisfies readonly ProjectAgentJobStatus[];

export const projectAgentJobListQueryJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: [...projectAgentJobStatuses] },
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    offset: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
  },
  additionalProperties: false,
} as const;

export const projectAgentJobListQuerySchema = z
  .object({
    status: z.enum(projectAgentJobStatuses).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

export const projectAgentJobJsonSchema = {
  type: "object",
  required: [
    "id",
    "status",
    "phase",
    "attempt_count",
    "max_attempts",
    "available_at",
    "started_at",
    "finished_at",
    "last_error",
    "last_error_code",
    "last_error_class",
    "created_at",
    "updated_at",
    "agent_type_id",
    "agent_binding_id",
    "source_event_id",
    "trigger_type",
    "dry_run",
    "delivery_targets",
    "result",
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    status: { type: "string", enum: [...projectAgentJobStatuses] },
    phase: { anyOf: [{ type: "string" }, { type: "null" }] },
    attempt_count: { type: "integer", minimum: 0 },
    max_attempts: { type: "integer", minimum: 1 },
    available_at: { type: "integer", minimum: 0 },
    started_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    finished_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    last_error: { anyOf: [{ type: "string" }, { type: "null" }] },
    last_error_code: { anyOf: [{ type: "string" }, { type: "null" }] },
    last_error_class: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
    agent_type_id: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
    agent_binding_id: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
    source_event_id: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
    trigger_type: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
    dry_run: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    delivery_targets: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    result: {},
  },
  additionalProperties: false,
} as const;

export type ProjectAgentJobWire = {
  id: string;
  status: ProjectAgentJobStatus;
  phase: string | null;
  attempt_count: number;
  max_attempts: number;
  available_at: number;
  started_at: number | null;
  finished_at: number | null;
  last_error: string | null;
  last_error_code: string | null;
  last_error_class: string | null;
  created_at: number;
  updated_at: number;
  agent_type_id: string | null;
  agent_binding_id: string | null;
  source_event_id: string | null;
  trigger_type: string | null;
  dry_run: boolean | null;
  delivery_targets: string[];
  result: unknown;
};

export const projectAgentJobWireSchema =
  buildZodObjectSchema<ProjectAgentJobWire>(projectAgentJobJsonSchema);

export const projectAgentJobListResponseJsonSchema = {
  type: "object",
  required: ["items", "total"],
  properties: {
    items: { type: "array", items: projectAgentJobJsonSchema },
    total: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

export type ProjectAgentJobListResponseWire = {
  items: ProjectAgentJobWire[];
  total: number;
};

const projectAgentJobListResponseWireSchema =
  buildZodObjectSchema<ProjectAgentJobListResponseWire>(
    projectAgentJobListResponseJsonSchema,
  );

export const projectAgentJobSchema = projectAgentJobWireSchema.transform(
  (job) => ({
    id: job.id,
    status: job.status,
    phase: job.phase,
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    availableAt: job.available_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    lastError: job.last_error,
    lastErrorCode: job.last_error_code,
    lastErrorClass: job.last_error_class,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    agentTypeId: job.agent_type_id,
    agentBindingId: job.agent_binding_id,
    sourceEventId: job.source_event_id,
    triggerType: job.trigger_type,
    dryRun: job.dry_run,
    deliveryTargets: job.delivery_targets,
    result: job.result,
  }),
);

export type ProjectAgentJobRecord = z.infer<typeof projectAgentJobSchema>;

export const projectAgentJobListResponseSchema =
  projectAgentJobListResponseWireSchema.transform((result) => ({
    items: result.items.map((job) => projectAgentJobSchema.parse(job)),
    total: result.total,
  }));
