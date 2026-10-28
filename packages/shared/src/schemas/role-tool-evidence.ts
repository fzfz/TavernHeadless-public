import { z } from "zod";
import {
  roleToolEvidenceExecutionIds,
  roleToolToolEvidence,
  roleToolToolExecutionEvidence,
} from "../generated/role-runtime-validators.js";
import roleToolEvidenceSchemaJson from "./role-tool-evidence.schema.json" with { type: "json" };

export interface RoleToolEvidence {
  executionId: string;
  callId: string;
  runId: string;
  generationAttemptNo: number;
  generationStepNo: number;
  pageId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: "success" | "error" | "denied";
}

export type ToolEvidence = RoleToolEvidence[];
export type EvidenceExecutionIds = string[];

export const roleToolEvidenceJsonSchema = roleToolEvidenceSchemaJson;

type AjvIssue = {
  instancePath?: string;
  keyword?: string;
  message?: string;
};
type GeneratedValidator = ((value: unknown) => boolean) & {
  errors?: AjvIssue[] | null;
};

function pointerPathToSegments(path: string): (string | number)[] {
  if (!path) return [];
  return path
    .slice(1)
    .split("/")
    .map((part) => {
      const decoded = part.replaceAll("~1", "/").replaceAll("~0", "~");
      return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
    });
}

function generatedSchema<T>(
  validator: GeneratedValidator,
  label: string,
): z.ZodType<T, unknown> {
  return z
    .unknown()
    .superRefine((value, context) => {
      if (validator(value)) return;
      const errors = validator.errors ?? [];
      for (const issue of errors) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: pointerPathToSegments(issue.instancePath ?? ""),
          message: `${issue.keyword ?? "schema"}: ${issue.message ?? `Invalid ${label}.`}`,
        });
      }
      if (errors.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid ${label}.`,
        });
      }
    })
    .transform((value) => value as T);
}

export const evidenceExecutionIdsSchema = generatedSchema<EvidenceExecutionIds>(
  roleToolEvidenceExecutionIds,
  "evidence execution IDs",
);
export const roleToolEvidenceSchema = generatedSchema<RoleToolEvidence>(
  roleToolToolExecutionEvidence,
  "role tool execution evidence",
);
export const toolEvidenceSchema = generatedSchema<ToolEvidence>(
  roleToolToolEvidence,
  "role tool evidence",
);
