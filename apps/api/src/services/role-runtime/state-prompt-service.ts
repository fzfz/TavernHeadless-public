import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, exists, gt, inArray, lt, sql } from "drizzle-orm";
import { SimpleTokenCounter } from "@tavern/core";
import type { TokenCounter } from "@tavern/core";
import {
  modelCallRecordSchema,
  statePromptBindingSchema,
  statePromptSourceNames,
  roleStatePolicy,
  roleRuntimeHistoryPagination,
  type RoleState,
  type RoleStateSourceMessage,
  type RoleToolEvidence,
  type RoleStateProfile,
  type StateVariableHistoryRound,
  type StatePromptPreview,
} from "@tavern/shared";
import type { AppDb } from "../../db/client.js";
import {
  messages,
  messagePages,
  floors,
  floorRunStates,
  roleDisplaySnapshots,
  promptSnapshots,
  floorResultSnapshots,
  presets,
  presetVersions,
  modelCallRecords,
} from "../../db/schema.js";
import { ChatHistoryLoader } from "../chat-history-loader.js";
import { FloorLineageService } from "../floor-lineage-service.js";
import {
  assemblePrompt,
  buildPromptAssemblyCompat,
  buildPromptRuntimeTrace,
  buildPromptRuntimeBudgetTrace,
  buildPromptSnapshotPreview,
  materializePromptRuntimeMessages,
  resolvePromptMode,
  type SessionPromptInfo,
} from "../prompt-assembler.js";
import { resolvePromptRuntimeExecutionContext } from "../prompt-runtime-execution.js";
import { PromptRuntimeInjectionService } from "../prompt-runtime/injection-service.js";
import { PromptRuntimeInjectionContributorBuilder } from "../chat/prompt-runtime-injection-contributor-builder.js";
import { PromptRuntimeContributorRunner } from "../chat/prompt-runtime-contributor-runner.js";
import { buildPromptRuntimeContributorRenderablesForAssembly } from "../chat/prompt-runtime-contributors.js";
import { normalizeConversationHistory } from "../chat/conversation-history-normalizer.js";
import type { FirstPartyStateContextService } from "../chat/first-party-state-context-service.js";
import { mergeSessionMetadataWithFirstPartyState } from "../chat/shared/metadata.js";
import { readSavedPromptSourceContextByOutputPageId } from "../chat/source-context.js";
import { RoleModuleLoader } from "./role-module-loader.js";
import type { RoleAssetService } from "./role-asset-service.js";
import type { DisplaySnapshotService } from "./display-snapshot-service.js";
import {
  type LlmProfileResolved,
  LlmProfileService,
} from "../llm-profile-service.js";
import { stripNullGenerationParams } from "../../lib/llm-params.js";
import { RoleRuntimeError } from "./runtime-error.js";

import { getSessionResourceAccountId } from "../public-role-session-binding.js";

export interface StatePromptServiceOptions {
  historyMaxFloors?: number;
  tokenCounter?: TokenCounter;
  firstPartyStateContextService?: FirstPartyStateContextService;
}

export class StatePromptService {
  private readonly tokenCounter: TokenCounter;
  constructor(
    private readonly db: AppDb,
    private readonly snapshots: DisplaySnapshotService,
    private readonly assets: RoleAssetService,
    private readonly options: StatePromptServiceOptions = {},
  ) {
    this.tokenCounter = options.tokenCounter ?? new SimpleTokenCounter();
  }

  private async variableHistory(
    accountId: string,
    sessionId: string,
    branchId: string,
    floorNo: number,
    turns: number,
  ): Promise<StateVariableHistoryRound[]> {
    if (turns === 0) return [];
    const lineage = new FloorLineageService(this.db);
    const ancestry = lineage.branchAncestryFloorIdsQuery(sessionId, branchId);
    const withSnapshots = this.db
      .select({ one: sql`1` })
      .from(roleDisplaySnapshots)
      .where(
        and(
          eq(roleDisplaySnapshots.accountId, accountId),
          eq(roleDisplaySnapshots.sessionId, sessionId),
          eq(roleDisplaySnapshots.floorId, floors.id),
        ),
      );
    const nodes = this.db
      .select({ id: floors.id, floorNo: floors.floorNo })
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, sessionId),
          sql`${floors.id} IN ${ancestry}`,
          gt(floors.floorNo, 0),
          lt(floors.floorNo, floorNo),
          exists(withSnapshots),
        ),
      )
      .orderBy(desc(floors.floorNo))
      .limit(turns)
      .all();
    const rounds: StateVariableHistoryRound[] = [];
    for (const node of nodes) {
      const id = node.id;
      const rows: Array<typeof roleDisplaySnapshots.$inferSelect> = [];
      let offset = 0;
      while (true) {
        const page = this.db
          .select()
          .from(roleDisplaySnapshots)
          .where(
            and(
              eq(roleDisplaySnapshots.accountId, accountId),
              eq(roleDisplaySnapshots.sessionId, sessionId),
              eq(roleDisplaySnapshots.floorId, id),
            ),
          )
          .orderBy(asc(roleDisplaySnapshots.snapshotNo))
          .limit(roleRuntimeHistoryPagination.maxLimit)
          .offset(offset)
          .all();
        rows.push(...page);
        if (page.length < roleRuntimeHistoryPagination.maxLimit) break;
        offset += page.length;
      }
      if (!rows.length) continue;
      const first = this.snapshots.get(accountId, sessionId, {
        snapshotId: rows[0]!.id,
      });
      const last = this.snapshots.get(accountId, sessionId, {
        snapshotId: rows.at(-1)!.id,
      });
      const before: RoleState = rows[0]!.calculationBeforeJson
        ? JSON.parse(rows[0]!.calculationBeforeJson)
        : first.parentSnapshotId
          ? this.snapshots.get(accountId, sessionId, {
              snapshotId: first.parentSnapshotId,
            }).variables
          : {};
      const changes: StateVariableHistoryRound["changes"] = [];
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(last.variables),
      ])) {
        const path = `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if (!Object.hasOwn(last.variables, key))
          changes.push({ op: "remove", path });
        else if (
          !Object.hasOwn(before, key) ||
          !isDeepStrictEqual(before[key], last.variables[key])
        )
          changes.push({ op: "set", path, value: last.variables[key] });
      }
      rounds.push({
        floorId: id,
        floorNo: node.floorNo,
        before,
        after: last.variables,
        changes,
        snapshotIds: rows.map((row) => row.id),
      });
      if (rounds.length === turns) break;
    }
    return rounds.reverse();
  }

  async prepare(input: {
    accountId: string;
    model?: LlmProfileResolved;
    session: ReturnType<DisplaySnapshotService["session"]>;
    profile: RoleStateProfile & { stateSchema: Record<string, unknown> };
    files: Record<string, string>;
    before: RoleState;
    previousSnapshotId: string;
    floorId: string;
    sources: RoleStateSourceMessage[];
    toolEvidence: RoleToolEvidence[];
    outputSchema: Record<string, unknown>;
  }): Promise<StatePromptPreview> {
    const { accountId, session, profile, before, sources, floorId } = input;
    const resourceAccountId = getSessionResourceAccountId(
      this.db,
      accountId,
      session.id,
    );
    const metadata = JSON.parse(session.metadataJson ?? "{}");
    const configured = metadata.statePrompt;
    const binding =
      configured ??
      (profile.presetRef
        ? {
            ...profile.presetRef,
            historyTurns: roleStatePolicy.defaultHistoryTurns,
          }
        : undefined);
    if (!binding) throw new RoleRuntimeError("ROLE_STATE_PRESET_MISSING", 409);
    const parsedBinding = statePromptBindingSchema.parse(binding);
    const preset = this.db
      .select({ id: presets.id })
      .from(presets)
      .innerJoin(presetVersions, eq(presetVersions.presetId, presets.id))
      .where(
        and(
          eq(presets.accountId, resourceAccountId),
          eq(presets.id, parsedBinding.presetId),
          eq(presetVersions.id, parsedBinding.presetVersionId),
        ),
      )
      .get();
    if (!preset)
      throw new RoleRuntimeError("ROLE_STATE_PRESET_VERSION_NOT_FOUND", 404);
    const floor = this.db
      .select()
      .from(floors)
      .where(eq(floors.id, floorId))
      .get()!;
    const run = this.db
      .select()
      .from(floorRunStates)
      .where(eq(floorRunStates.floorId, floorId))
      .get()!;
    const context = resolvePromptRuntimeExecutionContext({
      sessionId: session.id,
      metadataJson: session.metadataJson,
      branchId: floor.branchId,
      branchExists: true,
      historySourceBranchId: floor.branchId,
      historySourceMode: "existing_branch",
    });
    const policy = context.resolvedPolicy;
    const entries = await new ChatHistoryLoader(
      this.db,
      this.options.historyMaxFloors,
    ).loadHistoryEntries(
      session.id,
      floor.branchId,
      floor.floorNo,
      policy.visibility,
    );
    const normalized = normalizeConversationHistory(entries);
    const maxMessages = policy.sourceSelection.history.maxMessages;
    const historyTurns =
      policy.sourceSelection.history.mode === "full" ||
      maxMessages === undefined
        ? normalized.effectiveTurns
        : normalized.effectiveTurns.slice(-maxMessages);
    const history = historyTurns.map(({ role, content }) => ({
      role,
      content,
    }));
    const variableHistory = await this.variableHistory(
      accountId,
      session.id,
      floor.branchId,
      floor.floorNo,
      parsedBinding.historyTurns,
    );
    const worldbook = this.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, floorId))
      .get();
    const body = this.db
      .select()
      .from(floorResultSnapshots)
      .where(eq(floorResultSnapshots.floorId, floorId))
      .get();
    const sourcePages = this.db
      .select({
        messageId: messages.id,
        pageId: messagePages.id,
        revision: messagePages.version,
        seq: messages.seq,
        role: messages.role,
      })
      .from(messages)
      .innerJoin(messagePages, eq(messagePages.id, messages.pageId))
      .where(
        inArray(
          messages.id,
          sources.map((source) => source.messageId),
        ),
      )
      .orderBy(asc(messagePages.pageNo), asc(messages.seq))
      .all();
    const selectedAssistant = sourcePages
      .filter((page) => page.role === "assistant")
      .at(-1);
    const sourceWorldbook =
      body?.outputPageId === selectedAssistant?.pageId ? worldbook : null;
    const sourceCall = this.db
      .select({ recordJson: modelCallRecords.recordJson })
      .from(modelCallRecords)
      .where(
        and(
          eq(modelCallRecords.accountId, accountId),
          eq(modelCallRecords.sessionId, session.id),
          eq(modelCallRecords.floorId, floorId),
          eq(modelCallRecords.status, "succeeded"),
          eq(modelCallRecords.turnCommitStatus, "committed"),
        ),
      )
      .orderBy(desc(modelCallRecords.preparedAt), desc(modelCallRecords.callId))
      .all()
      .map((row) => modelCallRecordSchema.parse(JSON.parse(row.recordJson)))
      .find(
        (record) =>
          record.outputPageId === selectedAssistant?.pageId &&
          record.outputMessageId === selectedAssistant?.messageId,
      );
    const sourceIdentity = {
      floorId,
      branchId: floor.branchId,
      runId: sourceCall?.runId ?? null,
      attemptNo: sourceCall?.attemptNo ?? null,
      floorRunId: run.runId,
      floorAttemptNo: run.attemptNo,
      outputPageId: selectedAssistant?.pageId ?? null,
      assistantMessageId: selectedAssistant?.messageId ?? null,
      messages: sourcePages,
    };
    const savedContext = await readSavedPromptSourceContextByOutputPageId(
      this.db,
      selectedAssistant?.pageId,
    );
    const firstParty =
      this.options.firstPartyStateContextService?.loadFirstPartyStateContext({
        accountId,
        sessionId: session.id,
        branchId: floor.branchId,
        sourceFloorId: floorId,
      });
    const model =
      input.model ??
      (
        await new LlmProfileService(this.db).resolveActiveProfiles(
          session.id,
          accountId,
        )
      )[profile.modelSlot ?? roleStatePolicy.defaultModelSlot];
    const sessionInfo: SessionPromptInfo = {
      ...session,
      presetId: parsedBinding.presetId,
      presetVersionId: parsedBinding.presetVersionId,
      metadataJson: mergeSessionMetadataWithFirstPartyState(
        JSON.stringify({ ...metadata, model: model?.modelId }),
        firstParty,
      ),
    };
    const promptMode = resolvePromptMode(sessionInfo, metadata);
    const memorySummary = savedContext?.memorySummary;
    const contributors = new PromptRuntimeContributorRunner().resolve({
      promptMode,
      memorySummary,
      memoryTrace: savedContext?.memoryTrace,
      firstPartyStateContext: firstParty,
      agentContributors: savedContext?.agentContributors,
    }).contributors;
    const injections = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode,
      tokenCounter: this.tokenCounter,
      injections: [
        ...new PromptRuntimeInjectionService(
          this.db,
        ).listPersistentInputsForPrompt(session.id, floor.branchId, accountId),
        ...(savedContext?.requestInjections ?? []),
      ],
    });
    const stateData = {
      [statePromptSourceNames.definition]: JSON.stringify({
        stateSchema: profile.stateSchema,
        writablePaths: profile.writablePaths,
        derivedPaths: profile.derivedPaths ?? [],
        factsSchema: profile.factsSchema,
      }),
      [statePromptSourceNames.rules]: (profile.ruleFiles ?? [])
        .map((file) => input.files[file])
        .join("\n"),
      [statePromptSourceNames.before]: JSON.stringify({
        before,
        floorBefore: before,
        previousSnapshotId: input.previousSnapshotId,
      }),
      [statePromptSourceNames.history]: JSON.stringify(variableHistory),
      [statePromptSourceNames.evidence]: JSON.stringify({
        sources,
        sourceIdentity,
        toolEvidence: input.toolEvidence,
        worldbookSelection: sourceWorldbook
          ? {
              entries: JSON.parse(
                sourceWorldbook.worldbookActivatedEntriesJson,
              ),
              entryUids: JSON.parse(
                sourceWorldbook.worldbookActivatedEntryUidsJson,
              ),
              presetId: sourceWorldbook.presetId,
              presetVersionId: sourceWorldbook.presetVersionId,
            }
          : null,
        priorFacts: [],
        consumedSources: [],
        agentResults: savedContext?.agentResults ?? [],
      }),
      [statePromptSourceNames.outputContract]: JSON.stringify({
        outputSchema: input.outputSchema,
      }),
    };
    const generationParams = {
      maxOutputTokens: profile.maxTokens,
      ...stripNullGenerationParams(model?.params ?? {}),
    };
    const assembled = await assemblePrompt(
      this.db,
      accountId,
      sessionInfo,
      history,
      "",
      this.tokenCounter,
      memorySummary,
      {
        conversation: {
          currentMessages: sources.map((source) => ({
            role: source.role as "user" | "assistant",
            content: source.text,
            sourceId: source.messageId,
            floorNo: floor.floorNo,
          })),
          stateData,
        },
        variableContext: {
          sessionId: session.id,
          branchId: floor.branchId,
          floorId,
          statData: before,
        },
        rolePromptModuleLoader: (owner, version, path) =>
          new RoleModuleLoader(this.assets).loadModule(owner, version, path),
        includeDebug: true,
        includeWorldbookMatchTrace: true,
        runKind: "respond",
        intent: "normal",
        budget: context.effectivePolicy?.budget,
        sourceSelection: context.effectivePolicy?.sourceSelection,
        historyFloorNos: historyTurns.map(
          (turn) => turn.floorRange?.end ?? null,
        ),
        contributors: [
          ...buildPromptRuntimeContributorRenderablesForAssembly(
            contributors,
            promptMode,
          ),
          ...injections.renderables,
        ],
        injectionItems: injections.items,
        memoryRuntimeTrace: savedContext?.memoryTrace,
        maxOutputTokensOverride: generationParams.maxOutputTokens,
        maxContextTokensOverride: generationParams.maxContextTokens,
      },
    );
    const materialized = materializePromptRuntimeMessages({
      messages: assembled.messages,
      sendDirectives: assembled.sendDirectives,
      assistantPrefillStrategy: "none",
      structurePolicy: policy.structure,
      deliveryPolicy: policy.delivery,
    });
    const runtimeTrace = buildPromptRuntimeTrace({
      traceSeed: assembled.runtimeTraceSeed,
    });
    runtimeTrace.budgets = buildPromptRuntimeBudgetTrace({
      byGroup: assembled.tokenUsage.byGroup,
      estimatedByGroup: assembled.tokenUsage.allocator?.estimatedByGroup,
      allocatedByGroup: assembled.tokenUsage.allocator?.allocatedByGroup,
      prunedByGroup: assembled.tokenUsage.prunedByGroup,
      trimReasons: assembled.tokenUsage.allocator?.trimReasons,
    });
    runtimeTrace.historyNormalization = {
      rawEntryCount: entries.length,
      effectiveTurnCount: normalized.effectiveTurns.length,
      selectedTurnCount: historyTurns.length,
      trailingUserSourceFloorIds: [],
      mergedUserGroups: [],
      violations: normalized.violations,
    };
    runtimeTrace.delivery = materialized.deliveryTrace;
    if (materialized.structureTrace)
      runtimeTrace.structure = materialized.structureTrace;
    return {
      messages: materialized.messages.map((message) => ({
        role: message.role as "system" | "user" | "assistant",
        content: message.content,
      })),
      preset: {
        presetId: parsedBinding.presetId,
        presetVersionId: parsedBinding.presetVersionId,
      },
      before,
      previousSnapshotId: input.previousSnapshotId,
      sources,
      variableHistory,
      sourceIdentity,
      outputSchema: input.outputSchema,
      prompt_snapshot: {
        ...buildPromptSnapshotPreview(assembled.promptSnapshot),
      },
      assembly: {
        ...buildPromptAssemblyCompat({
          compatSeed: assembled.assemblyCompatSeed,
          traceSeed: assembled.runtimeTraceSeed,
          runtimeTrace,
        }),
      },
      runtime_trace: runtimeTrace as unknown as Record<string, unknown>,
      token_usage: assembled.tokenUsage,
    };
  }
}
