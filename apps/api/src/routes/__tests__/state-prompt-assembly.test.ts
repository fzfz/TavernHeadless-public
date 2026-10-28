import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp, type BuildAppResult } from "../../../test/helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID as accountId } from "../../accounts/constants.js";
import { loadStorageConfig } from "../../storage-config.js";
import {
  characters,
  characterVersions,
  sessions,
  floors,
  floorRunStates,
  messagePages,
  messages,
  promptSnapshots,
  roleDisplaySnapshots,
  presetVersions,
} from "../../db/schema.js";
import type { AgentRunRecord } from "../../services/agent-runtime/inline-agent-types.js";
import type { PromptRuntimeContributorOutput } from "../../services/chat/types.js";
import { DisplaySnapshotService } from "../../services/role-runtime/display-snapshot-service.js";
import { LlmProfileService } from "../../services/llm-profile-service.js";
import type { PromptRuntimeTrace } from "../../services/prompt-assembler.js";
import type { PromptRuntimeInjectionBuilderInput } from "../../services/prompt-runtime-injection-types.js";
import type { StatePromptPreview } from "@tavern/shared";

const openApps: BuildAppResult[] = [];
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(openApps.splice(0).map((built) => built.app.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(
  file: string,
  mode: "compat_strict" | "compat_plus" | "native",
  historyTurns: number,
  pastRounds: number,
  enabled = true,
  includeModelMacro = false,
) {
  const root = await mkdtemp(join(tmpdir(), "state-prompt-http-"));
  roots.push(root);
  const built = await buildTestApp({
    storage: loadStorageConfig({ DATA_DIR: root }),
    databasePath: ":memory:",
    logger: false,
    auth: { mode: "off" },
    enableMemory: false,
    enableWebSocket: false,
    enableAgentRuntimeWorker: false,
    enableNodeGraphWorker: false,
    enablePromptDryRun: enabled,
  });
  openApps.push(built);
  const path = new URL(
    `../../../../../.planning/native-card-maintenance/verbatim-state-assembly/presets/${file}`,
    import.meta.url,
  );
  const preset = JSON.parse(await readFile(path, "utf8"));
  if (includeModelMacro)
    preset.prompts.find(
      (entry: { identifier: string }) => entry.identifier === "main",
    ).content += "\nState model: {{model}}";
  const identifiers = preset.prompts.map(
    (item: { identifier: string }) => item.identifier,
  );
  expect(new Set(identifiers).size).toBe(identifiers.length);
  for (const track of preset.prompt_order)
    for (const item of track.order)
      expect(identifiers).toContain(item.identifier);
  const imported = await built.app.inject({
    method: "POST",
    url: "/import/preset",
    payload: { name: file, data: preset },
  });
  expect(imported.statusCode, imported.body).toBe(201);
  const presetId = imported.json().data.id as string;
  const version = built.database
    .select()
    .from(presetVersions)
    .where(eq(presetVersions.presetId, presetId))
    .get()!;
  const state = {
    type: "object",
    required: ["score"],
    properties: { score: { type: "integer", minimum: 0 } },
    additionalProperties: false,
  };
  const character = {
    name: "沈知遥",
    description: "沈知遥是负责登记点数的账房。",
    personality: "沈知遥办事仔细。",
    scenario: "裴修远正在领取完成任务后获得的点数。",
    characterBook: {
      entries: [
        {
          uid: 1,
          keys: ["点数"],
          comment: "计分场景",
          content: "账房按任务完成记录登记点数。",
          constant: true,
          enabled: true,
          insertion_order: 1,
          position: "before_char",
        },
      ],
    },
    extensions: {
      tavern_headless: {
        stateUpdate: {
          profile: {
            updaterPrompt: "Old updater text is replaced by the bound preset.",
            ruleFiles: ["rules.txt"],
            writablePaths: ["/score"],
            stateSchema: state,
            maxTokens: 1000,
          },
          files: {},
        },
      },
    },
  };
  built.database
    .insert(characters)
    .values({
      id: "character",
      accountId,
      name: character.name,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  built.database
    .insert(characterVersions)
    .values({
      id: "version",
      characterId: "character",
      versionNo: 1,
      dataJson: JSON.stringify(character),
      contentHash: "fixture",
      createdAt: 1,
    })
    .run();
  const ruleText =
    "裴修远完成一项任务时，沈知遥将点数增加 1；同一项任务只登记一次。";
  const uploaded = await built.app.inject({
    method: "POST",
    url: "/role-assets/version",
    payload: {
      character_id: "character",
      files: [
        {
          name: "manifest.json",
          mime: "application/json",
          base64: Buffer.from(
            JSON.stringify({
              apiVersion: 1,
              html: "main.html",
              css: "main.css",
              script: "main.js",
              assets: {},
              data: {},
            }),
          ).toString("base64"),
          purpose: "manifest",
        },
        {
          name: "main.html",
          mime: "text/html",
          base64: Buffer.from("<main></main>").toString("base64"),
          purpose: "template",
        },
        {
          name: "main.css",
          mime: "text/css",
          base64: Buffer.from("main {}").toString("base64"),
          purpose: "template",
        },
        {
          name: "main.js",
          mime: "text/javascript",
          base64: Buffer.from("export {};").toString("base64"),
          purpose: "browser_script",
        },
        {
          name: "rules.txt",
          mime: "text/plain",
          base64: Buffer.from(ruleText).toString("base64"),
          purpose: "data",
        },
      ],
    },
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  built.database
    .insert(sessions)
    .values({
      id: "session",
      accountId,
      characterId: "character",
      characterVersionId: "version",
      characterSnapshotJson: JSON.stringify(character),
      promptMode: mode,
      userSnapshotJson: JSON.stringify({
        name: "裴修远",
        description: "裴修远是一位 28 岁的男性信使，性格谨慎，正在领取点数。",
      }),
      metadataJson: JSON.stringify({
        statePrompt: { presetId, presetVersionId: version.id, historyTurns },
      }),
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const snapshots = new DisplaySnapshotService(built.database);
  let previous = snapshots.initialize(accountId, "session", { score: 0 });
  function floor(number: number, parentFloorId: string | null) {
    const id = `floor-${number}`;
    built.database
      .insert(floors)
      .values({
        id,
        sessionId: "session",
        floorNo: number,
        parentFloorId,
        state: "committed",
        createdAt: number + 1,
        updatedAt: number + 1,
      })
      .run();
    built.database
      .insert(floorRunStates)
      .values({
        floorId: id,
        runId: `run-${number}`,
        runType: "respond",
        status: "completed",
        phase: "transaction_committed",
        publicPhase: "committing",
        startedAt: number + 1,
        updatedAt: number + 1,
      })
      .run();
    built.database
      .insert(messagePages)
      .values({
        id: `page-${number}`,
        floorId: id,
        pageNo: 0,
        pageKind: "output",
        createdAt: number + 1,
        updatedAt: number + 1,
      })
      .run();
    built.database
      .insert(messages)
      .values([
        {
          id: `user-${number}`,
          pageId: `page-${number}`,
          role: "user",
          content:
            number === 0
              ? "裴修远来到柜台。"
              : `“第 ${number} 项任务已经完成，请登记点数。”`,
          seq: 0,
          createdAt: number + 1,
        },
        {
          id: `assistant-${number}`,
          pageId: `page-${number}`,
          role: "assistant",
          content:
            number === 0
              ? "沈知遥询问裴修远完成了哪项任务。"
              : `沈知遥核对第 ${number} 项任务的完成记录，为裴修远登记了 1 点。`,
          seq: 1,
          createdAt: number + 1,
        },
      ])
      .run();
    return id;
  }
  let parent = floor(0, null);
  for (let round = 1; round <= pastRounds; round++) {
    parent = floor(round, parent);
    const record = {
      ...previous,
      snapshotId: `snapshot-${round}`,
      parentSnapshotId: previous.snapshotId,
      floorId: parent,
      attemptId: `run-${round}:1`,
      variables: { score: round },
      source: { kind: "floor" as const, runId: `run-${round}`, jobId: null },
    };
    snapshots.save(accountId, record, undefined, previous.variables);
    previous = record;
  }
  const target = floor(pastRounds + 1, parent);
  return {
    built,
    snapshots,
    previous,
    target,
    file: path.pathname,
    presetId,
    presetVersionId: version.id,
    ruleText,
  };
}

function createSourcePromptContext(marker: string) {
  const agentResult = {
    agentId: "director-agent",
    roleKind: "director",
    phase: "pre_response",
    status: "ok",
    durationMs: 7,
    stabilityHint: "floor",
    outputSummary: `${marker}_AGENT_RESULT`,
    output: { summary: `${marker}_AGENT_OUTPUT` },
  } satisfies AgentRunRecord;
  const agentContributor = {
    id: "agent:director",
    kind: "director_hint",
    sourceKind: "director_hint",
    modeScope: "compat_plus",
    payload: { intent: `${marker}_AGENT_PAYLOAD` },
    promptRenderable: {
      title: "Director hint",
      content: `${marker}_AGENT_CONTRIBUTOR`,
    },
    trace: { deterministic: true, cacheScope: "floor" },
  } satisfies PromptRuntimeContributorOutput;
  const memoryTrace = {
    summaryInjected: true,
    strategy: "dual_summary",
    summaryText: `${marker}_MEMORY_TRACE`,
  } satisfies NonNullable<PromptRuntimeTrace["memory"]>;
  const requestInjection = {
    scope: "request",
    sourceKind: "client_injection",
    title: `${marker} request injection`,
    content: `${marker}_REQUEST_INJECTION`,
    placement: "before_history",
  } satisfies PromptRuntimeInjectionBuilderInput;

  return {
    agentResults: [agentResult],
    agentContributors: [agentContributor],
    requestInjections: [requestInjection],
    memorySummary: `${marker}_MEMORY_SUMMARY`,
    memoryTrace,
  };
}

const sourceWorldbookEntry = {
  uid: 71,
  activationKey: "worldbook:fixture-worldbook:1:entry:71",
  source: {
    kind: "session_worldbook",
    worldbookId: "fixture-worldbook",
    worldbookName: "SOURCE_WORLDBOOK_ENTRY",
    assetScopeId: "worldbook:fixture-worldbook:1",
  },
  insertion: { position: "before" },
};

function saveWorldbookPromptSnapshot(f: Awaited<ReturnType<typeof fixture>>) {
  f.built.database
    .insert(promptSnapshots)
    .values({
      floorId: f.target,
      sessionId: "session",
      presetId: f.presetId,
      presetVersion: 1,
      presetVersionId: f.presetVersionId,
      presetContentHash: "fixture-preset-hash",
      worldbookActivatedEntryUidsJson: JSON.stringify([
        sourceWorldbookEntry.uid,
      ]),
      worldbookActivatedEntriesJson: JSON.stringify([sourceWorldbookEntry]),
      regexPreRuleNamesJson: JSON.stringify([]),
      regexPostRuleNamesJson: JSON.stringify([]),
      promptMode: "compat_plus",
      promptDigest: "fixture-prompt-digest",
      createdAt: 1,
    })
    .run();
}

function enableMemorySourceSelection(f: Awaited<ReturnType<typeof fixture>>) {
  const session = f.built.database
    .select()
    .from(sessions)
    .where(eq(sessions.id, "session"))
    .get()!;
  const metadata = JSON.parse(session.metadataJson ?? "{}");
  const promptRuntime = metadata.prompt_runtime ?? {};
  const policy = promptRuntime.policy ?? {};
  const sourceSelection = policy.sourceSelection ?? {};
  f.built.database
    .update(sessions)
    .set({
      metadataJson: JSON.stringify({
        ...metadata,
        prompt_runtime: {
          ...promptRuntime,
          policy: {
            ...policy,
            sourceSelection: {
              ...sourceSelection,
              memory: { enabled: true },
            },
          },
        },
      }),
    })
    .where(eq(sessions.id, "session"))
    .run();
}

for (const file of [
  "primary-state-update.json",
  "backup-mvu-state-update.json",
]) {
  describe(file, () => {
    for (const mode of ["compat_strict", "compat_plus", "native"] as const) {
      it.each([
        { turns: 5, past: 0 },
        { turns: 0, past: 4 },
        { turns: 5, past: 4 },
        { turns: 4, past: 4 },
        { turns: 2, past: 4 },
      ])(
        `${mode}: previews and commits with history $turns / $past`,
        async ({ turns, past }) => {
          const f = await fixture(file, mode, turns, past);
          const payload = {
            floor_id: f.target,
            expected_snapshot_id: f.previous.snapshotId,
          };
          const previewResponse = await f.built.app.inject({
            method: "POST",
            url: "/sessions/session/role-state/updates/dry-run",
            payload,
          });
          expect(previewResponse.statusCode, previewResponse.body).toBe(200);
          const preview = previewResponse.json().data as StatePromptPreview;
          expect(preview.preset).toEqual({
            presetId: f.presetId,
            presetVersionId: f.presetVersionId,
          });
          expect(preview.before).toEqual({ score: past });
          expect(preview.variableHistory.map((round) => round.floorNo)).toEqual(
            Array.from(
              { length: Math.min(turns, past) },
              (_, index) => past - Math.min(turns, past) + index + 1,
            ),
          );
          const text = preview.messages
            .map((message) => message.content)
            .join("\n");
          expect(text).toContain(f.ruleText);
          expect(text).toContain(
            "裴修远是一位 28 岁的男性信使，性格谨慎，正在领取点数。",
          );
          expect(text).toContain("账房按任务完成记录登记点数。");
          expect(text).toContain(`assistant-${past + 1}`);
          expect(text).toContain("outputSchema");
          expect(text).not.toContain("Old updater text");
          expect(preview.sources.map((source) => source.role)).toEqual([
            "user",
            "assistant",
          ]);
          expect(preview.sources[1]!.text).toBe(
            `沈知遥核对第 ${past + 1} 项任务的完成记录，为裴修远登记了 1 点。`,
          );
          expect(f.snapshots.latest(accountId, "session")!.snapshotId).toBe(
            f.previous.snapshotId,
          );
          vi.spyOn(
            LlmProfileService.prototype,
            "resolveActiveProfiles",
          ).mockResolvedValue({
            verifier: {
              source: "session",
              profileId: "profile",
              presetName: "State",
              provider: "openai-compatible",
              modelId: "test",
              baseUrl: "https://provider.test/v1",
              apiKey: "fixture",
              params: {},
            },
          });
          let request: { messages: StatePromptPreview["messages"] } | undefined;
          const network = vi.fn(async (_url, init) => {
            request = JSON.parse(
              init?.body
                ? String(init.body)
                : await (_url as Request).clone().text(),
            );
            return new Response(
              JSON.stringify({
                id: "response",
                object: "chat.completion",
                created: 1,
                model: "test",
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: JSON.stringify({
                        changes: [
                          { op: "set", path: "/score", value: past + 1 },
                        ],
                        evidenceMessageIds: [`assistant-${past + 1}`],
                      }),
                    },
                    finish_reason: "stop",
                  },
                ],
              }),
              { headers: { "content-type": "application/json" } },
            );
          });
          vi.stubGlobal("fetch", network);
          const update = await f.built.app.inject({
            method: "POST",
            url: "/sessions/session/role-state/updates",
            payload: { floor_id: f.target },
          });
          expect(update.statusCode, update.body).toBe(200);
          expect(update.json().data.variables).toEqual({ score: past + 1 });
          expect(request!.messages).toEqual(preview.messages);
          expect(network).toHaveBeenCalledTimes(1);
          const replay = await f.built.app.inject({
            method: "POST",
            url: "/sessions/session/role-state/updates",
            payload: { floor_id: f.target },
          });
          expect(replay.json().data.snapshotId).toBe(
            update.json().data.snapshotId,
          );
          expect(network).toHaveBeenCalledTimes(1);
          if (process.env.STATE_ASSEMBLY_ACCEPTANCE_DIR) {
            await mkdir(process.env.STATE_ASSEMBLY_ACCEPTANCE_DIR, {
              recursive: true,
            });
            await writeFile(
              join(
                process.env.STATE_ASSEMBLY_ACCEPTANCE_DIR,
                `${file}-${mode}-${turns}-${past}.json`,
              ),
              JSON.stringify(
                {
                  presetFile: f.file,
                  resourceId: f.presetId,
                  versionId: f.presetVersionId,
                  request: payload,
                  preview,
                  modelRequest: request,
                  committedSnapshot: update.json().data,
                  conclusions: {
                    fixedPreset: "passed",
                    personaDescription: "passed",
                    worldbook: "passed",
                    rules: "passed",
                    messageIdentity: "passed",
                    variableHistory: "passed",
                    sharedRequest: "passed",
                    deterministicCommit: "passed",
                    realModelOutput: "not_verified",
                  },
                },
                null,
                2,
              ),
            );
          }
        },
      );
    }
  });
}

it("validates preview targets and expected state without modifying snapshots", async () => {
  const f = await fixture("primary-state-update.json", "compat_plus", 5, 0);
  const initialCount = f.built.database
    .select()
    .from(roleDisplaySnapshots)
    .all().length;
  for (const [payload, status, code] of [
    [{ floor_id: f.target }, 400, null],
    [
      { floor_id: "missing", expected_snapshot_id: f.previous.snapshotId },
      404,
      "ROLE_FLOOR_NOT_FOUND",
    ],
    [
      { floor_id: f.target, expected_snapshot_id: "stale" },
      409,
      "ROLE_STATE_REPAIR_STALE",
    ],
  ] as const) {
    const response = await f.built.app.inject({
      method: "POST",
      url: "/sessions/session/role-state/updates/dry-run",
      payload,
    });
    expect(response.statusCode, response.body).toBe(status);
    if (code) expect(response.json().error.code).toBe(code);
  }
  expect(
    f.built.database.select().from(roleDisplaySnapshots).all(),
  ).toHaveLength(initialCount);
});
it("keeps the preview endpoint disabled unless enabled by server configuration", async () => {
  const f = await fixture("primary-state-update.json", "native", 0, 0, false);
  const response = await f.built.app.inject({
    method: "POST",
    url: "/sessions/session/role-state/updates/dry-run",
    payload: {
      floor_id: f.target,
      expected_snapshot_id: f.previous.snapshotId,
    },
  });
  expect(response.statusCode).toBe(404);
  expect(response.json().error.code).toBe("ROLE_STATE_DRY_RUN_DISABLED");
});

it("uses the selected state model limits when allocating the preview", async () => {
  const f = await fixture("primary-state-update.json", "compat_plus", 0, 0);
  vi.spyOn(
    LlmProfileService.prototype,
    "resolveActiveProfiles",
  ).mockResolvedValue({
    verifier: {
      source: "session",
      profileId: "state-model",
      presetName: "State",
      provider: "openai-compatible",
      modelId: "test",
      baseUrl: "https://provider.test/v1",
      apiKey: "fixture",
      params: { maxContextTokens: 6000, maxOutputTokens: 1200 },
    },
  });
  const response = await f.built.app.inject({
    method: "POST",
    url: "/sessions/session/role-state/updates/dry-run",
    payload: {
      floor_id: f.target,
      expected_snapshot_id: f.previous.snapshotId,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(
    response.json().data.token_usage.availableForReply,
  ).toBeGreaterThanOrEqual(1200);
  expect(response.json().data.runtime_trace.budgets).toBeDefined();
});

it.each(["missing", "foreign"])(
  "rejects a %s state preset version",
  async (kind) => {
    const f = await fixture("primary-state-update.json", "native", 0, 0);
    if (kind === "missing") {
      f.built.database
        .update(sessions)
        .set({
          metadataJson: JSON.stringify({
            statePrompt: {
              presetId: f.presetId,
              presetVersionId: "missing",
              historyTurns: 0,
            },
          }),
        })
        .where(eq(sessions.id, "session"))
        .run();
    } else {
      const { presets } = await import("../../db/schema.js");
      f.built.database
        .update(presets)
        .set({ accountId: "another-account" })
        .where(eq(presets.id, f.presetId))
        .run();
    }
    const response = await f.built.app.inject({
      method: "POST",
      url: "/sessions/session/role-state/updates/dry-run",
      payload: {
        floor_id: f.target,
        expected_snapshot_id: f.previous.snapshotId,
      },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json().error.code).toBe(
      "ROLE_STATE_PRESET_VERSION_NOT_FOUND",
    );
  },
);

it.each(["completed", "running"] as const)(
  "applies recalculation target checks to state previews when the next generation is %s",
  async (status) => {
    const f = await fixture("primary-state-update.json", "compat_plus", 0, 1);
    if (status === "running")
      f.built.database
        .update(floorRunStates)
        .set({ status })
        .where(eq(floorRunStates.floorId, f.target))
        .run();
    const response = await f.built.app.inject({
      method: "POST",
      url: "/sessions/session/role-state/updates/dry-run",
      payload: {
        floor_id: "floor-1",
        expected_snapshot_id: f.previous.snapshotId,
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe(
      status === "running"
        ? "ROLE_STATE_REPAIR_BUSY"
        : "ROLE_STATE_REPAIR_FLOOR_CHANGED",
    );
  },
);

it("reuses the successful request injection and expands the actual state model name", async () => {
  const f = await fixture(
    "primary-state-update.json",
    "compat_plus",
    0,
    0,
    true,
    true,
  );
  const session = f.built.database
    .select()
    .from(sessions)
    .where(eq(sessions.id, "session"))
    .get()!;
  f.built.database
    .update(sessions)
    .set({
      metadataJson: JSON.stringify({
        ...JSON.parse(session.metadataJson!),
        model: "body-model",
      }),
    })
    .where(eq(sessions.id, "session"))
    .run();
  enableMemorySourceSelection(f);
  vi.spyOn(
    LlmProfileService.prototype,
    "resolveActiveProfiles",
  ).mockResolvedValue({
    verifier: {
      source: "session",
      profileId: "state-model",
      presetName: "State",
      provider: "openai-compatible",
      modelId: "actual-state-model",
      baseUrl: "https://provider.test/v1",
      apiKey: "fixture",
      params: { maxContextTokens: 6000, maxOutputTokens: 1200 },
    },
  });
  const { floorResultSnapshots } = await import("../../db/schema.js");
  const sourceContext = createSourcePromptContext("SAVED");
  saveWorldbookPromptSnapshot(f);
  f.built.database
    .insert(floorResultSnapshots)
    .values({
      floorId: f.target,
      outputPageId: "page-1",
      assistantMessageId: "assistant-1",
      generatedText: "saved",
      promptContextJson: JSON.stringify(sourceContext),
      committedAt: 1,
      updatedAt: 1,
    })
    .run();
  const response = await f.built.app.inject({
    method: "POST",
    url: "/sessions/session/role-state/updates/dry-run",
    payload: {
      floor_id: f.target,
      expected_snapshot_id: f.previous.snapshotId,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const preview = response.json().data as StatePromptPreview;
  const text = preview.messages.map((message) => message.content).join("\n");
  expect(text).toContain("SAVED_REQUEST_INJECTION");
  expect(text).toContain("SAVED_AGENT_RESULT");
  expect(text).toContain("SAVED_AGENT_CONTRIBUTOR");
  expect(text).toContain("SAVED_MEMORY_SUMMARY");
  expect(text).toContain("worldbookSelection");
  expect(text).toContain('"entryUids":[71]');
  expect(text).toContain("SOURCE_WORLDBOOK_ENTRY");
  expect(preview.sourceIdentity.outputPageId).toBe("page-1");
  expect(preview.sourceIdentity.assistantMessageId).toBe("assistant-1");
  expect(preview.runtime_trace.memory).toMatchObject({
    summaryInjected: true,
    strategy: "dual_summary",
    summaryText: "SAVED_MEMORY_TRACE",
  });
  expect(text).toContain("State model: actual-state-model");
  expect(text).not.toContain("State model: body-model");
  expect(
    preview.token_usage.total + preview.token_usage.availableForReply,
  ).toBe(6000);
  expect(f.snapshots.latest(accountId, "session")!.snapshotId).toBe(
    f.previous.snapshotId,
  );
});

it.each([false, true])(
  "uses the activated assistant page with source call recorded=%s",
  async (withSourceCall) => {
    const f = await fixture("primary-state-update.json", "compat_plus", 0, 0);
    enableMemorySourceSelection(f);
    const { floorResultSnapshots } = await import("../../db/schema.js");
    f.built.database
      .update(messagePages)
      .set({ pageNo: 1 })
      .where(eq(messagePages.id, "page-1"))
      .run();
    f.built.database
      .insert(messagePages)
      .values({
        id: "input-page",
        floorId: f.target,
        pageNo: 0,
        pageKind: "input",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    f.built.database
      .update(messages)
      .set({ pageId: "input-page" })
      .where(eq(messages.id, "user-1"))
      .run();
    f.built.database
      .insert(messagePages)
      .values({
        id: "selected-page",
        floorId: f.target,
        pageNo: 1,
        pageKind: "output",
        version: 2,
        isActive: false,
        createdAt: 2,
        updatedAt: 2,
      })
      .run();
    f.built.database
      .insert(messages)
      .values({
        id: "selected-assistant",
        pageId: "selected-page",
        role: "assistant",
        seq: 0,
        content: "SELECTED_BODY",
        createdAt: 2,
      })
      .run();
    const oldSourceContext = createSourcePromptContext("OLD");
    saveWorldbookPromptSnapshot(f);
    f.built.database
      .insert(floorResultSnapshots)
      .values({
        floorId: f.target,
        outputPageId: "page-1",
        assistantMessageId: "assistant-1",
        generatedText: "previous",
        promptContextJson: JSON.stringify(oldSourceContext),
        committedAt: 1,
        updatedAt: 1,
      })
      .run();
    const originalPageResponse = await f.built.app.inject({
      method: "POST",
      url: "/sessions/session/role-state/updates/dry-run",
      payload: {
        floor_id: f.target,
        expected_snapshot_id: f.previous.snapshotId,
      },
    });
    expect(originalPageResponse.statusCode, originalPageResponse.body).toBe(
      200,
    );
    const originalPreview = originalPageResponse.json()
      .data as StatePromptPreview;
    const originalText = originalPreview.messages
      .map((message) => message.content)
      .join("\n");
    expect(originalPreview.sourceIdentity.outputPageId).toBe("page-1");
    expect(originalPreview.sourceIdentity.assistantMessageId).toBe(
      "assistant-1",
    );
    expect(originalText).toContain("OLD_AGENT_RESULT");
    expect(originalText).toContain("OLD_AGENT_CONTRIBUTOR");
    expect(originalText).toContain("OLD_MEMORY_SUMMARY");
    expect(originalText).toContain('"entryUids":[71]');
    expect(originalText).toContain("SOURCE_WORLDBOOK_ENTRY");
    expect(originalPreview.runtime_trace.memory).toMatchObject({
      summaryInjected: true,
      strategy: "dual_summary",
      summaryText: "OLD_MEMORY_TRACE",
    });
    const activated = await f.built.app.inject({
      method: "PATCH",
      url: "/pages/selected-page/activate",
    });
    expect(activated.statusCode, activated.body).toBe(200);
    if (withSourceCall) {
      const { modelCallRecords } = await import("../../db/schema.js");
      const record = {
        callId: "selected-call",
        invocationId: "selected-invocation",
        requestAttemptNo: 1,
        accountId,
        sessionId: "session",
        branchId: "main",
        floorId: f.target,
        runId: "selected-run",
        attemptNo: 2,
        stepIndex: 0,
        slot: "narrator",
        purpose: "narration",
        releaseId: null,
        draftRevision: null,
        resourceVersions: {},
        inputPageId: "input-page",
        inputMessageId: "user-1",
        provider: "openai-compatible",
        model: "body-model",
        endpoint: "https://provider.test/v1/chat/completions",
        requestBody: "{}",
        responseBody: "{}",
        httpStatus: 200,
        status: "succeeded" as const,
        preparedAt: 1,
        sentAt: 1,
        firstResponseAt: 2,
        endedAt: 2,
        text: "SELECTED_BODY",
        reasoning: null,
        toolData: null,
        usage: null,
        finishReason: "stop",
        error: null,
        outputPageId: "selected-page",
        outputMessageId: "selected-assistant",
      };
      f.built.database
        .insert(modelCallRecords)
        .values({
          callId: record.callId,
          invocationId: record.invocationId,
          requestAttemptNo: record.requestAttemptNo,
          accountId,
          sessionId: record.sessionId,
          branchId: record.branchId,
          floorId: record.floorId,
          runId: record.runId,
          attemptNo: record.attemptNo,
          preparedAt: record.preparedAt,
          status: record.status,
          turnCommitStatus: "committed",
          recordJson: JSON.stringify(record),
        })
        .run();
    }

    const response = await f.built.app.inject({
      method: "POST",
      url: "/sessions/session/role-state/updates/dry-run",
      payload: {
        floor_id: f.target,
        expected_snapshot_id: f.previous.snapshotId,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const preview = response.json().data as StatePromptPreview;
    const text = preview.messages.map((message) => message.content).join("\n");
    expect(text).toContain("SELECTED_BODY");
    const serializedPreview = JSON.stringify(preview);
    expect(serializedPreview).not.toContain("OLD_AGENT_RESULT");
    expect(serializedPreview).not.toContain("OLD_AGENT_CONTRIBUTOR");
    expect(serializedPreview).not.toContain("OLD_MEMORY_SUMMARY");
    expect(serializedPreview).not.toContain("OLD_MEMORY_TRACE");
    expect(serializedPreview).not.toContain("OLD_REQUEST_INJECTION");
    expect(serializedPreview).not.toContain("SOURCE_WORLDBOOK_ENTRY");
    expect(text).toContain('"worldbookSelection":null');
    expect(preview.sources.map((source) => source.messageId)).toEqual([
      "user-1",
      "selected-assistant",
    ]);
    expect(preview.sourceIdentity.outputPageId).toBe("selected-page");
    expect(preview.sourceIdentity.assistantMessageId).toBe(
      "selected-assistant",
    );
    expect(preview.sourceIdentity.runId).toBe(
      withSourceCall ? "selected-run" : null,
    );
    expect(preview.sourceIdentity.attemptNo).toBe(withSourceCall ? 2 : null);
    expect(preview.sourceIdentity.floorRunId).toBe("run-1");
  },
);
