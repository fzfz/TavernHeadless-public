import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolDefinition, ToolParameterSchema } from "@tavern/core";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { createTestDatabase, type DatabaseConnection } from "../../../test/helpers/create-test-db.js";
import { accounts, floors, runtimeJobs, sessions } from "../../db/schema.js";
import { ToolRuntimePolicy } from "../tool-runtime-policy.js";
import { createToolRuntimeJobBridge } from "../tool-runtime-job-bridge.js";

const ACCOUNT_ID = "default-admin";

const DRAFT_07_PARAMETER_SCHEMA: ToolParameterSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Recursive request",
  type: "object",
  properties: {
    allowed: true,
    forbidden: false,
    choice: {
      oneOf: [
        { type: "string", minLength: 2, maxLength: 80 },
        { $ref: "#/definitions/RecursiveNode" },
      ],
    },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { $ref: "#/definitions/RecursiveNode" },
    },
  },
  required: ["choice"],
  additionalProperties: false,
  definitions: {
    RecursiveNode: {
      type: "object",
      properties: {
        value: { type: "string", minLength: 1, maxLength: 120 },
        children: {
          type: "array",
          minItems: 0,
          maxItems: 5,
          items: { $ref: "#/definitions/RecursiveNode" },
        },
      },
      required: ["value"],
      additionalProperties: false,
    },
  },
};

async function seedTurnScope(database: DatabaseConnection) {
  const now = Date.now();
  const sessionId = nanoid();
  const floorId = nanoid();

  await database.db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: ACCOUNT_ID,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run();

  await database.db.insert(sessions).values({
    id: sessionId,
    accountId: ACCOUNT_ID,
    title: "Tool Runtime Policy",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await database.db.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });

  return { now, sessionId, floorId };
}

describe("ToolRuntimePolicy", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createTestDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("preserves complete Draft-07 parameter schemas while annotating MCP tools", () => {
    const parameters = structuredClone(DRAFT_07_PARAMETER_SCHEMA);
    const tool: ToolDefinition = {
      name: "recursive_tool",
      description: "Recursive tool",
      parameters,
      sideEffectLevel: "irreversible",
      allowedSlots: [],
      source: "mcp",
    };
    const policy = new ToolRuntimePolicy({
      enableDeferredIrreversibleTools: true,
      deferredToolAllowlist: ["srv-1/recursive_tool"],
    });

    const annotated = policy.annotateToolDefinition({
      providerId: "mcp:srv-1",
      providerType: "mcp",
      tool,
    });

    expect(annotated.parameters).toEqual(DRAFT_07_PARAMETER_SCHEMA);
    expect(annotated.parameters.properties.forbidden).toBe(false);
    expect(annotated.parameters.properties.allowed).toBe(true);

    annotated.parameters.properties.forbidden = true;
    expect(tool.parameters).toEqual(DRAFT_07_PARAMETER_SCHEMA);
  });

  it("captures the expanded execution policy and wires maxAttempts into deferred runtime jobs", async () => {
    const { now, sessionId, floorId } = await seedTurnScope(database);
    const executionId = nanoid();
    const runId = nanoid();
    const jobId = `tool-job:${executionId}`;
    const policy = new ToolRuntimePolicy({
      enableDeferredIrreversibleTools: true,
      deferredToolAllowlist: ["mcp-1/github_create_issue"],
      timeoutMs: 1_500,
      maxAttempts: 7,
      retryableStatuses: ["timeout", "uncertain"],
      maxDeferredJobsPerRun: 2,
      maxIrreversibleCallsPerRun: 1,
    });

    expect(policy.getExecutionPolicySnapshot()).toEqual({
      enableDeferredIrreversibleTools: true,
      deferredToolAllowlist: ["mcp:mcp-1/github_create_issue"],
      timeoutMs: 1_500,
      maxAttempts: 7,
      retryableStatuses: ["timeout", "uncertain"],
      maxDeferredJobsPerRun: 2,
      maxIrreversibleCallsPerRun: 1,
    });

    const bridge = createToolRuntimeJobBridge(database.db, {
      toolRuntimePolicy: policy,
    });

    database.db.transaction((tx) => {
      bridge.enqueue(tx, {
        executionId,
        runId,
        jobId,
        envelope: {
          executionId,
          runId,
          sessionId,
          accountId: ACCOUNT_ID,
          floorId,
          callerSlot: "narrator",
          providerId: "mcp:mcp-1",
          providerType: "mcp",
          toolName: "github_create_issue",
          args: { title: "Need help" },
          sideEffectLevel: "irreversible",
          deliveryMode: "async_job",
          asyncCapability: "deferred_ok",
          resultVisibility: "deferred_receipt",
          acceptedAt: now,
        },
        receipt: {
          accepted: true,
          delivery_mode: "async_job",
          execution_id: executionId,
          job_id: jobId,
          status: "queued",
          message: "Deferred tool accepted.",
        },
      });
    });

    const [job] = await database.db
      .select()
      .from(runtimeJobs)
      .where(eq(runtimeJobs.id, jobId));
    const payload = JSON.parse(job?.payloadJson ?? "null");

    expect(job?.maxAttempts).toBe(7);
    expect(payload.policy).toEqual({
      enableDeferredIrreversibleTools: true,
      deferredToolAllowlist: ["mcp:mcp-1/github_create_issue"],
      timeoutMs: 1_500,
      maxAttempts: 7,
      retryableStatuses: ["timeout", "uncertain"],
      maxDeferredJobsPerRun: 2,
      maxIrreversibleCallsPerRun: 1,
    });
    expect(payload.provenance).toEqual({ triggerScope: "chat_turn" });
  });
});
