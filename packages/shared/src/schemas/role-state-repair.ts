import { z } from "zod";
import { roleSnapshotSchema } from "./role-view.js";

const repairIdentity = {
  branch_id: z.string().min(1),
  expected_snapshot_id: z.string().min(1),
  operation_id: z.string().min(1),
};

export const roleStateRecalculateRequestSchema = z.object({
  ...repairIdentity,
  floor_id: z.string().min(1),
}).strict();
export type RoleStateRecalculateRequest = z.infer<typeof roleStateRecalculateRequestSchema>;

export const roleStateRestoreMissingRequestSchema = z.object(repairIdentity).strict();
export type RoleStateRestoreMissingRequest = z.infer<typeof roleStateRestoreMissingRequestSchema>;

export const roleStateRepairResultSchema = z.object({
  operationId: z.string().min(1),
  before: roleSnapshotSchema,
  after: roleSnapshotSchema,
}).strict();
export type RoleStateRepairResult = z.infer<typeof roleStateRepairResultSchema>;
export const roleStateRepairResponseSchema = z.object({ data: roleStateRepairResultSchema }).strict();

export const roleStateRepairEventSchema = z.object({
  operationId: z.string().min(1),
  after: roleSnapshotSchema,
}).strict();
export type RoleStateRepairEvent = z.infer<typeof roleStateRepairEventSchema>;
export const roleStateRepairEventsQuerySchema = z.object({ branch_id: z.string().min(1) }).strict();

export const roleStateRepairErrorDetailsSchema = z.object({
  expected_snapshot_id: z.string().optional(),
  current_snapshot_id: z.string().nullable().optional(),
  floor_id: z.string().optional(),
  current_floor_id: z.string().nullable().optional(),
  path: z.string().optional(),
  constraint: z.string().optional(),
}).strict();

export const roleStateOperationParamsSchema = z.object({
  id: z.string().min(1),
  operationId: z.string().min(1),
}).strict();
export const roleStateOperationRecordSchema = z.object({
  operationId: z.string().min(1),
  sessionId: z.string().min(1),
  branchId: z.string().min(1),
  kind: z.enum(["recalculate", "restore_missing"]),
  floorId: z.string().nullable(),
  beforeSnapshotId: z.string().nullable(),
  sourceSnapshotId: z.string().nullable(),
  afterSnapshotId: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).strict().nullable(),
}).strict();
export type RoleStateOperationRecord = z.infer<typeof roleStateOperationRecordSchema>;
export const roleStateOperationResponseSchema = z.object({ data: roleStateOperationRecordSchema }).strict();
