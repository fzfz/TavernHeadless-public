import { eq } from "drizzle-orm";
import { apiErrorMessages } from "@tavern/shared";

import type { AppDb } from "../../db/client.js";
import { floorResultSnapshots } from "../../db/schema.js";
import type { PromptRuntimeTrace } from "../prompt-assembler.js";
import type { AgentRunRecord } from "../agent-runtime/inline-agent-types.js";
import type { PromptRuntimeInjectionBuilderInput } from "../prompt-runtime-injection-types.js";
import type { PromptRuntimeContributorOutput } from "./types.js";

/** Sources from the successful narrator request that a state request can reuse. */
export interface SourcePromptContext {
  agentResults: AgentRunRecord[];
  agentContributors: PromptRuntimeContributorOutput[];
  requestInjections?: PromptRuntimeInjectionBuilderInput[];
  memorySummary?: string;
  memoryTrace?: PromptRuntimeTrace["memory"];
}

export function serializeSourcePromptContext(
  context: SourcePromptContext | null | undefined,
): string | null {
  return context ? JSON.stringify(context) : null;
}

export function parseSourcePromptContextJson(
  value: string | null | undefined,
): SourcePromptContext | null {
  if (value == null) {
    return null;
  }

  const parsed: unknown = JSON.parse(value);
  if (!isSourcePromptContext(parsed)) {
    throw new Error(apiErrorMessages.ROLE_STATE_SOURCE_CONTEXT_INVALID);
  }
  return parsed;
}

/**
 * Reads only the source context attached to the currently selected output page.
 * A replaced page cannot expose an older attempt's context.
 */
export async function readSavedPromptSourceContextByOutputPageId(
  db: AppDb,
  outputPageId: string | null | undefined,
): Promise<SourcePromptContext | null> {
  if (!outputPageId) {
    return null;
  }

  const [snapshot] = await db
    .select({ promptContextJson: floorResultSnapshots.promptContextJson })
    .from(floorResultSnapshots)
    .where(eq(floorResultSnapshots.outputPageId, outputPageId))
    .limit(1);

  return parseSourcePromptContextJson(snapshot?.promptContextJson);
}

function isSourcePromptContext(value: unknown): value is SourcePromptContext {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.agentResults) &&
    Array.isArray(value.agentContributors) &&
    (value.requestInjections === undefined ||
      (Array.isArray(value.requestInjections) &&
        value.requestInjections.every(isPromptRuntimeInjectionBuilderInput))) &&
    (value.memorySummary === undefined ||
      typeof value.memorySummary === "string") &&
    (value.memoryTrace === undefined || isRecord(value.memoryTrace))
  );
}

function isPromptRuntimeInjectionBuilderInput(
  value: unknown,
): value is PromptRuntimeInjectionBuilderInput {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.sourceKind === "string" &&
    typeof value.title === "string" &&
    typeof value.content === "string" &&
    typeof value.placement === "string" &&
    (value.placementParams === undefined ||
      isPlacementParams(value.placementParams)) &&
    (value.order === undefined || typeof value.order === "number") &&
    (value.scope === undefined || isPromptRuntimeInjectionScope(value.scope)) &&
    (value.injectionId === undefined ||
      typeof value.injectionId === "string") &&
    (value.enabled === undefined || typeof value.enabled === "boolean") &&
    (value.modeScope === undefined ||
      value.modeScope === null ||
      isPromptRuntimeMode(value.modeScope)) &&
    (value.ttlMs === undefined ||
      value.ttlMs === null ||
      typeof value.ttlMs === "number") &&
    (value.createdAt === undefined || typeof value.createdAt === "number") &&
    (value.sourceChain === undefined ||
      isPromptRuntimeSourceChain(value.sourceChain))
  );
}

function isPlacementParams(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.floorNo === undefined || typeof value.floorNo === "number") &&
    (value.offset === undefined || typeof value.offset === "number") &&
    (value.depth === undefined || typeof value.depth === "number")
  );
}

function isPromptRuntimeInjectionScope(
  value: unknown,
): value is "request" | "session" | "branch" {
  return value === "request" || value === "session" || value === "branch";
}

function isPromptRuntimeMode(
  value: unknown,
): value is "compat_strict" | "compat_plus" | "native" {
  return (
    value === "compat_strict" || value === "compat_plus" || value === "native"
  );
}

function isPromptRuntimeSourceChain(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.agentTypeId === undefined ||
      typeof value.agentTypeId === "string") &&
    (value.agentRunId === undefined || typeof value.agentRunId === "string") &&
    (value.temporaryConversationId === undefined ||
      typeof value.temporaryConversationId === "string") &&
    (value.debugSessionTag === undefined ||
      typeof value.debugSessionTag === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
