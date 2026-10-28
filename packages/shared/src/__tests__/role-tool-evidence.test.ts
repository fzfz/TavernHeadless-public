import { describe, expect, it } from "vitest";
import {
  evidenceExecutionIdsSchema,
  roleToolEvidenceSchema,
  roleToolEvidenceJsonSchema,
  toolEvidenceSchema,
} from "../schemas/role-tool-evidence.js";

const evidence = {
  executionId: "execution-1",
  callId: "call-1",
  runId: "run-1",
  generationAttemptNo: 2,
  generationStepNo: 1,
  pageId: "page-1",
  toolName: "random",
  arguments: { count: 1 },
  result: {
    ok: false,
    error: { code: "INVALID_ARGUMENT", message: "Invalid input." },
  },
  status: "error" as const,
};

describe("role tool execution evidence schema", () => {
  it("validates the Draft-07 evidence record and accepted execution ID list", () => {
    expect(roleToolEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(toolEvidenceSchema.parse([evidence])).toEqual([evidence]);
    expect(
      evidenceExecutionIdsSchema.parse(["execution-1", "execution-2"]),
    ).toEqual(["execution-1", "execution-2"]);
    expect(roleToolEvidenceJsonSchema.$id).toBe(
      "https://tavern-headless.local/role-tool-evidence.schema.json",
    );
  });

  it("rejects duplicate accepted IDs, incomplete evidence, and nonterminal statuses", () => {
    expect(
      evidenceExecutionIdsSchema.safeParse(["execution-1", "execution-1"])
        .success,
    ).toBe(false);
    expect(
      roleToolEvidenceSchema.safeParse({ ...evidence, generationAttemptNo: 0 })
        .success,
    ).toBe(false);
    expect(
      roleToolEvidenceSchema.safeParse({ ...evidence, status: "running" })
        .success,
    ).toBe(false);
    const { callId: _callId, ...incomplete } = evidence;
    expect(roleToolEvidenceSchema.safeParse(incomplete).success).toBe(false);
  });
});
